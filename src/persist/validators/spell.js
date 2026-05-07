import path from 'node:path';
import {
  check, checkRequired, checkEnum, checkLocalizedText, checkObject,
} from '../validate.js';
import { SPELL_TARGETS } from '../../game/contentMeta.js';

export function makeSpellValidator(knownEffects) {
  return (def, file) => {
    const ctx = `spell '${def.id}' (${path.basename(file)})`;
    checkLocalizedText(def.name, ctx, 'name');
    checkObject(def.verb, ctx, 'verb');
    checkRequired(def.verb, ctx, 'verb');
    checkEnum(def.target, SPELL_TARGETS, ctx, 'target');
    if (def.effect?.type === 'apply_effect') {
      const eid = def.effect.effectId;
      check(eid && knownEffects.has(eid), ctx, `applies unknown effect '${eid}'`);
    }
  };
}
