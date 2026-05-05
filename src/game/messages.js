// Public surface for the messages module. Implementation split under messages/ by section:
//   messages/stats.js     — buildStatsMsg, sendStats (top-level composer)
//   messages/inventory.js — buildInventory
//   messages/equipment.js — buildEquipment
//   messages/spells.js    — buildKnownSpells
//   messages/socials.js   — buildSocialButtons + cache
//   messages/labels.js    — buildPanelLabels (all static UI strings)

export { buildStatsMsg, sendStats } from './messages/stats.js';
export { clearSocialButtonCache } from './messages/socials.js';
