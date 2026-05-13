// Shared helpers for resolving the target of a targeted command.
// `SELF_TOKENS` lists the words that mean "the acting actor" — used by cast/use/social.

import { findInRoom } from './world.js';
import { s } from '../i18n.js';
import { isInvisible } from './perception.js';

export const SELF_TOKENS = new Set(['me', 'self', 'myself']);

export function isSelfToken(query) {
  return typeof query === 'string' && SELF_TOKENS.has(query.toLowerCase());
}

// Resolve `targetQuery` to an actor in the room, treating self-tokens as `actor`.
// On failure, sends an error to the actor and returns null (so callers can `if (!target) return;`).
// Invisible actors are unfindable by name (room-dark targeting still works — see cast.js).
export function resolveActorTarget(actor, targetQuery) {
  if (isSelfToken(targetQuery)) return actor;
  const found = findInRoom(actor.location, targetQuery);
  const target = found && found !== actor && isInvisible(found) ? null : found;
  if (!target) {
    actor.session.send({ kind: 'error', text: s('error.no_such_target', actor.lang, { query: targetQuery }) });
    return null;
  }
  return target;
}
