import { broadcastToRoom, world, placeActor, queueNpcRespawn } from './world.js';
import { applyEffect } from './effects.js';
import { roll } from './dice.js';
import { sourceForActor } from './sources.js';
import { sendStats } from './messages.js';
import { describeRoom, describeRoomToAll } from './actions/look.js';
import { s, t, tListAt, pickListIndex } from '../i18n.js';

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
}

export function applyDamageWithFeedback(actor, target, amount) {
  if (!target?.stats || target.stats.hp <= 0) return 0;

  const result = applyEffect({ type: 'damage', amount }, { actor, target });
  const dealt = result?.dealt ?? 0;

  if (actor.session) {
    actor.session.send({
      kind: 'system',
      tone: 'good',
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

  if (target.kind === 'npc' && actor.kind === 'player') {
    if (!target.aggroAgainst) target.aggroAgainst = new Set();
    target.aggroAgainst.add(actor);
    target.disposition = 'hostile';
    target.aggressive = true;
    target.wasAttacked = true;
  }

  if (actor.kind === 'player') sendStats(actor);
  if (target.kind === 'player') sendStats(target);

  if (target.stats.hp <= 0) {
    handleDeath(actor, target);
  }

  return dealt;
}

function handleDeath(killer, target) {
  if (target.kind === 'npc') return handleNpcDeath(killer, target);
  if (target.kind === 'player') return handlePlayerDeath(killer, target);
}

function handleNpcDeath(killer, npc) {
  const room = npc.location;
  broadcastToRoom(room, (recipient) => ({
    kind: 'emote',
    source: 'ambient',
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
  const respawnTicks = def?.respawn?.ticks ?? 0;
  if (respawnTicks > 0 && def) {
    queueNpcRespawn(npc.defId, respawnTicks);
  }

  if (room) describeRoomToAll(room);
}

function handlePlayerDeath(killer, victim) {
  const oldRoom = victim.location;

  broadcastToRoom(oldRoom, (recipient) => ({
    kind: 'narration',
    source: 'ambient',
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

  // Move home, restore HP
  placeActor(victim, 'home.yard');
  victim.stats.hp = Math.ceil(victim.stats.hpMax / 2);
  victim.dirty = true;

  victim.session?.send({
    kind: 'system',
    tone: 'notice',
    text: s('combat.you_died', victim.lang),
  });
  victim.session?.send({
    kind: 'system',
    tone: 'notice',
    text: s('combat.you_respawn', victim.lang),
  });

  sendStats(victim);
  describeRoom(victim);
  if (oldRoom) describeRoomToAll(oldRoom);
  describeRoomToAll('home.yard');
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

