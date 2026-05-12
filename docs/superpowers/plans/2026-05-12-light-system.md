# Light System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship light system v1 per `docs/superpowers/specs/2026-05-12-light-system-design.md`. Every room gets a computed light level (`light` / `dim` / `dark`) that gates room descriptions, `look <target>`, and combat narration that would reveal an unseen attacker. Player inventory and own stats stay visible regardless of light. Content for `lightBase`, `outdoor`, `vision`, `lightSource`, and `effect.candlelight` is already authored — this PR wires it up.

**Architecture:** A new leaf module `src/game/light.js` exposes `effectiveLight(room)`, `perceivedLight(actor, room)`, and `canPerceiveRoom(actor, room)`. `effectiveLight` is a fold over typed contributions (`floor` raises level; `ceiling` would lower it — only floors in v1) so the deferred `spell.darkness` plugs in without a rewrite. `describeRoom` and `sendTargetInfo` branch on `canPerceiveRoom`. Per-recipient combat broadcasts call `canPerceiveRoom(recipient, room)` and anonymize the attacker when dark. The client treats missing room fields as not-shown (matches existing optional-field behavior), so dim/dark variants just omit fields.

**Tech Stack:** Node 20+ ES modules, no build step, no test framework. Single dep `ws`.

**Verification model.** Same as recent plans — there is no automated test runner. Each task ends in one of:

- **Boot check.** Run `node server.js`. The server logs `Realm listening on…` when content loads cleanly. If a validator throws, the error is printed and the server exits — read the message, fix the offending file, retry.
- **Smoke check.** With the server running, open `http://localhost:8080` in a browser, log in as `Admin`, and verify the listed in-game behavior. Useful test rooms by lightBase: `home.basement` (dark, has the candle), `home.cottage` (light, has fireplace prose), `mine.entrance` (dim per audit), `mine.deep_hall` (dark).
- **Code check.** For data-only / wiring-only changes, eyeball values in JSON or in the running process via a small inline snippet.

**Commit style.** One commit per task, message in the style of recent commits (lowercase first word, single line, no co-author trailer).

---

## File structure

New files:

- `src/game/light.js` — Leaf module. Exports `LIGHT_LEVELS`, `LEVEL_RANK`, `clampUp`, `clampDown`, `effectiveLight(room)`, `perceivedLight(actor, room)`, `canPerceiveRoom(actor, room)`. Imports only from `./world.js` (for `actorsInRoom`, `itemsInRoom`) and the world state for `effectDefs` lookups. No imports from `look.js`, `combat.js`, `tick.js` — keeps it leaf-friendly.

Modified files:

- `src/persist/validators/room.js` — Validate optional `lightBase` enum and `outdoor` boolean inside the existing `validateRoomGraph` loop.
- `src/persist/validators/item.js` — Validate optional `lightSource: { level }`.
- `src/persist/validators/effect.js` — Validate optional `lightSource: { level }` and optional `perception` enum.
- `src/persist/validators/npc.js` — Validate optional `vision` enum (accepted but not yet read by the engine).
- `src/game/contentMeta.js` — Add `LIGHT_LEVEL_SET`, `PERCEPTION_KINDS`, `VISION_KINDS` enum sets.
- `src/game/world/load.js` — Initialize `room.activeLight = []` on every room after rooms load.
- `src/game/actions/look.js` — Branch `describeRoom` and `sendTargetInfo` on `canPerceiveRoom`. Add `light` field to the room message.
- `src/game/combat.js` — Per-recipient narration consults `canPerceiveRoom(recipient, attacker.location)` and emits `combat.hit_by_unseen` to recipients in dark.
- `client/client.js` — Branch the room renderer on `msg.light`; render dim/dark variants.
- `client/style.css` — Optional subtle background tint for `inspect-panel--dim` / `inspect-panel--dark`.
- `content/strings/en.json`, `content/strings/cs.json` — Add `room.dark`, `room.dim_hint`, `look.too_dark`, `combat.hit_by_unseen`.
- `README.md` — Move "Light system (visual-only v1)" to Done; insert "NPC sight & combat in low light" entry.

---

## Task 1: Light enums in contentMeta

**Files:**
- Modify: `src/game/contentMeta.js`

Pure data. No file reads it yet; later tasks import these sets.

- [ ] **Step 1: Add the enum sets.**

Open `src/game/contentMeta.js`. Add near the other `new Set([...])` exports:

