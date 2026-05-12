# Light system (v1: player-side visibility)

Supersedes `2026-05-08-light-system-design.md`. The earlier draft was written before the pre-light content audit (`docs/superpowers/plans/2026-05-09-pre-light-content-audit-decisions.md`) and before the candle/lantern items shipped. This version captures the actual content shape that landed and tightens the perception composition site.

## Problem

Rooms are uniformly lit. There is no notion of dark caves, dim dusk, candles, or magical light. The pre-light audit annotated every room (`outdoor`, `lightBase`) and every NPC (`vision`), and the first two light-source items (`item.candle` → `effect.candlelight`, `item.lantern`) are authored. None of that data is read at runtime yet.

## Goal

Give every room a computed light level (`light` / `dim` / `dark`) that gates **what the player sees and reads** — room descriptions, `look <target>`, and combat narration that would reveal a hidden attacker. Visual-only. Combat to-hit, NPC sight, day/night, and on/off light-source state are explicitly deferred.

Build the composition seam (`canPerceiveRoom`) so the deferred systems plug in without a rewrite, and keep the contribution model open to a darkening spell.

## Inspirations

DikuMUD's original light system (1991 Alfa release):

- Binary `IS_DARK(room) = !light_counter && (room_flags & DARK)` — a "naturally dark" room becomes lit when any carrier brings in a light source.
- `do_look` short-circuits in dark rooms with a single canned message and no further detail.
- `CAN_SEE` composes light + blindness + invisibility into one predicate.

We keep the spirit, with three differences:
1. **Three states, not two** — `dim` is a real gameplay register (names without flavor) earned by the audit's annotation work.
2. **Compute on demand, not cached counter** — our world is small; an `O(actors + items)` walk per `look` is fine and removes the maintenance burden of keeping a counter consistent across take/drop/move/spawn/effect-expire.
3. **Effects can carry `lightSource`, not just items** — a lit candle is an item that applies a finite-duration effect, and the effect contributes the light. No item on/off state needed.

## Pre-prepared content

Already authored, waiting on the engine:

- `item.candle` (consumable) → applies `effect.candlelight` (300 ticks, contributes `dim`).
- `item.lantern` (wearable, utility slot, contributes `light`).
- Every room annotated with `lightBase` and `outdoor`.
- Every NPC annotated with `vision`.

Coming after v1 lands (not part of this spec, but the design must not preclude them):

- `spell.light` — apply a buff effect on caster or room contributing `light`.
- `spell.darkness` — apply an effect that **lowers** the room's perceived light below `lightBase`. Forces the contribution model to support darkening, not only brightening (see "Effective light" below).
- Light-producing room fixtures (lit forge in the smithy, fireplace in the cottage, brazier in the hall) — modeled as `room.activeLight[]` entries with `lightSource: { level }`, set by the room def at load time and toggleable later.
- `spell.blindness` / `spell.nightvision` — effects with `perception: "blind" | "nightvision"`, already specced.

## Design

### Light states

Three values, ordered: `dark` < `dim` < `light`. Stored as strings on rooms. No partial states, no per-tile. Constants live in `src/game/light.js` alongside the helpers.

### Effective light

`effectiveLight(room)` is computed on demand. Contributions are **typed** and resolved in two passes so the darkness spell can compose with mundane light without ambiguity:

1. **Base.** Start at `room.lightBase` (default `light`).
2. **Floor pass** — every "raise the level to at least X" contribution applies. Result is `max(lightBase, ...floorLevels)`. v1 floors:
   - `room.activeLight[]` entries with `lightSource: { level }`. Initialized empty at boot; reserved for fixtures + room-cast `spell.light`. v1 reads it but never writes it.
   - Items with `lightSource: { level }` on the floor or carried/equipped by any actor in the room.
   - Active effects with `lightSource: { level }` on any actor in the room. (Candle case: `use candle` applies `effect.candlelight`; the effect contributes `dim` for its duration.)
