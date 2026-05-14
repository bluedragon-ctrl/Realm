import path from 'node:path';
import {
  check, checkRequired, checkEnum, checkLocalizedText, checkObject,
} from '../validate.js';
import { SPELL_TARGETS, AOE_SPELL_EFFECT_TYPES } from '../../game/contentMeta.js';

// Every effect.type a spell may declare. Mirrors the dispatch in
// src/game/effects.js + the AoE branches in cast.js. Add new entries here when a
// new spell-facing effect type is introduced so boot fails loudly on typos.
const VALID_EFFECT_TYPES = new Set([
  'damage',
  'heal',
  'apply_effect',
  'cure',
  'drain',
  'summon',
  'taunt',
  'pacify',
  'fade',
  ...AOE_SPELL_EFFECT_TYPES,
]);

function checkFormula(value, ctx, field) {
  if (typeof value === 'number') return;
  if (typeof value === 'string' && value.trim().length > 0) return;
  throw new Error(`${ctx}: '${field}' must be a non-empty string or number`);
}

export function makeSpellValidator(knownEffects, knownNpcs) {
  const npcs = knownNpcs ?? new Map();
  return (def, file) => {
    const ctx = `spell '${def.id}' (${path.basename(file)})`;
    checkLocalizedText(def.name, ctx, 'name');
    checkObject(def.verb, ctx, 'verb');
    checkRequired(def.verb, ctx, 'verb');
    checkEnum(def.target, SPELL_TARGETS, ctx, 'target');

    checkRequired(def.effect, ctx, 'effect');
    checkObject(def.effect, ctx, 'effect');
    const eff = def.effect;
    check(typeof eff.type === 'string', ctx, `'effect.type' must be a string`);
    check(VALID_EFFECT_TYPES.has(eff.type), ctx, `'effect.type' = '${eff.type}' is not a recognized spell effect`);

    // target / AoE-effect coherence. The runtime branches assume an AoE effect is
    // paired with a room-scoped target enum and vice versa; mismatches would either
    // skip the AoE branch silently or run a no_target verb with a single recipient.
    const isAoe = AOE_SPELL_EFFECT_TYPES.has(eff.type);
    if (isAoe) {
      const expected = eff.type === 'damage_room_enemies' ? 'hostile_room' : 'friendly_room';
      check(def.target === expected, ctx,
        `effect.type '${eff.type}' requires target '${expected}' (got '${def.target}')`);
    } else {
      check(def.target !== 'hostile_room' && def.target !== 'friendly_room', ctx,
        `target '${def.target}' requires an AoE effect.type`);
    }

    if (eff.type === 'apply_effect' || eff.type === 'cure' || eff.type === 'buff_room_friendlies') {
      const eid = eff.effectId;
      check(typeof eid === 'string' && knownEffects.has(eid), ctx,
        `references unknown effect '${eid}'`);
    }

    if (eff.applyEffect != null) {
      check(typeof eff.applyEffect === 'string' && knownEffects.has(eff.applyEffect), ctx,
        `'effect.applyEffect' references unknown effect '${eff.applyEffect}'`);
    }

    if (eff.type === 'damage' || eff.type === 'damage_room_enemies') {
      checkFormula(eff.formula ?? eff.amount, ctx, 'effect.formula');
      if (eff.stat != null) {
        check(eff.stat === 'hp' || eff.stat === 'mp', ctx,
          `'effect.stat' must be 'hp' or 'mp' (got '${eff.stat}')`);
      }
    }

    if (eff.type === 'heal' || eff.type === 'heal_room_friendlies') {
      const hp = eff.hp ?? eff.amount;
      const mp = eff.mp;
      check(hp != null || mp != null, ctx, `heal effect must specify 'amount', 'hp', or 'mp'`);
      if (hp != null) checkFormula(hp, ctx, 'effect.hp/amount');
      if (mp != null) checkFormula(mp, ctx, 'effect.mp');
    }

    if (eff.type === 'drain') {
      checkFormula(eff.formula ?? eff.amount, ctx, 'effect.formula');
    }

    if (eff.type === 'summon') {
      check(typeof eff.defId === 'string' && npcs.has(eff.defId), ctx,
        `summon references unknown npc '${eff.defId}'`);
    }
  };
}
