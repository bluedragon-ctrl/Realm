# Perception — design

Active perception for static hidden content. Adds a derived `perception` stat, an authored `hidden` block on room exits and fixtures, a `search` command, and per-character `foundSecrets` persistence. Ships with item + spell perception bonuses and a small set of test content that reworks two existing lock-keyed exits into perception-gated ones.

Sits alongside the pre-light content audit. Light gating and NPC-vs-player perception (sneak, invis) are explicitly out of scope; the existing `canPerceive(observer, target)` stub stays unchanged so the future light engine has a single junction to extend.

## Scope

In scope:

- A derived `perception` stat on every actor, computed from `int + floor(level/2) + equipped wearable.bonus.perception + active effect statMod.perception`.
- Hidden room exits and hidden room-level fixture placements. Authored inline in existing room JSON.
- `search` command (English verb), no argument, operating on the current room.
- `foundSecrets: string[]` on the character record, persisted via `writeJsonAtomic`.
- Per-recipient room rendering: hidden exits/fixtures filter out of the room view for players whose `foundSecrets` does not include the secret id.
- New wearable `item.amulet_keen_senses` with `bonus.perception: 2`.
- New `spell.keen_senses` (self-target, statMod `perception: 4`, ~30 ticks, ~3 MP), admin-granted on login for testing.
- Quickbar **Search** button (same UX class as Flee).
- Stats panel row showing the computed `perception`.

Out of scope:

- Light system, dark-room gating, vision modes — `canPerceive` body unchanged.
- NPC perception against players (sneak, invis, ambush).
- Hidden floor items as item placements (use a hidden fixture as the container instead).
- Active `search <target>` form, `look` on unfound secrets, passive "you notice in passing" on room entry.
- Migration tools or admin commands to clear `foundSecrets`.

## Mechanics

### Derived perception

Computed inside `recomputeStats` in `src/game/wearables.js`. Order of operations:

```
perception = int + floor(level/2)
perception += Σ(equipped wearable.bonus.perception)
perception += Σ(active effect statMod.perception)
```

Reads level via `actor.record?.level ?? 1`. Recompute is already called on level-up, equip/unequip, and effect apply/remove, so no new triggers are needed. The result lives at `actor.stats.perception` and is exposed in the stats packet sent by `sendStats`.

`ALLOWED_BONUS_KEYS` in `src/game/contentMeta.js` gains `"perception"` so the wearable validator accepts the field.

### Check

Deterministic. For each hidden thing with DC `d`, an actor finds it iff `actor.stats.perception >= d`. No dice. Re-running `search` with the same stats yields the same result; the only way to find a too-hard secret is to raise perception (level, gear, spell).

DC scale guidance for content authors:

| DC | Tier | Reachable by |
|---|---|---|
| 2–4 | trivial | any new player (int 1, level 1 → perception 1) — almost always found |
| 5–7 | easy | mid-INT player ~ level 2–4 |
| 8–11 | medium | mid–high INT or low-INT with a +2 amulet |
| 12–15 | hard | high INT + level 6+ or buff spell |
| 16+ | very hard | requires the keen-senses spell stacked with gear |

### Light gating

Stub only. `canPerceive(observer, target)` in `src/game/perception.js` keeps returning `true`. The comment is updated to note that the light engine will short-circuit on dark rooms; no other code change in this PR.

## Content shape

### Hidden exit

Authoring shape: exit value is an object form when hidden; bare-string form continues to work for visible exits.

**Runtime shape (post-load):** the room loader normalizes object-form exits into two parallel maps so runtime code that reads `room.exits[key] -> targetId` (notably `move.js`, `validateRoomGraph`, `isExitLocked`) continues to work unchanged:

- `room.exits[key] = targetId` (string, as today).
- `room.hiddenExits[key] = { dc, id }` (new optional map; absent on visible exits).

Renderer and `search` consult `room.hiddenExits`; movement consults `room.hiddenExits[exitKey]` together with `actor.record.foundSecrets` to decide whether the exit is treated as nonexistent.

```json
"exits": {
  "n": "forest.path",
  "d": { "to": "forest.secret_pool", "hidden": { "dc": 8, "id": "forest.pool_passage" } }
}
```

- `to` — required when the exit is an object.
- `hidden.dc` — integer, required.
- `hidden.id` — string, required. Exits have no natural id; authors choose one. Must be unique among hidden ids in the room.

Validator: fail at boot if an object-form exit is missing `to`, or if a `hidden` block is missing `dc` or `id`, or if two hidden ids collide within one room.

Movement attempt through a hidden-and-unfound exit returns the existing no-exit-that-way message — it does not leak existence.

### Hidden fixture

In this codebase, fixtures are items with `tags: ["fixture"]` placed by the item def's own `spawn.location` (see `content/items/fixtures/*.json`). The hidden flag is declared on the **room** that hosts the fixture, not on the item def — so the same fixture def can be hidden in one room and visible in another.

