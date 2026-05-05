import { broadcastToRoom, world } from '../world.js';
import { s, t } from '../../i18n.js';
import { findWearableInInventory, recomputeStats } from '../wearables.js';
import { syncWearableEffects } from '../activeEffects.js';
import { sendStats } from '../messages.js';
import { sourceForActor } from '../sources.js';
import { makeItemInstance, removeFromList } from '../items.js';

export default function wear(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('wear.no_arg', actor.lang) });
    return;
  }
  const query = args.join(' ');
  const inst = findWearableInInventory(actor, query);
  if (!inst) {
    actor.session.send({ kind: 'error', text: s('wear.unknown', actor.lang, { query }) });
    return;
  }
  const def = inst.def;
  const slot = def.wearable.slot;
  if (actor.record.equipped[slot] === def.id) {
    actor.session.send({
      kind: 'error',
      text: s('wear.already_wearing', actor.lang, { item: t(def.name, actor.lang) }),
    });
    return;
  }
  removeFromList(actor.inventory, inst);
  const oldDefId = actor.record.equipped[slot];
  const oldDef = oldDefId ? world.itemDefs.get(oldDefId) : null;
  if (oldDef) actor.inventory.push(makeItemInstance(oldDef));
  actor.record.equipped[slot] = def.id;
  recomputeStats(actor);
  syncWearableEffects(actor);
  actor.dirty = true;

  broadcastToRoom(actor.location, (recipient) => {
    const item = t(def.nameAcc ?? def.name, recipient.lang);
    if (oldDef) {
      const oldItem = t(oldDef.nameAcc ?? oldDef.name, recipient.lang);
      if (recipient === actor) {
        return { kind: 'system', text: s('wear.swap_self', recipient.lang, { old: oldItem, item }) };
      }
      return {
        kind: 'emote',
        source: sourceForActor(actor, recipient),
        text: s('wear.swap_others', recipient.lang, { actor: actor.name, old: oldItem, item }),
      };
    }
    if (recipient === actor) {
      return { kind: 'system', text: s('wear.self', recipient.lang, { item }) };
    }
    return {
      kind: 'emote',
      source: sourceForActor(actor, recipient),
      text: s('wear.others', recipient.lang, { actor: actor.name, item }),
    };
  });
  sendStats(actor);
}
