---
name: realm-content
description: |
  Use this skill when the user asks to create or edit Realm MUD content: rooms, monsters, NPCs, or items.
  Triggers on phrases like "create a room", "add a monster", "new NPC", "create an item",
  "add a room", "new room", "create a mob", "add an item", "spawn an item", "new item",
  "create content", "add content", "rebalance <mob>", "rewrite <room> description".
  Do NOT trigger for mechanical changes (combat formulas, commands, server code).
allowed-tools: [Glob, Grep, Read, Write, Edit, Bash, Agent]
---

# Realm Content Creation Skill

This skill creates and edits rooms, NPCs/monsters, and items for the Realm MUD. All content is bilingual (English + Czech). Text is simple and plain — the game is aimed at kids.

## Area design principles

Read these before deciding *what* to build, not just *how*.

**Coherence within an area.** An area is a region (`home`, `forest`, `mine`). Its rooms, NPCs, and items should share theme, tone, loot tier, and roughly the same difficulty band. A glassy crystal-cave creature doesn't belong in `forest`. An iron sword fits forest; a kobold axe fits mine. When in doubt, read 2–3 existing rooms in the area to anchor tone.

**Difficulty: flat within, stepped between.** Mobs inside one area should sit in roughly the same HP/ATK band so the player can read the area's threat level. The gradient runs *between* areas (`home` starter → `forest` mid → `mine` late). Bosses (1–2 per area, marked by significantly higher HP/ATK) live **deeper** in the area, never at its entry. Current shape:

| Area    | Tier      | Typical HP | Typical ATK | Boss(es)                                                  |
|---------|-----------|------------|-------------|-----------------------------------------------------------|
| home    | starter   | 3–7        | 1           | none                                                      |
| forest  | mid       | 3–15       | 1–3         | bear (HP 30, ATK 5)                                       |
| mine    | late      | 10–24      | 2–4         | kobold_chief (HP 40, ATK 5); giant_centipede (HP 24, ATK 4) |

**Exits and foreshadowing in room text.** A room's `long` description should weave its exits into the prose ("a path winds north between the pines") rather than rely on a bare cardinal list. When an exit leads somewhere notably more dangerous — including across area borders — drop a hint: a distant howl, the smell of smoke, claw marks on a tree. Foreshadowing rewards careful play; bare exits make danger feel arbitrary.

**Spawn density follows narrative fit.** No fixed mobs-per-room or items-per-room rule — let the area's fiction decide. A wolf den should feel populated; a quiet meadow shouldn't. Same for items: place them where they make sense.

**New region threshold.** Don't introduce a new region for one or two rooms. Minimum 5 rooms, typically more, with a distinct theme and a clear difficulty step from neighbouring regions.

## Workflow

Every content creation task follows the same steps:

1. **Scan live state** — collect existing IDs, stat bands, and spawn locations before writing anything.
2. **Plan exits and wiring** — identify which existing rooms need exit updates. Never create a room that is unreachable.
3. **Write files** — create JSON files following the schemas in `references/schemas.md`.
4. **Wire exits** — edit any existing room files that need new exits pointing to the new room.
5. **Verify** — grep for the new IDs in room exit maps to confirm nothing is dangling.

For **edits** (rebalancing a mob, rewriting a description, swapping an exit), the scan is lighter: read only the file being edited and any directly affected neighbours. Skip exit re-wiring unless the edit changes connectivity.

## Step 1 — Scan live state

Content is organized in **per-region subfolders** for rooms and NPCs, and a hybrid layout for items (see Step 2). Use recursive globs:

```
Glob: content/rooms/**/*.json   → all room IDs
Glob: content/npcs/**/*.json    → existing NPC stat ranges
Glob: content/items/**/*.json   → existing item patterns
```

For broad scans (full content tree, more than ~10 files to read), delegate to an `Explore` subagent and work from its summary — it keeps the parent context clean. Ask the subagent for: valid room IDs, HP/ATK band per area, which rooms already have items spawning. For narrow lookups (one room's exits, one NPC's stats), Read or Grep directly.

Build a mental map of:
- All valid room IDs (needed for exits and spawn locations)
- HP/ATK band of mobs in the **target area** (anchor balancing there, not across areas)
- Which rooms already have items spawning there

