// Schema-level constants for spell content. Leaf module — no imports — safe to consume from
// both runtime code (cast.js) and the content loader.

export const SPELL_TARGETS = new Set(['self', 'friendly', 'hostile', 'hostile_room', 'friendly_room', 'any']);
