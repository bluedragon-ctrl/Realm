# Bottom-left HP/MP Status Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanent bottom-left HP/MP bar strip above the input prompt, and replace the player-panel's HP/MP bars with a compact numeric vitals line.

**Architecture:** Pure client-side change. New grid row holds `#status-strip` between quickbar and input. `renderStats()` writes to two mount points (panel + strip) on every server `stats` message — no new server messages, no new state.

**Tech Stack:** Plain HTML / CSS / ES modules (no build step). Verification is browser-based — the project has no automated client tests.

---

## File Structure

- **[client/index.html](client/index.html)** — add `#status-strip` element with two bars between `<nav id="quickbar">` and `<form id="input-form">`.
- **[client/style.css](client/style.css)** — extend grid template areas, add `#status-strip` rules and `.vitals-line` rules.
- **[client/client.js](client/client.js)** — add `statusStripEl` reference; in `renderStats()` swap the two HP/MP `makeBar` panel calls for a `.vitals-line`, and additionally populate `#status-strip` with two `.bar` elements.

Reference for visual target: [tmp/preview/index.html](tmp/preview/index.html) (mockup committed during brainstorm).

---

## Task 1: Add the status-strip DOM element

**Files:**
- Modify: [client/index.html](client/index.html) — between `</nav>` and `<form id="input-form">`

- [ ] **Step 1: Insert status-strip markup**

In [client/index.html](client/index.html), locate the closing `</nav>` of `#quickbar` (around line 54) and the line `<div id="action-popover" hidden></div>` that follows it. Insert the status-strip immediately before `<form id="input-form">`. The full surrounding region should read:

```html
    <div id="action-popover" hidden></div>

    <div id="status-strip" hidden>
      <div class="strip-bar" id="strip-hp">
        <span class="strip-label">HP</span>
        <span class="strip-track"><span class="strip-fill hp"></span></span>
        <span class="strip-num">0/0</span>
      </div>
      <div class="strip-bar" id="strip-mp" hidden>
        <span class="strip-label">MP</span>
        <span class="strip-track"><span class="strip-fill mp"></span></span>
        <span class="strip-num">0/0</span>
      </div>
    </div>

    <form id="input-form">
```

Notes:
- `hidden` on the wrapper matches the player panel's pre-login behaviour.
- `#strip-mp` starts hidden because `renderStats` only shows MP when `s.mpMax > 0`.

- [ ] **Step 2: Visual sanity check**

Run `node server.js`, open `http://localhost:8080`, log in. The strip will be present in DOM but unstyled (no grid area yet). It will appear awkwardly in the input row — that's expected and fixed in Task 2.

- [ ] **Step 3: Commit**

```bash
git add client/index.html
git commit -m "Status strip: add DOM scaffold"
```

---

## Task 2: Grid layout and strip styling

**Files:**
- Modify: [client/style.css](client/style.css) — `#app` grid (around line 37–63), and append new rules at the bottom of the file

- [ ] **Step 1: Update desktop grid template**

In [client/style.css](client/style.css), the `#app` rule (around line 37) currently is:

```css
#app {
  display: grid;
  height: 100vh;
  grid-template-columns: 1fr 340px;
  grid-template-rows: auto 1fr 260px auto auto;
  grid-template-areas:
    "topbar    topbar"
    "console   player"
    "inspect   player"
    "quickbar  quickbar"
    "input     input";
}
```

Add a `status` row between `quickbar` and `input` and an extra `auto` track:

```css
#app {
  display: grid;
  height: 100vh;
  grid-template-columns: 1fr 340px;
  grid-template-rows: auto 1fr 260px auto auto auto;
  grid-template-areas:
    "topbar    topbar"
    "console   player"
    "inspect   player"
    "quickbar  quickbar"
    "status    status"
    "input     input";
}
```

- [ ] **Step 2: Update narrow-screen grid template**

The `@media (max-width: 900px)` block (around line 50) currently is:

```css
@media (max-width: 900px) {
  #app {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto auto auto auto;
    grid-template-areas:
      "topbar"
      "console"
      "inspect"
      "player"
      "quickbar"
      "input";
  }
  #player-panel, #inspect-panel { max-height: 200px; }
}
```

Add the `status` row and an extra `auto` track:

```css
@media (max-width: 900px) {
  #app {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto auto auto auto auto;
    grid-template-areas:
      "topbar"
      "console"
      "inspect"
      "player"
      "quickbar"
      "status"
      "input";
  }
  #player-panel, #inspect-panel { max-height: 200px; }
}
```

- [ ] **Step 3: Add status-strip rules**

Append at the end of [client/style.css](client/style.css):

