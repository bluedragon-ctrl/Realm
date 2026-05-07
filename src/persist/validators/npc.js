import path from 'node:path';
import {
  check, checkRequired, checkEnum, checkLocalizedText,
  checkPositiveInt, checkObject, checkArray, checkLines,
} from '../validate.js';
import { PRIMITIVE_NAMES, DISPOSITIONS } from '../../game/contentMeta.js';
import { checkOptionalNameForms } from './common.js';

export function makeNpcValidator(knownRooms) {
  return (def, file) => {
    const ctx = `npc '${def.id}' (${path.basename(file)})`;
    checkLocalizedText(def.name, ctx, 'name');
    checkOptionalNameForms(def, ctx);
    if (def.locations) {
      checkObject(def.locations, ctx, 'locations');
      for (const [roomId, n] of Object.entries(def.locations)) {
        check(knownRooms.has(roomId), ctx, `locations key '${roomId}' is not a known room`);
        check(typeof n === 'number' && n >= 1 && Number.isInteger(n), ctx,
          `locations['${roomId}'] must be a positive integer`);
      }
      check(!def.location, ctx, `location and locations are mutually exclusive`);
      check(def.count == null, ctx, `count is not used when locations is set`);
    } else {
      checkRequired(def.location, ctx, 'location');
      check(knownRooms.has(def.location), ctx, `location '${def.location}' is not a known room`);
      checkPositiveInt(def.count, ctx, 'count');
    }
    checkEnum(def.disposition, DISPOSITIONS, ctx, 'disposition');
    if (def.spawn?.requires) {
      check(def.spawn.requires === 'room_clear', ctx,
        `spawn.requires must be 'room_clear' (got '${def.spawn.requires}')`);
    }

    const behaviors = def.behaviors ?? [];
    checkArray(behaviors, ctx, 'behaviors');
    for (const [i, b] of behaviors.entries()) {
      const bctx = `${ctx} behavior #${i}`;
      check(PRIMITIVE_NAMES.has(b.primitive), bctx, `unknown primitive '${b.primitive}'`);
      if (b.primitive === 'say' || b.primitive === 'emote') checkLines(b.lines, bctx);
      if (b.primitive === 'interact' || b.primitive === 'give_item' || b.primitive === 'flee') {
        checkLines(b.templates, bctx);
      }
      if (b.primitive === 'wander') {
        check(typeof b.chance === 'number' && b.chance >= 0 && b.chance <= 1, bctx,
          `wander.chance must be a number between 0 and 1`);
        if (b.scope != null) {
          checkObject(b.scope, bctx, 'wander.scope');
          if (b.scope.region != null) {
            check(typeof b.scope.region === 'string' && b.scope.region.length > 0, bctx,
              `wander.scope.region must be a non-empty string`);
          }
          if (b.scope.tags != null) {
            checkArray(b.scope.tags, bctx, 'wander.scope.tags');
            for (const tag of b.scope.tags) {
              check(typeof tag === 'string' && tag.length > 0, bctx,
                `wander.scope.tags entries must be non-empty strings`);
            }
          }
        }
      }
    }

    check(def.shop == null, ctx, `'shop' is no longer supported — use 'exchanges'`);
  };
}
