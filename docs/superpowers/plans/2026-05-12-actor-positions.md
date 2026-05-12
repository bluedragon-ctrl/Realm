# Actor Positions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship actor positions from `docs/superpowers/specs/2026-05-12-actor-positions-design.md`. Every actor carries `position` (`"stand"` | `"sit"` | `"sleep"`). Sleeping observers fail `canPerceive`. Damage and targeted socials reactively wake. Player commands `stand` / `sit` / `sleep` change state. Active commands (`move`, `attack`, `flee`, `use`, `search`, hostile `cast`) require standing. NPC defs may declare a starting position. Two NPC defs start sleeping in v1 content (the fox pups and the bear).

**Architecture:** `position` lives on `actor` (transient, never on `record`). A leaf module `src/game/positionGate.js` exports `requireStanding(actor)` reused by every active command. `canPerceive` short-circuits on a sleeping observer. `applyDamageWithFeedback` and `runVerb` handle reactive transitions. NPC tick skips the behavior block when sleeping but keeps ticking effects and regen. Room renderer appends a localized suffix to non-standing actor names. `sendStats` ships `position` for client UI later.

**Tech Stack:** Node 20+ ES modules, no build step, no test framework. Single dep `ws`.

**Verification model.** Same as recent plans — there is no automated test runner. Each task ends in one of:

- **Boot check.** Run `node server.js`. The server logs `Realm listening on…` when content loads cleanly. If a validator throws, the error is printed and the server exits — read the message, fix the offending file, retry.
- **Smoke check.** With the server running, open `http://localhost:8080` in a browser, log in as a test character (admin recommended), and verify the listed in-game behavior.
- **Code check.** For data-only / wiring-only changes, eyeball values in JSON or in the running process via a small inline snippet.

**Commit style.** One commit per task, message in the style of recent commits (lowercase first word, single line). No co-author trailer.

---

## File structure

New files:

- `src/game/positionGate.js` — Leaf module exporting `requireStanding(actor)` and a small `setPosition(actor, next, opts)` helper. No imports from `world.js`, `combat.js`, or `tick.js` — keeps the file usable from any action.
- `src/game/actions/position.js` — Handlers for `stand`, `sit`, `sleep` commands.

Modified files:

- `src/game/contentMeta.js` — Add `POSITIONS` enum set.
- `src/persist/validators/npc.js` — Validate optional `position`.
- `src/game/actors.js` — Init `position` on player and NPC creation.
- `src/game/perception.js` — Sleeping observer returns false.
- `src/game/combat.js` — Reactive auto-stand in `applyDamageWithFeedback`.
- `src/game/verbs.js` — Wake sleeping target in `runVerb` before broadcast.
- `src/game/tick.js` — Skip NPC behavior block when sleeping.
- `src/game/commands.js` — Register `stand`, `sit`, `sleep`.
- `src/game/actions/move.js` — Gate.
- `src/game/actions/attack.js` — Gate.
- `src/game/actions/flee.js` — Gate (before the room check).
- `src/game/actions/use.js` — Gate.
- `src/game/actions/search.js` — Gate.
- `src/game/actions/cast.js` — Gate when resolved spell target is `"hostile"` or `"hostile_room"`.
- `src/game/actions/look.js` — Append position suffix to player names and NPC names in `describeRoom`.
- `src/game/messages/stats.js` — Include `position` in `buildStatsMsg`.
- `content/strings/en.json`, `content/strings/cs.json` — New `position.*` keys.
- `content/npcs/forest/forest.fox_pup.json` — `"position": "sleep"`.
- `content/npcs/forest/forest.bear.json` — `"position": "sleep"` and rewritten `short`.

---

## Task 1: Add POSITIONS enum and helper module

**Files:**
- Modify: `src/game/contentMeta.js`
- Create: `src/game/positionGate.js`

Establishes the position vocabulary and the shared gate helper. Nothing reads either yet — this is a pure scaffold task so later tasks can import without circular concerns.

- [ ] **Step 1: Add the enum to contentMeta.js.**

Edit `src/game/contentMeta.js`. Add near the other enums:

```javascript
export const POSITIONS = new Set(['stand', 'sit', 'sleep']);
```

