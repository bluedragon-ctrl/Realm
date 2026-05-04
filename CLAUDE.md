# Notes for AI sessions

Read this before doing anything.

## Working rule

Discuss the plan and propose options **before** writing code for any change that touches multiple layers (content + persistence + commands + UI). Quick fixes and obvious follow-ups can be direct.

## Decisions already made (don't relitigate without reason)

- **Stack:** Node.js 20+, plain ES modules, no TypeScript, no build step. Single runtime dep: `ws`.
- **Persistence:** JSON files. SQLite is the migration target, deferred until performance pain (cross-player queries, transactions, event log).
- **Content vs. data:** content lives in `content/` and is committed to git; per-character data lives in `data/players/` and is gitignored. Floor items reset on boot; player inventories persist.
- **Localization:** English + Czech. Per-character `lang` (default `en`). Content text is `string | {en, cs}`. System messages in `content/strings/<lang>.json`. Login screen is English only.
- **Commands stay English.** Display text translates; verbs do not.
- **Czech grammar:** templates use nominative `{target}`. Reads stiff sometimes; acceptable. NPCs/items can declare optional `nameAcc` for accusative when they appear as direct objects.
- **Item model:** instances `{defId, instanceId, def, state}`. `state` empty today, used later for durability/charges.
- **Item spawn cap:** every item def with a `spawn` block has a `count` (default 1) — total instances anywhere (rooms + actor inventories online and offline). Boot top-up scans `data/players/*.json`. Optional `respawnTicks` runs a periodic top-up using in-memory counts only.
- **Effects:** state-changing operations (heal, damage, light, ...) live in `src/game/effects.js` and are referenced from item `use.effect` and spell `effect`. Effect type registry is the single place to add new state changes. Heal exists; others are placeholders.
- **Spells:** content in `content/spells/<id>.json`. Same verb-shape as socials/use. Players have `knownSpells: [id, ...]` — auto-seed with `spell.heal` + `spell.spark` for new players (spark is a temporary test spell; remove from auto-seed once teaching is in place). `cast` deducts MP, broadcasts via `runVerb`, then applies `spell.effect`.
- **Spell `target` metadata:** each spell declares `target: "self" | "friendly" | "hostile" | "any"` (default `"any"` for back-compat). `cast.js` validates server-side; client uses it to drive chip-click behavior (see "Combat UX" below).
- **Damage spells:** `effect: { type: "damage", formula: "1d4" }` (dice formula evaluated at cast time via `roll()`). Damage spells route through `applyDamageWithFeedback` so they share aggro/death/feedback with melee. Spells ignore DEF; damage is the rolled amount, clamped to ≥1.
- **Combat:** `executeAttack` in `src/game/combat.js` rolls damage, subtracts target DEF, clamps to ≥1, broadcasts the attack emote, and calls `applyDamageWithFeedback`. `applyDamageWithFeedback(actor, target, amount)` is the shared post-damage path (apply damage effect, hit feedback, aggro update, sendStats, death) — used by both `executeAttack` and damage spells in `cast.js`. Damage formula uses dice notation (see `src/game/dice.js`). NPC `attack` behaviors need `requires: "aggro_target"` to avoid attacking with no target. Aggro lives on NPC as a `Set` of attackers; a player leaving the room is removed from each NPC's set, and an NPC reverts to its def disposition only when its set empties. Death clears the dead actor from all aggro sets.
- **Combat UX (client):** hostile NPC chips fire `attack <name>` directly on click — no popover. Friendly/neutral NPC chips open the popover (`Look` + socials; `Attack` button removed since hostile path is direct and we don't want to attack friendlies via UI). To inspect a hostile, type `look <name>`. Spell chips drive their own targeting per `target` metadata: `self` → cast immediately; `hostile` → if 1 hostile in room fire immediately, if multiple show a mini-popover of hostile chips, if 0 send the cast and let server return `cast.needs_hostile`; `friendly`/`any` → popover with `Yourself` + room targets (hostiles excluded for `friendly`).
- **Flee:** `flee` / `f` command (and quickbar button with `.danger` class) picks a random exit and routes through the shared `move` handler. If no exits exist (shouldn't happen on the map), returns `flee.no_exits`.
- **Behavior `requires`** accepts string (`"was_attacked"`, `"aggro_target"`) or object (`{ type: "low_hp", ratio: 0.25 }`). Add new conditions in `checkRequires` in `src/game/tick.js`.
- **Multi-instance NPCs:** `count: N` on the def. Each instance is independent (HP, aggro, respawn). Spawn cap not yet enforced post-boot; respawn queue is per-kill.
- **Speed model:** energy/cost (NetHack). `ticks per action = behavior.cost / actor.spd`. Tick is 1000 ms. Default cost 12, default spd 6 → 1 action per 2 ticks (~0.5/s). We did not switch to per-behavior cooldown sugar; the energy model is more flexible for varied attacks within an actor. Player commands are immediate (don't go through the scheduler).
- **Authorization:** LAN only, no passwords, admin name list in `data/admins.json`.

## Conventions

- **Naming (content IDs and filenames):**
  - Rooms: `<region>.<name>` (e.g. `home.cottage`, `forest.meadow`).
  - NPCs: `<region>.<name>` — region is where the NPC lives (e.g. `home.rat`, not `basement.rat`).
  - Items: either `<region>.<name>` (zone-tied, e.g. `forest.iron_sword`) or `<category>.<name>` for generics where `category` is `item` or `potion` (e.g. `potion.heal`, `item.small_rusty_key`, `item.amulet_regen`).
  - Effects, spells: `effect.<name>` and `spell.<name>` (e.g. `effect.poison`, `spell.heal`).
  - Filename always equals the id plus `.json`. Lowercase, snake_case, ASCII.
- **Atomic JSON writes:** always go through `writeJsonAtomic` (tmp file + rename). Never `fs.writeFile` directly to a state file.
- **Localized text accessors:** `t(value, lang)` for single strings, `tListAt(value, lang, idx)` for parallel arrays, `s(key, lang, params)` for system strings, `dirName(exitKey, lang)` for directions.
- **Per-recipient broadcast:** `broadcastToRoom(roomId, msgOrBuilder, except)`. If you need per-recipient localization, pass a builder function that takes the recipient.
- **Verb-shaped def:** `{ <lang>: { to_target?: {self, others}, no_target?: {self, others}, missing? } }`. Run via `runVerb` in `src/game/verbs.js`. Used by socials and `item.use`.
- **No comments** unless explaining non-obvious intent. The code is small enough to read.
- **Errors fail loudly at boot** (unknown room, unknown primitive, broken exits, filename ≠ id). Don't silently default.

## Patterns to reuse

- **Adding a verb-shaped action** (social, item.use): write the verb-shaped def, call `runVerb`. Don't write a new broadcast loop.
- **Adding an NPC behavior:** add a primitive in `src/game/primitives.js`, add it to `KNOWN_PRIMITIVES` in `contentLoader.js`, validate any required fields. Behaviors are picked first-match-rolls per turn; insufficient-energy or failed-roll behaviors are skipped.
- **Adding a command:** action file in `src/game/actions/`, register in `src/game/commands.js`. Localize all user-visible strings via `s(...)`.
- **Adding chip-anchored UI:** the popover system handles single-action and submenu (`Use ▶` / `Give ▶`) patterns. Don't introduce another modal style.
- **Refreshing client state after server-side changes:**
  - Stat/inventory/lang change for one player → `sendStats(actor)`.
  - Room composition change (items, actors entering/leaving) → `describeRoomToAll(roomId)`.
  - Targeted event broadcast → `broadcastToRoom(roomId, builder)`.

## Don't

- Don't introduce a build step (no Vite/Webpack/Rollup, no TypeScript).
- Don't add a web framework (no React/Vue/Svelte/Express). Plain DOM + raw `http`/`ws` is the design.
- Don't add a database before the combat phase. If you think you need one, propose it explicitly.
- Don't break "commands stay English."
- Don't write room descriptions or NPC text into the console; they belong in the inspect panel. The console is an event log.
- Don't add a separate per-language content tree (e.g. `content/rooms/cs/...`). Inline `{en, cs}` is the chosen pattern.
- Don't translate player-typed `say`/`emote` text. Only template/wrapper text is localized.

## Roadmap

See README.md "Roadmap" section. Current focus: stabilisation, testing, and basic gameplay content (more rooms, NPCs, items). Combat, items, magic, and persistence MVPs are landed; the next big-bet engine work is loot tables / quests / SQLite, deferred until the content phase reveals real pain.
