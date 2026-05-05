// Schema-level constants for effect content. Leaf module — no imports.

export const EFFECT_KINDS = new Set(['buff', 'debuff', 'neutral']);
export const EFFECT_STACKS = new Set(['refresh', 'stack', 'ignore']);
export const TICK_EFFECT_TYPES = new Set(['heal', 'damage']);
