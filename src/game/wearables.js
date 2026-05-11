import { world } from './world.js';
import { nameVariants } from '../i18n.js';
import { allNameVariants } from './declension.js';
import { WEARABLE_SLOTS, ALLOWED_BONUS_KEYS } from './contentMeta.js';
import { findItemInList } from './items.js';
import { pickByVariants } from './declension.js';

export { WEARABLE_SLOTS, ALLOWED_BONUS_KEYS };

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

export function recomputeStats(actor) {
  const base = actor.record?.baseStats ?? actor.baseStats;
  if (!base) return;
  const computed = { ...base };
  const level = actor.record?.level ?? 1;
  computed.perception = (computed.int ?? 0) + Math.floor(level / 2);
  for (const { def } of equippedSlots(actor)) {
    const bonus = def?.wearable?.bonus;
    if (!bonus) continue;
    for (const [k, v] of Object.entries(bonus)) {
      if (typeof v === 'number' && k in computed) computed[k] += v;
    }
  }
  for (const inst of actor.activeEffects ?? []) {
    const def = world.effectDefs.get(inst.defId);
    const mod = def?.statMod;
    if (!mod) continue;
    for (const [k, v] of Object.entries(mod)) {
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

// Iterate the actor's equipped slots and yield `{slot, defId, def}` entries (def may be
// `undefined` if the equipped item def is missing — caller decides what to do).
// Centralizes the "loop over WEARABLE_SLOTS, read actor.record.equipped[slot]" pattern.
export function* equippedSlots(actor) {
  const equipped = actor.record?.equipped;
  if (!equipped) return;
  for (const slot of WEARABLE_SLOTS) {
    const defId = equipped[slot];
    if (!defId) continue;
    yield { slot, defId, def: world.itemDefs.get(defId) };
  }
}

export function findWearableInInventory(actor, query) {
  const list = (actor.inventory ?? []).filter(inst => inst.def?.wearable);
  return findItemInList(list, query);
}

export function findEquippedWearable(actor, query) {
  const candidates = [];
  for (const { slot, def } of equippedSlots(actor)) {
    if (def?.wearable) candidates.push({ slot, def });
  }
  return pickByVariants(candidates, query, ({ def, slot }) => [
    ...allNameVariants(def),
    def.id.toLowerCase(),
    slot,
  ]);
}
