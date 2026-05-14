import { placeItemInRoom, broadcastToRoom, addGoldToRoom } from '../world.js';
import { findItemInList } from '../items.js';
import { removeFromInventory } from '../inventory.js';
import { s } from '../../i18n.js';
import { sendStats } from '../messages.js';
import { describeRoomToAll } from './look.js';
import { sourceForActor } from '../sources.js';
import { resolveName } from '../declension.js';
import { goldPhrase, parseAmountGold } from '../format.js';
import { requireStanding } from '../positionGate.js';

export default function drop(actor, args) {
  const gate = requireStanding(actor);
  if (!gate.ok) {
    actor.session?.send({ kind: 'error', text: gate.msg });
    return;
  }
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('drop.no_arg', actor.lang) });
    return;
  }
  const goldArgs = parseAmountGold(args);
  if (goldArgs) {
    if ((actor.gold ?? 0) < goldArgs.amount) {
      actor.session.send({ kind: 'error', text: s('drop.gold.not_enough', actor.lang, { amount: goldArgs.amount, gold: goldPhrase(actor.gold ?? 0, actor.lang) }) });
      return;
    }
    actor.gold = (actor.gold ?? 0) - goldArgs.amount;
    addGoldToRoom(actor.location, goldArgs.amount);
    actor.dirty = true;
    broadcastToRoom(actor.location, (recipient) => {
      const amount = goldPhrase(goldArgs.amount, recipient.lang);
      if (recipient === actor) {
        return { kind: 'system', text: s('drop.gold.self', recipient.lang, { amount }) };
      }
      return {
        kind: 'emote',
        source: sourceForActor(actor, recipient),
        text: s('drop.gold.others', recipient.lang, { actor: actor.name, amount }),
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
  removeFromInventory(actor, inst);
  placeItemInRoom(inst, actor.location);

  broadcastToRoom(actor.location, (recipient) => {
    const item = resolveName(inst.def, 'acc', recipient.lang);
    if (recipient === actor) {
      return { kind: 'system', text: s('drop.self', recipient.lang, { item }) };
    }
    return {
      kind: 'emote',
      source: sourceForActor(actor, recipient),
      text: s('drop.others', recipient.lang, { actor: actor.name, item }),
    };
  });

  describeRoomToAll(actor.location);
}
