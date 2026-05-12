// Build the inventory section of the player panel.
// Identical (defId + state) instances are grouped with a count to keep the UI compact.

import { t } from '../../i18n.js';

function stateKey(state) {
  if (!state || Object.keys(state).length === 0) return '';
  return JSON.stringify(state);
}

export function buildInventory(actor) {
  const groups = new Map();
  for (const inst of actor.inventory) {
    const key = `${inst.defId}:${stateKey(inst.state)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
    } else {
      const use = inst.def.use;
      const wearable = inst.def.wearable;
      const tags = Array.isArray(inst.def.tags) ? inst.def.tags : [];
      groups.set(key, {
        instanceId: inst.instanceId,
        defId: inst.defId,
        name: t(inst.def.name, actor.lang),
        count: 1,
        usable: !!use,
        consumable: !!(use && use.consumable),
        wearable: !!wearable,
        slot: wearable?.slot ?? null,
        isKey: tags.includes('key'),
      });
    }
  }
  return [...groups.values()];
}
