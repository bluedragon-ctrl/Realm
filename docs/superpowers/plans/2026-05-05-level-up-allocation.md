# Level-Up Stat Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed +2 HP / +1 MP per level with a 2-point allocation pool the player spends on ATK, DEF, INT, MR, ACC, EVA, HP (+5), or MP (+2). Allocation surfaces in the player panel as a clickable star next to the level, opens an existing-style chip popover for selection, and is also reachable via a `train <stat>` text command. Admin can reset a player's allocations.

**Architecture:** Server stores `record.unspentPoints` and a per-stat `record.allocated` map (audit + reset support). On level-up, increment `unspentPoints` by 2 — do NOT mutate stats. A new `train` action validates and applies one point: it bumps `record.baseStats[key]` by the per-stat ratio, decrements `unspentPoints`, increments `record.allocated[key]`, calls `recomputeStats(actor)` to fold equipment, and `sendStats(actor)`. The client renders a `★N` chip next to the level bar when `unspentPoints > 0` and reuses the existing chip-popover pattern to issue `train <stat>` over the existing command channel — no new wire protocol. Admin command `@reset-stats <player>` refunds all allocated points back into the pool (or into a chosen total, see Task 9). All values flow through the existing `sendStats` snapshot.

**Tech Stack:** Node.js 20, ESM, ws. Plain DOM client. No test framework — verification is manual via running `npm start`, connecting two browser tabs (one admin, one player) and exercising the flow.

**Project conventions reminder (from CLAUDE.md):**
- Atomic JSON writes via `writeJsonAtomic`. Player records are saved by the existing dirty/save loop — set `actor.dirty = true` and the loop persists it. Do NOT call `savePlayer` directly.
- All user-visible text via `s(key, lang, params)`; both `en` and `cs` strings required.
- Commands stay English; only display text is localized.
- Console is an event log; descriptions/menus go to the panel UI, not the console.
- Errors fail loudly at boot; defensive runtime defaults are fine.
- No new dependencies, no build step, no React/etc.

---

## File Structure

**Server-side files modified or created:**

- `src/game/leveling.js` *(new)* — single source of truth for level-up math: `POINTS_PER_LEVEL`, `STAT_RATIOS` ({ attack:1, defense:1, int:1, magicResist:1, accuracy:1, evasion:1, hpMax:5, mpMax:2 }), `STAT_KEYS` (ordered list), `applyTrain(actor, statKey)`, `resetAllocations(actor)`. Pure functions over `actor.record`; depends on `wearables.recomputeStats`.
- `src/game/xp.js` *(modify)* — replace `levelUp` body. Stop adding to `hpMax`/`mpMax`; instead add `POINTS_PER_LEVEL` to `record.unspentPoints`. Refill `hp`/`mp` to current max as a thank-you (existing behavior preserved). Remove the `HP_PER_LEVEL` / `MP_PER_LEVEL` constants.
- `src/game/actors.js` *(modify)* — in `makePlayerActor`, normalize `record.unspentPoints` (default 0, integer ≥ 0) and `record.allocated` (default `{}` keyed by stat). Expose `unspentPoints` / `allocated` getters on the actor.
- `src/game/actions/train.js` *(new)* — text command handler `train <stat>`. Resolves stat name (English short or long form: `atk`, `attack`, `def`, `defense`, `int`, `mr`, `magicresist`, `acc`, `accuracy`, `eva`, `evasion`, `hp`, `mp`). Validates `unspentPoints > 0`, calls `applyTrain`, sends success message and `sendStats`. Errors: `train.no_arg`, `train.no_points`, `train.unknown_stat`.
- `src/game/commands.js` *(modify)* — register `train` and short alias `tr`.
- `src/game/messages/stats.js` *(modify)* — include `unspentPoints` and `allocated` in the `stats` snapshot.
- `src/admin/adminCommands.js` *(modify)* — add `@reset-stats <player>` handler. Loads the target player record (online or offline), calls `resetAllocations`, refunds all allocated points back into `unspentPoints`, saves, and if online calls `sendStats`.
- `content/strings/en.json` and `content/strings/cs.json` *(modify)* — add `train.*` strings, `panel.unspent_points`, `panel.train_button`, `panel.train_label_<stat>`, and `admin.reset_stats_*` strings.

