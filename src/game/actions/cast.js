import { world, broadcastToRoom } from '../world.js';
import { roomEnemiesOf, roomFriendliesOf } from '../aoe.js';
import { runVerb, hasForm } from '../verbs.js';
import { applyEffect, sendHealFeedback } from '../effects.js';
import { applyActiveEffect } from '../activeEffects.js';
import { applyDamageWithFeedback, registerAttackAggro } from '../combat.js';
import { roll } from '../dice.js';
import { splitOnKeyword } from '../items.js';
import { s, t } from '../../i18n.js';
import { sendStats } from '../messages.js';
import { sourceForActor } from '../sources.js';
import { awardXp } from '../xp.js';
import { resolveActorTarget } from '../targeting.js';
import { resolveName, pickByVariants } from '../declension.js';
import { EFFECT_SOURCE } from '../contentMeta.js';
import { clearPlayerActionQueue } from '../playerCombatState.js';
import { DEFAULT_COSTS } from '../stats.js';

const MAX_RESIST = 95;

function castCooldownMs(spell, actor) {
  const cost = spell.actionCost ?? DEFAULT_COSTS.cast;
  const spd = actor.stats?.spd ?? 6;
  return Math.max(0, Math.round((cost / spd) * 1000));
}

function resists(target) {
  if (!target?.stats) return false;
  const mr = (target.stats.magicResist ?? 0) + (target.stats.int ?? 0);
  const effective = Math.max(0, Math.min(MAX_RESIST, mr));
  if (effective <= 0) return false;
  const r = 1 + Math.floor(Math.random() * 100);
  return r <= effective;
}

function broadcastResist(actor, target) {
  if (actor.session) {
    actor.session.send({
      kind: 'system',
      text: s('cast.resisted_self', actor.lang, { target: resolveName(target, 'dat', actor.lang) }),
    });
  }
  if (target.session && target !== actor) {
    target.session.send({
      kind: 'system',
      text: s('cast.resisted_target', target.lang, { actor: resolveName(actor, 'gen', target.lang) }),
    });
  }
  broadcastToRoom(actor.location, (recipient) => {
    if (recipient === actor || recipient === target) return null;
    return {
      kind: 'emote',
      source: sourceForActor(actor, recipient),
      text: s('cast.resisted_others', recipient.lang, {
        actor: resolveName(actor, 'gen', recipient.lang),
        target: resolveName(target, 'dat', recipient.lang),
      }),
    };
  });
}

function spellNameVariants(def) {
  const out = [def.id.toLowerCase()];
  if (typeof def.name === 'string') out.push(def.name.toLowerCase());
  else if (def.name && typeof def.name === 'object') {
    for (const v of Object.values(def.name)) {
      if (typeof v === 'string') out.push(v.toLowerCase());
    }
  }
  return out;
}

function findKnownSpell(actor, query) {
  const defs = [];
  for (const id of actor.knownSpells ?? []) {
    const def = world.spellDefs.get(id);
    if (def) defs.push(def);
  }
  return pickByVariants(defs, query, spellNameVariants);
}

// Apply damage to a list of targets with shared resist + AoE-applyEffect handling.
// Used by both single-target and AoE spell paths so all damage flows through one place.
function applyDamageToList(actor, spell, targets) {
  const formula = spell.effect.formula ?? spell.effect.amount ?? '1';
  const applyId = spell.effect.applyEffect;
  for (const tgt of targets) {
    if (spell.harmful && resists(tgt)) {
      broadcastResist(actor, tgt);
      registerAttackAggro(actor, tgt);
      continue;
    }
    const amount = Math.max(1, roll(formula, { actor, target: tgt }));
    applyDamageWithFeedback(actor, tgt, amount);
    if (applyId && tgt.alive !== false && tgt.stats?.hp > 0) {
      applyActiveEffect(tgt, applyId, EFFECT_SOURCE.SPELL, actor.name);
      if (tgt.kind === 'player' && tgt.session) sendStats(tgt);
    }
  }
}

