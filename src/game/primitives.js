import { broadcastToRoom, playersInRoom, world, placeActor } from './world.js';
import { transferItem } from './items.js';
import { t, s, pickListIndex, tListAt, dirName } from '../i18n.js';
import { sendStats } from './messages.js';
import { sourceForActor } from './sources.js';
import { executeAttack, aggroTargetInRoom, applyDamageWithFeedback } from './combat.js';
import { describeRoomToAll } from './actions/look.js';
import { runVerb, hasForm, fillPlaceholders } from './verbs.js';
import { applyEffect } from './effects.js';
import { applyActiveEffect } from './activeEffects.js';
import { resolveName } from './declension.js';
import { roll } from './dice.js';

const PRIMITIVES = {
  say(actor, behavior) {
    const idx = pickListIndex(behavior.lines);
    broadcastToRoom(actor.location, (recipient) => {
      const lang = recipient.lang;
      const from = t(actor.name, lang);
      const text = tListAt(behavior.lines, lang, idx);
      return { kind: 'say', source: sourceForActor(actor, recipient), text: s('say.other', lang, { from, text }) };
    });
  },
  emote(actor, behavior) {
    const idx = pickListIndex(behavior.lines);
    broadcastToRoom(actor.location, (recipient) => {
      const lang = recipient.lang;
      const from = t(actor.name, lang);
      const text = tListAt(behavior.lines, lang, idx);
      return { kind: 'emote', source: sourceForActor(actor, recipient), text: s('emote.line', lang, { from, text }) };
    });
  },
  interact(actor, behavior) {
    const players = playersInRoom(actor.location);
    if (players.length === 0) return;
    const targetPlayer = players[Math.floor(Math.random() * players.length)];
    const idx = pickListIndex(behavior.templates);
    broadcastToRoom(actor.location, (recipient) => {
      const lang = recipient.lang;
      const from = t(actor.name, lang);
      const tmpl = tListAt(behavior.templates, lang, idx);
      const filled = fillPlaceholders(tmpl, { actor, target: targetPlayer, lang });
      return { kind: 'emote', text: s('emote.line', lang, { from, text: filled }) };
    });
  },
  give_item(actor, behavior) {
    const givable = (actor.inventory ?? []).filter(i => i.def.pickable !== false);
    if (givable.length === 0) return;
    const players = playersInRoom(actor.location);
    if (players.length === 0) return;
    const inst = givable[Math.floor(Math.random() * givable.length)];
    const targetPlayer = players[Math.floor(Math.random() * players.length)];
    const idx = pickListIndex(behavior.templates);

    transferItem(actor.inventory, targetPlayer.inventory, inst);
    targetPlayer.dirty = true;

    broadcastToRoom(actor.location, (recipient) => {
      const lang = recipient.lang;
      const from = t(actor.name, lang);
      const tmpl = tListAt(behavior.templates, lang, idx);
      const itemName = resolveName(inst.def, 'acc', lang);
      const filled = fillPlaceholders(tmpl, {
        actor, target: targetPlayer, lang, params: { item: itemName },
      });
      return { kind: 'emote', text: s('emote.line', lang, { from, text: filled }) };
    });

    if (targetPlayer.session) {
      const itemName = resolveName(inst.def, 'acc', targetPlayer.lang);
      targetPlayer.session.send({
        kind: 'system',
        text: s('give.you_received', targetPlayer.lang, { item: itemName }),
      });
    }
    sendStats(targetPlayer);
  },
  attack(actor, behavior) {
    const target = aggroTargetInRoom(actor);
    if (!target) return;
    executeAttack(actor, behavior, target);
  },
  flee(actor, behavior) {
    if (actor.alive === false) return;
    const room = world.rooms.get(actor.location);
    const exitKeys = Object.keys(room?.exits ?? {});
    if (exitKeys.length === 0) return;
    const exitKey = exitKeys[Math.floor(Math.random() * exitKeys.length)];
    const targetId = room.exits[exitKey];
    if (!targetId) return;

    const sourceRoom = actor.location;
    const idx = pickListIndex(behavior.templates);
    broadcastToRoom(sourceRoom, (recipient) => {
      const lang = recipient.lang;
      const from = t(actor.name, lang);
      const dir = dirName(exitKey, lang) || exitKey;
      const tmpl = tListAt(behavior.templates, lang, idx);
      const filled = tmpl.replace(/\{actor\}/g, from).replace(/\{direction\}/g, dir);
      return { kind: 'emote', source: sourceForActor(actor, recipient), text: filled };
    });

    placeActor(actor, targetId);
    actor.wasAttacked = false;

    describeRoomToAll(sourceRoom);
    describeRoomToAll(targetId);
  },
  wait() {},
  move(actor, behavior) {
    if (actor.alive === false) return;
    const room = world.rooms.get(actor.location);
    const exitKeys = Object.keys(room?.exits ?? {});
    if (exitKeys.length === 0) return;
    const exitKey = exitKeys[Math.floor(Math.random() * exitKeys.length)];
    const targetId = room.exits[exitKey];
    if (!targetId) return;

    const sourceRoom = actor.location;
    if (behavior.templates) {
      const idx = pickListIndex(behavior.templates);
      broadcastToRoom(sourceRoom, (recipient) => {
        const lang = recipient.lang;
        const from = t(actor.name, lang);
        const dir = dirName(exitKey, lang) || exitKey;
        const tmpl = tListAt(behavior.templates, lang, idx);
        const filled = tmpl.replace(/\{actor\}/g, from).replace(/\{direction\}/g, dir);
        return { kind: 'emote', source: sourceForActor(actor, recipient), text: filled };
      });
    }

    placeActor(actor, targetId);
    describeRoomToAll(sourceRoom);
    describeRoomToAll(targetId);
  },
  cast(actor, behavior) {
    const spell = world.spellDefs?.get(behavior.spell);
    if (!spell) return;
    const mpCost = spell.mpCost ?? 0;
    if ((actor.stats?.mp ?? 0) < mpCost) return;

    let target = actor;
    if (behavior.target === 'aggro_target') {
      target = aggroTargetInRoom(actor);
      if (!target) return;
    }

    const formKey = (target === actor) ? 'no_target' : 'to_target';
    if (!hasForm(spell.verb, 'en', formKey)) return;

    actor.stats.mp = Math.max(0, actor.stats.mp - mpCost);

    runVerb({ actor, def: spell.verb, targetActor: target === actor ? null : target });

    if (spell.effect?.type === 'damage' && target !== actor) {
      const formula = spell.effect.formula ?? spell.effect.amount ?? '1';
      const amount = Math.max(1, roll(formula, { actor, target }));
      applyDamageWithFeedback(actor, target, amount);
      return;
    }
    if (spell.effect?.type === 'apply_effect') {
      applyActiveEffect(target, spell.effect.effectId, 'spell', actor.name);
      if (target.kind === 'player' && target.session) sendStats(target);
      return;
    }
    if (spell.effect) {
      applyEffect(spell.effect, { actor, target });
      if (target.kind === 'player' && target.session) sendStats(target);
    }
  },
};

export function runPrimitive(actor, behavior) {
  const fn = PRIMITIVES[behavior.primitive];
  if (!fn) return;
  try {
    fn(actor, behavior);
  } catch (err) {
    console.error(`primitive '${behavior.primitive}' failed:`, err);
  }
}
