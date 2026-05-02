import { PLAYER_DEFAULT_STATS, NPC_DEFAULT_STATS, normalizeStats } from './stats.js';
import { normalizeLang } from '../i18n.js';
import { instanceFromSaved, makeItemInstance } from './items.js';
import { world } from './world.js';

let nextNpcInstanceId = 1;

export function makePlayerActor(record, session, isAdmin) {
  record.stats = normalizeStats(record.stats, PLAYER_DEFAULT_STATS);
  record.lang = normalizeLang(record.lang);
  if (!Array.isArray(record.inventory)) record.inventory = [];
  if (!Array.isArray(record.knownSpells) || record.knownSpells.length === 0) {
    record.knownSpells = ['spell.heal', 'spell.spark'];
  }
  const inventory = [];
  for (const saved of record.inventory) {
    const inst = instanceFromSaved(saved, world.itemDefs);
    if (inst) inventory.push(inst);
  }
  return {
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
    get knownSpells() { return record.knownSpells; },
    get lang() { return record.lang; },
    set lang(v) { record.lang = normalizeLang(v); },
  };
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
  };
}
