import { world, broadcastToRoom } from '../world.js';
import { roomEnemiesOf, roomFriendliesOf } from '../aoe.js';
import { runVerb, hasForm } from '../verbs.js';
import { applyEffect, sendHealFeedback } from '../effects.js';
import { applyActiveEffect } from '../activeEffects.js';
import { applyDamageWithFeedback, registerAttackAggro, applyHealerAggro } from '../combat.js';
import { roll } from '../dice.js';
import { splitOnKeyword } from '../items.js';
import { s } from '../../i18n.js';
import { sendStats } from '../messages.js';
import { sourceForActor } from '../sources.js';
import { awardXp } from '../xp.js';
import { resolveActorTarget } from '../targeting.js';
import { resolveName, pickByVariants } from '../declension.js';
import { EFFECT_SOURCE, AOE_SPELL_EFFECT_TYPES } from '../contentMeta.js';
import { clearPlayerActionQueue } from '../playerCombatState.js';
import { DEFAULT_COSTS } from '../stats.js';
import { requireStanding } from '../positionGate.js';
import { canPerceive } from '../perception.js';

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

export function findKnownSpell(actor, query) {
  const defs = [];
  for (const id of actor.knownSpells ?? []) {
    const def = world.spellDefs.get(id);
    if (def) defs.push(def);
  }
  return pickByVariants(defs, query, spellNameVariants);
}

// Apply damage to a list of targets with shared resist + AoE-applyEffect handling.
// Used by both single-target and AoE spell paths so all damage flows through one place.
// Returns true if at least one target took damage — callers use this to gate the cast XP
// award so an all-resisted AoE doesn't reward the caster for landing nothing.
function applyDamageToList(actor, spell, targets) {
  const formula = spell.effect.formula ?? spell.effect.amount ?? '1';
  const applyId = spell.effect.applyEffect;
  const damageType = spell.effect.damageType ?? 'magical';
  let anyLanded = false;
  for (const tgt of targets) {
    if (spell.harmful && resists(tgt)) {
      broadcastResist(actor, tgt);
      registerAttackAggro(actor, tgt);
      continue;
    }
    const amount = Math.max(1, roll(formula, { actor, target: tgt }));
    applyDamageWithFeedback(actor, tgt, amount, { damageType });
    anyLanded = true;
    if (applyId && tgt.alive !== false && tgt.stats?.hp > 0) {
      applyActiveEffect(tgt, applyId, EFFECT_SOURCE.SPELL, actor.name);
      if (tgt.kind === 'player' && tgt.session) sendStats(tgt);
    }
  }
  return anyLanded;
}

// Apply a single active-effect buff to a list of targets (AoE friendly buff).
function applyBuffToList(actor, spell, targets) {
  const effectId = spell.effect.effectId;
  if (!effectId) return;
  for (const tgt of targets) {
    applyActiveEffect(tgt, effectId, EFFECT_SOURCE.SPELL, actor.name);
    if (tgt.kind === 'player' && tgt.session) sendStats(tgt);
  }
}

// Apply heal to a list of targets. Returns whether any non-self ally received HP.
function applyHealToList(actor, spell, targets) {
  let healedAlly = false;
  const applyId = spell.effect.applyEffect;
  for (const tgt of targets) {
    const result = applyEffect({ ...spell.effect, type: 'heal' }, { actor, target: tgt });
    const hp = result?.hpRestored ?? 0;
    if (tgt !== actor && hp > 0) healedAlly = true;
    applyHealerAggro(actor, tgt, hp);
    if (applyId) applyActiveEffect(tgt, applyId, EFFECT_SOURCE.SPELL, actor.name);
    if (tgt.kind === 'player' && tgt.session) sendStats(tgt);
  }
  return healedAlly;
}

// Per-effect-type executor. Keyed by `spell.effect.type`. Each executor is called after
// pre-flight (MP, form, perception, MP cost paid, runVerb fired) and after the single-target
// resist gate has had its chance. Return shape `{ healedAlly?, resisted? }` is folded into
// the outer cast result; missing fields default to false.
const SPELL_EXECUTORS = {
  damage_room_enemies(actor, spell, _target, { silent }) {
    const anyLanded = applyDamageToList(actor, spell, roomEnemiesOf(actor));
    if (!silent) sendStats(actor);
    return { resisted: !anyLanded };
  },
  heal_room_friendlies(actor, spell, _target, { silent }) {
    const healedAlly = applyHealToList(actor, spell, roomFriendliesOf(actor));
    if (!silent) sendStats(actor);
    return { healedAlly };
  },
  buff_room_friendlies(actor, spell, _target, { silent }) {
    applyBuffToList(actor, spell, roomFriendliesOf(actor));
    if (!silent) sendStats(actor);
    return {};
  },
  damage(actor, spell, target, ctx) {
    if (!target || target === actor) return executeGeneric(actor, spell, target, ctx);
    if (spell.effect.stat === 'mp') return castMpBurn(actor, spell, target, ctx);
    applyDamageToList(actor, spell, [target]);
    return {};
  },
  apply_effect(actor, spell, target) {
    const recipient = target ?? actor;
    applyActiveEffect(recipient, spell.effect.effectId, EFFECT_SOURCE.SPELL, actor.name);
    // Harmful debuffs need to register aggro just like damaging spells, otherwise
    // landing a curse leaves the caster un-targeted by their victim.
    if (spell.harmful && recipient !== actor) registerAttackAggro(actor, recipient);
    if (recipient.kind === 'player' && recipient.session) sendStats(recipient);
    if (actor !== recipient && actor.kind === 'player') sendStats(actor);
    return {};
  },
  heal(actor, spell, target, { silent }) {
    const result = applyEffect(spell.effect, { actor, target });
    if (!silent) sendHealFeedback(actor, target, result);
    const hp = result?.hpRestored ?? 0;
    applyHealerAggro(actor, target ?? actor, hp);
    return { healedAlly: !!(target && target !== actor && hp > 0) };
  },
  drain(actor, spell, target, { silent }) {
    const result = applyEffect(spell.effect, { actor, target });
    if (!silent) {
      const healed = result?.healed ?? 0;
      if (healed > 0) {
        actor.session?.send({
          kind: 'system', tone: 'good',
          text: s('heal.you_were_healed', actor.lang, { amount: healed }),
        });
      }
      sendStats(actor);
    }
    return {};
  },
};

