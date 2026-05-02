import { SUPPORTED_LANGS, s } from '../../i18n.js';
import { describeRoom } from './look.js';
import { sendStats } from '../messages.js';

export default function lang(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({
      kind: 'system',
      text: s('system.lang_current', actor.lang, {
        lang: actor.lang,
        available: SUPPORTED_LANGS.join(', '),
      }),
    });
    return;
  }
  const requested = args[0].toLowerCase();
  if (!SUPPORTED_LANGS.includes(requested)) {
    actor.session.send({
      kind: 'error',
      text: s('error.unknown_lang', actor.lang, {
        lang: requested,
        available: SUPPORTED_LANGS.join(', '),
      }),
    });
    return;
  }
  actor.lang = requested;
  actor.dirty = true;
  actor.session.send({
    kind: 'system',
    text: s('system.lang_set', actor.lang, { lang: actor.lang }),
  });
  sendStats(actor);
  describeRoom(actor);
}
