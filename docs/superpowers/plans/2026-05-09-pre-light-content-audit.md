# Pre-light content audit

Goal: annotate existing content with the fields the light system will read, **before** the light engine lands. The audit produces (a) the annotated content and (b) a feedback document that may inform spec adjustments.

## Scope

Three field passes, all on existing content. No engine code changes; the new fields sit unused until the light system ships.

### 1. Rooms

Walk every file under `content/rooms/**`. Add two optional fields:

- **`outdoor: true`** — set on rooms that are open to the sky. Forest paths, meadows, village squares, courtyards, river banks. Default (omitted) is indoor. **No behavior in v1**, but day/night cycle will read it later, so authoring it now avoids a re-pass.
- **`lightBase: "light" | "dim" | "dark"`** — set when the room's static lighting is anything other than `"light"`. Caves, mines, deep dungeons, sealed cellars, pitch-black tombs. Default (omitted) is `"light"`.

Examples by region (rough guide, not binding):

| Region | Typical outdoor | Typical lightBase |
|---|---|---|
| `home.*` | `cottage` indoor; `yard`, `garden` outdoor | `"light"` everywhere |
| `forest.*` | most outdoor | `"light"`; `tower_basement` or similar may be `"dim"`/`"dark"` |
| `village.*` | streets/squares outdoor; shops/inns indoor | `"light"` everywhere |
| `castle.*` | courtyards outdoor; halls/cells indoor | hall maybe `"dim"`; `tomb`, dungeons `"dark"` |
| `mine.*` | indoor | shallow `"dim"`, deep `"dark"` |

### 2. Monsters / NPCs

Walk every file under `content/npcs/**`. Add one optional field:

- **`vision: "normal" | "low_light" | "nightvision" | "blind"`** — default (omitted) is `"normal"`.
  - `"normal"` — sees `light` and `dim`; not `dark`.
  - `"low_light"` — sees `light` and `dim`; partial in `dark` (treated as `dim` in v2 mechanical layer).
  - `"nightvision"` — sees all light states equally well.
  - `"blind"` — never relies on sight; effectively perceives `dark` in all rooms (uses other senses).

**No behavior in v1.** The light system v1 doesn't gate NPC perception; the field exists so the v2 mechanical layer (light + perception) lands cleanly. Mark by intuition during the read-through:

- Cave-dwellers, bats, rats, cellar pests → `"nightvision"`
- Wolves, cats, owls → `"low_light"`
- Humans, most humanoids → omit (default `"normal"`)
- Oozes, some undead, mindless constructs → `"blind"` (perceives via vibration/scent)

### 3. Items with light generation

Search `content/items/**` and identify candidates:

- Items whose name or description implies light: candle, lantern, torch, lamp, glowstick, glowing amulet.
- Fixed room items implying light: campfire, brazier, fireplace, sconce. These stay in `content/items/fixtures/` if they are; the light contribution they make in v1 is via `room.activeLight` at world load time, so an authoring decision is needed (see open question below).

Add the new optional field on hand-carryable lit items:

```json
"lightSource": { "level": "light" | "dim" }
```

- `"light"` — strong sources (lantern, magical torch, sun rod).
- `"dim"` — weaker sources (candle, glowing amulet, dying torch).

No fuel, no on/off — those are deferred. If an item description implies it can be lit/unlit, ship the lit version with `lightSource` and (optionally) author an unlit variant as a separate item id. Decide per-item; the audit is a reading pass, not a content-rewrite pass.

## Out of scope for this audit

- **Day/night cycle authoring** — schedule, time-of-day strings, transition messages. Lives with the day/night roadmap entry.
- **NPC starting positions** (sit/sleep). Lives with the actor-positions roadmap entry; that's a separate read-through.
- **Perception bonuses on items / passive effects on NPCs.** Lives with the perception roadmap entry; another separate read-through.
- **New light-source items.** This audit annotates existing items only. Authoring a brand-new lantern/candle item belongs in the light-system PR proper, not the audit.
- **Engine code changes.** Validators don't yet accept these fields; that's part of the light-system PR. The audit's content can sit in a branch until the validator change lands, or land first and the validator additions land in a follow-up — either order works since the validator is "fail loudly on **unknown** values," not "fail loudly on present values."

## Edge cases to capture during the read-through

These are decisions that should feed back into the light spec, not audit-time guesses. Add a "decisions captured" entry with the room/NPC ID and the question.

- **"Dim by day, dark by night" rooms** — cave mouths, twilight glades, ground floor of a dim mine. The current spec only has `lightBase` + outdoor day/night. If 3+ rooms want this, the spec needs a third axis. If 1–2, hand-author them as outdoor with a note.
- **Indoor rooms that describe light sources in prose** — "a fireplace burns merrily." Should those rooms get an active campfire-style entry in `room.activeLight` at world load (so the prose stays truthful when the engine lands), or stay declarative? Decide per-room.
- **NPCs that should arguably have multiple sense modes** — a wolf with both scent and `"low_light"` sight. The single `vision` field won't capture that; if it comes up often, the field becomes a list. If once or twice, ignore and pick the dominant sense.
- **Already-existing fixtures that imply light** — search for `home.cauldron`, `forest.spellbook_table`, etc. in `content/items/fixtures/`. Some may want `lightSource`; others (a closed cauldron) clearly do not. Decide per-fixture.

## Deliverables

1. **Annotated content** — every file walked, fields added where applicable. One PR or merged into the light-system PR (whichever lands first).
2. **`docs/superpowers/plans/2026-05-09-pre-light-content-audit-decisions.md`** (created during the audit) — captured edge-case decisions, room/NPC IDs that need a follow-up spec call, any field-shape changes proposed for the light spec.
3. **Spec deltas, if any** — if the audit surfaces enough edge cases to change the spec (e.g. a `partialOutdoor` field), update the light spec in the same PR as the deltas, citing the audit.

## Process

The audit is a single read-through, not a multi-week task. Estimated scope: ~150–250 small JSON files. Recommended order:

1. Items first (smallest set that surfaces light-source candidates) — produces a list of items getting `lightSource`.
2. Rooms second — produces `outdoor` and `lightBase` annotations and surfaces the "dim by day" edge case.
3. NPCs last — produces `vision` annotations.

Doing items first means by the time you're walking rooms, you already know which inventory or floor items contribute light, which sharpens the room-level annotation calls (e.g. an inn with a lantern on every table is light-positive even before a player walks in).

## Verification

- Run the existing test suite after the audit content lands, before the engine lands. The fields are unknown to the validators, so:
  - **If validators are strict on unknown fields**, the audit content fails to load. Either land validator additions first (allow but don't act on the new fields), or hold the audit content in a branch.
  - **If validators ignore unknown fields**, the audit lands cleanly and waits for the engine.
- Confirm in `src/persist/validators/{room,item,npc}.js` which mode the project is in before committing the audit content.