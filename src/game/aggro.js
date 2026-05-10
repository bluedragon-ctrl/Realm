// DikuMUD-style hate table per NPC.
//   npc.aggroAgainst: Map<Actor, number>   (lazy — created on first add)
//   npc.currentTarget: Actor | null        (tie-break preference; sticky combat focus)
//
// Hate accumulates from damage; passive aggression on aggressive NPCs adds +1/tick to
// in-room players. Spells (taunt/pacify/fade) manipulate values directly. Target
// selection picks the highest positive hate in the room, current target keeps ties.
// Onset transitions (non-positive → positive) emit a hook callers can subscribe to.

import { canPerceive } from './perception.js';

const onsetListeners = [];

export function onAggroOnset(fn) {
  onsetListeners.push(fn);
}

function emitOnset(npc, actor) {
  for (const fn of onsetListeners) {
    try { fn(npc, actor); } catch (err) { console.error('aggro onset listener failed:', err); }
  }
}

function ensureTable(npc) {
  if (!npc.aggroAgainst) npc.aggroAgainst = new Map();
  return npc.aggroAgainst;
}

// Reverts disposition/aggressive to def-defaults using the cached snapshot stored on
// the actor at creation time. Avoids importing world.js to keep the aggro module a leaf.
export function restoreDefDisposition(npc) {
  npc.disposition = npc.defDisposition ?? 'neutral';
  npc.aggressive = !!npc.defAggressive;
}

export function getHate(npc, actor) {
  return npc.aggroAgainst?.get(actor) ?? 0;
}

export function hasAggroEntry(npc, actor) {
  return !!npc.aggroAgainst?.has(actor);
}

// Set raw hate value. Returns true if this crossed non-positive → positive
// (the onset transition that triggers the "growls at you" message).
export function setHate(npc, actor, value) {
  const table = ensureTable(npc);
  const before = table.has(actor) ? table.get(actor) : 0;
  table.set(actor, value);
  const onset = before <= 0 && value > 0;
  if (onset) emitOnset(npc, actor);
  return onset;
}

export function addHate(npc, actor, delta) {
  if (!delta) return false;
  return setHate(npc, actor, getHate(npc, actor) + delta);
}

export function removeFromTable(npc, actor) {
  if (!npc.aggroAgainst) return;
  npc.aggroAgainst.delete(actor);
  if (npc.aggroAgainst.size === 0) restoreDefDisposition(npc);
}

export function clearHateTable(npc) {
  if (!npc.aggroAgainst) return;
  npc.aggroAgainst.clear();
  restoreDefDisposition(npc);
}

export function maxHateInRoom(npc) {
  if (!npc.aggroAgainst) return 0;
  let max = 0;
  let seen = false;
  for (const [actor, hate] of npc.aggroAgainst) {
    if (actor.location !== npc.location) continue;
    if (!seen || hate > max) { max = hate; seen = true; }
  }
  return seen ? max : 0;
}

// Pick highest-hate in-room alive perceivable actor. Current target keeps ties.
export function aggroTargetInRoom(npc) {
  if (!npc.aggroAgainst || npc.aggroAgainst.size === 0) return null;
  const current = npc.currentTarget;
  let best = null;
  let bestVal = 0;
  for (const [actor, hate] of npc.aggroAgainst) {
    if (hate <= 0) continue;
    if (actor.location !== npc.location) continue;
    if (!actor.session) continue;
    if (!(actor.stats?.hp > 0)) continue;
    if (!canPerceive(npc, actor)) continue;
    if (hate > bestVal || (hate === bestVal && actor === current)) {
      best = actor;
      bestVal = hate;
    }
  }
  return best;
}

export function hasInRoomTarget(npc) {
  return aggroTargetInRoom(npc) !== null;
}

export function setCurrentTarget(npc, actor) {
  npc.currentTarget = actor;
}

export function clearCurrentTarget(npc) {
  npc.currentTarget = null;
}
