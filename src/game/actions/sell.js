import { s } from '../../i18n.js';
import { world } from '../world.js';
import { findExchanges, runExchange } from '../exchange.js';
import { allNameVariants } from '../declension.js';

function nameMatches(def, q) {
  const variants = [
    ...allNameVariants(def),
    def.id.toLowerCase(),
  ];
  if (variants.some(v => v === q)) return 'exact';
  if (variants.some(v => v.includes(q))) return 'substring';
  for (const v of variants) {
    if (v.split(/\s+/).some(word => word === q)) return 'word';
  }
  return null;
}

export default function sell(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('sell.usage', actor.lang) });
    return;
  }
  const query = args.join(' ').toLowerCase();
  const candidates = findExchanges(actor.location, { flavor: 'sell' });
  if (candidates.length === 0) {
    actor.session.send({ kind: 'error', text: s('shop.no_buyer_here', actor.lang) });
    return;
  }
  let exact = null, sub = null, word = null;
  for (const c of candidates) {
    const inp = c.entry.inputs.find(x => x.item);
    if (!inp) continue;
    const def = world.itemDefs.get(inp.item);
    if (!def) continue;
    const m = nameMatches(def, query);
    if (m === 'exact' && !exact) exact = c;
    else if (m === 'substring' && !sub) sub = c;
    else if (m === 'word' && !word) word = c;
  }
  const match = exact ?? sub ?? word;
  if (!match) {
    actor.session.send({ kind: 'error', text: s('shop.not_buying', actor.lang, { query }) });
    return;
  }
  const inp = match.entry.inputs.find(x => x.item);
  const perUnit = inp.count ?? 1;
  const have = actor.inventory.filter(i => i.defId === inp.item).length;
  const units = Math.floor(have / perUnit);
  if (units === 0) {
    const def = world.itemDefs.get(inp.item);
    actor.session.send({
      kind: 'error',
      text: s('shop.need_units', actor.lang, { item: t(def.name, actor.lang), required: perUnit, have }),
    });
    return;
  }
  runExchange(actor, match.host, match.entry, { units });
}
