export function clearPlayerAttackQueue(actor) {
  if (actor?.queuedAttack?.timer) clearTimeout(actor.queuedAttack.timer);
  if (actor) actor.queuedAttack = null;
}
