export function clearPlayerActionQueue(actor) {
  if (actor?.queuedAction?.timer) clearTimeout(actor.queuedAction.timer);
  if (actor) actor.queuedAction = null;
}