## Step 2 — File naming and folder layout

| Type             | ID pattern                                    | Example                  |
|------------------|-----------------------------------------------|--------------------------|
| Room             | `<region>.<place>`                            | `forest.meadow`          |
| NPC              | `<region>.<creature>` (region where it lives) | `home.rat`               |
| Item (zone-tied) | `<region>.<name>`                             | `forest.iron_sword`      |
| Item (generic)   | `<category>.<name>` (`item`, `potion`, `amulet`) | `potion.heal`         |
| Effect           | `effect.<name>`                               | `effect.poison`          |
| Spell            | `spell.<name>`                                | `spell.heal`             |

IDs always match the filename without `.json`. Lowercase, snake_case, ASCII only. **Enforced at boot** — `contentLoader.js` throws if filename ≠ `id`.

For NPCs the prefix is the **region the NPC lives in** (e.g. `home.rat`, not `basement.rat`). For items, use a region prefix when the item is tied to a zone (`forest.copper_key`); use a category prefix (`item`, `potion`, `amulet`) when the item is generic and could appear anywhere.

**Current regions:** `home`, `forest`, `mine`. Add a new region only per the threshold above.

### Folder layout

The loader recurses, so a file's location does not affect its id — folders are purely organisational.

```
content/rooms/<region>/<region>.<place>.json
content/npcs/<region>/<region>.<creature>.json
content/items/
  consumables/   potions, herbs, food, scrolls, reagents (anything used up)
  wearables/     weapons, armor, amulets (anything with a `wearable` block)
  fixtures/      room props (`pickable: false`, `weight: 99`)
  <region>/      non-categorical region-tied items (keys, rocks, toys bound to a zone)
  _generic/      parking lot for items that don't fit any category yet — goal: stay empty
```

**Item folder rule: category beats region.** A wearable goes in `wearables/` even if it's region-tied (e.g. `forest.iron_sword.json` lives in `wearables/`). A consumable goes in `consumables/` regardless of region. Only items that fit no category use the region folder. `_generic/` is a holding pen — nothing should stay there long; find it a category or a region.

## Step 3 — Exit keys

Valid direction keys: `n`, `s`, `e`, `w`, `u`, `d`.
All exits must point to an existing room ID — the boot validator throws on unknown targets. If a room is intended to have future exits that don't exist yet, omit those keys entirely (do not use `null`).
New rooms must have at least one exit that connects back into the existing map.

## Step 4 — Czech text

Write Czech text naturally — short, plain sentences. **Sense beats precision**: a translation that reads natural and conveys the meaning is better than a stiff word-for-word rendering. Use nominative for `{actor}` and `{target}` placeholders; items can declare optional `nameAcc` (accusative) for use as direct objects in templates. When unsure, follow patterns in existing files — but don't preserve a literal English construction at the cost of readability.

## Step 5 — Style guide

- Simple words, short sentences. No purple prose.
- Room `short`: one sentence, present tense, describes what you see at a glance.
- Room `long`: 2–4 sentences. Sensory details (smell, sound, light). **Mention exits in the prose** ("a path winds north between the pines"), not as a bare cardinal list. Hint at danger when an exit leads somewhere harder, especially across area borders.
- NPC `short`: one sentence, present tense, what the creature is doing right now.
- NPC `long`: 2–3 sentences. Appearance + demeanor. No backstory paragraphs.
- Item `short`: one sentence — what the item looks like sitting in the room.
- Item `long`: 2–3 sentences. Physical detail + hint at use, if any.

## NPC balancing reference

Read the actual files when tuning — this drifts. Anchor a new NPC against existing mobs in the **same area**, not across areas.

