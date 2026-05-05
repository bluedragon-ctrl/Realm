// NPC spawn / despawn / respawn queue. Respawn handler is set by tick.js so the
// scheduler can react when an NPC re-enters the world without this module knowing about it.

import { world } from './state.js';
import { placeActor } from './actors.js';
import { makeNpcActor } from '../actors.js';

const npcRespawnQueue = [];
let _onNpcRespawn = null;

export function spawnNpc(def) {
  const npc = makeNpcActor(def);
  world.npcsByInstance.set(npc.instanceId, npc);
  placeActor(npc, def.location);
  return npc;
}

export function despawnNpc(npc) {
  if (npc.location && world.actorsByRoom.has(npc.location)) {
    world.actorsByRoom.get(npc.location).delete(npc);
  }
  world.npcsByInstance.delete(npc.instanceId);
}

export function spawnAllNpcs() {
  for (const def of world.npcDefs.values()) {
    const count = def.count ?? 1;
    for (let i = 0; i < count; i++) spawnNpc(def);
  }
}

export function despawnAllNpcs() {
  for (const npc of [...world.npcsByInstance.values()]) {
    despawnNpc(npc);
  }
}

export function queueNpcRespawn(defId, ticksFromNow) {
  npcRespawnQueue.push({ defId, ticksRemaining: ticksFromNow });
}

export function processNpcRespawns() {
  for (let i = npcRespawnQueue.length - 1; i >= 0; i--) {
    npcRespawnQueue[i].ticksRemaining--;
    if (npcRespawnQueue[i].ticksRemaining > 0) continue;
    const def = world.npcDefs.get(npcRespawnQueue[i].defId);
    npcRespawnQueue.splice(i, 1);
    if (def) {
      const npc = spawnNpc(def);
      _onNpcRespawn?.(npc);
    }
  }
}

export function setNpcRespawnHandler(fn) { _onNpcRespawn = fn; }

export function clearNpcRespawnQueue() {
  npcRespawnQueue.length = 0;
}