**Client-side files modified:**

- `client/client.js` *(modify)* — render the `★N` chip next to the level/XP bar when `msg.unspentPoints > 0`; on click open a popover listing the eight stats, each as a chip showing per-point gain (e.g. `ATK +1`, `HP +5`); chip click sends `train <stat>` via the existing `send()` command path.
- `client/style.css` *(modify)* — minimal styling for the unspent-points chip (bright/pulsing) and the train popover items if needed.

---

## Task 1: Add leveling module (constants + apply/reset)

**Files:**
- Create: `src/game/leveling.js`

- [ ] **Step 1: Create `src/game/leveling.js`**

```javascript
import { recomputeStats } from './wearables.js';

export const POINTS_PER_LEVEL = 2;

// Per-stat gain per allocated point. Keys are the canonical stat names
// used in PLAYER_DEFAULT_STATS / record.baseStats.
export const STAT_RATIOS = Object.freeze({
  attack: 1,
  defense: 1,
  int: 1,
  magicResist: 1,
  accuracy: 1,
  evasion: 1,
  hpMax: 5,
  mpMax: 2,
});

// Display order used by the client popover and by the `train` command help.
export const STAT_KEYS = Object.freeze([
  'attack', 'defense', 'int', 'magicResist',
  'accuracy', 'evasion', 'hpMax', 'mpMax',
]);

// Map user-typed aliases (English only — commands stay English) to canonical keys.
const ALIASES = {
  atk: 'attack', attack: 'attack',
  def: 'defense', defense: 'defense',
  int: 'int', intelligence: 'int',
  mr: 'magicResist', mres: 'magicResist', magicresist: 'magicResist',
  acc: 'accuracy', accuracy: 'accuracy',
  eva: 'evasion', evasion: 'evasion',
  hp: 'hpMax', hpmax: 'hpMax',
  mp: 'mpMax', mpmax: 'mpMax',
};

export function resolveStatKey(input) {
  if (typeof input !== 'string') return null;
  return ALIASES[input.toLowerCase()] ?? null;
}

export function ensureAllocationFields(record) {
  if (typeof record.unspentPoints !== 'number' || record.unspentPoints < 0) {
    record.unspentPoints = 0;
  }
  record.unspentPoints = Math.floor(record.unspentPoints);
  if (!record.allocated || typeof record.allocated !== 'object') {
    record.allocated = {};
  }
  for (const key of STAT_KEYS) {
    const v = record.allocated[key];
    record.allocated[key] = (typeof v === 'number' && v >= 0) ? Math.floor(v) : 0;
  }
}

// Spend one point on `key`. Returns true on success, false on validation failure.
export function applyTrain(actor, key) {
  const record = actor.record;
  ensureAllocationFields(record);
  if (!STAT_KEYS.includes(key)) return false;
  if (record.unspentPoints <= 0) return false;

  const gain = STAT_RATIOS[key];
  if (!record.baseStats) return false;
  record.baseStats[key] = (record.baseStats[key] ?? 0) + gain;
  // For HP/MP, bump current pool so the gain feels immediate.
  if (key === 'hpMax') record.baseStats.hp = (record.baseStats.hp ?? 0) + gain;
  if (key === 'mpMax') record.baseStats.mp = (record.baseStats.mp ?? 0) + gain;

  record.unspentPoints -= 1;
  record.allocated[key] = (record.allocated[key] ?? 0) + 1;
  actor.dirty = true;
  recomputeStats(actor);
  return true;
}

// Refund every allocated point back into unspentPoints and zero baseStats deltas.
export function resetAllocations(actor) {
  const record = actor.record;
  ensureAllocationFields(record);
  if (!record.baseStats) return 0;
  let refunded = 0;
  for (const key of STAT_KEYS) {
    const count = record.allocated[key] ?? 0;
    if (count <= 0) continue;
    const gain = STAT_RATIOS[key];
    record.baseStats[key] = (record.baseStats[key] ?? 0) - gain * count;
    if (key === 'hpMax') {
      record.baseStats.hp = Math.max(0, (record.baseStats.hp ?? 0) - gain * count);
    }
    if (key === 'mpMax') {
      record.baseStats.mp = Math.max(0, (record.baseStats.mp ?? 0) - gain * count);
    }
    record.allocated[key] = 0;
    refunded += count;
  }
  record.unspentPoints += refunded;
  actor.dirty = true;
  recomputeStats(actor);
  return refunded;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/game/leveling.js
git commit -m "Add leveling module: STAT_RATIOS, applyTrain, resetAllocations"
```

