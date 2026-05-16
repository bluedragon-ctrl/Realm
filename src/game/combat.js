import { broadcastToRoom, world, placeActor, queueNpcRespawn, placeItemInRoom, getRoom, addGoldToRoom, RESPAWN_ROOM, allActors, actorsInRoom } from './world.js';
import { applyEffect, setDamageRouteHandler } from './effects.js';
import { isDarkObserver } from './light.js';
import { targetingAccMod, canPerceive, isInvisible as isInvisibleActor } from './perception.js';
import { applyActiveEffect, removeEffectsByDefId, clearAllActiveEffects } from './activeEffects.js';
import { awardXp } from './xp.js';
import { makeItemInstance } from './items.js';
import { roll } from './dice.js';
import { sourceForActor } from './sources.js';
import { sendStats } from './messages.js';
import { describeRoom, describeRoomToAll, pushTargetInfo } from './actions/look.js';
import { s, t, tListAt, pickListIndex } from '../i18n.js';
import { resolveName } from './declension.js';
import { fillPlaceholders } from './verbs.js';
import { goldPhrase } from './format.js';
import { clearPlayerActionQueue } from './playerCombatState.js';
import { unregisterWanderer } from './wandering.js';
import { EFFECT_SOURCE } from './contentMeta.js';
import { addHate, removeFromTable, hasAggroEntry, onAggroOnset } from './aggro.js';
import { getTick } from './clock.js';
import { setPosition } from './positionGate.js';
export { aggroTargetInRoom, hasInRoomTarget } from './aggro.js';

const MIN_DODGE = 5;
const MAX_DODGE = 95;
const MAX_CRIT = 50;
const CRIT_MULTIPLIER = 2;

function targetDisplay(target, lang) {
  return resolveName(target, 'acc', lang);
}

// Barrier effect uses `ticksLeft` as a unified clock + damage budget. Each absorbed point
// of damage costs one tick. When the budget runs out, the barrier expires immediately
// (eagerly, not on the next tick — otherwise a stale 0-budget barrier would briefly
// linger and read as "still active" before the tick loop sweeps it).
function absorbDamageWithBarrier(target, amount) {
  if (amount <= 0) return 0;
  const list = target.activeEffects;
  if (!Array.isArray(list) || list.length === 0) return 0;
  for (const inst of list) {
    const def = world.effectDefs.get(inst.defId);
    if (!def?.barrier) continue;
    const budget = Math.max(0, inst.ticksLeft ?? 0);
    if (budget <= 0) continue;
    const take = Math.min(amount, budget);
    inst.ticksLeft = budget - take;
    if (inst.ticksLeft <= 0) {
      removeEffectsByDefId(target, inst.defId);
    } else if (target.kind === 'player') {
      target.dirty = true;
      if (target.session) sendStats(target);
    }
    return take;
  }
  return 0;
}

function actorDisplay(actor, lang) {
  return resolveName(actor, 'nom', lang);
}