```javascript
export const LIGHT_LEVEL_SET = new Set(['light', 'dim', 'dark']);
export const PERCEPTION_KINDS = new Set(['blind', 'nightvision']);
export const VISION_KINDS = new Set(['low_light', 'nightvision', 'blind']);
```

- [ ] **Step 2: Boot check.**

Run `node server.js`. The server should still boot cleanly (these are unused exports).

- [ ] **Step 3: Commit.**

```bash
git add src/game/contentMeta.js
git commit -m "light: add LIGHT_LEVEL_SET / PERCEPTION_KINDS / VISION_KINDS enums"
```

---

## Task 2: Light helper module

**Files:**
- Create: `src/game/light.js`

The single source of truth for light math. v1 contributions are all "floor" (raise level). The fold accepts ceiling contributions but doesn't emit them — `spell.darkness` will add a ceiling contribution later without touching this file's API.

- [ ] **Step 1: Create `src/game/light.js`.**

```javascript
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
```

- [ ] **Step 2: Boot check.**

Run `node server.js`. Module is imported by nothing yet; boot should be unchanged.

- [ ] **Step 3: Commit.**

```bash
git add src/game/light.js
git commit -m "light: add effectiveLight / perceivedLight / canPerceiveRoom helpers"
```

---

## Task 3: Initialize `room.activeLight` at world load

**Files:**
- Modify: `src/game/world/load.js`

Each room gets an empty `activeLight` array, initialized in memory. Not persisted. Reserved for fixtures / room-cast `spell.light` in a later phase.

- [ ] **Step 1: Edit `src/game/world/load.js`.**

After `world.rooms = await loadRooms();` and before `world.admins`, add:

```javascript
  for (const room of world.rooms.values()) {
    room.activeLight = [];
  }
```

The final top of `loadWorld()` reads:

```javascript
export async function loadWorld() {
  world.rooms = await loadRooms();
  for (const room of world.rooms.values()) {
    room.activeLight = [];
  }
  world.admins = await loadAdmins();
  // ...rest unchanged
```

- [ ] **Step 2: Boot check.**

Run `node server.js`. Should boot cleanly. Optionally add a temporary `console.log(world.rooms.get('home.cottage').activeLight)` after boot to confirm `[]`; remove before commit.

- [ ] **Step 3: Commit.**

```bash
git add src/game/world/load.js
git commit -m "light: initialize room.activeLight at world load"
```

---

## Task 4: Validate `lightBase` and `outdoor` on rooms

**Files:**
- Modify: `src/persist/validators/room.js`

The audit annotated many rooms with these fields; they currently load because validators ignore unknown keys. Enforce them so typos break the build.

- [ ] **Step 1: Edit `src/persist/validators/room.js`.**

Top of file, replace the existing import:

```javascript
import { check, checkObject, checkPositiveInt, checkEnum } from '../validate.js';
import { LIGHT_LEVEL_SET } from '../../game/contentMeta.js';
```

Inside `validateRoomGraph`, at the top of the `for (const room of rooms.values())` loop (right after `const ctx = ...`), add:

```javascript
    if (room.lightBase != null) {
      checkEnum(room.lightBase, LIGHT_LEVEL_SET, ctx, 'lightBase');
    }
    if (room.outdoor != null) {
      check(typeof room.outdoor === 'boolean', ctx, `'outdoor' must be a boolean`);
    }
```

- [ ] **Step 2: Boot check.**

Run `node server.js`. All authored rooms must validate cleanly. If a typo surfaces (e.g. `"lightBase": "darkk"`), fix the content file.

- [ ] **Step 3: Negative check.** Temporarily edit any single room JSON (e.g. `content/rooms/home/home.basement.json`) to `"lightBase": "pitch"`. Run `node server.js`; expect an error like `room 'home.basement': 'lightBase' = 'pitch' must be one of: light, dim, dark`. Revert.

- [ ] **Step 4: Commit.**

```bash
git add src/persist/validators/room.js
git commit -m "light: validate lightBase / outdoor on rooms"
```

---

## Task 5: Validate `lightSource` on items

**Files:**
- Modify: `src/persist/validators/item.js`

- [ ] **Step 1: Add the import.**

At the top of `src/persist/validators/item.js`, change:

```javascript
import { WEARABLE_SLOT_SET, ALLOWED_BONUS_KEYS } from '../../game/contentMeta.js';
```

to:

```javascript
import { WEARABLE_SLOT_SET, ALLOWED_BONUS_KEYS, LIGHT_LEVEL_SET } from '../../game/contentMeta.js';
```

