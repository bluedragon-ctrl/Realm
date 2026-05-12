import { world, actorsInRoom, itemsInRoom, getRoom } from './world.js';
import { equippedSlots } from './wearables.js';

// Index doubles as brightness rank: 0=dark, 1=dim, 2=light.
export const LIGHT_LEVELS = ['dark', 'dim', 'light'];
export const LEVEL_RANK = Object.freeze(
  Object.fromEntries(LIGHT_LEVELS.map((lvl, i) => [lvl, i]))
);

function clamp(level) {
  return LIGHT_LEVELS[Math.max(0, Math.min(LIGHT_LEVELS.length - 1, LEVEL_RANK[level] ?? LEVEL_RANK.light))];
}

// Raise `current` up to at least `floor`. Same level or brighter wins.
export function clampUp(current, floor) {
  if (!floor) return current;
  return LEVEL_RANK[floor] > LEVEL_RANK[current] ? floor : current;
}

// Clamp `current` down to at most `ceiling`. Darker wins.
// Ceilings come from `darknessSource` on active effects (magic_darkness, magic_shadow).
export function clampDown(current, ceiling) {
  if (!ceiling) return current;
  return LEVEL_RANK[ceiling] < LEVEL_RANK[current] ? ceiling : current;
}

function readItemFloor(inst) {
  const ls = inst?.def?.lightSource;
  if (!ls?.level) return undefined;
  if (ls.toggle && !inst?.state?.lit) return undefined;
  return ls.level;
}

function readEffectFloor(actor) {
  if (!Array.isArray(actor.activeEffects)) return null;
  let best = null;
  for (const eff of actor.activeEffects) {
    const def = world.effectDefs.get(eff.defId);
    const lvl = def?.lightSource?.level;
    if (!lvl) continue;
    if (!best || LEVEL_RANK[lvl] > LEVEL_RANK[best]) best = lvl;
  }
  return best;
}

function readEffectCeiling(actor) {
  if (!Array.isArray(actor.activeEffects)) return null;
  let worst = null;
  for (const eff of actor.activeEffects) {
    const def = world.effectDefs.get(eff.defId);
    const lvl = def?.darknessSource?.level;
    if (!lvl) continue;
    if (!worst || LEVEL_RANK[lvl] < LEVEL_RANK[worst]) worst = lvl;
  }
  return worst;
}

// Equipped wearables: iterate via equippedSlots; worn item defs are looked up by defId.
function readActorInventoryFloor(actor) {
  const inv = actor.inventory ?? [];
  let best = null;
  for (const inst of inv) {
    const lvl = readItemFloor(inst);
    if (!lvl) continue;
    if (!best || LEVEL_RANK[lvl] > LEVEL_RANK[best]) best = lvl;
  }
  for (const { def } of equippedSlots(actor)) {
    const lvl = def?.lightSource?.level;
    if (!lvl) continue;
    if (!best || LEVEL_RANK[lvl] > LEVEL_RANK[best]) best = lvl;
  }
  return best;
}

// Returns the room's effective light level given all current contributions.
// Floors apply first (raise level), then ceilings (clamp down).
export function effectiveLight(room) {
  if (!room) return 'light';
  let level = clamp(room.lightBase ?? 'light');

  for (const entry of room.activeLight ?? []) {
    level = clampUp(level, entry?.lightSource?.level);
  }
  for (const inst of itemsInRoom(room.id)) {
    level = clampUp(level, readItemFloor(inst));
  }
  // Single pass over actors: collect floors (inventory + effect lightSource) and the
  // worst ceiling (effect darknessSource). Floors apply now; ceiling clamps last so the
  // darkest darkness source in the room wins over any light raises.
  let ceiling = null;
  for (const a of actorsInRoom(room.id)) {
    const fromInv = readActorInventoryFloor(a);
    if (fromInv) level = clampUp(level, fromInv);
    const fromEffects = readEffectFloor(a);
    if (fromEffects) level = clampUp(level, fromEffects);
    const c = readEffectCeiling(a);
    if (c && (!ceiling || LEVEL_RANK[c] < LEVEL_RANK[ceiling])) ceiling = c;
  }
  if (ceiling) level = clampDown(level, ceiling);
  return level;
}

// Returns the level `actor` actually perceives in `room`, applying actor-side modifiers
// (blindness clamps to dark, nightvision clamps up to dim). NPC `vision` is NOT read in v1.
export function perceivedLight(actor, room) {
  let level = effectiveLight(room);
  if (!actor) return level;
  if (Array.isArray(actor.activeEffects)) {
    for (const eff of actor.activeEffects) {
      const def = world.effectDefs.get(eff.defId);
      const p = def?.perception;
      if (p === 'blind') return 'dark';
      if (p === 'nightvision') level = clampUp(level, 'dim');
    }
  }
  return level;
}

// Composition seam: `look.js` and combat narration ask THIS, not `perceivedLight` directly.
// v2 invisibility + NPC vision land in `canPerceive` (per-target); this stays room-scoped.
export function canPerceiveRoom(actor, room) {
  return perceivedLight(actor, room);
}

// Convenience for broadcast filters: true when this recipient perceives their current
// room as `dark`. Used by combat narration, NPC primitives, etc. to skip lines that
// would name actors the observer can't see.
export function isDarkObserver(recipient) {
  return canPerceiveRoom(recipient, getRoom(recipient.location)) === 'dark';
}