export function executeAttack(actor, action, target) {
  if (!target) return;
  if (target.kind === 'npc' && target.alive === false) return;
  if (!target.stats || target.stats.hp <= 0) return;

  // Attacker's perceived light: dark = -80 ACC, dim = -25 ACC. Pushes the dodge
  // contest toward (and up to) the MAX_DODGE cap when swinging at something the
  // attacker can't see clearly. Defender-side darkness is handled by separate
  // narration (combat.missed_by_unseen / hit_by_unseen).
  const acc = (actor.stats?.accuracy ?? 0) + targetingAccMod(actor);
  const eva = target.stats?.evasion ?? 0;
  const dodge = Math.max(MIN_DODGE, Math.min(MAX_DODGE, eva - acc));
  if (Math.floor(Math.random() * 100) + 1 <= dodge) {
    broadcastToRoom(actor.location, (recipient) => {
      const lang = recipient.lang;
      if (recipient === actor) {
        return { kind: 'emote', source: sourceForActor(actor, recipient),
          text: s('combat.you_missed', lang, { target: targetDisplay(target, lang) }) };
      }
      if (recipient === target) {
        if (!canPerceive(target, actor)) {
          return { kind: 'emote', source: sourceForActor(actor, recipient),
            text: s('combat.missed_by_unseen', lang) };
        }
        return { kind: 'emote', source: sourceForActor(actor, recipient),
          text: s('combat.target_missed_you', lang, { actor: actorDisplay(actor, lang) }) };
      }
      if (!canPerceive(recipient, actor)) return null;
      return { kind: 'emote', source: sourceForActor(actor, recipient),
        text: s('combat.miss_observed', lang, {
          actor: actorDisplay(actor, lang),
          target: targetDisplay(target, lang),
        }) };
    });
    registerAttackAggro(actor, target);
    if (actor.kind === 'player' && target.kind === 'npc') pushTargetInfo(actor, target);
    return;
  }

  const critChance = Math.max(0, Math.min(MAX_CRIT, acc - eva));
  const crit = critChance > 0 && Math.floor(Math.random() * 100) + 1 <= critChance;

  let raw = roll(action.damage ?? '1', { actor, target });
  if (crit) raw *= CRIT_MULTIPLIER;
  const final = action.ignoreDef
    ? Math.max(1, raw)
    : Math.max(Math.ceil(raw * 0.25), raw - (target.stats.defense ?? 0));

  const tmpl = action.templates;
  if (tmpl) {
    const idx = pickListIndex(tmpl);
    broadcastToRoom(actor.location, (recipient) => {
      if (recipient !== actor && !canPerceive(recipient, actor)) return null;
      const lang = recipient.lang;
      const line = fillPlaceholders(tListAt(tmpl, lang, idx), { actor, target, lang });
      return { kind: 'emote', source: sourceForActor(actor, recipient), text: line };
    });
  }

  if (crit) {
    broadcastToRoom(actor.location, (recipient) => {
      const lang = recipient.lang;
      let text;
      if (recipient === actor) {
        text = s('combat.you_crit', lang, { target: targetDisplay(target, lang) });
      } else if (recipient === target) {
        text = !canPerceive(target, actor)
          ? s('combat.crit_by_unseen', lang)
          : s('combat.target_crit_you', lang, { actor: actorDisplay(actor, lang) });
      } else {
        if (!canPerceive(recipient, actor)) return null;
        text = s('combat.crit_observed', lang, {
          actor: actorDisplay(actor, lang),
          target: targetDisplay(target, lang),
        });
      }
      return { kind: 'emote', tone: 'combat', source: sourceForActor(actor, recipient), text };
    });
  }

  applyDamageWithFeedback(actor, target, final);
  if (actor.kind === 'player') actor.target = target;

  if (action.onHit && target.stats?.hp > 0) {
    const hits = Array.isArray(action.onHit) ? action.onHit : [action.onHit];
    let applied = false;
    for (const hit of hits) {
      if (target.stats.hp <= 0) break;
      if (Math.random() >= (hit.chance ?? 1.0)) continue;
      if (hit.applyEffect) {
        applyActiveEffect(target, hit.applyEffect, EFFECT_SOURCE.COMBAT, typeof actor.name === 'string' ? actor.name : null);
        applied = true;
      } else if (hit.effect) {
        const result = applyEffect(hit.effect, { actor, target });
        if (result?.healed > 0) {
          if (actor.kind === 'player' && actor.session) {
            actor.session.send({ kind: 'system', tone: 'good', text: s('combat.drain_proc_self', actor.lang, { amount: result.healed }) });
          }
          if (target.kind === 'player' && target.session) {
            target.session.send({ kind: 'system', tone: 'bad', text: s('combat.drain_proc_target', target.lang, { actor: actorDisplay(actor, target.lang), amount: result.dealt }) });
          }
        }
        applied = true;
        if (target.stats.hp <= 0) { handleDeath(actor, target); break; }
      }
    }
    if (applied && target.stats?.hp > 0 && target.kind === 'player' && target.session) sendStats(target);
  }
}

