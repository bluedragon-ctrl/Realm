// `stats` message: the full snapshot the client renders into the player panel.
// Composed from the smaller builders in this folder.

import { t } from '../../i18n.js';
import { getRoom, world } from '../world.js';
import { serializeActiveEffectsForClient } from '../activeEffects.js';
import { freePointsPhrase } from '../format.js';

function buildWearableOnHitEffects(actor, lang) {
  const out = [];
  const equipped = actor.record?.equipped ?? {};
  for (const slot of Object.keys(equipped)) {
    const defId = equipped[slot];
    if (!defId) continue;
    const onHit = world.itemDefs.get(defId)?.wearable?.onHit;
    if (!onHit) continue;
    const hits = Array.isArray(onHit) ? onHit : [onHit];
    for (const hit of hits) {
      const effDef = world.effectDefs.get(hit.applyEffect);
      if (!effDef) continue;
      const chance = hit.chance ?? 1;
      out.push({
        defId: hit.applyEffect,
        name: t(effDef.name, lang),
        icon: effDef.icon ?? '',
        kind: effDef.kind ?? 'neutral',
        source: `onhit:${defId}`,
        chancePct: Math.round(chance * 100),
      });
    }
  }
  return out;
}
import { xpToNext } from '../xp.js';
import { buildInventory } from './inventory.js';
import { buildEquipment } from './equipment.js';
import { buildKnownSpells } from './spells.js';
import { buildSocialButtons } from './socials.js';
import { buildPanelLabels } from './labels.js';

export function buildStatsMsg(actor) {
  const room = getRoom(actor.location);
  return {
    kind: 'stats',
    name: actor.name,
    isAdmin: !!actor.isAdmin,
    lang: actor.lang,
    location: room ? t(room.name, actor.lang) : actor.location,
    locationId: actor.location,
    stats: { ...actor.stats },
    level: actor.record.level ?? 1,
    xp: actor.record.xp ?? 0,
    xpToNext: xpToNext(actor.record.level ?? 1),
    gold: actor.gold ?? 0,
    unspentPoints: actor.record?.unspentPoints ?? 0,
    unspentPointsPhrase: freePointsPhrase(actor.record?.unspentPoints ?? 0, actor.lang),
    allocated: { ...(actor.record?.allocated ?? {}) },
    labels: buildPanelLabels(actor.lang),
    socials: buildSocialButtons(actor.lang),
    inventory: buildInventory(actor),
    knownSpells: buildKnownSpells(actor),
    equipment: buildEquipment(actor),
    activeEffects: [
      ...serializeActiveEffectsForClient(actor, actor.lang),
      ...buildWearableOnHitEffects(actor, actor.lang),
    ],
    actionCooldownMs: Math.max(0, (actor.nextActionAt ?? 0) - Date.now()),
    queuedAction: actor.queuedAction?.kind ?? null,
  };
}

export function sendStats(actor) {
  if (actor.session) actor.session.send(buildStatsMsg(actor));
}
