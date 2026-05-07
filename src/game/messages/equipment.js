// Build the equipment section of the player panel: filled slot list + wearables-in-inventory list.

import { t } from '../../i18n.js';
import { world } from '../world.js';
import { WEARABLE_SLOTS } from '../contentMeta.js';

export function buildEquipment(actor) {
  const lang = actor.lang;
  const slots = WEARABLE_SLOTS.map(slot => {
    const defId = actor.record.equipped?.[slot];
    if (!defId) return { slot, defId: null, name: null };
    const def = world.itemDefs.get(defId);
    return {
      slot,
      defId,
      name: def ? t(def.name, lang) : defId,
    };
  });
  const counts = new Map();
  for (const inst of actor.inventory ?? []) {
    if (!inst.def?.wearable) continue;
    counts.set(inst.defId, (counts.get(inst.defId) ?? 0) + 1);
  }
  const inInventory = [];
  for (const [defId, count] of counts) {
    const def = world.itemDefs.get(defId);
    if (!def?.wearable) continue;
    inInventory.push({
      defId,
      name: t(def.name, lang),
      slot: def.wearable.slot,
      count,
    });
  }
  return { slots, inInventory };
}