```css
#status-strip {
  grid-area: status;
  display: flex;
  gap: 16px;
  padding: 6px 12px;
  background: #131318;
  border-top: 1px solid var(--border);
  justify-content: flex-start;
}
#status-strip .strip-bar {
  flex: 0 1 240px;
  min-width: 180px;
  display: grid;
  grid-template-columns: 28px 1fr 78px;
  align-items: center;
  gap: 8px;
}
#status-strip .strip-label {
  color: var(--dim);
  font-size: 12px;
  letter-spacing: 0.04em;
}
#status-strip .strip-track {
  height: 14px;
  background: #232327;
  border: 1px solid var(--border-2);
  border-radius: 3px;
  overflow: hidden;
}
#status-strip .strip-fill {
  height: 100%;
  transition: width 0.2s ease;
}
#status-strip .strip-fill.hp { background: var(--hp); }
#status-strip .strip-fill.hp.mid { background: var(--hp-mid); }
#status-strip .strip-fill.hp.low { background: var(--hp-low); }
#status-strip .strip-fill.mp { background: var(--mp); }
#status-strip .strip-num {
  font-size: 12px;
  color: var(--fg);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 900px) {
  #status-strip { justify-content: stretch; }
  #status-strip .strip-bar { flex: 1 1 0; }
}
```

- [ ] **Step 4: Visual check**

Reload the page and log in. The strip should now appear as a row above the input, with its HP bar visible on the bottom-left. Bars are unpopulated (still showing `0/0`, full-width fill from the inline default) — Task 3 wires the values.

- [ ] **Step 5: Commit**

```bash
git add client/style.css
git commit -m "Status strip: grid placement and bar styling"
```

---

## Task 3: Wire status-strip values from `renderStats`

**Files:**
- Modify: [client/client.js](client/client.js) — references at top of file (around line 1–23), `renderStats` body (around line 125–181), login/logout visibility (around lines 307 and 610)

- [ ] **Step 1: Add element references**

In [client/client.js](client/client.js), after the existing `const consumablesBtn = ...` line (around line 23), add references for the strip and its parts:

```javascript
const statusStrip = document.getElementById('status-strip');
const stripHpRow = document.getElementById('strip-hp');
const stripHpFill = stripHpRow.querySelector('.strip-fill');
const stripHpNum = stripHpRow.querySelector('.strip-num');
const stripHpLabel = stripHpRow.querySelector('.strip-label');
const stripMpRow = document.getElementById('strip-mp');
const stripMpFill = stripMpRow.querySelector('.strip-fill');
const stripMpNum = stripMpRow.querySelector('.strip-num');
const stripMpLabel = stripMpRow.querySelector('.strip-label');
```

- [ ] **Step 2: Update strip in `renderStats`**

In [client/client.js](client/client.js), `renderStats(msg)` already computes `hpPct`, `mpPct`, and `hpClass` (around lines 150–152). After those three lines, insert strip-update logic:

```javascript
  // Mirror HP/MP into the always-visible bottom-left status strip.
  stripHpLabel.textContent = labels.hp ?? 'HP';
  stripHpNum.textContent = `${s.hp ?? 0}/${s.hpMax ?? 0}`;
  stripHpFill.className = `strip-fill hp ${hpClass}`;
  stripHpFill.style.width = `${hpPct}%`;
  if (s.mpMax > 0) {
    stripMpRow.hidden = false;
    stripMpLabel.textContent = labels.mp ?? 'MP';
    stripMpNum.textContent = `${s.mp ?? 0}/${s.mpMax}`;
    stripMpFill.style.width = `${mpPct}%`;
  } else {
    stripMpRow.hidden = true;
  }
```

- [ ] **Step 3: Show/hide strip with the player panel**

`renderStats` ends with `playerPanel.hidden = false;` (line 307). Immediately after that line add:

```javascript
  statusStrip.hidden = false;
```

Find the logout/disconnect path that does `playerPanel.hidden = true;` (line 610) and immediately after it add:

```javascript
    statusStrip.hidden = true;
```

- [ ] **Step 4: Visual check**

Reload, log in. The strip should now show real `HP x/y` and `MP x/y`, with bar widths matching values. Take damage (e.g. attack a wolf) — the strip should update on each `stats` message just like the panel does. When HP drops below 60% the bar turns yellow; below 30% it turns red.

- [ ] **Step 5: Commit**

```bash
git add client/client.js
git commit -m "Status strip: wire HP/MP from stats messages"
```

---

## Task 4: Replace panel HP/MP bars with compact vitals line

**Files:**
- Modify: [client/client.js](client/client.js) — `renderStats`, lines 178–181
- Modify: [client/style.css](client/style.css) — append `.vitals-line` rules

- [ ] **Step 1: Add `.vitals-line` CSS**

Append at the end of [client/style.css](client/style.css):

