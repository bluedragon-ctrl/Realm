# Realm

A small fantasy MUD for LAN play. Single-process Node.js server, browser client, JSON-driven world. Bilingual (English + Czech) per character.

## Current state

- Web client served from the same port as the WebSocket (default 8080)
- Login by character name (case-insensitive, original casing preserved)
- Walk between 5 starter rooms (`home.yard` and the surrounding cottage, herb shack, garden and field crossroads)
- Persistent player position, language, stats, inventory (atomic JSON writes; saved on logout and every ~30s)
- Per-character language (`en` / `cs`); content text is `{en, cs}`; system messages in `content/strings/<lang>.json`; broadcasts render per-recipient
- World tick (1000ms) with NetHack-style energy/speed scheduler — drives ambient NPCs
- Stat block on every actor (`hp/hpMax, mp/mpMax, attack, defense, int, spd`) — only `spd` is wired so far
- One ambient NPC (a scruffy dog in the yard) demonstrating the data-driven primitives
- Social verbs (`hug`, `pet`, `pat`, `wave`, `scratch`, `smile`, `bow`) loaded from `content/socials.json`
- Items with inventory: `take` / `drop` / `give` / `use [on <target>]` / `inventory`. Example items (leather ball, healing potion)
- Spells with known-spell list and per-spell `target` metadata (`self` / `friendly` / `hostile` / `any`): `cast <spell> [on <target>]`, MP cost, data-driven. Two examples: `spell.heal` (friendly, restores HP) and `spell.spark` (hostile, `1d4` damage)
- Effect system (`heal`, `damage`) shared between item `use`, spell `effect`, and combat. Damage spells route through the same post-damage path as melee (`applyDamageWithFeedback`)
- Combat MVP: `attack <target>`, dice-formula damage (`1d3+ATK` etc.), aggro that resets on leaving the room, NPC respawn after death, player respawn at home with half HP. `flee` / `f` picks a random exit
- NPC primitives: `say`, `emote` (ambient), `interact` (NPC → player emote), `give_item` (NPC → player item transfer), `attack`, `flee`, `wait`, `move`, `cast`
- Four-region client UI: top bar, console (event log), player panel (stats + HP/MP bars + inventory + spellbook), inspect panel (current room or last-looked target), input + quick bar (with a red `Flee` button)
- Click-to-interact: chips in the inspect panel open context-appropriate actions. Hostile NPC chips fire `attack` directly. Friendly/neutral NPC chips open a popover (`Look` + socials). Item chips open `Look` + `Pick up`/`Use ▶`/`Drop`/`Give ▶`. Spell chips in the spellbook target smartly per the spell's `target` field (self → cast immediately; hostile → autotarget the lone hostile or pick from a mini-popover; friendly/any → popover with `Yourself` + room targets)
- Admin: `@create-player <name> [lang]`, `@reload`, `@who`

Combat, items beyond toys, magic, and quests are not implemented.

## Run

Requires Node.js 20+.

```
npm install
npm start
```

or double-click `start.bat`. Open `http://localhost:8080`. On first boot the server bootstraps an `Admin` character (configured in `data/admins.json`) — log in as `Admin` and `@create-player <name> [cs|en]` to add characters for your family. They connect from any LAN PC at `http://<server-ip>:8080`.

`PORT=9000 npm start` to override the port.

For LAN access on Windows: set the network profile to **Private** and add a firewall rule allowing inbound TCP 8080 from `LocalSubnet`.

## Layout

