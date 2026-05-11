# Perception Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the active-perception slice from `docs/superpowers/specs/2026-05-11-perception-design.md`: a derived `perception` stat, an authored `hidden` block on room exits and fixtures, a `search` command with per-character `foundSecrets`, item + spell perception bonuses, and a small test-content seed.

**Architecture:** Perception is computed in `recomputeStats` from `int + floor(level/2) + Σ wearable.bonus.perception + Σ active-effect statMod.perception`, so existing equip/effect plumbing carries the bonuses. Hidden content is authored on rooms (`hiddenExits[key]` and `hiddenFixtures[itemDefId]`); the room loader normalizes object-form exits so `room.exits[key]` stays a bare target-id string and existing movement/locked-exit code is unchanged. The new `search` command iterates the current room's hidden things, gates them by the deterministic `perception >= dc` check, and writes resolved ids into `player.record.foundSecrets`. Renderer filtering is per-recipient and lives in `describeRoom`. Light gating stays a stub (`canPerceive` body unchanged).

**Tech Stack:** Node 20+ ES modules, no build step, no test framework. Verification is by boot-time validation (loaders throw on bad shapes) plus targeted manual smoke through the running game. Single dep `ws`. Persistence is JSON via `writeJsonAtomic`.

**Verification model (read this before starting).** This project has no automated test runner. Verification for each task is one of:

- **Boot check.** Run `node server.js`. The server logs `Realm listening on…` when content loads cleanly. If a validator throws, the error is printed and the server exits — read the message, fix the offending file, retry.
- **Smoke check.** With the server running, open `http://localhost:8080` in a browser, log in as a chosen test character, and verify the listed in-game behavior.
- **Code check.** For data-only changes, eyeball the values inside `data/players/<name>.json` after a relog (the player record is written on disconnect).

Tasks marked **Boot** are verified by running the server cleanly. Tasks marked **Smoke** require interacting with the running client. Tasks marked **Code** are verified by reading a file or running a small inline node snippet.

