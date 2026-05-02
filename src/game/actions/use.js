import { findInRoom, itemsInRoom } from '../world.js';
import { findItemInList, splitOnKeyword, removeFromList } from '../items.js';
import { s } from '../../i18n.js';
import { runVerb, hasForm } from '../verbs.js';
import { applyEffect, sendHealFeedback } from '../effects.js';
import { sendStats } from '../messages.js';

const SELF_TOKENS = new Set(['me', 'self', 'myself']);

export default function use(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('use.no_arg', actor.lang) });
    return;
  }
  const split = splitOnKeyword(args, 'on');
  const itemQuery = split ? split.before : args.join(' ');
  const targetQuery = split ? split.after : null;

  let inst = findItemInList(actor.inventory, itemQuery);
  if (!inst) {
    const roomFixtures = itemsInRoom(actor.location).filter(i => i.def.pickable === false);
    inst = findItemInList(roomFixtures, itemQuery);
  }
  if (!inst) {
    actor.session.send({ kind: 'error', text: s('error.no_such_item_inv', actor.lang, { query: itemQuery }) });
    return;
  }

  const useDef = inst.def.use;
  if (!useDef) {
    actor.session.send({ kind: 'error', text: s('use.cant', actor.lang) });
    return;
  }

  let target = null;
  if (targetQuery) {
    if (SELF_TOKENS.has(targetQuery.toLowerCase())) {
      target = actor;
    } else {
      target = findInRoom(actor.location, targetQuery);
      if (!target) {
        actor.session.send({ kind: 'error', text: s('error.no_such_target', actor.lang, { query: targetQuery }) });
        return;
      }
    }
  }

  const formKey = (!target || target === actor) ? 'no_target' : 'to_target';
  if (!hasForm(useDef, actor.lang, formKey)) {
    actor.session.send({ kind: 'error', text: s('use.cant', actor.lang) });
    return;
  }

  runVerb({ actor, def: useDef, targetActor: target });

  const result = applyEffect(useDef.effect, { actor, target });
  if (useDef.effect?.type === 'heal') {
    sendHealFeedback(actor, target, result);
  }

  if (useDef.consumable) {
    removeFromList(actor.inventory, inst);
    actor.dirty = true;
    sendStats(actor);
  }
}
