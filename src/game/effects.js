import { sendStats } from './messages.js';
import { s, t } from '../i18n.js';
import { world, unlockExit, placeItemInRoom, removeItemFromRoom, addGoldToRoom, broadcastToRoom } from './world.js';
import { makeItemInstance } from './items.js';
import { roll } from './dice.js';
import { resolveName } from './declension.js';
import { setHate, getHate, maxHateInRoom, clearHateTable } from './aggro.js';

function evalAmount(value, ctx) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return roll(value, ctx);
  return 0;
}

// Set by combat.js so the `damage` effect can route through applyDamageWithFeedback when
// applied to a non-self target (preserves aggro + UI feedback + death). Same indirection as
// activeEffects.setEffectDamageHandler — kept here to avoid combat → effects cycles.
let damageRouteHandler = null;
export function setDamageRouteHandler(fn) { damageRouteHandler = fn; }

const EFFECTS = {
  teach_spell({ spell }, { actor }) {
    if (!spell || !actor?.knownSpells) return { learned: false };
    if (actor.knownSpells.includes(spell)) return { learned: false, already: true };
    if (!world.spellDefs.has(spell)) return { learned: false };
    actor.knownSpells.push(spell);
    actor.dirty = true;
    return { learned: true, spell };
  },
  produce({ item }, { actor }) {
    const def = world.itemDefs.get(item);
    if (!def || !actor?.inventory) return { produced: null };
    const inst = makeItemInstance(def);
    actor.inventory.push(inst);
    actor.dirty = true;
    if (actor.kind === 'player' && actor.session) sendStats(actor);
    return { produced: def.id, name: def.name, instance: inst };
  },
  unlock({ room, exit }, { actor }) {
    const roomId = room ?? actor?.location;
    if (!roomId || !exit) return { unlocked: false };
    unlockExit(roomId, exit);
    return { unlocked: true, room: roomId, exit };
  },
  damage({ amount, stat = 'hp', _raw }, { actor, target }) {
    const recipient = target ?? actor;
    if (!recipient.stats) return { dealt: 0 };
    if (stat === 'mp') {
      // MP drain bypasses the combat feedback path — apply directly and update HUD only.
      const raw = Math.max(0, amount ?? 0);
      const dealt = Math.min(recipient.stats.mp, raw);
      recipient.stats.mp = Math.max(0, recipient.stats.mp - dealt);
      if (recipient.kind === 'player' && recipient.session) sendStats(recipient);
      return { dealt };
    }
    // When called from a content slot (use.effect, etc.) with a real other-actor target,
    // route through the combat feedback path so aggro/death/HUD updates fire correctly.
    // `_raw` is set by applyDamageWithFeedback itself to mark the inner raw subtraction.
    if (!_raw && damageRouteHandler && actor && target && target !== actor) {
      const dealt = damageRouteHandler(actor, target, Math.max(0, amount ?? 0));
      return { dealt };
    }
    const dealt = Math.min(recipient.stats.hp, Math.max(0, amount ?? 0));
    recipient.stats.hp -= dealt;
    return { dealt };
  },
  open_chest({ key, loot, gold }, { actor, fixture, room }) {
    if (!actor || !room) return { opened: false };
    if (key) {
      const idx = actor.inventory?.findIndex(i => i.defId === key) ?? -1;
      if (idx < 0) return { opened: false, missingKey: key };
      actor.inventory.splice(idx, 1);
      actor.dirty = true;
    }
    const dropped = [];
    for (const entry of loot ?? []) {
      if (Math.random() < (entry.chance ?? 1.0)) {
        const def = world.itemDefs.get(entry.defId);
        if (!def) continue;
        const count = entry.count ?? 1;
        for (let i = 0; i < count; i++) {
          const inst = makeItemInstance(def);
          placeItemInRoom(inst, room);
          dropped.push(inst);
        }
      }
    }
    let goldAmount = 0;
    if (gold) {
      goldAmount = Math.max(0, roll(gold, { actor }));
      if (goldAmount > 0) addGoldToRoom(room, goldAmount);
    }
    if (fixture) removeItemFromRoom(fixture, room);
    return { opened: true, dropped, goldAmount };
  },
  drain({ amount, formula, ratio = 0.5 }, { actor, target }) {
    if (!target || target === actor || !target.stats) return { dealt: 0, healed: 0 };
    const raw = Math.max(0, evalAmount(formula ?? amount, { actor }));
    const dealt = damageRouteHandler ? damageRouteHandler(actor, target, raw) : 0;
    const healed = Math.floor(dealt * ratio);
    if (healed > 0 && actor.stats) {
      actor.stats.hp = Math.min(actor.stats.hpMax, actor.stats.hp + healed);
      if (actor.kind === 'player' && actor.session) sendStats(actor);
    }
    return { dealt, healed };
  },
  taunt(_def, { actor, target }) {
    if (!actor || !target || target.kind !== 'npc' || target.alive === false) return { ok: false };
    const ceiling = maxHateInRoom(target);
    setHate(target, actor, ceiling + 500);
    target.disposition = 'hostile';
    target.aggressive = true;
    target.wasAttacked = true;
    target.currentTarget = actor;
    if (actor.kind === 'player') actor.target = target;
    if (actor.session) {
      actor.session.send({
        kind: 'system', tone: 'combat',
        text: s('aggro.taunt_success_self', actor.lang, { npc: resolveName(target, 'acc', actor.lang) }),
      });
    }
    broadcastToRoom(target.location, (recipient) => {
      if (recipient === actor) return null;
      const lang = recipient.lang;
      return {
        kind: 'emote', tone: 'combat',
        text: s('aggro.taunt_success_others', lang, {
          actor: resolveName(actor, 'nom', lang),
          npc: resolveName(target, 'acc', lang),
        }),
      };
    });
    return { ok: true };
  },
  pacify({ power = 30 }, { actor, target }) {
    if (!actor || !target || target.kind !== 'npc' || target.alive === false) return { ok: false };
    const maxHate = maxHateInRoom(target);
    if (maxHate >= power) {
      if (actor.session) {
        actor.session.send({
          kind: 'system', tone: 'flavor',
          text: s('aggro.pacify_fizzle', actor.lang, { npc: resolveName(target, 'nom', actor.lang) }),
        });
      }
      return { ok: false, fizzled: true };
    }
    clearHateTable(target);
    setHate(target, actor, -power);
    target.currentTarget = null;
    target.wasAttacked = false;
    broadcastToRoom(target.location, (recipient) => {
      const lang = recipient.lang;
      return {
        kind: 'emote', tone: 'good',
        text: s('aggro.pacify_success', lang, { npc: resolveName(target, 'nom', lang) }),
      };
    });
    return { ok: true };
  },
  fade(_def, { actor }) {
    if (!actor) return { ok: false };
    let touched = 0;
    for (const npc of world.npcsByInstance.values()) {
      if (!npc.aggroAgainst?.has(actor)) continue;
      if (getHate(npc, actor) <= 0) continue;
      setHate(npc, actor, 0);
      if (npc.currentTarget === actor) npc.currentTarget = null;
      touched++;
    }
    if (actor.session) {
      const key = touched > 0 ? 'aggro.fade_success' : 'aggro.fade_no_effect';
      actor.session.send({ kind: 'system', tone: touched > 0 ? 'good' : 'flavor', text: s(key, actor.lang) });
    }
    return { ok: true, touched };
  },
  heal({ amount, hp, mp }, { actor, target }) {
    const recipient = target ?? actor;
    if (!recipient.stats) return { hpRestored: 0, mpRestored: 0 };
    const ctx = { actor };
    const hpAmount = Math.max(0, evalAmount(hp ?? amount ?? 0, ctx));
    const mpAmount = Math.max(0, evalAmount(mp ?? 0, ctx));
    const hpBefore = recipient.stats.hp;
    const mpBefore = recipient.stats.mp;
    recipient.stats.hp = Math.min(recipient.stats.hpMax, recipient.stats.hp + hpAmount);
    recipient.stats.mp = Math.min(recipient.stats.mpMax, recipient.stats.mp + mpAmount);
    return {
      hpRestored: recipient.stats.hp - hpBefore,
      mpRestored: recipient.stats.mp - mpBefore,
    };
  },
};