| NPC                       | HP | ATK | DEF | SPD | EVA | Damage     | Disposition           |
|---------------------------|----|-----|-----|-----|-----|------------|-----------------------|
| **home (starter)**        |    |     |     |     |     |            |                       |
| wasp                      | 4  | 1   | 0   | 2   | 40  | 1d2+ATK    | hostile               |
| rat                       | 7  | 1   | 0   | 3   | 10  | 1d3+ATK    | hostile               |
| dog                       | 6  | 1   | 0   | 6   | 0   | —          | friendly              |
| bee                       | 6  | 1   | 0   | 8   | 30  | 1          | neutral               |
| **forest (mid)**          |    |     |     |     |     |            |                       |
| rabbit                    | 3  | 1   | 0   | 7   | 30  | —          | neutral               |
| fox_pup                   | 4  | 1   | 0   | 6   | 30  | —          | neutral               |
| fox                       | 8  | 2   | 0   | 6   | 30  | —          | neutral               |
| wolf                      | 14 | 3   | 1   | 6   | 0   | —          | hostile (acc 10)      |
| skeleton                  | 15 | 3   | 1   | 10  | 0   | —          | hostile (fast outlier)|
| **bear (boss)**           | 30 | 5   | 2   | 6   | 0   | —          | hostile               |
| **mine (late)**           |    |     |     |     |     |            |                       |
| kobold (and variants)     | 10 | 2   | 1   | 4   | 15  | —          | hostile               |
| rat_swarm                 | 14 | 2   | 0   | 4   | 0   | —          | hostile               |
| kobold_guard              | 16 | 3   | 2   | 5   | 15  | —          | hostile               |
| **giant_centipede (sub-boss)** | 24 | 4 | 1 | 5   | 0   | —          | hostile               |
| **kobold_chief (boss)**   | 40 | 5   | 3   | 5   | 0   | —          | hostile (acc 15, mr 20)|

`skeleton` at SPD 10 is the explicit "fast" design exception. All other hostile mobs sit at or below SPD 6 per the pacing rule below.

### Combat pacing — design principle

**Realm is for kids. Fights should feel slow and forgiving, not punishing.** When designing a hostile mob, prefer **slow + tanky** over **fast + hard-hitting**. A long fight gives the player time to read, react, and use abilities; a fast deadly fight just frustrates.

Concretely:
- **Default actor SPD is 6** (1 action per 2 ticks at 1000 ms tick = ~0.5 actions/sec).
- Hostile mobs should usually sit **at or below SPD 6**. Only reserve SPD 8–10 for special "fast" creatures (e.g. skeleton).
- If a mob feels too weak in playtesting, **raise its HP** before raising its damage.
- Damage `1d2+ATK` to `1d4+ATK` is typical. Avoid flat high damage on early-zone mobs.
- Early-zone hostiles: 4–8 HP, SPD 2–6, damage `1d2+ATK`–`1d3+ATK`.

### Magic resistance

NPCs default to `magicResist: 0` (no spell resistance). Effective resist on the target is `magicResist + int`, capped at 95%, rolled against d100 before any harmful spell lands. Use sparingly:
- `magicResist: 20` — modest, e.g. an elite or boss with light magical insulation (kobold chief).
- `magicResist: 50` — high, fits explicitly anti-magic creatures (skeleton, animated constructs).
- Avoid stacking high `magicResist` with high `int` — both feed the same roll.

