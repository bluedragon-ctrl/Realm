import { world } from './world.js';
import { nameVariants } from '../i18n.js';

export const WEARABLE_SLOTS = ['body', 'head', 'weapon', 'amulet'];
export const ALLOWED_BONUS_KEYS = new Set(['attack', 'defense', 'hpMax', 'mpMax', 'int', 'magicResist', 'accuracy', 'evasion', 'spd']);

export function emptyEquipped() {
  const out = {};
  for (const slot of WEARABLE_SLOTS) out[slot] = null;
  return out;
}

export function normalizeEquipped(input) {
  const out = emptyEquipped();
  if (input && typeof input === 'object') {
    for (const slot of WEARABLE_SLOTS) {
      const v = input[slot];
      if (typeof v === 'string' && world.itemDefs.has(v)) {
        const def = world.itemDefs.get(v);
        if (def.wearable?.slot === slot) out[slot] = v;
      }
    }
  }
  return out;
}

export function normalizeKnownWearables(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const id of input) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    const def = world.itemDefs.get(id);
    if (!def?.wearable) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function recomputeStats(actor) {
  const base = actor.record.baseStats;
  if (!base) return;
  const computed = { ...base };
  for (const slot of WEARABLE_SLOTS) {
    const defId = actor.record.equipped?.[slot];
    if (!defId) continue;
    const def = world.itemDefs.get(defId);
    const bonus = def?.wearable?.bonus;
    if (!bonus) continue;
    for (const [k, v] of Object.entries(bonus)) {
      if (typeof v === 'number' && k in computed) computed[k] += v;
    }
  }
  if (computed.hpMax < 1) computed.hpMax = 1;
  if (computed.mpMax < 0) computed.mpMax = 0;
  if (computed.spd < 1) computed.spd = 1;
  const curHp = actor.stats?.hp ?? computed.hpMax;
  const curMp = actor.stats?.mp ?? computed.mpMax;
  computed.hp = Math.min(Math.max(0, curHp), computed.hpMax);
  computed.mp = Math.min(Math.max(0, curMp), computed.mpMax);
  Object.assign(actor.stats, computed);
}

export function findKnownWearable(actor, query) {
  const q = query.toLowerCase();
  let exact = null, sub = null, word = null;
  for (const defId of actor.record.knownWearables ?? []) {
    const def = world.itemDefs.get(defId);
    if (!def?.wearable) continue;
    const variants = [
      ...nameVariants(def.name),
      ...nameVariants(def.nameAcc),
      defId.toLowerCase(),
    ];
    if (variants.some(v => v === q)) { exact = def; break; }
    if (sub == null && variants.some(v => v.includes(q))) sub = def;
    if (word == null && variants.some(v => v.split(/\s+/).some(w => w === q))) word = def;
  }
  return exact ?? sub ?? word ?? null;
}

export function findEquippedWearable(actor, query) {
  const q = query.toLowerCase();
  let exact = null, sub = null, word = null;
  for (const slot of WEARABLE_SLOTS) {
    const defId = actor.record.equipped?.[slot];
    if (!defId) continue;
    const def = world.itemDefs.get(defId);
    if (!def?.wearable) continue;
    const variants = [
      ...nameVariants(def.name),
      ...nameVariants(def.nameAcc),
      defId.toLowerCase(),
      slot,
    ];
    if (variants.some(v => v === q)) { exact = { def, slot }; break; }
    if (sub == null && variants.some(v => v.includes(q))) sub = { def, slot };
    if (word == null && variants.some(v => v.split(/\s+/).some(w => w === q))) word = { def, slot };
  }
  return exact ?? sub ?? word ?? null;
}

export function isWearableKnown(actor, defId) {
  return (actor.record.knownWearables ?? []).includes(defId);
}

export function learnWearable(actor, defId) {
  if (!actor.record.knownWearables) actor.record.knownWearables = [];
  if (!actor.record.knownWearables.includes(defId)) {
    actor.record.knownWearables.push(defId);
  }
}
