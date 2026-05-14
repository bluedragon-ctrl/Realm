import path from 'node:path';
import {
  check, checkRequired, checkEnum, checkLocalizedText,
  checkPositiveInt, checkObject, checkArray, checkLines,
} from '../validate.js';
import { PRIMITIVE_NAMES, DISPOSITIONS, POSITIONS, VISION_KINDS } from '../../game/contentMeta.js';
import { checkOptionalNameForms } from './common.js';

export function makeNpcValidator(knownRooms) {
  return (def, file) => {
    const ctx = `npc '${def.id}' (${path.basename(file)})`;
    checkLocalizedText(def.name, ctx, 'name');
    checkOptionalNameForms(def, ctx);
    if (def.summonOnly === true) {
      check(def.location == null && def.locations == null, ctx,
        `summonOnly defs must omit location and locations (never auto-spawned)`);
      check(def.count == null, ctx, `summonOnly defs must omit count`);
      check(def.respawn == null, ctx, `summonOnly defs must omit respawn (summons are ephemeral)`);
    } else if (def.locations) {
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
    if (def.position != null) {
      checkEnum(def.position, POSITIONS, ctx, 'position');
    }
    if (def.vision != null) {
      checkEnum(def.vision, VISION_KINDS, ctx, 'vision');
    }
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
      if (b.primitive === 'summon') {
        check(typeof b.spawn === 'string' && b.spawn.length > 0, bctx,
          `summon.spawn must be an npc defId`);
        if (b.count != null) {
          check(typeof b.count === 'number' && Number.isInteger(b.count) && b.count >= 1, bctx,
            `summon.count must be a positive integer`);
        }
        check(typeof b.ttlTicks === 'number' && Number.isInteger(b.ttlTicks) && b.ttlTicks >= 1, bctx,
          `summon.ttlTicks must be a positive integer`);
        if (b.despawnText != null) {
          checkLocalizedText(b.despawnText, bctx, 'summon.despawnText');
        }
        if (b.templates != null) checkLines(b.templates, bctx);
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

    if (def.regen != null) {
      checkObject(def.regen, ctx, 'regen');
      for (const key of Object.keys(def.regen)) {
        check(key === 'hp' || key === 'mp', ctx, `regen.${key} is not allowed (only hp, mp)`);
        const v = def.regen[key];
        check(typeof v === 'number' && Number.isInteger(v) && v >= 0, ctx,
          `regen.${key} must be a non-negative integer`);
      }
    }

    check(def.shop == null, ctx, `'shop' is no longer supported — use 'exchanges'`);
  };
}