- [ ] **Step 2: Create `src/game/positionGate.js`.**

```javascript
import { s } from '../i18n.js';
import { broadcastToRoom } from './world.js';
import { sourceForActor } from './sources.js';
import { resolveName } from './declension.js';

// Returns { ok: true } if standing; { ok: false, msg } otherwise.
// Active commands call this and short-circuit with the localized message.
export function requireStanding(actor) {
  if (actor.position === 'sleep') return { ok: false, msg: s('position.must_wake', actor.lang) };
  if (actor.position === 'sit') return { ok: false, msg: s('position.must_stand', actor.lang) };
  return { ok: true };
}

// Transition an actor to `next`. Emits self + others broadcasts for the
// transition keyed by `reason`: 'volitional' (the actor chose), 'woken'
// (damage or social woke a sleeper), 'stood' (damage stood a sitter).
// No-op if already in `next` and reason is 'volitional' — returns false then.
export function setPosition(actor, next, reason = 'volitional') {
  if (actor.position === next && reason === 'volitional') return false;
  actor.position = next;
  const keys = pickBroadcastKeys(next, reason);
  if (!keys) return true;
  broadcastToRoom(actor.location, (recipient) => {
    const lang = recipient.lang;
    const isAuthor = recipient === actor;
    const key = isAuthor ? keys.self : keys.others;
    const text = s(key, lang, { actor: resolveName(actor, 'nom', lang) });
    return { kind: 'emote', source: sourceForActor(actor, recipient), text };
  });
  return true;
}

function pickBroadcastKeys(next, reason) {
  if (reason === 'woken') return { self: 'position.woken.self', others: 'position.woken.others' };
  if (reason === 'stood') return { self: 'position.stood.self', others: 'position.stood.others' };
  // volitional
  return {
    self: `position.${next}.self`,
    others: `position.${next}.others`,
  };
}
```

- [ ] **Step 3: Boot check.**

Run `node server.js`. Should start cleanly. Stop (Ctrl+C). Nothing imports the new module yet, so this just confirms the file parses.

- [ ] **Step 4: Commit.**

```bash
git add src/game/contentMeta.js src/game/positionGate.js
git commit -m "positions: POSITIONS enum and gate helper"
```

---

## Task 2: Init `position` on actors

**Files:**
- Modify: `src/game/actors.js`

Players start standing; NPCs start at `def.position ?? "stand"`. Transient field on the actor object, never on `record`.

- [ ] **Step 1: Player init.**

In `src/game/actors.js`, locate the `makePlayerActor` actor literal (around line 50). Add `position: 'stand',` to the literal — sensible spot is right after `target: null,`:

```javascript
    inspecting: null,
    target: null,
    position: 'stand',
  };
```

- [ ] **Step 2: NPC init.**

In `makeNpcActor` (same file), the returned literal currently ends near `following: null,`. Add `position` to the literal, sourced from the def:

```javascript
    following: null,
    position: def.position ?? 'stand',
  };
```

- [ ] **Step 3: Boot check.**

Run `node server.js`. Server should start cleanly. No content currently declares `position`, so every NPC will land on `'stand'`. Stop (Ctrl+C).

- [ ] **Step 4: Code check.**

With the server running again, log in as a test character (or in your local dev workflow, sprinkle a `console.log` in `tickActor` to print `actor.position` for the first NPC tick) — confirm the field exists and is `'stand'`. Remove any debug logs before committing.

- [ ] **Step 5: Commit.**

```bash
git add src/game/actors.js
git commit -m "positions: init position on player and npc actors"
```

---

## Task 3: Validate NPC def `position`

**Files:**
- Modify: `src/persist/validators/npc.js`

Allow `def.position`, reject unknown values at boot.

- [ ] **Step 1: Import the enum.**

In `src/persist/validators/npc.js`, change the `contentMeta` import to include `POSITIONS`:

```javascript
import { PRIMITIVE_NAMES, DISPOSITIONS, POSITIONS } from '../../game/contentMeta.js';
```

- [ ] **Step 2: Add the check.**

Find the existing `checkEnum(def.disposition, DISPOSITIONS, ctx, 'disposition');` line. Immediately below it add:

```javascript
    if (def.position != null) {
      checkEnum(def.position, POSITIONS, ctx, 'position');
    }
```

- [ ] **Step 3: Negative boot check.**

Temporarily add `"position": "lounging"` to any NPC def (e.g. `content/npcs/forest/forest.bear.json`). Run `node server.js`. Expect the boot to fail with an error mentioning `position` and the bad value. Revert the file (`git checkout content/npcs/forest/forest.bear.json`).

- [ ] **Step 4: Positive boot check.**

Now add `"position": "sleep"` to the same file. Run `node server.js`. Expect clean boot. Revert again.

- [ ] **Step 5: Commit.**

```bash
git add src/persist/validators/npc.js
git commit -m "positions: validate optional npc position field"
```

---

## Task 4: Sleep gate in canPerceive

**Files:**
- Modify: `src/game/perception.js`

The single observer-side gate. Sleeping NPC observers can't acquire or select targets.

- [ ] **Step 1: Replace the body.**

Rewrite `src/game/perception.js` to:

```javascript
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
```

- [ ] **Step 2: Boot check.**

`node server.js`. Should start cleanly. Stop.

- [ ] **Step 3: Smoke check.**

Manually set a friendly NPC's position to `sleep` for one boot. Edit any aggressive NPC in `forest.cave` or similar; add `"position": "sleep"` to the def. Boot the server, walk into that room, wait a few ticks. The aggressive NPC should not attack you (its passive aggression loop now finds no perceivable target). Revert the file.

- [ ] **Step 4: Commit.**

```bash
git add src/game/perception.js
git commit -m "positions: canPerceive returns false for sleeping observer"
```

---

## Task 5: Skip behavior block for sleeping NPCs

**Files:**
- Modify: `src/game/tick.js`

Sleeping NPCs still tick effects and regen, but skip all behaviors (no growl, no wander, no attack — already gated by `canPerceive` but the explicit skip is cleaner and faster).

- [ ] **Step 1: Locate `tickActor`.**

Open `src/game/tick.js`. Find the `tickActor` function. Identify the start of the NPC behavior block (the loop that iterates `actor.behaviors`).

- [ ] **Step 2: Add the early-skip.**

Immediately before the behavior loop (after effects + regen have already ticked above it), add:

```javascript
  if (actor.kind === 'npc' && actor.position === 'sleep') return;
```

If `tickActor` has post-behavior cleanup (e.g. energy bookkeeping), confirm the early-return is safe — sleeping NPCs aren't acting, so their energy should still tick up against `_maxCost`. If the energy increment lives below the behavior loop, move the early-return below the energy increment but above the loop. Read the function end-to-end before placing the line.

- [ ] **Step 3: Boot check.**

`node server.js`. Clean boot.

- [ ] **Step 4: Smoke check.**

Edit a frequent-emote NPC (e.g. `forest.bear` with its 0.04 emote chance — though for visibility pick something noisier, like a wanderer if any). Set `"position": "sleep"` on the def, boot, walk into the room. Confirm no behavior lines fire. Revert.

- [ ] **Step 5: Commit.**

```bash
git add src/game/tick.js
git commit -m "positions: sleeping npcs skip behavior block"
```

---

## Task 6: Server strings for position

**Files:**
- Modify: `content/strings/en.json`, `content/strings/cs.json`

Land all `position.*` keys now so later tasks can call `s('position.…')` without each task re-touching the strings files.

- [ ] **Step 1: Add to `content/strings/en.json`.**

Add the following keys (preserve existing surrounding structure / commas):

```json
"position.stand.self": "You stand up.",
"position.stand.others": "{actor} stands up.",
"position.sit.self": "You sit down.",
"position.sit.others": "{actor} sits down.",
"position.sleep.self": "You lie down to sleep.",
"position.sleep.others": "{actor} lies down to sleep.",
"position.woken.self": "You jolt awake!",
"position.woken.others": "{actor} jolts awake!",
"position.stood.self": "You scramble to your feet.",
"position.stood.others": "{actor} scrambles to their feet.",
"position.must_stand": "You must stand first.",
"position.must_wake": "You're asleep.",
"position.in_combat": "Not while fighting.",
"position.already.stand": "You are already standing.",
"position.already.sit": "You are already sitting.",
"position.already.sleep": "You are already asleep.",
"position.suffix.sit": "(sitting)",
"position.suffix.sleep": "(asleep)"
```

