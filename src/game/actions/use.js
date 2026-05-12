import { findInRoom, itemsInRoom, world } from '../world.js';
import { findItemInList, splitOnKeyword, removeFromList } from '../items.js';
import { s, t } from '../../i18n.js';
import { runVerb, hasForm } from '../verbs.js';
import { applyEffect, sendHealFeedback } from '../effects.js';
import { applyActiveEffect } from '../activeEffects.js';
import { sendStats } from '../messages.js';
import { describeRoomToAll } from './look.js';
import { awardXp } from '../xp.js';
import { isSelfToken } from '../targeting.js';
import { runExchange } from '../exchange.js';
import { EFFECT_SOURCE } from '../contentMeta.js';
import { applyHealerAggro } from '../combat.js';
import { requireStanding } from '../positionGate.js';

function findItemTarget(actor, query) {
  const fixtures = itemsInRoom(actor.location);
  return findItemInList(fixtures, query) ?? findItemInList(actor.inventory, query);
}

function resolveInteraction(sourceInst, targetInst) {
  const tdef = targetInst.def;
  if (tdef.unlocks && tdef.unlocks.key === sourceInst.defId) {
    return { kind: 'unlock', spec: tdef.unlocks };
  }
  const exchanges = tdef.exchanges ?? [];
  const match = exchanges.find(e =>
    e.flavor === 'craft' &&
    e.inputs.some(x => x.item === sourceInst.defId)
  );
  if (match) return { kind: 'craft', entry: match };
  return null;
}

function runInteraction(actor, sourceInst, targetInst, interaction) {
  const lang = actor.lang;
  if (interaction.kind === 'unlock') {
    const spec = interaction.spec;
    runVerb({ actor, def: spec.verb, targetName: targetInst.def.nameAcc ?? targetInst.def.name });
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
    awardXp(actor, spec.xp ?? 2, 'unlock');
    return;
  }
  if (interaction.kind === 'craft') {
    runExchange(actor, targetInst, interaction.entry, { units: 1 });
    return;
  }
}

export function consumeForActor(actor, inst, recipient) {
  const useDef = inst.def.use;
  runVerb({ actor, def: useDef, targetActor: recipient });
  if (useDef.effect?.type === 'apply_effect') {
    applyActiveEffect(recipient, useDef.effect.effectId, EFFECT_SOURCE.CONSUMABLE, actor.name);
    if (recipient.kind === 'player' && recipient.session) sendStats(recipient);
  } else if (useDef.effect?.type === 'heal') {
    const result = applyEffect(useDef.effect, { actor, target: recipient, fixture: inst, room: actor.location });
    sendHealFeedback(actor, recipient, result);
    applyHealerAggro(actor, recipient, result?.hpRestored ?? 0);
  }
  if (useDef.consumable) {
    removeFromList(actor.inventory, inst);
    actor.dirty = true;
  }
  sendStats(actor);
  if (recipient.kind === 'player' && recipient.session) sendStats(recipient);
}

export default function use(actor, args) {
  const gate = requireStanding(actor);
  if (!gate.ok) {
    actor.session?.send({ kind: 'error', text: gate.msg });
    return;
  }
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
    if (isSelfToken(targetQuery)) {
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
  // For toggleable light fixtures we narrate the action that's about to happen:
  // currently lit → useExtinguish (we're putting it out); currently unlit → use (we're lighting).
  let verbDef = useDef;
  if (useDef.effect?.type === 'toggle_light' && inst.state?.lit && inst.def.useExtinguish) {
    verbDef = inst.def.useExtinguish;
  }
  if (!hasForm(verbDef, actor.lang, formKey)) {
    actor.session.send({ kind: 'error', text: s('use.cant', actor.lang) });
    return;
  }

  if (useDef.effect?.type === 'open_chest') {
    const keyId = useDef.effect.key;
    const hasKey = !keyId || (actor.inventory?.some(i => i.defId === keyId) ?? false);
    if (!hasKey) {
      const keyDef = world.itemDefs.get(keyId);
      const keyName = keyDef ? t(keyDef.name, actor.lang) : keyId;
      actor.session.send({ kind: 'error', text: s('chest.need_key', actor.lang, { key: keyName }) });
      return;
    }
  }

  if (useDef.cost?.gold > 0) {
    if ((actor.gold ?? 0) < useDef.cost.gold) {
      actor.session.send({ kind: 'error', text: s('use.cant_afford', actor.lang, { amount: useDef.cost.gold }) });
      return;
    }
    actor.gold -= useDef.cost.gold;
    actor.dirty = true;
    sendStats(actor);
  }

  runVerb({ actor, def: verbDef, targetActor });

  if (useDef.effect?.type === 'apply_effect') {
    const recipient = targetActor ?? actor;
    applyActiveEffect(recipient, useDef.effect.effectId, EFFECT_SOURCE.CONSUMABLE, actor.name);
    if (recipient.kind === 'player' && recipient.session) sendStats(recipient);
    if (actor !== recipient && actor.kind === 'player') sendStats(actor);
  } else {
    const result = applyEffect(useDef.effect, { actor, target: targetActor, fixture: inst, room: actor.location });
    if (useDef.effect?.type === 'heal') {
      sendHealFeedback(actor, targetActor, result);
      applyHealerAggro(actor, targetActor ?? actor, result?.hpRestored ?? 0);
      if (result?.fixtureRemoved) describeRoomToAll(actor.location);
    } else if (useDef.effect?.type === 'unlock' && result?.unlocked) {
      describeRoomToAll(actor.location);
    } else if (useDef.effect?.type === 'open_chest' && result?.opened) {
      actor.session?.send({ kind: 'system', tone: 'good', text: s('chest.opened', actor.lang) });
      describeRoomToAll(actor.location);
      awardXp(actor, 5, 'open_chest');
    } else if (useDef.effect?.type === 'toggle_light' && result?.toggled) {
      describeRoomToAll(actor.location);
    } else if (useDef.effect?.type === 'teach_spell') {
      if (result?.learned) {
        const spellDef = world.spellDefs.get(useDef.effect.spell);
        const name = spellDef ? t(spellDef.name, actor.lang) : useDef.effect.spell;
        actor.session?.send({ kind: 'system', tone: 'good', text: s('spell.learned', actor.lang, { spell: name }) });
        sendStats(actor);
      } else if (result?.already) {
        actor.session?.send({ kind: 'system', tone: 'flavor', text: s('spell.already_known', actor.lang) });
      }
    }
  }

  if (useDef.consumable) {
    removeFromList(actor.inventory, inst);
    actor.dirty = true;
    sendStats(actor);
  }

  if (inst.def.grantsXp) {
    const amount = typeof inst.def.grantsXp === 'number' ? inst.def.grantsXp : 1;
    awardXp(actor, amount, 'use_item');
  }
}
