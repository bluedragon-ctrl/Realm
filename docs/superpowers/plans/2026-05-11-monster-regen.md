# Monster Regen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the out-of-combat NPC regen from `docs/superpowers/specs/2026-05-11-monster-regen-design.md`: NPCs recover 1 HP and 1 MP per tick (per-def override possible) once they've been out of combat for `LULL_TICKS` ticks (default 6).

**Architecture:** A new leaf `src/game/clock.js` owns `tickCount`, exposing `getTick()` and `bumpTick()` so `combat.js` can read the tick number without importing `tick.js` (which already imports from `combat.js`). Each NPC carries `lastCombatTick` (stamped in `applyDamageWithFeedback` when it deals or receives damage, and in `tickActor` when it has an in-room positive-hate target) and a resolved `regen` block (from `def.regen` or `DEFAULT_NPC_REGEN`). At the end of each NPC tick, if alive and `tickCount - lastCombatTick >= LULL_TICKS` and below max on HP or MP, regen is applied and any inspecting player gets a fresh `pushTargetInfo`.

**Tech Stack:** Node 20+ ES modules, no build step, no test framework. Single dep `ws`.

**Verification model.** Same as recent plans in this repo — there is no automated test runner. Each task ends in one of:

- **Boot check.** Run `node server.js`. The server logs `Realm listening on…` when content loads cleanly. If a validator throws, the error is printed and the server exits — read the message, fix the offending file, retry.
- **Smoke check.** With the server running, open `http://localhost:8080` in a browser, log in as a test character (admin recommended for `spawn` commands), and verify the listed in-game behavior.
- **Code check.** For data-only changes, eyeball values in JSON or in the running process via a small inline snippet.

**Commit style.** One commit per task, message in the style of recent commits (lowercase first word, single line). No co-author trailer.

---

## File structure

New files:

- `src/game/clock.js` — Leaf module owning `tickCount`. Exports `getTick()` and `bumpTick()`. No other code in this file.

Modified files:

- `src/game/stats.js` — Add `DEFAULT_NPC_REGEN` and `LULL_TICKS` constants.
- `src/game/actors.js` — In `makeNpcActor`, init `lastCombatTick: -Infinity` and resolve `regen` from `def.regen` against `DEFAULT_NPC_REGEN`.
- `src/persist/validators/npc.js` — Validate optional `regen: { hp?, mp? }` block (non-negative integers, no extra keys).
- `src/game/tick.js` — Replace local `tickCount` with `getTick()`/`bumpTick()` from `clock.js`. In `tickActor` for npcs: stamp `lastCombatTick = getTick()` when `hasInRoomTarget(actor)`. After behavior block, apply regen if out of combat and below max, calling `pushTargetInfo` on any inspector.
- `src/game/combat.js` — In `applyDamageWithFeedback`, stamp `lastCombatTick = getTick()` on `actor` if npc and on `target` if npc. Import `getTick` from `clock.js`.

---

## Task 1: Add regen constants to stats.js

**Files:**
- Modify: `src/game/stats.js:1-50`

The defaults live next to the existing per-stat defaults. No behavior change yet — nothing reads these constants until later tasks.

- [ ] **Step 1: Add the two constants.**

Edit `src/game/stats.js`. After the existing `DEFAULT_COSTS` block (around line 39-49), add:

```javascript
export const DEFAULT_NPC_REGEN = Object.freeze({ hp: 1, mp: 1 });

export const LULL_TICKS = 6;
```

Both as top-level exports. `Object.freeze` mirrors the style of the other default blocks in this file.

- [ ] **Step 2: Boot check.**

Run `node server.js`. Server should start cleanly and log `Realm listening on…`. Stop the server (Ctrl+C).

- [ ] **Step 3: Commit.**

```bash
git add src/game/stats.js
git commit -m "stats: DEFAULT_NPC_REGEN and LULL_TICKS constants"
```

---

## Task 2: Create clock.js leaf module

