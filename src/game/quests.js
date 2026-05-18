// Data-driven quest engine. Quest defs live in `content/quests/<id>.json` and load into
// `world.questDefs`. Per-player progress lives in `actor.record.quests[questId]`:
//
//   { status: "active" | "complete", objectives: { <objId>: counter, ... },
//     startedAt: <ms>, completedAt: <ms|null> }
//
// The engine subscribes once to each lifecycle event (npc_died, item_picked_up,
// room_entered) and walks every relevant online player's quest table. Discovery is
// automatic — players never `accept`; the first matching event silently starts the quest
// and re-progresses with the same event so a single action can both discover and advance.
//
// Credit model:
//   - Room-scoped events (`kill`, `room_clear`) credit every online player in the death
//     room with the quest active. Matches the existing miner content (the spawn doesn't
//     care who landed the last blow).
//   - Player-scoped events (`enter_room`, `pickup_item`) credit only the acting player.
//
// Imported for side effects from server.js so subscribers register at boot, before the
// first tick fires. The hand-coded flavor-line subscribers (matriarch silence, miner cries,
// bat-glyph drop) stay at the bottom of the file — they are room broadcasts, not quest
// mechanics, and remain useful even when no player has the quest active.

import { actorsInRoom, broadcastToRoom, placeItemInRoom, roomHasHostiles, despawnNpc, world } from './world.js';
import { makeItemInstance } from './items.js';
import { on as onEvent, emit as emitEvent } from './events.js';
import { addToInventory, removeFromInventory } from './inventory.js';
import { awardXp } from './xp.js';
import { sendStats } from './messages.js';
import { resolveName } from './declension.js';
import { sourceForActor } from './sources.js';
import { isExchangeAvailable } from './exchangeGate.js';
import { s, t } from '../i18n.js';

function requiredCount(objective) {
  return objective.count ?? 1;
}

function isObjectiveComplete(objective, progress) {
  return (progress[objective.id] ?? 0) >= requiredCount(objective);
}

function isQuestComplete(def, progress) {
  return def.objectives.every(o => isObjectiveComplete(o, progress));
}

function ensureRecord(actor) {
  if (!actor.record.quests || typeof actor.record.quests !== 'object') {
    actor.record.quests = {};
  }
  return actor.record.quests;
}

function discover(actor, def) {
  const quests = ensureRecord(actor);
  if (quests[def.id]) return false;
  const objectives = {};
  for (const o of def.objectives) objectives[o.id] = 0;
  quests[def.id] = {
    status: 'active',
    objectives,
    startedAt: Date.now(),
    completedAt: null,
  };
  actor.dirty = true;
  if (actor.session) {
    actor.session.send({
      kind: 'system', tone: 'good',
      text: s('quest.discovered', actor.lang, { name: t(def.name, actor.lang) }),
    });
  }
  return true;
}

function matchesDiscovery(def, eventName, ctx) {
  const disc = def.discovery;
  if (!disc) return false;
  if (disc.type === 'enter_room' && eventName === 'room_entered') {
    return ctx.room === disc.room;
  }
  if (disc.type === 'kill' && eventName === 'npc_died') {
    return ctx.target?.defId === disc.defId;
  }
  if (disc.type === 'pickup_item' && eventName === 'item_picked_up') {
    return ctx.defId === disc.defId;
  }
  return false;
}

function objectiveMatch(objective, eventName, ctx) {
  if (objective.type === 'enter_room' && eventName === 'room_entered') {
    return ctx.room === objective.room ? 1 : 0;
  }
  if (objective.type === 'kill' && eventName === 'npc_died') {
    return ctx.target?.defId === objective.defId ? 1 : 0;
  }
  if (objective.type === 'room_clear' && eventName === 'npc_died') {
    if (ctx.room !== objective.room) return 0;
    return roomHasHostiles(ctx.room) ? 0 : 1;
  }
  if (objective.type === 'pickup_item' && eventName === 'item_picked_up') {
    return ctx.defId === objective.defId ? (ctx.count ?? 1) : 0;
  }
  if (objective.type === 'deliver_item' && eventName === 'item_given') {
    if (ctx.defId !== objective.defId) return 0;
    if (ctx.recipient?.defId !== objective.recipient) return 0;
    return ctx.count ?? 1;
  }
  return 0;
}