function castMpBurn(actor, spell, target) {
  const formula = spell.effect.formula ?? spell.effect.amount ?? '1';
  const amount = Math.max(1, roll(formula, { actor, target }));
  // Routes through applyDamageWithFeedback so aggro + sendStats fire consistently with
  // every other combat damage path. applyMpBurn handles the MP-specific narration.
  applyDamageWithFeedback(actor, target, amount, {
    stat: 'mp',
    damageType: spell.effect.damageType ?? 'magical',
  });
  return {};
}

// Fallback for effect types delegated entirely to the EFFECTS registry (cure / fade /
// pacify / summon / taunt) and for damage-on-self/no-target edge cases.
function executeGeneric(actor, spell, target, { silent }) {
  if (!spell.effect) return {};
  applyEffect(spell.effect, { actor, target });
  if (!silent) sendStats(actor);
  return {};
}

// Single shared spell executor. Player command and NPC `cast` primitive both go through
// this so MP/resists/form/effect dispatch stay in one place.
//
//   target     — `null` for AoE / no_target spells, the recipient otherwise (may equal actor).
//   silent     — suppress error sends + post-cast sendStats/XP for headless casters.
//
// Returns { ok, reason } so callers can branch on resist / no-MP without duplicating logic.
export function castSpell(actor, spell, target, { silent = false } = {}) {
  const mpCost = spell.mpCost ?? 0;
  if ((actor.stats?.mp ?? 0) < mpCost) {
    if (!silent) actor.session?.send({ kind: 'error', text: s('cast.no_mp', actor.lang, { mp: mpCost }) });
    return { ok: false, reason: 'no_mp' };
  }

  const effectType = spell.effect?.type;
  const isAoe = AOE_SPELL_EFFECT_TYPES.has(effectType);
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

  // Perception gate (NPC backstop; player path already gated in validateSpellTarget).
  // Self and AoE bypass. AoE = no `target` here, so isToTarget covers the gated cases.
  if (isToTarget && !canPerceive(actor, target)) {
    if (!silent) actor.session?.send({ kind: 'error', text: s('cast.cant_see_target', actor.lang) });
    return { ok: false, reason: 'cant_see_target' };
  }

  actor.stats.mp = Math.max(0, actor.stats.mp - mpCost);
  if (actor.kind === 'player') {
    actor.dirty = true;
    actor.nextActionAt = Date.now() + castCooldownMs(spell, actor);
  }

  // Verb fires before the resist check intentionally: the cast emote is the *attempt*
  // (gesture/incantation), and a subsequent resist broadcast is the *outcome* on impact.
  // Observers see "spark leaps toward goblin" then "fizzles against goblin" — narratively
  // coherent. Don't reorder these without revisiting the resist-message wording.
  runVerb({ actor, def: spell.verb, targetActor: isToTarget ? target : null });

  // Single-target resist gate runs before dispatch so apply_effect debuffs and the
  // single-target damage path both go through it. AoE per-target resist lives inside
  // applyDamageToList.
  let resisted = false;
  let healedAlly = false;
  if (spell.harmful && target && target !== actor && resists(target)) {
    broadcastResist(actor, target);
    registerAttackAggro(actor, target);
    if (!silent) sendStats(actor);
    resisted = true;
  } else {
    const executor = SPELL_EXECUTORS[effectType] ?? executeGeneric;
    const result = executor(actor, spell, target, { silent }) ?? {};
    healedAlly = !!result.healedAlly;
    resisted = !!result.resisted;
  }

  if (!silent && actor.kind === 'player' && !resisted) {
    const castXp = spell.xp ?? 1;
    awardXp(actor, healedAlly ? 2 : castXp, healedAlly ? 'heal_friendly' : 'cast');
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
  if (kind === 'hostile' || kind === 'hostile_room') {
    const gate = requireStanding(actor);
    if (!gate.ok) {
      actor.session.send({ kind: 'error', text: gate.msg });
      return false;
    }
  }
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
    if (!canPerceive(actor, target)) {
      actor.session.send({ kind: 'error', text: s('cast.cant_see_target', actor.lang) });
      return false;
    }
    return true;
  }

  if (kind === 'friendly') {
    if (target && target.kind === 'npc' && target.disposition === 'hostile') {
      actor.session.send({ kind: 'error', text: s('cast.bad_target', actor.lang) });
      return false;
    }
    if (!isSelf && !canPerceive(actor, target)) {
      actor.session.send({ kind: 'error', text: s('cast.cant_see_target', actor.lang) });
      return false;
    }
    return true;
  }

  if (!isSelf && !canPerceive(actor, target)) {
    actor.session.send({ kind: 'error', text: s('cast.cant_see_target', actor.lang) });
    return false;
  }
  return true;
}
