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

**Difficulty: flat within, stepped between.** Mobs inside one area should sit in roughly the same HP/ATK band so the player can read the area's threat level. The gradient runs *between* areas (`home` starter → `village` early → `forest` mid → `mine` late → `castle` endgame). Bosses (1–2 per area, marked by significantly higher HP/ATK) live **deeper** in the area, never at its entry. Snapshot (read the actual NPC files when tuning — this drifts):

| Area    | Tier      | Typical HP | Typical ATK | Boss(es)                                                  |
|---------|-----------|------------|-------------|-----------------------------------------------------------|
| home    | starter   | 3–7        | 1           | none                                                      |
| village | early     | 5–20       | 0–3         | toad_king-tier specials                                   |
| forest  | mid       | 3–15       | 1–3         | bear (HP 30, ATK 5)                                       |
| mine    | late      | 10–24      | 2–4         | kobold_chief (HP 40, ATK 5); giant_centipede (HP 24, ATK 4) |
| castle  | endgame   | 22–60      | 4–7         | fallen_lord-tier (HP 120, ATK 10)                         |

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

**Renaming an item display name?** Grep for the *old* display name across `content/` before committing — NPC `craft` and `exchange` `verb` templates may quote the item name inline, and those won't follow an id-based rename. Example: when *"bear skin armor"* was renamed, the smith's craft verb still said *"a heavy bear skin armor takes shape"* and had to be patched separately.

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