function grantRewards(actor, def) {
  const rewards = def.rewards;
  if (!rewards) return;
  if (rewards.gold && rewards.gold > 0) {
    actor.gold = (actor.gold ?? 0) + rewards.gold;
    actor.dirty = true;
  }
  if (Array.isArray(rewards.items)) {
    for (const itemId of rewards.items) {
      const itemDef = world.itemDefs.get(itemId);
      if (itemDef) addToInventory(actor, makeItemInstance(itemDef));
    }
  }
  if (rewards.xp && rewards.xp > 0) {
    // awardXp calls sendStats; keep it last so the final HUD frame includes any
    // gold/item changes from the rewards above.
    awardXp(actor, rewards.xp, 'quest');
  } else if (actor.session) {
    sendStats(actor);
  }
}

// Walk every NPC def for exchanges gated on this quest. An entry "matches" the change we
// just made when its `requires` either targets the just-completed objective (objective
// unlock) or fires on `status: "complete"` and no specific objective was named (whole-quest
// unlock). One toast per affected NPC, listing them in a single line so a multi-step quest
// completion doesn't spam the console.
function announceNewOffers(actor, def, completedObjectiveId) {
  if (!actor.session) return;
  const names = new Set();
  for (const npcDef of world.npcDefs.values()) {
    if (!Array.isArray(npcDef.exchanges)) continue;
    for (const ex of npcDef.exchanges) {
      const req = ex.requires;
      if (!req || req.quest !== def.id) continue;
      const matchedStatus = req.status === 'complete' && completedObjectiveId == null;
      const matchedObjective = req.objective && req.objective === completedObjectiveId;
      if (!matchedStatus && !matchedObjective) continue;
      if (!isExchangeAvailable(actor, ex)) continue;
      names.add(t(npcDef.name, actor.lang));
      break;
    }
  }
  if (names.size === 0) return;
  actor.session.send({
    kind: 'system', tone: 'good',
    text: s('quest.unlock_offers', actor.lang, { npcs: [...names].join(', ') }),
  });
}

function completeQuest(actor, def) {
  const entry = actor.record.quests[def.id];
  entry.status = 'complete';
  entry.completedAt = Date.now();
  actor.dirty = true;
  if (actor.session) {
    actor.session.send({
      kind: 'system', tone: 'levelup',
      text: s('quest.completed', actor.lang, { name: t(def.name, actor.lang) }),
    });
  }
  grantRewards(actor, def);
  announceNewOffers(actor, def, null);
}

function advanceObjective(actor, def, objective, amount) {
  const entry = actor.record.quests[def.id];
  if (!entry || entry.status !== 'active') return false;
  const wasComplete = isObjectiveComplete(objective, entry.objectives);
  if (wasComplete) return false;
  entry.objectives[objective.id] = (entry.objectives[objective.id] ?? 0) + amount;
  actor.dirty = true;
  const nowComplete = isObjectiveComplete(objective, entry.objectives);
  if (actor.session && nowComplete) {
    actor.session.send({
      kind: 'system', tone: 'good',
      text: s('quest.objective_complete', actor.lang, {
        quest: t(def.name, actor.lang),
        objective: t(objective.desc, actor.lang),
      }),
    });
    announceNewOffers(actor, def, objective.id);
  } else if (actor.session) {
    const required = requiredCount(objective);
    if (required > 1) {
      actor.session.send({
        kind: 'system',
        text: s('quest.objective_progress', actor.lang, {
          quest: t(def.name, actor.lang),
          objective: t(objective.desc, actor.lang),
          current: entry.objectives[objective.id],
          total: required,
        }),
      });
    }
  }
  return true;
}