---

## Task 2: Wire allocation fields into player record loading

**Files:**
- Modify: `src/game/actors.js`

- [ ] **Step 1: Import `ensureAllocationFields` and call it in `makePlayerActor`**

In `src/game/actors.js`, add the import near the top:

```javascript
import { ensureAllocationFields } from './leveling.js';
```

Inside `makePlayerActor`, after the `record.baseStats = normalizeStats(...)` line and before `record.lang = ...`, add:

```javascript
  ensureAllocationFields(record);
```

Then add getters on the actor object so consumers can read without reaching into `record`. In the `const actor = { ... }` literal, add alongside the existing `xp` / `level` getters:

```javascript
    get unspentPoints() { return record.unspentPoints; },
    get allocated() { return record.allocated; },
```

- [ ] **Step 2: Manual smoke check**

Run `node -e "import('./src/game/leveling.js').then(m => { const r = {}; m.ensureAllocationFields(r); console.log(JSON.stringify(r)); })"`.
Expected output: `{"unspentPoints":0,"allocated":{"attack":0,"defense":0,"int":0,"magicResist":0,"accuracy":0,"evasion":0,"hpMax":0,"mpMax":0}}`.

- [ ] **Step 3: Commit**

```bash
git add src/game/actors.js
git commit -m "Initialize unspentPoints/allocated on player load"
```

---

## Task 3: Replace flat HP/MP gain on level-up with point grant

**Files:**
- Modify: `src/game/xp.js`

- [ ] **Step 1: Replace `levelUp` to grant points instead of stats**

Replace the file contents of `src/game/xp.js` with:

```javascript
import { broadcastToRoom } from './world.js';
import { sendStats } from './messages.js';
import { s } from '../i18n.js';
import { POINTS_PER_LEVEL, ensureAllocationFields } from './leveling.js';

export function xpToNext(level) {
  return 10 * level * level;
}

export function awardXp(actor, amount, reason = '') {
  if (!actor || actor.kind !== 'player' || !amount || amount <= 0) return;
  if (actor.stats.hp <= 0) return;

  const record = actor.record;
  record.xp = (record.xp ?? 0) + amount;
  record.level = record.level ?? 1;
  actor.dirty = true;

  if (actor.session) {
    actor.session.send({
      kind: 'system',
      tone: 'good',
      text: s('xp.gained', actor.lang, { amount }),
    });
  }

  while (record.xp >= xpToNext(record.level)) {
    record.xp -= xpToNext(record.level);
    record.level += 1;
    levelUp(actor);
  }

  sendStats(actor);
}

function levelUp(actor) {
  const record = actor.record;
  ensureAllocationFields(record);
  record.unspentPoints += POINTS_PER_LEVEL;

  // Heal-on-level: top off current pool (no max change).
  actor.stats.hp = actor.stats.hpMax;
  actor.stats.mp = actor.stats.mpMax;
  if (record.baseStats) {
    record.baseStats.hp = record.baseStats.hpMax;
    record.baseStats.mp = record.baseStats.mpMax;
  }

  if (actor.session) {
    actor.session.send({
      kind: 'system',
      tone: 'levelup',
      text: s('xp.level_up', actor.lang, { level: record.level }),
    });
    actor.session.send({
      kind: 'system',
      tone: 'good',
      text: s('xp.points_granted', actor.lang, { points: POINTS_PER_LEVEL }),
    });
  }

  if (actor.location) {
    broadcastToRoom(actor.location, (recipient) => ({
      kind: 'system',
      tone: 'levelup',
      text: s('xp.level_up_observed', recipient.lang, {
        name: actor.name,
        level: record.level,
      }),
    }), actor);
  }
}

export function markRoomVisited(actor, roomId) {
  if (!actor || actor.kind !== 'player' || !roomId) return false;
  if (!actor.visitedRooms) actor.visitedRooms = new Set();
  if (actor.visitedRooms.has(roomId)) return false;
  actor.visitedRooms.add(roomId);
  if (!Array.isArray(actor.record.visitedRooms)) actor.record.visitedRooms = [];
  actor.record.visitedRooms.push(roomId);
  actor.dirty = true;
  return true;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/game/xp.js
git commit -m "Level-up grants 2 points instead of flat HP/MP"
```

