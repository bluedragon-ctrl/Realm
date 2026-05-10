// Stub perception helper. Aggro acquisition and target selection both consult this
// before letting an NPC consider an actor. Today it always returns true; light, sleep,
// and stealth will extend it without combat code needing to change.
export function canPerceive(_observer, _target) {
  return true;
}