// Apply heal to a list of targets. Returns whether any non-self ally received HP.
function applyHealToList(actor, spell, targets) {
  let healedAlly = false;
  const applyId = spell.effect.applyEffect;
  for (const tgt of targets) {
    const result = applyEffect({ ...spell.effect, type: 'heal' }, { actor, target: tgt });
    if (tgt !== actor && (result?.hpRestored ?? 0) > 0) healedAlly = true;
    if (applyId) applyActiveEffect(tgt, applyId, EFFECT_SOURCE.SPELL, actor.name);
    if (tgt.kind === 'player' && tgt.session) sendStats(tgt);
  }
  return healedAlly;
}

// Single shared spell executor. Player command and NPC `cast` primitive both go through
// this so MP/resists/form/effect dispatch stay in one place.
//
//   target     — `null` for AoE / no_target spells, the recipient otherwise (may equal actor).
//   silent     — suppress error sends + post-cast sendStats/XP for headless casters.
//   skipFormCheck — NPC primitive checks `hasForm(spell.verb, 'en', ...)` itself; with
//                  `silent: true` we want a silent fail when the verb form is missing instead of
//                  spamming "you can't cast that".
//
// Returns { ok, reason } so callers can branch on resist / no-MP without duplicating logic.
export function castSpell(actor, spell, target, { silent = false } = {}) {
  const mpCost = spell.mpCost ?? 0;
  if ((actor.stats?.mp ?? 0) < mpCost) {
    if (!silent) actor.session?.send({ kind: 'error', text: s('cast.no_mp', actor.lang, { mp: mpCost }) });
    return { ok: false, reason: 'no_mp' };
  }

  const effectType = spell.effect?.type;
  const isAoe = effectType === 'damage_room_enemies' || effectType === 'heal_room_friendlies';
  const isToTarget = !isAoe && target && target !== actor;
  const formKey = isToTarget ? 'to_target' : 'no_target';
  const lang = silent ? 'en' : actor.lang;
  if (!hasForm(spell.verb, lang, formKey)) {
    if (!silent) actor.session?.send({ kind: 'error', text: s('cast.cant', actor.lang) });
    return { ok: false, reason: 'no_form' };
  }

  if (effectType === 'damage_room_enemies' && roomEnemiesOf(actor).length === 0) {
    if (!silent) actor.session?.send({ kind: 'system', text: s('cast.no_hostiles', actor.lang) });
    return { ok: false, reason: 'no_hostiles' };
  }

  actor.stats.mp = Math.max(0, actor.stats.mp - mpCost);
  if (actor.kind === 'player') actor.dirty = true;

  runVerb({ actor, def: spell.verb, targetActor: isToTarget ? target : null });

  const castXp = spell.xp ?? 1;
  let healedAlly = false;
  let resisted = false;

  if (effectType === 'damage_room_enemies') {
    applyDamageToList(actor, spell, roomEnemiesOf(actor));
    if (!silent) sendStats(actor);
  } else if (effectType === 'heal_room_friendlies') {
    healedAlly = applyHealToList(actor, spell, roomFriendliesOf(actor));
    if (!silent) sendStats(actor);
  } else if (spell.harmful && target && target !== actor && resists(target)) {
    broadcastResist(actor, target);
    registerAttackAggro(actor, target);
    if (!silent) sendStats(actor);
    resisted = true;
  } else if (effectType === 'damage' && target && target !== actor) {
    if (spell.effect.stat === 'mp') {
      const formula = spell.effect.formula ?? spell.effect.amount ?? '1';
      const amount = Math.max(1, roll(formula, { actor, target }));
      const result = applyEffect({ ...spell.effect, amount }, { actor, target });
      registerAttackAggro(actor, target);
      if (!silent) {
        const dealt = result?.dealt ?? 0;
        if (dealt > 0) {
          actor.session?.send({ kind: 'system', tone: 'bad', text: s('combat.you_burned_mp', actor.lang, { target: resolveName(target, 'gen', actor.lang), amount: dealt }) });
          if (target.session && target !== actor) {
            target.session.send({ kind: 'system', tone: 'bad', text: s('combat.target_burned_your_mp', target.lang, { actor: resolveName(actor, 'nom', target.lang), amount: dealt }) });
          }
        }
        sendStats(actor);
      }
    } else {
      applyDamageToList(actor, spell, [target]);
    }
  } else if (effectType === 'apply_effect') {
    const recipient = target ?? actor;
    applyActiveEffect(recipient, spell.effect.effectId, EFFECT_SOURCE.SPELL, actor.name);
    if (recipient.kind === 'player' && recipient.session) sendStats(recipient);
    if (actor !== recipient && actor.kind === 'player') sendStats(actor);
  } else if (spell.effect) {
    const result = applyEffect(spell.effect, { actor, target });
    if (effectType === 'heal') {
      if (!silent) sendHealFeedback(actor, target, result);
      if (target && target !== actor && (result?.hpRestored ?? 0) > 0) healedAlly = true;
    } else if (!silent) {
      sendStats(actor);
    }
  }

  if (!silent && actor.kind === 'player' && !resisted) {
    awardXp(actor, healedAlly ? 2 : castXp, healedAlly ? 'heal_friendly' : 'cast');
  }

  if (actor.kind === 'player') {
    actor.nextActionAt = Date.now() + castCooldownMs(spell, actor);
  }

  return { ok: true, resisted, healedAlly };
}

