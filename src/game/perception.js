import { perceivedLight } from './light.js';
import { getRoom, world } from './world.js';

export function isInvisible(actor) {
  const list = actor?.activeEffects;
  if (!Array.isArray(list)) return false;
  for (const eff of list) {
    const def = world.effectDefs.get(eff.defId);
    if (def?.invisible) return true;
  }
  return false;
}

// Light-vision gate for aggro acquisition and target selection. Observer perceives the
// room through `perceivedLight`, which already folds in active effects (blindness /
// nightvision) and the NPC's static `vision` field. Sleeping observers see nothing.
// Per-target: an invisible target is unseen even in lit rooms. Self is always perceived.
// Player-side hidden content does NOT go through this hook — see `search` +
// `room.hiddenExits` / `hiddenFixtures`.
export function canPerceive(observer, target) {
  if (!observer) return false;
  if (target && observer === target) return true;
  if (observer.position === 'sleep') return false;
  const room = getRoom(observer.location);
  if (room && perceivedLight(observer, room) === 'dark') return false;
  if (target && isInvisible(target)) return false;
  return true;
}

// Per-tick spotting probability for passive aggression. light = 1 (every tick),
// dim = DIM_FACTOR (probabilistic), dark = 0 (never). Asleep / blind = 0.
// Callers compare against Math.random() — fractional accumulation would also work,
// but probabilistic keeps the existing integer hate model and the "1 tick to notice"
// semantics intact in `light`.
const DIM_FACTOR = 0.5;
export function perceptionFactor(observer, _target) {
  if (!observer) return 0;
  if (observer.position === 'sleep') return 0;
  const room = getRoom(observer.location);
  if (!room) return 1;
  const level = perceivedLight(observer, room);
  if (level === 'dark') return 0;
  if (level === 'dim') return DIM_FACTOR;
  return 1;
}

// Accuracy modifier applied when an attacker/caster can't see their target well.
// Folded into the existing ACC vs EVA dodge contest in combat.js so the penalty
// surfaces as extra miss chance (clamped at 95% by MAX_DODGE). Same helper will
// gate damage spells in cast.js.
const DARK_ACC_PENALTY = -80;
const DIM_ACC_PENALTY = -25;
export function targetingAccMod(observer) {
  if (!observer) return 0;
  if (observer.position === 'sleep') return DARK_ACC_PENALTY;
  const room = getRoom(observer.location);
  if (!room) return 0;
  const level = perceivedLight(observer, room);
  if (level === 'dark') return DARK_ACC_PENALTY;
  if (level === 'dim') return DIM_ACC_PENALTY;
  return 0;
}
