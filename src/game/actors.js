import { PLAYER_DEFAULT_STATS, NPC_DEFAULT_STATS, normalizeStats, DEFAULT_COSTS, DEFAULT_NPC_REGEN } from './stats.js';
import { normalizeLang } from '../i18n.js';
import { ensureAllocationFields } from './leveling.js';
import { instanceFromSaved, makeItemInstance } from './items.js';
import { world } from './world.js';
import { normalizeEquipped, recomputeStats } from './wearables.js';
import { normalizeSavedActiveEffects, syncWearableEffects } from './activeEffects.js';

let nextNpcInstanceId = 1;

export function makePlayerActor(record, session, isAdmin) {
  record.stats = normalizeStats(record.stats, PLAYER_DEFAULT_STATS);
  record.baseStats = normalizeStats(record.baseStats ?? record.stats, PLAYER_DEFAULT_STATS);
  ensureAllocationFields(record);
  record.lang = normalizeLang(record.lang);
  if (!Array.isArray(record.inventory)) record.inventory = [];
  if (!Array.isArray(record.knownSpells)) record.knownSpells = [];
  if (!Array.isArray(record.foundSecrets)) record.foundSecrets = [];
  record.foundSecrets = record.foundSecrets.filter(x => typeof x === 'string');
  if (isAdmin) {
    for (const sid of world.spellDefs.keys()) {
      if (!record.knownSpells.includes(sid)) record.knownSpells.push(sid);
    }
  }
  let migratedKnownWearables = false;
  if (Array.isArray(record.knownWearables) && record.knownWearables.length > 0) {
    for (const id of record.knownWearables) {
      if (typeof id !== 'string') continue;
      const def = world.itemDefs.get(id);
      if (def?.wearable) record.inventory.push({ defId: id, state: {} });
    }
    migratedKnownWearables = true;
  }
  delete record.knownWearables;
  record.equipped = normalizeEquipped(record.equipped);
  record.activeEffects = normalizeSavedActiveEffects(record.activeEffects);
  if (typeof record.xp !== 'number') record.xp = 0;
  if (typeof record.level !== 'number') record.level = 1;
  if (typeof record.gold !== 'number' || record.gold < 0) record.gold = 0;
  if (record.nameForms == null || typeof record.nameForms !== 'object') {
    record.nameForms = { acc: null, dat: null, gen: null, voc: null };
  }
  if (!Array.isArray(record.visitedRooms)) record.visitedRooms = [];
  const visitedRooms = new Set(record.visitedRooms);
  const inventory = [];
  for (const saved of record.inventory) {
    const inst = instanceFromSaved(saved, world.itemDefs);
    if (inst) inventory.push(inst);
  }
  const actor = {
    kind: 'player',
    id: `p:${record.name.toLowerCase()}`,
    name: record.name,
    nameForms: record.nameForms,
    location: null,
    session,
    isAdmin,
    record,
    dirty: false,
    stats: record.stats,
    energy: 0,
    inventory,
    visitedRooms,
    following: null,
    get xp() { return record.xp; },
    get level() { return record.level; },
    get gold() { return record.gold; },
    get unspentPoints() { return record.unspentPoints; },
    get allocated() { return record.allocated; },
    set gold(v) { record.gold = Math.max(0, Math.floor(v)); },
    get knownSpells() { return record.knownSpells; },
    get equipped() { return record.equipped; },
    get activeEffects() { return record.activeEffects; },
    set activeEffects(v) { record.activeEffects = v; },
    get lang() { return record.lang; },
    set lang(v) { record.lang = normalizeLang(v); },
    inspecting: null,
    target: null,
    position: 'stand',
    lastCombatTick: -Infinity,
  };
  recomputeStats(actor);
  syncWearableEffects(actor);
  if (migratedKnownWearables) actor.dirty = true;
  return actor;
}

export function makeNpcActor(def, homeLocation = null) {
  const stats = normalizeStats(def.stats, NPC_DEFAULT_STATS);
  const inventory = [];
  for (const startId of def.inventory ?? []) {
    const itemDef = world.itemDefs.get(startId);
    if (itemDef) inventory.push(makeItemInstance(itemDef));
  }
  // Precompute per-behavior cost + max — these are immutable for the NPC's lifetime and
  // the tick loop reads them every tick.
  const behaviors = def.behaviors ?? [];
  const _resolvedCosts = behaviors.map(b => b.cost ?? DEFAULT_COSTS[b.primitive] ?? 12);
  const _maxCost = _resolvedCosts.length ? Math.max(12, ..._resolvedCosts) : 12;
  const regen = Object.freeze({
    hp: def.regen?.hp ?? DEFAULT_NPC_REGEN.hp,
    mp: def.regen?.mp ?? DEFAULT_NPC_REGEN.mp,
  });
  const instanceId = nextNpcInstanceId++;
  return {
    kind: 'npc',
    id: `n:${instanceId}`,
    instanceId,
    defId: def.id,
    homeLocation: homeLocation ?? def.location ?? null,
    baseStats: { ...stats },
    name: def.name,
    nameAcc: def.nameAcc ?? def.name,
    nameDat: def.nameDat ?? def.name,
    nameGen: def.nameGen ?? def.name,
    nameVoc: def.nameVoc ?? def.name,
    title: def.title ?? def.name,
    short: def.short ?? '',
    long: def.long ?? '',
    disposition: def.disposition ?? 'neutral',
    aggressive: !!def.aggressive,
    defDisposition: def.disposition ?? 'neutral',
    defAggressive: !!def.aggressive,
    mood: def.mood ?? 'calm',
    location: null,
    session: null,
    stats,
    energy: 0,
    inventory,
    behaviors,
    _resolvedCosts,
    _maxCost,
    regen,
    lastCombatTick: -Infinity,
    alive: true,
    activeEffects: [],
    pack: def.pack ?? null,
    exchanges: def.exchanges ?? null,
    following: null,
    position: def.position ?? 'stand',
    vision: def.vision ?? null,
  };
}
