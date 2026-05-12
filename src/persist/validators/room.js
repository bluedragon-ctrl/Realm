import { check, checkObject, checkPositiveInt, checkEnum } from '../validate.js';
import { LIGHT_LEVEL_SET } from '../../game/contentMeta.js';

export function validateRoomGraph(rooms) {
  for (const room of rooms.values()) {
    const ctx = `room '${room.id}'`;
    if (room.lightBase != null) {
      checkEnum(room.lightBase, LIGHT_LEVEL_SET, ctx, 'lightBase');
    }
    if (room.outdoor != null) {
      check(typeof room.outdoor === 'boolean', ctx, `'outdoor' must be a boolean`);
    }
    const exits = room.exits ?? {};
    const hiddenExits = {};
    for (const [exitKey, rawValue] of Object.entries(exits)) {
      if (typeof rawValue === 'string') continue;
      checkObject(rawValue, ctx, `exits.${exitKey}`);
      check(typeof rawValue.to === 'string' && rawValue.to.length > 0, ctx,
        `exits.${exitKey} object form requires string 'to'`);
      if (rawValue.hidden != null) {
        checkObject(rawValue.hidden, ctx, `exits.${exitKey}.hidden`);
        check(rawValue.hidden.dc != null, ctx, `exits.${exitKey}.hidden.dc is required`);
        checkPositiveInt(rawValue.hidden.dc, ctx, `exits.${exitKey}.hidden.dc`);
        check(typeof rawValue.hidden.id === 'string' && rawValue.hidden.id.length > 0,
          ctx, `exits.${exitKey}.hidden.id must be a non-empty string`);
        hiddenExits[exitKey] = { dc: rawValue.hidden.dc, id: rawValue.hidden.id };
      }
      exits[exitKey] = rawValue.to;
    }
    if (Object.keys(hiddenExits).length > 0) room.hiddenExits = hiddenExits;

    for (const [exitCmd, targetId] of Object.entries(exits)) {
      check(rooms.has(targetId), ctx, `exit '${exitCmd}' -> unknown room '${targetId}'`);
    }
    if (room.lockedExits != null) {
      checkObject(room.lockedExits, ctx, 'lockedExits');
      for (const exitKey of Object.keys(room.lockedExits)) {
        check(exitKey in (room.exits ?? {}), ctx, `lockedExits references unknown exit '${exitKey}'`);
      }
    }

    if (room.hiddenFixtures != null) {
      checkObject(room.hiddenFixtures, ctx, 'hiddenFixtures');
      for (const [defId, value] of Object.entries(room.hiddenFixtures)) {
        checkObject(value, ctx, `hiddenFixtures.${defId}`);
        check(value.dc != null, ctx, `hiddenFixtures.${defId}.dc is required`);
        checkPositiveInt(value.dc, ctx, `hiddenFixtures.${defId}.dc`);
        if (value.id != null) {
          check(typeof value.id === 'string' && value.id.length > 0,
            ctx, `hiddenFixtures.${defId}.id must be a non-empty string when set`);
        }
      }
    }

    const secretIds = new Set();
    for (const [exitKey, meta] of Object.entries(room.hiddenExits ?? {})) {
      check(!secretIds.has(meta.id), ctx, `duplicate hidden secret id '${meta.id}' (exit '${exitKey}')`);
      secretIds.add(meta.id);
    }
    for (const [defId, meta] of Object.entries(room.hiddenFixtures ?? {})) {
      const id = meta.id ?? defId;
      check(!secretIds.has(id), ctx, `duplicate hidden secret id '${id}' (fixture '${defId}')`);
      secretIds.add(id);
    }
  }
}
