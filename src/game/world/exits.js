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

export function checkExitRequirements(room, exitKey, actor) {
  const req = room?.exitRequires?.[exitKey];
  if (!req) return { ok: true };
  if (req.equipped) {
    const equipped = actor?.record?.equipped;
    if (equipped) {
      for (const slot of Object.keys(equipped)) {
        if (equipped[slot] === req.equipped) return { ok: true };
      }
    }
    return { ok: false, missingItem: req.equipped };
  }
  return { ok: true };
}
