import { broadcastToRoom } from '../world.js';
import { s } from '../../i18n.js';
import { sourceForActor } from '../sources.js';

export default function say(actor, args) {
  const text = args.join(' ').trim();
  if (!text) {
    actor.session.send({ kind: 'error', text: s('say.no_arg', actor.lang) });
    return;
  }
  broadcastToRoom(actor.location, (recipient) => ({
    kind: 'say',
    source: sourceForActor(actor, recipient),
    text: recipient === actor
      ? s('say.self', recipient.lang, { text })
      : s('say.other', recipient.lang, { from: actor.name, text }),
  }));
}
