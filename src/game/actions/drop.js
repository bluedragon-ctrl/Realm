import { placeItemInRoom, broadcastToRoom, addGoldToRoom } from '../world.js';
import { findItemInList, removeFromList } from '../items.js';
import { s, t } from '../../i18n.js';
import { sendStats } from '../messages.js';
import { describeRoomToAll } from './look.js';
import { sourceForActor } from '../sources.js';

const GOLD_WORDS = new Set(['gold', 'coin', 'coins', 'zlato', 'zlaťák', 'zlaťáky', 'mince']);

function parseGoldArgs(args) {
  if (args.length !== 2) return null;
  const a = args[0].toLowerCase();
  const b = args[1].toLowerCase();
  let amountStr = null, word = null;
  if (/^\d+$/.test(a) && GOLD_WORDS.has(b)) { amountStr = a; word = b; }
  else if (GOLD_WORDS.has(a) && /^\d+$/.test(b)) { amountStr = b; word = a; }
  if (!amountStr) return null;
  const amount = parseInt(amountStr, 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, word };
}

export default function drop(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('drop.no_arg', actor.lang) });
    return;
  }
  const goldArgs = parseGoldArgs(args);
  if (goldArgs) {
    if ((actor.gold ?? 0) < goldArgs.amount) {
      actor.session.send({ kind: 'error', text: s('drop.gold.not_enough', actor.lang, { amount: goldArgs.amount, gold: actor.gold ?? 0 }) });
      return;
    }
    actor.gold = (actor.gold ?? 0) - goldArgs.amount;
    addGoldToRoom(actor.location, goldArgs.amount);
    actor.dirty = true;
    broadcastToRoom(actor.location, (recipient) => {
      if (recipient === actor) {
        return { kind: 'system', text: s('drop.gold.self', recipient.lang, { amount: goldArgs.amount }) };
      }
      return {
        kind: 'emote',
        source: sourceForActor(actor, recipient),
        text: s('drop.gold.others', recipient.lang, { actor: actor.name, amount: goldArgs.amount }),
      };
    });
    sendStats(actor);
    describeRoomToAll(actor.location);
    return;
  }
  const query = args.join(' ');
  const inst = findItemInList(actor.inventory, query);
  if (!inst) {
    actor.session.send({ kind: 'error', text: s('error.no_such_item_inv', actor.lang, { query }) });
    return;
  }
  removeFromList(actor.inventory, inst);
  placeItemInRoom(inst, actor.location);
  actor.dirty = true;

  broadcastToRoom(actor.location, (recipient) => {
    const item = t(inst.def.nameAcc ?? inst.def.name, recipient.lang);
    if (recipient === actor) {
      return { kind: 'system', text: s('drop.self', recipient.lang, { item }) };
    }
    return {
      kind: 'emote',
      source: sourceForActor(actor, recipient),
      text: s('drop.others', recipient.lang, { actor: actor.name, item }),
    };
  });

  sendStats(actor);
  describeRoomToAll(actor.location);
}