**Commit style.** One commit per task, message in the style of recent commits (lowercase first word, single line, optional body). Co-author trailer not required (project repo doesn't use it).

---

## File structure

New files:

- `src/game/actions/search.js` — the `search` command.
- `content/spells/spell.keen_senses.json` — self-target perception buff.
- `content/effects/effect.keen_senses.json` — the timed statMod backing the spell.
- `content/items/item.amulet_keen_senses.json` — wearable amulet, +2 perception.
- `content/items/fixtures/forest.loose_stone.json` — decorative hidden fixture for the test arc.
- `content/rooms/forest/forest.fox_den.json` — new tiny room behind the fox-glade hidden exit.

Modified files:

- `src/game/contentMeta.js` — `ALLOWED_BONUS_KEYS += "perception"`.
- `src/game/stats.js` — add `perception: 0` to both default stats blocks so `normalizeStats` carries it.
- `src/game/wearables.js` — add the derived-perception step to `recomputeStats`.
- `src/game/perception.js` — comment-only update noting the light-engine extension point.
- `src/game/actors.js` — `foundSecrets` normalization in `makePlayerActor`; add `spell.keen_senses` to `ADMIN_GRANTED_SPELLS`.
- `src/persist/validators/room.js` — accept object-form exits and `hiddenFixtures`; uniqueness check across hidden ids in a room.
- `src/game/world/load.js` (or wherever rooms get their post-load shape — search for `validateRoomGraph` callers) — normalize object-form exits into `room.exits` (string) + `room.hiddenExits[key] = {dc,id}`.
- `src/game/actions/look.js` — per-recipient filter on hidden exits and hidden fixtures inside `describeRoom`.
- `src/game/actions/move.js` — treat hidden-and-unfound exits as nonexistent in `resolveExit`.
- `src/game/commands.js` — register `search`.
- `src/game/messages/labels.js` — `searchButton` label.
- `src/game/messages/stats.js` — no change needed; `perception` rides on `actor.stats` once `recomputeStats` writes it.
- `content/strings/en.json`, `content/strings/cs.json` — `search.*` keys, `panel.search_button`, `panel.perception`.
- `client/index.html` — Search button in the action bar next to Flee.
- `client/client.js` — render perception in the stats panel, wire `data-cmd="search"` label, add `search` to the autocomplete verb list.
- `content/items/fixtures/village.well.json` — drop the `unlocks` block.
- `content/items/fixtures/home.trap_door.json` — drop the `unlocks` block.
- `content/rooms/village/village.square.json` — remove `lockedExits.d`; convert `exits.d` to object form with hidden block.
- `content/rooms/home/home.shack.json` — remove `lockedExits.d`; convert `exits.d` to object form with hidden block.
- `content/rooms/forest/forest.fox_glade.json` — add hidden `d` exit to `forest.fox_den`.
- `content/rooms/forest/forest.tower_cellar.json` — add `hiddenFixtures` entry for `forest.loose_stone`; the new amulet's `spawn.location` lands here too (in the item file, not the room).
- `content/npcs/forest/forest.fox_pup.json` — `location` and `pack` change from `forest.fox_glade` to `forest.fox_den`.

---

## Task 1: Schema constant + default stats wire-up

**Files:**
- Modify: `src/game/contentMeta.js:25-27`
- Modify: `src/game/stats.js:1-23`

The schema additions land first so subsequent tasks don't trip the wearable bonus validator and so `normalizeStats` round-trips `perception` cleanly. No behavior change yet — perception stays 0 everywhere.

- [ ] **Step 1: Add `perception` to `ALLOWED_BONUS_KEYS`.**

Edit `src/game/contentMeta.js`. Inside the `ALLOWED_BONUS_KEYS` Set literal, append `'perception'`:

```javascript
export const ALLOWED_BONUS_KEYS = new Set([
  'attack', 'defense', 'hpMax', 'mpMax', 'int', 'magicResist', 'accuracy', 'evasion', 'spd',
  'perception',
]);
```

- [ ] **Step 2: Add `perception: 0` to `PLAYER_DEFAULT_STATS` and `NPC_DEFAULT_STATS`.**

Edit `src/game/stats.js`. Add `perception: 0,` as the last entry inside both `Object.freeze({...})` blocks (before the closing brace, after `spd: 6,`).

```javascript
export const PLAYER_DEFAULT_STATS = Object.freeze({
  hp: 20, hpMax: 20,
  mp: 5,  mpMax: 5,
  attack: 3,
  defense: 1,
  int: 1,
  magicResist: 0,
  accuracy: 0,
  evasion: 0,
  spd: 6,
  perception: 0,
});

export const NPC_DEFAULT_STATS = Object.freeze({
  hp: 1, hpMax: 1,
  mp: 0, mpMax: 0,
  attack: 0,
  defense: 0,
  int: 0,
  magicResist: 0,
  accuracy: 0,
  evasion: 0,
  spd: 6,
  perception: 0,
});
```

`normalizeStats` walks `Object.keys(defaults)` so it now accepts and round-trips a `perception` field automatically.

- [ ] **Step 3: Boot check.**

Run `node server.js`. Expected: server starts, logs `Realm listening on…`. If it fails to start, fix the offending file and retry.

- [ ] **Step 4: Commit.**

```bash
git add src/game/contentMeta.js src/game/stats.js
git commit -m "schema: perception in ALLOWED_BONUS_KEYS and default stats"
```

---

## Task 2: Perception derivation in recomputeStats

**Files:**
- Modify: `src/game/wearables.js:30-57`

Plug the derived-perception formula into the existing computed-stats path so equipping items and applying effects already-implemented hook into perception without any new triggers.

- [ ] **Step 1: Update `recomputeStats` to derive perception before applying bonuses.**

Edit `src/game/wearables.js`. After the `const computed = { ...base };` line (around line 33) and before the wearable-bonus loop, insert the derived-baseline computation. The function reads level via `actor.record?.level ?? 1`:

```javascript
export function recomputeStats(actor) {
  const base = actor.record?.baseStats ?? actor.baseStats;
  if (!base) return;
  const computed = { ...base };
  const level = actor.record?.level ?? 1;
  computed.perception = (computed.int ?? 0) + Math.floor(level / 2);
  for (const { def } of equippedSlots(actor)) {
    // …unchanged…
```

The rest of the function is unchanged — the existing wearable-bonus loop and active-effect statMod loop will both add to `computed.perception` if a key matches.

- [ ] **Step 2: Boot check.**

Run `node server.js`. Server should start cleanly. Log in as any existing player; the boot path calls `recomputeStats` on player load. If something throws, fix and retry.

- [ ] **Step 3: Code check — perception appears in the stats payload.**

With the server running, connect a client and look at the websocket `stats` message in the browser devtools network tab (or the in-memory `actor.stats`). The `stats` payload should now include a `perception` field equal to `int + floor(level/2)`. For a fresh `int=1, level=1` character, that is `1`. No UI rendering yet — verify by message inspection only.

- [ ] **Step 4: Commit.**

```bash
git add src/game/wearables.js
git commit -m "recomputeStats: derive perception from int + level/2"
```

---

## Task 3: foundSecrets persistence on player record

**Files:**
- Modify: `src/game/actors.js:13-50`

Normalize `record.foundSecrets` to a string array on player load. Empty for new and old characters. The field round-trips through `writeJsonAtomic` automatically because the player save path serializes the whole `record`.

- [ ] **Step 1: Add the normalization line.**

Edit `src/game/actors.js`. Inside `makePlayerActor`, in the block that normalizes the various record arrays (the `if (!Array.isArray(record.inventory)) record.inventory = [];` and `if (!Array.isArray(record.knownSpells)) record.knownSpells = [];` lines around line 18-19), add:

```javascript
if (!Array.isArray(record.foundSecrets)) record.foundSecrets = [];
record.foundSecrets = record.foundSecrets.filter(x => typeof x === 'string');
```

The second line scrubs any non-string entries that an old save might somehow have.

- [ ] **Step 2: Boot check.**

Run `node server.js`. Log in as an existing character. Disconnect. Open `data/players/<name>.json` and confirm a `foundSecrets: []` field is now present.

- [ ] **Step 3: Commit.**

```bash
git add src/game/actors.js
git commit -m "player record: foundSecrets array normalization"
```

---

## Task 4: Room loader — object-form exits → parallel hiddenExits map

**Files:**
- Modify: `src/persist/validators/room.js` (existing graph validator; add per-room shape validation here)
- Modify: `src/persist/contentLoader.js:48-52` (`loadRooms`) — normalize exits before graph validation, or normalize inside the validator
- Read first to find the right insertion point: `src/persist/contentLoader.js`, `src/persist/validators/room.js`

The room loader needs to (a) accept object-form exit values `{to, hidden: {dc, id}}`, (b) replace `room.exits[key]` with the bare `to` string, (c) store the hidden metadata in a new `room.hiddenExits[key]` map.

- [ ] **Step 1: Normalize object-form exits and validate the hidden block.**

Edit `src/persist/validators/room.js`. The existing `validateRoomGraph(rooms)` function iterates each room. Replace the body with the following, which now normalizes shape, validates `hidden`, and continues to validate the room graph:

```javascript
import { check, checkObject, checkPositiveInt } from '../validate.js';

export function validateRoomGraph(rooms) {
  for (const room of rooms.values()) {
    const ctx = `room '${room.id}'`;
    const exits = room.exits ?? {};
    const hiddenExits = {};
    for (const [exitKey, rawValue] of Object.entries(exits)) {
      if (typeof rawValue === 'string') continue;
      checkObject(rawValue, ctx, `exits.${exitKey}`);
      check(typeof rawValue.to === 'string' && rawValue.to.length > 0, ctx,
        `exits.${exitKey} object form requires string 'to'`);
      if (rawValue.hidden != null) {
        checkObject(rawValue.hidden, ctx, `exits.${exitKey}.hidden`);
        checkPositiveInt(rawValue.hidden.dc, ctx, `exits.${exitKey}.hidden.dc`);
        check(typeof rawValue.hidden.id === 'string' && rawValue.hidden.id.length > 0,
          ctx, `exits.${exitKey}.hidden.id must be a non-empty string`);
        hiddenExits[exitKey] = { dc: rawValue.hidden.dc, id: rawValue.hidden.id };
      }
      exits[exitKey] = rawValue.to;
    }
    if (Object.keys(hiddenExits).length > 0) room.hiddenExits = hiddenExits;
    for (const [exitCmd, targetId] of Object.entries(exits)) {
      check(rooms.has(targetId), ctx, `exit '${exitCmd}' -> unknown room '${targetId}'`);
    }
    if (room.lockedExits != null) {
      checkObject(room.lockedExits, ctx, 'lockedExits');
      for (const exitKey of Object.keys(room.lockedExits)) {
        check(exitKey in (room.exits ?? {}), ctx, `lockedExits references unknown exit '${exitKey}'`);
      }
    }
  }
}
```

Note: `checkPositiveInt` already exists in `src/persist/validate.js`. The mutation of `exits[exitKey]` happens in-place on the room object that came out of JSON parsing — this is fine since rooms are kept by reference in the `rooms` map.

- [ ] **Step 2: Boot check — existing content still loads.**

Run `node server.js`. Expected: server starts; no room in the existing repo has object-form exits yet, so behavior is unchanged. Boot must succeed.

- [ ] **Step 3: Boot check — bad shapes fail loudly.**

Temporarily edit any existing room (e.g. `content/rooms/home/home.yard.json`) and change one exit to `{ "to": "nonexistent.room" }`. Run `node server.js`. Expected: server exits with `room 'home.yard': exit 'X' -> unknown room 'nonexistent.room'`. Revert the file.

Then try `"north": { "to": "home.cottage", "hidden": { "dc": "abc", "id": "x" } }`. Run again. Expected: `room 'home.yard': exits.north.hidden.dc must be a positive integer`. Revert.

- [ ] **Step 4: Commit.**

```bash
git add src/persist/validators/room.js
git commit -m "room loader: object-form exits with hidden block normalized to room.hiddenExits"
```

---

## Task 5: Room loader — hiddenFixtures map validation

**Files:**
- Modify: `src/persist/validators/room.js` (same file, add a second pass after graph validation has access to item defs — but item defs aren't loaded yet at room load time; instead validate shape only here, defer cross-reference to a separate validator).
- Read first: `src/persist/contentLoader.js:48-63` to see the load order (rooms before items).

Rooms load before items, so we can't cross-reference def ids at room-load time. Do shape-only validation in the room validator and add a cross-reference check that runs after items load.

- [ ] **Step 1: Shape validator for `hiddenFixtures` inside `validateRoomGraph`.**

Edit `src/persist/validators/room.js`. Inside the `for (const room of rooms.values())` loop, after the exits/lockedExits handling and before the closing brace, add:

```javascript
    if (room.hiddenFixtures != null) {
      checkObject(room.hiddenFixtures, ctx, 'hiddenFixtures');
      for (const [defId, value] of Object.entries(room.hiddenFixtures)) {
        checkObject(value, ctx, `hiddenFixtures.${defId}`);
        checkPositiveInt(value.dc, ctx, `hiddenFixtures.${defId}.dc`);
        if (value.id != null) {
          check(typeof value.id === 'string' && value.id.length > 0,
            ctx, `hiddenFixtures.${defId}.id must be a non-empty string when set`);
        }
      }
    }
```

- [ ] **Step 2: Uniqueness check across hiddenExits + hiddenFixtures.**

Still inside the loop, append:

```javascript
    const secretIds = new Set();
    for (const [exitKey, meta] of Object.entries(room.hiddenExits ?? {})) {
      const id = meta.id;
      check(!secretIds.has(id), ctx, `duplicate hidden secret id '${id}' (exit '${exitKey}')`);
      secretIds.add(id);
    }
    for (const [defId, meta] of Object.entries(room.hiddenFixtures ?? {})) {
      const id = meta.id ?? defId;
      check(!secretIds.has(id), ctx, `duplicate hidden secret id '${id}' (fixture '${defId}')`);
      secretIds.add(id);
    }
```

- [ ] **Step 3: Cross-reference check after items load.**

Edit `src/persist/contentLoader.js`. Inside `loadItems(knownRooms, knownEffects)`, after the existing `validateItemInteractions(items, knownRooms);` call, add a hidden-fixture cross-check:

```javascript
  for (const room of knownRooms.values()) {
    if (!room.hiddenFixtures) continue;
    for (const defId of Object.keys(room.hiddenFixtures)) {
      if (!items.has(defId)) {
        throw new Error(`room '${room.id}': hiddenFixtures references unknown item '${defId}'`);
      }
    }
  }
```

- [ ] **Step 4: Boot check — clean boot.**

Run `node server.js`. No room uses `hiddenFixtures` yet; server starts cleanly.

- [ ] **Step 5: Boot check — bad shapes fail loudly.**

Temporarily add to `content/rooms/home/home.yard.json` a `"hiddenFixtures": { "nope.missing": { "dc": 3 } }`. Run server. Expected error mentions `unknown item 'nope.missing'`. Revert.

- [ ] **Step 6: Commit.**

```bash
git add src/persist/validators/room.js src/persist/contentLoader.js
git commit -m "room loader: hiddenFixtures shape validation + cross-ref check"
```

---

## Task 6: Renderer filter — hidden exits and hidden fixtures

**Files:**
- Modify: `src/game/actions/look.js:50-128` (`describeRoom`)

Filter both exits and item instances per-recipient using `actor.record?.foundSecrets`. NPCs don't have `record.foundSecrets`, so the existing `describeRoomToAll` call (which loops only over player actors) is the only invoker that matters; we still defensively `?? []` the lookup.

- [ ] **Step 1: Add a `foundSecrets` lookup at the top of `describeRoom`.**

Edit `src/game/actions/look.js`. Inside `describeRoom(actor)`, after the existing `const lang = actor.lang;` line, add:

```javascript
  const foundSecrets = new Set(actor.record?.foundSecrets ?? []);
```

- [ ] **Step 2: Filter hidden exits in the exit-list build.**

Still in `describeRoom`, find the line `const exitKeys = Object.keys(room.exits ?? {})`. Replace the filter chain:

```javascript
  const hiddenExits = room.hiddenExits ?? {};
  const exitKeys = Object.keys(room.exits ?? {})
    .filter(k => !isExitLocked(room, k))
    .filter(k => !hiddenExits[k] || foundSecrets.has(hiddenExits[k].id))
    .sort(compareExitKeys);
```

- [ ] **Step 3: Filter hidden fixtures in the item-instance loop.**

Still in `describeRoom`, find the `for (const inst of itemsInRoom(room.id))` loop. Insert a skip at the top of the loop body, before any other logic:

```javascript
  const hiddenFixtures = room.hiddenFixtures ?? {};
  // existing: for (const inst of itemsInRoom(room.id)) {
  for (const inst of itemsInRoom(room.id)) {
    const hf = hiddenFixtures[inst.defId];
    if (hf && !foundSecrets.has(hf.id ?? inst.defId)) continue;
    // …existing body…
  }
```

- [ ] **Step 4: Smoke check — visible content still renders.**

Run `node server.js`. Open the client, log in. Walk to any room with items (e.g. `home.yard`). The item list should render normally. Walk to `village.square`. Exits should render as today.

- [ ] **Step 5: Commit.**

```bash
git add src/game/actions/look.js
git commit -m "describeRoom: filter hidden exits and fixtures by foundSecrets"
```

---

## Task 7: Movement gate — hidden-and-unfound exits return no-exit-that-way

**Files:**
- Modify: `src/game/actions/move.js:22-50` (`resolveExit` + `move`)

A player attempting `n` toward a hidden exit they haven't found must get the standard "no such exit" message — no leak that something is there.

- [ ] **Step 1: Pass actor into `resolveExit` and filter hidden exits.**

Edit `src/game/actions/move.js`. Replace `resolveExit(room, exitInput)` to take an extra `actor` parameter and skip hidden-and-unfound entries:

```javascript
function resolveExit(room, exitInput, actor) {
  const exits = room.exits ?? {};
  const hidden = room.hiddenExits ?? {};
  const foundSecrets = new Set(actor.record?.foundSecrets ?? []);
  const visible = (k) => !hidden[k] || foundSecrets.has(hidden[k].id);
  if (exits[exitInput] && visible(exitInput)) return exitInput;
  const canonical = DIR_ALIASES[exitInput.toLowerCase()];
  if (canonical && exits[canonical] && visible(canonical)) return canonical;
  const lower = exitInput.toLowerCase();
  for (const key of Object.keys(exits)) {
    if (key.toLowerCase() === lower && visible(key)) return key;
  }
  return null;
}
```

Then update the call site inside `move(actor, args)` — the existing line is `const exitKey = resolveExit(room, exitInput);` around line 42. Change it to:

```javascript
  const exitKey = resolveExit(room, exitInput, actor);
```

- [ ] **Step 2: Smoke check — visible exits still work.**

Run the server, log in, walk between any two existing rooms (`n`, `s`, etc.). Movement works as before.

- [ ] **Step 3: Commit.**

```bash
git add src/game/actions/move.js
git commit -m "move: hidden-and-unfound exits treated as nonexistent"
```

---

## Task 8: Server strings — search + panel additions

**Files:**
- Modify: `content/strings/en.json`
- Modify: `content/strings/cs.json`

Add the user-visible localized strings for the `search` command, the quickbar button, and the perception stat row. Place the new keys alphabetically among siblings — the files are JSON objects and order is informational only.

- [ ] **Step 1: Add keys to `content/strings/en.json`.**

Add the following key/value pairs anywhere in the JSON object:

```json
"search.nothing": "You search but notice nothing new.",
"search.others": "{actor} searches the room.",
"search.found_fixture": "You notice {target}.",
"search.found_exit": "You notice a way {direction}.",
"panel.search_button": "Search",
"panel.perception": "PER"
```

- [ ] **Step 2: Add the same keys to `content/strings/cs.json`.**

```json
"search.nothing": "Pečlivě prohledáš okolí, ale nic nového si nevšimneš.",
"search.others": "{actor} prohledává místnost.",
"search.found_fixture": "Všimneš si {target}.",
"search.found_exit": "Všimneš si cesty {direction}.",
"panel.search_button": "Hledat",
"panel.perception": "POS"
```

- [ ] **Step 3: Boot check.**

Run `node server.js`. JSON must parse; server starts cleanly. If it complains about trailing commas, fix and retry.

- [ ] **Step 4: Commit.**

```bash
git add content/strings/en.json content/strings/cs.json
git commit -m "strings: search.* + panel.search_button + panel.perception (en/cs)"
```

---

## Task 9: `search` command

**Files:**
- Create: `src/game/actions/search.js`
- Modify: `src/game/commands.js:1-69`

The command iterates the current room's hidden things, gates them by `actor.stats.perception >= dc`, writes ids into `record.foundSecrets`, and emits per-secret reveal lines plus a neutral broadcast to others.

- [ ] **Step 1: Create `src/game/actions/search.js`.**

```javascript
import { getRoom, broadcastToRoom, world } from '../world.js';
import { describeRoomToAll } from './look.js';
import { s, t, dirName } from '../../i18n.js';

export default function search(actor) {
  const room = getRoom(actor.location);
  if (!room) return;
  const lang = actor.lang;
  const found = new Set(actor.record?.foundSecrets ?? []);
  const reveals = [];

  const hiddenExits = room.hiddenExits ?? {};
  for (const [exitKey, meta] of Object.entries(hiddenExits)) {
    if (found.has(meta.id)) continue;
    if (actor.stats.perception >= meta.dc) {
      actor.record.foundSecrets.push(meta.id);
      found.add(meta.id);
      reveals.push(s('search.found_exit', lang, {
        direction: dirName(exitKey, lang) || exitKey,
      }));
    }
  }

  const hiddenFixtures = room.hiddenFixtures ?? {};
  for (const [defId, meta] of Object.entries(hiddenFixtures)) {
    const id = meta.id ?? defId;
    if (found.has(id)) continue;
    if (actor.stats.perception >= meta.dc) {
      actor.record.foundSecrets.push(id);
      found.add(id);
      const def = world.itemDefs.get(defId);
      const targetName = def ? t(def.name, lang) : defId;
      reveals.push(s('search.found_fixture', lang, { target: targetName }));
    }
  }

  broadcastToRoom(actor.location, (recipient) => ({
    kind: 'emote',
    source: 'ambient',
    text: s('search.others', recipient.lang, { actor: actor.name }),
  }), actor);

  if (reveals.length === 0) {
    actor.session.send({ kind: 'system', text: s('search.nothing', lang) });
    return;
  }

  actor.dirty = true;
  for (const line of reveals) {
    actor.session.send({ kind: 'system', text: line });
  }
  describeRoomToAll(actor.location);
}
```

- [ ] **Step 2: Register `search` in `src/game/commands.js`.**

Edit `src/game/commands.js`. Add the import near the other action imports (e.g. after `import flee from './actions/flee.js';`):

```javascript
import search from './actions/search.js';
```

Then add `search,` inside the `COMMANDS` object literal (anywhere; convention is to keep verbs grouped — slot it next to `look`):

```javascript
  search,
```

- [ ] **Step 3: Smoke check — the verb resolves.**

Run `node server.js`. Open the client, log in, type `search`. Expected: room broadcast `"<name> searches the room."` and a system line `"You search but notice nothing new."` (no hidden content exists yet anywhere). No error.

- [ ] **Step 4: Commit.**

```bash
git add src/game/actions/search.js src/game/commands.js
git commit -m "feat: search command for static hidden content"
```

---

## Task 10: Quickbar Search button + autocomplete + label

**Files:**
- Modify: `client/index.html:43` (action bar)
- Modify: `client/client.js:181-182` (label update), `client/client.js:818` (verb list)
- Modify: `src/game/messages/labels.js:52`

Mirror the existing Flee button: HTML element + label injection + autocomplete entry.

- [ ] **Step 1: Add the button to `client/index.html`.**

Find the existing line containing `id="flee-btn"`. Add a sibling button immediately before or after it. Match the existing pattern:

```html
<button type="button" data-cmd="search" id="search-btn">Search</button>
```

(Default text `Search` is overwritten on the first `stats` message via the label payload.)

- [ ] **Step 2: Wire the label update in `client/client.js`.**

Inside `renderStats(msg)` around line 181 where `fleeBtn` is handled, add:

```javascript
  const searchBtn = document.getElementById('search-btn');
  if (searchBtn && labels.searchButton) searchBtn.textContent = labels.searchButton;
```

- [ ] **Step 3: Add `search` to the autocomplete verb list.**

Around line 818 in `client/client.js` the verb list reads `'use', 'cast', 'attack', 'kill', 'hit', 'flee',`. Append `'search'`:

```javascript
  'use', 'cast', 'attack', 'kill', 'hit', 'flee', 'search',
```

- [ ] **Step 4: Emit the label from the server.**

Edit `src/game/messages/labels.js`. Inside `buildPanelLabels`, add `searchButton` alongside `fleeButton`:

```javascript
    fleeButton: s('panel.flee_button', lang),
    searchButton: s('panel.search_button', lang),
```

- [ ] **Step 5: Smoke check.**

Run `node server.js`. Open the client; the Search button shows next to Flee with the localized label (toggle language with `lang cs` to verify both). Clicking Search sends `search`; you see the same broadcast/system line behavior from Task 9.

- [ ] **Step 6: Commit.**

```bash
git add client/index.html client/client.js src/game/messages/labels.js
git commit -m "client: Search quickbar button + autocomplete + label"
```

---

## Task 11: Stats panel — perception row

**Files:**
- Modify: `client/client.js` (find the stats-rendering block; search for `panel.acc` or `eva` references)
- Verify: `src/game/messages/labels.js` already exports `perception` label? — no; add one.
- Modify: `src/game/messages/labels.js`

The `stats` payload already carries `perception` on `msg.stats.perception` from Task 2. The panel needs a label and a render line.

- [ ] **Step 1: Add the perception label to `buildPanelLabels`.**

Edit `src/game/messages/labels.js`. Inside the returned object, alongside `acc`, `eva`, `spd`, add:

```javascript
    perception: s('panel.perception', lang),
```

- [ ] **Step 2: Render the perception row in the stats panel.**

Find where the client renders stat rows in `client/client.js`. Search the file for `labels.spd` to locate the stat-rendering block (the player panel renders each computed stat with its localized label). Add a new row mirroring the spd entry — for example, if the block uses a templated string:

```javascript
  // (existing) `<div class="stat"><span class="stat-label">${labels.spd}</span><span class="stat-value">${stats.spd}</span></div>`
  // append:
  `<div class="stat"><span class="stat-label">${labels.perception}</span><span class="stat-value">${stats.perception ?? 0}</span></div>`
```

If the actual existing pattern is different (some other element shape), match it exactly. The key principle: read the spd row, copy its structure, swap in `perception`.

- [ ] **Step 3: Smoke check.**

Run server, log in. Stats panel shows a PER row with value `1` for a fresh `int=1, level=1` player. Toggle language with `lang cs` — the row label should change to `POS`.

- [ ] **Step 4: Commit.**

```bash
git add src/game/messages/labels.js client/client.js
git commit -m "panel: perception row in the player stats block"
```

---

## Task 12: Effect + spell content for keen_senses

**Files:**
- Create: `content/effects/effect.keen_senses.json`
- Create: `content/spells/spell.keen_senses.json`
- Modify: `src/game/actors.js:9` (`ADMIN_GRANTED_SPELLS`)

A self-target spell that applies a 30-tick +4 perception buff. Admin auto-grant for in-session testing.

- [ ] **Step 1: Create `content/effects/effect.keen_senses.json`.**

Mirror an existing simple statMod effect — look at any existing buff in `content/effects/` for the canonical field shape. Use these values:

```json
{
  "id": "effect.keen_senses",
  "name": { "en": "keen senses", "cs": "bystré smysly" },
  "kind": "buff",
  "icon": "👁️",
  "duration": 30,
  "stack": "refresh",
  "statMod": { "perception": 4 }
}
```

- [ ] **Step 2: Create `content/spells/spell.keen_senses.json`.**

Mirror `content/spells/spell.heal.json` or another self-target spell. The shape must match the spell validator; key fields:

```json
{
  "id": "spell.keen_senses",
  "name": { "en": "keen senses", "cs": "bystré smysly" },
  "target": "self",
  "cost": { "mp": 3 },
  "effect": { "type": "applyEffect", "effect": "effect.keen_senses" },
  "templates": {
    "en": {
      "no_target": {
        "self": "Your senses sharpen.",
        "others": "{actor}'s eyes glint with sudden focus."
      }
    },
    "cs": {
      "no_target": {
        "self": "Tvé smysly se zostří.",
        "others": "{actor} náhle zaostří pohled."
      }
    }
  }
}
```

**Verify the shape against an existing spell before committing** — read `content/spells/spell.heal.json` and adjust the field names if they differ from what's shown above (the project may use different effect-application keys).

- [ ] **Step 3: Add `spell.keen_senses` to `ADMIN_GRANTED_SPELLS`.**

Edit `src/game/actors.js`, line 9. Append to the array:

```javascript
const ADMIN_GRANTED_SPELLS = ['spell.heal', 'spell.spark', 'spell.burning_hands', 'spell.taunt', 'spell.pacify', 'spell.fade', 'spell.keen_senses'];
```

- [ ] **Step 4: Boot check.**

Run `node server.js`. Effect and spell defs must validate. If a validator complains, read its error and fix the JSON to match the project's actual schema.

- [ ] **Step 5: Smoke check.**

Log in as an admin. Open the spellbook (or run `spells`). `keen senses` should appear. Cast it: `cast keen senses`. Your perception in the stats panel should jump by 4 for 30 ticks (~30 seconds). Wait for it to expire; perception returns to base.

- [ ] **Step 6: Commit.**

```bash
git add content/effects/effect.keen_senses.json content/spells/spell.keen_senses.json src/game/actors.js
git commit -m "content: keen senses spell + effect, admin-granted for testing"
```

---

## Task 13: Keen-senses amulet item

**Files:**
- Create: `content/items/item.amulet_keen_senses.json`

A wearable amulet (+2 perception) that spawns one instance in `forest.tower_cellar`.

- [ ] **Step 1: Read an existing amulet for the canonical shape.**

Search content/items for any existing wearable in slot `amulet`. If one exists, copy its field shape. If none does, mirror a `body` or `weapon` slot wearable and just change `slot` to `amulet`.

- [ ] **Step 2: Create `content/items/item.amulet_keen_senses.json`.**

```json
{
  "id": "item.amulet_keen_senses",
  "name": { "en": "an amulet of keen senses", "cs": "amulet bystrých smyslů" },
  "nameAcc": { "en": "the amulet of keen senses", "cs": "amulet bystrých smyslů" },
  "short": {
    "en": "A small silver amulet etched with an open eye.",
    "cs": "Malý stříbrný amulet vyrytý otevřeným okem."
  },
  "long": {
    "en": "A silver disc on a thin chain, engraved with a single open eye that seems to catch the light from any angle. Wearing it sharpens what you notice around you.",
    "cs": "Stříbrný kotouč na tenkém řetízku, vyrytý jediným otevřeným okem, které jako by zachytávalo světlo z každého úhlu. Když jej máš na sobě, lépe si všímáš okolí."
  },
  "weight": 1,
  "wearable": { "slot": "amulet", "bonus": { "perception": 2 } },
  "spawn": { "location": "forest.tower_cellar", "count": 1 }
}
```

Adjust fields if the wearable-item validator complains — `tags`, `pickable`, etc. may need to be present.

- [ ] **Step 3: Boot check.**

Run `node server.js`. Item loads. Walk to `forest.tower_cellar` — the amulet should be on the floor.

- [ ] **Step 4: Smoke check — bonus works.**

Pick up the amulet (`take amulet`). Wear it (`wear amulet`). Stats panel perception should increase by 2. Remove it; perception drops back.

- [ ] **Step 5: Commit.**

```bash
git add content/items/item.amulet_keen_senses.json
git commit -m "content: amulet of keen senses, +2 perception, spawns in forest.tower_cellar"
```

---

## Task 14: Hidden fixture — forest.loose_stone in tower_cellar

**Files:**
- Create: `content/items/fixtures/forest.loose_stone.json`
- Modify: `content/rooms/forest/forest.tower_cellar.json`

A decorative look-only fixture used as the DC-10 medium-tier test target.

- [ ] **Step 1: Create the fixture def.**

```json
{
  "id": "forest.loose_stone",
  "name": { "en": "a loose stone in the wall", "cs": "uvolněný kámen ve zdi" },
  "nameAcc": { "en": "the loose stone", "cs": "uvolněný kámen" },
  "short": {
    "en": "A flat stone in the wall sits crooked, as if it has been pried out and pushed back.",
    "cs": "Plochý kámen ve zdi je nakřivo, jako by jej někdo vypáčil a zase zasunul."
  },
  "long": {
    "en": "One of the cellar's wall stones sits slightly proud of its neighbors. Behind it the mortar is dark and chipped. Whoever fitted this stone last did not finish the job.",
    "cs": "Jeden z kamenů ve zdi sklepa trochu vyčnívá. Za ním je malta tmavá a oprýskaná. Ten, kdo tento kámen naposled usazoval, svou práci nedokončil."
  },
  "tags": ["fixture"],
  "weight": 99,
  "pickable": false,
  "spawn": { "location": "forest.tower_cellar", "count": 1 }
}
```

- [ ] **Step 2: Add `hiddenFixtures` to `forest.tower_cellar`.**

Read the existing `content/rooms/forest/forest.tower_cellar.json`. Add at the top level (next to `exits`, `tags`, etc.):

```json
"hiddenFixtures": {
  "forest.loose_stone": { "dc": 10, "id": "forest.tower_cellar_alcove" }
}
```

- [ ] **Step 3: Boot check.**

Run `node server.js`. Fixture loads; room loads; cross-reference passes.

- [ ] **Step 4: Smoke check.**

Walk to `forest.tower_cellar` with a fresh character (perception 1). The room view should NOT show the loose stone, but SHOULD show the amulet on the floor. Type `search` — broadcast + `You search but notice nothing new.` because DC 10 > 1.

Pick up the amulet, wear it. Perception is now 3. `search` again — still nothing (3 < 10).

If you have an admin character: cast `keen_senses` (+4 → 7); search; still nothing. Use admin commands to raise level to 6 (perception base 1 + 3 = 4; +amulet 6; +spell 10). `search` — the loose stone reveals; the system message reads "You notice the loose stone." (or Czech equivalent). The room view now includes it.

Disconnect; reconnect — the loose stone is still visible without re-searching.

- [ ] **Step 5: Commit.**

```bash
git add content/items/fixtures/forest.loose_stone.json content/rooms/forest/forest.tower_cellar.json
git commit -m "content: loose stone fixture in tower_cellar (hidden DC 10)"
```

---

## Task 15: Hidden well passage — village.square

**Files:**
- Modify: `content/rooms/village/village.square.json`
- Modify: `content/items/fixtures/village.well.json`

Drop the rope-key lock; gate the down exit on a DC-5 perception check. Rope item stays in the world (decorative, may be re-used by future content).

- [ ] **Step 1: Edit `content/rooms/village/village.square.json`.**

Remove the `"lockedExits": { "d": "village.well" }` block entirely. Change `"d": "village.well_bottom"` inside `exits` to object form:

```json
"exits": {
  "n": "village.lane",
  "s": "village.smith",
  "w": "village.pub",
  "e": "village.orchard",
  "d": { "to": "village.well_bottom", "hidden": { "dc": 5, "id": "village.well_passage" } }
}
```

- [ ] **Step 2: Edit `content/items/fixtures/village.well.json`.**

Remove the `"unlocks": { … }` block (lines 26-44 of the current file). Everything else stays. The well is now purely decorative.

- [ ] **Step 3: Boot check.**

Run `node server.js`. Room loads; the well item loads; `validateRoomGraph` accepts the new exit shape.

- [ ] **Step 4: Smoke check.**

Log in as a fresh character at the village (use the admin `goto village.square` command, or start a new character). The room view shows exits N/S/W/E but not D. Try `d` — error `there is no exit that way` (or Czech equivalent). Type `search`. Perception 1 < 5, so the down exit doesn't reveal. Now level up the character to 8 or so (perception = 1 + 4 = 5). `search` — `You notice a way down.` The room view now shows the D exit. Walk down — you arrive in `village.well_bottom`.

- [ ] **Step 5: Commit.**

```bash
git add content/rooms/village/village.square.json content/items/fixtures/village.well.json
git commit -m "content: village.square well passage hidden behind DC 5 perception"
```

---

## Task 16: Hidden trap door — home.shack

**Files:**
- Modify: `content/rooms/home/home.shack.json`
- Modify: `content/items/fixtures/home.trap_door.json`

Drop the trap-door-key lock; gate on DC-3 perception. The key item stays in the world.

- [ ] **Step 1: Edit `content/rooms/home/home.shack.json`.**

Remove `"lockedExits": { "d": "home.trap_door" }`. Change the `d` entry in `exits` to:

```json
"d": { "to": "home.basement", "hidden": { "dc": 3, "id": "home.trap_door_perception" } }
```

- [ ] **Step 2: Edit `content/items/fixtures/home.trap_door.json`.**

Remove the entire `"unlocks": { … }` block. Keep the rest.

- [ ] **Step 3: Boot check.**

Run `node server.js`. Clean boot.

- [ ] **Step 4: Smoke check.**

Walk a fresh character (perception 1) into `home.shack`. Try `d` — no exit. `search` — `You notice a way down.` (DC 3 reachable: 1 >= 3 is false… wait, a fresh player has perception 1 = int 1 + floor(1/2) = 1, which is < 3). Adjust by levelling to 4 (perception = 1 + 2 = 3) or by wearing the amulet (1 + 2 = 3). Then `search` succeeds and the trap door reveals.

Note for tuning: if DC 3 is too high for first-room reveal, drop to DC 2 in the JSON. The intent is "almost always findable" — re-tune during smoke.

- [ ] **Step 5: Commit.**

```bash
git add content/rooms/home/home.shack.json content/items/fixtures/home.trap_door.json
git commit -m "content: home.shack trap door hidden behind DC 3 perception"
```

---

## Task 17: Fox den — new room + hidden exit + fox_pup relocation

**Files:**
- Create: `content/rooms/forest/forest.fox_den.json`
- Modify: `content/rooms/forest/forest.fox_glade.json`
- Modify: `content/npcs/forest/forest.fox_pup.json`

- [ ] **Step 1: Create `content/rooms/forest/forest.fox_den.json`.**

```json
{
  "id": "forest.fox_den",
  "name": { "en": "Fox den", "cs": "Liščí doupě" },
  "short": {
    "en": "A cosy den under tangled roots.",
    "cs": "Útulné doupě pod spletenými kořeny."
  },
  "long": {
    "en": "A round chamber hollowed under the roots of an old birch. Soft moss carpets the floor and the air smells of warm fur and dry leaves. A narrow passage climbs back up to the glade above.",
    "cs": "Kulatá komůrka vyhloubená pod kořeny staré břízy. Měkký mech pokrývá zem a vzduch voní teplou srstí a suchým listím. Úzká chodba stoupá zpět nahoru na mýtinu."
  },
  "exits": { "u": "forest.fox_glade" },
  "tags": ["indoor", "forest", "safe"]
}
```

- [ ] **Step 2: Edit `content/rooms/forest/forest.fox_glade.json`.**

Append a `d` entry to `exits`:

```json
"exits": {
  "w": "forest.sunlit_path",
  "n": "forest.berry_patch",
  "s": "forest.mushroom_hollow",
  "e": "forest.rocky_outcrop",
  "d": { "to": "forest.fox_den", "hidden": { "dc": 4, "id": "forest.fox_den_entrance" } }
}
```

- [ ] **Step 3: Edit `content/npcs/forest/forest.fox_pup.json`.**

Change `"location": "forest.fox_glade"` → `"location": "forest.fox_den"`, and `"pack": "forest.fox_glade"` → `"pack": "forest.fox_den"`. Leave everything else (name, count, behaviors) unchanged.

- [ ] **Step 4: Boot check.**

Run `node server.js`. New room loads, fox pups spawn in the den. The graph validator accepts the new `d` exit. NPC validator accepts the new `location`.

- [ ] **Step 5: Smoke check.**

Walk a fresh character to `forest.fox_glade`. The glade should NOT mention fox pups in its NPCs list anymore (they're in the den below). Try `d` — no exit. `search` — DC 4 ≥ perception 1 is false; level up or wear amulet to bridge. Once perception ≥ 4, search reveals `You notice a way down.` Walk down: you enter the den, fox pups are present. The pack moves stay within the den (visible by emote spam if `wander` is enabled). Disconnect, reconnect — den exit stays revealed.

- [ ] **Step 6: Commit.**

```bash
git add content/rooms/forest/forest.fox_den.json content/rooms/forest/forest.fox_glade.json content/npcs/forest/forest.fox_pup.json
git commit -m "content: fox den behind DC 4 perception, fox pups relocated"
```

---

## Task 18: Perception module comment update + final smoke matrix

**Files:**
- Modify: `src/game/perception.js`

Light-touch comment update to reflect the now-implemented surrounding feature, plus an end-to-end smoke pass that exercises the whole flow.

- [ ] **Step 1: Update the comment in `src/game/perception.js`.**

```javascript
// Stub light-vision gate. Aggro acquisition and target selection both consult this
// before letting an NPC consider an actor. Today it always returns true; the light
// engine will later short-circuit it in dark rooms based on the observer's vision
// field and any room/inventory light sources. Player-side hidden content does NOT
// go through this hook — see `search` + `room.hiddenExits`/`hiddenFixtures`.
export function canPerceive(_observer, _target) {
  return true;
}
```

- [ ] **Step 2: Full smoke matrix.**

With the server running, exercise every gated location with a fresh test character:

1. **`home.shack`** — trivial gate (DC 3): wear amulet (perception 3) → `search` reveals trap door.
2. **`village.square`** — easy gate (DC 5): level up or stack amulet + spell until perception ≥ 5; `search` reveals well passage.
3. **`forest.fox_glade`** — trivial gate (DC 4): with amulet only (perception 3) `search` fails. Cast keen_senses (perception 7) → `search` reveals fox den.
4. **`forest.tower_cellar`** — medium gate (DC 10): with amulet + spell at level 1 (perception 1+0+2+4 = 7) `search` fails. Force level to 6 (admin `setLevel 6` if available, or just play through XP). Perception = 1+3+2+4 = 10. `search` reveals loose stone. Let keen_senses expire; loose stone stays visible (entry in `foundSecrets`).
5. **Relog test.** Disconnect after every reveal; reconnect; confirm every previously revealed exit/fixture is still visible without re-searching. Check `data/players/<name>.json` — `foundSecrets` should list every id you found.
6. **No-leak test.** With a fresh character (no foundSecrets) at any gated room, try the gated direction (`d` in shack, square, glade). Expected: "there is no exit that way" — never "the way is hidden" or any leak. Type `look <fixture_name>` for the loose stone before finding it — expected "no such target" (default look behavior).

If any step misbehaves, fix the underlying file and re-run that step.

- [ ] **Step 3: Commit.**

```bash
git add src/game/perception.js
git commit -m "perception: comment update — search lives outside canPerceive"
```

---

## Self-review

Spec coverage walk-through:

- **Derived perception** — Task 1 (defaults/schema), Task 2 (recomputeStats wires it).
- **Deterministic check** — Task 9 implements `perception >= dc`.
- **Light gating stub** — Task 18 updates the comment; the body is unchanged from current.
- **Hidden exits content shape** — Task 4 normalizes object form into `room.hiddenExits`.
- **Hidden fixtures content shape** — Task 5 validates `room.hiddenFixtures`; cross-ref check.
- **Renderer filter** — Task 6.
- **Movement gate** — Task 7.
- **`search` command** — Task 9.
- **`foundSecrets` persistence** — Task 3.
- **Quickbar button** — Task 10.
- **Stats panel row** — Task 11.
- **Keen-senses amulet** — Task 13.
- **Keen-senses spell + effect** — Task 12.
- **Admin grant** — Task 12.
- **Test content (well, trap, fox den, loose stone)** — Tasks 14-17.
- **Server strings** — Task 8.

Type/API consistency:

- `actor.record.foundSecrets` (array) — written in Task 3, read in Tasks 6, 7, 9.
- `room.hiddenExits[key] = { dc, id }` — produced in Task 4, consumed in Tasks 6, 7, 9.
- `room.hiddenFixtures[defId] = { dc, id? }` — produced in Task 5, consumed in Tasks 6, 9. Resolved id is `meta.id ?? defId` consistently in both.
- `actor.stats.perception` — written in Task 2, read in Task 9, rendered in Task 11.
- `ADMIN_GRANTED_SPELLS` — modified in Task 12.

All values referenced in `recomputeStats`, `describeRoom`, `resolveExit`, and `search` are defined by tasks that precede them.

No placeholders detected. Some content shapes (effect, spell, amulet) call for verification against existing examples in the repo before commit — this is explicit in the steps, not a TBD.

---

## Out-of-scope reminders (do not implement)

- Light engine, dark-room visibility, vision modes — stub only (Task 18 comment).
- NPC-vs-player perception (sneak, invis, hidden ambushers).
- `search <target>`, passive room-enter "you notice in passing," `look` on unfound secrets.
- `foundSecrets` admin commands or migration scripts.
- Pruning the now-unused rope item and trap-door key (intentionally left as decorative future content).
