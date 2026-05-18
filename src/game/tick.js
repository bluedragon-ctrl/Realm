import { world, allActors, actorsInRoom, countItemsInWorldMemory, countItemsInRoomMemory, placeItemInRoom, processNpcRespawns, processConditionalSpawns } from './world.js';
import { savePlayer } from '../persist/players.js';
import { runPrimitive } from './primitives.js';
import { serializeInventory, makeItemInstance } from './items.js';
import { tickActiveEffects, serializeActiveEffectsForSave, setEffectDamageHandler, removeDebuffs, removeEffectsByDefId, setRoomRefreshHandler } from './activeEffects.js';
import { applyDamageWithFeedback, hasInRoomTarget } from './combat.js';
import { addHate, getHate } from './aggro.js';
import { perceptionFactor } from './perception.js';
import { setDamageRouteHandler, setCleanseHandler, setCureHandler } from './effects.js';
import { processSummonDespawn } from './summon.js';
import { tickEnvironment } from './environment.js';
import { sendStats } from './messages.js';
import { pushTargetInfo, describeRoomToAll } from './actions/look.js';
import { getTick, bumpTick } from './clock.js';
import { LULL_TICKS, PLAYER_REGEN_PERIOD } from './stats.js';

setEffectDamageHandler(applyDamageWithFeedback);
setDamageRouteHandler(applyDamageWithFeedback);
setCleanseHandler(removeDebuffs);
setCureHandler(removeEffectsByDefId);
setRoomRefreshHandler(describeRoomToAll);

const TICK_MS = 1000;
const FLUSH_EVERY_TICKS = 50;

let timer = null;

async function flushDirty() {
  const tasks = [];
  for (const actor of world.actorsByName.values()) {
    if (actor.kind !== 'player' || !actor.dirty) continue;
    actor.record.location = actor.location;
    actor.record.lastSeen = new Date().toISOString();
    actor.record.inventory = serializeInventory(actor.inventory);
    actor.record.gold = actor.gold ?? 0;
    const snapshot = { ...actor.record, activeEffects: serializeActiveEffectsForSave(actor) };
    actor.dirty = false;
    tasks.push(
      savePlayer(snapshot).catch(err => {
        console.error(`failed to save player ${actor.name}:`, err);
        actor.dirty = true;
      }),
    );
  }
  if (tasks.length) await Promise.all(tasks);
}

function checkRequires(actor, requires) {
  if (!requires) return true;
  const type = typeof requires === 'string' ? requires : requires?.type;
  const params = typeof requires === 'object' ? requires : {};
  switch (type) {
    case 'aggro_target':
      return hasInRoomTarget(actor);
    case 'was_attacked':
      return !!actor.wasAttacked;
    case 'low_hp': {
      const ratio = params.ratio ?? 0.5;
      const max = actor.stats?.hpMax ?? 0;
      if (max <= 0) return false;
      return (actor.stats.hp / max) <= ratio;
    }
    // Fires when at least one player in the NPC's room has the named quest in any state
    // other than `complete`. Covers both the "never started" case (lets the NPC nudge the
    // player toward discovery) and the "active" case (lets the NPC remind the player to
    // finish). Returns false once every nearby player has the quest marked complete, so
    // the hint goes quiet rather than nagging customers who already cleared it.
    case 'quest_unfulfilled': {
      const questId = params.quest;
      if (!questId || !actor.location) return false;
      const peers = world.actorsByRoom.get(actor.location);
      if (!peers) return false;
      for (const peer of peers) {
        if (peer.kind !== 'player') continue;
        const entry = peer.record?.quests?.[questId];
        if (!entry || entry.status !== 'complete') return true;
      }
      return false;
    }
    // Fires when at least one player in the NPC's room has the quest active (discovered
    // but not yet complete). Stricter than quest_unfulfilled — won't fire for players
    // who haven't yet started the quest. Use for chatter that should only happen mid-quest.
    case 'quest_active': {
      const questId = params.quest;
      if (!questId || !actor.location) return false;
      const peers = world.actorsByRoom.get(actor.location);
      if (!peers) return false;
      for (const peer of peers) {
        if (peer.kind !== 'player') continue;
        const entry = peer.record?.quests?.[questId];
        if (entry && entry.status === 'active') return true;
      }
      return false;
    }
    // Fires when at least one player in the NPC's room has the quest marked complete.
    // Use for "thanks again" / "you earned this" lines that should only fire post-quest.
    case 'quest_complete': {
      const questId = params.quest;
      if (!questId || !actor.location) return false;
      const peers = world.actorsByRoom.get(actor.location);
      if (!peers) return false;
      for (const peer of peers) {
        if (peer.kind !== 'player') continue;
        const entry = peer.record?.quests?.[questId];
        if (entry && entry.status === 'complete') return true;
      }
      return false;
    }
    default:
      return true;
  }
}

function pickBehavior(actor) {
  const costs = actor._resolvedCosts;
  for (let i = 0; i < actor.behaviors.length; i++) {
    const b = actor.behaviors[i];
    if (b.primitive === 'wander') continue;
    if (actor.energy < costs[i]) continue;
    if (!checkRequires(actor, b.requires)) continue;
    if (Math.random() < (b.chance ?? 1)) return { behavior: b, cost: costs[i] };
  }
  return null;
}