**Files:**
- Create: `src/game/clock.js`

This module exists so `combat.js` can stamp `lastCombatTick` using the current tick number without creating a circular import (`tick.js` already imports from `combat.js`). It is a pure leaf — imports nothing from the game package.

- [ ] **Step 1: Write the module.**

Create `src/game/clock.js` with the following content (and nothing else):

```javascript
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
```

- [ ] **Step 2: Boot check.**

Run `node server.js`. Server should still start cleanly — nothing imports this module yet.

- [ ] **Step 3: Commit.**

```bash
git add src/game/clock.js
git commit -m "clock: leaf module owning the tick counter"
```

---

## Task 3: Migrate tick.js to use clock.js

**Files:**
- Modify: `src/game/tick.js:1-50` (the module-level `tickCount` and `onTick`)

Move ownership of `tickCount` out of `tick.js` into `clock.js`. Behavior must stay identical — `tickCount` increments by 1 per second, item respawn modulo + dirty-flush modulo continue to use the same number sequence.

- [ ] **Step 1: Add the clock import.**

Edit `src/game/tick.js`. In the top import block, add:

```javascript
import { getTick, bumpTick } from './clock.js';
```

- [ ] **Step 2: Remove the local counter.**

Delete the line `let tickCount = 0;` near the top of the file (around line 18). Leave the `TICK_MS` and `FLUSH_EVERY_TICKS` constants in place.

- [ ] **Step 3: Read tickCount via getTick() and bump via bumpTick().**

Replace the body of `onTick()` so the first line bumps via the new module and subsequent uses go through `getTick()`. The function should now read:

```javascript
function onTick() {
  const tickCount = bumpTick();
  for (const actor of allActors()) {
    tickActor(actor);
  }
  maybeRespawnItems();
  processNpcRespawns();
  processConditionalSpawns();
  broadcastTick();
  if (tickCount % FLUSH_EVERY_TICKS === 0) flushDirty();
}
```

Note: `maybeRespawnItems` and `broadcastTick` also read `tickCount` from module scope today. After the deletion in Step 2 they will not compile. Update them to read via `getTick()`:

```javascript
function maybeRespawnItems() {
  const tickCount = getTick();
  for (const def of world.itemDefs.values()) {
    // …existing body unchanged…
  }
}

function broadcastTick() {
  const msg = { kind: 'tick', count: getTick() };
  // …rest unchanged…
}
```

Inside `broadcastTick`, the existing line `const msg = { kind: 'tick', count: tickCount };` becomes `const msg = { kind: 'tick', count: getTick() };`.

- [ ] **Step 4: Boot check.**

Run `node server.js`. Server should start. Open `http://localhost:8080`, log in. The client tick counter (visible in network frames as `{ kind: 'tick', count: N }`) should increment once per second. Watch for at least 5 ticks to confirm.

- [ ] **Step 5: Commit.**

```bash
git add src/game/tick.js
git commit -m "tick: route tickCount through clock.js"
```

---

## Task 4: NPC validator accepts optional regen block

**Files:**
- Modify: `src/persist/validators/npc.js:9-65`

Authors may declare `regen: { hp: 2, mp: 0 }` on an NPC def. Validate it at boot so typos fail loudly.

- [ ] **Step 1: Add the validator block.**

Edit `src/persist/validators/npc.js`. After the `checkArray(behaviors, ctx, 'behaviors')` loop closes (around line 61, just before the `check(def.shop == null, ...)` line), insert:

```javascript
if (def.regen != null) {
  checkObject(def.regen, ctx, 'regen');
  for (const key of Object.keys(def.regen)) {
    check(key === 'hp' || key === 'mp', ctx, `regen.${key} is not allowed (only hp, mp)`);
    const v = def.regen[key];
    check(typeof v === 'number' && Number.isInteger(v) && v >= 0, ctx,
      `regen.${key} must be a non-negative integer`);
  }
}
```