---

## Task 4: Send unspent points + allocations in stats snapshot

**Files:**
- Modify: `src/game/messages/stats.js`

- [ ] **Step 1: Add fields to `buildStatsMsg`**

In `src/game/messages/stats.js`, inside the object returned by `buildStatsMsg`, add (after `gold:` is fine):

```javascript
    unspentPoints: actor.record?.unspentPoints ?? 0,
    allocated: { ...(actor.record?.allocated ?? {}) },
```

- [ ] **Step 2: Commit**

```bash
git add src/game/messages/stats.js
git commit -m "Expose unspentPoints/allocated in stats snapshot"
```

---

## Task 5: Add `train` command

**Files:**
- Create: `src/game/actions/train.js`
- Modify: `src/game/commands.js`

- [ ] **Step 1: Create `src/game/actions/train.js`**

```javascript
import { applyTrain, resolveStatKey, STAT_RATIOS } from '../leveling.js';
import { sendStats } from '../messages.js';
import { s } from '../../i18n.js';

export default function train(actor, args) {
  if (!actor.session) return;
  const arg = (args[0] ?? '').trim();
  if (!arg) {
    actor.session.send({
      kind: 'error',
      text: s('train.no_arg', actor.lang),
    });
    return;
  }

  if (!actor.record.unspentPoints || actor.record.unspentPoints <= 0) {
    actor.session.send({
      kind: 'error',
      text: s('train.no_points', actor.lang),
    });
    return;
  }

  const key = resolveStatKey(arg);
  if (!key) {
    actor.session.send({
      kind: 'error',
      text: s('train.unknown_stat', actor.lang, { stat: arg }),
    });
    return;
  }

  const ok = applyTrain(actor, key);
  if (!ok) {
    actor.session.send({
      kind: 'error',
      text: s('train.failed', actor.lang),
    });
    return;
  }

  actor.session.send({
    kind: 'system',
    tone: 'good',
    text: s('train.success', actor.lang, {
      stat: s(`panel.train_label_${key}`, actor.lang),
      gain: STAT_RATIOS[key],
    }),
  });
  sendStats(actor);
}
```

- [ ] **Step 2: Register in `src/game/commands.js`**

Add to the imports near the other action imports:

```javascript
import train from './actions/train.js';
```

Add to the `COMMANDS` map:

```javascript
  train, tr: train,
```

- [ ] **Step 3: Commit**

```bash
git add src/game/actions/train.js src/game/commands.js
git commit -m "Add `train <stat>` command"
```

---

## Task 6: Strings — English

**Files:**
- Modify: `content/strings/en.json`

- [ ] **Step 1: Add new keys**

Add to `content/strings/en.json` near other `xp.*` and `panel.*` keys (any location is fine — JSON is unordered, but keep grouped for readability):

