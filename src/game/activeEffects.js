import { world } from './world.js';
import { applyEffect } from './effects.js';
import { sendStats } from './messages.js';
import { recomputeStats } from './wearables.js';
import { t, s } from '../i18n.js';
import { WEARABLE_SOURCE_PREFIX } from './contentMeta.js';

function makeInstance(defId, source, casterName) {
  const def = world.effectDefs.get(defId);
  if (!def) return null;
  const tick = def.tick ?? null;
  return {
    defId,
    source,
    casterName: casterName ?? null,
    nextTickIn: tick?.every ?? 0,
    pulsesLeft: tick?.pulses ?? null,
    ticksLeft: typeof def.duration === 'number' ? def.duration : null,
  };
}

function ensureList(actor) {
  if (!Array.isArray(actor.activeEffects)) actor.activeEffects = [];
  return actor.activeEffects;
}

function markDirty(actor) {
  if (actor.kind === 'player') actor.dirty = true;
}

let roomRefreshHandler = null;
export function setRoomRefreshHandler(fn) { roomRefreshHandler = fn; }

// Effects that require other observers to re-render the room: light/dark sources change
// the room's visible items and actors, and invisibility changes whether the wearer
// appears in the actor list at all.
function changesRoomLight(def) {
  return !!(def?.lightSource || def?.darknessSource || def?.invisible);
}

function refreshRoomLight(target) {
  if (roomRefreshHandler && target?.location) roomRefreshHandler(target.location);
}

function displaceExclusiveGroup(target, incomingDef) {
  const list = ensureList(target);
  let displacedStatMod = false;
  let displacedLight = false;
  const kept = [];
  for (const e of list) {
    if (e.defId === incomingDef.id) { kept.push(e); continue; }
    const eDef = world.effectDefs.get(e.defId);
    if (eDef?.exclusiveGroup === incomingDef.exclusiveGroup) {
      sendExpiredFeedback(target, eDef);
      if (eDef.statMod) displacedStatMod = true;
      if (changesRoomLight(eDef)) displacedLight = true;
      continue;
    }
    kept.push(e);
  }
  if (kept.length !== list.length) {
    target.activeEffects = kept;
    markDirty(target);
    if (displacedStatMod) recomputeStats(target);
  }
  return displacedLight;
}

export function applyActiveEffect(target, defId, source, casterName = null) {
  const def = world.effectDefs.get(defId);
  if (!def) return null;
  let lightChanged = changesRoomLight(def);
  if (def.exclusiveGroup) {
    if (displaceExclusiveGroup(target, def)) lightChanged = true;
  }
  const list = ensureList(target);
  const stack = def.stack ?? 'refresh';
  const idx = list.findIndex(e => e.defId === defId && e.source === source);
  if (idx >= 0) {
    if (stack === 'ignore') return list[idx];
    if (stack === 'refresh') {
      const fresh = makeInstance(defId, source, casterName);
      if (fresh) list[idx] = fresh;
      markDirty(target);
      if (def.statMod) recomputeStats(target);
      if (lightChanged) refreshRoomLight(target);
      return fresh;
    }
  }
  const inst = makeInstance(defId, source, casterName);
  if (!inst) return null;
  list.push(inst);
  markDirty(target);
  if (def.statMod) recomputeStats(target);
  if (lightChanged) refreshRoomLight(target);
  return inst;
}

export function removeEffectsBySource(actor, source) {
  const list = ensureList(actor);
  const before = list.length;
  actor.activeEffects = list.filter(e => e.source !== source);
  if (actor.activeEffects.length !== before) markDirty(actor);
}

