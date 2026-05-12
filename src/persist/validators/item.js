import path from 'node:path';
import {
  check, checkLocalizedText, checkObject, checkArray, checkEnum,
} from '../validate.js';
import { WEARABLE_SLOT_SET, ALLOWED_BONUS_KEYS, LIGHT_LEVEL_SET } from '../../game/contentMeta.js';
import { checkOptionalNameForms } from './common.js';

export function makeItemValidator(knownRooms, knownEffects) {
  return (def, file) => {
    const ctx = `item '${def.id}' (${path.basename(file)})`;
    checkLocalizedText(def.name, ctx, 'name');
    checkOptionalNameForms(def, ctx);
    if (def.spawn?.location) {
      check(knownRooms.has(def.spawn.location), ctx, `spawn.location '${def.spawn.location}' is not a known room`);
    }
    if (def.spawn?.locations) {
      checkObject(def.spawn.locations, ctx, 'spawn.locations');
      for (const [roomId, n] of Object.entries(def.spawn.locations)) {
        check(knownRooms.has(roomId), ctx, `spawn.locations key '${roomId}' is not a known room`);
        check(typeof n === 'number' && n >= 1 && Number.isInteger(n), ctx,
          `spawn.locations['${roomId}'] must be a positive integer`);
      }
      check(!def.spawn.location, ctx, `spawn.location and spawn.locations are mutually exclusive`);
    }
    if (def.wearable != null) {
      checkObject(def.wearable, ctx, 'wearable');
      check(WEARABLE_SLOT_SET.has(def.wearable.slot), ctx,
        `wearable.slot must be one of: ${[...WEARABLE_SLOT_SET].join(', ')}`);
      const bonus = def.wearable.bonus ?? {};
      checkObject(bonus, ctx, 'wearable.bonus');
      for (const [k, v] of Object.entries(bonus)) {
        check(ALLOWED_BONUS_KEYS.has(k), ctx,
          `wearable.bonus has unknown stat '${k}' (allowed: ${[...ALLOWED_BONUS_KEYS].join(', ')})`);
        check(typeof v === 'number', ctx, `wearable.bonus.${k} must be a number`);
      }
      if (def.wearable.effects != null) {
        checkArray(def.wearable.effects, ctx, 'wearable.effects');
        for (const eid of def.wearable.effects) {
          check(typeof eid === 'string' && knownEffects.has(eid), ctx,
            `wearable.effects references unknown effect '${eid}'`);
        }
      }
      if (def.wearable.onHit != null) {
        const hits = Array.isArray(def.wearable.onHit) ? def.wearable.onHit : [def.wearable.onHit];
        for (const hit of hits) {
          checkObject(hit, ctx, 'wearable.onHit');
          if (hit.applyEffect != null) {
            check(typeof hit.applyEffect === 'string' && knownEffects.has(hit.applyEffect), ctx,
              `wearable.onHit.applyEffect references unknown effect '${hit.applyEffect}'`);
          } else {
            check(hit.effect != null && typeof hit.effect === 'object' && typeof hit.effect.type === 'string', ctx,
              `wearable.onHit entry must have either 'applyEffect' (active effect id) or 'effect' (inline effect object with type)`);
          }
        }
      }
      if (def.wearable.damage != null) {
        check(def.wearable.slot === 'weapon', ctx,
          `wearable.damage is only valid on weapons (slot=weapon)`);
        check(typeof def.wearable.damage === 'string' && def.wearable.damage.length > 0, ctx,
          `wearable.damage must be a non-empty dice formula string`);
      }
      if (def.wearable.cost != null) {
        check(def.wearable.slot === 'weapon', ctx,
          `wearable.cost is only valid on weapons (slot=weapon)`);
        check(Number.isInteger(def.wearable.cost) && def.wearable.cost > 0, ctx,
          `wearable.cost must be a positive integer`);
      }
    }
    if (def.lightSource != null) {
      checkObject(def.lightSource, ctx, 'lightSource');
      checkEnum(def.lightSource.level, LIGHT_LEVEL_SET, ctx, 'lightSource.level');
    }
    if (def.use?.effect?.type === 'apply_effect') {
      const eid = def.use.effect.effectId;
      check(eid && knownEffects.has(eid), ctx, `use.effect references unknown effect '${eid}'`);
    }
  };
}

export function validateItemInteractions(items, knownRooms) {
  for (const def of items.values()) {
    const ctx = `item '${def.id}'`;
    if (def.unlocks != null) {
      const u = def.unlocks;
      checkObject(u, ctx, 'unlocks');
      check(typeof u.exit === 'string', ctx, 'unlocks.exit must be a string');
      check(u.key && items.has(u.key), ctx, `unlocks.key references unknown item '${u.key}'`);
      checkObject(u.verb, ctx, 'unlocks.verb');
      const roomId = def.spawn?.location;
      if (roomId) {
        const room = knownRooms.get(roomId);
        const declared = room?.lockedExits?.[u.exit];
        check(declared === def.id, ctx,
          `unlocks exit '${u.exit}' but room '${roomId}' lockedExits.${u.exit} = ${JSON.stringify(declared ?? null)} (expected '${def.id}')`);
      }
    }
    check(def.recipes == null, ctx, `'recipes' is no longer supported — use 'exchanges'`);
  }
}