export default function cast(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('cast.no_arg', actor.lang) });
    return;
  }
  const split = splitOnKeyword(args, 'on');
  const spellQuery = split ? split.before : args.join(' ');
  const targetQuery = split ? split.after : null;

  const spell = findKnownSpell(actor, spellQuery);
  if (!spell) {
    actor.session.send({ kind: 'error', text: s('cast.unknown', actor.lang, { query: spellQuery }) });
    return;
  }

  let target = null;
  if (targetQuery) {
    target = resolveActorTarget(actor, targetQuery);
    if (!target) return;
  }

  if (!validateSpellTarget(actor, spell, target)) return;

  const remaining = (actor.nextActionAt ?? 0) - Date.now();
  if (remaining > 0) {
    clearPlayerActionQueue(actor);
    const timer = setTimeout(() => {
      actor.queuedAction = null;
      let resolvedTarget = null;
      if (targetQuery) {
        resolvedTarget = resolveActorTarget(actor, targetQuery);
        if (!resolvedTarget) return;
      }
      if (!validateSpellTarget(actor, spell, resolvedTarget)) return;
      castSpell(actor, spell, resolvedTarget);
    }, remaining);
    actor.queuedAction = { timer, kind: 'cast' };
    return;
  }

  castSpell(actor, spell, target);
}

function validateSpellTarget(actor, spell, target) {
  const kind = spell.target ?? 'any';
  const isSelf = !target || target === actor;

  if (kind === 'self') {
    if (!isSelf) {
      actor.session.send({ kind: 'error', text: s('cast.bad_target', actor.lang) });
      return false;
    }
    return true;
  }

  if (kind === 'hostile_room') {
    if (target && target !== actor) {
      actor.session.send({ kind: 'error', text: s('cast.bad_target', actor.lang) });
      return false;
    }
    if (roomEnemiesOf(actor).length === 0) {
      actor.session.send({ kind: 'system', text: s('cast.no_hostiles', actor.lang) });
      return false;
    }
    return true;
  }

  if (kind === 'friendly_room') {
    if (target && target !== actor) {
      actor.session.send({ kind: 'error', text: s('cast.bad_target', actor.lang) });
      return false;
    }
    return true;
  }

  if (kind === 'hostile') {
    if (isSelf) {
      actor.session.send({ kind: 'error', text: s('cast.needs_hostile', actor.lang) });
      return false;
    }
    if (target.kind !== 'npc' || target.disposition !== 'hostile') {
      actor.session.send({ kind: 'error', text: s('cast.bad_target', actor.lang) });
      return false;
    }
    return true;
  }

  if (kind === 'friendly') {
    if (target && target.kind === 'npc' && target.disposition === 'hostile') {
      actor.session.send({ kind: 'error', text: s('cast.bad_target', actor.lang) });
      return false;
    }
    return true;
  }

  return true;
}