export function applyDamageWithFeedback(actor, target, amount) {
  if (!target?.stats || target.stats.hp <= 0) return 0;

  const tick = getTick();
  if (actor) actor.lastCombatTick = tick;
  if (target) target.lastCombatTick = tick;

  // Damaging another actor reveals you — invisibility breaks on hostile action.
  if (actor && target && actor !== target && isInvisibleActor(actor)) {
    const removed = removeEffectsByDefId(actor, 'effect.invisibility');
    if (removed > 0 && actor.kind === 'player' && actor.session) {
      actor.session.send({
        kind: 'system', tone: 'flavor',
        text: s('effect.invisibility.broken', actor.lang),
      });
    }
  }

  if (target.position && target.position !== 'stand') {
    const was = target.position;
    setPosition(target, 'stand', was === 'sleep' ? 'woken' : 'stood');
  }

  // Barrier absorption: incoming damage is paid out of the effect's ticksLeft (which
  // doubles as a damage budget). Fully absorbed hits leave HP untouched and skip
  // thorns reflection (the attacker hit the barrier, not the wearer). Aggro still
  // registers below — the attacker did try to hit them.
  const absorbed = absorbDamageWithBarrier(target, amount);
  amount = Math.max(0, amount - absorbed);
  if (absorbed > 0 && target.session) {
    target.session.send({
      kind: 'system', tone: 'good',
      text: s('combat.barrier_absorbed', target.lang, { amount: absorbed }),
    });
  }

  const result = applyEffect({ type: 'damage', amount, _raw: true }, { actor, target });
  const dealt = result?.dealt ?? 0;

  const fullyAbsorbed = absorbed > 0 && dealt === 0;
  if (actor.session) {
    if (fullyAbsorbed) {
      actor.session.send({
        kind: 'system', tone: 'combat',
        text: s('combat.you_hit_barrier', actor.lang, {
          target: targetDisplay(target, actor.lang),
          amount: absorbed,
        }),
      });
    } else {
      actor.session.send({
        kind: 'system',
        tone: 'combat',
        text: s('combat.you_hit', actor.lang, {
          target: targetDisplay(target, actor.lang),
          amount: dealt,
        }),
      });
    }
  }
  if (target.session && !fullyAbsorbed) {
    if (!canPerceive(target, actor)) {
      target.session.send({
        kind: 'system',
        tone: 'bad',
        text: s('combat.hit_by_unseen', target.lang),
      });
    } else {
      target.session.send({
        kind: 'system',
        tone: 'bad',
        text: s('combat.target_hit_you', target.lang, {
          actor: actorDisplay(actor, target.lang),
          amount: dealt,
        }),
      });
    }
  }

  // Use full attempted swing for aggro, not just HP-dealt. Otherwise barrier secretly
  // suppresses hate generation and a barrier-protected ally never holds threat.
  registerAttackAggro(actor, target, dealt + absorbed);

  if (actor.kind === 'player') sendStats(actor);
  if (target.kind === 'player') sendStats(target);

  if (actor.kind === 'player' && target.kind === 'npc') pushTargetInfo(actor, target);

  if (dealt > 0 && actor && actor !== target && actor.stats?.hp > 0 && target.activeEffects?.length) {
    let reflectAmount = 0;
    for (const eff of target.activeEffects) {
      const def = world.effectDefs.get(eff.defId);
      if (def?.reflect > 0) reflectAmount += def.reflect;
    }
    if (reflectAmount > 0) {
      const reflectDealt = Math.min(actor.stats.hp, reflectAmount);
      actor.stats.hp -= reflectDealt;
      if (actor.kind === 'player' && actor.session) {
        actor.session.send({ kind: 'system', tone: 'bad', text: s('combat.thorns_received', actor.lang, { amount: reflectDealt }) });
        sendStats(actor);
      }
      if (target.kind === 'player' && target.session) {
        target.session.send({ kind: 'system', tone: 'good', text: s('combat.thorns_returned', target.lang, { actor: actorDisplay(actor, target.lang), amount: reflectDealt }) });
      }
      if (actor.stats.hp <= 0) handleDeath(target, actor);
    }
  }

  if (target.stats.hp <= 0) {
    handleDeath(actor, target);
  }

  return dealt;
}

// Records an attack on `target` by `actor`. `hate` is the amount added to the hate table
// — damage uses the dealt amount, misses/resists use 1. Flips the NPC to hostile, marks
// `wasAttacked`, sets the player's tagged target, and propagates pack aggro.
export function registerAttackAggro(actor, target, hate = 1) {
  if (!target || target.kind !== 'npc' || actor.kind !== 'player') return;
  addHate(target, actor, Math.max(1, hate));
  target.disposition = 'hostile';
  target.aggressive = true;
  target.wasAttacked = true;
  actor.target = target;

  if (target.pack) {
    const peers = world.actorsByRoom.get(target.location);
    if (peers) {
      const joined = [];
      for (const peer of peers) {
        if (peer === target) continue;
        if (peer.kind !== 'npc' || peer.alive === false) continue;
        if (peer.pack !== target.pack) continue;
        if (hasAggroEntry(peer, actor)) continue;
        addHate(peer, actor, 1);
        peer.disposition = 'hostile';
        peer.aggressive = true;
        joined.push(peer);
      }
      if (joined.length > 0) emitPackJoin(target.location, joined, actor);
    }
  }

  const allies = world.actorsByRoom.get(actor.location);
  if (allies) {
    for (const ally of allies) {
      if (ally.kind !== 'npc' || ally.alive === false) continue;
      if (!ally.summoned || ally.summonerId !== actor.id) continue;
      if (hasAggroEntry(ally, target)) continue;
      addHate(ally, target, Math.max(1, hate));
      ally.currentTarget = target;
    }
  }
}

