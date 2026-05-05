// Per-room exit-lock state. An exit is locked iff its room declares it in `lockedExits`
// and no `unlockExit(roomId, exitKey)` has fired this run.

import { world } from './state.js';

export function unlockExit(roomId, exitKey) {
  world.unlockedExits.add(`${roomId}:${exitKey}`);
}

export function isExitUnlocked(roomId, exitKey) {
  return world.unlockedExits.has(`${roomId}:${exitKey}`);
}

export function isExitLocked(room, exitKey) {
  const locked = room?.lockedExits;
  if (!locked || !(exitKey in locked)) return false;
  return !isExitUnlocked(room.id, exitKey);
}
