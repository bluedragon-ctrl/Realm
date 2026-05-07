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
import { resolveName } from '../declension.js';

const MAX_RESIST = 95;

function actorDisplayName(a, lang) {
  return resolveName(a, 'nom', lang);
}

function targetDisplayName(target, lang) {
  return resolveName(target, 'acc', lang);
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
  const q = query.toLowerCase();
  let exact = null, sub = null;
  for (const id of actor.knownSpells ?? []) {
    const def = world.spellDefs.get(id);
    if (!def) continue;
    const variants = spellNameVariants(def);
    if (variants.some(v => v === q)) { exact = def; break; }
    if (sub == null && variants.some(v => v.includes(q))) sub = def;
  }
  return exact ?? sub;
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
  const mpCost = spell.mpCost ?? 0;
  if (actor.stats.mp < mpCost) {
    actor.session.send({ kind: 'error', text: s('cast.no_mp', actor.lang, { mp: mpCost }) });
    return;
  }

  let target = null;
  if (targetQuery) {
    target = resolveActorTarget(actor, targetQuery);
    if (!target) return;
  }

  if (!validateSpellTarget(actor, spell, target)) return;

  const formKey = (!target || target === actor) ? 'no_target' : 'to_target';
  if (!hasForm(spell.verb, actor.lang, formKey)) {
    actor.session.send({ kind: 'error', text: s('cast.cant', actor.lang) });
    return;
  }

  actor.stats.mp = Math.max(0, actor.stats.mp - mpCost);
  actor.dirty = true;

  runVerb({ actor, def: spell.verb, targetActor: target });

  const castXp = spell.xp ?? 1;

  if (spell.harmful && target && target !== actor && resists(target)) {
    broadcastResist(actor, target);
    registerAttackAggro(actor, target);
    sendStats(actor);
    return;
  }

  if (spell.effect?.type === 'damage' && target && target !== actor) {
    const formula = spell.effect.formula ?? spell.effect.amount ?? '1';
    const amount = Math.max(1, roll(formula, { actor, target }));
    applyDamageWithFeedback(actor, target, amount);
    awardXp(actor, castXp, 'cast');
    return;
  }

  if (spell.effect?.type === 'damage_room_enemies') {
    const formula = spell.effect.formula ?? spell.effect.amount ?? '1';
    for (const tgt of roomEnemiesOf(actor)) {
      if (spell.harmful && resists(tgt)) {
        broadcastResist(actor, tgt);
        registerAttackAggro(actor, tgt);
        continue;
      }
      const amount = Math.max(1, roll(formula, { actor, target: tgt }));
      applyDamageWithFeedback(actor, tgt, amount);
      if (tgt.alive !== false && tgt.stats?.hp > 0 && spell.effect.applyEffect) {
        applyActiveEffect(tgt, spell.effect.applyEffect, 'spell', actor.name);
      }
    }
    sendStats(actor);
    awardXp(actor, castXp, 'cast');
    return;
  }

  if (spell.effect?.type === 'heal_room_friendlies') {
    const friendlies = roomFriendliesOf(actor);
    let healedAlly = false;
    for (const tgt of friendlies) {
      const result = applyEffect({ ...spell.effect, type: 'heal' }, { actor, target: tgt });
      if (tgt !== actor && (result?.hpRestored ?? 0) > 0) healedAlly = true;
      if (spell.effect.applyEffect) {
        applyActiveEffect(tgt, spell.effect.applyEffect, 'spell', actor.name);
      }
      if (tgt.kind === 'player' && tgt.session) sendStats(tgt);
    }
    sendStats(actor);
    awardXp(actor, healedAlly ? 2 : castXp, healedAlly ? 'heal_friendly' : 'cast');
    return;
  }

  if (spell.effect?.type === 'apply_effect') {
    const recipient = target ?? actor;
    applyActiveEffect(recipient, spell.effect.effectId, 'spell', actor.name);
    if (recipient.kind === 'player' && recipient.session) sendStats(recipient);
    if (actor !== recipient && actor.kind === 'player') sendStats(actor);
    awardXp(actor, castXp, 'cast');
    return;
  }

  const result = applyEffect(spell.effect, { actor, target });
  if (spell.effect?.type === 'heal') {
    sendHealFeedback(actor, target, result);
    if (target && target !== actor && (result?.hpRestored ?? 0) > 0) {
      awardXp(actor, 2, 'heal_friendly');
    } else {
      awardXp(actor, castXp, 'cast');
    }
  } else {
    sendStats(actor);
    awardXp(actor, castXp, 'cast');
  }
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
