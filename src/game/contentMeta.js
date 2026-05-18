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

// ---------- damage ----------
// Damage school tags carried by attacks, damage spells, and damage-tick effects. Future
// content can add resists/affinities keyed on these. `physical` is the implicit default
// for melee + untyped damage; `magical` is the default for spells. Untagged damage routes
// resolve to `physical` via DEFAULT_DAMAGE_TYPE.
export const DAMAGE_TYPES = new Set(['physical', 'magical', 'fire', 'cold', 'holy', 'shadow', 'poison']);
export const DEFAULT_DAMAGE_TYPE = 'physical';

// ---------- spells ----------
export const SPELL_TARGETS = new Set(['self', 'friendly', 'hostile', 'hostile_room', 'friendly_room', 'any']);

// Effect types that resolve to a whole-room target list instead of a single actor.
// Shared between castSpell and the NPC `cast` primitive so the two stay in sync.
export const AOE_SPELL_EFFECT_TYPES = new Set([
  'damage_room_enemies',
  'heal_room_friendlies',
  'buff_room_friendlies',
]);

// ---------- light ----------
export const LIGHT_LEVEL_SET = new Set(['light', 'dim', 'dark']);
export const PERCEPTION_KINDS = new Set(['blind', 'nightvision']);
export const VISION_KINDS = new Set(['normal', 'low_light', 'nightvision', 'blind']);

// ---------- wearables ----------
export const WEARABLE_SLOTS = ['body', 'cloak', 'head', 'weapon', 'amulet', 'ring', 'utility'];
export const WEARABLE_SLOT_SET = new Set(WEARABLE_SLOTS);

export const ALLOWED_BONUS_KEYS = new Set([
  'attack', 'defense', 'hpMax', 'mpMax', 'int', 'magicResist', 'accuracy', 'evasion', 'spd',
  'perception',
]);

// ---------- items ----------
// Coarse buckets used for UI sectioning and sorting. Picker candidate filtering is
// driven by the fixture's `accepts` list, not by category — categories are display-only.
export const ITEM_CATEGORIES = new Set([
  'key', 'gear', 'reagent', 'tool', 'quest', 'consumable', 'food', 'misc',
]);

// ---------- environment ----------
// Room-level environmental hazards that periodically damage unprotected players. Wearables
// declare which of these they ward against via a `wards: [...]` tag list. Add new types
// here (heat for lava, drowning for underwater, miasma for swamp) as content needs them.
export const ENVIRONMENT_TYPES = new Set(['cold']);

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
  'summon',
]);
