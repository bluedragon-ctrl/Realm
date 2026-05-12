import { world, actorsInRoom, itemsInRoom } from './world.js';

// Order matters: index = brightness rank. Higher = brighter.
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
// v1 has no ceiling contributions; exported so spell.darkness lands without touching this file.
export function clampDown(current, ceiling) {
  if (!ceiling) return current;
  return LEVEL_RANK[ceiling] < LEVEL_RANK[current] ? ceiling : current;
}

function readItemFloor(inst) {
  const ls = inst?.def?.lightSource;
  return ls?.level;
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

function readActorInventoryFloor(actor) {
  const inv = actor.inventory ?? [];
  let best = null;
  for (const inst of inv) {
    const lvl = readItemFloor(inst);
    if (!lvl) continue;
    if (!best || LEVEL_RANK[lvl] > LEVEL_RANK[best]) best = lvl;
  }
  // Equipped wearables live in actor.equipment as { slot: instance } (see wearables.js).
  const eq = actor.equipment ?? {};
  for (const inst of Object.values(eq)) {
    const lvl = readItemFloor(inst);
    if (!lvl) continue;
    if (!best || LEVEL_RANK[lvl] > LEVEL_RANK[best]) best = lvl;
  }
  return best;
}

// Returns the room's effective light level given all current contributions.
// Floors apply first (raise level), then ceilings (clamp down). v1 emits only floors.
export function effectiveLight(room) {
  if (!room) return 'light';
  let level = clamp(room.lightBase ?? 'light');

  for (const entry of room.activeLight ?? []) {
    level = clampUp(level, entry?.lightSource?.level);
  }
  for (const inst of itemsInRoom(room.id)) {
    level = clampUp(level, readItemFloor(inst));
  }
  for (const a of actorsInRoom(room.id)) {
    const fromInv = readActorInventoryFloor(a);
    if (fromInv) level = clampUp(level, fromInv);
    const fromEffects = readEffectFloor(a);
    if (fromEffects) level = clampUp(level, fromEffects);
  }
  // Ceiling pass — no v1 contributions. spell.darkness will push entries here.
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