export function applyEffect(effectDef, ctx) {
  if (!effectDef) return null;
  const fn = EFFECTS[effectDef.type];
  if (!fn) return null;
  try {
    return fn(effectDef, ctx);
  } catch (err) {
    console.error(`effect '${effectDef.type}' failed:`, err);
    return null;
  }
}

function actorDisplayName(a, lang) {
  return resolveName(a, 'acc', lang);
}

function healSelfMessage(lang, hp, mp) {
  if (hp > 0 && mp > 0) return s('heal.you_were_restored', lang, { hp, mp });
  if (hp > 0) return s('heal.you_were_healed', lang, { amount: hp });
  if (mp > 0) return s('heal.you_were_refreshed', lang, { amount: mp });
  return null;
}

function healTargetMessage(lang, targetName, hp, mp) {
  if (hp > 0 && mp > 0) return s('heal.you_restored_target', lang, { target: targetName, hp, mp });
  if (hp > 0) return s('heal.you_healed_target', lang, { target: targetName, amount: hp });
  if (mp > 0) return s('heal.you_refreshed_target', lang, { target: targetName, amount: mp });
  return null;
}

export function sendHealFeedback(actor, target, result) {
  const hp = result?.hpRestored ?? 0;
  const mp = result?.mpRestored ?? 0;
  const recipient = target ?? actor;

  if (hp === 0 && mp === 0) {
    actor.session?.send({ kind: 'system', tone: 'flavor', text: s('heal.no_effect', actor.lang) });
    return;
  }
  if (actor !== recipient) {
    const text = healTargetMessage(actor.lang, actorDisplayName(recipient, actor.lang), hp, mp);
    if (text) actor.session?.send({ kind: 'system', tone: 'good', text });
  }
  if (recipient.session) {
    const text = healSelfMessage(recipient.lang, hp, mp);
    if (text) recipient.session.send({ kind: 'system', tone: 'good', text });
  }
  if (actor.kind === 'player') sendStats(actor);
  if (recipient !== actor && recipient.kind === 'player') sendStats(recipient);
}
