// Public surface for the world module. Implementation is split under world/ by concern:
//   world/state.js   — the `world` object, START_ROOM, getRoom, isAdmin
//   world/exits.js   — per-room exit lock/unlock state
//   world/actors.js  — actor placement, lookup, per-room broadcast
//   world/items.js   — floor items + spawn/respawn + cap accounting
//   world/npcs.js    — NPC spawn/despawn + respawn queue
//   world/load.js    — boot orchestration

export { world, START_ROOM, RESPAWN_ROOM, getRoom, isAdmin } from './world/state.js';
export { unlockExit, isExitUnlocked, isExitLocked } from './world/exits.js';
export {
  actorsInRoom, placeActor, removeActor, registerActor,
  findActor, findInRoom, playersInRoom, broadcastToRoom, allActors,
  invalidateActorVariants,
} from './world/actors.js';
export {
  itemsInRoom, placeItemInRoom, removeItemFromRoom,
  countItemsInWorldMemory, countItemsInRoomMemory,
  spawnAllItems, respawnItemsTick,
  getGoldInRoom, addGoldToRoom, takeGoldFromRoom, clearGoldInRoom,
} from './world/items.js';
export {
  spawnNpc, despawnNpc, spawnAllNpcs, despawnAllNpcs,
  queueNpcRespawn, processNpcRespawns, processConditionalSpawns, setNpcRespawnHandler, clearNpcRespawnQueue,
} from './world/npcs.js';
export { loadWorld } from './world/load.js';