```
server.js                  entry: load strings, world, ws server, tick
src/
  i18n.js                  t / s / pickListIndex / tListAt / dirName
  net/wsServer.js          http static + ws upgrade, login, dispatch
  game/
    world.js               barrel — re-exports from world/ submodules
    world/state.js         the world object, START_ROOM, getRoom, isAdmin
    world/exits.js         per-room exit lock state
    world/actors.js        actor placement, lookup, per-room broadcast
    world/items.js         floor items + spawn cap + respawn top-up
    world/npcs.js          NPC spawn / despawn / respawn queue
    world/load.js          loadWorld() boot orchestration
    actors.js              makePlayerActor / makeNpcActor (stats + inventory normalize)
    items.js               item instance factory, find/remove helpers
    stats.js               default stat blocks, default action costs
    tick.js                600ms loop, NPC energy/turn scheduler, periodic flush
    primitives.js          NPC behavior primitives (say, emote, interact, give_item, ...)
    verbs.js               shared per-recipient verb broadcast (socials + item.use)
    targeting.js           SELF_TOKENS, isSelfToken, resolveActorTarget
    messages.js            barrel — re-exports from messages/ submodules
    messages/stats.js      buildStatsMsg, sendStats (top-level composer)
    messages/inventory.js  buildInventory (player panel)
    messages/equipment.js  buildEquipment (slots + known wearables)
    messages/spells.js     buildKnownSpells (spellbook)
    messages/socials.js    buildSocialButtons (cached per language)
    messages/labels.js     buildPanelLabels (all static UI strings)
    spellMeta.js           SPELL_TARGETS  (leaf, no imports)
    effectMeta.js          EFFECT_KINDS / EFFECT_STACKS / TICK_EFFECT_TYPES
    npcMeta.js             DISPOSITIONS / PRIMITIVE_NAMES
    wearableMeta.js        WEARABLE_SLOTS / ALLOWED_BONUS_KEYS
    commands.js            command dispatch table; falls through to socials map
    actions/               look, move, say, emote, who, help, quit, lang, take, drop, give, use, inventory, social, cast, attack, flee
    combat.js              executeAttack + applyDamageWithFeedback (shared post-damage path)
    dice.js                dice formula evaluator (roll())
    effects.js             effect registry (heal, damage)
    dispatch.js            verb/argument parsing for runCommand
  persist/
    jsonStore.js           atomic read/write (tmp + rename), recursive listJsonFiles
    players.js             one file per character, lower-cased filename
    contentLoader.js       loadRooms / loadNpcs / loadItems / loadSocials / loadStrings / loadAdmins (uses validate.js + loadDir helper)
    validate.js            check / checkEnum / checkLocalizedText / ... validation primitives
  admin/
    adminCommands.js       @create-player, @reload, @who
client/                    static html/css/js (no build step)
content/
  rooms/<region>/<id>.json one file per room, region-nested (home, forest, mine)
  npcs/<region>/<id>.json  one file per NPC def, region-nested
  items/<category>/<id>.json one file per item def, category-nested (forest, home, mine, _generic, consumables, fixtures, wearables)
  socials.json             all social verbs in one file
  spells/<id>.json         one file per spell
  effects/<id>.json        one file per active-effect def
  strings/<lang>.json      system messages
  lore/                    placeholder
data/
  admins.json              ["Admin"]
  players/<lower>.json     per-character state (gitignored)
```

## Localization

Each player has `lang` (`en` or `cs`). Content text is either a plain string or `{ "en": "...", "cs": "..." }`. Lookup falls back to English if a language is missing.

NPCs and items optionally declare `nameAcc` (accusative form, mainly for Czech) used when the name appears as a direct object in templates ("Karel objímá **ošuntělého psa**"). Player names are not declined — Czech reads slightly stiff in some templates; acceptable for now.

Broadcasts to a room are rendered **per recipient**. The engine picks one event (e.g. a behavior line index, a social verb form), then for each player in the room renders that event in their language and sends it. See `runVerb` in `src/game/verbs.js` and `broadcastToRoom` in `src/game/world.js`.

System messages live in `content/strings/<lang>.json` and are looked up by key with `{placeholder}` interpolation. Login-screen messages are English only (player not yet identified).

Movement commands stay English (`n`, `north`, `go cave`); display of directional exits is translated.

## Authoring content

### Add a room

Drop a file under `content/rooms/`:

```json
{
  "id": "village.bakery",
  "name": { "en": "The Sunwheel Bakery", "cs": "Pekařství U Slunečního kola" },
  "short": { "en": "...", "cs": "..." },
  "long":  { "en": "...", "cs": "..." },
  "exits": { "out": "village.square" }
}
```

Add a return exit on the connecting room. `@reload` in-game, no restart. The loader fails loudly if any exit points to an unknown room.

### Add an NPC

Drop a file under `content/npcs/`:

```json
{
  "id": "village.baker",
  "name":    { "en": "the baker", "cs": "pekařka" },
  "nameAcc": { "en": "the baker", "cs": "pekařku" },
  "title":   { "en": "baker",     "cs": "pekařka" },
  "location": "village.bakery",
  "short": { "en": "...", "cs": "..." },
  "long":  { "en": "...", "cs": "..." },
  "disposition": "friendly",
  "stats":   { "hp": 10, "hpMax": 10, "mp": 0, "mpMax": 0, "attack": 1, "defense": 1, "int": 1, "spd": 12 },
  "inventory": [],
  "behaviors": [
    {
      "primitive": "emote",
      "chance": 0.04, "cost": 6,
      "lines": {
        "en": ["dusts flour from her apron.", "checks the oven and nods."],
        "cs": ["sprašuje mouku ze zástěry.", "zkontroluje pec a přikývne."]
      }
    }
  ]
}
```

Available primitives: `say`, `emote`, `wait`, `interact` (uses `templates` with `{target}`), `give_item` (uses `templates` with `{item}` and `{target}`), `attack` (combat), `flee` (move on damage), `move` (wander), `cast` (NPC spellcasting). See the realm-content skill for the full table.

### Add an item

Drop a file under `content/items/`:

```json
{
  "id": "village.lantern",
  "name":    { "en": "a brass lantern", "cs": "mosazná lucerna" },
  "nameAcc": { "en": "the lantern",     "cs": "mosaznou lucernu" },
  "short": { "en": "...", "cs": "..." },
  "long":  { "en": "...", "cs": "..." },
  "tags": ["light"],
  "weight": 2,
  "spawn": { "location": "village.square", "count": 1, "respawnTicks": 0 },
  "use": {
    "en": {
      "no_target": { "self": "you light the lantern.", "others": "{actor} lights a brass lantern." }
    },
    "cs": {
      "no_target": { "self": "rozsvítíš lucernu.",     "others": "{actor} rozsvěcuje mosaznou lucernu." }
    }
  }
}
```

`use` follows the same shape as a social verb: keyed by language first, then by form (`no_target` and/or `to_target`), each with `self` and `others`. `{target}` substituted when a target is given.

The `spawn` block (optional) tells the engine to place item instances in the world:

- `location`: room id where instances appear.
- `count`: maximum number of instances anywhere in the world (default `1`). "Anywhere" includes rooms, NPC inventories, and player inventories — including offline players' saves on disk.
- `respawnTicks`: if `> 0`, every N ticks the engine tops up to `count` (counting in-memory only — eventual consistency for offline-held items). `0` = boot-only spawn (default).

If a def has no `spawn` block, the engine never auto-spawns it; it can still appear via NPC `inventory` declarations or admin tools.

### Combat: damage formulas, aggro, respawn

NPC behaviors of primitive `attack` carry a `damage` field — a dice formula:

```
"damage": "1d4+ATK"
```

