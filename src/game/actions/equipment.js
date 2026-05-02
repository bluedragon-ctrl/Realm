import { world } from '../world.js';
import { s, t } from '../../i18n.js';
import { WEARABLE_SLOTS } from '../wearables.js';

export default function equipment(actor) {
  const lang = actor.lang;
  const lines = [s('equipment.header', lang)];
  for (const slot of WEARABLE_SLOTS) {
    const slotName = s(`equipment.slot_${slot}`, lang);
    const defId = actor.record.equipped?.[slot];
    if (defId) {
      const def = world.itemDefs.get(defId);
      const name = def ? t(def.name, lang) : defId;
      lines.push(s('equipment.slot_filled', lang, { slot: slotName, item: name }));
    } else {
      lines.push(s('equipment.slot_empty', lang, { slot: slotName }));
    }
  }
  const equippedSet = new Set(WEARABLE_SLOTS.map(sl => actor.record.equipped?.[sl]).filter(Boolean));
  const knownUnequipped = (actor.record.knownWearables ?? [])
    .filter(id => !equippedSet.has(id))
    .map(id => world.itemDefs.get(id))
    .filter(Boolean);
  if (knownUnequipped.length > 0) {
    lines.push(s('equipment.known_unequipped', lang, {
      items: knownUnequipped.map(d => t(d.name, lang)).join(', '),
    }));
  }
  actor.session.send({ kind: 'system', text: lines.join('\n') });
}