function tickPlayerRegen(actor) {
  const period = PLAYER_REGEN_PERIOD[actor.position];
  if (!period) return;
  const tick = getTick();
  const since = tick - (actor.lastCombatTick ?? -Infinity);
  if (since < LULL_TICKS) return;
  if (tick % period !== 0) return;
  const stats = actor.stats;
  const hpBefore = stats.hp;
  const mpBefore = stats.mp;
  if (stats.hp < stats.hpMax) stats.hp = Math.min(stats.hpMax, stats.hp + 1);
  if (stats.mp < stats.mpMax) stats.mp = Math.min(stats.mpMax, stats.mp + 1);
  if ((stats.hp !== hpBefore || stats.mp !== mpBefore) && actor.session) {
    sendStats(actor);
  }
}

function tickActor(actor) {
  if (actor.kind === 'npc' && !actor.alive) return;

  const effectsChanged = tickActiveEffects(actor);
  if (effectsChanged && actor.kind === 'player' && actor.session) sendStats(actor);
  if (effectsChanged && actor.kind === 'npc') {
    for (const p of actorsInRoom(actor.location)) {
      if (p.kind === 'player' && p.session && p.inspecting === actor) {
        pushTargetInfo(p, actor);
      }
    }
  }

  if (actor.kind === 'player') {
    tickPlayerRegen(actor);
    return;
  }
  if (actor.kind !== 'npc') return;
  actor.energy += actor.stats.spd;

  if (actor.position !== 'sleep') {
    // Passive aggression: only NPCs flagged aggressive in their def hunt on sight. Provoked
    // neutrals have aggressive=true at runtime but do not auto-acquire new players, so we
    // gate on the def-original flag. This is also what makes pacify's negative-hate cooldown
    // tick back to zero for bears and wolves.
    if (actor.defAggressive) {
      for (const peer of actorsInRoom(actor.location)) {
        if (peer.kind !== 'player' || !peer.session) continue;
        if (!(peer.stats?.hp > 0)) continue;
        // Light gate applies to fresh spotting only. Pacified state (negative hate)
        // decays at full +1/tick regardless of light, so a pacify in a dim cave
        // wears off on schedule.
        if (getHate(actor, peer) >= 0) {
          const factor = perceptionFactor(actor, peer);
          if (factor === 0) continue;
          if (factor < 1 && Math.random() >= factor) continue;
        }
        addHate(actor, peer, 1);
      }
    }

    if (hasInRoomTarget(actor)) {
      actor.lastCombatTick = getTick();
    }

    const chosen = pickBehavior(actor);
    if (chosen) {
      actor.energy -= chosen.cost;
      runPrimitive(actor, chosen.behavior);
    }
    if (actor.energy < 0) actor.energy = 0;
    if (actor.energy > actor._maxCost) actor.energy = actor._maxCost;
  }

  const tick = getTick();
  if (actor.alive && actor.regen && (tick - actor.lastCombatTick) >= LULL_TICKS) {
    const stats = actor.stats;
    const before = { hp: stats.hp, mp: stats.mp };
    if (stats.hp < stats.hpMax) {
      stats.hp = Math.min(stats.hpMax, stats.hp + actor.regen.hp);
    }
    if (stats.mp < stats.mpMax) {
      stats.mp = Math.min(stats.mpMax, stats.mp + actor.regen.mp);
    }
    if (stats.hp !== before.hp || stats.mp !== before.mp) {
      for (const p of actorsInRoom(actor.location)) {
        if (p.kind === 'player' && p.session && p.inspecting === actor) {
          pushTargetInfo(p, actor);
        }
      }
    }
  }
}

function maybeRespawnItems() {
  const tickCount = getTick();
  for (const def of world.itemDefs.values()) {
    const respawnTicks = def.spawn?.respawnTicks ?? 0;
    if (respawnTicks <= 0) continue;
    if (tickCount % respawnTicks !== 0) continue;
    if (def.spawn.locations) {
      for (const [roomId, perRoomCap] of Object.entries(def.spawn.locations)) {
        const existing = countItemsInRoomMemory(def.id, roomId);
        const toSpawn = Math.max(0, perRoomCap - existing);
        for (let i = 0; i < toSpawn; i++) {
          placeItemInRoom(makeItemInstance(def), roomId);
        }
      }
      continue;
    }
    const cap = def.spawn.count ?? 1;
    const existing = countItemsInWorldMemory(def.id);
    const toSpawn = Math.max(0, cap - existing);
    for (let i = 0; i < toSpawn; i++) {
      placeItemInRoom(makeItemInstance(def), def.spawn.location);
    }
  }
}

function broadcastTick() {
  const msg = { kind: 'tick', count: getTick() };
  for (const a of world.actorsByName.values()) {
    if (a.kind === 'player' && a.session) a.session.send(msg);
  }
}

function onTick() {
  const tickCount = bumpTick();
  for (const actor of allActors()) {
    tickActor(actor);
  }
  maybeRespawnItems();
  tickEnvironment();
  processSummonDespawn();
  processNpcRespawns();
  processConditionalSpawns();
  broadcastTick();
  if (tickCount % FLUSH_EVERY_TICKS === 0) flushDirty();
}

export function startTick() {
  if (timer) return;
  timer = setInterval(onTick, TICK_MS);
}

export function stopTick() {
  if (timer) clearInterval(timer);
  timer = null;
}

export { flushDirty };
