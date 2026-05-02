import { broadcastToRoom } from '../world.js';
import { s } from '../../i18n.js';
import { sourceForActor } from '../sources.js';

export default function emote(actor, args) {
  const text = args.join(' ').trim();
  if (!text) {
    actor.session.send({ kind: 'error', text: s('emote.no_arg', actor.lang) });
    return;
  }
  broadcastToRoom(actor.location, (recipient) => ({
    kind: 'emote',
    source: sourceForActor(actor, recipient),
    text: s('emote.line', recipient.lang, { from: actor.name, text }),
  }));
}