Damage spells use dice formulas (`"1d4+INT/4"`, `"4d6+INT"`); `INT` lets caster intelligence scale spell power. Heal `amount` also accepts a formula. Available variables in formulas: `ATK`, `DEF`, `INT`, `HP`, `MP`, `MR` (the *actor's* magic resist), `ACC`, `EVA`. `*N` and `/N` postfix modifiers are supported (e.g. `INT/4`, `INT*2`).

### Accuracy & Evasion

Melee-only hit/miss roll. Before damage rolls, `executeAttack` computes `dodge = clamp(target.evasion - actor.accuracy, 0, 50)`; if `dodge > 0` and `d100 ≤ dodge`, the attack misses (no damage, but aggro still registers). Spells are unaffected. Defaults are `accuracy: 0, evasion: 0` — two zero-stat actors never miss each other, so EVA-investing mobs are the exception, not the rule.

Tuning guidance:
- **Skirmishers** (rabbit, fox, bee, fox_pup): `evasion: 30`. Twitchy, hard to land a clean hit on.
- **Wasp**: `evasion: 40` — top of the range, deliberately visible early so players see the mechanic in the home zone.
- **Standard mobs** (kobold variants, kobold guard): `evasion: 15`.
- **Slow / sluggish** (rat): `evasion: 10`.
- **Tanks** (bear, skeleton, kobold chief, giant centipede): leave `evasion` at default 0 — they take the hit.
- **Predators with focus** can carry `accuracy` to push through future player evasion gear: wolf at `accuracy: 10`, kobold chief at `accuracy: 15`.

Gear: ACC fits weapons and rings; EVA fits cloaks, boots, and light armor. Negative `evasion` on heavy armor is mechanically supported but reserved for a later design pass — don't ship it without discussing.

## Behavior primitives

Only use primitives from this list. Unknown primitives crash at boot.

| Primitive   | Purpose                               | Status   | Required fields                        |
|-------------|---------------------------------------|----------|----------------------------------------|
| `attack`    | Attack aggro target                   | ready    | `damage`, `templates`, `requires: "aggro_target"` |
| `emote`     | Ambient flavour text                  | ready    | `lines`                                |
| `interact`  | Do something to a random player      | ready    | `templates` (use `{target}`)           |
| `flee`      | Move to random exit                   | ready    | `templates` (use `{actor}`, `{direction}`), `requires: "was_attacked"` |
| `give_item` | Give inventory item to random player  | ready    | `templates` (use `{target}`, `{item}`) |
| `say`       | Broadcast dialogue                    | ready    | `lines`                                |
| `wait`      | Stand idle, consume energy            | ready    | none (no broadcast, just consumes the turn) |
| `move`      | Wander between rooms                  | ready    | optional `templates` (use `{actor}`, `{direction}`) — omit to move silently |
| `cast`      | NPC casts a spell                     | ready    | `spell` (id), `target: "self"` or `"aggro_target"` |

**`cast` example** (a friendly NPC self-heals when low):

```json
{
  "primitive": "cast",
  "spell": "spell.heal",
  "target": "self",
  "chance": 1.0,
  "cost": 12,
  "requires": { "type": "low_hp", "ratio": 0.5 }
}
```

`cast` deducts MP, runs the spell's verb broadcast, and applies the spell's effect (damage routes through `applyDamageWithFeedback`; `apply_effect` calls `applyActiveEffect`; `heal` and other effect types go through `applyEffect`). It silently aborts if MP is insufficient, the spell is unknown, or `aggro_target` has no valid target.

`lines` and `templates` must be objects with `en` and `cs` keys, each holding an array of strings. Arrays must be the same length in both languages.

Hostile aggressive NPCs need at minimum: one `attack` behavior + one `emote` behavior.

## Item tags reference

Common tags — use existing ones rather than inventing new ones:

`weapon`, `armor`, `herb`, `reagent`, `food`, `fixture`, `tool`, `key`, `toy`, `light`

Fixture items are room props: set `"pickable": false` and `"weight": 99`.
Reagent/herb items carried by players: `"weight": 0` or `1`.

**Wearable items** (weapons, armor, amulets) declare a `wearable` block:

```json
"wearable": {
  "slot": "weapon",
  "bonus": { "attack": 1 }
}
```

Slots: `weapon`, `body`, `head`, `amulet`. Bonus stats: `attack`, `defense`, `hpMax`, `mpMax`, `int`, `magicResist`, `accuracy`, `evasion`, `spd`. Optional `wearable.effects: ["effect.id", ...]` applies passive effects while equipped.

## Checklist before finishing

- [ ] New content fits the area's theme and tone (read 2–3 existing files in the same area to anchor)
- [ ] New mob's HP/ATK lands within the area's typical band, or is clearly a boss placed deeper
- [ ] Room `long` weaves exits into prose and foreshadows dangerous neighbours (within area or across borders)
- [ ] Every new room has at least one exit pointing to an existing room
- [ ] Every existing room that should connect to the new room has been edited
- [ ] Every NPC `location` and item `spawn.location` is a valid room ID
- [ ] All behavior `primitive` values are in the known-primitives list
- [ ] `lines`/`templates` arrays are same length in `en` and `cs`
- [ ] No `null` exit values anywhere
- [ ] Both `en` and `cs` filled in for all text fields (Czech: readable > literal)
- [ ] Filename matches `id` exactly (boot will fail otherwise)
- [ ] Items placed in the right folder (`consumables/`, `wearables/`, `fixtures/`, `<region>/`, or — last resort — `_generic/`)

See `references/schemas.md` for complete JSON schemas.
