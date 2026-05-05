import { recomputeStats } from './wearables.js';

export const POINTS_PER_LEVEL = 2;

// Per-stat gain per allocated point. Keys are the canonical stat names
// used in PLAYER_DEFAULT_STATS / record.baseStats.
export const STAT_RATIOS = Object.freeze({
  attack: 1,
  defense: 1,
  int: 1,
  magicResist: 1,
  accuracy: 1,
  evasion: 1,
  hpMax: 5,
  mpMax: 2,
});

// Display order used by the client popover and by the `train` command help.
export const STAT_KEYS = Object.freeze([
  'attack', 'defense', 'int', 'magicResist',
  'accuracy', 'evasion', 'hpMax', 'mpMax',
]);

// Map user-typed aliases (English only — commands stay English) to canonical keys.
const ALIASES = {
  atk: 'attack', attack: 'attack',
  def: 'defense', defense: 'defense',
  int: 'int', intelligence: 'int',
  mr: 'magicResist', mres: 'magicResist', magicresist: 'magicResist',
  acc: 'accuracy', accuracy: 'accuracy',
  eva: 'evasion', evasion: 'evasion',
  hp: 'hpMax', hpmax: 'hpMax',
  mp: 'mpMax', mpmax: 'mpMax',
};

export function resolveStatKey(input) {
  if (typeof input !== 'string') return null;
  return ALIASES[input.toLowerCase()] ?? null;
}

export function ensureAllocationFields(record) {
  if (typeof record.unspentPoints !== 'number' || record.unspentPoints < 0) {
    record.unspentPoints = 0;
  }
  record.unspentPoints = Math.floor(record.unspentPoints);
  if (!record.allocated || typeof record.allocated !== 'object') {
    record.allocated = {};
  }
  for (const key of STAT_KEYS) {
    const v = record.allocated[key];
    record.allocated[key] = (typeof v === 'number' && v >= 0) ? Math.floor(v) : 0;
  }
}

// Spend one point on `key`. Returns true on success, false on validation failure.
export function applyTrain(actor, key) {
  const record = actor.record;
  ensureAllocationFields(record);
  if (!STAT_KEYS.includes(key)) return false;
  if (record.unspentPoints <= 0) return false;

  const gain = STAT_RATIOS[key];
  if (!record.baseStats) return false;
  record.baseStats[key] = (record.baseStats[key] ?? 0) + gain;
  // For HP/MP, bump current pool so the gain feels immediate.
  if (key === 'hpMax') record.baseStats.hp = (record.baseStats.hp ?? 0) + gain;
  if (key === 'mpMax') record.baseStats.mp = (record.baseStats.mp ?? 0) + gain;

  record.unspentPoints -= 1;
  record.allocated[key] = (record.allocated[key] ?? 0) + 1;
  actor.dirty = true;
  recomputeStats(actor);
  return true;
}

// Refund every allocated point back into unspentPoints and zero baseStats deltas.
export function resetAllocations(actor) {
  const record = actor.record;
  ensureAllocationFields(record);
  if (!record.baseStats) return 0;
  let refunded = 0;
  for (const key of STAT_KEYS) {
    const count = record.allocated[key] ?? 0;
    if (count <= 0) continue;
    const gain = STAT_RATIOS[key];
    record.baseStats[key] = (record.baseStats[key] ?? 0) - gain * count;
    if (key === 'hpMax') {
      record.baseStats.hp = Math.max(0, (record.baseStats.hp ?? 0) - gain * count);
    }
    if (key === 'mpMax') {
      record.baseStats.mp = Math.max(0, (record.baseStats.mp ?? 0) - gain * count);
    }
    record.allocated[key] = 0;
    refunded += count;
  }
  record.unspentPoints += refunded;
  actor.dirty = true;
  recomputeStats(actor);
  return refunded;
}