function emitPackJoin(roomId, joiners, attacker) {
  broadcastToRoom(roomId, (recipient) => {
    if (recipient !== attacker && isDarkObserver(recipient)) return null;
    const lang = recipient.lang;
    const names = joiners.map(n => resolveName(n, 'nom', lang)).join(', ');
    return {
      kind: 'emote',
      tone: 'combat',
      text: s('aggro.pack_joins', lang, {
        joiners: names,
        target: recipient === attacker ? s('aggro.you', lang) : resolveName(attacker, 'dat', lang),
      }),
    };
  });
}

// Healer aggro: when a player heals someone in combat, every NPC in the healed actor's
// room that has the healed actor on its hate table adds floor(hp/4) hate against the
// healer. Heals under 4 HP therefore generate no aggro (intentional minimum). Self-heal
// exempt; cross-room healing isn't possible today and we don't model it here.
export function applyHealerAggro(healer, healed, hpRestored) {
  if (!healer || !healed || healer === healed) return;
  if (healer.kind !== 'player') return;
  if (!(hpRestored > 0) || !healed.location) return;
  const share = Math.floor(hpRestored / 4);
  if (share <= 0) return;
  for (const peer of actorsInRoom(healed.location)) {
    if (peer.kind !== 'npc' || peer.alive === false) continue;
    if (!hasAggroEntry(peer, healed)) continue;
    addHate(peer, healer, share);
    peer.disposition = 'hostile';
  }
}

function handleDeath(killer, target) {
  if (target.kind === 'npc') return handleNpcDeath(killer, target);
  if (target.kind === 'player') return handlePlayerDeath(killer, target);
}

function handleNpcDeath(killer, npc) {
  const room = npc.location;
  broadcastToRoom(room, (recipient) => {
    if (!canPerceive(recipient, npc)) return null;
    return {
      kind: 'emote',
      tone: 'death',
      text: s('combat.target_dies_observed', recipient.lang, {
        target: resolveName(npc, 'nom', recipient.lang),
      }),
    };
  });

  npc.alive = false;
  unregisterWanderer(npc);
  npc.following = null;
  for (const other of allActors()) {
    if (other === npc) continue;
    if (other.target === npc) other.target = null;
    if (other.following !== npc.id) continue;
    other.following = null;
    if (other.kind === 'player') other.dirty = true;
    if (other.session) {
      other.session.send({
        kind: 'system',
        text: s('follow.leader_left', other.lang, { name: resolveName(npc, 'acc', other.lang) }),
      });
    }
  }

  if (room && world.actorsByRoom.has(room)) {
    world.actorsByRoom.get(room).delete(npc);
  }
  world.npcsByInstance.delete(npc.instanceId);

  const def = world.npcDefs.get(npc.defId);

  // Summoned NPCs are ephemeral — no xp, no loot, no respawn enqueue. Bosses can't farm
  // sacrificial minions, and players can't farm scrolls by summoning meat.
  if (npc.summoned) {
    if (room) describeRoomToAll(room);
    return;
  }

  if (def?.xp) {
    const players = [];
    if (room && world.actorsByRoom.has(room)) {
      for (const a of world.actorsByRoom.get(room)) {
        if (a.kind === 'player') players.push(a);
      }
    }
    if (killer?.kind === 'player' && !players.includes(killer)) players.push(killer);
    if (players.length > 0) {
      const share = Math.floor(def.xp / players.length);
      const remainder = def.xp - share * players.length;
      for (const p of players) {
        const amount = (p === killer ? share + remainder : share);
        if (amount > 0) awardXp(p, amount, 'kill');
      }
    }
  }

  if (room && def?.loot) {
    for (const entry of def.loot) {
      if (Math.random() < (entry.chance ?? 1)) {
        const itemDef = world.itemDefs.get(entry.defId);
        if (itemDef) placeItemInRoom(makeItemInstance(itemDef), room);
      }
    }
  }

  if (room && def?.goldDrop && Math.random() < (def.goldDrop.chance ?? 1)) {
    const amount = Math.max(0, roll(def.goldDrop.formula ?? '0'));
    if (amount > 0) {
      addGoldToRoom(room, amount);
      broadcastToRoom(room, (recipient) => ({
        kind: 'system',
        tone: 'good',
        text: s('loot.gold_dropped', recipient.lang, {
          target: resolveName(npc, 'nom', recipient.lang),
          amount: goldPhrase(amount, recipient.lang),
        }),
      }));
    }
  }

  const respawnTicks = def?.respawn?.ticks ?? 0;
  if (respawnTicks > 0 && def) {
    queueNpcRespawn(npc.defId, respawnTicks, npc.homeLocation);
  }

  if (room) describeRoomToAll(room);
}

