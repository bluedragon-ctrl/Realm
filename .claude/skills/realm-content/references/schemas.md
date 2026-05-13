# Realm Content JSON Schemas

## Room

```json
{
  "id": "zone.place",
  "name":  { "en": "...", "cs": "..." },
  "short": { "en": "...", "cs": "..." },
  "long":  { "en": "...", "cs": "..." },
  "exits": {
    "n": "zone.other_room"
  },
  "lightBase": "dim",
  "outdoor": false,
  "tags": ["zone_name", "forest"]
}
```

**exits** — omit directions that have no destination yet. Valid keys: `n s e w u d`.  
**lightBase** — `"light"` (default, omit), `"dim"`, or `"dark"`. Mechanical field that drives the light system. See the "Lighting" section in `SKILL.md`.  
**outdoor** — `true` for outdoor rooms. Currently a flag; future weather/day-night hooks will read it.  
**tags** — purely cosmetic / categorical. Include a zone tag and biome/setting tags like `safe`, `forest`, `border`, `clearing`. **Do not** use `dark` as a tag for darkness — use `lightBase: "dark"` instead.

---

## NPC

```json
{
  "id": "zone.creature",
  "name":    { "en": "a rat",     "cs": "krysa"  },
  "nameAcc": { "en": "the rat",   "cs": "krysu"  },
  "title":   { "en": "rat",       "cs": "krysa"  },
  "location": "zone.room",
  "count": 1,
  "short": { "en": "...", "cs": "..." },
  "long":  { "en": "...", "cs": "..." },
  "disposition": "hostile",
  "aggressive": true,
  "mood": "angry",
  "stats": {
    "hp": 5, "hpMax": 5,
    "mp": 0, "mpMax": 0,
    "attack": 1, "defense": 0, "int": 0,
    "magicResist": 0,
    "accuracy": 0,
    "evasion": 0,
    "spd": 10
  },
  "vision": "normal",
  "respawn": { "ticks": 600 },
  "behaviors": [
    {
      "primitive": "attack",
      "name": { "en": "bite", "cs": "kousnutí" },
      "chance": 1.0,
      "cost": 12,
      "damage": "1d3+ATK",
      "requires": "aggro_target",
      "templates": {
        "en": ["line 1", "line 2", "line 3"],
        "cs": ["řádek 1", "řádek 2", "řádek 3"]
      }
    },
    {
      "primitive": "emote",
      "chance": 0.05,
      "cost": 6,
      "lines": {
        "en": ["line 1", "line 2", "line 3", "line 4"],
        "cs": ["řádek 1", "řádek 2", "řádek 3", "řádek 4"]
      }
    }
  ]
}
```

**disposition** — `"hostile"` | `"neutral"` | `"friendly"`  
**aggressive** — `true` means the NPC initiates combat on sight  
**mood** — `"angry"` | `"calm"` (display hint, not enforced mechanically)  
**count** — number of simultaneous instances; default 1  
**vision** — `"normal"` (default) | `"low_light"` | `"nightvision"` | `"blind"`. Validated at boot; v1 doesn't yet gate combat on it, but set it now so v2 NPC-sight rules drop in without re-tagging.  
**cost** — ticks per action; 12 = 1 action/tick at default speed  
**chance** — 0.0–1.0 probability this behavior fires when selected  
**damage** — dice formula: `"1d4"`, `"1d3+ATK"`, `"2"`, etc.  
**respawn.ticks** — ticks before a dead instance respawns  

---

## Item — basic (pickable)

```json
{
  "id": "item.blue_flower",
  "name":    { "en": "a blue flower", "cs": "modrý květ" },
  "nameAcc": { "en": "the blue flower", "cs": "modrý květ" },
  "short": { "en": "...", "cs": "..." },
  "long":  { "en": "...", "cs": "..." },
  "tags": ["herb", "reagent"],
  "weight": 0,
  "spawn": {
    "location": "zone.room",
    "count": 3,
    "respawnTicks": 300
  }
}
```

---

## Item — fixture (room prop, unpickable)

Fixtures are the only items that keep a region prefix in their id, because they're physically bound to a specific room.

