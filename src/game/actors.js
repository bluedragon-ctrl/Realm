import { PLAYER_DEFAULT_STATS, NPC_DEFAULT_STATS, normalizeStats } from './stats.js';
import { normalizeLang } from '../i18n.js';
import { instanceFromSaved, makeItemInstance } from './items.js';
import { world } from './world.js';
import { emptyEquipped, normalizeEquipped, normalizeKnownWearables, recomputeStats } from './wearables.js';
import { normalizeSavedActiveEffects, syncWearableEffects } from './activeEffects.js';

const ADMIN_GRANTED_SPELLS = ['spell.heal', 'spell.spark'];
const ADMIN_GRANTED_WEARABLES = ['item.amulet_regen'];

let nextNpcInstanceId = 1;

export function makePlayerActor(record, session, isAdmin) {
  record.stats = normalizeStats(record.stats, PLAYER_DEFAULT_STATS);
  record.baseStats = normalizeStats(record.baseStats ?? record.stats, PLAYER_DEFAULT_STATS);
  record.lang = normalizeLang(record.lang);
  if (!Array.isArray(record.inventory)) record.inventory = [];
  if (!Array.isArray(record.knownSpells)) record.knownSpells = [];
  if (isAdmin) {
    for (const sid of ADMIN_GRANTED_SPELLS) {
      if (world.spellDefs.has(sid) && !record.knownSpells.includes(sid)) record.knownSpells.push(sid);
    }
  }
  record.knownWearables = normalizeKnownWearables(record.knownWearables);
  if (isAdmin) {
    for (const iid of ADMIN_GRANTED_WEARABLES) {
      const def = world.itemDefs.get(iid);
      if (def?.wearable && !record.knownWearables.includes(iid)) record.knownWearables.push(iid);
    }
  }
  record.equipped = normalizeEquipped(record.equipped);
  record.activeEffects = normalizeSavedActiveEffects(record.activeEffects);
  if (typeof record.xp !== 'number') record.xp = 0;
  if (typeof record.level !== 'number') record.level = 1;
  if (typeof record.gold !== 'number' || record.gold < 0) record.gold = 0;
  if (!Array.isArray(record.visitedRooms)) record.visitedRooms = [];
  const visitedRooms = new Set(record.visitedRooms);
  const inventory = [];
  for (const saved of record.inventory) {
    const inst = instanceFromSaved(saved, world.itemDefs);
    if (inst) inventory.push(inst);
  }
  const actor = {
    kind: 'player',
    name: record.name,
    location: null,
    session,
    isAdmin,
    record,
    dirty: false,
    stats: record.stats,
    energy: 0,
    inventory,
    visitedRooms,
    get xp() { return record.xp; },
    get level() { return record.level; },
    get gold() { return record.gold; },
    set gold(v) { record.gold = Math.max(0, Math.floor(v)); },
    get knownSpells() { return record.knownSpells; },
    get knownWearables() { return record.knownWearables; },
    get equipped() { return record.equipped; },
    get activeEffects() { return record.activeEffects; },
    set activeEffects(v) { record.activeEffects = v; },
    get lang() { return record.lang; },
    set lang(v) { record.lang = normalizeLang(v); },
    inspecting: null,
  };
  recomputeStats(actor);
  syncWearableEffects(actor);
  return actor;
}

export function makeNpcActor(def) {
  const stats = normalizeStats(def.stats, NPC_DEFAULT_STATS);
  const inventory = [];
  for (const startId of def.inventory ?? []) {
    const itemDef = world.itemDefs.get(startId);
    if (itemDef) inventory.push(makeItemInstance(itemDef));
  }
  return {
    kind: 'npc',
    instanceId: nextNpcInstanceId++,
    defId: def.id,
    name: def.name,
    nameAcc: def.nameAcc ?? def.name,
    title: def.title ?? def.name,
    short: def.short ?? '',
    long: def.long ?? '',
    disposition: def.disposition ?? 'neutral',
    aggressive: !!def.aggressive,
    mood: def.mood ?? 'calm',
    location: null,
    session: null,
    stats,
    energy: 0,
    inventory,
    behaviors: def.behaviors ?? [],
    alive: true,
    activeEffects: [],
    pack: def.pack ?? null,
  };
}
