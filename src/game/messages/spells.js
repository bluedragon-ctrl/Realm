// Build the spellbook list shown in the player panel.

import { t, s } from '../../i18n.js';
import { world } from '../world.js';

export function buildKnownSpells(actor) {
  const out = [];
  for (const id of actor.knownSpells ?? []) {
    const def = world.spellDefs.get(id);
    if (!def) continue;
    out.push({
      id: def.id,
      name: t(def.name, actor.lang),
      mpCost: def.mpCost ?? 0,
      target: def.target ?? 'any',
      targetLabel: s(`spells.target.${def.target ?? 'any'}`, actor.lang),
      category: def.category ?? null,
      description: def.description ? t(def.description, actor.lang) : '',
    });
  }
  return out;
}
