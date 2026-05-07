// Actor placement, lookup, and per-room broadcast.
// Actors are players (registered by name) or NPCs (registered by instanceId).

import { world } from './state.js';
import { nameVariants } from '../../i18n.js';
import { allNameVariants, pickByVariants } from '../declension.js';

export function actorsInRoom(roomId) {
  return world.actorsByRoom.get(roomId) ?? new Set();
}

export function placeActor(actor, roomId) {
  if (actor.location && world.actorsByRoom.has(actor.location)) {
    world.actorsByRoom.get(actor.location).delete(actor);
  }
  actor.location = roomId;
  if (!world.actorsByRoom.has(roomId)) world.actorsByRoom.set(roomId, new Set());
  world.actorsByRoom.get(roomId).add(actor);
}

export function removeActor(actor) {
  if (actor.location && world.actorsByRoom.has(actor.location)) {
    world.actorsByRoom.get(actor.location).delete(actor);
  }
  if (actor.kind === 'player') {
    world.actorsByName.delete(actor.name.toLowerCase());
  } else if (actor.kind === 'npc') {
    world.npcsByInstance.delete(actor.instanceId);
  }
}

export function registerActor(actor) {
  if (actor.kind === 'player') {
    world.actorsByName.set(actor.name.toLowerCase(), actor);
  }
}

export function findActor(name) {
  return world.actorsByName.get(name.toLowerCase());
}

export function actorId(actor) {
  if (actor.kind === 'player') return `p:${actor.name.toLowerCase()}`;
  if (actor.kind === 'npc') return `n:${actor.instanceId}`;
  return null;
}

export function findActorById(id) {
  if (typeof id !== 'string') return null;
  const colon = id.indexOf(':');
  if (colon < 0) return null;
  const kind = id.slice(0, colon);
  const key = id.slice(colon + 1);
  if (kind === 'p') return world.actorsByName.get(key) ?? null;
  if (kind === 'n') return world.npcsByInstance.get(Number(key)) ?? null;
  return null;
}

function actorVariants(a) {
  if (a._variants) return a._variants;
  const v = [...allNameVariants(a), ...(a.kind === 'npc' ? nameVariants(a.title) : [])];
  a._variants = v;
  return v;
}

// Invalidate the cached lowercase-variant list for an actor. Call after rename or lang change.
export function invalidateActorVariants(actor) {
  if (actor) actor._variants = null;
}

export function findInRoom(roomId, query) {
  return pickByVariants(actorsInRoom(roomId), query, actorVariants);
}

export function playersInRoom(roomId) {
  const out = [];
  for (const a of actorsInRoom(roomId)) {
    if (a.kind === 'player' && a.session) out.push(a);
  }
  return out;
}

// Send a message to every actor with a session in `roomId`. If `msgOrBuilder` is a function,
// it is invoked per recipient so callers can localize per-language.
export function broadcastToRoom(roomId, msgOrBuilder, except = null) {
  for (const a of actorsInRoom(roomId)) {
    if (a === except) continue;
    if (!a.session) continue;
    let msg;
    try {
      msg = typeof msgOrBuilder === 'function' ? msgOrBuilder(a) : msgOrBuilder;
    } catch (err) {
      console.error(`broadcast builder failed for ${a.name} in ${roomId}:`, err);
      continue;
    }
    if (msg) a.session.send(msg);
  }
}

export function* allActors() {
  for (const a of world.actorsByName.values()) yield a;
  for (const a of world.npcsByInstance.values()) yield a;
}