- [ ] **Step 2: Add to `content/strings/cs.json` (parallel keys).**

```json
"position.stand.self": "Postavíš se.",
"position.stand.others": "{actor} se postaví.",
"position.sit.self": "Sedneš si.",
"position.sit.others": "{actor} si sedne.",
"position.sleep.self": "Lehneš si a usneš.",
"position.sleep.others": "{actor} si lehne a usne.",
"position.woken.self": "Probudíš se!",
"position.woken.others": "{actor} se probudí!",
"position.stood.self": "Vyskočíš na nohy.",
"position.stood.others": "{actor} vyskočí na nohy.",
"position.must_stand": "Nejdřív se postav.",
"position.must_wake": "Spíš.",
"position.in_combat": "Ne uprostřed boje.",
"position.already.stand": "Už stojíš.",
"position.already.sit": "Už sedíš.",
"position.already.sleep": "Už spíš.",
"position.suffix.sit": "(sedí)",
"position.suffix.sleep": "(spí)"
```

- [ ] **Step 3: Boot check.**

`node server.js`. Clean boot — the strings loader should accept both files without complaint (it just reads JSON).

- [ ] **Step 4: Commit.**

```bash
git add content/strings/en.json content/strings/cs.json
git commit -m "strings: position.* keys (en + cs)"
```

---

## Task 7: `stand` / `sit` / `sleep` commands

**Files:**
- Create: `src/game/actions/position.js`
- Modify: `src/game/commands.js`

Three trivial handlers that share a helper. Combat gate applies to `sit` and `sleep` only.

- [ ] **Step 1: Create `src/game/actions/position.js`.**

```javascript
import { s } from '../../i18n.js';
import { setPosition } from '../positionGate.js';
import { actorsInRoom } from '../world.js';
import { getHate } from '../aggro.js';

function inCombat(actor) {
  for (const a of actorsInRoom(actor.location)) {
    if (a.kind !== 'npc') continue;
    if (getHate(a, actor) > 0) return true;
  }
  return false;
}

function changePosition(actor, next) {
  if (actor.position === next) {
    actor.session?.send({ kind: 'system', text: s(`position.already.${next}`, actor.lang) });
    return;
  }
  if ((next === 'sit' || next === 'sleep') && inCombat(actor)) {
    actor.session?.send({ kind: 'error', text: s('position.in_combat', actor.lang) });
    return;
  }
  setPosition(actor, next, 'volitional');
}

export function stand(actor) { changePosition(actor, 'stand'); }
export function sit(actor)   { changePosition(actor, 'sit'); }
export function sleep(actor) { changePosition(actor, 'sleep'); }
```

- [ ] **Step 2: Register in `src/game/commands.js`.**

Add the import alongside other action imports:

```javascript
import { stand, sit, sleep } from './actions/position.js';
```

Add to the `COMMANDS` map:

```javascript
  stand,
  sit,
  sleep,
```

- [ ] **Step 3: Boot check.**

`node server.js`. Clean boot.

- [ ] **Step 4: Smoke check.**

