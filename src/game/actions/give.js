import { broadcastToRoom } from '../world.js';
import { findItemInList, transferItem, splitOnKeyword } from '../items.js';
import { s, t } from '../../i18n.js';
import { resolveName } from '../declension.js';
import { goldPhrase, parseAmountGoldQuery } from '../format.js';
import { sendStats } from '../messages.js';
import { sourceForActor } from '../sources.js';
import { runExchange, runSinkExchange } from '../exchange.js';
import { resolveActorTarget } from '../targeting.js';
import { hasForm } from '../verbs.js';
import { consumeForActor } from './use.js';

function parseGiveArgs(args) {
  const split = splitOnKeyword(args, 'to');
  if (split) return { itemQuery: split.before, targetQuery: split.after };
  if (args.length >= 2) {
    return { itemQuery: args.slice(0, -1).join(' '), targetQuery: args[args.length - 1] };
  }
  return null;
}

function parseCountedItemGive(itemQuery) {
  const parts = itemQuery.trim().split(/\s+/);
  if (parts.length < 2 || !/^\d+$/.test(parts[0])) return null;
  const count = parseInt(parts[0], 10);
  if (!Number.isFinite(count) || count <= 0) return null;
  return { count, itemQuery: parts.slice(1).join(' ') };
}

function findExchangeForGoldGive(target, amount) {
  const exchanges = target.exchanges ?? [];
  return exchanges.filter(e =>
    e.inputs.length === 1 &&
    e.inputs[0].gold === amount
  );
}

function findExchangeForItemGive(target, itemDefId, count) {
  const exchanges = target.exchanges ?? [];
  return exchanges.filter(e => {
    const inp = (e.inputs ?? []).find(x => x.item === itemDefId);
    if (!inp) return false;
    const need = inp.count ?? 1;
    return need === count;
  });
}

export default function give(actor, args) {
  if (!args || args.length < 2) {
    actor.session.send({ kind: 'error', text: s('give.usage', actor.lang) });
    return;
  }
  const parsed = parseGiveArgs(args);
  if (!parsed) {
    actor.session.send({ kind: 'error', text: s('give.usage', actor.lang) });
    return;
  }
  const { itemQuery, targetQuery } = parsed;

  const goldGive = parseAmountGoldQuery(itemQuery);
  if (goldGive) {
    const target = resolveActorTarget(actor, targetQuery);
    if (!target) return;
    if (target === actor) {
      actor.session.send({ kind: 'error', text: s('give.to_self', actor.lang) });
      return;
    }
    if (target.kind === 'npc' && Array.isArray(target.exchanges)) {
      const matches = findExchangeForGoldGive(target, goldGive.amount);
      if (matches.length === 1) {
        runExchange(actor, target, matches[0], { units: 1 });
        return;
      }
      if (matches.length > 1) {
        actor.session.send({ kind: 'error', text: s('exchange.ambiguous_give', actor.lang) });
        return;
      }
    }
    if (target.kind !== 'player') {
      actor.session.send({ kind: 'error', text: s('give.gold.target_invalid', actor.lang) });
      return;
    }
    if ((actor.gold ?? 0) < goldGive.amount) {
      actor.session.send({ kind: 'error', text: s('give.gold.not_enough', actor.lang, { amount: goldGive.amount, gold: goldPhrase(actor.gold ?? 0, actor.lang) }) });
      return;
    }
    actor.gold = (actor.gold ?? 0) - goldGive.amount;
    target.gold = (target.gold ?? 0) + goldGive.amount;
    actor.dirty = true;
    target.dirty = true;
    broadcastToRoom(actor.location, (recipient) => {
      const targetDat = resolveName(target, 'dat', recipient.lang);
      const amount = goldPhrase(goldGive.amount, recipient.lang);
      if (recipient === actor) {
        return { kind: 'system', text: s('give.gold.self', recipient.lang, { amount, target: targetDat }) };
      }
      if (recipient === target) {
        return { kind: 'system', tone: 'good', text: s('give.gold.recipient', recipient.lang, { amount, actor: actor.name }) };
      }
      return {
        kind: 'emote',
        source: sourceForActor(actor, recipient),
        text: s('give.gold.others', recipient.lang, { actor: actor.name, amount, target: targetDat }),
      };
    });
    sendStats(actor);
    sendStats(target);
    return;
  }

  let count = 1;
  let resolvedItemQuery = itemQuery;
  const counted = parseCountedItemGive(itemQuery);
  if (counted) {
    count = counted.count;
    resolvedItemQuery = counted.itemQuery;
  }

  const inst = findItemInList(actor.inventory, resolvedItemQuery);
  if (!inst) {
    actor.session.send({ kind: 'error', text: s('error.no_such_item_inv', actor.lang, { query: resolvedItemQuery }) });
    return;
  }

  const target = resolveActorTarget(actor, targetQuery);
  if (!target) return;
  if (target === actor) {
    actor.session.send({ kind: 'error', text: s('give.to_self', actor.lang) });
    return;
  }

  if (target.kind === 'npc' && Array.isArray(target.exchanges)) {
    const matches = findExchangeForItemGive(target, inst.defId, count);
    if (matches.length === 1) {
      runExchange(actor, target, matches[0], { units: 1 });
      return;
    }
    if (matches.length > 1) {
      actor.session.send({ kind: 'error', text: s('exchange.ambiguous_give', actor.lang) });
      return;
    }
    if (count === 1) {
      const sinkEntry = target.exchanges.find(e => e.flavor === 'sink');
      if (sinkEntry) {
        runSinkExchange(actor, target, sinkEntry, inst);
        return;
      }
    }
  }

  if (count !== 1) {
    actor.session.send({ kind: 'error', text: s('exchange.ambiguous_give', actor.lang) });
    return;
  }

  const useDef = inst.def.use;
  if (target.kind === 'npc'
      && target.disposition === 'friendly'
      && target.position !== 'sleep'
      && useDef?.consumable
      && hasForm(useDef, actor.lang, 'to_target')
      && (useDef.effect?.type === 'heal' || useDef.effect?.type === 'apply_effect')) {
    consumeForActor(actor, inst, target);
    return;
  }

  transferItem(actor.inventory, target.inventory, inst);
  actor.dirty = true;
  if (target.kind === 'player') target.dirty = true;

  broadcastToRoom(actor.location, (recipient) => {
    const item = resolveName(inst.def, 'acc', recipient.lang);
    const targetDat = resolveName(target, 'dat', recipient.lang);
    if (recipient === actor) {
      return { kind: 'system', text: s('give.self', recipient.lang, { item, target: targetDat }) };
    }
    if (recipient === target) {
      return { kind: 'system', text: s('give.recipient', recipient.lang, { item, actor: actor.name }) };
    }
    return {
      kind: 'emote',
      source: sourceForActor(actor, recipient),
      text: s('give.others', recipient.lang, { actor: actor.name, item, target: targetDat }),
    };
  });

  sendStats(actor);
  if (target.kind === 'player') sendStats(target);
}
