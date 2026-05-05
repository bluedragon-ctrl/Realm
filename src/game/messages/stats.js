// `stats` message: the full snapshot the client renders into the player panel.
// Composed from the smaller builders in this folder.

import { t } from '../../i18n.js';
import { getRoom } from '../world.js';
import { serializeActiveEffectsForClient } from '../activeEffects.js';
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
    labels: buildPanelLabels(actor.lang),
    socials: buildSocialButtons(actor.lang),
    inventory: buildInventory(actor),
    knownSpells: buildKnownSpells(actor),
    equipment: buildEquipment(actor),
    activeEffects: serializeActiveEffectsForClient(actor, actor.lang),
  };
}

export function sendStats(actor) {
  if (actor.session) actor.session.send(buildStatsMsg(actor));
}