```json
  "xp.points_granted": "you gain {points} stat points to train.",

  "train.no_arg": "train what? try: train atk | def | int | mr | acc | eva | hp | mp.",
  "train.no_points": "you have no unspent points.",
  "train.unknown_stat": "'{stat}' is not a trainable stat.",
  "train.failed": "training failed.",
  "train.success": "you train {stat} (+{gain}).",

  "panel.unspent_points": "★ {count}",
  "panel.unspent_points_tooltip": "{count} unspent point(s) — click to train.",
  "panel.train_button": "Train",
  "panel.train_label_attack": "ATK",
  "panel.train_label_defense": "DEF",
  "panel.train_label_int": "INT",
  "panel.train_label_magicResist": "MR",
  "panel.train_label_accuracy": "ACC",
  "panel.train_label_evasion": "EVA",
  "panel.train_label_hpMax": "HP",
  "panel.train_label_mpMax": "MP",

  "admin.reset_stats_usage": "@reset-stats <player>",
  "admin.reset_stats_no_such": "no such player '{name}'.",
  "admin.reset_stats_done": "reset {name}: refunded {refunded} point(s); they now have {total} unspent.",
```

- [ ] **Step 2: Commit**

```bash
git add content/strings/en.json
git commit -m "Add English strings for train command and unspent-points UI"
```

---

## Task 7: Strings — Czech

**Files:**
- Modify: `content/strings/cs.json`

- [ ] **Step 1: Add the same keys with Czech translations**

```json
  "xp.points_granted": "získáváš {points} bodů k rozdělení.",

  "train.no_arg": "trénovat co? zkus: train atk | def | int | mr | acc | eva | hp | mp.",
  "train.no_points": "nemáš žádné volné body.",
  "train.unknown_stat": "'{stat}' není trénovatelná vlastnost.",
  "train.failed": "trénink selhal.",
  "train.success": "trénuješ {stat} (+{gain}).",

  "panel.unspent_points": "★ {count}",
  "panel.unspent_points_tooltip": "{count} volných bodů — klikni pro trénink.",
  "panel.train_button": "Trénovat",
  "panel.train_label_attack": "ATK",
  "panel.train_label_defense": "DEF",
  "panel.train_label_int": "INT",
  "panel.train_label_magicResist": "MR",
  "panel.train_label_accuracy": "ACC",
  "panel.train_label_evasion": "EVA",
  "panel.train_label_hpMax": "HP",
  "panel.train_label_mpMax": "MP",

  "admin.reset_stats_usage": "@reset-stats <hráč>",
  "admin.reset_stats_no_such": "hráč '{name}' neexistuje.",
  "admin.reset_stats_done": "reset {name}: vráceno {refunded} bodů; nyní má {total} volných.",
```

- [ ] **Step 2: Commit**

```bash
git add content/strings/cs.json
git commit -m "Add Czech strings for train command and unspent-points UI"
```

---

## Task 8: Client — render unspent-points chip and train popover

**Files:**
- Modify: `client/client.js`
- Modify: `client/style.css`

- [ ] **Step 1: Render the chip and popover in `client.js`**

Locate the block in `client/client.js` where the level/XP bar is appended (around line 155 — `if (typeof msg.level === 'number') { ... appendChild(makeBar(...)); }`). After the existing `playerStatsEl.appendChild(makeBar(xpLabel, ...))` line and BEFORE the HP bar appendChild, insert:

```javascript
  if (typeof msg.unspentPoints === 'number' && msg.unspentPoints > 0) {
    const wrap = document.createElement('div');
    wrap.className = 'unspent-points-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip unspent-points';
    btn.textContent = (labels.unspentPoints ?? '★ {count}').replace('{count}', msg.unspentPoints);
    btn.title = (labels.unspentPointsTooltip ?? '{count} unspent point(s) — click to train.')
      .replace('{count}', msg.unspentPoints);
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openTrainPopover(btn, msg);
    });
    wrap.appendChild(btn);
    playerStatsEl.appendChild(wrap);
  }
```