And ensure `checkEnum` is in the named imports from `../validate.js`:

```javascript
import {
  check, checkLocalizedText, checkObject, checkArray, checkEnum,
} from '../validate.js';
```

- [ ] **Step 2: Add the validation block.**

Inside the function returned by `makeItemValidator`, right after the `if (def.wearable != null) { ... }` block and before `if (def.use?.effect?.type === 'apply_effect') { ... }`, add:

```javascript
    if (def.lightSource != null) {
      checkObject(def.lightSource, ctx, 'lightSource');
      checkEnum(def.lightSource.level, LIGHT_LEVEL_SET, ctx, 'lightSource.level');
    }
```

- [ ] **Step 3: Boot check.**

Run `node server.js`. Confirms `item.lantern` and any other `lightSource`-bearing items load.

- [ ] **Step 4: Commit.**

```bash
git add src/persist/validators/item.js
git commit -m "light: validate item.lightSource"
```

---

## Task 6: Validate `lightSource` and `perception` on effects

**Files:**
- Modify: `src/persist/validators/effect.js`

- [ ] **Step 1: Edit `src/persist/validators/effect.js`.**

Replace the imports with:

```javascript
import path from 'node:path';
import {
  check, checkEnum, checkLocalizedText, checkObject,
} from '../validate.js';
import { EFFECT_KINDS, EFFECT_STACKS, TICK_EFFECT_TYPES, LIGHT_LEVEL_SET, PERCEPTION_KINDS } from '../../game/contentMeta.js';
```

At the end of `validateEffect` (after the `statMod` block, before the closing brace), add:

```javascript
  if (def.lightSource != null) {
    checkObject(def.lightSource, ctx, 'lightSource');
    checkEnum(def.lightSource.level, LIGHT_LEVEL_SET, ctx, 'lightSource.level');
  }
  if (def.perception != null) {
    checkEnum(def.perception, PERCEPTION_KINDS, ctx, 'perception');
  }
```

- [ ] **Step 2: Boot check.**

Run `node server.js`. `effect.candlelight` must validate (has `lightSource: { level: "dim" }`).

- [ ] **Step 3: Commit.**

```bash
git add src/persist/validators/effect.js
git commit -m "light: validate effect.lightSource / perception"
```

---

## Task 7: Validate `vision` on NPCs

**Files:**
- Modify: `src/persist/validators/npc.js`

The field is data-only in v1 (engine ignores it), but accepting unknown values silently risks typos.

- [ ] **Step 1: Edit `src/persist/validators/npc.js`.**

Extend the import from `contentMeta.js`:

```javascript
import { PRIMITIVE_NAMES, DISPOSITIONS, POSITIONS, VISION_KINDS } from '../../game/contentMeta.js';
```

Inside the function returned by `makeNpcValidator`, right after the `if (def.position != null) { ... }` block, add:

```javascript
    if (def.vision != null) {
      checkEnum(def.vision, VISION_KINDS, ctx, 'vision');
    }
```

- [ ] **Step 2: Boot check.**

Run `node server.js`. All audit-annotated NPCs must validate.

- [ ] **Step 3: Commit.**

```bash
git add src/persist/validators/npc.js
git commit -m "light: validate npc.vision (data-only in v1)"
```

---

## Task 8: Add light + combat strings

**Files:**
- Modify: `content/strings/en.json`
- Modify: `content/strings/cs.json`

- [ ] **Step 1: Edit `content/strings/en.json`.**

Find the existing `combat.*` block (lines ~129+). Add these keys near the combat block (anywhere is fine — files have no strict ordering):

```json
  "combat.hit_by_unseen": "Something strikes you out of the dark!",
  "room.dark": "It is too dark to see anything.",
  "room.dim_hint": "It is hard to see clearly.",
  "look.too_dark": "It is too dark to make out who that is.",
```

Make sure the previous and next lines have correct trailing commas.

- [ ] **Step 2: Edit `content/strings/cs.json`.**

Add the matching Czech entries:

```json
  "combat.hit_by_unseen": "Něco tě uhodí ze tmy!",
  "room.dark": "Je tu příliš tma, nic nevidíš.",
  "room.dim_hint": "Je obtížné dobře vidět.",
  "look.too_dark": "Je příliš tma, nepoznáš, kdo to je.",
```

- [ ] **Step 3: Boot check.**

Run `node server.js`. JSON parse errors throw at boot.

