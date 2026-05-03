import { world } from './world.js';
import { applyEffect } from './effects.js';
import { sendStats } from './messages.js';
import { t, s } from '../i18n.js';

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
  };
}

function ensureList(actor) {
  if (!Array.isArray(actor.activeEffects)) actor.activeEffects = [];
  return actor.activeEffects;
}

function markDirty(actor) {
  if (actor.kind === 'player') actor.dirty = true;
}

export function applyActiveEffect(target, defId, source, casterName = null) {
  const def = world.effectDefs.get(defId);
  if (!def) return null;
  const list = ensureList(target);
  const stack = def.stack ?? 'refresh';
  const idx = list.findIndex(e => e.defId === defId && e.source === source);
  if (idx >= 0) {
    if (stack === 'ignore') return list[idx];
    if (stack === 'refresh') {
      const fresh = makeInstance(defId, source, casterName);
      if (fresh) list[idx] = fresh;
      markDirty(target);
      return fresh;
    }
  }
  const inst = makeInstance(defId, source, casterName);
  if (!inst) return null;
  list.push(inst);
  markDirty(target);
  return inst;
}

export function removeEffectsBySource(actor, source) {
  const list = ensureList(actor);
  const before = list.length;
  actor.activeEffects = list.filter(e => e.source !== source);
  if (actor.activeEffects.length !== before) markDirty(actor);
}

export function syncWearableEffects(actor) {
  const list = ensureList(actor);
  actor.activeEffects = list.filter(e => !e.source.startsWith('wearable:'));
  const equipped = actor.record?.equipped ?? {};
  for (const slot of Object.keys(equipped)) {
    const defId = equipped[slot];
    if (!defId) continue;
    const itemDef = world.itemDefs.get(defId);
    const effects = itemDef?.wearable?.effects ?? [];
    for (const effId of effects) {
      applyActiveEffect(actor, effId, `wearable:${defId}`);
    }
  }
}

let damageHandler = null;
export function setEffectDamageHandler(fn) { damageHandler = fn; }

function tickFeedbackParams(def, lang) {
  return { icon: def.icon ?? '', name: t(def.name, lang) };
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
  if (spec.type === 'damage' && damageHandler && inst.casterName) {
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
  for (const inst of list) {
    const def = world.effectDefs.get(inst.defId);
    if (!def) { changed = true; continue; }
    if (!def.tick) { remaining.push(inst); continue; }
    inst.nextTickIn -= 1;
    if (inst.nextTickIn > 0) { remaining.push(inst); continue; }
    fireTick(actor, inst, def);
    changed = true;
    if (inst.pulsesLeft != null) {
      inst.pulsesLeft -= 1;
      if (inst.pulsesLeft <= 0) {
        sendExpiredFeedback(actor, def);
        continue;
      }
    }
    inst.nextTickIn = def.tick.every;
    remaining.push(inst);
  }
  actor.activeEffects = remaining;
  if (changed) markDirty(actor);
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
      source: inst.source,
    });
  }
  return out;
}

export function serializeActiveEffectsForSave(actor) {
  const list = actor.activeEffects ?? [];
  return list
    .filter(e => !e.source.startsWith('wearable:'))
    .map(e => ({
      defId: e.defId,
      source: e.source,
      casterName: e.casterName,
      nextTickIn: e.nextTickIn,
      pulsesLeft: e.pulsesLeft,
    }));
}

export function normalizeSavedActiveEffects(saved) {
  if (!Array.isArray(saved)) return [];
  const out = [];
  for (const e of saved) {
    if (!e || typeof e !== 'object') continue;
    if (typeof e.defId !== 'string') continue;
    if (!world.effectDefs.has(e.defId)) continue;
    if (typeof e.source !== 'string' || e.source.startsWith('wearable:')) continue;
    out.push({
      defId: e.defId,
      source: e.source,
      casterName: typeof e.casterName === 'string' ? e.casterName : null,
      nextTickIn: typeof e.nextTickIn === 'number' ? e.nextTickIn : 0,
      pulsesLeft: typeof e.pulsesLeft === 'number' ? e.pulsesLeft : null,
    });
  }
  return out;
}
