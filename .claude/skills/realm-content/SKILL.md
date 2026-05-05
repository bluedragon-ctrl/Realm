---
name: realm-content
description: |
  Use this skill when the user asks to create Realm MUD content: rooms, monsters, NPCs, or items.
  Triggers on phrases like "create a room", "add a monster", "new NPC", "create an item",
  "add a room", "new room", "create a mob", "add an item", "spawn an item", "new item",
  "create content", "add content".
  Do NOT trigger for mechanical changes (combat formulas, commands, server code).
allowed-tools: [Glob, Grep, Read, Write, Edit, Bash]
---

# Realm Content Creation Skill

This skill creates rooms, NPCs/monsters, and items for the Realm MUD. All content is bilingual (English + Czech). Text is simple and plain — the game is aimed at kids.

## Workflow

Every content creation task follows the same steps:

1. **Scan live state** — read the current content directory to get valid room IDs, existing stat baselines, and spawn locations before writing anything.
2. **Plan exits and wiring** — identify which existing rooms need exit updates. Never create a room that is unreachable.
3. **Write files** — create JSON files following the schemas in `references/schemas.md`.
4. **Wire exits** — edit any existing room files that need new exits pointing to the new room.
5. **Verify** — grep for the new IDs in room exit maps to confirm nothing is dangling.

## Step 1 — Scan live state

Run these before creating anything:

```
Glob: content/rooms/*.json       → collect all room IDs
Glob: content/npcs/*.json        → collect existing NPC stat ranges
Glob: content/items/*.json       → collect existing item patterns
```

Read each file quickly (just the `id`, `exits`, `stats`, and `spawn.location` fields matter for planning). Build a mental map of:
- All valid room IDs (needed for exits and spawn locations)
- HP/ATK stat range of existing mobs (for balancing new ones)
- Which rooms already have items spawning there

## Step 2 — File naming convention

| Type  | Pattern                                          | Example                    |
|-------|--------------------------------------------------|----------------------------|
| Room  | `<region>.<place>.json`                          | `forest.meadow.json`       |
| NPC   | `<region>.<creature>.json` (region where it lives) | `home.rat.json`          |
| Item  | `<region>.<item>.json` (zone-tied) **or** `<category>.<item>.json` (generic — `item`, `potion`) | `forest.blue_flower.json`, `potion.heal.json` |
| Effect | `effect.<name>.json` | `effect.poison.json` |
| Spell | `spell.<name>.json` | `spell.heal.json` |

IDs inside the JSON always match the filename without `.json`. Lowercase, snake_case, ASCII only. **Enforced at boot** — `contentLoader.js` throws if filename ≠ `id`.

For NPCs the prefix is the **region** the NPC lives in (e.g. `home.rat`, not `basement.rat`), so the prefix matches the room the NPC is bound to. For items, use a region prefix when the item is tied to a specific zone (`forest.iron_sword`); use a category prefix (`item`, `potion`, `amulet`) when the item is generic and could appear anywhere.

**Current regions:** `home`, `forest`. Add a new region only when introducing a meaningfully separate zone with multiple rooms.

**Item subfolder layout** (target — current files don't all follow this yet):

```
content/items/
  consumables/   potions, herbs, food, reagents (anything used up)
  wearables/     weapons, armor, amulets (anything with a `wearable` block)
  fixtures/      room props (`pickable: false`, `weight: 99`)
  <flat>         remaining keys, scrolls, toys
```

The loader recurses, so a file's location does not affect its id; this is purely organisational. New items should land in the right subfolder.

## Step 3 — Exit keys

Valid direction keys: `n`, `s`, `e`, `w`, `u`, `d`.  
All exits must point to an existing room ID — the boot validator throws on unknown targets. If a room is intended to have future exits that don't exist yet, omit those keys entirely (do not use `null`).  
New rooms must have at least one exit that connects back into the existing map.

## Step 4 — Czech text

Write Czech text naturally — short, plain sentences. Use nominative for `{actor}` and `{target}` placeholders. Items can declare optional `nameAcc` (accusative) for use as direct objects in templates. When in doubt, follow the patterns in existing files.

## Step 5 — Style guide

- Simple words, short sentences. No purple prose.
- Room `short`: one sentence, present tense, describes what you see at a glance.
- Room `long`: 2–4 sentences. Sensory details (smell, sound, light). Mention exits only if they are notable features of the space.
- NPC `short`: one sentence, present tense, what the creature is doing right now.
- NPC `long`: 2–3 sentences. Appearance + demeanor. No backstory paragraphs.
- Item `short`: one sentence — what the item looks like sitting in the room.
- Item `long`: 2–3 sentences. Physical detail + hint at use, if any.

## NPC balancing reference

Match new NPCs to nearby mobs in HP and ATK. Current baselines (read the actual files when tuning, this drifts):

| NPC         | HP | ATK | DEF | SPD | Damage     | Disposition |
|-------------|----|-----|-----|-----|------------|-------------|
| wasp        | 4  | 1   | 0   | 2   | 1d2+ATK    | hostile     |
| rat         | 7  | 1   | 0   | 3   | 1d3+ATK    | hostile     |
| dog         | 6  | 1   | 0   | 6   | —          | friendly    |
| bee         | 6  | 1   | 0   | 8   | 1          | neutral     |
| rabbit      | 3  | 1   | 0   | 7   | —          | neutral     |
| fox         | 8  | 2   | 0   | 6   | —          | neutral     |
| fox_pup     | 4  | 1   | 0   | 6   | —          | neutral     |
| wolf        | 14 | 3   | 1   | 6   | —          | hostile     |
| bear        | 30 | 5   | 2   | 6   | —          | hostile     |
| skeleton    | 15 | 3   | 1   | 10  | —          | hostile     |

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

Damage spells use dice formulas (`"1d4+INT/4"`, `"4d6+INT"`); `INT` lets caster intelligence scale spell power. Heal `amount` also accepts a formula. Available variables in formulas: `ATK`, `DEF`, `INT`, `HP`, `MP`, `MR` (the *actor's* magic resist). `*N` and `/N` postfix modifiers are supported (e.g. `INT/4`, `INT*2`).

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

Slots: `weapon`, `body`, `head`, `amulet`. Bonus stats: `attack`, `defense`, `hpMax`, `mpMax`, `int`, `magicResist`, `spd`. Optional `wearable.effects: ["effect.id", ...]` applies passive effects while equipped.

## Checklist before finishing

- [ ] Every new room has at least one exit pointing to an existing room
- [ ] Every existing room that should connect to the new room has been edited
- [ ] Every NPC `location` and item `spawn.location` is a valid room ID
- [ ] All behavior `primitive` values are in the known-primitives list
- [ ] `lines`/`templates` arrays are same length in `en` and `cs`
- [ ] No `null` exit values anywhere
- [ ] Both `en` and `cs` filled in for all text fields
- [ ] Filename matches `id` exactly (boot will fail otherwise)
- [ ] Items placed in the right subfolder (`consumables/`, `wearables/`, `fixtures/`, or flat)

See `references/schemas.md` for complete JSON schemas.