Note: `checkObject` is already imported at the top of the file. No new imports needed. `checkPositiveInt` cannot be used here because it rejects `0`, which is a legal regen value (e.g. a construct with `mp: 0` regen).

- [ ] **Step 2: Boot check.**

Run `node server.js`. Server should still start cleanly — no content uses `regen` yet, so the new validator block is dormant.

- [ ] **Step 3: Code check — bad data fails loudly.**

Pick any existing NPC JSON under `content/npcs/` (e.g. `content/npcs/home/home.rat.json`). Add a deliberately bad `regen` block:

```json
"regen": { "hp": -1 }
```

Run `node server.js`. Expected: it exits with an error like `npc 'home.rat' (home.rat.json): regen.hp must be a non-negative integer`. Then **revert** the change (`git checkout -- <that-file>`) and confirm the server starts again.

- [ ] **Step 4: Commit.**

```bash
git add src/persist/validators/npc.js
git commit -m "npc validator: optional regen block (hp, mp non-negative ints)"
```

---

## Task 5: Resolve regen and lastCombatTick on NPC creation

**Files:**
- Modify: `src/game/actors.js:86-133`

Each NPC instance carries its own `regen` (resolved from def or default) and `lastCombatTick`. State is per-instance so two rats wounded separately recover on separate timers.

- [ ] **Step 1: Import the regen default.**

Edit `src/game/actors.js`. In the top import block, change the `stats.js` import line. Current line (around line 1):

```javascript
import { PLAYER_DEFAULT_STATS, NPC_DEFAULT_STATS, normalizeStats, DEFAULT_COSTS } from './stats.js';
```

Add `DEFAULT_NPC_REGEN` to the named imports:

```javascript
import { PLAYER_DEFAULT_STATS, NPC_DEFAULT_STATS, normalizeStats, DEFAULT_COSTS, DEFAULT_NPC_REGEN } from './stats.js';
```

- [ ] **Step 2: Resolve regen and init lastCombatTick in makeNpcActor.**

Edit `makeNpcActor`. Inside the function body, after the existing `_resolvedCosts` and `_maxCost` computation (around line 97), add:

```javascript
  const regen = Object.freeze({
    hp: def.regen?.hp ?? DEFAULT_NPC_REGEN.hp,
    mp: def.regen?.mp ?? DEFAULT_NPC_REGEN.mp,
  });
```

Then in the returned object literal, add two fields. Add them after the existing `_maxCost,` field (around line 126) and before `alive: true,`:

```javascript
    regen,
    lastCombatTick: -Infinity,
```

The full neighborhood of the returned object after the edit should read:

```javascript
    behaviors,
    _resolvedCosts,
    _maxCost,
    regen,
    lastCombatTick: -Infinity,
    alive: true,
    activeEffects: [],
    pack: def.pack ?? null,
```

- [ ] **Step 3: Boot check.**

