import { itemsInRoom, removeItemFromRoom, broadcastToRoom, getGoldInRoom, takeGoldFromRoom } from '../world.js';
import { findItemInList } from '../items.js';
import { s } from '../../i18n.js';
import { sendStats } from '../messages.js';
import { describeRoom, describeRoomToAll } from './look.js';
import { sourceForActor } from '../sources.js';
import { resolveName } from '../declension.js';
import { goldPhrase, isGoldQuery } from '../format.js';

export default function take(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('take.no_arg', actor.lang) });
    return;
  }
  if (isGoldQuery(args)) {
    const inRoom = getGoldInRoom(actor.location);
    if (inRoom <= 0) {
      actor.session.send({ kind: 'error', text: s('take.gold.none', actor.lang) });
      return;
    }
    const taken = takeGoldFromRoom(actor.location, inRoom);
    actor.gold = (actor.gold ?? 0) + taken;
    actor.dirty = true;
    broadcastToRoom(actor.location, (recipient) => {
      const amount = goldPhrase(taken, recipient.lang);
      if (recipient === actor) {
        return { kind: 'system', tone: 'good', text: s('take.gold.self', recipient.lang, { amount }) };
      }
      return {
        kind: 'emote',
        source: sourceForActor(actor, recipient),
        text: s('take.gold.others', recipient.lang, { actor: actor.name, amount }),
      };
    });
    sendStats(actor);
    describeRoomToAll(actor.location);
    return;
  }
  const query = args.join(' ');
  const list = itemsInRoom(actor.location);
  const inst = findItemInList(list, query);
  if (!inst) {
    actor.session.send({ kind: 'error', text: s('error.no_such_item_here', actor.lang, { query }) });
    return;
  }
  if (inst.def.pickable === false) {
    actor.session.send({ kind: 'error', text: s('take.not_pickable', actor.lang) });
    return;
  }

  removeItemFromRoom(inst, actor.location);
  actor.inventory.push(inst);
  actor.dirty = true;

  broadcastToRoom(actor.location, (recipient) => {
    const item = resolveName(inst.def, 'acc', recipient.lang);
    if (recipient === actor) {
      return { kind: 'system', text: s('take.self', recipient.lang, { item }) };
    }
    return {
      kind: 'emote',
      source: sourceForActor(actor, recipient),
      text: s('take.others', recipient.lang, { actor: actor.name, item }),
    };
  });

  sendStats(actor);
  describeRoomToAll(actor.location);
}
