import { findInRoom, itemsInRoom } from '../world.js';
import { findItemInList, splitOnKeyword, removeFromList } from '../items.js';
import { s, t } from '../../i18n.js';
import { runVerb, hasForm } from '../verbs.js';
import { applyEffect, sendHealFeedback } from '../effects.js';
import { sendStats } from '../messages.js';
import { describeRoomToAll } from './look.js';

const SELF_TOKENS = new Set(['me', 'self', 'myself']);

function findItemTarget(actor, query) {
  const fixtures = itemsInRoom(actor.location);
  return findItemInList(fixtures, query) ?? findItemInList(actor.inventory, query);
}

function resolveInteraction(sourceInst, targetInst) {
  const tdef = targetInst.def;
  if (tdef.unlocks && tdef.unlocks.key === sourceInst.defId) {
    return { kind: 'unlock', spec: tdef.unlocks };
  }
  if (tdef.recipes && tdef.recipes[sourceInst.defId]) {
    return { kind: 'recipe', spec: tdef.recipes[sourceInst.defId] };
  }
  return null;
}

function runInteraction(actor, sourceInst, targetInst, interaction) {
  const { kind, spec } = interaction;
  const lang = actor.lang;

  runVerb({ actor, def: spec.verb, targetName: targetInst.def.nameAcc ?? targetInst.def.name });

  if (kind === 'unlock') {
    applyEffect({ type: 'unlock', exit: spec.exit }, { actor });
    actor.session.send({
      kind: 'system',
      tone: 'good',
      text: s('unlock.success', lang, { target: t(targetInst.def.name, lang) }),
    });
    if (spec.consume) {
      removeFromList(actor.inventory, sourceInst);
      actor.dirty = true;
      sendStats(actor);
    }
    describeRoomToAll(actor.location);
    return;
  }

  if (kind === 'recipe') {
    const result = applyEffect({ type: 'produce', item: spec.produces }, { actor });
    if (result?.produced) {
      actor.session.send({
        kind: 'system',
        tone: 'good',
        text: s('produce.you_made', lang, { item: t(result.name, lang) }),
      });
    }
    if (spec.consume) {
      removeFromList(actor.inventory, sourceInst);
    }
    actor.dirty = true;
    sendStats(actor);
    return;
  }
}

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

  let targetActor = null;
  let targetItem = null;
  if (targetQuery) {
    if (SELF_TOKENS.has(targetQuery.toLowerCase())) {
      targetActor = actor;
    } else {
      targetActor = findInRoom(actor.location, targetQuery);
      if (!targetActor) {
        targetItem = findItemTarget(actor, targetQuery);
        if (!targetItem) {
          actor.session.send({ kind: 'error', text: s('error.no_such_target', actor.lang, { query: targetQuery }) });
          return;
        }
      }
    }
  }

  if (targetItem) {
    if (targetItem === inst) {
      actor.session.send({ kind: 'error', text: s('use.cant', actor.lang) });
      return;
    }
    const interaction = resolveInteraction(inst, targetItem);
    if (!interaction) {
      actor.session.send({ kind: 'error', text: s('use.cant', actor.lang) });
      return;
    }
    runInteraction(actor, inst, targetItem, interaction);
    return;
  }

  const useDef = inst.def.use;
  if (!useDef) {
    actor.session.send({ kind: 'error', text: s('use.cant', actor.lang) });
    return;
  }

  const formKey = (!targetActor || targetActor === actor) ? 'no_target' : 'to_target';
  if (!hasForm(useDef, actor.lang, formKey)) {
    actor.session.send({ kind: 'error', text: s('use.cant', actor.lang) });
    return;
  }

  runVerb({ actor, def: useDef, targetActor });

  const result = applyEffect(useDef.effect, { actor, target: targetActor });
  if (useDef.effect?.type === 'heal') {
    sendHealFeedback(actor, targetActor, result);
  }

  if (useDef.consumable) {
    removeFromList(actor.inventory, inst);
    actor.dirty = true;
    sendStats(actor);
  }
}
