// Shared helpers for resolving the target of a targeted command.
// `SELF_TOKENS` lists the words that mean "the acting actor" — used by cast/use/social.

import { findInRoom } from './world.js';
import { s } from '../i18n.js';

export const SELF_TOKENS = new Set(['me', 'self', 'myself']);

export function isSelfToken(query) {
  return typeof query === 'string' && SELF_TOKENS.has(query.toLowerCase());
}

// Resolve `targetQuery` to an actor in the room, treating self-tokens as `actor`.
// On failure, sends an error to the actor and returns null (so callers can `if (!target) return;`).
export function resolveActorTarget(actor, targetQuery) {
  if (isSelfToken(targetQuery)) return actor;
  const target = findInRoom(actor.location, targetQuery);
  if (!target) {
    actor.session.send({ kind: 'error', text: s('error.no_such_target', actor.lang, { query: targetQuery }) });
    return null;
  }
  return target;
}
