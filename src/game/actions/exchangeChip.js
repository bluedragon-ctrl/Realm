import { s } from '../../i18n.js';
import { findExchangeById, runExchange } from '../exchange.js';

export default function exchangeChip(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('use.cant', actor.lang) });
    return;
  }
  const id = args[0];
  const found = findExchangeById(actor.location, id);
  if (!found) {
    actor.session.send({ kind: 'error', text: s('use.cant', actor.lang) });
    return;
  }
  runExchange(actor, found.host, found.entry, { units: 1 });
}
