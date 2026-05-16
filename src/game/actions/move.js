import { world, getRoom, placeActor, broadcastToRoom, isExitLocked, checkExitRequirements, actorsInRoom } from '../world.js';
import { describeRoom, describeRoomToAll } from './look.js';
import { s, t, dirName } from '../../i18n.js';
import { sendStats } from '../messages.js';
import { clearAggroOnLeave, applyAggressionOnEnter } from '../combat.js';
import { clearPlayerActionQueue } from '../playerCombatState.js';
import { awardXp, markRoomVisited } from '../xp.js';
import { requireStanding } from '../positionGate.js';
import { canPerceiveRoom } from '../light.js';
import { canPerceive } from '../perception.js';

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

function resolveExit(room, exitInput, actor) {
  const exits = room.exits ?? {};
  const hidden = room.hiddenExits ?? {};
  const foundSecrets = new Set(actor.record?.foundSecrets ?? []);
  const visible = (k) => !hidden[k] || foundSecrets.has(hidden[k].id);
  if (exits[exitInput] && visible(exitInput)) return exitInput;
  const canonical = DIR_ALIASES[exitInput.toLowerCase()];
  if (canonical && exits[canonical] && visible(canonical)) return canonical;
  const lower = exitInput.toLowerCase();
  for (const key of Object.keys(exits)) {
    if (key.toLowerCase() === lower && visible(key)) return key;
  }
  return null;
}

export default function move(actor, args) {
  const gate = requireStanding(actor);
  if (!gate.ok) {
    actor.session?.send({ kind: 'error', text: gate.msg });
    return;
  }
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('move.no_arg', actor.lang) });
    return;
  }
  const exitInput = args.join(' ');
  const room = getRoom(actor.location);
  if (!room) return;
  const exitKey = resolveExit(room, exitInput, actor);
  if (!exitKey) {
    actor.session.send({ kind: 'error', text: s('move.unknown_exit', actor.lang, { exit: exitInput }) });
    return;
  }
  if (isExitLocked(room, exitKey)) {
    actor.session.send({ kind: 'error', text: s('move.locked', actor.lang) });
    return;
  }
  const req = checkExitRequirements(room, exitKey, actor);
  if (!req.ok) {
    const def = world.itemDefs.get(req.missingItem);
    const itemName = def ? t(def.name, actor.lang) : req.missingItem;
    actor.session.send({ kind: 'error', text: s('move.need_equipped', actor.lang, { item: itemName }) });
    return;
  }
  const targetId = room.exits[exitKey];
  const target = getRoom(targetId);
  if (!target) {
    actor.session.send({ kind: 'error', text: s('move.broken_exit', actor.lang) });
    return;
  }

  const sourceId = room.id;

  const followers = [];
  for (const a of actorsInRoom(sourceId)) {
    if (a !== actor && a.following === actor.id) followers.push(a);
  }

  broadcastToRoom(sourceId, (recipient) => {
    if (!canPerceive(recipient, actor)) return null;
    return {
      kind: 'emote',
      source: 'ambient',
      text: s('narration.leaves', recipient.lang, {
        name: actor.name,
        direction: dirName(exitKey, recipient.lang) || exitKey,
      }),
    };
  }, actor);

  placeActor(actor, targetId);
  actor.dirty = true;
  clearPlayerActionQueue(actor);
  clearAggroOnLeave(actor, sourceId);
  applyAggressionOnEnter(actor, targetId);

  broadcastToRoom(targetId, (recipient) => {
    if (!canPerceive(recipient, actor)) return null;
    return {
      kind: 'emote',
      source: 'ambient',
      text: s('narration.arrives', recipient.lang, { name: actor.name }),
    };
  }, actor);

  if (actor.session) {
    actor.session.send({ kind: 'room-transition' });
    describeRoom(actor);
    sendStats(actor);
    if (canPerceiveRoom(actor, target) === 'dark') {
      actor.session.send({ kind: 'system', text: s('narration.you_arrive_dark', actor.lang) });
    } else {
      const roomName = t(target.name, actor.lang);
      actor.session.send({ kind: 'system', text: s('narration.you_arrive', actor.lang, { room: roomName }) });
    }
  }

  describeRoomToAll(sourceId);
  describeRoomToAll(targetId);

  for (const f of followers) {
    if (f.location !== sourceId) continue;
    if (f.kind === 'npc' && f.alive === false) continue;
    move(f, [exitKey]);
  }

  if (actor.kind === 'player' && markRoomVisited(actor, targetId)) {
    awardXp(actor, 2, 'discover_room');
  }
}
