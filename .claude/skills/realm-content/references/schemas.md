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
  "tags": ["outdoor", "zone_name"]
}
```

**exits** — omit directions that have no destination yet. Valid keys: `n s e w u d`.  
**tags** — include at least a zone tag and one of `indoor` / `outdoor`. Common extras: `safe`, `dark`, `forest`, `border`, `clearing`.

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

**effect.type** — `"heal"`, `"damage"`, and `"apply_effect"` are implemented. See `content/effects/` for the active-effect catalog (`bleeding`, `poison`, `regen`, `regen_aura`); reference these by id in `apply_effect`.  
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