3. **Ceiling pass** — every "clamp the level down to at most X" contribution applies after the floor pass. Result is `min(floorResult, ...ceilingLevels)`. v1 has no ceilings; v2 `spell.darkness` adds them.

**Worked example — dim room, lantern lit, darkness spell active:**
- Base: `dim`
- Floor pass: lantern raises to `light` → `light`
- Ceiling pass: darkness clamps to `dark` → `dark`

This matches the canonical "magical darkness suppresses mundane light" rule. The fold is deterministic regardless of contribution insertion order: floors are commutative among themselves, ceilings are commutative among themselves, and the floor-then-ceiling ordering is fixed.

In v1, since every contribution is a floor, the result is equivalent to `max(lightBase, ...contributing levels)`. But the helper is written as `(floors, ceilings) -> level` so v2 only adds a new contribution kind, not a new compute path.

**Invariant (lifted from Diku):** a `dark` room with one actor carrying `lightSource: { level: "light" }` renders as `light` to every actor in the room. This is what makes the audit-era `dark` rooms (mine shafts, crypts) traversable for normal-vision players carrying a lantern.

### Per-actor perceived light

`perceivedLight(actor, room)` starts at `effectiveLight(room)` and applies actor-side modifiers:

- An active effect with `perception: "blind"` → clamp to `dark`.
- An active effect with `perception: "nightvision"` → clamp **up** to at least `dim`.

The `perception` field is a new optional key on effect defs. The effects engine does not tick it; `perceivedLight` reads it inline at compute time.

**NPC intrinsic vision (`vision` field) is not read in v1**, but the contract is locked here so v2 plugs in without ambiguity. When the NPC-sight phase lands, `perceivedLight` will additionally consult `actor.def.vision` (NPCs) using this mapping:

| `vision` value | Clamp behavior in `perceivedLight` |
|---|---|
| (absent — normal vision) | no change |
| `low_light` | clamp **up** to at least `dim` *only if* effective light is `dim` (i.e. no malus in dim, still blind in dark) |
| `nightvision` | clamp **up** to at least `dim` always (sees in dark as if dim) |
| `blind` | clamp to `dark` (uses non-visual senses; the perception-aware combat hook will read a separate flag to let blind NPCs still acquire targets) |

This is the *only* place `vision` will be read. Combat and sight predicates downstream consume the resulting `perceivedLight`, not `vision` directly — so adding senses (`scent`, `warmth`) later only requires extending the table.

v1 validators accept `vision` but the engine ignores it. The table above is normative for the next phase, not implemented now.

### Composition seam: `canPerceiveRoom` and `canPerceive`

Two helpers, two different return shapes, both routed through `perceivedLight`:

- **`canPerceiveRoom(actor, room) → level`** — returns the actor's perceived light level for the room. Used by `look.js` (room description variant) and combat narration (per-recipient attacker reveal).
- **`canPerceive(observer, target) → boolean`** — already stubbed by the aggro pass. v2 will compose `perceivedLight(observer, observer.room) + invisibility + hidden-actor checks` here. v1 leaves `canPerceive` as-is; it's listed so the layering is clear.

Call sites in v1 only use `canPerceiveRoom`. `look.js` never open-codes `perceivedLight(...) === "dark"`; combat narration in dark rooms calls `canPerceiveRoom(recipient, room)` and branches on the returned level.

When v2 ships, the changes are scoped:
- `perceivedLight` extends to consult NPC `vision` (the table above).
- `canPerceive` is filled in (light + blindness + invisibility + hidden).
- Combat to-hit reads `perceivedLight(attacker, attacker.room)` to apply a malus (`light` → 0, `dim` → some, `dark` → large/auto-miss).
- NPC behavior `requires` and target acquisition use `canPerceive`.

None of those changes touch v1 call sites.

### Combat to-hit hook (next phase, not v1)

Even though v1 doesn't apply combat penalties, the spec fixes the *shape* so the next phase doesn't relitigate it:

- Combat reads `perceivedLight(attacker, attacker.room)` once per attack resolution.
- The result feeds a `lightToHitModifier(level)` lookup with three buckets (`light` / `dim` / `dark`). Concrete numbers are next-phase work.
- A `blind`-vision NPC bypasses this check via a future `usesNonVisualTargeting` flag derived from `vision`. v1 does not introduce the flag.

This is documented to prevent the next-phase implementer from open-coding light checks inside `executeAttack`. The right hook is "ask `perceivedLight`, apply a modifier" — same shape as DEF subtraction.

### What the level changes (visual-only v1)

`describeRoom` (in `src/game/actions/look.js`) consults `canPerceiveRoom` and emits one of three room-message variants:

- **light** — current full behavior.
- **dim** — `name`, `short`, `exits`, plus actor and item lists with **names only** (no flavor, no NPC disposition annotation). Drop `long`. Prepend `room.dim_hint`.
- **dark** — `name` and a single `room.dark` string. **No exits**, no `long`, no `short`, no `npcs`, no `others`, no `items`, no `gold`. You're lost in the dark — you can't even feel the doorways.

The room message gains a `light: "light"|"dim"|"dark"` field. The client branches on it; no new message kind.

`look <name>` / target inspect is gated the same way:
- target room perceived as `dark` → `look.too_dark`, no inspect payload.
- target room perceived as `dim` → name + subtitle only; drop `long` / `description`.

### Combat narration in the dark

When the looker perceives the room as `dark`, combat narration that would reveal an attacker's identity is replaced with an anonymized form:

- Incoming hit from an attacker the looker can't see → `combat.hit_by_unseen` ("Something strikes you out of the dark!") instead of `combat.target_hit_you`.
- Death of another actor in the room → no broadcast (the looker doesn't perceive it).
- Outgoing attacks by the looker still narrate normally on the looker's side (the looker chose the target by name; we don't pretend they didn't). Other observers in the room render per their own perceived light.

Per-recipient broadcast already supports this — narrative builders consult `canPerceiveRoom(recipient, room)` and pick the variant.

### What stays visible regardless of light

- **Own inventory** — `inventory` command and the player panel. You can feel what you're holding.
- **Own stats** — HP, MP, attack/defense, active effects, position. The stats packet is unaffected.
- **System feedback addressed to the actor** — "you feel weaker", "your candle gutters out", language change confirmations.
- **The `look` command itself does not fail** — it succeeds and renders the dark variant.

### Light sources

Two authoring shapes already in content:

**Item-borne** — any item with this field contributes its level whenever it is on the floor of a room or in any actor's inventory/equipment in that room:

```json
"lightSource": { "level": "light" | "dim" }
```

Example: `item.lantern` (wearable, utility slot, `light`).

**Effect-borne** — any active effect def with the same field contributes when active on any actor in the room:

```json
"lightSource": { "level": "light" | "dim" }
```

Example: `effect.candlelight` (300-tick `dim` buff applied by consuming `item.candle`).

No fuel, no charges, no on/off state in v1. A "lit torch / unlit torch" pair is two item defs if/when content needs them. Item state stays empty.

### Persistence

- `lightBase`, `outdoor`, `lightSource`, `vision`, `perception` — content (committed).
- `room.activeLight[]` — initialized empty at boot; not persisted. Same invariant as floor items.
- `blindness` / `nightvision` / `candlelight` on actors — already covered by `activeEffects` save/load.

### Content authoring (already shipped by the audit)

Room defs:

```json
{ "lightBase": "dark", "outdoor": false }
```

NPC defs:

```json
{ "vision": "nightvision" }
```

Item defs:

```json
{ "lightSource": { "level": "light" } }
```

Effect defs:

```json
{ "lightSource": { "level": "dim" }, "perception": "blind" | "nightvision" }
```

Defaults: `lightBase: "light"`, `outdoor: false`, no `vision`, no `lightSource`, no `perception`. Validators fail loudly on any other value.

**Rooms as authored** — no content rewalk in this PR. The audit-decisions doc flagged eight coin-flip rooms and seven prose-lit indoor rooms for a designer pass once light is visible; that pass is a separate content commit, not part of the engine landing.

### Strings

New keys in `content/strings/{en,cs}.json`:

- `room.dark` — "It is too dark to see anything." / "Je tu příliš tma, nic nevidíš."
- `room.dim_hint` — "It is hard to see clearly." / "Je obtížné dobře vidět."
- `look.too_dark` — "It is too dark to make out who that is." / "Je příliš tma, nepoznáš, kdo to je."
- `combat.hit_by_unseen` — "Something strikes you out of the dark!" / "Něco tě uhodí ze tmy!"

## Files touched

- **new** `src/game/light.js` — `LIGHT_LEVELS` ordering, `effectiveLight`, `perceivedLight`, `canPerceiveRoom`. Fold-based contribution model.
- `src/game/world/load.js` — initialize `room.activeLight = []` at boot.
- `src/persist/validators/room.js` — enforce `lightBase` ∈ {`light`,`dim`,`dark`}, `outdoor` boolean.
- `src/persist/validators/item.js` — enforce optional `lightSource: { level }` shape.
- `src/persist/validators/effect.js` — enforce optional `lightSource: { level }` and `perception` ∈ {`blind`,`nightvision`}.
- `src/persist/validators/npc.js` — enforce optional `vision` ∈ {`low_light`,`nightvision`,`blind`} (accept-only, no engine read in v1).
- `src/game/actions/look.js` — branch `describeRoom` and target-inspect on `canPerceiveRoom`. Build the `dim` / `dark` variants.
- `src/game/combat.js` — per-recipient narration consults `canPerceiveRoom`; emit `combat.hit_by_unseen` to observers in dark.
- `client/client.js` — handle the `light` field on room messages; render dim/dark variants.
- `client/style.css` — optional subtle background tint on the room panel for `dim`/`dark`. Not required for correctness.
- `content/strings/en.json`, `content/strings/cs.json` — four new keys.

## Roadmap delta

- Move "Light system (visual-only v1)" → Done.
- Insert **after** it under "Planned — light & exploration content":
  - **NPC sight & combat in low light** — NPCs read `vision` to gate `canPerceive`; `dark`/`dim` rooms apply to-hit penalties.
- The existing "Light/visibility spells, light sources" entry remains and is where `spell.light`, `spell.darkness`, `spell.blindness`, `spell.nightvision`, and room-fixture authoring land. The darkness spell exercises the fold-based contribution model.

## Out of scope (v2+)

- Day/night cycle.
- NPC sight and combat penalties in dark / dim rooms.
- `spell.light` / `spell.darkness` content + the darkening contribution. (Engine seam present, content not authored.)
- Light source fuel / duration on items (charges, burning out). Effect-borne sources already give us bounded duration.
- On/off lit state for items. Lit/unlit pairs are separate item defs.
- Per-direction visibility (`look north` peeking into the next room).
- Sense-mode list-typing for NPC `vision` (single string is enough for v1).

## Risks

- **Inspect-panel drift.** The `target-info` and `room` payloads have many optional fields; the dim/dark variants must omit the right subset without breaking the client. Mitigation: the client already treats missing fields as "not shown" (matches how `disposition === 'neutral'` is optional).
- **Czech grammar in dark messages.** The four new strings are complete sentences with no `{target}` slot, so they should read cleanly. Confirm with a native pass before merge.
- **Effect-borne light source while logged out.** A player with `effect.candlelight` active logs out. The effect is persisted; on reconnect it resumes. Between logout and reconnect the effect contributes nothing (the actor is not in the room). This matches the floor-item-only-when-in-room semantics; no special case needed.
- **Combat narration regression.** Today combat narration is unconditional. Routing it through `canPerceiveRoom` per recipient adds branches in the broadcast builder; risk of subtle wording bugs. Mitigation: cover with a small narration test (a dark-room observer sees `hit_by_unseen`, a lit-room observer sees the named attacker, the attacker themselves see normal text).