- [ ] **Step 2: Add `openTrainPopover` near the other popover helpers in `client.js`**

Find an existing popover helper (e.g. anything calling `showPopover` or building `.popover`). Add this function in the same neighborhood. Use whatever popover/anchoring helper is already in this file (search for `popover`); the snippet below assumes a generic `showPopoverNear(anchor, contentEl)` helper exists — if it doesn't, copy the closing/positioning logic from the nearest existing popover function (item-use, give, social) verbatim.

```javascript
function openTrainPopover(anchor, msg) {
  const labels = msg.labels ?? {};
  const order = ['attack', 'defense', 'int', 'magicResist', 'accuracy', 'evasion', 'hpMax', 'mpMax'];
  const ratios = { attack: 1, defense: 1, int: 1, magicResist: 1, accuracy: 1, evasion: 1, hpMax: 5, mpMax: 2 };

  const pop = document.createElement('div');
  pop.className = 'popover train-popover';
  const header = document.createElement('div');
  header.className = 'popover-header';
  header.textContent = labels.trainButton ?? 'Train';
  pop.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'train-grid';
  for (const key of order) {
    const label = labels[`trainLabel_${key}`] ?? key;
    const allocated = msg.allocated?.[key] ?? 0;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip train-stat';
    btn.textContent = `${label} +${ratios[key]}` + (allocated > 0 ? ` (${allocated})` : '');
    btn.addEventListener('click', () => {
      send(`train ${shortName(key)}`);
      closePopover();
    });
    grid.appendChild(btn);
  }
  pop.appendChild(grid);
  showPopoverNear(anchor, pop); // use existing helper name from this file
}

function shortName(key) {
  return ({
    attack: 'atk', defense: 'def', int: 'int', magicResist: 'mr',
    accuracy: 'acc', evasion: 'eva', hpMax: 'hp', mpMax: 'mp',
  })[key];
}
```

NOTE: `send()`, `closePopover()`, and `showPopoverNear()` are placeholders for the helpers that already exist in `client.js`. Before writing this code, grep the file for the actual names (e.g. `socket.send`, `wsSend`, the existing item-use popover function) and use those. If `client.js` builds popovers inline (no shared helper), copy the structure from the nearest existing popover (item-use chip is a good reference per CLAUDE.md).

- [ ] **Step 3: Pass new label keys through `buildPanelLabels`**

Open `src/game/messages/labels.js` and add the new label keys to the returned object so the client can read them via `msg.labels`:

```javascript
    unspentPoints: s('panel.unspent_points', lang, { count: '{count}' }),
    unspentPointsTooltip: s('panel.unspent_points_tooltip', lang, { count: '{count}' }),
    trainButton: s('panel.train_button', lang),
    trainLabel_attack: s('panel.train_label_attack', lang),
    trainLabel_defense: s('panel.train_label_defense', lang),
    trainLabel_int: s('panel.train_label_int', lang),
    trainLabel_magicResist: s('panel.train_label_magicResist', lang),
    trainLabel_accuracy: s('panel.train_label_accuracy', lang),
    trainLabel_evasion: s('panel.train_label_evasion', lang),
    trainLabel_hpMax: s('panel.train_label_hpMax', lang),
    trainLabel_mpMax: s('panel.train_label_mpMax', lang),
```

(Read the file first; match its existing return-object indentation and style.)

- [ ] **Step 4: Style the chip**

Append to `client/style.css`:

```css
.unspent-points-row {
  margin: 4px 0;
}
.chip.unspent-points {
  background: #f3c969;
  color: #222;
  font-weight: 600;
  cursor: pointer;
  animation: unspent-pulse 1.4s ease-in-out infinite;
}
@keyframes unspent-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(243, 201, 105, 0.6); }
  50%      { box-shadow: 0 0 0 6px rgba(243, 201, 105, 0); }
}
.train-popover .train-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
}
.chip.train-stat {
  cursor: pointer;
}
```

