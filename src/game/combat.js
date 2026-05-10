import { broadcastToRoom, world, placeActor, queueNpcRespawn, placeItemInRoom, getRoom, addGoldToRoom, RESPAWN_ROOM, allActors } from './world.js';
import { applyEffect, setDamageRouteHandler } from './effects.js';
import { awardXp } from './xp.js';
import { makeItemInstance } from './items.js';
import { roll } from './dice.js';
import { sourceForActor } from './sources.js';
import { sendStats } from './messages.js';
import { applyActiveEffect } from './activeEffects.js';
import { describeRoom, describeRoomToAll, pushTargetInfo } from './actions/look.js';
import { s, t, tListAt, pickListIndex } from '../i18n.js';
import { resolveName } from './declension.js';
import { fillPlaceholders } from './verbs.js';
import { goldPhrase } from './format.js';
import { clearPlayerActionQueue } from './playerCombatState.js';
import { unregisterWanderer } from './wandering.js';
import { EFFECT_SOURCE } from './contentMeta.js';

const MAX_DODGE = 50;
const MAX_CRIT = 50;
const CRIT_MULTIPLIER = 2;

function targetDisplay(target, lang) {
  return resolveName(target, 'acc', lang);
}

function actorDisplay(actor, lang) {
  return resolveName(actor, 'nom', lang);
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

  const critChance = Math.max(0, Math.min(MAX_CRIT, acc - eva));
  const crit = critChance > 0 && Math.floor(Math.random() * 100) + 1 <= critChance;

  let raw = roll(action.damage ?? '1', { actor, target });
  if (crit) raw *= CRIT_MULTIPLIER;
  const final = action.ignoreDef ? Math.max(1, raw) : Math.max(1, raw - (target.stats.defense ?? 0));

  const tmpl = action.templates;
  if (tmpl) {
    const idx = pickListIndex(tmpl);
    broadcastToRoom(actor.location, (recipient) => {
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
        text = s('combat.target_crit_you', lang, { actor: actorDisplay(actor, lang) });
      } else {
        text = s('combat.crit_observed', lang, {
          actor: actorDisplay(actor, lang),
          target: targetDisplay(target, lang),
        });
      }
      return { kind: 'emote', tone: 'combat', source: sourceForActor(actor, recipient), text };
    });
  }

  applyDamageWithFeedback(actor, target, final);

  if (action.onHit && target.stats?.hp > 0) {
    const hits = Array.isArray(action.onHit) ? action.onHit : [action.onHit];
    let applied = false;
    for (const hit of hits) {
      if (!hit.applyEffect) continue;
      if (Math.random() < (hit.chance ?? 1.0)) {
        applyActiveEffect(target, hit.applyEffect, EFFECT_SOURCE.COMBAT, actor.name);
        applied = true;
      }
    }
    if (applied && target.kind === 'player' && target.session) sendStats(target);
  }
}

export function applyDamageWithFeedback(actor, target, amount) {
  if (!target?.stats || target.stats.hp <= 0) return 0;

  const result = applyEffect({ type: 'damage', amount, _raw: true }, { actor, target });
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
      target: resolveName(npc, 'nom', recipient.lang),
    }),
  }));

  npc.alive = false;
  unregisterWanderer(npc);
  npc.following = null;
  for (const other of allActors()) {
    if (other === npc) continue;
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
  placeActor(victim, RESPAWN_ROOM);
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
  for (const npc of peers) {
    if (npc.kind !== 'npc') continue;
    if (!npc.aggressive) continue;
    if (npc.alive === false) continue;
    if (!npc.aggroAgainst) npc.aggroAgainst = new Set();
    npc.aggroAgainst.add(player);
    npc.disposition = 'hostile';
  }
}

export function clearAggroOnLeave(actor, fromRoomId) {
  const peers = world.actorsByRoom.get(fromRoomId);
  if (!peers) return;
  for (const npc of peers) {
    if (npc.kind !== 'npc') continue;
    if (!npc.aggroAgainst?.has(actor)) continue;
    npc.aggroAgainst.delete(actor);
    if (npc.aggroAgainst.size === 0) {
      const def = world.npcDefs.get(npc.defId);
      npc.disposition = def?.disposition ?? 'neutral';
      npc.aggressive = !!def?.aggressive;
    }
  }
}

// Reservoir-sample one in-room, alive aggro target without materializing an array.
export function aggroTargetInRoom(npc) {
  if (!npc.aggroAgainst || npc.aggroAgainst.size === 0) return null;
  let chosen = null;
  let n = 0;
  for (const a of npc.aggroAgainst) {
    if (a.location !== npc.location || !a.session || !(a.stats?.hp > 0)) continue;
    n++;
    if (Math.floor(Math.random() * n) === 0) chosen = a;
  }
  return chosen;
}

