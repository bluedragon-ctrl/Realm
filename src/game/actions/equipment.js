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
  const counts = new Map();
  for (const inst of actor.inventory ?? []) {
    if (!inst.def?.wearable) continue;
    counts.set(inst.defId, (counts.get(inst.defId) ?? 0) + 1);
  }
  if (counts.size > 0) {
    const parts = [];
    for (const [defId, count] of counts) {
      const def = world.itemDefs.get(defId);
      if (!def) continue;
      const name = t(def.name, lang);
      parts.push(count > 1 ? `${name} ×${count}` : name);
    }
    lines.push(s('equipment.in_inventory', lang, { items: parts.join(', ') }));
  }
  actor.session.send({ kind: 'system', text: lines.join('\n') });
}
