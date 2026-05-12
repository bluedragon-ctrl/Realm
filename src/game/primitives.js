import { broadcastToRoom, playersInRoom, world, placeActor } from './world.js';
import { transferItem } from './items.js';
import { t, s, pickListIndex, tListAt, dirName } from '../i18n.js';
import { sendStats } from './messages.js';
import { sourceForActor } from './sources.js';
import { executeAttack, aggroTargetInRoom } from './combat.js';
import { describeRoomToAll } from './actions/look.js';
import { fillPlaceholders } from './verbs.js';
import { resolveName } from './declension.js';
import { castSpell } from './actions/cast.js';
import { isDarkObserver } from './light.js';

const PRIMITIVES = {
  say(actor, behavior) {
    const idx = pickListIndex(behavior.lines);
    broadcastToRoom(actor.location, (recipient) => {
      if (isDarkObserver(recipient)) return null;
      const lang = recipient.lang;
      const from = t(actor.name, lang);
      const text = tListAt(behavior.lines, lang, idx);
      return { kind: 'say', source: sourceForActor(actor, recipient), text: s('say.other', lang, { from, text }) };
    });
  },
  emote(actor, behavior) {
    const idx = pickListIndex(behavior.lines);
    broadcastToRoom(actor.location, (recipient) => {
      if (isDarkObserver(recipient)) return null;
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
      if (isDarkObserver(recipient)) return null;
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
      if (recipient !== targetPlayer && isDarkObserver(recipient)) return null;
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
    actor.currentTarget = target;
    executeAttack(actor, behavior, target);
  },
  flee(actor, behavior) {
    if (actor.alive === false) return;
    movePrimitive(actor, behavior, { mandatoryEmote: true, clearAttacked: true });
  },
  wait() {},
  move(actor, behavior) {
    if (actor.alive === false) return;
    movePrimitive(actor, behavior, { mandatoryEmote: false, clearAttacked: false });
  },
  cast(actor, behavior) {
    const spell = world.spellDefs?.get(behavior.spell);
    if (!spell) return;
    let target = null;
    const effectType = spell.effect?.type;
    const isAoe = effectType === 'damage_room_enemies' || effectType === 'heal_room_friendlies';
    if (!isAoe) {
      if (behavior.target === 'aggro_target') {
        target = aggroTargetInRoom(actor);
        if (!target) return;
      } else {
        target = actor;
      }
    }
    castSpell(actor, spell, target, { silent: true });
  },
};

// Shared move/flee body. Picks a random exit, broadcasts the templated emote (going through
// fillPlaceholders so {actor.gen}/{target.dat} etc. work the same as in any verb form),
// then relocates the NPC and refreshes the two affected rooms.
function movePrimitive(actor, behavior, { mandatoryEmote, clearAttacked }) {
  const room = world.rooms.get(actor.location);
  const exitKeys = Object.keys(room?.exits ?? {});
  if (exitKeys.length === 0) return;
  const exitKey = exitKeys[Math.floor(Math.random() * exitKeys.length)];
  const targetId = room.exits[exitKey];
  if (!targetId) return;

  const sourceRoom = actor.location;
  if (mandatoryEmote || behavior.templates) {
    const idx = pickListIndex(behavior.templates);
    broadcastToRoom(sourceRoom, (recipient) => {
      if (isDarkObserver(recipient)) return null;
      const lang = recipient.lang;
      const from = t(actor.name, lang);
      const dir = dirName(exitKey, lang) || exitKey;
      const tmpl = tListAt(behavior.templates, lang, idx);
      const filled = fillPlaceholders(tmpl, { actor, lang, params: { actor: from, direction: dir } });
      return { kind: 'emote', source: sourceForActor(actor, recipient), text: filled };
    });
  }

  placeActor(actor, targetId);
  if (clearAttacked) actor.wasAttacked = false;

  describeRoomToAll(sourceRoom);
  describeRoomToAll(targetId);
}

export function runPrimitive(actor, behavior) {
  const fn = PRIMITIVES[behavior.primitive];
  if (!fn) return;
  try {
    fn(actor, behavior);
  } catch (err) {
    console.error(`primitive '${behavior.primitive}' failed:`, err);
  }
}
