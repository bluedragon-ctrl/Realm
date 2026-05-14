// Shared summon engine. Used by:
//   - the `summon` NPC behavior primitive (boss adds)
//   - the `summon` spell effect (player summoning, later)
//
// A summoned NPC is a regular npc instance with extra fields:
//   summoned: true, summonerId, despawnAtTick, despawnText
// These fields are runtime-only; summoned NPCs are never serialized.

import { world, spawnNpc, despawnNpc, findActorById, broadcastToRoom, actorsInRoom } from './world.js';
import { setHate } from './aggro.js';
import { describeRoomToAll } from './actions/look.js';
import { canPerceive } from './perception.js';
import { resolveName } from './declension.js';
import { s, t } from '../i18n.js';
import { getTick } from './clock.js';

export function performSummon(summoner, opts) {
  if (!summoner?.location) return [];
  const def = world.npcDefs.get(opts.defId);
  if (!def) return [];
  const count = Math.max(1, Math.floor(opts.count ?? 1));
  const ttlTicks = Math.max(1, Math.floor(opts.ttlTicks ?? 30));
  const despawnAtTick = getTick() + ttlTicks;
  const summoned = [];
  for (let i = 0; i < count; i++) {
    const npc = spawnNpc(def, summoner.location);
    npc.summoned = true;
    npc.summonerId = summoner.id;
    npc.despawnAtTick = despawnAtTick;
    if (opts.despawnText) npc.despawnText = opts.despawnText;
    inheritHate(summoner, npc);
    summoned.push(npc);
  }
  describeRoomToAll(summoner.location);
  return summoned;
}

// Copy the summoner's positive-hate entries onto the new minion. For an NPC summoner
// this propagates the boss's current hate list. For a player summoner (later), we use
// the player's current `target` as a single seed entry.
function inheritHate(summoner, minion) {
  if (summoner.kind === 'npc' && summoner.aggroAgainst) {
    for (const [actor, hate] of summoner.aggroAgainst) {
      if (hate <= 0) continue;
      if (!actor.session) continue;
      if (!(actor.stats?.hp > 0)) continue;
      setHate(minion, actor, hate);
    }
    if (summoner.currentTarget) minion.currentTarget = summoner.currentTarget;
    return;
  }
  if (summoner.kind === 'player' && summoner.target?.kind === 'npc' && summoner.target.alive !== false) {
    // Reverse seed: minion is hostile to whatever the player is fighting.
    setHate(minion, summoner.target, 100);
    minion.currentTarget = summoner.target;
    minion.disposition = 'hostile';
    minion.aggressive = true;
  }
}

// Per-tick sweep. Despawns summoned NPCs whose TTL elapsed or whose summoner is gone /
// dead. Single source of truth — no death hooks needed.
export function processSummonDespawn() {
  const now = getTick();
  const dying = [];
  for (const npc of world.npcsByInstance.values()) {
    if (!npc.summoned || npc.alive === false) continue;
    if (now >= npc.despawnAtTick) { dying.push(npc); continue; }
    const summoner = findActorById(npc.summonerId);
    if (!summoner || summoner.alive === false || !summoner.location) { dying.push(npc); continue; }
  }
  for (const npc of dying) despawnSummoned(npc);
}

function despawnSummoned(npc) {
  const room = npc.location;
  if (room) {
    broadcastToRoom(room, (recipient) => {
      if (!canPerceive(recipient, npc)) return null;
      const lang = recipient.lang;
      const name = resolveName(npc, 'nom', lang);
      const flavor = npc.despawnText
        ? t(npc.despawnText, lang)
        : s('summon.despawn_default', lang, { name });
      return { kind: 'emote', tone: 'flavor', text: flavor };
    });
  }
  npc.alive = false;
  despawnNpc(npc);
  // Clear stale aggro references on other NPCs in the room.
  if (room) {
    for (const peer of actorsInRoom(room)) {
      if (peer === npc) continue;
      if (peer.kind === 'npc' && peer.aggroAgainst?.has(npc)) {
        peer.aggroAgainst.delete(npc);
      }
      if (peer.currentTarget === npc) peer.currentTarget = null;
    }
    describeRoomToAll(room);
  }
}

// Used by combat death handler to skip respawn enqueue + loot/xp for summons (so the
// kobold chief can't farm xp by summoning sacrificial workers).
export function isSummoned(npc) {
  return !!npc?.summoned;
}

