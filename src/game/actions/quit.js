import { s } from '../../i18n.js';

export default function quit(actor) {
  actor.session.send({ kind: 'system', text: s('system.farewell', actor.lang) });
  actor.session.close();
}
