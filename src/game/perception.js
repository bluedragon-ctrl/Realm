// Stub light-vision gate. Aggro acquisition and target selection both consult this
// before letting an NPC consider an actor. Today it always returns true; the light
// engine will later short-circuit it in dark rooms based on the observer's vision
// field and any room/inventory light sources. Player-side hidden content does NOT
// go through this hook — see `search` + `room.hiddenExits`/`hiddenFixtures`.
export function canPerceive(_observer, _target) {
  return true;
}
