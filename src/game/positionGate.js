import { s } from '../i18n.js';
import { broadcastToRoom, actorsInRoom } from './world.js';
import { sourceForActor } from './sources.js';
import { resolveName } from './declension.js';
import { pushTargetInfo, describeRoom } from './actions/look.js';
import { sendStats } from './messages.js';

// Returns { ok: true } if standing; { ok: false, msg } otherwise.
// Active commands call this and short-circuit with the localized message.
export function requireStanding(actor) {
  if (actor.position === 'sleep') return { ok: false, msg: s('position.must_wake', actor.lang) };
  if (actor.position === 'sit') return { ok: false, msg: s('position.must_stand', actor.lang) };
  return { ok: true };
}

// Transition an actor to `next`. Emits self + others broadcasts for the
// transition keyed by `reason`: 'volitional' (the actor chose), 'woken'
// (damage or social woke a sleeper), 'stood' (damage stood a sitter).
// No-op if already in `next` and reason is 'volitional' — returns false then.
export function setPosition(actor, next, reason = 'volitional') {
  if (actor.position === next && reason === 'volitional') return false;
  actor.position = next;
  const keys = pickBroadcastKeys(next, reason);
  if (!keys) return true;
  broadcastToRoom(actor.location, (recipient) => {
    const lang = recipient.lang;
    const isAuthor = recipient === actor;
    const key = isAuthor ? keys.self : keys.others;
    const text = s(key, lang, { actor: resolveName(actor, 'nom', lang) });
    return { kind: 'emote', source: sourceForActor(actor, recipient), text };
  });
  if (actor.kind === 'npc') {
    if (reason === 'woken' || reason === 'stood') actor.energy = 0;
    for (const p of actorsInRoom(actor.location)) {
      if (p.kind !== 'player' || !p.session) continue;
      if (p.inspecting === actor) pushTargetInfo(p, actor);
      else describeRoom(p);
    }
  } else if (actor.kind === 'player' && actor.session) {
    sendStats(actor);
    if (reason === 'woken') describeRoom(actor);
  }
  return true;
}

function pickBroadcastKeys(next, reason) {
  if (reason === 'woken') return { self: 'position.woken.self', others: 'position.woken.others' };
  if (reason === 'stood') return { self: 'position.stood.self', others: 'position.stood.others' };
  // volitional
  return {
    self: `position.${next}.self`,
    others: `position.${next}.others`,
  };
}