New optional room block, keyed by item def id:

```json
"hiddenFixtures": {
  "forest.loose_stone": { "dc": 10, "id": "forest.tower_cellar_alcove" }
}
```

- Key — item def id of the fixture.
- Value `dc` — integer, required.
- Value `id` — string, optional. Defaults to the item def id (the key) when omitted. A room may override the id if it cares to disambiguate; v1 content does not need this.

At describe-room time the renderer filters every item instance in the room: if `inst.defId` is a key in `room.hiddenFixtures` and the recipient's `foundSecrets` does not include the resolved secret id, the instance is omitted from the room view. Effectively all instances of that def are hidden together by the same gate, which suits v1 (one fixture per gate).

### Renderer filter

Per-recipient. In `describeRoomToAll` and any `look <room>` path:

- Exit lists filter out exits whose `room.hiddenExits[key].id` is not in the recipient's `foundSecrets`.
- Room item lists filter out item instances whose `defId` is a key in `room.hiddenFixtures` and whose resolved secret id is not in `foundSecrets`.

Uses the existing per-recipient broadcast-builder pattern. Two players standing in the same room may see different exit/fixture lists.

### Validator additions

- `ALLOWED_BONUS_KEYS` gains `perception`.
- Room validator accepts object-form exits with `to` and optional `hidden { dc, id }`.
- Room validator accepts top-level `hiddenFixtures` map: keys are item def ids, values are `{ dc, id? }`.
- Room loader rejects duplicate secret ids across `hiddenExits` + `hiddenFixtures` within a single room.

No new content tree. Hidden flags sit inline in existing room files, same pattern as `outdoor`/`lightBase` from the pre-light audit.

## Command, persistence, UI

### `search` command

- File: `src/game/actions/search.js`, registered in `src/game/commands.js`. English verb only.
- No argument; operates on the current room.
- Energy cost: `interact` tier (6) in `DEFAULT_COSTS`.
- Logic:
  1. Collect every hidden exit and hidden fixture placement in the player's current room.
  2. Filter to those whose `hidden.id` is not in `player.record.foundSecrets`.
  3. For each remaining candidate where `player.stats.perception >= hidden.dc`, push `hidden.id` into `foundSecrets`. Mark player dirty.
  4. If any new ids were added: send the player a reveal line per secret, then call `describeRoomToAll(roomId)` so views refresh.
  5. If nothing new was added (nothing exists, nothing reachable, or already found everything): send `s('search.nothing', lang)`.
- Others in the room always see `s('search.others', lang, { actor })` regardless of outcome.

### Persistence

- `data/players/<name>.json` gains `foundSecrets: string[]`. Default `[]`.
- Loader normalizes missing or malformed values to `[]`.
- Written through `writeJsonAtomic`. Permanent per character, no expiry.

### UI

- New quickbar **Search** button. Single fixed action, no popover, default position next to Flee. Sends `search` to the server when clicked.
- Stats panel gains a `perception` row alongside the existing computed stats. Reuses the existing stats-refresh path; no new client plumbing beyond rendering the row.

### Server strings

Added to `content/strings/<lang>.json`:

- `search.nothing` — "You search but notice nothing new." / "Pečlivě prohledáš okolí, ale nic nového si nevšimneš."
- `search.others` — "{actor} searches the room." / "{actor} prohledává místnost."
- `search.found_fixture` — "You notice {target}." / "Všimneš si {target}."
- `search.found_exit` — "You notice a way {direction}." / "Všimneš si cesty {direction}."

Fixture reveal text uses the fixture's localized name via `t`/`tListAt`. Exit reveal text uses `dirName(exitKey, lang)` for the direction token.

## v1 test content

Three room edits plus one item and one spell.

1. **`village.square` — well passage.** Drop `lockedExits.d` from the room and remove the rope-key wiring from `village.well`. Convert `exits.d` to `{ "to": "village.well_bottom", "hidden": { "dc": 5, "id": "village.well_passage" } }`. DC 5 (easy). Exercises easy-tier finding with default new-player stats.
2. **`home.shack` — trap door.** Drop `lockedExits.d` and remove the trap-door-key wiring from `home.trap_door`. Convert `exits.d` to `{ "to": "home.basement", "hidden": { "dc": 3, "id": "home.trap_door_perception" } }`. DC 3 (trivial).
3. **`forest.fox_glade` — fox den.** New room `content/rooms/forest/forest.fox_den.json` (cosy den, no fixtures, exit `u` back to `forest.fox_glade`). Add `exits.d` on `forest.fox_glade` = `{ "to": "forest.fox_den", "hidden": { "dc": 4, "id": "forest.fox_den_entrance" } }`. Update `content/npcs/forest/forest.fox_pup.json`: `location` and `pack` change from `forest.fox_glade` → `forest.fox_den`. DC 4 (trivial).
4. **`item.amulet_keen_senses`** — new wearable, slot `amulet`, `wearable.bonus = { perception: 2 }`. Spawn block places one instance in `forest.tower_cellar` (visible floor item) so the fox den isn't double-loaded.
5. **`forest.tower_cellar` — hidden alcove.** Add a hidden fixture placement: a decorative "loose stone in the wall" fixture (new fixture def `forest.loose_stone`, look-only, no inventory). Hidden block `{ "dc": 10, "id": "forest.tower_cellar_alcove" }`. DC 10 (medium). Provides the medium-tier test target so the amulet's +2 and the keen-senses spell's +4 have something concrete to unlock.
6. **`spell.keen_senses`** — new self-target spell. Applies `effect.keen_senses` (new effect def), `statMod: { perception: 4 }`, `duration` ~30 ticks, MP cost ~3. Added to `ADMIN_GRANTED_SPELLS` in `src/game/actors.js`.

