import path from 'node:path';
import {
  check, checkEnum, checkLocalizedText, checkObject,
} from '../validate.js';
import { EFFECT_KINDS, EFFECT_STACKS, TICK_EFFECT_TYPES } from '../../game/contentMeta.js';

export function validateEffect(def, file) {
  const ctx = `effect '${def.id}' (${path.basename(file)})`;
  checkLocalizedText(def.name, ctx, 'name');
  checkEnum(def.kind, EFFECT_KINDS, ctx, 'kind');
  checkEnum(def.stack, EFFECT_STACKS, ctx, 'stack');
  if (def.tick != null) {
    checkObject(def.tick, ctx, 'tick');
    check(typeof def.tick.every === 'number' && def.tick.every >= 1, ctx, 'tick.every must be a positive number');
    if (def.tick.pulses != null) {
      check(typeof def.tick.pulses === 'number' && def.tick.pulses >= 1, ctx, 'tick.pulses must be a positive number when set');
    }
    checkObject(def.tick.effect, ctx, 'tick.effect');
    check(def.tick.effect && TICK_EFFECT_TYPES.has(def.tick.effect.type), ctx,
      `tick.effect.type must be one of: ${[...TICK_EFFECT_TYPES].join(', ')}`);
  }
  if (def.duration != null) {
    check(typeof def.duration === 'number' && def.duration >= 1 && Number.isInteger(def.duration),
      ctx, 'duration must be a positive integer (ticks)');
  }
  if (def.statMod != null) {
    checkObject(def.statMod, ctx, 'statMod');
    for (const [k, v] of Object.entries(def.statMod)) {
      check(typeof v === 'number', ctx, `statMod.${k} must be a number`);
    }
  }
}