- [ ] **Step 4: Commit.**

```bash
git add content/strings/en.json content/strings/cs.json
git commit -m "light: add room.dark / room.dim_hint / look.too_dark / combat.hit_by_unseen strings"
```

---

## Task 9: Branch `describeRoom` on perceived light

**Files:**
- Modify: `src/game/actions/look.js`

`describeRoom` builds the full payload for `light`. For `dim`, it strips `long`, prepends `room.dim_hint` as the `short`, and emits actor/item lists with names only (no flavor, no disposition). For `dark`, it sends only `name` and a `dark` text — no exits, no actors, no items.

The `light` field on the message is what the client branches on.

- [ ] **Step 1: Add the import.**

At the top of `src/game/actions/look.js`, add (alongside the existing imports):

```javascript
import { canPerceiveRoom } from '../light.js';
```

- [ ] **Step 2: Restructure `describeRoom`.**

Replace the body of `describeRoom` (lines 86–167 in the current file) so the existing logic only runs when the player perceives the room as `light`, with the `dim` and `dark` branches before it. Keep the early-return for missing rooms.

Inside `describeRoom`, after the existing `if (!room) { ... return; }` block and before `const lang = actor.lang;`, capture the perceived level and branch:

```javascript
  const perceived = canPerceiveRoom(actor, room);
  const lang = actor.lang;

  if (perceived === 'dark') {
    actor.session.send({
      kind: 'room',
      light: 'dark',
      name: t(room.name, lang),
      short: s('room.dark', lang),
    });
    return;
  }
```

Then continue with the existing block that computes `foundSecrets`, `hiddenExits`, `hiddenFixtures`, the `players`/`npcs` lists, `exitKeys`, `items`, `gold` — unchanged.

Replace the final `actor.session.send({ kind: 'room', ... })` payload with:

```javascript
  if (perceived === 'dim') {
    actor.session.send({
      kind: 'room',
      light: 'dim',
      name: t(room.name, lang),
      short: `${s('room.dim_hint', lang)} ${t(room.short, lang)}`,
      exitsLabel: s('room.exits_label', lang),
      exits,
      noExitsLabel: s('room.no_exits', lang),
      npcsLabel: s('room.npcs_label', lang),
      npcs: npcs.map(n => ({ name: n.name, disposition: 'neutral' })),
      othersLabel: s('room.others_label', lang),
      others: players,
      itemsLabel: s('room.items_label', lang),
      items: items.map(i => ({ instanceId: i.instanceId, defId: i.defId, name: i.name, count: i.count, pickable: i.pickable })),
      gold,
      goldLabel: s('room.gold_label', lang),
    });
    return;
  }

  actor.session.send({
    kind: 'room',
    light: 'light',
    name: t(room.name, lang),
    short: t(room.short, lang),
    long: t(room.long, lang),
    exitsLabel: s('room.exits_label', lang),
    exits,
    noExitsLabel: s('room.no_exits', lang),
    npcsLabel: s('room.npcs_label', lang),
    npcs,
    othersLabel: s('room.others_label', lang),
    others: players,
    itemsLabel: s('room.items_label', lang),
    items,
    gold,
    goldLabel: s('room.gold_label', lang),
  });
```

Notes on the `dim` payload:
- Drops `long`.
- Replaces NPC dispositions with `'neutral'` so the client doesn't tint hostile chips red (you can't tell the bear is hostile if you can't see it clearly). Hostile-tinting will be re-enabled by combat narration when an attack actually lands.
- Strips item `usable` flag — no `Use ▶` chip in dim. Keeps `pickable` so `take` chips still work (you can feel for the item).

- [ ] **Step 3: Boot check.**

Run `node server.js`. Boot must succeed; module imports `light.js`.

- [ ] **Step 4: Smoke check — light room (current behavior).**

Open `http://localhost:8080`, log in as `Admin`, you start in `home.yard` (`lightBase: "light"` or default). The inspect panel should look exactly as before: `name`, `short`, `long`, exits, others. Move via `n`/`s`/`e`/`w` to confirm no regression in other lit rooms.

- [ ] **Step 5: Smoke check — dim.**

Go to a `dim` room (e.g. `mine.entrance` — path from `village.square` → `mine.entrance`). Verify:
- Room name shows.
- `short` is prepended with `"It is hard to see clearly. "`.
- `long` is absent (panel shorter than before).
- NPC chips don't show the red hostile tint even if they're hostile NPCs.
- Items still list and are pickable, but no `Use ▶` affordance in the popover.

