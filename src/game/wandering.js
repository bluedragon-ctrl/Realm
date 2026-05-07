// Roaming NPCs (wander behavior). Runs on a separate slow interval rather than the
// per-NPC energy ticker — wander pacing doesn't need precision and we don't want to
// iterate every NPC every second just to roll a low-chance move.

import { broadcastToRoom, placeActor, getRoom } from './world.js';
import { isExitLocked } from './world/exits.js';
import { clearAggroOnLeave } from './combat.js';
import { describeRoomToAll } from './actions/look.js';
import { sourceForActor } from './sources.js';
import { resolveName } from './declension.js';
import { s, dirName } from '../i18n.js';

const WANDER_TICK_MS = 5000;

const OPPOSITE_DIR = {
  n: 's', s: 'n', e: 'w', w: 'e',
  ne: 'sw', sw: 'ne', nw: 'se', se: 'nw',
  u: 'd', d: 'u',
};

const wanderers = new Map();
let timer = null;

export function registerWanderer(npc, def) {
  const wb = (def?.behaviors ?? []).find(b => b.primitive === 'wander');
  if (!wb) return;
  wanderers.set(npc.instanceId, { npc, behavior: wb });
}

export function unregisterWanderer(npc) {
  wanderers.delete(npc.instanceId);
}

export function clearWanderers() {
  wanderers.clear();
}

function destinationsFor(npc, behavior) {
  const room = getRoom(npc.location);
  if (!room) return [];
  const out = [];
  for (const exitKey of Object.keys(room.exits ?? {})) {
    if (isExitLocked(room, exitKey)) continue;
    const destId = room.exits[exitKey];
    const dest = getRoom(destId);
    if (!dest) continue;
    const scope = behavior.scope;
    if (scope) {
      if (scope.region && !destId.startsWith(scope.region + '.')) continue;
      if (scope.tags && scope.tags.length > 0) {
        const destTags = dest.tags ?? [];
        if (!scope.tags.some(tag => destTags.includes(tag))) continue;
      }
    }
    out.push({ exitKey, destId });
  }
  return out;
}

function tryWander(npc, behavior) {
  if (npc.alive === false) return;
  if (npc.aggroAgainst && npc.aggroAgainst.size > 0) return;
  if (Math.random() >= (behavior.chance ?? 0.3)) return;

  const candidates = destinationsFor(npc, behavior);
  if (candidates.length === 0) return;

  const choice = candidates[Math.floor(Math.random() * candidates.length)];
  const sourceRoom = npc.location;
  const exitKey = choice.exitKey;
  const fromKey = OPPOSITE_DIR[exitKey] ?? exitKey;

  broadcastToRoom(sourceRoom, (recipient) => {
    const lang = recipient.lang;
    return {
      kind: 'emote',
      source: sourceForActor(npc, recipient),
      text: s('npc.wander.leaves', lang, {
        actor: resolveName(npc, 'nom', lang),
        dir: dirName(exitKey, lang) || exitKey,
      }),
    };
  });

  placeActor(npc, choice.destId);
  clearAggroOnLeave(npc, sourceRoom);

  broadcastToRoom(choice.destId, (recipient) => {
    const lang = recipient.lang;
    return {
      kind: 'emote',
      source: sourceForActor(npc, recipient),
      text: s('npc.wander.arrives', lang, {
        actor: resolveName(npc, 'nom', lang),
        dir: dirName(fromKey, lang) || fromKey,
      }),
    };
  });

  describeRoomToAll(sourceRoom);
  describeRoomToAll(choice.destId);
}

function onWanderTick() {
  for (const entry of wanderers.values()) {
    try {
      tryWander(entry.npc, entry.behavior);
    } catch (err) {
      console.error(`wander tick failed for npc ${entry.npc.instanceId}:`, err);
    }
  }
}

export function startWanderTick() {
  if (timer) return;
  timer = setInterval(onWanderTick, WANDER_TICK_MS);
}

export function stopWanderTick() {
  if (timer) clearInterval(timer);
  timer = null;
}
