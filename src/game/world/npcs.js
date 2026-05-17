// NPC spawn / despawn / respawn queue. Respawn handler is set by tick.js so the
// scheduler can react when an NPC re-enters the world without this module knowing about it.

import { world } from './state.js';
import { placeActor } from './actors.js';
import { makeNpcActor } from '../actors.js';
import { registerWanderer, unregisterWanderer } from '../wandering.js';

const npcRespawnQueue = [];
let _onNpcRespawn = null;

export function spawnNpc(def, locationOverride = null) {
  const location = locationOverride ?? def.location;
  const npc = makeNpcActor(def, location);
  world.npcsByInstance.set(npc.instanceId, npc);
  placeActor(npc, location);
  registerWanderer(npc, def);
  return npc;
}

export function despawnNpc(npc) {
  if (npc.location && world.actorsByRoom.has(npc.location)) {
    world.actorsByRoom.get(npc.location).delete(npc);
  }
  world.npcsByInstance.delete(npc.instanceId);
  unregisterWanderer(npc);
}

function spawnPlacements(def) {
  if (def.locations) return Object.entries(def.locations);
  if (def.location) return [[def.location, def.count ?? 1]];
  return [];
}

export function spawnAllNpcs() {
  for (const def of world.npcDefs.values()) {
    if (def.summonOnly) continue;
    if (def.spawn?.requires) continue;
    for (const [roomId, count] of spawnPlacements(def)) {
      for (let i = 0; i < count; i++) spawnNpc(def, roomId);
    }
  }
}

export function despawnAllNpcs() {
  for (const npc of [...world.npcsByInstance.values()]) {
    despawnNpc(npc);
  }
}

export function queueNpcRespawn(defId, ticksFromNow, homeLocation = null) {
  npcRespawnQueue.push({ defId, ticksRemaining: ticksFromNow, homeLocation });
}

export function processNpcRespawns() {
  for (let i = npcRespawnQueue.length - 1; i >= 0; i--) {
    npcRespawnQueue[i].ticksRemaining--;
    if (npcRespawnQueue[i].ticksRemaining > 0) continue;
    const entry = npcRespawnQueue[i];
    const def = world.npcDefs.get(entry.defId);
    npcRespawnQueue.splice(i, 1);
    if (def) {
      const npc = spawnNpc(def, entry.homeLocation);
      _onNpcRespawn?.(npc);
    }
  }
}

export function roomHasHostiles(roomId) {
  const set = world.actorsByRoom.get(roomId);
  if (!set) return false;
  for (const a of set) {
    if (a.kind === 'npc' && a.alive !== false && a.disposition === 'hostile') return true;
  }
  return false;
}

function defHasLiveInstance(defId) {
  for (const npc of world.npcsByInstance.values()) {
    if (npc.summoned) continue;
    if (npc.defId === defId && npc.alive !== false) return true;
  }
  return false;
}

export function processConditionalSpawns() {
  for (const def of world.npcDefs.values()) {
    if (def.summonOnly) continue;
    const cond = def.spawn?.requires;
    if (!cond) continue;
    if (defHasLiveInstance(def.id)) continue;
    if (cond === 'room_clear') {
      for (const [roomId, count] of spawnPlacements(def)) {
        if (roomHasHostiles(roomId)) continue;
        for (let i = 0; i < count; i++) spawnNpc(def, roomId);
      }
    }
  }
}

export function setNpcRespawnHandler(fn) { _onNpcRespawn = fn; }

export function clearNpcRespawnQueue() {
  npcRespawnQueue.length = 0;
}
