# Exchange unification — design

Unify NPC trading (`shop.sells` / `shop.buys`) and item production (`item.recipes`) under a single host-attached `exchanges` list. Player-facing verbs (`buy`, `sell`, `use`, `give`) and chip surfaces are preserved; the backend collapses to one schema and one runner.

## Goals

- One data shape covering gold-for-item, item-for-gold, and item(+gold)-for-item trades.
- Item-for-item production triggerable on NPCs, not only on fixtures.
- Inspect-panel chips for production fixtures (cauldron etc.), not only for shop NPCs.
- Smart `give`: when the target has a matching exchange, `give` runs it; otherwise fall back to the existing transfer.
- One-shot content rewrite: old `shop` / `recipes` keys deleted, no aliases.

## Non-goals

- Multi-output recipes in content (schema supports them; no entries use them).
- Inventory caps or weight checks.
- NPC stockpile simulation (sold items still vanish).
- Stacking `buy` / `craft` (only `sell` accepts `units > 1`).
- Quest gating, reputation, skill requirements, cooldowns, per-day limits.
- Localizing the `flavor` code constant.

## Schema

Each NPC and each item def may carry an `exchanges` array. Each entry:

```json
{
  "id": "smith.forge_sword",
  "flavor": "craft",
  "inputs":  [{ "item": "mine.iron_ore", "count": 5 }, { "gold": 20 }],
  "outputs": [{ "item": "forest.iron_sword" }],
  "verb":    { "en": { "to_target": { "self": "...", "others": "..." } },
               "cs": { "to_target": { "self": "...", "others": "..." } } },
  "xp": 5
}
```

Rules:

- `id` — required, globally unique. Used as chip key, error context, future quest hooks.
- `flavor` — `"buy" | "sell" | "craft"`. Drives command/chip routing, not mechanics.
- `inputs` / `outputs` — arrays of `{item, count?}` or `{gold}`. `count` defaults to `1`. Counts are positive integers; gold is a non-negative integer.
- `verb` — optional, verb-shaped def (same shape as item `use` and socials). Required-by-convention for `craft`; optional for `buy` / `sell` (default flavor strings cover them). When present on any flavor, it overrides defaults.
- `xp` — optional integer. Default `0` for `buy` / `sell`, `2` for `craft`.

Loader validation in `src/persist/contentLoader.js` (fail loudly at boot):

- Reject any file containing `shop` or `recipes` keys with a message naming file + key.
- `id` unique across the whole world; required.
- `flavor` must be in the allowed set.
- All `inputs[].item` and `outputs[].item` resolve to known item defs.
- `count` is a positive integer if present; `gold` is a non-negative integer if present.
- An entry must contain at least one input and at least one output.
- `verb` shape validated by the existing verb validator if present.

## Trigger map

Four typed surfaces plus one chip transport. All converge on `runExchange(actor, host, entry, { units = 1 })`.

### `buy <query>`
- Match: `flavor:"buy"` entries on any host in the room whose **outputs** name-match `<query>`.
- Errors: `shop.no_seller_here`, `shop.not_for_sale`, `shop.no_gold`.
- `units` always `1`.
- Rejects matches whose flavor is `craft` even if they involve gold.

### `sell <query>`
- Match: `flavor:"sell"` entries whose **inputs** name-match `<query>`.
- Stacking: today's `perUnit` becomes `inputs[0].count`. Compute `units = floor(have / inputs[0].count)`; if `units == 0` send `shop.need_units`. Run a single broadcast summarizing total consumed and total gold gained (matches today's shop output).
- Errors: `shop.no_buyer_here`, `shop.not_buying`, `shop.need_units`.
- Rejects matches whose flavor is `craft`.

### `use <input> on <target>`
- Match: `flavor:"craft"` entries on `<target>` whose `inputs` include an item matching `<input>`. `<target>` may be a fixture or an NPC.
- Errors: existing `use.cant`, `recipe.need_more`.
- `units` always `1`.

### `give <input> to <target>` — smart router
- Parse extension: parser accepts `give <N> <item> to <target>` (today only `<N> gold` is parsed; extend to items).
- If `target` is an NPC and has any exchange whose `inputs` include `<input>`:
  - Filter to entries whose **input counts match the offered amount**. `give ore` (1) vs. `give 5 ore` disambiguates between a `sell` entry (count 1) and a `craft` entry (count 5).
  - If exactly one matches → run it via `runExchange`.
  - If multiple match → send `exchange.ambiguous_give`, suggesting `buy` / `sell` / `use` or chip click.
  - If none match the offered count but some match the item → fall through to plain transfer (current behavior).
- Otherwise: existing transfer behavior (player target, NPC pocketing, etc.).

### `exchange <id>` — internal chip transport
- Not advertised in `help`, not localized.
- Look up entry by id across hosts in the room; run via `runExchange`. Used exclusively by the chip click handler so that multi-input crafts and any disambiguation are unambiguous.

## `runExchange` core

New module `src/game/exchange.js`. Public surface:

```js
runExchange(actor, host, entry, { units = 1 } = {})
findExchanges(host, { flavor?, inputItem?, outputItem? })
canAfford(actor, entry, units)
```

Flow:

1. **Affordability.** For each input: gold → `actor.gold >= input.gold * units`; item → `actor.inventory.filter(i => i.defId === input.item).length >= input.count * units`. On fail, send the flavor-appropriate existing string (`shop.no_gold`, `shop.need_units`, `recipe.need_more`).
2. **Consume inputs.** Deduct gold. Remove item instances FIFO from `actor.inventory` via `removeFromList`.
3. **Broadcast.** If `entry.verb` present → `runVerb({ actor, def: entry.verb, targetName: hostDisplay })`. Else use the existing `shop.bought_*` / `shop.sold_*` per-recipient broadcast. Param derivation for default-strings path: `price = inputs.find(x => x.gold).gold` for `buy`, `gold = outputs.find(x => x.gold).gold * units` and `count = inputs.find(x => x.item).count * units` for `sell`. Output is identical to today's shop messages.
4. **Produce outputs.** Add gold. For each item output, push `count` fresh instances via `makeItemInstance(def)` to `actor.inventory`.
5. **XP.** If `entry.xp > 0` → `awardXp(actor, entry.xp, entry.flavor)`.
6. **Persist + refresh.** `actor.dirty = true; sendStats(actor)`. No `describeRoomToAll` call (outputs land in actor inventory, not the room).

Single-threaded server: no concurrency guards needed between affordability check and consumption.

## Chip rendering

### Server (inspect message builder in `look.js`)

When a host has a non-empty `exchanges` array, attach to the inspect message:

```js
msg.exchanges = host.exchanges.map(e => ({
  id: e.id,
  flavor: e.flavor,
  inputs:  formatExchangeSide(e.inputs,  recipient.lang),
  outputs: formatExchangeSide(e.outputs, recipient.lang),
}));
```

`formatExchangeSide` returns display-ready entries: `{ kind: "item", id, name, count }` or `{ kind: "gold", amount }`. Builder is per-recipient so item names localize.

### Client (`client.js`, replacing the shop-sells/shop-buys blocks at ~469–496)

Group entries by flavor in a fixed row order. Render only non-empty rows:

1. **For sale** — `flavor:"buy"`. Label format `"<output> — <gold>g"`. Click → `buy <output-item-id>`. CSS class `chip-exchange chip-flavor-buy` (reuse existing `shop-sell` color palette).
2. **Wants to buy** — `flavor:"sell"`. Label format `"<input> — <gold>g"`. Click → `sell <input-item-id>`. CSS class `chip-exchange chip-flavor-sell` (reuse existing `shop-buy` palette).
3. **Can make** — `flavor:"craft"`. Label format `"<inputs> → <outputs>"` (e.g. `"5 iron ore + 20g → iron sword"`). Click → `exchange <id>` (chip transport, unambiguous for multi-input). New CSS class `chip-flavor-craft` with a cool blue/purple swatch.

Row labels come from `exchange.row.buy` / `.sell` / `.craft` system strings.

Hosts covered: shop NPCs (smith, baker, innkeeper, herbalist) and recipe fixtures (cauldron, future furnaces). Anything with a non-empty `exchanges`.

## Strings

Add to `content/strings/en.json` and `content/strings/cs.json`:

- `exchange.row.buy` — "For sale" / "Na prodej" (final wording chosen during implementation).
- `exchange.row.sell` — "Wants to buy" / "Vykupuje".
- `exchange.row.craft` — "Can make" / "Umí vyrobit".
- `exchange.ambiguous_give` — "Be more specific — try `buy`, `sell`, or click a chip." (similarly localized).

All other error strings are already present (`shop.*`, `recipe.*`, `produce.you_made`, `give.*`).

## Content migration

One-shot rewrite. Old keys deleted; loader rejects them.

NPC files (`shop` → `exchanges`):

- `content/npcs/village/village.smith.json` — 1 buy entry (rope/10g), 1 sell entry (ore/5g).
- `content/npcs/village/village.baker.json`.
- `content/npcs/village/village.innkeeper.json`.
- Any other shop NPC discovered during the rewrite (full sweep on `"shop"` key in `content/npcs/`).

Fixture files (`recipes` → `exchanges`):

- `content/items/fixtures/home.cauldron.json` — 2 craft entries (blue_flower → mana; red_berries × 3 → heal). Existing `verb` blocks carry over verbatim.

New content (sanity check, not strict migration): add at least one `craft`-on-NPC entry — e.g. smith forges a sword from N ore + M gold. Exact numbers chosen during implementation.

## Edge cases

- Smart `give` falling through to plain transfer is intentional. Friendly NPCs happily pocket gifts they have no exchange for; current behavior preserved.
- `give` to hostile NPCs: hostile NPCs don't carry `exchanges`, so the smart path never fires; transfer behavior unchanged.
- Multiple shop NPCs in one room: `findExchanges` iterates all hosts and returns the first match (matches today's shop search).
- Crafted item instances ignore `spawn.count` caps (matches today's recipe behavior; documented as future work in CLAUDE.md).
- `describeRoomToAll` is not called after an exchange (outputs land in actor inventory). Revisit if a future exchange ever produces room-resident items.

## Files touched

New:

- `src/game/exchange.js` — `runExchange`, `findExchanges`, `canAfford`.
- `src/game/actions/exchangeChip.js` (or registered inline in `commands.js`) — internal `exchange <id>` handler.

Modified:

- `src/game/actions/buy.js`, `sell.js`, `use.js`, `give.js` — thin parsers delegating to `runExchange` / `findExchanges`.
- `src/game/commands.js` — register internal `exchange` command.
- `src/game/actions/look.js` (or wherever inspect messages are built) — emit `msg.exchanges`.
- `src/persist/contentLoader.js` — drop `shop` / `recipes` validators; add `exchanges` validator.
- `client/client.js` — replace shop chip blocks with grouped exchange chips.
- `client/style.css` — add `chip-flavor-craft` swatch.
- `content/strings/en.json`, `content/strings/cs.json` — add row + ambiguous strings.
- All NPC and fixture files listed under "Content migration".