```css
.vitals-line {
  display: flex;
  gap: 14px;
  font-size: 13px;
  margin: 6px 0 8px;
  max-width: var(--stats-block-width);
}
.vitals-line .vital-label { color: var(--dim); margin-right: 4px; }
.vitals-line .vital-value { color: var(--fg); font-variant-numeric: tabular-nums; }
.vitals-line .vital-value.hp.mid { color: var(--hp-mid); }
.vitals-line .vital-value.hp.low { color: var(--hp-low); }
```

- [ ] **Step 2: Replace the panel bars with a vitals line**

In [client/client.js](client/client.js), the current `renderStats` panel HP/MP block (lines 178–181) is:

```javascript
  playerStatsEl.appendChild(makeBar(labels.hp ?? 'HP', `${s.hp}/${s.hpMax}`, hpPct, `hp ${hpClass}`));
  if (s.mpMax > 0) {
    playerStatsEl.appendChild(makeBar(labels.mp ?? 'MP', `${s.mp}/${s.mpMax}`, mpPct, 'mp'));
  }
```

Replace those four lines with:

```javascript
  const vitals = document.createElement('div');
  vitals.className = 'vitals-line';
  const hpSpan = document.createElement('span');
  const hpLab = document.createElement('span');
  hpLab.className = 'vital-label';
  hpLab.textContent = labels.hp ?? 'HP';
  const hpVal = document.createElement('span');
  hpVal.className = `vital-value hp ${hpClass}`;
  hpVal.textContent = `${s.hp ?? 0}/${s.hpMax ?? 0}`;
  hpSpan.appendChild(hpLab);
  hpSpan.appendChild(hpVal);
  vitals.appendChild(hpSpan);
  if (s.mpMax > 0) {
    const mpSpan = document.createElement('span');
    const mpLab = document.createElement('span');
    mpLab.className = 'vital-label';
    mpLab.textContent = labels.mp ?? 'MP';
    const mpVal = document.createElement('span');
    mpVal.className = 'vital-value mp';
    mpVal.textContent = `${s.mp}/${s.mpMax}`;
    mpSpan.appendChild(mpLab);
    mpSpan.appendChild(mpVal);
    vitals.appendChild(mpSpan);
  }
  playerStatsEl.appendChild(vitals);
```

- [ ] **Step 3: Visual check**

Reload and log in. The player panel should now show, in order:
1. XP bar (with `Lv N` label) — unchanged
2. Gold `★ N` level-up button (only if you have unspent points) — unchanged
3. **New compact line:** `HP x/y    MP x/y` — colour-shifts to yellow/red on the HP value when low
4. Stat grid (ATK / ACC / DEF / EVA / INT / MRES) — unchanged
5. Gold row, effects, spells, inventory, equipment — all unchanged

Confirm the inspect panel for an NPC still shows the full HP bar (this code path is untouched).

- [ ] **Step 4: Switch language to Czech and re-verify labels**

In the running session, run `lang cs`. The strip's HP/MP labels and panel vitals labels should both update to Czech (whatever `labels.hp` / `labels.mp` resolve to in `content/strings/cs.json`).

- [ ] **Step 5: Commit**

```bash
git add client/style.css client/client.js
git commit -m "Player panel: replace HP/MP bars with compact vitals line"
```

---

## Task 5: End-to-end verification

- [ ] **Step 1: Smoke test full flow**

With `node server.js` running, open the client and verify in one continuous session:

1. Login screen has no strip visible (the `hidden` attribute is in effect until `renderStats` runs).
2. After login, strip appears bottom-left above the input.
3. Strip width: HP and MP bars together occupy roughly the bottom-left third of the screen, never the full row, on a wide monitor.
4. Resize the browser below 900px — bars stretch to full width.
5. Attack a wolf, confirm HP bar in strip updates per tick.
6. Cast a spell, confirm MP bar in strip updates.
7. HP below 60% → yellow; below 30% → red, on both strip bar and the panel's HP value text.
8. NPC inspect window shows wolf with full HP bar (unchanged behaviour).
9. Trigger death (let the wolf finish you off). Death overlay appears; strip is still in the DOM but obscured by the overlay (no special hide needed). On respawn, strip is back to full HP.
10. Run `lang cs`. HP/MP labels in both strip and panel switch to Czech.

- [ ] **Step 2: Final commit (if anything was tweaked during smoke test)**

If smoke test surfaced any visual fix:

```bash
git add -p
git commit -m "Status strip: smoke-test polish"
```

Otherwise no commit.

---

## Out of scope (do not implement in this plan)

- Combat-only show/hide animation
- Damage-pulse animation on the strip
- Inspect-panel changes (NPC HP rendering stays as-is)
- Server-side changes (no new messages or fields)
