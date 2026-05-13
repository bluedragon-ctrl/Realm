import { s, t } from '../../i18n.js';
import { world } from '../world.js';
import { findExchanges, runExchange } from '../exchange.js';
import { allNameVariants, pickByVariants } from '../declension.js';

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
  const withDef = [];
  for (const c of candidates) {
    const inp = c.entry.inputs.find(x => x.item);
    if (!inp) continue;
    const def = world.itemDefs.get(inp.item);
    if (!def) continue;
    withDef.push({ c, def, inp });
  }
  const match = pickByVariants(withDef, query, ({ def }) => [
    ...allNameVariants(def),
    def.id.toLowerCase(),
  ]);
  if (!match) {
    actor.session.send({ kind: 'error', text: s('shop.not_buying', actor.lang, { query }) });
    return;
  }
  const { c, def, inp } = match;
  const perUnit = inp.count ?? 1;
  const have = actor.inventory.filter(i => i.defId === inp.item).length;
  if (have < perUnit) {
    actor.session.send({
      kind: 'error',
      text: s('shop.need_units', actor.lang, { item: t(def.name, actor.lang), required: perUnit, have }),
    });
    return;
  }
  runExchange(actor, c.host, c.entry, { units: 1 });
}
