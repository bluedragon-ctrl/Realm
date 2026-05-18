import { actorsInRoom, broadcastToRoom } from '../world.js';
import { resolveActorTarget } from '../targeting.js';
import { resolveName } from '../declension.js';
import { removeFromInventory } from '../inventory.js';
import { sourceForActor } from '../sources.js';
import { requireStanding } from '../positionGate.js';
import { findRemainingDeliveriesFor } from '../quests.js';
import { emit as emitEvent } from '../events.js';
import { s } from '../../i18n.js';

// Pick a unique recipient when the player types `deliver` with no target. Walks the room
// for friendly NPCs that the player owes something to. If exactly one matches we use it;
// zero is a "nobody is waiting" error and 2+ is an ambiguity error that asks for an explicit
// target. Hostile NPCs are skipped — handing a quest item to a mid-fight enemy is never
// the intent.
function findAutoRecipient(actor) {
  const candidates = [];
  for (const a of actorsInRoom(actor.location)) {
    if (a.kind !== 'npc' || a.alive === false) continue;
    if (a.disposition === 'hostile') continue;
    const remaining = findRemainingDeliveriesFor(actor, a);
    if (remaining.size === 0) continue;
    // Only count this NPC if the player actually holds at least one matching item — saves a
    // "you have nothing to give" follow-up after the auto-pick.
    let canDeliver = false;
    for (const [defId] of remaining) {
      if (actor.inventory.some(i => i.defId === defId)) { canDeliver = true; break; }
    }
    if (canDeliver) candidates.push(a);
  }
  if (candidates.length === 0) return { ok: false, reason: 'nothing' };
  if (candidates.length > 1) return { ok: false, reason: 'ambiguous' };
  return { ok: true, target: candidates[0] };
}

export default function deliver(actor, args) {
  const gate = requireStanding(actor);
  if (!gate.ok) { actor.session?.send({ kind: 'error', text: gate.msg }); return; }

  let target;
  if (!args || args.length === 0) {
    const res = findAutoRecipient(actor);
    if (!res.ok) {
      const key = res.reason === 'ambiguous' ? 'deliver.ambiguous_recipient' : 'deliver.nothing';
      actor.session.send({ kind: 'error', text: s(key, actor.lang) });
      return;
    }
    target = res.target;
  } else if (args[0]?.toLowerCase() !== 'to' || args.length < 2) {
    actor.session.send({ kind: 'error', text: s('deliver.usage', actor.lang) });
    return;
  } else {
    const targetQuery = args.slice(1).join(' ');
    target = resolveActorTarget(actor, targetQuery);
    if (!target) return;
  }

  if (target.kind !== 'npc' || target === actor) {
    actor.session.send({ kind: 'error', text: s('deliver.usage', actor.lang) });
    return;
  }

  const remaining = findRemainingDeliveriesFor(actor, target);
  if (remaining.size === 0) {
    actor.session.send({
      kind: 'error',
      text: s('deliver.nothing_for_target', actor.lang, {
        target: resolveName(target, 'nom', actor.lang),
      }),
    });
    return;
  }

  let totalDelivered = 0;
  for (const [defId, need] of remaining) {
    const insts = actor.inventory.filter(i => i.defId === defId);
    if (insts.length === 0) continue;
    const take = Math.min(insts.length, need);
    if (take <= 0) continue;
    const taken = insts.slice(0, take);
    const defSample = taken[0].def;
    for (const inst of taken) removeFromInventory(actor, inst);

    broadcastToRoom(actor.location, (recipient) => {
      const item = resolveName(defSample, 'acc', recipient.lang);
      const targetDat = resolveName(target, 'dat', recipient.lang);
      if (recipient === actor) {
        return {
          kind: 'system', tone: 'good',
          text: s('give.deliver.bulk.self', recipient.lang, { item, target: targetDat, count: take }),
        };
      }
      return {
        kind: 'emote',
        source: sourceForActor(actor, recipient),
        text: s('give.deliver.bulk.others', recipient.lang, {
          actor: actor.name, item, target: targetDat, count: take,
        }),
      };
    });

    emitEvent('item_given', { giver: actor, recipient: target, defId, count: take });
    totalDelivered += take;
  }

  if (totalDelivered === 0) {
    actor.session.send({
      kind: 'error',
      text: s('deliver.nothing_in_inventory', actor.lang, {
        target: resolveName(target, 'nom', actor.lang),
      }),
    });
  }
}