- [ ] **Step 5: Commit**

```bash
git add client/client.js client/style.css src/game/messages/labels.js
git commit -m "Client: unspent-points chip and train popover"
```

---

## Task 9: Admin `@reset-stats <player>` command

**Files:**
- Modify: `src/admin/adminCommands.js`

- [ ] **Step 1: Add handler**

Add imports near the top of `src/admin/adminCommands.js`:

```javascript
import { loadPlayer, savePlayer } from '../persist/players.js';
import { resetAllocations, ensureAllocationFields } from '../game/leveling.js';
import { recomputeStats } from '../game/wearables.js';
import { sendStats } from '../game/messages.js';
import { PLAYER_DEFAULT_STATS, normalizeStats } from '../game/stats.js';
```

Add to `ADMIN_HANDLERS`:

```javascript
  'reset-stats': resetStatsCmd,
```

Add the handler at the bottom of the file:

```javascript
async function resetStatsCmd(actor, args) {
  const name = args[0];
  if (!name) {
    actor.session.send({ kind: 'error', text: s('admin.reset_stats_usage', actor.lang) });
    return;
  }

  // Online path: mutate the live actor.
  const online = world.actorsByName.get(name.toLowerCase());
  if (online && online.kind === 'player') {
    const refunded = resetAllocations(online);
    sendStats(online);
    actor.session.send({
      kind: 'system',
      tone: 'good',
      text: s('admin.reset_stats_done', actor.lang, {
        name: online.name,
        refunded,
        total: online.record.unspentPoints,
      }),
    });
    return;
  }

  // Offline path: edit the saved record directly.
  const record = await loadPlayer(name);
  if (!record) {
    actor.session.send({ kind: 'error', text: s('admin.reset_stats_no_such', actor.lang, { name }) });
    return;
  }
  record.stats = normalizeStats(record.stats, PLAYER_DEFAULT_STATS);
  record.baseStats = normalizeStats(record.baseStats ?? record.stats, PLAYER_DEFAULT_STATS);
  ensureAllocationFields(record);
  // Use a tiny shim actor so resetAllocations can call recomputeStats on the offline record.
  const shim = { record, stats: record.stats };
  const refunded = resetAllocations(shim);
  await savePlayer(record);
  actor.session.send({
    kind: 'system',
    tone: 'good',
    text: s('admin.reset_stats_done', actor.lang, {
      name: record.name,
      refunded,
      total: record.unspentPoints,
    }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/admin/adminCommands.js
git commit -m "Admin: @reset-stats refunds allocated points"
```

---

## Task 10: Manual end-to-end verification

No automated test framework exists in this project. Verify by running the server and exercising the flow in a browser.

- [ ] **Step 1: Start the server**

Run: `npm start`
Expected: server boots without errors. Any boot-time validation failure is a regression to fix in a previous task.

- [ ] **Step 2: Connect as an admin player and grant XP via combat**

1. Open `http://localhost:<port>` in a browser, log in as an admin character.
2. Find the closest hostile NPC (rats in the home cottage area work). Kill enough to level up.
3. **Expected console messages:** `you earn N XP.`, `── LEVEL 2 REACHED ──`, `you gain 2 stat points to train.`
4. **Expected panel UI:** a yellow pulsing `★ 2` chip appears below the XP bar.

- [ ] **Step 3: Train via UI**

1. Click the `★ 2` chip. Popover appears with eight chips: `ATK +1`, `DEF +1`, `INT +1`, `MR +1`, `ACC +1`, `EVA +1`, `HP +5`, `MP +2`.
2. Click `HP +5`. Popover closes. `★ 1` (chip count decremented). HP bar `hpMax` increased by 5 and current HP increased by 5.
3. Click the chip again, click `ATK +1`. `★ 0` → chip disappears entirely. ATK in the stat grid increased by 1.

