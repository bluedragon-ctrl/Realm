# Pre-light content audit — decisions captured

Companion to `2026-05-09-pre-light-content-audit.md`. Records edge cases surfaced during the read-through and proposes spec deltas for the light system PR.

## Summary of fields landed

| Layer | Files walked | Annotated |
|---|---|---|
| Items (`lightSource`) | ~85 | **0** |
| Rooms (`outdoor` / `lightBase`) | 60 | 54 (29 outdoor, 12 dim, 17 dark; 4 rooms got both `outdoor` + `dim` — see canopy delta) |
| NPCs (`vision`) | 39 | 28 (7 `low_light`, 19 `nightvision`, 2 `blind`) |

Validators do not reject unknown fields (`src/persist/validators/*.js` only check known keys), so the audit content loads cleanly today; engine fields can land in a follow-up.

## Items — no candidates

The content tree has **no hand-carryable light source items** (no lantern, candle, torch, lamp, glowstick, glowing amulet, etc.). The only fire-related fixture is `forest.cold_campfire`, which is explicitly cold and dead. `home.cauldron` sits on a "cold ash pit" — also unlit.

**Implication for the light-system PR:** the first light-source items (a lantern, a candle, maybe a magical torch) need to be authored *as part of* the light PR, not the audit. Without them, `lightBase: "dark"` rooms (mine, crypts, deep_hall, well_bottom) are unenterable for normal-vision players once the engine starts gating perception by light. Suggest a minimum spawn list: one cheap lantern at `village.smith` or `mine.entrance`, one candle at `home.cottage`.

## Indoor rooms whose prose implies an active light source

Candidates for `room.activeLight` declarations at world load so prose stays truthful when the engine lands:

| Room | Source in prose |
|---|---|
| `home.cottage` | "a little fire burns in the fireplace and a kettle hangs above it" |
| `village.bakery` | "a big stone oven glowing in the back" |
| `village.pub` | "a fire crackling in a stone fireplace" |
| `village.smith` | "sparks fly from a forge in the corner" |
| `mine.entrance` | "torches in iron brackets cast orange light" (currently annotated `dim`; arguably `light` with `activeLight` torches) |
| `mine.chief_hall` | "smoke from a fire pit in the middle of the floor" (currently `dark`; fire pit could justify `dim`) |
| `forest.tower_tomb` | "faint runes glow on the floor … the only light in the room" |

**Decision needed for the light spec:** do these get explicit `activeLight` entries (so the engine can model them losing their light if the source is removed), or stay declarative (prose-only, treated as default `light` indoor)? Recommend `activeLight` for `mine.entrance` and `mine.chief_hall` at minimum, since their `lightBase` would otherwise hide the fact that they're lit *because of* the torches/fire.

## "Dim by day, dark by night" / aperture rooms

The spec's edge-case note asked whether 3+ rooms want a third axis. The audit found **one canonical case** and one near-case:

- **`village.cellar`** — "lit only by what light spills down through the hatch." Indoor but has an aperture to outdoors. Currently annotated `dim`; should arguably be `dark` at night.
- **`forest.cave`** — bear's cave, currently `dark`. Cave mouth could be "dim by day" but the prose doesn't strongly imply daylight reaches it; held at `dark`.

**Spec-delta proposal (low priority):** a `darkAtNight: true` boolean on `dim` rooms with a skylight or hatch. Only `village.cellar` clearly wants it. If a second case appears in upcoming content, ship it; for now hand-author as `dim` and accept the inconsistency at night.

## Canopy / partially-roofed outdoor (4 rooms)

Four rooms got both `outdoor: true` and `lightBase: "dim"`:

- `forest.deep_forest` — "canopy shuts out most light"
- `forest.tangled_slope` — "light thinner here"
- `forest.wolf_den` — "open gully half-roofed by leaning pines"
- (one more flagged by the room agent — see annotations)

**Ambiguity:** does day/night still raise these to `light` at noon, or does the canopy clamp the max to `dim`?

**Spec-delta proposal (medium priority):** define the semantics of `outdoor + lightBase: "dim"`. Two options:
1. **Clamped canopy** (recommended): outdoor controls day/night transitions; `lightBase` clamps the max. Day in a canopy room = `dim`, night = `dark`. Simple, no new field needed.
2. **Add `canopy: true`**: separate flag, makes the semantics explicit. More cost, more clarity.

Recommend (1) — reuse existing fields, document the interaction in the light spec.

## NPC sense modes — single field is tight but workable

The `vision` enum captures most cases. The places it strains:

- **Wolf / bear / fox / fox_pup** — fiction strongly implies scent *and* sight (sniffing emotes, prey-tracking lore). Annotated as `low_light` (the visual sense), losing the scent signal.
- **`castle.shambling_zombie`** — annotated `blind` because prose says "milky eyes … always finds a way toward warm things." This is really "warmth/scent perception," not blindness in the literal sense. The field works at the engine level (treats `dark` as visible) but the modeling is fuzzy.
- **`castle.wight` / `castle.fallen_lord`** — kept `nightvision` because both are described with active visual cues ("watches you with cold blue eyes"). Worth a sanity check by a designer before the perception layer reads `vision`.

**Spec-delta proposal (defer):** promote `vision` to a list (e.g. `["scent", "low_light"]`, `["warmth"]`). Five-to-six NPCs would benefit. Recommend deferring until the perception layer is being implemented and the actual game effect of these distinctions is decided — until then, single-value is enough and easy to migrate.

## Rooms flagged for human review (coin-flip calls)

| Room | Call made | Alternative |
|---|---|---|
| `forest.cave` | `dark` | could be `dim` (cave mouth) |
| `forest.wolf_den` | `outdoor` + `dim` | could be `indoor` + `dim` |
| `forest.tangled_slope` | `outdoor` + `dim` | could be `outdoor` only |
| `forest.fox_den` | `dim` | could be `dark` (underground, but prose says "cosy") |
| `forest.tower_entry` | `dim` | could be `dark` (ruined ground floor, no light source described) |
| `castle.gatehouse` | indoor + `dim` | could be `outdoor` (half-collapsed roof) |
| `village.cellar` | indoor + `dim` | the canonical aperture case — see "dim by day, dark by night" above |
| `forest.spider_lair` | `dark` | pre-existing `tags` array lacks "indoor" tag (vs `forest.cave` which has both); not changed |

Defer these to the light-system PR — they don't need a fix now, but they're the rooms a designer should re-read once the engine actually gates visibility.

## Recommendations for the light-system PR

1. **Author 2–3 light-source items** as part of the PR (lantern, candle, maybe a magical sun-rod): one cheap purchasable, one starter. Without them, `dark` rooms become inaccessible to normal-vision players.
2. **Decide canopy semantics** — pick option (1) above (clamped canopy) and document it.
3. **Decide active-light authoring** for the 7 indoor rooms listed: explicit `activeLight` entries vs purely declarative prose. Recommend `activeLight` for `mine.entrance` and `mine.chief_hall`.
4. **Add validator entries** for the new fields (`outdoor`, `lightBase`, `vision`, `lightSource`) — validate enum values, accept-but-warn on unknown values during the transition.
5. **Re-walk the 8 coin-flip rooms** with a designer once the engine renders light visibly.
6. **Sense-mode list-typing for `vision`** — defer until perception layer needs the distinction; document the migration path (string → string-or-list) in the spec so authors can prepare.
