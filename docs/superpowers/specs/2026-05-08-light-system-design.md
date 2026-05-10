# Light system (v1: visual-only)

## Problem

Rooms are uniformly lit. There is no notion of dark caves, dim dusk, candles, or magical light. This blocks the deep-mine/forest-night content direction and the planned `light` / `darkness` / `nightvision` / `blindness` spells.

## Goal

Give each room an effective light level (`light` / `dim` / `dark`) that gates **what players see and read**, without yet touching combat, movement, or NPC behavior. Build the plumbing so the mechanical layer (perception checks, NPC sight, combat penalties) and the day/night cycle can attach later as additional contributions to `effectiveLight`, not as a rewrite.

## Design

### Light states

Three values, ordered: `dark` < `dim` < `light`. Stored as strings on rooms, no numeric ramps in v1. No partial states, no per-tile.

### Effective light = max of contributions

`effectiveLight(room)` is computed on demand (no caching):

1. `room.lightBase` — content-defined static floor. Default `light`.
2. **Active room light effects** — entries on `room.activeLight`: lit campfires, `light` spell active, etc. Each contributes a level.
3. **Actors in the room carrying a light source** — any item with `lightSource: { level }` in any actor's inventory or equipment slots, plus any such item lying on the room floor.

The result is `max(...contributions)` using the three-state order. If nothing contributes, fall back to `lightBase`. Contributions only ever raise the level above `lightBase`; they never darken below it. Magical darkness in v2 will need a separate "darken" rule and is out of scope.

The day/night cycle, when it lands later, will plug in as an additional contribution at this same site, gated by `room.outdoor === true`. The `outdoor` flag is authored on rooms in v1 as a forward-looking marker (see "Content authoring") but has **no behavior in v1**.

### Per-actor perceived light

Each actor sees the room as `effectiveLight(room)` modified by their active effects:

- `blindness` clamps perceived light to `dark`.
- `nightvision` clamps perceived light to at least `dim`.
- Both express via `activeEffects` entries with a new `perception` field on the effect def: `perception: "blind"` or `perception: "nightvision"`. The effects engine doesn't run them as ticks; `perceivedLight(actor, room)` reads the field at compute time.

### What the level changes (visual-only v1)

`describeRoom` (in `src/game/actions/look.js`) consults `perceivedLight(actor, room)` and emits one of three room-message variants:

- **light** — current behavior, full payload.
- **dim** — `name`, `short`, `exits`, plus actor and item lists with **names only** (no flavor, no NPC `disposition` annotation, no inspect-popover affordance for items beyond name+pickable). Drop `long`. New string `room.dim_hint` ("It is hard to see clearly.") added before the short.
- **dark** — `name`, `exits` (you can still feel the doorways), and a single new system string `room.dark` ("It is too dark to see anything."). No `long`, `short`, `npcs`, `others`, `items`, or `gold`.

The client renders these by branching on the `light` field added to the `room` message. No new client message kind.

`pushTargetInfo` / `look <name>` is gated the same way: if the target is in a room the looker perceives as `dark`, return `look.too_dark` instead of the inspect payload. In `dim`, return name + subtitle + (no `long`/`description`).

### Light sources

New optional item field:

```json
"lightSource": { "level": "light" | "dim" }
```

Any item with this field contributes its level to the room when:
- equipped on an actor in the room, or
- in an actor's inventory in the room, or
- lying on the room floor.

No fuel, no charges, no on/off state in v1. A "lit candle" is just an item with `lightSource: { level: "dim" }`. Authoring an unlit version is a separate item with no `lightSource`. Item content authors can choose either approach for v1; runtime supports both.

### Persistence

- `lightBase`, `outdoor`, `lightSource` — content (committed). `outdoor` is authored in v1 but unused at runtime; it becomes meaningful when day/night ships.
- `room.activeLight` array — initialized empty at boot. Same invariant as floor items: anything in it (campfire, room-cast `light` spell) is **not** persisted across reboots. Writes go through the room-state path.
- `blindness` / `nightvision` on actors — already covered by `activeEffects` save/load.

### Content authoring

Room defs gain two optional fields:

```json
{
  "id": "mine.deep_shaft",
  "lightBase": "dark",
  ...
}
```

```json
{
  "id": "forest.meadow",
  "outdoor": true,
  ...
}
```

Defaults: `lightBase: "light"`, `outdoor: false`. Validator fails loudly on any other value (per project convention).

Existing rooms need no edits to keep working. The pre-light content audit pass (see `docs/superpowers/plans/2026-05-09-pre-light-content-audit.md`) annotates every room with `outdoor` and any non-default `lightBase` ahead of the engine landing, so this change is content-ready on day one.

### Strings

New keys in `content/strings/{en,cs}.json`:

- `room.dark` — "It is too dark to see anything." / "Je tu příliš tma, nic nevidíš."
- `room.dim_hint` — "It is hard to see clearly." / "Je obtížné dobře vidět."
- `look.too_dark` — "It is too dark to make out who that is." / "Je příliš tma, nepoznáš, kdo to je."

## Files touched

- `src/game/world.js` — add `room.activeLight: []` initialization at world load. Add `effectiveLight(room)` and `perceivedLight(actor, room)` helpers (or in a new `src/game/light.js` if the helpers grow).
- `src/game/world/load.js` (and `src/persist/validators/room.js`) — accept and validate `lightBase` and `outdoor` on rooms.
- `src/persist/validators/item.js` — accept and validate optional `lightSource: { level }` on items.
- `src/persist/validators/effect.js` — accept optional `perception: "blind" | "nightvision"`.
- `src/game/actions/look.js` — branch in `describeRoom` and `sendTargetInfo` on perceived light.
- `client/client.js` — handle `light` field on room messages; render dim/dark variants.
- `client/style.css` — optional subtle background tint for dim/dark room panel; not required for correctness.
- `content/strings/en.json`, `content/strings/cs.json` — three new keys.

## Out of scope (v2+)

- **Day/night cycle.** World clock, schedule, transition broadcasts, and the time-of-day contribution to `effectiveLight` for outdoor rooms. Decoupled into its own roadmap entry. The `outdoor` content flag is authored in v1 so the cycle can plug in without a content-migration pass.
- **Mechanical effects.** Combat to-hit penalties, movement restrictions, NPC sight checks, skill-check gates. All deferred until perception/skill-check primitive lands.
- **Magical darkness** (a `darkness` spell that lowers light below the room's base). Needs the contribution rule to support darkening, not just brightening.
- **Light source fuel / duration.** Item `state.fuel` ticking down, candles burning out. Adds tick-loop work; defer.
- **On/off state for light sources.** A torch you can light/extinguish. In v1, lit and unlit are separate item defs if needed.
- **Per-direction visibility** (`look north` peeking into next room).
- **NPC light sources.** Hostile orcs carrying torches. NPCs get the same any-actor-in-room rule for free, but no behavior trees for them to ignite/extinguish.
- **Region-level outdoor flag.** v1 requires `outdoor: true` per room; a region default can come later if the manual flagging gets tedious.

## Risks

- **Inspect panel drift.** The `target-info` message has a lot of fields; the dim/dark variants must omit the right subset without breaking the client renderer. Mitigation: the client treats missing fields as "not shown," matching how `disposition === 'neutral'` is already optional.
- **Czech grammar in dark messages.** The new strings use nominative; should read naturally because they're complete sentences with no `{target}` slot. Confirm with a Czech pass before merge.
