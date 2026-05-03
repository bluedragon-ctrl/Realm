import { getRoom, placeActor, broadcastToRoom, isExitLocked } from '../world.js';
import { describeRoom, describeRoomToAll } from './look.js';
import { s, t, dirName } from '../../i18n.js';
import { sendStats } from '../messages.js';
import { clearAggroOnLeave, applyAggressionOnEnter } from '../combat.js';
import { awardXp, markRoomVisited } from '../xp.js';

const DIR_ALIASES = {
  n: 'n', north: 'n',
  s: 's', south: 's',
  e: 'e', east: 'e',
  w: 'w', west: 'w',
  u: 'u', up: 'u',
  d: 'd', down: 'd',
  ne: 'ne', northeast: 'ne',
  nw: 'nw', northwest: 'nw',
  se: 'se', southeast: 'se',
  sw: 'sw', southwest: 'sw',
};

function resolveExit(room, exitInput) {
  const exits = room.exits ?? {};
  if (exits[exitInput]) return exitInput;
  const canonical = DIR_ALIASES[exitInput.toLowerCase()];
  if (canonical && exits[canonical]) return canonical;
  const lower = exitInput.toLowerCase();
  for (const key of Object.keys(exits)) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

export default function move(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('move.no_arg', actor.lang) });
    return;
  }
  const exitInput = args.join(' ');
  const room = getRoom(actor.location);
  if (!room) return;
  const exitKey = resolveExit(room, exitInput);
  if (!exitKey) {
    actor.session.send({ kind: 'error', text: s('move.unknown_exit', actor.lang, { exit: exitInput }) });
    return;
  }
  if (isExitLocked(room, exitKey)) {
    actor.session.send({ kind: 'error', text: s('move.locked', actor.lang) });
    return;
  }
  const targetId = room.exits[exitKey];
  const target = getRoom(targetId);
  if (!target) {
    actor.session.send({ kind: 'error', text: s('move.broken_exit', actor.lang) });
    return;
  }

  const sourceId = room.id;

  broadcastToRoom(sourceId, (recipient) => ({
    kind: 'narration',
    source: 'ambient',
    text: s('narration.leaves', recipient.lang, {
      name: actor.name,
      direction: dirName(exitKey, recipient.lang) || exitKey,
    }),
  }), actor);

  placeActor(actor, targetId);
  actor.dirty = true;
  clearAggroOnLeave(actor, sourceId);
  applyAggressionOnEnter(actor, targetId);

  broadcastToRoom(targetId, (recipient) => ({
    kind: 'narration',
    source: 'ambient',
    text: s('narration.arrives', recipient.lang, { name: actor.name }),
  }), actor);

  actor.session.send({ kind: 'room-transition' });
  describeRoom(actor);
  sendStats(actor);
  const roomName = t(target.name, actor.lang);
  actor.session.send({ kind: 'system', text: s('narration.you_arrive', actor.lang, { room: roomName }) });

  describeRoomToAll(sourceId);
  describeRoomToAll(targetId);

  if (markRoomVisited(actor, targetId)) {
    awardXp(actor, 2, 'discover_room');
  }
}