Run `node server.js`. Server should start cleanly. Open the client and look at any NPC — the runtime behavior is unchanged (regen isn't applied yet).

- [ ] **Step 4: Code check — fields exist on a spawned NPC.**

With the server running, log in as admin, spawn or find any NPC, and use the admin inspect to confirm the instance carries the new fields. If your admin tooling doesn't expose them, briefly add a `console.log(npc.regen, npc.lastCombatTick)` inside `makeNpcActor` to verify, then **revert** that log before committing.

- [ ] **Step 5: Commit.**

```bash
git add src/game/actors.js
git commit -m "npc instance: regen and lastCombatTick fields"
```

---

## Task 6: Stamp lastCombatTick on every damage event

**Files:**
- Modify: `src/game/combat.js:113-152`

Both the attacker and the target (when they're NPCs) treat any damage as combat activity. `applyDamageWithFeedback` is the single funnel for melee, spell damage, DoT effects, and AoE — one edit covers everything.

- [ ] **Step 1: Import getTick.**

Edit `src/game/combat.js`. Add to the import block at the top:

```javascript
import { getTick } from './clock.js';
```

- [ ] **Step 2: Stamp inside applyDamageWithFeedback.**

In `applyDamageWithFeedback`, after the existing early-return guard `if (!target?.stats || target.stats.hp <= 0) return 0;` (around line 114) and before the `applyEffect` call, insert the stamp:

```javascript
  const tick = getTick();
  if (actor?.kind === 'npc') actor.lastCombatTick = tick;
  if (target?.kind === 'npc') target.lastCombatTick = tick;
```

The resulting opening of the function reads:

```javascript
export function applyDamageWithFeedback(actor, target, amount) {
  if (!target?.stats || target.stats.hp <= 0) return 0;

  const tick = getTick();
  if (actor?.kind === 'npc') actor.lastCombatTick = tick;
  if (target?.kind === 'npc') target.lastCombatTick = tick;

  const result = applyEffect({ type: 'damage', amount, _raw: true }, { actor, target });
  // …rest unchanged…
```

- [ ] **Step 3: Boot check.**

Run `node server.js`. Server should start cleanly.

- [ ] **Step 4: Commit.**

```bash
git add src/game/combat.js
git commit -m "combat: stamp lastCombatTick on damage in/out"
```

---

## Task 7: Apply regen in tickActor and stamp on in-room target

**Files:**
- Modify: `src/game/tick.js:73-108` (the `tickActor` function)

This is the core mechanic. Two pieces: (1) any tick where the NPC has an in-room positive-hate target counts as combat — even if it didn't actually swing — so the lull timer doesn't tick down while the player is just standing there. (2) After the behavior selection block, if the NPC is alive, out of combat, and below max on HP or MP, apply regen.

- [ ] **Step 1: Import LULL_TICKS and the inspector refresh helper.**

Edit `src/game/tick.js`. In the top import block, change the stats import. The current `actors.js`/`stats.js` related imports don't include `LULL_TICKS`. Add:

```javascript
import { LULL_TICKS } from './stats.js';
```

`pushTargetInfo` is already imported in this file — no change there. `hasInRoomTarget` is also already imported (via `combat.js`).

- [ ] **Step 2: Stamp lastCombatTick when an NPC has an in-room target.**

Edit `tickActor`. After the passive-aggression block (the `if (actor.defAggressive) { … }` block, around line 93-99) and before the `const chosen = pickBehavior(actor);` call, insert:

```javascript
  if (hasInRoomTarget(actor)) {
    actor.lastCombatTick = getTick();
  }
```

Add `getTick` to the existing `./clock.js` import (the import already exists in `tick.js` from Task 3 — change `import { getTick, bumpTick } from './clock.js';` if needed). Note: `getTick` is already imported per Task 3, so just confirm the named import list still contains it; if not, add it.

- [ ] **Step 3: Apply regen at the end of tickActor.**

Still in `tickActor`, after the existing energy clamp lines (`if (actor.energy < 0) actor.energy = 0;` and `if (actor.energy > actor._maxCost) actor.energy = actor._maxCost;` around line 106-107), insert the regen block:

```javascript
  const tick = getTick();
  if (actor.alive && actor.regen && (tick - actor.lastCombatTick) >= LULL_TICKS) {
    const stats = actor.stats;
    const before = { hp: stats.hp, mp: stats.mp };
    if (stats.hp < stats.hpMax) {
      stats.hp = Math.min(stats.hpMax, stats.hp + actor.regen.hp);
    }
    if (stats.mp < stats.mpMax) {
      stats.mp = Math.min(stats.mpMax, stats.mp + actor.regen.mp);
    }
    if (stats.hp !== before.hp || stats.mp !== before.mp) {
      for (const p of actorsInRoom(actor.location)) {
        if (p.kind === 'player' && p.session && p.inspecting === actor) {
          pushTargetInfo(p, actor);
        }
      }
    }
  }
```

`actor.alive` guards against ticking dead-but-not-yet-removed NPCs (defensive — `tickActor` already returns early for `!actor.alive` at line 74, but the explicit re-check makes the regen block independent of that guard's wording). `actor.regen` guards against the (impossible-by-current-design) case of an NPC built without `makeNpcActor`.

- [ ] **Step 4: Boot check.**

Run `node server.js`. Server should start cleanly.

- [ ] **Step 5: Smoke check — regen works for an out-of-combat wounded mob.**

With the server running, log in as admin. Find a low-HP NPC (e.g. a rat in `home.cottage` or wherever you have one). Attack it once with `attack rat` to wound it, then immediately leave the room (`flee` or any direction). Wait ~8–10 seconds. Re-enter the room and `look rat`. Expected: its HP is higher than when you left (it should have regenerated `getTick() - lastCombatTick - LULL_TICKS` HP, capped at hpMax). For a 1 HP/tick rat that was at 3/10 HP, after ~10s away you should see roughly 7–8 HP.

- [ ] **Step 6: Smoke check — regen does NOT happen during combat.**

Wound the rat again (`attack rat`). Stay in the room without attacking further. Wait 10 seconds. `look rat`. Its HP should not have changed (passive aggression on the rat keeps it targeting you, so `hasInRoomTarget` keeps stamping `lastCombatTick` every tick). If you see regen here, the in-room-target stamp from Step 2 is missing or wrong.

- [ ] **Step 7: Smoke check — pacified mob regenerates.**

Find or spawn a pacifiable mob (any non-aggressive NPC: bear or wolf in the design notes). Wound it, then cast `pacify` on it. Stand in the room. Wait 10 seconds. `look <mob>`. HP should rise. (Pacify reduces hate to negative, so `hasInRoomTarget` returns false; `lastCombatTick` does not get stamped; regen kicks in.)

- [ ] **Step 8: Commit.**

```bash
git add src/game/tick.js
git commit -m "tick: out-of-combat regen for npcs after LULL_TICKS"
```

---

## Task 8: Final smoke pass — exploit scenario

This task has no code. It verifies the original motivating scenario from the spec.

- [ ] **Step 1: Reproduce the exploit window.**

With the server running, find a mob you can credibly almost-kill but die to. (If none on the map fit, pick any aggressive NPC and `attack` it down to ~1 HP, then let it kill you — admin can adjust HP via `spawn` if needed.) Steps:

1. Engage the mob, bring it to ~1 HP, deliberately die.
2. Watch the respawn (~5 s) and walk back to the mob's room.
3. Run `look <mob>` immediately on arrival.

**Expected:** the mob's HP is well above 1. For a 10-HP rat with default 1 HP/tick and 6-tick lull, and a ~15-second round trip, the rat should be at roughly 9–10 HP (essentially full). The exploit is closed.

- [ ] **Step 2: Reproduce the "sprint back" success.**

This time, after dying, immediately walk back as fast as possible (skip any non-essential clicks). On arrival, immediately `attack <mob>`.

**Expected:** the mob is still wounded — under the lull window, it has not started regenerating yet. You can finish it. If `LULL_TICKS = 6` and the round trip is ~5 s, the rat should still be at ~1 HP when you swing.

If either smoke fails, dig into `lastCombatTick` stamps and the `getTick() - lastCombatTick >= LULL_TICKS` comparison. The most common bug is a stamp that fires too aggressively (rat never out of combat) or never (rat starts healing during combat).

- [ ] **Step 3: No commit.** Nothing changed.

---

## Verification summary

After all tasks:

- `node server.js` boots cleanly with no errors.
- `git log --oneline` shows 7 commits (one per task except Task 8).
- An OOC wounded NPC heals at 1 HP and 1 MP per tick by default after a 6-tick lull.
- An in-combat NPC (player in room, positive hate) never heals.
- A pacified NPC heals.
- Authoring `"regen": { "hp": 2 }` on an NPC def doubles its HP regen; bad values (negative, non-integer, extra keys) fail at boot with a clear error.