Supported tokens: integer literals, `XdY` rolls, `+`/`-` chains, and stat variables `ATK`/`DEF`/`INT`/`HP`/`MP` (resolved against the *attacker's* stats). Whitespace ignored.

The engine subtracts the target's `defense` from the rolled value, clamps to `min 1`, and applies as the `damage` effect via `applyDamageWithFeedback` (which also handles aggro, hit feedback, and death). So write the formula as raw output; the system handles soak. Damage spells (`spell.effect.type === "damage"`) call the same `applyDamageWithFeedback` after `runVerb`, so combat and magic share the post-damage path; spells skip the DEF subtraction step.

`attack` behaviors should declare `requires: "aggro_target"` so the scheduler skips the attack when no aggroed target is present (the bee falls through to ambient buzzing).

**Behavior preconditions** (`requires`) accept a string or an object with parameters:
- `"requires": "aggro_target"` — at least one aggroed target is in the same room.
- `"requires": "was_attacked"` — the NPC has taken damage; flag clears when a behavior consuming it fires.
- `"requires": { "type": "low_hp", "ratio": 0.25 }` — current HP ≤ 25% of max. `ratio` defaults to 0.5 if omitted. Useful for "fight until wounded, then flee" enemies.

**Aggro** lives on the NPC as a `Set` of attackers. Player attacks add the player to the aggro set and flip the NPC to `disposition: "hostile"`. When the player leaves the room, the engine clears them from that NPC's aggro; if the set empties, the NPC's disposition reverts to its def. Death also clears the dead actor from all aggro sets.

**Respawn** is per-NPC via a `respawn` block:

```
"respawn": { "ticks": 500 }
```

When the NPC dies, the engine schedules its def to spawn again at its declared `location` after `ticks` ticks. Default 0 = no respawn (admin can `@reload`).

**Players default attack** is `1d3+ATK` (defined in `src/game/stats.js`). When equipment lands, weapons override.

**Death** for players: respawn at `home.yard` with `ceil(hpMax/2)` HP, MP unchanged, inventory kept, all aggro lists cleared.

### Add a spell

Drop a file under `content/spells/`:

```json
{
  "id": "spell.spark",
  "name": { "en": "Spark", "cs": "Jiskra" },
  "mpCost": 3,
  "target": "hostile",
  "verb": {
    "en": {
      "to_target": { "self": "you raise a finger and a bright spark leaps toward {target}.", "others": "{actor} raises a finger and a bright spark leaps toward {target}." }
    },
    "cs": { ... }
  },
  "effect": { "type": "damage", "formula": "1d4" }
}
```

`verb` follows the same lang-first → form shape as socials and item `use`. `effect` is optional; if present, it's applied after the broadcast.

`target` (optional, default `"any"`) is one of:

- `"self"` — only self-cast (chip-click casts immediately, no popover).
- `"friendly"` — caster or non-hostile actor (excludes hostile NPCs).
- `"hostile"` — must target a hostile NPC. Chip-click autotargets the lone hostile in the room, opens a mini-picker if there are several, or returns an error if none.
- `"any"` — current popover (`Yourself` + everyone in the room).

`effect` types implemented: `heal` (`{ amount }` or `{ hp, mp }`) and `damage` (`{ formula }` — dice notation, rolled at cast time; falls back to `amount` literal). Damage spells share the combat post-damage path: aggro is set on the NPC, death is handled, and hit feedback uses the same `combat.you_hit` / `combat.target_hit_you` strings as melee.

Only spells declared `target: "hostile"` skip the `no_target` form check; if you give a spell only a `to_target` form, leave `target` as `"hostile"` (or supply both forms for `"any"`/`"friendly"`).

New players start with no spells — they learn them via loot or teaching at runtime. Admins are auto-granted `spell.heal` and `spell.spark` on login for testing (see `ADMIN_GRANTED_SPELLS` in `src/game/actors.js`).

### Add a social verb

Edit `content/socials.json` and add a top-level key:

```json
"poke": {
  "en": {
    "button": "Poke",
    "to_target": { "self": "you poke {target}.", "others": "{actor} pokes {target}." },
    "missing": "poke whom?"
  },
  "cs": { ... }
}
```

The verb becomes a command and a popover button automatically. No code change.

## Architecture notes

- **No build step.** Plain ES modules, Node 20+. Single runtime dep (`ws`).
- **JSON-only persistence.** Atomic writes via tmp+rename. SQLite migration deferred until the combat phase or first real pain (cross-player queries / transactions / event log). Persistence is already isolated in `src/persist/`.
- **Tick loop** at 1000ms. Each NPC accrues `energy += spd`; when `energy >= cost` the next viable behavior fires. Player commands are immediate today; combat will route through the same scheduler.
- **Per-recipient broadcast** — `broadcastToRoom(roomId, msgOrBuilder, except)` accepts a function that receives the recipient and returns their localized message. Used for narration, say/emote, socials, item use, NPC primitives.
- **Verb shape** — `{ <lang>: { to_target?: {self, others}, no_target?: {self, others}, missing? } }`. Used by socials and `item.use`. `runVerb` in `src/game/verbs.js` is the shared executor.
- **Item instance** — `{ defId, instanceId, def, state }`. `state` is empty today, will hold durability/charges later. Saved to player JSON as `{ defId, state }`.
- **Popover** — single client component for chip-anchored interactions. `Look` plus context buttons; submenus swap the popover content (`Use ▶`, `Give ▶`). Hostile chips bypass the popover entirely and fire `attack` on click; spell chips drive their own logic from the spell's `target` metadata.
- **Room composition refresh** — when a room's items or actors change (take, drop, move, login, disconnect) the server sends a fresh `room` message to every player in that room, so inspect panels stay current.
- **Bootstrapping** — at boot: load strings, load world (rooms, NPCs, socials, items, admins), bootstrap admin player records if missing, spawn NPCs and items from defs.

## Roadmap

Ordered by priority within each status. Preparation tasks land before the systems they unblock; the combat/aggro/perception cluster comes before the light + content phase per the project's current direction.

### Done

| Phase |
|---|
| Walk + chat + persistence |
| i18n (en/cs) |
| World tick + ambient NPCs |
| Click-to-interact UI (popover) |
| Items + inventory + simple item interaction loop |
| Combat (attack verb, HP changes, monster death) |
| Magic (spells as content, MP costs) |
| Loot tables, monster spawns |
| Stabilisation, testing, basic gameplay content |

### Planned — combat & system cleanup (next)

| Phase |
|---|
| Aggro overhaul (threat priority, taunt/calm; introduces stubbed `canPerceive(observer, target)` helper consumed by acquisition and targeting) |
| Cast cooldown (shared action queue with attack, enables slow/strong spells) |
| Perception (derived bonus + check primitive, extends `canPerceive`; ships with a few hidden rooms / secret fixtures and a keen-senses item or spell) |
| Out-of-combat monster regen (rate scales with actor position once positions land) |
| Actor positions (stand/sit/sleep; sleep blocks passive perception via `canPerceive`, reactive aggro on attack still wakes; combat auto-stands; couples with OOC regen) |

### Planned — UI / UX polish

| Phase |
|---|
| Right-side panel rework, configurable cast menu |
| Item disposal (mimic vendor) |

### Planned — pre-light preparation

| Phase |
|---|
| Pre-light content audit (rooms: `outdoor` + `lightBase`; NPCs: `vision`; items: `lightSource`) — see `docs/superpowers/plans/2026-05-09-pre-light-content-audit.md` |

### Planned — light & exploration content

| Phase |
|---|
| Light system (visual-only v1) |
| Light/visibility spells, light sources |
| Hidden rooms / undeclared exits (revealed via perception, items, or knowledge) |
| Discovered-secrets tracking (IDed secrets, player save records discovered IDs) |
| New areas (river, marsh, deep mine) |

### Planned — later systems

| Phase |
|---|
| Day/night cycle (world clock, dusk/dawn for outdoor rooms) |
| Summoning, player pets |
| Server events |

### Deferred

| Phase | Reason |
|---|---|
| Quests / dialogue trees | content-heavy, lands once exploration content is real |
| Internet-readiness security pass (passwords + hashing, TLS for HTTP/WS, input sanitation, rate limiting, session/auth model) | until exposure beyond LAN is planned — current `data/admins.json` + LAN-only stance is explicit |
| SQLite migration | until performance pain (cross-player queries, transactions, event log) |
