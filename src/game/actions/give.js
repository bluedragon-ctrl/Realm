import { findInRoom, broadcastToRoom } from '../world.js';
import { findItemInList, transferItem, splitOnKeyword } from '../items.js';
import { s, t } from '../../i18n.js';
import { sendStats } from '../messages.js';
import { sourceForActor } from '../sources.js';

function parseGiveArgs(args) {
  const split = splitOnKeyword(args, 'to');
  if (split) return { itemQuery: split.before, targetQuery: split.after };
  if (args.length >= 2) {
    return { itemQuery: args.slice(0, -1).join(' '), targetQuery: args[args.length - 1] };
  }
  return null;
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

  const inst = findItemInList(actor.inventory, itemQuery);
  if (!inst) {
    actor.session.send({ kind: 'error', text: s('error.no_such_item_inv', actor.lang, { query: itemQuery }) });
    return;
  }

  const target = findInRoom(actor.location, targetQuery);
  if (!target) {
    actor.session.send({ kind: 'error', text: s('error.no_such_target', actor.lang, { query: targetQuery }) });
    return;
  }
  if (target === actor) {
    actor.session.send({ kind: 'error', text: s('give.to_self', actor.lang) });
    return;
  }

  transferItem(actor.inventory, target.inventory, inst);
  actor.dirty = true;
  if (target.kind === 'player') target.dirty = true;

  broadcastToRoom(actor.location, (recipient) => {
    const item = t(inst.def.nameAcc ?? inst.def.name, recipient.lang);
    const targetName = target.kind === 'npc'
      ? t(target.nameAcc ?? target.name, recipient.lang)
      : target.name;
    if (recipient === actor) {
      return { kind: 'system', text: s('give.self', recipient.lang, { item, target: targetName }) };
    }
    if (recipient === target) {
      return { kind: 'system', text: s('give.recipient', recipient.lang, { item, actor: actor.name }) };
    }
    return {
      kind: 'emote',
      source: sourceForActor(actor, recipient),
      text: s('give.others', recipient.lang, { actor: actor.name, item, target: targetName }),
    };
  });

  sendStats(actor);
  if (target.kind === 'player') sendStats(target);
}