```json
{
  "id": "home.cauldron",
  "name":    { "en": "a cauldron", "cs": "kotel" },
  "nameAcc": { "en": "the cauldron", "cs": "kotel" },
  "short": { "en": "...", "cs": "..." },
  "long":  { "en": "...", "cs": "..." },
  "tags": ["fixture"],
  "weight": 99,
  "pickable": false,
  "spawn": {
    "location": "zone.room",
    "count": 1
  }
}
```

---

## Item — toggleable light fixture

A wall-mounted brazier, lantern hook, or lectern that the player lights and extinguishes. The `lightSource.toggle` flag plus the initial `"lit": false` state plus the `useExtinguish` mirror is the canonical pattern. Live reference: [content/items/fixtures/mine.lantern_hook.json](../../../content/items/fixtures/mine.lantern_hook.json).

```json
{
  "id": "mine.lantern_hook",
  "name":    { "en": "a rusted lantern hook", "cs": "rezavý hák na lucernu" },
  "nameAcc": { "en": "the rusted lantern hook", "cs": "rezavý hák na lucernu" },
  "short": { "en": "...", "cs": "..." },
  "long":  { "en": "...", "cs": "..." },
  "tags": ["fixture"],
  "weight": 99,
  "pickable": false,
  "spawn": { "location": "mine.deep_hall", "count": 1 },
  "lightSource": { "level": "light", "toggle": true },
  "lit": false,
  "use": {
    "en": { "no_target": { "self": "you strike a spark...", "others": "{actor} strikes a spark..." }},
    "cs": { "no_target": { "self": "vykřesáš jiskru...", "others": "{actor} vykřese jiskru..." }},
    "effect": { "type": "toggle_light" }
  },
  "useExtinguish": {
    "en": { "no_target": { "self": "you pinch out the wick...", "others": "{actor} pinches out..." }},
    "cs": { "no_target": { "self": "uškubneš knot...", "others": "{actor} uškubne plamínek..." }},
    "effect": { "type": "toggle_light" }
  }
}
```

The runtime fires `use` when `state.lit` is false and `useExtinguish` when true. Both run a `toggle_light` effect.

---

## Item — usable (with effect)

```json
{
  "id": "potion.heal",
  "name":    { "en": "a heal potion", "cs": "lektvar léčení" },
  "nameAcc": { "en": "the heal potion", "cs": "lektvar léčení" },
  "short": { "en": "...", "cs": "..." },
  "long":  { "en": "...", "cs": "..." },
  "tags": ["food"],
  "weight": 1,
  "spawn": {
    "location": "zone.room",
    "count": 2,
    "respawnTicks": 500
  },
  "use": {
    "en": {
      "no_target": {
        "self":   "You drink the potion.",
        "others": "{actor} drinks the potion."
      },
      "to_target": {
        "self":   "You give the potion to {target}.",
        "others": "{actor} gives the potion to {target}."
      }
    },
    "cs": {
      "no_target": {
        "self":   "Vypiješ lektvar.",
        "others": "{actor} vypije lektvar."
      },
      "to_target": {
        "self":   "Podáš lektvar {target}.",
        "others": "{actor} podá lektvar {target}."
      }
    },
    "effect": {
      "type": "heal",
      "hp": 10,
      "mp": 0
    },
    "consumable": true
  }
}
```

**effect.type** — implemented types: `"heal"`, `"damage"`, `"apply_effect"`, `"toggle_light"`.  
- `heal` — `{ hp, mp }`.  
- `damage` — `{ formula: "1d4+INT/4" }`. Routes through `applyDamageWithFeedback`.  
- `apply_effect` — `{ effectId: "effect.id" }`. Applies a named active effect to the target.  
- `toggle_light` — flips `state.lit` on the item instance. Paired with `lightSource.toggle: true` and a `useExtinguish` block (see Lighting section in `SKILL.md`).  

See `content/effects/` for the active-effect catalog. Current effects: `bleeding`, `blinded`, `burning`, `candlelight`, `decay`, `fortify`, `keen_senses`, `magic_darkness`, `magic_light`, `magic_shadow`, `mana_burn`, `nightvision`, `poison`, `regen`, `regen_aura`, `shield`, `slow`, `thorns`, `ward_minor`.  
**consumable** — `true` removes the item on use; `false` keeps it (e.g. the stew pot).