- [ ] **Step 6: Smoke check — dark.**

Go to a `dark` room (e.g. `home.basement`). Verify the panel shows only the room name plus `"It is too dark to see anything."` — no exits, no actors, no items.

- [ ] **Step 7: Smoke check — dark with lantern.**

`take lantern` (if a lantern is somewhere reachable) or as Admin spawn one near you (`@spawn item.lantern`). Wear or carry it. Move into a `dark` room. Verify the room now renders fully (lantern contributes `light` and overrides `dark` lightBase per the contribution invariant).

If `@spawn` isn't available, drop into `home.basement` from `home.cottage` (`d`), then `take candle`, `use candle`. The `effect.candlelight` (`dim`) raises perceived light to `dim`: the basement should switch from the dark-text message to the dim variant. (Candle is `dim`-level so it won't go to full `light`; that's expected.)

- [ ] **Step 8: Commit.**

```bash
git add src/game/actions/look.js
git commit -m "light: describeRoom branches on perceived light (dim/dark variants)"
```

---

## Task 10: Gate `look <target>` on perceived light

**Files:**
- Modify: `src/game/actions/look.js`

`sendTargetInfo` is currently unconditional. Gate by perceived light: in dark, refuse with `look.too_dark`. In dim, drop `description`/`long` fields.

- [ ] **Step 1: Edit `sendTargetInfo` and the related callers.**

At the top of `sendTargetInfo` (after the `lang = actor.lang;` line), add:

```javascript
  const room = getRoom(actor.location);
  const perceived = canPerceiveRoom(actor, room);
  if (perceived === 'dark') {
    actor.session.send({ kind: 'system', text: s('look.too_dark', lang) });
    return;
  }
```

Inside the `target.kind === 'npc'` branch, when `perceived === 'dim'`, omit `description`, `stats`, `effects`, `exchanges` from the payload — send only `name` and `subtitle`. Replace the existing `actor.session.send({ kind: 'target-info', ... })` for NPCs with:

```javascript
    if (perceived === 'dim') {
      actor.session.send({
        kind: 'target-info',
        name: t(target.name, lang),
        subtitle,
      });
      return;
    }
    actor.session.send({
      kind: 'target-info',
      name: t(target.name, lang),
      subtitle,
      description: t(target.long, lang) || t(target.short, lang) || s('look.npc_no_desc', lang),
      exchanges,
      exchangeRowLabels: exchanges ? {
        buy: s('exchange.row.buy', lang),
        sell: s('exchange.row.sell', lang),
        craft: s('exchange.row.craft', lang),
      } : undefined,
      stats: isFriendly || !target.stats ? null : { ...target.stats },
      statLabels: {
        hp: s('panel.hp', lang),
        mp: s('panel.mp', lang),
        atk: s('panel.atk', lang),
        def: s('panel.def', lang),
        int: s('panel.int', lang),
        mres: s('panel.mres', lang),
        acc: s('panel.acc', lang),
        eva: s('panel.eva', lang),
        spd: s('panel.spd', lang),
      },
      effects: effectsForClient,
      effectsLabel: s('panel.effects', lang),
    });
    return;
```

Apply the same `dim`-strip to the player branch — replace the player block with:

```javascript
  if (target.kind === 'player') {
    actor.inspecting = null;
    if (perceived === 'dim') {
      actor.session.send({
        kind: 'target-info',
        name: target.name,
        subtitle: s('look.adventurer_subtitle', lang),
      });
      return;
    }
    actor.session.send({
      kind: 'target-info',
      name: target.name,
      subtitle: s('look.adventurer_subtitle', lang),
      description: target === actor
        ? s('look.player_self', lang, { name: actor.name })
        : s('look.player_other', lang, { name: target.name }),
    });
    return;
  }
```

The looker is **always** considered visible to themselves — but we still strip flavor in dim rooms because the room is dim, not because the target is unobservable. This matches the room-rendering rule.

Item and spell inspects (`sendItemInfo`, `sendSpellInfo`) are **not** light-gated:
- Spells are introspective (cast through your spellbook) — always allowed.
- Items the player can `look` at are either in their own inventory (always allowed; you can feel what you hold) or in the room. For room items, the existing `findInRoom` already returns nothing if `describeRoom` returns no items, so dim/dark room items aren't reachable for inspection in dark anyway. No additional gate needed; verify in step 3.

- [ ] **Step 2: Boot check.**

Run `node server.js`.

