import { itemsInRoom, removeItemFromRoom, broadcastToRoom, getGoldInRoom, takeGoldFromRoom } from '../world.js';
import { findItemInList } from '../items.js';
import { addToInventory } from '../inventory.js';
import { s } from '../../i18n.js';
import { sendStats } from '../messages.js';
import { describeRoom, describeRoomToAll } from './look.js';
import { sourceForActor } from '../sources.js';
import { resolveName } from '../declension.js';
import { goldPhrase, isGoldQuery } from '../format.js';
import { requireStanding } from '../positionGate.js';

export default function take(actor, args) {
  const gate = requireStanding(actor);
  if (!gate.ok) {
    actor.session?.send({ kind: 'error', text: gate.msg });
    return;
  }
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
  const takeAll = args[0]?.toLowerCase() === 'all' && args.length > 1;
  const query = (takeAll ? args.slice(1) : args).join(' ');
  const list = itemsInRoom(actor.location);
  const pickable = list.filter(i => i.def.pickable !== false);
  const inst = findItemInList(pickable, query);
  if (!inst) {
    const anyMatch = findItemInList(list, query);
    if (anyMatch) {
      actor.session.send({ kind: 'error', text: s('take.not_pickable', actor.lang) });
      return;
    }
    actor.session.send({ kind: 'error', text: s('error.no_such_item_here', actor.lang, { query }) });
    return;
  }

  if (takeAll) {
    const matches = pickable.filter(i => i.defId === inst.defId);
    for (const m of matches) {
      removeItemFromRoom(m, actor.location);
      actor.inventory.push(m);
    }
    actor.dirty = true;
    const count = matches.length;
    broadcastToRoom(actor.location, (recipient) => {
      const item = resolveName(inst.def, 'acc', recipient.lang);
      if (recipient === actor) {
        return { kind: 'system', text: s('take.all.self', recipient.lang, { item, count }) };
      }
      return {
        kind: 'emote',
        source: sourceForActor(actor, recipient),
        text: s('take.all.others', recipient.lang, { actor: actor.name, item, count }),
      };
    });
    sendStats(actor);
    describeRoomToAll(actor.location);
    return;
  }

  removeItemFromRoom(inst, actor.location);
  addToInventory(actor, inst);

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

  describeRoomToAll(actor.location);
}
