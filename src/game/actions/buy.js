import { actorsInRoom, broadcastToRoom, world } from '../world.js';
import { makeItemInstance } from '../items.js';
import { s, t, nameVariants } from '../../i18n.js';
import { sendStats } from '../messages.js';
import { sourceForActor } from '../sources.js';

function shopNpcsInRoom(roomId) {
  const out = [];
  for (const a of actorsInRoom(roomId)) {
    if (a.kind === 'npc' && a.shop) out.push(a);
  }
  return out;
}

function entryMatchesQuery(entry, def, q) {
  if (def.id.toLowerCase() === q) return 'exact';
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

function findShopMatch(npcs, listKey, query) {
  const q = query.toLowerCase();
  let exact = null, sub = null, word = null;
  for (const npc of npcs) {
    const entries = npc.shop?.[listKey] ?? [];
    for (const entry of entries) {
      const def = world.itemDefs.get(entry.item);
      if (!def) continue;
      const m = entryMatchesQuery(entry, def, q);
      if (m === 'exact' && !exact) exact = { npc, entry, def };
      else if (m === 'substring' && !sub) sub = { npc, entry, def };
      else if (m === 'word' && !word) word = { npc, entry, def };
    }
  }
  return exact ?? sub ?? word ?? null;
}

export default function buy(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('buy.usage', actor.lang) });
    return;
  }
  const query = args.join(' ');
  const npcs = shopNpcsInRoom(actor.location);
  if (npcs.length === 0) {
    actor.session.send({ kind: 'error', text: s('shop.no_seller_here', actor.lang) });
    return;
  }
  const match = findShopMatch(npcs, 'sells', query);
  if (!match) {
    actor.session.send({ kind: 'error', text: s('shop.not_for_sale', actor.lang, { query }) });
    return;
  }
  const { npc, entry, def } = match;
  const price = entry.price;
  if ((actor.gold ?? 0) < price) {
    actor.session.send({ kind: 'error', text: s('shop.no_gold', actor.lang, { price, gold: actor.gold ?? 0 }) });
    return;
  }
  actor.gold = (actor.gold ?? 0) - price;
  actor.inventory.push(makeItemInstance(def));
  actor.dirty = true;

  broadcastToRoom(actor.location, (recipient) => {
    const itemName = t(def.nameAcc ?? def.name, recipient.lang);
    const npcName = t(npc.nameAcc ?? npc.name, recipient.lang);
    if (recipient === actor) {
      return { kind: 'system', tone: 'good', text: s('shop.bought_self', recipient.lang, { item: itemName, price, npc: npcName }) };
    }
    return {
      kind: 'emote',
      source: sourceForActor(actor, recipient),
      text: s('shop.bought_others', recipient.lang, { actor: actor.name, item: itemName, npc: npcName }),
    };
  });
  sendStats(actor);
}
