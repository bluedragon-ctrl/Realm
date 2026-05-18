// Lightweight named-event bus for actor lifecycle hooks. Subsystems register at module
// load via `on(event, handler)`; producers fire via `emit(event, ctx)`. Each handler runs
// inside try/catch so a bug in one subscriber can't break the cascade for others.
//
// This is intentionally tiny: a Map of arrays. No priorities, no off-once, no async
// dispatch. Registration order = fire order. The known event names are listed below so a
// typo at the call site fails loud at boot rather than silently dropping the event.

const KNOWN = new Set([
  // ctx: { killer, target, room, def, summoned }
  // Fired once per NPC death after `npc.alive = false` and after the NPC has been removed
  // from world.actorsByRoom + world.npcsByInstance. `def` is the npc def (may be null on
  // orphaned spawns). `summoned` is true for ephemeral summons; subscribers that grant XP
  // / drop loot / queue respawn must skip those.
  'npc_died',
  // ctx: { killer, victim, oldRoom }
  // Fired when a player dies, after action queue is cleared and victim has been placed at
  // RESPAWN_ROOM but before the 5s respawn timer fires.
  'player_died',
  // ctx: { actor, room }
  // Fired when a player enters a room (move arrival, login placement). Not fired for NPCs.
  'room_entered',
  // ctx: { actor, defId, count, room }
  // Fired when a player picks up one or more instances of an item from a room. `count` is
  // 1 for single takes, N for `take all` of one defId. Not fired for NPC inventory transfers.
  'item_picked_up',
  // ctx: { giver, recipient, defId, count }
  // Fired when a player gives an item to an NPC AND a quest deliver_item objective accepted
  // it. The give path consumes the instance before emitting; this event is only the signal
  // for quest progress and not a generic "player gave NPC something" hook.
  'item_given',
]);

const handlers = new Map();
for (const ev of KNOWN) handlers.set(ev, []);

export function on(event, fn) {
  if (!handlers.has(event)) throw new Error(`unknown event: ${event}`);
  handlers.get(event).push(fn);
}

export function emit(event, ctx) {
  const list = handlers.get(event);
  if (!list) throw new Error(`unknown event: ${event}`);
  for (const fn of list) {
    try { fn(ctx); }
    catch (err) { console.error(`event '${event}' handler failed:`, err); }
  }
}