---

## Item — weapon (wearable)

```json
{
  "id": "item.dagger",
  "name":    { "en": "a dagger", "cs": "dýka" },
  "nameAcc": { "en": "the dagger", "cs": "dýku" },
  "short": { "en": "...", "cs": "..." },
  "long":  { "en": "...", "cs": "..." },
  "tags": ["weapon"],
  "weight": 1,
  "spawn": {
    "location": "zone.room",
    "count": 1,
    "respawnTicks": 200
  },
  "wearable": {
    "slot": "weapon",
    "bonus": {
      "attack": 1
    }
  }
}
```

---

## Exchanges (on NPCs and fixture items)

Add an `exchanges` array to an NPC or a fixture item to give it tradeable / craftable interactions. See the SKILL "Exchanges (trade and craft)" section for full guidance and routing rules.

```json
"exchanges": [
  {
    "id": "baker.buy_pie",
    "flavor": "buy",
    "inputs":  [{ "gold": 1 }],
    "outputs": [{ "item": "item.pie" }]
  },
  {
    "id": "baker.sell_red_berries",
    "flavor": "sell",
    "inputs":  [{ "item": "item.red_berries", "count": 3 }],
    "outputs": [{ "gold": 1 }]
  },
  {
    "id": "cauldron.brew_mana",
    "flavor": "craft",
    "inputs":  [{ "item": "item.blue_flower", "count": 1 }],
    "outputs": [{ "item": "potion.mana" }],
    "xp": 2,
    "verb": {
      "en": { "to_target": {
        "self":   "you drop the blue flower into {target}. The water hisses and turns deep blue.",
        "others": "{actor} drops a blue flower into {target}."
      }},
      "cs": { "to_target": {
        "self":   "vhodíš modrý květ do {target}. Voda zasyčí a zmodrá.",
        "others": "{actor} vhazuje modrý květ do {target}."
      }}
    }
  }
]
```

**flavor** — `"buy"` (gold→item), `"sell"` (item→gold), `"craft"` (items→items).
**verb** — required for `craft`; optional for `buy`/`sell` (a generic broadcast is used when omitted).
**inputs / outputs** — entries are `{ item, count? }` or `{ gold }`; `count` defaults to 1.

---

## Effect

Active effects live in `content/effects/effect.*.json` and are referenced by id from spells (`apply_effect`), wearable passives (`wearable.effects`), and item-use effects.

```json
{
  "id": "effect.nightvision",
  "name": { "en": "Nightvision", "cs": "Noční vidění" },
  "kind": "buff",
  "icon": "🦉",
  "duration": 120,
  "perception": "nightvision",
  "exclusiveGroup": "vision_alter",
  "stack": "refresh"
}
```

**kind** — `"buff"` | `"debuff"`. Drives chip color and friendly/harmful filters.  
**icon** — single emoji shown on the effect chip.  
**duration** — ticks. `0` or omitted = permanent until removed.  
**stack** — `"refresh"` (re-applying resets the timer), `"stack"` (additive), or omitted (no re-apply).  
**exclusiveGroup** — string key; applying a new effect in the same group removes the existing one on the actor. Conventions: `"vision_alter"` (blinded, nightvision), `"ambient_light"` (magic light/darkness/shadow).  
**statMod** — optional `{ stat: delta, ... }` applied while active (e.g. `{ "perception": 4 }` on `effect.keen_senses`).  
**lightSource** — `{ "level": "dim" | "light" }`. The actor carrying this effect raises their room's light floor (e.g. `effect.candlelight`, `effect.magic_light`).  
**darknessSource** — `{ "level": "dark" | "dim" }`. The actor clamps their room's light *down* (e.g. `effect.magic_darkness`, `effect.magic_shadow`).  
**perception** — `"blind"` (force actor's perceived light to `dark`) or `"nightvision"` (raise actor's perceived floor to `dim`). Actor-side only — doesn't change the room's effective light.  

Tick-driven effect payloads (damage-over-time, regen-over-time, etc.) are handled by the engine when the effect def declares the relevant fields — read existing files like `effect.bleeding.json` or `effect.regen.json` for the canonical shape.
