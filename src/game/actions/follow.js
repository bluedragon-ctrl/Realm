import { findInRoom } from '../world.js';
import { s } from '../../i18n.js';
import { resolveName } from '../declension.js';

export function follow(actor, args) {
  if (!args || args.length === 0) {
    if (actor.following) return unfollow(actor);
    actor.session.send({ kind: 'error', text: s('follow.not_following', actor.lang) });
    return;
  }
  const query = args.join(' ');
  const target = findInRoom(actor.location, query);
  if (!target) {
    actor.session.send({ kind: 'error', text: s('follow.no_target', actor.lang, { name: query }) });
    return;
  }
  if (target === actor) {
    actor.session.send({ kind: 'error', text: s('follow.self', actor.lang) });
    return;
  }
  actor.following = target.id;
  actor.dirty = true;
  actor.session.send({
    kind: 'system',
    text: s('follow.now_following', actor.lang, { name: resolveName(target, 'acc', actor.lang) }),
  });
}

export function unfollow(actor) {
  if (!actor.following) {
    actor.session.send({ kind: 'error', text: s('follow.not_following', actor.lang) });
    return;
  }
  actor.following = null;
  actor.dirty = true;
  actor.session.send({ kind: 'system', text: s('follow.stopped', actor.lang) });
}

export default follow;