function progressQuestFor(actor, def, eventName, ctx) {
  const entry = actor.record.quests[def.id];
  if (!entry || entry.status !== 'active') return;
  let advanced = false;
  for (const objective of def.objectives) {
    const amount = objectiveMatch(objective, eventName, ctx);
    if (amount > 0 && advanceObjective(actor, def, objective, amount)) advanced = true;
  }
  if (advanced && isQuestComplete(def, entry.objectives)) {
    completeQuest(actor, def);
  }
}

// Player-scoped events: the actor in the event ctx is the only one credited.
function handlePlayerScoped(eventName, ctx) {
  const actor = ctx.actor;
  if (!actor || actor.kind !== 'player') return;
  for (const def of world.questDefs.values()) {
    if (matchesDiscovery(def, eventName, ctx)) discover(actor, def);
    progressQuestFor(actor, def, eventName, ctx);
  }
}

// Room-scoped events: every online player in the room with the quest active gets credit;
// discovery also triggers for everyone in the room (the rat-warren party all start the
// matriarch quest together, etc.).
function handleRoomScoped(eventName, ctx) {
  if (!ctx.room) return;
  const players = [];
  for (const a of actorsInRoom(ctx.room)) {
    if (a.kind === 'player' && a.session) players.push(a);
  }
  if (players.length === 0) return;
  for (const def of world.questDefs.values()) {
    for (const actor of players) {
      if (matchesDiscovery(def, eventName, ctx)) discover(actor, def);
      progressQuestFor(actor, def, eventName, ctx);
    }
  }
}

onEvent('room_entered', (ctx) => handlePlayerScoped('room_entered', ctx));
onEvent('item_picked_up', (ctx) => handlePlayerScoped('item_picked_up', ctx));
onEvent('item_given', (ctx) => handlePlayerScoped('item_given', { actor: ctx.giver, ...ctx }));
onEvent('npc_died', (ctx) => handleRoomScoped('npc_died', ctx));

// Called from the give action right before the "npc not interested" fallback. Walks the
// giver's active quests looking for a deliver_item objective whose `defId`+`recipient` pair
// matches the given instance + target NPC. If one matches, consume the instance, broadcast
// the delivery, and emit `item_given` so the normal player-scoped handler progresses the
// objective (and completes the quest if this was the last one). Returns true when the give
// was handled and the caller should suppress its own messaging.
export function tryQuestDelivery(actor, inst, target) {
  if (!actor || actor.kind !== 'player' || !target || target.kind !== 'npc') return false;
  if (!inst || !inst.def) return false;
  const record = actor.record.quests ?? {};
  let matched = false;
  for (const def of world.questDefs.values()) {
    const entry = record[def.id];
    if (!entry || entry.status !== 'active') continue;
    for (const objective of def.objectives) {
      if (objective.type !== 'deliver_item') continue;
      if (objective.defId !== inst.defId) continue;
      if (objective.recipient !== target.defId) continue;
      if (isObjectiveComplete(objective, entry.objectives)) continue;
      matched = true;
      break;
    }
    if (matched) break;
  }
  if (!matched) return false;

  removeFromInventory(actor, inst);
  broadcastToRoom(actor.location, (recipient) => {
    const item = resolveName(inst.def, 'acc', recipient.lang);
    const targetDat = resolveName(target, 'dat', recipient.lang);
    if (recipient === actor) {
      return { kind: 'system', tone: 'good', text: s('give.deliver.self', recipient.lang, { item, target: targetDat }) };
    }
    return {
      kind: 'emote',
      source: sourceForActor(actor, recipient),
      text: s('give.deliver.others', recipient.lang, { actor: actor.name, item, target: targetDat }),
    };
  });
  emitEvent('item_given', { giver: actor, recipient: target, defId: inst.defId, count: 1 });
  return true;
}

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
