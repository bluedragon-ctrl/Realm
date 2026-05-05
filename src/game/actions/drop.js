import { placeItemInRoom, broadcastToRoom } from '../world.js';
import { findItemInList, removeFromList } from '../items.js';
import { s, t } from '../../i18n.js';
import { sendStats } from '../messages.js';
import { describeRoomToAll } from './look.js';
import { sourceForActor } from '../sources.js';

export default function drop(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('drop.no_arg', actor.lang) });
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