| Type            | ID pattern                                       | Example                  |
|-----------------|--------------------------------------------------|--------------------------|
| Room            | `<region>.<place>`                               | `forest.meadow`          |
| NPC             | `<region>.<creature>` (region where it lives)    | `home.rat`               |
| Item (fixture)  | `<region>.<name>` (bound to that region's rooms) | `home.cauldron`          |
| Item (anything else) | `<category>.<name>` (`item`, `potion`)      | `item.iron_sword`, `potion.heal` |
| Effect          | `effect.<name>`                                  | `effect.poison`          |
| Spell           | `spell.<name>`                                   | `spell.heal`             |

IDs always match the filename without `.json`. Lowercase, snake_case, ASCII only. **Enforced at boot** — `contentLoader.js` throws if filename ≠ `id`.

For NPCs the prefix is the **region the NPC lives in** (e.g. `home.rat`, not `basement.rat`). For items, the **only** zone-tied items are fixtures (room props that physically belong to a specific room). Everything else — keys, weapons, herbs, scrolls, even region-flavoured loot like a kobold axe — uses a category prefix (`item.` or `potion.`), because a "forest" sword can show up in the mine and a "mine" key can open a village door.

**Current regions:** `home`, `village`, `forest`, `mine`, `castle`. Add a new region only per the threshold above.

### Folder layout

The loader recurses, so a file's location does not affect its id — folders are purely organisational.

```
content/rooms/<region>/<region>.<place>.json
content/npcs/<region>/<region>.<creature>.json
content/items/
  consumables/   potions, herbs, food, reagents (anything used up except scrolls)
  scrolls/       spell scrolls (`use.effect.type: "teach_spell"`)
  wearables/     weapons, armor, amulets (anything with a `wearable` block)
  fixtures/      room props (`pickable: false`, `weight: 99`) — keep zone prefix
  keys/          keys that unlock locked exits or containers (tag `"key"`)
  _generic/      anything else: tools, toys, misc loot (uses `item.<name>` id)
```

**Item folder rule: category first.** Wearables go in `wearables/`, consumables in `consumables/`, fixtures in `fixtures/`, spell scrolls in `scrolls/`, keys in `keys/`. Everything else lives in `_generic/` with an `item.<name>` id — there is no per-region item folder anymore.

## Step 3 — Exit keys

Valid direction keys: `n`, `s`, `e`, `w`, `u`, `d`.
All exits must point to an existing room ID — the boot validator throws on unknown targets. If a room is intended to have future exits that don't exist yet, omit those keys entirely (do not use `null`).
New rooms must have at least one exit that connects back into the existing map.

## Step 4 — Czech text

Write Czech text naturally — short, plain sentences. **Sense beats precision**: a translation that reads natural and conveys the meaning is better than a stiff word-for-word rendering.

**Name forms.** Czech-target NPCs and items declare declined forms alongside `name`. All optional; missing forms fall back to nominative.

| Field     | Case (pád)         | When it's used                                                  |
|-----------|--------------------|-----------------------------------------------------------------|
| `name`    | nominative (1.)    | subject — `{target} se zhroutí`                                 |
| `nameAcc` | accusative (4.)    | direct object — `kousne {target}`, after `na`/`pro`             |
| `nameDat` | dative (3.)        | indirect object — `dáváš X {target.dat}`, after `k`/`proti`/`po`|
| `nameGen` | genitive (2.)      | possession + after `do`/`od`/`u`/`bez` — `do ruky {target.gen}` |
| `nameVoc` | vocative (5.)      | direct address — rare; use for "Petře!" lines                   |

**Template placeholders.** Plain `{actor}` is nominative; plain `{target}` is accusative (the default for direct-object slots). Use a dotted suffix to pick a specific case:

- `{target.dat}` — after `k`, `proti`, `po`, with verbs `dát`, `podat`, `ukázat`
- `{target.gen}` — possessive ("X's leg/lips/feet"), after `do`, `od`, `u`, `bez`
- `{actor.gen}` — `kouzlo {actor.gen}` ("X's spell")
- `{target.nom}` / `{actor.acc}` — explicit overrides when needed

The same syntax works in NPC verb templates (attack, give_item, interact, craft) and in item.use templates. When you write a new template with `{target}` or `{actor}`, decide which case the surrounding Czech requires and pick the right suffix. See [references/czech-cases.md](references/czech-cases.md) for the preposition-to-case lookup, declined-form examples, and the dat≈loc shortcut for `po + loc` templates.

## Step 5 — Style guide

- Simple words, short sentences. No purple prose.
- Room `short`: one sentence, present tense, describes what you see at a glance.
- Room `long`: 2–4 sentences. Sensory details (smell, sound, light). **Mention exits in the prose** ("a path winds north between the pines"), not as a bare cardinal list. Hint at danger when an exit leads somewhere harder, especially across area borders.
- NPC `short`: one sentence, present tense, what the creature is doing right now.
- NPC `long`: 2–3 sentences. Appearance + demeanor. No backstory paragraphs.
- Item `short`: one sentence — what the item looks like sitting in the room.
- Item `long`: 2–3 sentences. Physical detail + hint at use, if any.

### Naming and spelling

- **Room names: sentence case.** *"Berry patch"*, *"The bakery"*, *"Cobbled lane"* — capitalize only the first word and proper nouns. Title-Case room names look out of place against the otherwise-lowercase UI tone.
- **NPC names: lowercase common nouns.** *"the kobold chief"*, *"the baker"*, *"a grey wolf"*. Capitalize only true proper names.
- **UK English spelling.** `armour`, `colour`, `centre`, `grey`, `spilt`. The codebase is already UK; don't drift.
- **Gender-neutral NPC speech.** Players can be any gender. No *"lad"*, *"lass"*, *"young man"*. Use *"friend"*, *"careful now"*, *"dear"* (gender-neutral term-of-endearment), or just drop the address.

### Articles and countability

Display names are wrapped in *a* / *the* by the engine, so the noun must be countable.

- ❌ *"a leather armour"* — `armour` is uncountable, the article is ungrammatical.
- ✅ *"a suit of leather armour"*, or rename to a countable garment (*jerkin, vest, cloak*).

Same trap for *cloth, mail, gear, rope* (collective), *fruit* (often), *advice*, etc. When in doubt, try saying *"two leather armours"* aloud — if it sounds wrong, the singular is uncountable.

### Kid-friendly register

Realm is for kids. Action verbs in combat (*lunges, snaps, sinks teeth*) are fine — soften the *aftermath* and *descriptions*, not the action itself.

| Avoid                          | Prefer                                              |
|--------------------------------|-----------------------------------------------------|
| `blood`, `bloody`, `blood-stained` | `damp stone`, `dried leaves`, `well-used`, `dirt-crusted` |
| `reeks`, `stinks`              | `smells strongly of`                                |
| `vile`, `disgusting`           | `awful`, `bad`                                      |
| `gore`, `corpse`, `human bones`| omit, or `bones long since picked clean`            |
| `kill`, `killed`, `dies`       | `defeats`, `collapses`, `crumples and lies still`   |
| `wounds do not close`          | `wounds bleed for a long time`                      |

The bar isn't sanitized — it's *gentle*. A bear cave can still feel dangerous; it just doesn't need human skeletons in it.

### Internal consistency

Quick contradictions that slip through if you don't re-read your own room/item:

- **Indoors:** things hang *from rafters / beams / the ceiling*, not *"from the roof"*.
- **Trees:** can't be *"heavy with fruit"* and have *"fallen blossoms"* in the same scene — fruit and flower are different seasons.
- **Self-referential lore:** if an NPC's `long` claims *"sells X for N gold"*, the actual `exchanges` block must match. Same for prices and quantities.
- **Articles agreement:** *"a iron trap door"* — check `a` vs `an` against the next word's sound.

### Czech possessives shortcut

English *"{target}'s feet"* is a possessive — in Czech the slot needs the **genitive**, not accusative. Write the CS template with `{target.gen}` and a noun in the order that fits Czech word order:

- EN: `"sniffs at {target}'s boots curiously."`
- CS: `"zvědavě čenichá u nohou {target.gen}."`

When porting an EN template that uses `{target}'s X`, pick `{target.gen}` on the CS side automatically — it's the most common reason you reach for genitive.

## Tier scaling

The world is built in three progression tiers. New content should declare which tier it targets and land inside that tier's stat bands. Tier 1 is anchored to existing content (home → village → forest → mine → castle); Tier 2 and 3 are forward-looking projections, refined as new content lands.

### Player progression

- **Starting stats** (`src/game/stats.js`): HP 20, MP 5, ATK 3, DEF 1, INT 1, SPD 6, MagResist 0, ACC 0, EVA 0.
- **Per-train gains** (`src/game/leveling.js`): HP +5, MP +3, ATK +1, DEF +1, INT +1, MR +2, ACC +1, EVA +2. Player gets **2 points per level**.
- **XP curve**: cumulative XP to level N = `10·Σk²` for k=1..N-1. L5=300, L8=1400, L12=5060, L16=12400, L25=49000.

### Tier table

| | **Tier 1** | **Tier 2** | **Tier 3** |
|---|---|---|---|
| Level range | 1–8 | 9–16 | 17–25 |
| Cumulative XP needed | 0–1400 | 1400–12400 | 12400–49000 |
| Player HP ceiling | ~50 | ~100 | ~180 |
| Player ATK ceiling (with gear) | ~16 | ~24 | ~32 |
| Player DEF ceiling | ~7 | ~12 | ~18 |
| Player INT ceiling (mage) | ~9 | ~14 | ~20 |
| Player MP ceiling (mage) | ~28 | ~50 | ~80 |
| Mob HP — fodder | 4–15 | 30–60 | 80–150 |
| Mob HP — standard | 15–40 | 60–100 | 150–250 |
| Mob HP — sub-boss | 40–60 | 100–180 | 250–400 |
| Mob HP — boss | 90–120 | 200–300 | 450–600 |
| Mob damage dice | 1d2–1d10 | 1d6–1d12 | 1d8–2d8 |
| Mob ATK | 1–10 | 6–18 | 14–28 |
| Mob DEF | 0–6 | 4–12 | 10–18 |
| Existing areas | home, village, forest, mine, castle | — | — |
| Spell tier | spark, arcane_bolt, shock, frost, burning_hands, life_drain | TBD | TBD |

### Anchoring numbers

- **Boss XP rule of thumb**: roughly `HP/2 + ATK·5 + (DEF·3)` adjusted for special abilities. Sanity-check against existing bosses (kobold_chief 50, bridge_troll 60, castle_captain 80, fallen_lord 200).
- **Standard mob XP**: roughly `HP/2 + ATK·2`. Fodder mobs may go lower for trivial fights.
- **All hostile mobs MUST have `xp`.** Neutral/friendly creatures (`disposition: "neutral"` or `"friendly"`) do not. Summoned NPCs (`summoned: true` runtime flag) never grant XP — combat.js skips them.

### Combat math affecting tier design

- **Damage floor**: `final = max(ceil(raw·0.25), raw - def)`. DEF can never reduce a hit below 25% of raw. This means high-DEF tanks remain damageable, and DEF can keep scaling into Tier 3 without making fights unwinnable.
- **Speed model**: `ticks_per_action = behavior.cost / actor.spd`. Default cost 12, default spd 6 → ~0.5 actions/second.

### Mage scaling (Tier 1 baseline)

- Damage spells scale with `INT/2`. At Tier 1 ceiling INT ~9, a shock (`1d10+INT/2`) averages ~10 dmg per cast.
- Mage's role is **burst + AoE + utility**, not sustained DPS. A pure mage burst-clears 1–2 enemies then must retreat to regen MP (no in-combat regen). Warriors out-DPS mages over long fights — this is by design.
- **Damage spells ignore target DEF** but are gated by target `magicResist + caster int` roll. Keep magicResist rare and thematic (undead, constructs) — see "Magic resistance" below.
- Tier 2 is the natural place to introduce stronger mage spells, MP-recovery items, or sustained-cast tools. Don't pre-buff mage in Tier 1.

### When designing new content

1. Decide the tier first. State it in the design notes.
2. Pick the player-ceiling row from the table — that's what the content has to be beatable by.
3. Place mob HP/ATK/DEF inside the tier's band. Bosses sit at the band's top with a 1.5–2× HP bump.
4. Cross-check XP against the rule of thumb. Adjust if the encounter is mechanically harder than its stat block suggests.
5. New offensive spells go into the tier whose damage-per-cast matches: Tier 1 spells cap around `1d10+INT/2`; Tier 2 spells can reach `2d6+INT` or similar.

This table will drift as Tier 2 content lands and we learn more. Update it; don't work around stale numbers.

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

## Item rarity and loot drops

All items have a `rarity` field (1–4) to help content creators understand loot progression:

| Rarity | Name | Examples | Who drops it |
|--------|------|----------|--------------|
| **1** | Common | Food, basic materials, standard weapons, simple amulets | Fodder mobs, standard mobs, casual encounters |
| **2** | Uncommon | Crafted items (bear armor, bone helmet), stat-boosting amulets (keen senses, strength) | Area mobs, mid-tier encounters, zone bosses within areas |
| **3** | Rare | Unique/magical items (frost blade, life drain dagger, amulet of sight), special boss drops | Boss fights, unique encounters, significant story moments |
| **4** | Artifact | Reserved for future legendary/endgame items | Not yet in game |

### Loot drop guidelines by mob type

**Standard fodder** (rat, wasp, basic mobs):
- Drop L1 only
- Example: `bat` drops `bat_wing` (L1 material)

**Standard area mobs** (wolf, skeleton, typical ~15 HP encounters):
- Primarily L1, occasional L2
- Example: `kobold_guard` might drop `item.wooden_club` (L1) or rarely `item.hand_axe` (L1)

**Zone bosses** (mid-tier, 25–40 HP, area completion):
- L1 common drops + guaranteed L2 upgrade
- Example: `toad_king` drops `toad_hide` (L1 material) + crafting materials, occasionally `amulet.strength` (L2)

**Story bosses / Special encounters** (40+ HP, unique mechanics, summoned via challenge):
- L2 + L3 guaranteed
- Example: `bat_daemon` (summoned boss in tower attic) drops `amulet_of_sight` (L3) + `bat_wing` (L1 x2)

**Rule of thumb:** Never let a standard encounter drop L3. L3 items are rewards for defeating *bosses* or *unique encounters*, not routine combat. If a mob's loot feels weak, add more L1 drops or a guaranteed L2 instead of bumping to L3.

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

## Exchanges (trade and craft)

Trading, vendor buyback, and crafting all share one schema: an `exchanges: [...]` array. It lives on **NPCs** (vendors, merchants) and on **fixture items** (cauldron, forge, anvil). Each entry is one explicit transaction.

```json
{
  "id": "smith.forge_iron_sword",
  "flavor": "craft",
  "inputs":  [{ "item": "item.iron_ore", "count": 2 }, { "gold": 5 }],
  "outputs": [{ "item": "item.iron_sword" }],
  "xp": 5,
  "verb": {
    "en": { "to_target": {
      "self":   "{target} hammers your ore into a fresh iron sword.",
      "others": "{actor} hands {target} ore; {target} forges a sword."
    }},
    "cs": { "to_target": {
      "self":   "{target} ti z rudy vykove čerstvý železný meč.",
      "others": "{actor} podává {target} rudu; {target} kove meč."
    }}
  }
}
```

**Fields:**
- `id` — unique within the host (`<host_short>.<action>`, e.g. `smith.buy_rope`, `cauldron.brew_mana`).
- `flavor` — `"buy"` (player gives gold, gets item), `"sell"` (player gives item, gets gold), `"craft"` (player gives items, gets items). Drives chip color and command routing.
- `inputs` / `outputs` — arrays of `{ item, count? }` or `{ gold }`. `count` defaults to 1.
- `xp` — optional, awarded on success.
- `verb` — same verb-shape as socials. **Required for `craft`** (boot will reject crafts without it). Optional for `buy`/`sell` — falls back to a generic broadcast.

**How players trigger them:**
- `buy <item>` / `sell <item>` — match by item id on the room's NPC exchanges.
- `use <item> on <fixture>` — runs the matching `craft` exchange on the fixture.
- `give <thing> to <target>` — auto-routes to a matching exchange when the gift fits one (e.g. `give 3 red_berries to baker` triggers the sell exchange); otherwise falls back to plain item transfer.
- Inspect chips on NPCs and craft fixtures show all available exchanges grouped by flavor.

**When to add exchanges:**
- Vendor NPC sells a generic item → one `buy` entry.
- Vendor NPC buys a player loot drop → one `sell` entry.
- Fixture transforms inputs → outputs → one `craft` entry per recipe (must include `verb`).
- Don't invent new flavors; if you need something exotic, raise it before coding.

## Lighting

Every room has an *effective light level* in `{ light, dim, light }`. Authored content controls it from three angles: room baseline, item floors (raise), and effect ceilings (clamp down). Actor-side `perception` (blindness / nightvision) then maps room light to *perceived* light.

### Room baseline

```json
"lightBase": "dark",       // "light" (default), "dim", or "dark"
"outdoor": true             // optional flag; outdoor rooms are always "light" baseline in practice
```

Set `lightBase: "dim"` for caves, dusk-lit halls, mines with old shafts. Set `lightBase: "dark"` for deep underground or sealed crypts where the player needs a light source to see. Outdoor rooms generally omit `lightBase` (defaults to `"light"`) and add `"outdoor": true`. **Don't** put `dark` in the `tags` array as a mechanical flag — that's cosmetic only; the field is `lightBase`.

### Items that emit light (floors)

Add a `lightSource` block on an item def to make it raise the room level when present in the room or in any actor's inventory/equipment:

```json
"lightSource": { "level": "light" }              // always-on
"lightSource": { "level": "light", "toggle": true }   // togglable fixture
```

Toggleable fixtures pair `lightSource.toggle: true` with `"lit": false` (initial state) and an `useExtinguish` verb-shape that mirrors `use`. The runtime fires `use` when unlit and `useExtinguish` when already lit; both should run an `{ "effect": { "type": "toggle_light" } }`. See [content/items/fixtures/mine.lantern_hook.json](../../../content/items/fixtures/mine.lantern_hook.json) for the canonical pattern.

A worn or carried item with `lightSource` is the player's portable light. Tag it `"light"` so chips show it as lighting gear.

### Effects: floors and ceilings

Active effects can contribute light from either side:

```json
"lightSource":    { "level": "dim" }    // floor — raises ambient (e.g. effect.candlelight, effect.magic_light)
"darknessSource": { "level": "dark" }   // ceiling — clamps room down (effect.magic_darkness, effect.magic_shadow)
"perception":     "blind"               // actor-side: clamp what the actor perceives to "dark"
"perception":     "nightvision"         // actor-side: raise perceived floor to "dim"
```

`exclusiveGroup` keeps competing effects from stacking. Conventions in use today:
- `vision_alter` — `effect.blinded`, `effect.nightvision` (mutually exclusive perception changes).
- `ambient_light` — magical light/darkness effects in the same group.

### NPC vision (data-only in v1)

NPCs declare how they see in the dark:

```json
"vision": "normal"        // default; sees only in lit rooms
"vision": "low_light"     // can act in dim rooms
"vision": "nightvision"   // unaffected by darkness
"vision": "blind"         // never relies on sight (e.g. shambling_zombie)
```

Validated at boot but not yet read by combat in v1 — set it now so v2 NPC-sight rules drop in without re-tagging mobs.

### Spells

Light/vision spells route through `effect.type: "apply_effect"`:

```json
"effect": { "type": "apply_effect", "effectId": "effect.magic_light" }
```

Current catalog: `spell.light`, `spell.darkness`, `spell.shadow`, `spell.blindness`, `spell.nightvision`, `spell.keen_senses`. Pattern for any new buff/debuff spell: write the effect file (`content/effects/`) with the desired `kind`/`duration`/sources, then a spell that applies it.

### Authoring dark/dim rooms

Description prose still loads in dark rooms but is presented dimmed and may strip names. Write room `long` so it conveys **what the player feels / hears / smells**, not just what they see. Sound, temperature, air movement, the echo of footsteps — these survive the light filter. A dark room described purely visually reads as an empty void.

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
- [ ] Items placed in the right folder (`consumables/`, `wearables/`, `fixtures/`, or `_generic/`); only fixtures use a region prefix in their id
- [ ] Any `craft` exchange has a `verb` block (boot enforces this); `buy`/`sell` may omit it
- [ ] Room names in **sentence case**; NPC common-noun names lowercase
- [ ] UK spelling (`armour`, `colour`, `centre`, `grey`); no US drift
- [ ] Display names are countable (no `"a leather armour"` — use `"a suit of leather armour"`)
- [ ] Register stays kid-friendly (no `blood`/`vile`/`reeks`/`human bones`); see register table in Step 5
- [ ] No accidental contradictions (no `"from the roof"` indoors, no `"fallen blossoms"` next to fruit-bearing trees)
- [ ] If you renamed an item display name, grepped the old name across `content/` for inline references in NPC verb templates
- [ ] If the room is `lightBase: "dim"` or `"dark"`, the `long` description leans on non-visual senses (sound, smell, air, echo) so it still reads when names are filtered out
- [ ] Toggleable light fixtures have `lightSource.toggle: true`, `"lit": false`, both `use` and `useExtinguish` blocks, and `effect: { "type": "toggle_light" }`
- [ ] New NPC has a `vision` field (`"normal"` default, or `"low_light"` / `"nightvision"` / `"blind"`)

See `references/schemas.md` for complete JSON schemas.
