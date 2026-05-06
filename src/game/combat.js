import { broadcastToRoom, world, placeActor, queueNpcRespawn, placeItemInRoom, getRoom, addGoldToRoom } from './world.js';
import { applyEffect } from './effects.js';
import { awardXp } from './xp.js';
import { makeItemInstance } from './items.js';
import { roll } from './dice.js';
import { sourceForActor } from './sources.js';
import { sendStats } from './messages.js';
import { applyActiveEffect } from './activeEffects.js';
import { describeRoom, describeRoomToAll, pushTargetInfo } from './actions/look.js';
import { s, t, tListAt, pickListIndex } from '../i18n.js';
import { clearPlayerAttackQueue } from './playerCombatState.js';

const MAX_DODGE = 50;

function targetDisplay(target, lang) {
  if (target.kind === 'npc') return t(target.nameAcc ?? target.name, lang);
  return target.name;
}

function actorDisplay(actor, lang) {
  if (actor.kind === 'npc') return t(actor.name, lang);
  return actor.name;
}

export function executeAttack(actor, action, target) {
  if (!target) return;
  if (target.kind === 'npc' && target.alive === false) return;
  if (!target.stats || target.stats.hp <= 0) return;

  const acc = actor.stats?.accuracy ?? 0;
  const eva = target.stats?.evasion ?? 0;
  const dodge = Math.max(0, Math.min(MAX_DODGE, eva - acc));
  if (dodge > 0 && Math.floor(Math.random() * 100) + 1 <= dodge) {
    broadcastToRoom(actor.location, (recipient) => {
      const lang = recipient.lang;
      let text;
      if (recipient === actor) {
        text = s('combat.you_missed', lang, { target: targetDisplay(target, lang) });
      } else if (recipient === target) {
        text = s('combat.target_missed_you', lang, { actor: actorDisplay(actor, lang) });
      } else {
        text = s('combat.miss_observed', lang, {
          actor: actorDisplay(actor, lang),
          target: targetDisplay(target, lang),
        });
      }
      return { kind: 'emote', source: sourceForActor(actor, recipient), text };
    });
    registerAttackAggro(actor, target);
    if (actor.kind === 'player' && target.kind === 'npc') pushTargetInfo(actor, target);
    return;
  }

  const raw = roll(action.damage ?? '1', { actor, target });
  const def = target.stats.defense ?? 0;
  const final = Math.max(1, raw - def);

  const tmpl = action.templates;
  if (tmpl) {
    const idx = pickListIndex(tmpl);
    broadcastToRoom(actor.location, (recipient) => {
      const lang = recipient.lang;
      const from = t(actor.name, lang);
      const tname = targetDisplay(target, lang);
      const line = tListAt(tmpl, lang, idx)
        .replace(/\{actor\}/g, from)
        .replace(/\{target\}/g, tname);
      return { kind: 'emote', source: sourceForActor(actor, recipient), text: line };
    });
  }

  applyDamageWithFeedback(actor, target, final);

  if (action.onHit && target.stats?.hp > 0) {
    const hits = Array.isArray(action.onHit) ? action.onHit : [action.onHit];
    let applied = false;
    for (const hit of hits) {
      if (!hit.applyEffect) continue;
      if (Math.random() < (hit.chance ?? 1.0)) {
        applyActiveEffect(target, hit.applyEffect, 'combat', actor.name);
        applied = true;
      }
    }
    if (applied && target.kind === 'player' && target.session) sendStats(target);
  }
}

export function applyDamageWithFeedback(actor, target, amount) {
  if (!target?.stats || target.stats.hp <= 0) return 0;

  const result = applyEffect({ type: 'damage', amount }, { actor, target });
  const dealt = result?.dealt ?? 0;

  if (actor.session) {
    actor.session.send({
      kind: 'system',
      tone: 'combat',
      text: s('combat.you_hit', actor.lang, {
        target: targetDisplay(target, actor.lang),
        amount: dealt,
      }),
    });
  }
  if (target.session) {
    target.session.send({
      kind: 'system',
      tone: 'bad',
      text: s('combat.target_hit_you', target.lang, {
        actor: actorDisplay(actor, target.lang),
        amount: dealt,
      }),
    });
  }

  registerAttackAggro(actor, target);

  if (actor.kind === 'player') sendStats(actor);
  if (target.kind === 'player') sendStats(target);

  if (actor.kind === 'player' && target.kind === 'npc') pushTargetInfo(actor, target);

  if (target.stats.hp <= 0) {
    handleDeath(actor, target);
  }

  return dealt;
}

