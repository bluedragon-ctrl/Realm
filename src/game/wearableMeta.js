// Schema-level constants for wearable items. Leaf module — no imports.

export const WEARABLE_SLOTS = ['body', 'head', 'weapon', 'amulet'];
export const WEARABLE_SLOT_SET = new Set(WEARABLE_SLOTS);

export const ALLOWED_BONUS_KEYS = new Set([
  'attack', 'defense', 'hpMax', 'mpMax', 'int', 'magicResist', 'accuracy', 'evasion', 'spd',
]);