- [ ] **Step 4: Train via text command**

1. Trigger another level-up.
2. Type `train atk` in the input. Expected: `you train ATK (+1).` and ATK increments. Chip count decrements.
3. Type `train atk` with no points: `you have no unspent points.`
4. Type `train`: usage hint message with stat list.
5. Type `train wisdom`: `'wisdom' is not a trainable stat.`

- [ ] **Step 5: Verify persistence**

1. Log out (`quit`) and log back in. `★ N` count and trained stats should persist.
2. Open `data/players/<yourname>.json`. Verify `unspentPoints` and `allocated` are present and reflect what you spent. Verify `baseStats` reflects the gains.

- [ ] **Step 6: Verify Czech localization**

1. Run `lang cs`. Trigger a level-up. Confirm Czech messages appear (`získáváš 2 bodů k rozdělení.`).
2. Click chip, popover header reads `Trénovat`.
3. `train atk` still works (commands stay English per CLAUDE.md). Success message in Czech: `trénuješ ATK (+1).`

- [ ] **Step 7: Verify equipment + allocation interact correctly**

1. Note your current ATK value.
2. Train +1 ATK. ATK goes up by 1.
3. Equip the iron sword (or any +ATK wearable). ATK goes up by the bonus.
4. Remove the sword. ATK returns to base + allocated (NOT base only). This confirms `recomputeStats` is being called after `applyTrain` and that `baseStats` is the source of truth.

- [ ] **Step 8: Admin reset — online**

1. As admin, with a second character `Bob` online who has trained 3 points: type `@reset-stats Bob`.
2. Expected message to admin: `reset Bob: refunded 3 point(s); they now have N unspent.` (where N includes any previously unspent).
3. Bob's panel updates: trained stats revert, `★ N` chip reappears with refunded count.

- [ ] **Step 9: Admin reset — offline**

1. Have Bob log out.
2. Run `@reset-stats Bob`. Expected: same success message, no error.
3. Inspect `data/players/bob.json`: `allocated` is all zeros, `unspentPoints` reflects refund, `baseStats` returned to pre-allocation values.

- [ ] **Step 10: Admin reset — unknown player**

1. `@reset-stats Nobody`. Expected: `no such player 'Nobody'.`

- [ ] **Step 11: Commit any fixes uncovered during verification, separately**

If any task's behavior was wrong, commit the fix as its own commit referring to the task it amends.

---

## Self-review notes

- **Spec coverage:** 2 points/level (Task 3), no caps (no cap logic anywhere — confirmed), eight stats with the agreed ratios (Task 1's `STAT_RATIOS`), level-up icon in panel (Task 8), allocation popover (Task 8), `train` command for power users (Task 5), admin reset (Task 9), persistence (Tasks 2 + existing dirty/save loop), Czech (Task 7).
- **Backwards compatibility:** existing players load with `unspentPoints = 0` and `allocated = {}` (Task 2). Their existing `baseStats` from prior levels stays intact — they just don't retroactively get points. This is intentional; flag in the commit message if needed. If retroactive points are desired, that's a one-line addition to `ensureAllocationFields` (grant `(level - 1) * 2` if `allocated` is empty and `unspentPoints` is 0) — discuss with user before adding, since it interacts with the old fixed-gain players who already received HP/MP.
- **Stat key naming:** the canonical keys match `PLAYER_DEFAULT_STATS` (`attack`, `defense`, `int`, `magicResist`, `accuracy`, `evasion`, `hpMax`, `mpMax`). User-facing aliases (atk/def/etc.) are mapped in `resolveStatKey`. No drift between tasks.
- **HP/MP "current pool" handling:** when training HP/MP, `applyTrain` bumps both `baseStats.hpMax` AND `baseStats.hp` so the gain is felt immediately. `recomputeStats` then clamps `hp` to `hpMax`. Verified consistent across Task 1, Task 3 level-up heal, and the equipment-clamp logic in `wearables.recomputeStats`.