Log in. Type `sit` → see "You sit down."; another player in the same room sees "{you} sits down." Type `sit` again → "You are already sitting." Type `sleep` → "You lie down to sleep." Type `stand` → "You stand up." (Stats panel position not yet wired; that's Task 13.)

- [ ] **Step 5: Commit.**

```bash
git add src/game/actions/position.js src/game/commands.js
git commit -m "positions: stand/sit/sleep commands"
```

---

## Task 8: Reactive auto-stand on damage

**Files:**
- Modify: `src/game/combat.js`

Damage flips a sleeping/sitting target to standing before the hit-feedback broadcast plays. Wake message reads first, then the damage line.

- [ ] **Step 1: Import the helper.**

In `src/game/combat.js` add to the existing imports:

```javascript
import { setPosition } from './positionGate.js';
```

- [ ] **Step 2: Wake/stand before hit feedback.**

Inside `applyDamageWithFeedback` (around line 127), immediately after the early return / tick-stamping block and **before** the damage effect is applied (i.e. before `applyEffect({ type: 'damage', … })`), add:

```javascript
  if (target.position && target.position !== 'stand') {
    const was = target.position;
    setPosition(target, 'stand', was === 'sleep' ? 'woken' : 'stood');
  }
```

Placement detail: this must run after the `target.hp <= 0` guard (sleeping corpses shouldn't broadcast a wake) and before the damage broadcast so the order reads "X jolts awake! X takes 4 damage."

- [ ] **Step 3: Boot check.**

`node server.js`. Clean boot.

- [ ] **Step 4: Smoke check.**

Temporarily set a hostile mob asleep (`forest.bear` with `"position": "sleep"`). Log in as admin, walk to the cave, type `sit` (still works since the bear is asleep and has no hate yet), then `stand`, then `attack bear`. Expect, in order: "The big brown bear jolts awake!" then the attack/damage line. Revert the bear def.

Test the sitting branch too: have a friendly NPC defined as sitting (or temporarily edit one). Attack it (admin) and confirm "stands stood up" wording prints. Or attack a sitting *player* alt — wake-vs-stand wording diverges. Revert any test edits.

- [ ] **Step 5: Commit.**

```bash
git add src/game/combat.js
git commit -m "positions: reactive auto-stand on damage"
```

---

## Task 9: Targeted-social wake in runVerb

**Files:**
- Modify: `src/game/verbs.js`

Wake a sleeping actor target when a verb-shaped action is invoked against them with the `to_target` form. Untargeted (`no_target`) verbs and label-only targets (item-use cases pre-resolving `targetName`) do not wake.

- [ ] **Step 1: Import the helper.**

Add to imports in `src/game/verbs.js`:

```javascript
import { setPosition } from './positionGate.js';
```

- [ ] **Step 2: Wake before broadcasting.**

In `runVerb`, after computing `isToTarget` but before the `broadcastToRoom` call:

```javascript
  if (isToTarget && targetActor && targetActor !== actor && targetActor.position === 'sleep') {
    setPosition(targetActor, 'stand', 'woken');
  }
```

The wake broadcast emits via `setPosition` first, then the social's own broadcast follows. Order: "the bear jolts awake! Bob pats the bear." Correct.

- [ ] **Step 3: Boot check.**

`node server.js`. Clean boot.

- [ ] **Step 4: Smoke check.**

Set the bear to `"position": "sleep"` temporarily. Log in, walk to the cave, use a targeted social on the bear (`pat bear`, `poke bear`, whichever exists in `content/socials/`). Expect: "the big brown bear jolts awake!" then the social emote. On the next tick or two, the bear's passive aggression should pick you up and it should attack. Revert.

Also try an untargeted emote (`emote stretches lazily` or bare `nod`): bear stays asleep.

- [ ] **Step 5: Commit.**

```bash
git add src/game/verbs.js
git commit -m "positions: targeted social wakes sleeping target"
```

---

## Task 10: Active-command gates

**Files:**
- Modify: `src/game/actions/move.js`, `attack.js`, `flee.js`, `use.js`, `search.js`, `cast.js`

Each of these gets a `requireStanding` check that short-circuits before any side effects. `cast` gates only when the spell's resolved target kind is hostile.

- [ ] **Step 1: Move.**

In `src/game/actions/move.js`, add to imports:

```javascript
import { requireStanding } from '../positionGate.js';
```

At the very top of `export default function move(actor, args) {` (before the existing `if (!args || args.length === 0)` check):

```javascript
  const gate = requireStanding(actor);
  if (!gate.ok) {
    actor.session?.send({ kind: 'error', text: gate.msg });
    return;
  }
```

- [ ] **Step 2: Attack.**

Same pattern in `src/game/actions/attack.js`. Import `requireStanding`. Inside `export default function attack(actor, args) {`, before the `if (!args || args.length === 0)` check:

```javascript
  const gate = requireStanding(actor);
  if (!gate.ok) {
    actor.session?.send({ kind: 'error', text: gate.msg });
    return;
  }
```

- [ ] **Step 3: Flee.**

`src/game/actions/flee.js`. Import `requireStanding`. Inside `export default function flee(actor) {`, before `const room = getRoom(...)`:

```javascript
  const gate = requireStanding(actor);
  if (!gate.ok) {
    actor.session?.send({ kind: 'error', text: gate.msg });
    return;
  }
```

- [ ] **Step 4: Use.**

`src/game/actions/use.js`. Import `requireStanding`. Place the gate at the top of the entry function (whatever `export default function use(actor, args) {` body starts with). Read the file first to find the correct line — drop the same block as the others before any side effects.

- [ ] **Step 5: Search.**

`src/game/actions/search.js`. Same pattern — gate at the entry function's top, before the energy/cooldown logic and before the room scan.

- [ ] **Step 6: Cast (hostile only).**

In `src/game/actions/cast.js`, the gate goes inside `validateSpellTarget` (around line 258) — it must run only when the spell's resolved kind is hostile. Add at the top of `validateSpellTarget`, before the `const kind = spell.target ?? 'any';` line, add the kind resolution first; then add the gate:

```javascript
function validateSpellTarget(actor, spell, target) {
  const kind = spell.target ?? 'any';
  if (kind === 'hostile' || kind === 'hostile_room') {
    // import at top of file: import { requireStanding } from '../positionGate.js';
    const gate = requireStanding(actor);
    if (!gate.ok) {
      actor.session.send({ kind: 'error', text: gate.msg });
      return false;
    }
  }
  const isSelf = !target || target === actor;
  …
}
```

Remember to add the `import { requireStanding } from '../positionGate.js';` at the top of `cast.js`. (Do not remove the existing `const kind = spell.target ?? 'any';` further down — leave the function body as-is; this block goes immediately after the existing `const kind` line, replacing only the next blank line.)

Re-read the function before editing — placement is "after `const kind`, before any other branches".

- [ ] **Step 7: Boot check.**

`node server.js`. Clean boot.

- [ ] **Step 8: Smoke check.**

Log in. Type `sit`. Then:

- `n` / `north` → "You must stand first."
- `attack bear` → "You must stand first."
- `flee` → "You must stand first."
- `cast spark bear` → "You must stand first." (hostile)
- `cast heal` → succeeds (self).
- `search` → "You must stand first."
- `use potion.heal` → "You must stand first."
- `look` → succeeds.
- `say hi` → succeeds.
- `inv` → succeeds.

Type `stand`, then `sleep`, repeat the gated commands → "You're asleep." for each.

`stand`. Type `cast` of a friendly buff while sitting (e.g. `cast keen_senses` — admin-granted) → succeeds (target is self/friendly, not gated).

- [ ] **Step 9: Commit.**

```bash
git add src/game/actions/move.js src/game/actions/attack.js src/game/actions/flee.js src/game/actions/use.js src/game/actions/search.js src/game/actions/cast.js
git commit -m "positions: gate active commands on standing"
```

---

## Task 11: Room render suffix

**Files:**
- Modify: `src/game/actions/look.js`

Append `(sitting)` / `(asleep)` to non-standing actors in the room packet. Players appear in the `others` string list; NPCs appear in the `npcs` object list. Both get the suffix.

- [ ] **Step 1: Add a helper at the top of the file.**

`s` is already imported in `src/game/actions/look.js`. Below the imports (above `serializeExchanges`), add:

```javascript
function withPositionSuffix(name, position, lang) {
  if (!position || position === 'stand') return name;
  const suffix = s(`position.suffix.${position}`, lang);
  return suffix ? `${name} ${suffix}` : name;
}
```

- [ ] **Step 2: Apply to player names.**

In `describeRoom`, locate `if (a.kind === 'player') players.push(a.name);` (around line 75). Replace with:

```javascript
      if (a.kind === 'player') players.push(withPositionSuffix(a.name, a.position, lang));
```

- [ ] **Step 3: Apply to NPC names.**

A few lines below, the `npcs.push({ name: t(a.name, lang), disposition: effective });` block. Wrap the name:

```javascript
      npcs.push({
        name: withPositionSuffix(t(a.name, lang), a.position, lang),
        disposition: effective,
      });
```

- [ ] **Step 4: Boot check.**

`node server.js`. Clean boot.

- [ ] **Step 5: Smoke check.**

Log in two characters in the same starting room. Player A sits. Player B types `look` (or moves and back) → the room render shows "PlayerA (sitting)" in the others list. Player A sleeps; Player B looks → "PlayerA (asleep)". Player A stands; suffix gone.

Also test NPC: set `forest.bear` to `"position": "sleep"` temporarily, walk in, look → "A massive brown bear... (asleep)". Revert the def.

- [ ] **Step 6: Commit.**

```bash
git add src/game/actions/look.js
git commit -m "positions: room render suffix for non-standing actors"
```

---

## Task 12: Include `position` in stats packet

**Files:**
- Modify: `src/game/messages/stats.js`

Surface the value to the client. No client UI work in this PR — the field just ships in the wire payload for future use.

- [ ] **Step 1: Add the field.**

In `src/game/messages/stats.js`, inside the `buildStatsMsg` return literal, add a `position` field (near the existing `stats`, `level`, etc.):

```javascript
    position: actor.position ?? 'stand',
```

- [ ] **Step 2: Boot check.**

`node server.js`. Clean boot.

- [ ] **Step 3: Code check.**

Log in. Open browser devtools → Network → WS frames. After a `sit` / `sleep` / `stand` cycle, find the most recent `stats` message; confirm `position` appears with the expected value. (Alternative: temporarily add `console.log` in the client's stats handler to print the field, then revert.)

- [ ] **Step 4: Commit.**

```bash
git add src/game/messages/stats.js
git commit -m "stats: ship position field in stats packet"
```

---

## Task 13: Content — fox pups asleep

**Files:**
- Modify: `content/npcs/forest/forest.fox_pup.json`

- [ ] **Step 1: Add the position field.**

Edit `content/npcs/forest/forest.fox_pup.json`. Add `"position": "sleep"` near the top of the def (after `id` is a good spot).

- [ ] **Step 2: Boot check.**

`node server.js`. Clean boot.

- [ ] **Step 3: Smoke check.**

Log in, find the fox den (`forest.fox_den`, reachable via the search-revealed exit at `forest.fox_glade`). Both pups should render with `(asleep)` suffix. Walk in and back out — they don't react. `pat fox_pup` (or whichever social exists) — the targeted pup wakes; the other stays asleep. Reset by relogging or waiting for respawn.

- [ ] **Step 4: Commit.**

```bash
git add content/npcs/forest/forest.fox_pup.json
git commit -m "content: fox pups start sleeping in the den"
```

---

## Task 14: Content — sleeping bear

**Files:**
- Modify: `content/npcs/forest/forest.bear.json`

The bear's current `short` describes it sitting and watching — incompatible with sleep. Rewrite to a sleeping pose and add the position field.

- [ ] **Step 1: Edit the def.**

Open `content/npcs/forest/forest.bear.json`. Add `"position": "sleep"` near the top.

Replace the `short` block with:

```json
"short": {
  "en": "A massive brown bear lies curled in the back of the cave, its flanks rising and falling with slow breaths.",
  "cs": "Obrovský hnědý medvěd leží stočený v zadní části jeskyně, boky mu zvolna stoupají a klesají."
},
```

Leave `long` unchanged — the inspect text still reads correctly for either pose.

- [ ] **Step 2: Boot check.**

`node server.js`. Clean boot.

- [ ] **Step 3: Smoke check (sneak-past path).**

Walk into `forest.cave`. Room render shows the new sleeping `short` plus `(asleep)` suffix on the actor line. Walk back out — bear stays asleep. No combat. Loot is undisturbed.

- [ ] **Step 4: Smoke check (wake-on-attack).**

Walk in, `attack bear`. Order of broadcasts: bear wakes ("…jolts awake!"), then takes damage. Next tick: bear's passive aggression picks you up; combat proceeds normally.

- [ ] **Step 5: Smoke check (wake-on-social).**

Respawn the bear (admin command, or wait the 1800-tick respawn). Walk in, `pat bear`. Bear wakes; on the next tick aggression resumes and it attacks.

- [ ] **Step 6: Smoke check (sleeping-while-wounded regen).**

Damage the bear to ~5 HP, then sit and watch — wait, this doesn't apply: the bear was originally sleeping and the moment we hit it it woke and went hostile. To exercise this path: kill the bear, wait for respawn (or admin-respawn), confirm the fresh instance is sleeping and at full HP. The OOC regen path needs a separately-injured-and-then-sleeping mob, which isn't reachable through this content alone — note as out of scope for smoke testing.

- [ ] **Step 7: Commit.**

```bash
git add content/npcs/forest/forest.bear.json
git commit -m "content: bear starts sleeping with rewritten short"
```

---

## Task 15: Smoke test the full matrix

**Files:**
- None.

End-to-end check that every spec scenario works against the live server. No code changes; this task just runs the scenarios and confirms green.

- [ ] **Step 1: Boot a fresh server.**

`node server.js`. Open `http://localhost:8080`. Log in as a test character (admin recommended).

- [ ] **Step 2: Position commands.**

`stand` → "You are already standing." `sit` → "You sit down." `sit` → "You are already sitting." `sleep` → "You lie down to sleep." `sleep` → "You are already asleep." `stand` → "You scramble to your feet." or "You stand up." (volitional broadcast from sleep → stand uses `position.stand.*`, which is "You stand up." — that's fine).

- [ ] **Step 3: Combat gate on sit/sleep.**

Walk into a room with a hostile mob (the bear, once woken from Task 14 or a brand-new hostile). Get attacked at least once. Type `sit` → "Not while fighting." Same for `sleep`. Flee or kill the mob, hate clears, `sit` then works.

- [ ] **Step 4: Active-command gate.**

`sit`. Try `n`, `attack <mob>`, `flee`, `cast spark`, `search`, `use potion.heal` → each returns the standing prompt. Inert commands (`look`, `say`, `inv`, `stats`, `eq`, `cast heal` on self) succeed.

`sleep`. Same gated commands return the wake prompt.

- [ ] **Step 5: Perception gate (sneak-past).**

Walk into `forest.cave`. Bear is asleep. Do not interact. Wait 5–10 ticks. Bear does not aggress (no passive aggression because `canPerceive(bear, you) === false`). Walk back out.

- [ ] **Step 6: Damage-wake.**

Walk into the cave again. `attack bear`. First broadcast pair shows "bear jolts awake!" then the damage line. Combat proceeds. Kill or flee.

- [ ] **Step 7: Social-wake.**

Wait for the bear to respawn (1800 ticks ≈ 30 min, or admin-respawn). Walk in. `pat bear` (or another targeted social available in content). Bear wakes via the social path; passive aggression picks you up on the next tick.

- [ ] **Step 8: Fox den.**

Find the fox den via `forest.fox_glade` → search → `d`. Both pups asleep. Walk in. Both render with `(asleep)`. Walk out without interaction — they stay asleep. Re-enter, `attack fox_pup` — first pup wakes and engages; the other stays asleep until it takes damage (pack-hate transfer pulls it in but waking is only on actual damage receipt).

- [ ] **Step 9: Cross-player view.**

Log in a second character (or have another player). Character A sits in the starting room. Character B does `look` → "CharacterA (sitting)" in the others list. A sleeps, B looks → "(asleep)". A stands, B looks → no suffix.

- [ ] **Step 10: Relog reset.**

Quit while sleeping. Log back in. Position is `stand`. `look` from another character confirms standing.

- [ ] **Step 11: Stats packet field.**

Open devtools → Network → WS. After any `sit`/`stand`, find the latest `stats` frame; confirm `position` is present.

- [ ] **Step 12: No commit.**

This task verifies; no code change to commit.

---

## Out of scope (do not implement in this plan)

- Player or position-scaled regen multipliers.
- Per-NPC `shortAt: { sit, sleep }` overrides.
- A separate `rest` state.
- Day/night driven schedule changes.
- Client UI for stand/sit/sleep (quickbar buttons, position indicator in the panel).
- Inspect-panel position rendering.
- Persistence of position across logout.