Rope item and trap-door key stay in content (decorative / earmarked for upcoming content).

## Testing

Unit:

- `recomputeStats` derives `perception` correctly across a matrix of `(int, level, equipped bonus, active effect)` inputs.
- `search` outcome matrix: nothing hidden in room; one hidden below DC; one hidden at DC; one hidden above DC; one already in `foundSecrets`; mixed (one found + one too hard).
- Room renderer filters hidden exits and fixtures by `foundSecrets`; two recipients with different `foundSecrets` get different filtered views from one `describeRoomToAll` call.
- Movement through a hidden-and-unfound exit returns the no-exit-that-way message.
- Validator rejects: object-form exit missing `to`; `hidden` block missing `dc` or `id`; duplicate hidden ids within one room; unknown bonus key (regression check on `ALLOWED_BONUS_KEYS`).

Integration:

- Boot → connect → search `forest.fox_glade` → relog → confirm `forest.fox_den_entrance` still revealed and the room view still shows the `d` exit.
- At new-player perception (int 1, level 1 → perception 1), search `forest.tower_cellar`; loose-stone alcove (DC 10) is not found; amulet is on the floor and takeable.
- Equip amulet (perception now 3) and re-search; still below DC 10, alcove not found.
- Cast `spell.keen_senses` (perception now 7); still below DC 10, alcove not found. (Confirms the +4 spell alone is not enough; a mid-level player is needed.)
- Force-level the test character to level 6 (int 1, level 6 → perception 4; +amulet 6; +spell 10), re-search; alcove reveals. Let the effect expire; alcove stays visible (entry in `foundSecrets`).

Manual smoke:

- Quickbar Search button fires the command.
- Stats panel shows the `perception` row and updates on equip/unequip and effect apply/expire.

## File touch list (orientation, not the final plan)

New:

- `src/game/actions/search.js`
- `content/rooms/forest/forest.fox_den.json`
- `content/items/item.amulet_keen_senses.json`
- `content/spells/spell.keen_senses.json`
- `content/effects/effect.keen_senses.json`
- `content/items/forest.loose_stone.json` (decorative fixture def)

Modified:

- `src/game/commands.js` — register `search`.
- `src/game/wearables.js` — perception derivation inside `recomputeStats`.
- `src/game/contentMeta.js` — `ALLOWED_BONUS_KEYS += "perception"`.
- `src/game/actors.js` — `foundSecrets` normalization on load; admin-grant `spell.keen_senses`.
- `src/game/perception.js` — comment update only.
- Room loader / validator — object-form exits, `hidden` block, id uniqueness.
- Room renderer / `describeRoomToAll` — per-recipient filter on hidden exits and fixtures.
- Movement handler — treat hidden-and-unfound exits as nonexistent.
- `content/rooms/village/village.square.json`, `content/rooms/home/home.shack.json`, `content/rooms/forest/forest.fox_glade.json` — exit rewrites and lock removal.
- `content/rooms/forest/forest.tower_cellar.json` — hidden fixture placement for the loose-stone alcove and floor placement for the amulet.
- `content/items/village.well.json`, `content/items/home.trap_door.json` (or wherever the rope/trap-door key wiring lives) — drop the lock-key references.
- `content/npcs/forest/forest.fox_pup.json` — relocate to `forest.fox_den`.
- `content/strings/en.json`, `content/strings/cs.json` — new `search.*` keys.
- Client right panel — `perception` stat row.
- Client quickbar — Search button.

## Open follow-ups (post-v1, not in this PR)

- Light engine plugs into `canPerceive`; dark rooms gate NPC sight and (later) player sight.
- Passive "noticed in passing" roll on room entry for very high perception margins.
- Active `search <target>` form; `look <unfound>` semantics.
- Hidden actors (sneak/invis/ambush) via opposed `canPerceive`.
- Migration / admin tool for clearing `foundSecrets`.