export function registerAttackAggro(actor, target) {
  if (!target || target.kind !== 'npc' || actor.kind !== 'player') return;
  if (!target.aggroAgainst) target.aggroAgainst = new Set();
  target.aggroAgainst.add(actor);
  target.disposition = 'hostile';
  target.aggressive = true;
  target.wasAttacked = true;

  if (target.pack) {
    const peers = world.actorsByRoom.get(target.location);
    if (peers) {
      for (const peer of peers) {
        if (peer === target) continue;
        if (peer.kind !== 'npc' || peer.alive === false) continue;
        if (peer.pack !== target.pack) continue;
        if (!peer.aggroAgainst) peer.aggroAgainst = new Set();
        peer.aggroAgainst.add(actor);
        peer.disposition = 'hostile';
        peer.aggressive = true;
      }
    }
  }
}

function handleDeath(killer, target) {
  if (target.kind === 'npc') return handleNpcDeath(killer, target);
  if (target.kind === 'player') return handlePlayerDeath(killer, target);
}

function handleNpcDeath(killer, npc) {
  const room = npc.location;
  broadcastToRoom(room, (recipient) => ({
    kind: 'emote',
    tone: 'death',
    text: s('combat.target_dies_observed', recipient.lang, {
      target: targetDisplay(npc, recipient.lang),
    }),
  }));

  npc.alive = false;

  if (room && world.actorsByRoom.has(room)) {
    world.actorsByRoom.get(room).delete(npc);
  }
  world.npcsByInstance.delete(npc.instanceId);

  const def = world.npcDefs.get(npc.defId);

  if (killer?.kind === 'player' && def?.xp) {
    awardXp(killer, def.xp, 'kill');
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
          target: targetDisplay(npc, recipient.lang),
          amount,
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
  clearPlayerAttackQueue(victim);
  victim.nextAttackAt = 0;
  const oldRoom = victim.location;

  broadcastToRoom(oldRoom, (recipient) => ({
    kind: 'emote',
    tone: 'death',
    text: s('combat.player_died_observed', recipient.lang, { name: victim.name }),
  }), victim);

  // Clear from all NPC aggro
  for (const npc of world.npcsByInstance.values()) {
    if (!npc.aggroAgainst?.has(victim)) continue;
    npc.aggroAgainst.delete(victim);
    if (npc.aggroAgainst.size === 0) {
      const def = world.npcDefs.get(npc.defId);
      npc.disposition = def?.disposition ?? 'neutral';
      npc.aggressive = !!def?.aggressive;
    }
  }

  // Move home, restore HP — world state updated immediately so others see the change
  victim.dying = true;
  placeActor(victim, 'home.cottage');
  victim.stats.hp = Math.ceil(victim.stats.hpMax / 2);
  victim.dirty = true;

  victim.session?.send({
    kind: 'system',
    tone: 'death',
    text: s('combat.you_died', victim.lang),
  });

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
    const home = getRoom('home.cottage');
    if (home) {
      victim.session?.send({
        kind: 'system',
        text: s('narration.you_arrive', victim.lang, { room: t(home.name, victim.lang) }),
      });
    }
    describeRoomToAll('home.cottage');
  }, 5000);
}

export function applyAggressionOnEnter(player, roomId) {
  if (!player || player.kind !== 'player' || !roomId) return;
  for (const npc of world.npcsByInstance.values()) {
    if (npc.location !== roomId) continue;
    if (!npc.aggressive) continue;
    if (npc.alive === false) continue;
    if (!npc.aggroAgainst) npc.aggroAgainst = new Set();
    npc.aggroAgainst.add(player);
    npc.disposition = 'hostile';
  }
}

export function clearAggroOnLeave(actor, fromRoomId) {
  for (const npc of world.npcsByInstance.values()) {
    if (npc.location !== fromRoomId) continue;
    if (!npc.aggroAgainst?.has(actor)) continue;
    npc.aggroAgainst.delete(actor);
    if (npc.aggroAgainst.size === 0) {
      const def = world.npcDefs.get(npc.defId);
      npc.disposition = def?.disposition ?? 'neutral';
      npc.aggressive = !!def?.aggressive;
    }
  }
}

export function aggroTargetInRoom(npc) {
  if (!npc.aggroAgainst || npc.aggroAgainst.size === 0) return null;
  const candidates = [];
  for (const a of npc.aggroAgainst) {
    if (a.location === npc.location && a.session && a.stats?.hp > 0) candidates.push(a);
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

