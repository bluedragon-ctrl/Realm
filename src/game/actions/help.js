import { s } from '../../i18n.js';

export default function help(actor) {
  actor.session.send({ kind: 'system', text: s('help.text', actor.lang) });
}