// Strips all active-effect instances matching `defId`. Used by the `cure` effect type
// for surgical removal (e.g. cure_blindness strips only effect.blinded). Mirrors the
// side-effect handling in applyActiveEffect: marks dirty, recomputes statMod, and
// refreshes room light if a light-touching effect was removed.
export function removeEffectsByDefId(actor, defId) {
  const list = ensureList(actor);
  const before = list.length;
  let hadStatMod = false;
  let touchedLight = false;
  actor.activeEffects = list.filter(e => {
    if (e.defId !== defId) return true;
    const def = world.effectDefs.get(e.defId);
    if (def?.statMod) hadStatMod = true;
    if (def && changesRoomLight(def)) touchedLight = true;
    return false;
  });
  const removed = before - actor.activeEffects.length;
  if (removed > 0) {
    markDirty(actor);
    if (hadStatMod) recomputeStats(actor);
    if (touchedLight) refreshRoomLight(actor);
  }
  return removed;
}

// Strips all `kind: "debuff"` active effects from the actor, skipping wearable-applied
// effects (those are tied to equipped gear — re-applied on next equip sync). Used by the
// `cleanse` effect type in effects.js, wired via setCleanseHandler in tick.js.
export function removeDebuffs(actor) {
  const list = ensureList(actor);
  const before = list.length;
  let hadStatMod = false;
  actor.activeEffects = list.filter(e => {
    if (e.source?.startsWith(WEARABLE_SOURCE_PREFIX)) return true;
    const def = world.effectDefs.get(e.defId);
    if (!def) return true;
    if (def.kind === 'debuff') {
      if (def.statMod) hadStatMod = true;
      return false;
    }
    return true;
  });
  const removed = before - actor.activeEffects.length;
  if (removed > 0) {
    markDirty(actor);
    if (hadStatMod) recomputeStats(actor);
  }
  return removed;
}

export function syncWearableEffects(actor) {
  const list = ensureList(actor);
  actor.activeEffects = list.filter(e => !e.source.startsWith(WEARABLE_SOURCE_PREFIX));
  const equipped = actor.record?.equipped ?? {};
  for (const slot of Object.keys(equipped)) {
    const defId = equipped[slot];
    if (!defId) continue;
    const itemDef = world.itemDefs.get(defId);
    const effects = itemDef?.wearable?.effects ?? [];
    for (const effId of effects) {
      applyActiveEffect(actor, effId, `${WEARABLE_SOURCE_PREFIX}${defId}`);
    }
  }
}

let damageHandler = null;
export function setEffectDamageHandler(fn) { damageHandler = fn; }

function tickFeedbackParams(def, lang) {
  return { name: t(def.name, lang) };
}

function sendTickFeedback(actor, def, spec, result) {
  if (actor.kind !== 'player' || !actor.session) return;
  const lang = actor.lang;
  const base = tickFeedbackParams(def, lang);
  if (spec.type === 'heal') {
    const hp = result?.hpRestored ?? 0;
    const mp = result?.mpRestored ?? 0;
    if (hp <= 0 && mp <= 0) return;
    let text;
    if (hp > 0 && mp > 0) text = s('effect.tick.heal_both', lang, { ...base, hp, mp });
    else if (hp > 0) text = s('effect.tick.heal_hp', lang, { ...base, amount: hp });
    else text = s('effect.tick.heal_mp', lang, { ...base, amount: mp });
    actor.session.send({ kind: 'system', tone: 'good', text });
  } else if (spec.type === 'damage') {
    const dealt = result?.dealt ?? 0;
    if (dealt <= 0) return;
    actor.session.send({
      kind: 'system',
      tone: 'bad',
      text: s('effect.tick.damage', lang, { ...base, amount: dealt }),
    });
  }
}

function sendExpiredFeedback(actor, def) {
  if (actor.kind !== 'player' || !actor.session) return;
  const lang = actor.lang;
  actor.session.send({
    kind: 'system',
    tone: 'flavor',
    text: s('effect.expired', lang, tickFeedbackParams(def, lang)),
  });
}

