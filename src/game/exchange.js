import { actorsInRoom, itemsInRoom, broadcastToRoom, world } from './world.js';
import { makeItemInstance, removeFromList } from './items.js';
import { runVerb } from './verbs.js';
import { sendStats } from './messages.js';
import { sourceForActor } from './sources.js';
import { resolveName } from './declension.js';
import { goldPhrase } from './format.js';
import { awardXp } from './xp.js';
import { s, t } from '../i18n.js';

export function hostsInRoom(roomId) {
  const out = [];
  for (const a of actorsInRoom(roomId)) {
    if (a.kind === 'npc' && Array.isArray(a.exchanges) && a.exchanges.length) out.push(a);
  }
  for (const inst of itemsInRoom(roomId)) {
    if (Array.isArray(inst.def.exchanges) && inst.def.exchanges.length) out.push(inst);
  }
  return out;
}

function getExchanges(host) {
  if (host.kind === 'npc') return host.exchanges ?? [];
  return host.def?.exchanges ?? [];
}

export function findExchangeById(roomId, id) {
  for (const host of hostsInRoom(roomId)) {
    for (const entry of getExchanges(host)) {
      if (entry.id === id) return { host, entry };
    }
  }
  return null;
}

export function findExchanges(roomId, { flavor, inputItem, outputItem } = {}) {
  const out = [];
  for (const host of hostsInRoom(roomId)) {
    for (const entry of getExchanges(host)) {
      if (flavor && entry.flavor !== flavor) continue;
      if (inputItem && !entry.inputs.some(x => x.item === inputItem)) continue;
      if (outputItem && !entry.outputs.some(x => x.item === outputItem)) continue;
      out.push({ host, entry });
    }
  }
  return out;
}

function inventoryCount(actor, itemId) {
  return actor.inventory.filter(i => i.defId === itemId).length;
}

export function canAfford(actor, entry, units = 1) {
  for (const inp of entry.inputs) {
    if (inp.gold != null) {
      if ((actor.gold ?? 0) < inp.gold * units) return { ok: false, missing: { gold: inp.gold * units - (actor.gold ?? 0) } };
    } else {
      const need = (inp.count ?? 1) * units;
      const have = inventoryCount(actor, inp.item);
      if (have < need) return { ok: false, missing: { item: inp.item, need, have } };
    }
  }
  return { ok: true };
}

function hostName(host, kase, lang) {
  return resolveName(host.kind === 'npc' ? host : host.def, kase, lang);
}

function consumeInputs(actor, entry, units) {
  for (const inp of entry.inputs) {
    if (inp.gold != null) {
      actor.gold = (actor.gold ?? 0) - inp.gold * units;
    } else {
      const need = (inp.count ?? 1) * units;
      const matches = actor.inventory.filter(i => i.defId === inp.item).slice(0, need);
      for (const inst of matches) removeFromList(actor.inventory, inst);
    }
  }
}

function produceOutputs(actor, entry, units) {
  const produced = [];
  for (const out of entry.outputs) {
    if (out.gold != null) {
      actor.gold = (actor.gold ?? 0) + out.gold * units;
    } else {
      const def = world.itemDefs.get(out.item);
      const total = (out.count ?? 1) * units;
      for (let i = 0; i < total; i++) actor.inventory.push(makeItemInstance(def));
      produced.push({ def, count: total });
    }
  }
  return produced;
}

function broadcastDefault(actor, host, entry, units) {
  const flavor = entry.flavor;
  const itemInput = entry.inputs.find(x => x.item);
  const goldInput = entry.inputs.find(x => x.gold != null);
  const itemOutput = entry.outputs.find(x => x.item);
  const goldOutput = entry.outputs.find(x => x.gold != null);

  if (flavor === 'buy') {
    const def = world.itemDefs.get(itemOutput.item);
    const price = goldInput.gold * units;
    broadcastToRoom(actor.location, (recipient) => {
      const itemName = resolveName(def, 'acc', recipient.lang);
      // "od {npc}" — genitive after the preposition `od`.
      const npcGen = hostName(host, 'gen', recipient.lang);
      const priceP = goldPhrase(price, recipient.lang);
      if (recipient === actor) {
        return { kind: 'system', tone: 'good', text: s('shop.bought_self', recipient.lang, { item: itemName, price: priceP, npc: npcGen }) };
      }
      return {
        kind: 'emote',
        source: sourceForActor(actor, recipient),
        text: s('shop.bought_others', recipient.lang, { actor: actor.name, item: itemName, npc: npcGen }),
      };
    });
    return;
  }

  if (flavor === 'sell') {
    const def = world.itemDefs.get(itemInput.item);
    const totalConsume = (itemInput.count ?? 1) * units;
    const totalGold = goldOutput.gold * units;
    broadcastToRoom(actor.location, (recipient) => {
      const itemName = resolveName(def, 'acc', recipient.lang);
      // "prodáváš {item} {npc}" — dative recipient of the sale.
      const npcDat = hostName(host, 'dat', recipient.lang);
      const goldP = goldPhrase(totalGold, recipient.lang);
      if (recipient === actor) {
        return { kind: 'system', tone: 'good', text: s('shop.sold_self', recipient.lang, { count: totalConsume, item: itemName, gold: goldP, npc: npcDat }) };
      }
      return {
        kind: 'emote',
        source: sourceForActor(actor, recipient),
        text: s('shop.sold_others', recipient.lang, { actor: actor.name, count: totalConsume, item: itemName, npc: npcDat }),
      };
    });
    return;
  }
}

export function runExchange(actor, host, entry, { units = 1 } = {}) {
  const aff = canAfford(actor, entry, units);
  if (!aff.ok) {
    if (aff.missing.gold != null) {
      actor.session.send({ kind: 'error', text: s('shop.no_gold', actor.lang, {
        price: goldPhrase(aff.missing.gold + (actor.gold ?? 0), actor.lang),
        gold: goldPhrase(actor.gold ?? 0, actor.lang),
      }) });
    } else {
      const def = world.itemDefs.get(aff.missing.item);
      if (entry.flavor === 'sell') {
        actor.session.send({ kind: 'error', text: s('shop.need_units', actor.lang, { item: t(def.name, actor.lang), required: aff.missing.need, have: aff.missing.have }) });
      } else {
        actor.session.send({ kind: 'error', text: s('recipe.need_more', actor.lang, { item: t(def.name, actor.lang), required: aff.missing.need, have: aff.missing.have }) });
      }
    }
    return false;
  }

  consumeInputs(actor, entry, units);

  if (entry.verb) {
    runVerb({ actor, def: entry.verb, targetName: hostName(host, 'nom', actor.lang) });
  } else {
    broadcastDefault(actor, host, entry, units);
  }

  const produced = produceOutputs(actor, entry, units);

  if (entry.flavor === 'craft' && produced.length > 0) {
    const first = produced[0];
    actor.session.send({ kind: 'system', tone: 'good', text: s('produce.you_made', actor.lang, { item: t(first.def.name, actor.lang) }) });
  }

  if (entry.xp && entry.xp > 0) awardXp(actor, entry.xp, entry.flavor);

  actor.dirty = true;
  sendStats(actor);
  return true;
}