- [ ] **Step 3: Smoke check — dim NPC look.**

In a `dim` room with an NPC (e.g. `mine.entrance` if there's an NPC there, else go to one — try `castle.cloister` after annotating), `look <npc-name>`. The inspect panel should show `name` + `subtitle` only — no description, stats, or effects.

- [ ] **Step 4: Smoke check — dark NPC look.**

In a `dark` room with an NPC reachable by name (you have to know the name — try `look bear` in `forest.cave` if dark, or move to any `dark` room and `look` at an actor that's still listed there). Expect the message `"It is too dark to make out who that is."`

- [ ] **Step 5: Smoke check — own inventory always visible.**

In a `dark` room (e.g. `home.basement`), type `inventory` (or `i`). The inventory panel must list everything you carry. Type `look <item-in-your-inventory>`. The item description should display normally (item self-inspect is not light-gated).

- [ ] **Step 6: Commit.**

```bash
git add src/game/actions/look.js
git commit -m "light: gate look <target> on perceived light (dim strips, dark refuses)"
```

---

## Task 11: Anonymize attacker in dark for combat narration

**Files:**
- Modify: `src/game/combat.js`

Per-recipient broadcasts already exist (`broadcastToRoom` accepts a builder). For each recipient in the attacker's room, branch on `canPerceiveRoom(recipient, attacker.location)`: in `dark`, send `combat.hit_by_unseen` instead of the named variants. The attacker themselves are unaffected (they chose the target by name).

In v1, the only place this matters is the existing miss/crit/pack-join/death narrators. Hit narration (`combat.target_hit_you`) lives in `applyDamageWithFeedback` and is per-target only — but if the target is in a dark room they should still get the anonymized form.

- [ ] **Step 1: Add the import.**

At the top of `src/game/combat.js`, add:

```javascript
import { canPerceiveRoom } from './light.js';
```

- [ ] **Step 2: Anonymize the `target_hit_you` message.**

In `applyDamageWithFeedback`, replace the `if (target.session) { ... }` block (the one that sends `combat.target_hit_you`) with:

```javascript
  if (target.session) {
    const room = getRoom(target.location);
    const perceived = canPerceiveRoom(target, room);
    if (perceived === 'dark') {
      target.session.send({
        kind: 'system',
        tone: 'bad',
        text: s('combat.hit_by_unseen', target.lang),
      });
    } else {
      target.session.send({
        kind: 'system',
        tone: 'bad',
        text: s('combat.target_hit_you', target.lang, {
          actor: actorDisplay(actor, target.lang),
          amount: dealt,
        }),
      });
    }
  }
```

This requires `getRoom` to be imported. Check the existing top-of-file imports from `./world.js` — if `getRoom` isn't already in the list, add it.

- [ ] **Step 3: Anonymize the miss broadcast (observer branch).**

In `executeAttack`, find the `dodge > 0` block that calls `broadcastToRoom(actor.location, (recipient) => { ... })` with the `combat.miss_observed` builder. Replace the **observer** branch (the `else` after `recipient === target`) so an observer in a dark room sees nothing (i.e. return `null` to suppress the message — confirm `broadcastToRoom` skips null builders; if not, return a `combat.miss_observed_dark` empty-ish string and we'll suppress at the layer above).

Concretely: the recipient who *is* the target still gets the `target_missed_you` line (they feel it). The attacker still gets `you_missed`. Third-party observers in a dark room get nothing.

```javascript
    broadcastToRoom(actor.location, (recipient) => {
      const lang = recipient.lang;
      if (recipient === actor) {
        return { kind: 'emote', source: sourceForActor(actor, recipient),
          text: s('combat.you_missed', lang, { target: targetDisplay(target, lang) }) };
      }
      if (recipient === target) {
        return { kind: 'emote', source: sourceForActor(actor, recipient),
          text: s('combat.target_missed_you', lang, { actor: actorDisplay(actor, lang) }) };
      }
      const room = getRoom(recipient.location);
      if (canPerceiveRoom(recipient, room) === 'dark') return null;
      return { kind: 'emote', source: sourceForActor(actor, recipient),
        text: s('combat.miss_observed', lang, {
          actor: actorDisplay(actor, lang),
          target: targetDisplay(target, lang),
        }) };
    });
```

Verify `broadcastToRoom` honors `null` returns. Grep `src/game/world/actors.js` for `broadcastToRoom` body — if a builder returning `null`/`undefined` is already skipped, this works as written. If not, add an explicit early `continue` in the builder loop.

- [ ] **Step 4: Anonymize the crit observer line and the attack-emote observer line.**

Same pattern applied to the crit broadcast (`combat.crit_observed`) and the templated attack-emote broadcast (the `if (tmpl) { ... }` block). For each: if the recipient is neither the actor nor the target, and the recipient's room is dark, return `null`.

For the templated attack-emote block in `executeAttack`:

```javascript
  if (tmpl) {
    const idx = pickListIndex(tmpl);
    broadcastToRoom(actor.location, (recipient) => {
      const lang = recipient.lang;
      if (recipient !== actor && recipient !== target) {
        const room = getRoom(recipient.location);
        if (canPerceiveRoom(recipient, room) === 'dark') return null;
      }
      const line = fillPlaceholders(tListAt(tmpl, lang, idx), { actor, target, lang });
      return { kind: 'emote', source: sourceForActor(actor, recipient), text: line };
    });
  }
```

For the crit broadcast:

```javascript
  if (crit) {
    broadcastToRoom(actor.location, (recipient) => {
      const lang = recipient.lang;
      let text;
      if (recipient === actor) {
        text = s('combat.you_crit', lang, { target: targetDisplay(target, lang) });
      } else if (recipient === target) {
        text = s('combat.target_crit_you', lang, { actor: actorDisplay(actor, lang) });
      } else {
        const room = getRoom(recipient.location);
        if (canPerceiveRoom(recipient, room) === 'dark') return null;
        text = s('combat.crit_observed', lang, {
          actor: actorDisplay(actor, lang),
          target: targetDisplay(target, lang),
        });
      }
      return { kind: 'emote', tone: 'combat', source: sourceForActor(actor, recipient), text };
    });
  }
```

- [ ] **Step 5: Anonymize death narration.**

In `handleNpcDeath`, the broadcast uses `combat.target_dies_observed`. Observers in dark rooms shouldn't see "the bear collapses" — they only know something happened if the actor performing the kill is themselves. Make the observer branch skip in dark:

```javascript
  broadcastToRoom(room, (recipient) => {
    const r = getRoom(recipient.location);
    if (canPerceiveRoom(recipient, r) === 'dark') return null;
    return {
      kind: 'emote',
      tone: 'death',
      text: s('combat.target_dies_observed', recipient.lang, {
        target: resolveName(npc, 'nom', recipient.lang),
      }),
    };
  });
```

Apply the same `null`-return pattern in `handlePlayerDeath` for the `combat.player_died_observed` broadcast.

- [ ] **Step 6: Verify `broadcastToRoom` skips null builders.**

Read `src/game/world/actors.js` for the `broadcastToRoom` definition. Confirm that when `msgOrBuilder` is a function and returns `null`/`undefined`, the recipient is skipped. If it isn't, add the guard there in this same task:

```javascript
const msg = typeof msgOrBuilder === 'function' ? msgOrBuilder(a) : msgOrBuilder;
if (!msg) continue;
```

(Only modify if the guard isn't already present — most likely it isn't; check first.)

- [ ] **Step 7: Boot check.**

Run `node server.js`.

- [ ] **Step 8: Smoke check — hit in dark room.**

Spawn an NPC that can attack you in a `dark` room (e.g. `home.basement` won't have one by default; use Admin to drop a hostile NPC instance there via `@reload` after editing a def, or pick an existing dark room that already has an NPC — `mine.deep_hall` is `dark` and has miners/spiders depending on content).

Get hit. Verify your client shows `"Something strikes you out of the dark!"` instead of the named hit message.

If you have a nightvision potion or `effect.nightvision`, apply it and confirm the named hit narration returns.

- [ ] **Step 9: Smoke check — observers in dark see nothing.**

With two players (use `Admin` and a second test character), have one in a `light` room attack each other (or NPC). Confirm normal narration. Now move both to a `dark` room and have a third character watch from outside (or watch via server logs). The third in a dark adjacent room should NOT see broadcast lines.

If two-character testing isn't feasible right now, eyeball it by enabling `console.log` in `broadcastToRoom`.

- [ ] **Step 10: Commit.**

```bash
git add src/game/combat.js src/game/world/actors.js
git commit -m "light: anonymize attacker narration in dark rooms (per recipient)"
```

If `src/game/world/actors.js` wasn't modified, drop it from the `git add`.

---

## Task 12: Client renders light variants

**Files:**
- Modify: `client/client.js`

The renderer already treats missing fields as not-shown, so the dim variant mostly Just Works. Two small adjustments:

- The dim variant emits `short` already prepended with the hint; the existing path uses `msg.long || msg.short` for the description — which is fine, since `long` is absent.
- The dark variant emits only `name` + `short` (the canned dark string). Existing path handles this (no exits, no items, no others).

What we add:

- A class on the inspect panel (`inspect-panel-light` / `-dim` / `-dark`) so CSS can tint.

- [ ] **Step 1: Edit `renderRoomInInspect`.**

Find `function renderRoomInInspect(msg)` (around line 532). At the top, after `inspectBody.innerHTML = '';`, add:

```javascript
  inspectPanel.classList.remove('inspect-panel-light', 'inspect-panel-dim', 'inspect-panel-dark');
  const light = msg.light ?? 'light';
  inspectPanel.classList.add(`inspect-panel-${light}`);
```

- [ ] **Step 2: Boot check.**

Run `node server.js`, refresh the browser. The room panel must still render correctly in `light` rooms. Inspect the panel DOM in devtools and confirm the new class is set per room.

- [ ] **Step 3: Smoke check — class switches.**

Move between a `light` room, a `dim` room, and a `dark` room. The `inspect-panel-*` class should change accordingly.

- [ ] **Step 4: Commit.**

```bash
git add client/client.js
git commit -m "light: client tags inspect panel with perceived light class"
```

---

## Task 13: Optional subtle CSS tint for dim/dark panels

**Files:**
- Modify: `client/style.css`

Visual signal. Subtle — don't overdo it; the canned text already tells the player.

- [ ] **Step 1: Edit `client/style.css`.**

Append at the bottom of the file:

```css
.inspect-panel-dim {
  background-image: linear-gradient(rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.18));
}
.inspect-panel-dark {
  background-image: linear-gradient(rgba(0, 0, 0, 0.42), rgba(0, 0, 0, 0.42));
}
```

`background-image` instead of `background-color` so it composes with any existing panel background.

- [ ] **Step 2: Smoke check.**

Refresh browser. Switch between light / dim / dark rooms. Dim panel slightly darker; dark panel noticeably darker.

- [ ] **Step 3: Commit.**

```bash
git add client/style.css
git commit -m "light: subtle tint on dim/dark room panels"
```

---

## Task 14: Roadmap delta

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Edit `README.md`.**

In the Roadmap section:

1. Move `| Light system (visual-only v1) |` from "Planned — light & exploration content" up to "Done", as a new row at the bottom of the Done table.
2. In "Planned — light & exploration content", below where "Light system (visual-only v1)" was, add the new follow-up phase:

```markdown
| NPC sight & combat in low light (NPCs read `vision` to gate `canPerceive`; dim/dark to-hit penalties; `spell.light` / `spell.darkness` / `spell.blindness` / `spell.nightvision`) |
```

3. The existing "Light/visibility spells, light sources" row is now redundant — merge it into the new entry above and delete the old row.

- [ ] **Step 2: Commit.**

```bash
git add README.md
git commit -m "roadmap: light v1 done; next phase = NPC sight + low-light combat"
```

---

## Final pass

- [ ] **Run a full smoke session.**

Boot the server. Log in as `Admin`. Walk a route that touches all three light levels:

1. `home.yard` (light) — full panel.
2. `home.cottage` → `d` to `home.basement` (dark) — only name + "It is too dark to see anything."
3. `take candle`, `use candle` — basement now `dim` (effect.candlelight contributes dim). Panel shows `short` prepended with `"It is hard to see clearly. "`. NPC chips, if any, would not show hostile tint.
4. If a lantern is reachable, equip it; basement now `light`. Full panel.
5. Visit a `dim` room with a hostile NPC and trigger combat. Confirm hit narration still names the attacker (room is `dim`, not `dark`).
6. Visit a `dark` room reachable with a hostile NPC (or `@reload` content to put one there). Get hit. Confirm `"Something strikes you out of the dark!"`. `inventory` still works. `look bear` returns `"It is too dark to make out who that is."`.

- [ ] **Self-review.**

Walk the spec section by section. For each, point to the task that delivered it. Anything missing — patch in a small follow-up commit on this branch before opening the PR.

- [ ] **Open the PR.**

Title: `feat: light system v1 (player-side visibility)`.

Body summarizes: visual-only light, three states, contribution-fold model, combat narration gates the unseen attacker, inventory always visible. Links the spec.
