// Schema-level constants for content (effects, spells, wearables, NPCs).
// Leaf module — no imports — safe to consume from runtime code and the content loader.

// ---------- effects ----------
export const EFFECT_KINDS = new Set(['buff', 'debuff', 'neutral']);
export const EFFECT_STACKS = new Set(['refresh', 'stack', 'ignore']);
export const TICK_EFFECT_TYPES = new Set(['heal', 'damage']);

// Source tags for active-effect instances. Used to attribute and filter (e.g. wearable
// effects are never serialized to the player save).
export const EFFECT_SOURCE = Object.freeze({
  SPELL: 'spell',
  CONSUMABLE: 'consumable',
  COMBAT: 'combat',
});
export const WEARABLE_SOURCE_PREFIX = 'wearable:';

// ---------- spells ----------
export const SPELL_TARGETS = new Set(['self', 'friendly', 'hostile', 'hostile_room', 'friendly_room', 'any']);

// ---------- wearables ----------
export const WEARABLE_SLOTS = ['body', 'head', 'weapon', 'amulet', 'ring', 'utility'];
export const WEARABLE_SLOT_SET = new Set(WEARABLE_SLOTS);

export const ALLOWED_BONUS_KEYS = new Set([
  'attack', 'defense', 'hpMax', 'mpMax', 'int', 'magicResist', 'accuracy', 'evasion', 'spd',
  'perception',
]);

// ---------- positions ----------
export const POSITIONS = new Set(['stand', 'sit', 'sleep']);

// ---------- npcs ----------
export const DISPOSITIONS = new Set(['friendly', 'neutral', 'hostile']);

// Authoritative list of behavior verbs an NPC def may use; the actual behavior implementations
// live in primitives.js.
export const PRIMITIVE_NAMES = new Set([
  'say',
  'emote',
  'wait',
  'move',
  'attack',
  'cast',
  'interact',
  'give_item',
  'flee',
  'wander',
]);
