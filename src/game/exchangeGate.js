// Per-player visibility check for exchange entries. An exchange with no `requires` block
// is always available; otherwise it's gated on the actor's quest state. Two condition
// shapes are supported:
//
//   { quest: "quest.x", status: "active" | "complete" }
//     → the actor's quest entry exists and its `status` matches.
//
//   { quest: "quest.x", objective: "obj.id" }
//     → the actor's quest entry exists, is active OR complete, and the named objective's
//       counter has reached its required count. Useful for unlocks midway through a
//       multi-step quest.
//
// Leaf module — depends only on world (for the quest def lookup needed to read an
// objective's required count). Callable from anywhere that resolves or serializes
// exchanges without risking a circular import.

import { world } from './world.js';

export function isExchangeAvailable(actor, entry) {
  const req = entry?.requires;
  if (!req) return true;
  if (!actor || actor.kind !== 'player') return false;

  const playerEntry = actor.record?.quests?.[req.quest];
  if (!playerEntry) return false;

  if (req.status) {
    return playerEntry.status === req.status;
  }
  if (req.objective) {
    const def = world.questDefs?.get(req.quest);
    if (!def) return false;
    const obj = def.objectives.find(o => o.id === req.objective);
    if (!obj) return false;
    const need = obj.count ?? 1;
    return (playerEntry.objectives?.[req.objective] ?? 0) >= need;
  }
  // Bare `{ quest: "x" }` with no status/objective qualifier — treat as "discovered".
  return true;
}
