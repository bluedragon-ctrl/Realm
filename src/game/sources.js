export function sourceForActor(actor, recipient) {
  if (!actor) return 'ambient';
  if (actor === recipient) return 'self';
  if (actor.kind === 'player') return 'player';
  if (actor.kind === 'npc') {
    return actor.disposition === 'hostile' ? 'npc-hostile' : 'npc-friendly';
  }
  return null;
}
