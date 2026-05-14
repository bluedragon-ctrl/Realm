// Single-item inventory mutations for actors. Wraps the raw list ops in items.js with the
// dirty-flag and sendStats bookkeeping that every player-facing inventory change must do.
// Batch operations (multi-item consume/produce in exchange.js, take-all loops) stay on the
// raw helpers and call sendStats once at the end — wrapping them would fire N redundant
// sendStats per action.

import { removeFromList, transferItem } from './items.js';
import { sendStats } from './messages.js';

function isOnlinePlayer(actor) {
  return actor.kind === 'player' && !!actor.session;
}

export function addToInventory(actor, inst) {
  actor.inventory.push(inst);
  if (actor.kind === 'player') actor.dirty = true;
  if (isOnlinePlayer(actor)) sendStats(actor);
}

export function removeFromInventory(actor, inst) {
  if (!removeFromList(actor.inventory, inst)) return false;
  if (actor.kind === 'player') actor.dirty = true;
  if (isOnlinePlayer(actor)) sendStats(actor);
  return true;
}

export function transferInventory(from, to, inst) {
  if (!transferItem(from.inventory, to.inventory, inst)) return false;
  if (from.kind === 'player') from.dirty = true;
  if (to.kind === 'player') to.dirty = true;
  if (isOnlinePlayer(from)) sendStats(from);
  if (isOnlinePlayer(to)) sendStats(to);
  return true;
}