function fireTick(actor, inst, def) {
  const spec = def.tick?.effect;
  if (!spec) return;
  if (spec.type === 'damage' && spec.stat !== 'mp' && damageHandler && inst.casterName) {
    const caster = world.actorsByName.get(inst.casterName.toLowerCase());
    if (caster && caster.location === actor.location && caster.stats?.hp > 0 && caster !== actor) {
      damageHandler(caster, actor, spec.amount ?? 1);
      return;
    }
  }
  const result = applyEffect(spec, { actor, target: actor });
  sendTickFeedback(actor, def, spec, result);
  if (actor.kind === 'player' && actor.session) sendStats(actor);
}

export function tickActiveEffects(actor) {
  const list = actor.activeEffects;
  if (!Array.isArray(list) || list.length === 0) return false;
  const remaining = [];
  let changed = false;
  let statModChanged = false;
  let lightExpired = false;
  for (const inst of list) {
    const def = world.effectDefs.get(inst.defId);
    if (!def) { changed = true; continue; }
    if (inst.ticksLeft != null) {
      inst.ticksLeft -= 1;
      if (inst.ticksLeft <= 0) {
        sendExpiredFeedback(actor, def);
        if (def.statMod) statModChanged = true;
        if (changesRoomLight(def)) lightExpired = true;
        changed = true;
        continue;
      }
      changed = true;
    }
    if (!def.tick) { remaining.push(inst); continue; }
    inst.nextTickIn -= 1;
    if (inst.nextTickIn > 0) { remaining.push(inst); continue; }
    fireTick(actor, inst, def);
    changed = true;
    if (inst.pulsesLeft != null) {
      inst.pulsesLeft -= 1;
      if (inst.pulsesLeft <= 0) {
        sendExpiredFeedback(actor, def);
        if (def.statMod) statModChanged = true;
        if (changesRoomLight(def)) lightExpired = true;
        continue;
      }
    }
    inst.nextTickIn = def.tick.every;
    remaining.push(inst);
  }
  actor.activeEffects = remaining;
  if (changed) markDirty(actor);
  if (statModChanged) recomputeStats(actor);
  if (lightExpired) refreshRoomLight(actor);
  return changed;
}

export function serializeActiveEffectsForClient(actor, lang) {
  const list = actor.activeEffects ?? [];
  const out = [];
  for (const inst of list) {
    const def = world.effectDefs.get(inst.defId);
    if (!def) continue;
    out.push({
      defId: inst.defId,
      name: t(def.name, lang),
      icon: def.icon ?? '',
      kind: def.kind ?? 'neutral',
      pulsesLeft: inst.pulsesLeft,
      nextTickIn: inst.nextTickIn,
      ticksLeft: inst.ticksLeft,
      source: inst.source,
    });
  }
  return out;
}

export function serializeActiveEffectsForSave(actor) {
  const list = actor.activeEffects ?? [];
  return list
    .filter(e => !e.source.startsWith(WEARABLE_SOURCE_PREFIX))
    .map(e => ({
      defId: e.defId,
      source: e.source,
      casterName: e.casterName,
      nextTickIn: e.nextTickIn,
      pulsesLeft: e.pulsesLeft,
      ticksLeft: e.ticksLeft,
    }));
}

export function normalizeSavedActiveEffects(saved) {
  if (!Array.isArray(saved)) return [];
  const out = [];
  for (const e of saved) {
    if (!e || typeof e !== 'object') continue;
    if (typeof e.defId !== 'string') continue;
    const def = world.effectDefs.get(e.defId);
    if (!def) continue;
    if (typeof e.source !== 'string' || e.source.startsWith(WEARABLE_SOURCE_PREFIX)) continue;
    const fallbackTicks = typeof def.duration === 'number' ? def.duration : null;
    out.push({
      defId: e.defId,
      source: e.source,
      casterName: typeof e.casterName === 'string' ? e.casterName : null,
      nextTickIn: typeof e.nextTickIn === 'number' ? e.nextTickIn : 0,
      pulsesLeft: typeof e.pulsesLeft === 'number' ? e.pulsesLeft : null,
      ticksLeft: typeof e.ticksLeft === 'number' ? e.ticksLeft : fallbackTicks,
    });
  }
  return out;
}
