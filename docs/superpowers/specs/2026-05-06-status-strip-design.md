# Bottom-left HP/MP status strip

## Problem

In combat, the player's eyes have to travel between the bottom-left corner (quickbar buttons: Attack, Spell, Flee; inspect panel showing the targeted NPC) and the top-right corner (player panel with HP/MP bars). That's a long visual jump on every exchange.

## Goal

Put HP and MP within the player's existing bottom-left attention zone, without losing the panel's role as the place to read the full character sheet.

## Design

### Status strip

A new element `#status-strip` sits in the grid between `quickbar` and `input-form` (its own row, full grid-width but the bars themselves are constrained).

- **Contents.** Two bars: HP and MP, in that order. Each is the same shape as the existing panel `.bar` (label cell + track + numeric cell), so the visual language matches what the player already reads.
- **Sizing & alignment.** Strip uses `display: flex; justify-content: flex-start;`. Each bar is `flex: 0 1 240px; min-width: 180px;`, so the pair occupies roughly the bottom-left third to half of the screen, never the full width.
- **Always visible** once the player is logged in. Hidden on the login screen and during the death overlay (same visibility rule as the player panel).
- **Low-HP emphasis.** Reuse the existing `.hp.low` / `.hp.mid` classes — they already drive the colour ramp for the panel's bars.
- **Narrow screens (`max-width: 900px`).** The strip becomes `justify-content: stretch;` and each bar `flex: 1 1 0;`, so on mobile the two bars fill the full row.

### Player-panel changes

In `renderStats`, replace the two `makeBar` calls for HP and MP (currently at [client/client.js:178-181](client/client.js:178)) with a single compact numeric line:

```
HP 26/50    MP 12/20
```

Styled with a new `.vitals-line` class — flex row, dim labels, foreground values, with `.hp.low` / `.hp.mid` colour states applied to the HP value text only.

Everything else in the panel is preserved unchanged:
- XP bar with level (above vitals line)
- Unspent-points level-up button (the gold ★ chip that opens the train popover)
- Stat grid (ATK, ACC, DEF, EVA, INT, MRES, in that exact order)
- Gold row
- Effects, spells, inventory, equipment collapsibles

### Inspect-panel changes

None. NPCs keep the existing `makeBar` HP rendering (currently at [client/client.js:445-450](client/client.js:445)). The inspect panel's HP bar and stat grid keep their existing `max-width: var(--stats-block-width)` constraint so they don't stretch across the column.

### Update path

`renderStats(msg)` already runs on every server `stats` message. It is extended to additionally write into `#status-strip` (same hp/mp/pct/class computation, second mount point — no new server messages, no new state). When the strip first mounts (on login) it gets populated by the next `stats` broadcast just like the panel does today.

## Files touched

- [client/index.html](client/index.html) — add `<div id="status-strip">` between `<nav id="quickbar">` and `<form id="input-form">`, with the two bar elements inside.
- [client/style.css](client/style.css) —
  - add `status` to `grid-template-areas` in both desktop and mobile layouts (new row between `quickbar` and `input`)
  - add `#status-strip` rules (flex layout, alignment, narrow-screen override)
  - add `.vitals-line` rules (panel's compact numeric HP/MP line)
- [client/client.js](client/client.js) —
  - add `statusStripEl` reference alongside the existing `playerStatsEl` reference
  - in `renderStats`, replace the two HP/MP `makeBar` calls in the player panel with a `.vitals-line` element
  - in `renderStats`, populate `#status-strip` with two `.bar`-shaped elements using the same hp/mp values and `.hp.low/.mid` class logic that already exists

## Out of scope

- Combat-only show/hide for the strip. (Decided against during brainstorm — toggling adds a failure mode for no real benefit.)
- Damage-pulse animation on the strip when HP drops. The colour ramp via `.hp.low` / `.hp.mid` is the only emphasis for v1.
- Any change to NPC vitals rendering in the inspect panel.
- Any server-side change.

## Risks

- **Vertical space.** The strip adds ~26px of permanent chrome above the input. The console area shrinks by that amount. Acceptable — the strip earns its row.
- **Localization.** The `HP` / `MP` labels in the strip should go through `labels.hp` / `labels.mp` from the existing `labels` object, the same way the panel bars do, so Czech mode renders correctly.
