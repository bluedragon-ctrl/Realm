import { actorsInRoom, broadcastToRoom, world } from '../world.js';
import { removeFromList } from '../items.js';
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

function entryMatchesQuery(def, q) {
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

function findBuyMatch(npcs, query) {
  const q = query.toLowerCase();
  let exact = null, sub = null, word = null;
  for (const npc of npcs) {
    const entries = npc.shop?.buys ?? [];
    for (const entry of entries) {
      const def = world.itemDefs.get(entry.item);
      if (!def) continue;
      const m = entryMatchesQuery(def, q);
      if (m === 'exact' && !exact) exact = { npc, entry, def };
      else if (m === 'substring' && !sub) sub = { npc, entry, def };
      else if (m === 'word' && !word) word = { npc, entry, def };
    }
  }
  return exact ?? sub ?? word ?? null;
}

export default function sell(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('sell.usage', actor.lang) });
    return;
  }
  const query = args.join(' ');
  const npcs = shopNpcsInRoom(actor.location);
  if (npcs.length === 0) {
    actor.session.send({ kind: 'error', text: s('shop.no_buyer_here', actor.lang) });
    return;
  }
  const match = findBuyMatch(npcs, query);
  if (!match) {
    actor.session.send({ kind: 'error', text: s('shop.not_buying', actor.lang, { query }) });
    return;
  }
  const { npc, entry, def } = match;
  const perUnit = entry.perUnit ?? 1;
  const matching = actor.inventory.filter(i => i.defId === def.id);
  const have = matching.length;
  const units = Math.floor(have / perUnit);
  if (units === 0) {
    actor.session.send({
      kind: 'error',
      text: s('shop.need_units', actor.lang, {
        item: t(def.name, actor.lang),
        required: perUnit,
        have,
      }),
    });
    return;
  }
  const totalConsume = units * perUnit;
  const totalGold = units * entry.price;
  const toRemove = matching.slice(0, totalConsume);
  for (const inst of toRemove) removeFromList(actor.inventory, inst);
  actor.gold = (actor.gold ?? 0) + totalGold;
  actor.dirty = true;

  broadcastToRoom(actor.location, (recipient) => {
    const itemName = t(def.nameAcc ?? def.name, recipient.lang);
    const npcName = t(npc.nameAcc ?? npc.name, recipient.lang);
    if (recipient === actor) {
      return {
        kind: 'system',
        tone: 'good',
        text: s('shop.sold_self', recipient.lang, {
          count: totalConsume,
          item: itemName,
          gold: totalGold,
          npc: npcName,
        }),
      };
    }
    return {
      kind: 'emote',
      source: sourceForActor(actor, recipient),
      text: s('shop.sold_others', recipient.lang, {
        actor: actor.name,
        count: totalConsume,
        item: itemName,
        npc: npcName,
      }),
    };
  });

  sendStats(actor);
}
