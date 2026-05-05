// Schema-level constants for NPC content. Leaf module — no imports.
// PRIMITIVE_NAMES is the authoritative list of behavior verbs an NPC def may use; the actual
// behavior implementations live in primitives.js.

export const DISPOSITIONS = new Set(['friendly', 'neutral', 'hostile']);

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
]);
