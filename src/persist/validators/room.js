import { check, checkObject } from '../validate.js';

// Cross-room validation: every exit target must exist; lockedExits keys must be exits.
export function validateRoomGraph(rooms) {
  for (const room of rooms.values()) {
    const ctx = `room '${room.id}'`;
    for (const [exitCmd, targetId] of Object.entries(room.exits ?? {})) {
      check(rooms.has(targetId), ctx, `exit '${exitCmd}' -> unknown room '${targetId}'`);
    }
    if (room.lockedExits != null) {
      checkObject(room.lockedExits, ctx, 'lockedExits');
      for (const exitKey of Object.keys(room.lockedExits)) {
        check(exitKey in (room.exits ?? {}), ctx, `lockedExits references unknown exit '${exitKey}'`);
      }
    }
  }
}
