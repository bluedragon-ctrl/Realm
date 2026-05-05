import { itemsInRoom, removeItemFromRoom, broadcastToRoom } from '../world.js';
import { findItemInList } from '../items.js';
import { s, t } from '../../i18n.js';
import { sendStats } from '../messages.js';
import { describeRoom, describeRoomToAll } from './look.js';
import { sourceForActor } from '../sources.js';
import { isWearableKnown, learnWearable } from '../wearables.js';

export default function take(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('take.no_arg', actor.lang) });
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

  if (inst.def.wearable) {
    if (isWearableKnown(actor, inst.defId)) {
      const item = t(inst.def.nameAcc ?? inst.def.name, actor.lang);
      actor.session.send({ kind: 'error', text: s('take.already_known', actor.lang, { item }) });
      return;
    }
    removeItemFromRoom(inst, actor.location);
    learnWearable(actor, inst.defId);
    actor.dirty = true;
    broadcastToRoom(actor.location, (recipient) => {
      const item = t(inst.def.nameAcc ?? inst.def.name, recipient.lang);
      if (recipient === actor) {
        return { kind: 'system', tone: 'good', text: s('wearable.learned', recipient.lang, { item }) };
      }
      return {
        kind: 'emote',
        source: sourceForActor(actor, recipient),
        text: s('take.others', recipient.lang, { actor: actor.name, item }),
      };
    });
    sendStats(actor);
    describeRoomToAll(actor.location);
    return;
  }

  removeItemFromRoom(inst, actor.location);
  actor.inventory.push(inst);
  actor.dirty = true;

  broadcastToRoom(actor.location, (recipient) => {
    const item = t(inst.def.nameAcc ?? inst.def.name, recipient.lang);
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
