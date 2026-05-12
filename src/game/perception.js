// Stub light-vision gate. Aggro acquisition and target selection both consult this
// before letting an NPC consider an actor. Today the only gate is the observer
// being asleep — sleeping observers see nothing. The light engine will later
// extend this to short-circuit on dark rooms based on the observer's vision
// field and any room/inventory light sources. Player-side hidden content does
// NOT go through this hook — see `search` + `room.hiddenExits`/`hiddenFixtures`.
export function canPerceive(observer, _target) {
  if (observer?.position === 'sleep') return false;
  return true;
}
