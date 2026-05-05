// Build the equipment section of the player panel: filled slot list + known-wearable list.

import { t } from '../../i18n.js';
import { world } from '../world.js';
import { WEARABLE_SLOTS } from '../wearableMeta.js';

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
  const known = [];
  for (const id of actor.record.knownWearables ?? []) {
    const def = world.itemDefs.get(id);
    if (!def?.wearable) continue;
    known.push({
      defId: id,
      name: t(def.name, lang),
      slot: def.wearable.slot,
    });
  }
  return { slots, known };
}
