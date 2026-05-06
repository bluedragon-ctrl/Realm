import { s, t, nameVariants } from '../../i18n.js';
import { world } from '../world.js';
import { findExchanges, runExchange } from '../exchange.js';

function nameMatches(def, q) {
  const variants = [
    ...nameVariants(def.name),
    ...nameVariants(def.nameAcc),
    def.id.toLowerCase(),
  ];
  if (variants.some(v => v === q)) return 'exact';
  if (variants.some(v => v.includes(q))) return 'substring';
  for (const v of variants) {
    if (v.split(/\s+/).some(word => word === q)) return 'word';
  }
  return null;
}

export default function buy(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('buy.usage', actor.lang) });
    return;
  }
  const query = args.join(' ').toLowerCase();
  const candidates = findExchanges(actor.location, { flavor: 'buy' });
  if (candidates.length === 0) {
    actor.session.send({ kind: 'error', text: s('shop.no_seller_here', actor.lang) });
    return;
  }
  let exact = null, sub = null, word = null;
  for (const c of candidates) {
    const out = c.entry.outputs.find(x => x.item);
    if (!out) continue;
    const def = world.itemDefs.get(out.item);
    if (!def) continue;
    const m = nameMatches(def, query);
    if (m === 'exact' && !exact) exact = c;
    else if (m === 'substring' && !sub) sub = c;
    else if (m === 'word' && !word) word = c;
  }
  const match = exact ?? sub ?? word;
  if (!match) {
    actor.session.send({ kind: 'error', text: s('shop.not_for_sale', actor.lang, { query }) });
    return;
  }
  runExchange(actor, match.host, match.entry, { units: 1 });
}