function handlePlayerDeath(killer, victim) {
  clearPlayerActionQueue(victim);
  victim.nextActionAt = 0;
  victim.following = null;
  victim.target = null;
  victim.dirty = true;
  for (const other of allActors()) {
    if (other === victim) continue;
    if (other.following !== victim.id) continue;
    other.following = null;
    if (other.kind === 'player') other.dirty = true;
    if (other.session) {
      other.session.send({
        kind: 'system',
        text: s('follow.leader_left', other.lang, { name: resolveName(victim, 'acc', other.lang) }),
      });
    }
  }
  const oldRoom = victim.location;

  broadcastToRoom(oldRoom, (recipient) => {
    if (!canPerceive(recipient, victim)) return null;
    return {
      kind: 'emote',
      tone: 'death',
      text: s('combat.player_died_observed', recipient.lang, { name: victim.name }),
    };
  }, victim);

  for (const npc of world.npcsByInstance.values()) {
    if (!npc.aggroAgainst?.has(victim)) continue;
    removeFromTable(npc, victim);
    if (npc.currentTarget === victim) npc.currentTarget = null;
  }

  // Move home, restore HP — world state updated immediately so others see the change
  victim.dying = true;
  placeActor(victim, RESPAWN_ROOM);
  clearAllActiveEffects(victim);
  victim.stats.hp = Math.ceil(victim.stats.hpMax / 2);
  victim.dirty = true;

  victim.session?.send({
    kind: 'system',
    tone: 'death',
    text: s('combat.you_died', victim.lang),
  });
  sendStats(victim);

  if (oldRoom) describeRoomToAll(oldRoom);

  // Delay respawn so the player has time to register what happened
  setTimeout(() => {
    victim.dying = false;
    victim.session?.send({
      kind: 'system',
      text: s('combat.you_respawn', victim.lang),
    });
    sendStats(victim);
    describeRoom(victim);
    const home = getRoom(RESPAWN_ROOM);
    if (home) {
      victim.session?.send({
        kind: 'system',
        text: s('narration.you_arrive', victim.lang, { room: t(home.name, victim.lang) }),
      });
    }
    describeRoomToAll(RESPAWN_ROOM);
  }, 5000);
}

export function applyAggressionOnEnter(player, roomId) {
  if (!player || player.kind !== 'player' || !roomId) return;
  const peers = world.actorsByRoom.get(roomId);
  if (!peers) return;
  // Only originally-aggressive NPCs auto-acquire entering players. A neutral mob whose
  // runtime `aggressive` got flipped by combat (registerAttackAggro) ignores newcomers —
  // same rule as the passive-aggression tick. Prevents "the rat you angered now hunts
  // every stranger who walks in" surprises.
  for (const npc of peers) {
    if (npc.kind !== 'npc') continue;
    if (!npc.defAggressive) continue;
    if (npc.alive === false) continue;
    if (!canPerceive(npc, player)) continue;
    addHate(npc, player, 1);
    npc.disposition = 'hostile';
  }
}

export function clearAggroOnLeave(actor, fromRoomId) {
  const peers = world.actorsByRoom.get(fromRoomId);
  if (!peers) return;
  for (const npc of peers) {
    if (npc.kind !== 'npc') continue;
    if (!npc.aggroAgainst?.has(actor)) continue;
    removeFromTable(npc, actor);
    if (npc.currentTarget === actor) npc.currentTarget = null;
  }
  if (actor.kind === 'player' && actor.target?.location !== actor.location) {
    actor.target = null;
  }
}

// Onset listener — emits "the rat growls at you" when any NPC's hate against an
// in-room player crosses non-positive → positive. Registered once at module load.
onAggroOnset((npc, actor) => {
  if (!npc?.location || actor?.location !== npc.location) return;
  if (actor.kind !== 'player') return;
  broadcastToRoom(npc.location, (recipient) => {
    if (recipient !== actor && !canPerceive(recipient, npc)) return null;
    const lang = recipient.lang;
    if (recipient === actor) {
      if (!canPerceive(actor, npc)) {
        return { kind: 'emote', tone: 'combat', text: s('aggro.onset_self_dark', lang) };
      }
      const npcName = resolveName(npc, 'nom', lang);
      return { kind: 'emote', tone: 'combat', text: s('aggro.onset_self', lang, { npc: npcName }) };
    }
    const npcName = resolveName(npc, 'nom', lang);
    return {
      kind: 'emote',
      tone: 'combat',
      text: s('aggro.onset_others', lang, {
        npc: npcName,
        target: resolveName(actor, 'acc', lang),
      }),
    };
  });
});

