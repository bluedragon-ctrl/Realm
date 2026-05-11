// World tick counter. Lives in its own module so any package can read the current
// tick without dragging tick.js along — tick.js itself imports from combat.js, so
// putting this here avoids a cycle. tick.js is the only caller of bumpTick().

let tickCount = 0;

export function getTick() {
  return tickCount;
}

export function bumpTick() {
  tickCount++;
  return tickCount;
}
