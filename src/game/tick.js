import { world, allActors, actorsInRoom, countItemsInWorldMemory, placeItemInRoom, processNpcRespawns } from './world.js';
import { savePlayer } from '../persist/players.js';
import { runPrimitive } from './primitives.js';
import { DEFAULT_COSTS } from './stats.js';
import { serializeInventory, makeItemInstance } from './items.js';
import { tickActiveEffects, serializeActiveEffectsForSave, setEffectDamageHandler } from './activeEffects.js';
import { applyDamageWithFeedback } from './combat.js';
import { sendStats } from './messages.js';
import { pushTargetInfo } from './actions/look.js';

setEffectDamageHandler(applyDamageWithFeedback);

const TICK_MS = 1000;
const FLUSH_EVERY_TICKS = 50;

let tickCount = 0;
let timer = null;

async function flushDirty() {
  for (const actor of world.actorsByName.values()) {
    if (actor.kind !== 'player' || !actor.dirty) continue;
    actor.record.location = actor.location;
    actor.record.lastSeen = new Date().toISOString();
    actor.record.inventory = serializeInventory(actor.inventory);
    actor.record.activeEffects = serializeActiveEffectsForSave(actor);
    try {
      await savePlayer(actor.record);
      actor.dirty = false;
    } catch (err) {
      console.error(`failed to save player ${actor.name}:`, err);
    }
  }
}

function checkRequires(actor, requires) {
  if (!requires) return true;
  const type = typeof requires === 'string' ? requires : requires?.type;
  const params = typeof requires === 'object' ? requires : {};
  switch (type) {
    case 'aggro_target': {
      if (!actor.aggroAgainst || actor.aggroAgainst.size === 0) return false;
      for (const target of actor.aggroAgainst) {
        if (target.location === actor.location && target.session && target.stats?.hp > 0) return true;
      }
      return false;
    }
    case 'was_attacked':
      return !!actor.wasAttacked;
    case 'low_hp': {
      const ratio = params.ratio ?? 0.5;
      const max = actor.stats?.hpMax ?? 0;
      if (max <= 0) return false;
      return (actor.stats.hp / max) <= ratio;
    }
    default:
      return true;
  }
}

function pickBehavior(actor) {
  for (const b of actor.behaviors) {
    const cost = b.cost ?? DEFAULT_COSTS[b.primitive] ?? 12;
    if (actor.energy < cost) continue;
    if (!checkRequires(actor, b.requires)) continue;
    if (Math.random() < (b.chance ?? 1)) return b;
  }
  return null;
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

  if (actor.kind !== 'npc') return;
  actor.energy += actor.stats.spd;
  if (actor.energy < 12) return;

  const chosen = pickBehavior(actor);
  if (chosen) {
    const cost = chosen.cost ?? DEFAULT_COSTS[chosen.primitive] ?? 12;
    actor.energy -= cost;
    runPrimitive(actor, chosen);
  } else {
    actor.energy -= DEFAULT_COSTS.wait;
  }
  if (actor.energy < 0) actor.energy = 0;
}

function maybeRespawnItems() {
  for (const def of world.itemDefs.values()) {
    const respawnTicks = def.spawn?.respawnTicks ?? 0;
    if (respawnTicks <= 0) continue;
    if (tickCount % respawnTicks !== 0) continue;
    const cap = def.spawn.count ?? 1;
    const existing = countItemsInWorldMemory(def.id);
    const toSpawn = Math.max(0, cap - existing);
    for (let i = 0; i < toSpawn; i++) {
      placeItemInRoom(makeItemInstance(def), def.spawn.location);
    }
  }
}

function broadcastTick() {
  const msg = { kind: 'tick', count: tickCount };
  for (const a of world.actorsByName.values()) {
    if (a.kind === 'player' && a.session) a.session.send(msg);
  }
}

function onTick() {
  tickCount++;
  for (const actor of allActors()) {
    tickActor(actor);
  }
  maybeRespawnItems();
  processNpcRespawns();
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
