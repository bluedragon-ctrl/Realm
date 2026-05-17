// Content-specific reactions to actor lifecycle events. Each block is one mob's reaction
// to its own death, tied to a specific defId. Generic NPC behavior (XP, loot, gold,
// respawn) lives in combat.js's death cascades — this file is for named, content-aware
// hooks. As content scales, this file is the seed of a proper quest engine; for now it's
// the bridge between the event bus and named content.
//
// Imported for side effects from server.js so subscribers register at boot, before the
// first tick fires.

import { actorsInRoom, broadcastToRoom, placeItemInRoom, roomHasHostiles, despawnNpc, world } from './world.js';
import { makeItemInstance } from './items.js';
import { on as onEvent } from './events.js';
import { s } from '../i18n.js';

// --- mine.rat_matriarch ---------------------------------------------------------------
// When the warren's matriarch dies, her summoned children lose discipline and scatter.
// Filtered to summoned rats only so any unrelated wild rats that wandered in (today: not
// possible, but the filter future-proofs against widened spawn locations) survive.
onEvent('npc_died', ({ target, room }) => {
  if (target.defId !== 'mine.rat_matriarch' || !room) return;
  for (const peer of [...actorsInRoom(room)]) {
    if (peer.kind !== 'npc' || peer.alive === false) continue;
    if (!peer.summoned || peer.defId !== 'mine.rat') continue;
    despawnNpc(peer);
  }
  broadcastToRoom(room, (recipient) => ({
    kind: 'emote', tone: 'flavor',
    text: s('quest.matriarch_falls', recipient.lang),
  }));
});

// --- mine.trapped_miner -------------------------------------------------------------
// The miner is gated by `spawn.requires: room_clear` — he appears on the tick after the
// last kobold dies. The polling spawn is fine but offers no moment-of-rescue cue. This
// subscriber pins a flavor line to the exact kill that drops the last hostile, so the
// player hears him before the spawn tick lands.
onEvent('npc_died', ({ target, room }) => {
  if (room !== 'mine.store_room') return;
  if (target.defId === 'mine.trapped_miner') return;
  if (roomHasHostiles(room)) return;
  broadcastToRoom(room, (recipient) => ({
    kind: 'emote', tone: 'flavor',
    text: s('quest.miner_cries', recipient.lang),
  }));
});

// --- village.bat_daemon -------------------------------------------------------------
// Banishing the daemon leaves a fresh bat-bone glyph in the attic so the ritual circle
// can be invoked again. Without this, the daemon is a one-shot tied to a rare loot drop
// elsewhere; with it, the attic becomes a repeatable boss-cycle anchored on its own
// renewable token. handleNpcDeath calls describeRoomToAll AFTER our subscribers, so the
// new glyph appears in the natural room re-render.
onEvent('npc_died', ({ target, room }) => {
  if (target.defId !== 'village.bat_daemon' || !room) return;
  const glyphDef = world.itemDefs.get('item.bat_glyph');
  if (glyphDef) placeItemInRoom(makeItemInstance(glyphDef), room);
  broadcastToRoom(room, (recipient) => ({
    kind: 'emote', tone: 'flavor',
    text: s('quest.bat_daemon_falls', recipient.lang),
  }));
});
