// Actor placement, lookup, and per-room broadcast.
// Actors are players (registered by name) or NPCs (registered by instanceId).

import { world } from './state.js';
import { nameVariants } from '../../i18n.js';
import { allNameVariants } from '../declension.js';

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

function actorVariants(a) {
  return [...allNameVariants(a), ...(a.kind === 'npc' ? nameVariants(a.title) : [])];
}

export function findInRoom(roomId, query) {
  const q = query.toLowerCase();
  let exact = null, sub = null, word = null;
  for (const a of actorsInRoom(roomId)) {
    const variants = actorVariants(a);
    for (const v of variants) {
      if (v === q) { exact = a; break; }
    }
    if (exact) break;
    if (sub == null && variants.some(v => v.includes(q))) sub = a;
    if (word == null && variants.some(v => v.split(/\s+/).some(w => w === q))) word = a;
  }
  return exact ?? sub ?? word ?? null;
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
