# Exchange Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify NPC trading (`shop`) and item production (`recipes`) under a single host-attached `exchanges` schema with one runner, while preserving the existing `buy` / `sell` / `use` / `give` verbs and inspect-panel chips.

**Architecture:** New module `src/game/exchange.js` exposes `runExchange`, `findExchanges`, `canAfford`. Each entry has `flavor: "buy" | "sell" | "craft"` driving command/chip routing. Existing action files become thin parsers delegating to `runExchange`. `give` becomes a smart router that triggers a matching exchange when one exists. Content is migrated one-shot; loader hard-rejects old `shop` / `recipes` keys at boot.

**Tech Stack:** Node.js 20+, ES modules, plain DOM client, `ws`. No new dependencies. No test framework — verification is "boot + exercise via wscat or browser."

**Spec:** [docs/superpowers/specs/2026-05-06-exchange-unification-design.md](../specs/2026-05-06-exchange-unification-design.md)

**Verification convention:** "Boot the server" means `node server.js` and watch for clean startup with no validation errors. "Exercise via client" means open the client at `http://localhost:8080`, log in, walk to the relevant room, run the command. When a task only changes data or validation, "boot + clean startup" is sufficient.

---

## Task 1: Add new system strings (English and Czech)

**Files:**
- Modify: `content/strings/en.json`
- Modify: `content/strings/cs.json`

- [ ] **Step 1: Read current `en.json` to find appropriate insertion point**

Find the existing `shop.*` block. New keys belong adjacent to it.

- [ ] **Step 2: Add the new keys to `content/strings/en.json`**

Add these keys (insert next to existing `shop.*` keys, preserving JSON shape):

```json
"exchange.row.buy": "For sale",
"exchange.row.sell": "Wants to buy",
"exchange.row.craft": "Can make",
"exchange.ambiguous_give": "Be more specific — try `buy`, `sell`, `use`, or click a chip."
```

- [ ] **Step 3: Add the same keys to `content/strings/cs.json`**

```json
"exchange.row.buy": "Na prodej",
"exchange.row.sell": "Vykupuje",
"exchange.row.craft": "Umí vyrobit",
"exchange.ambiguous_give": "Buď konkrétnější — zkus `buy`, `sell`, `use` nebo klikni na čip."
```

- [ ] **Step 4: Boot server to confirm strings load**

Run: `node server.js`
Expected: Server starts cleanly, no warnings about missing keys.
Stop the server (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add content/strings/en.json content/strings/cs.json
git commit -m "Add exchange.* system strings (en/cs)"
```

---

## Task 2: Add `exchanges` schema validator (additive, alongside existing shop/recipes)

We accept the new `exchanges` array now, but keep the old `shop` / `recipes` validators in place so the world still boots. The hard switch happens in Task 11.

**Files:**
- Modify: `src/persist/contentLoader.js`

- [ ] **Step 1: Add the `exchanges` validator helper near the existing `validateNpcShops`**

After the `validateNpcShops` export (around line 145), add:

```js
const ALLOWED_FLAVORS = new Set(['buy', 'sell', 'craft']);

function validateExchangeSide(side, ctx, label) {
  checkArray(side, ctx, label);
  check(side.length >= 1, ctx, `${label} must contain at least one entry`);
  side.forEach((entry, i) => {
    const ectx = `${label}[${i}]`;
    checkObject(entry, ctx, ectx);
    const hasItem = typeof entry.item === 'string';
    const hasGold = typeof entry.gold === 'number';
    check(hasItem !== hasGold, ctx,
      `${ectx} must have exactly one of 'item' or 'gold'`);
    if (hasGold) {
      check(Number.isInteger(entry.gold) && entry.gold >= 0, ctx,
        `${ectx}.gold must be a non-negative integer`);
    }
    if (hasItem && entry.count != null) {
      check(Number.isInteger(entry.count) && entry.count >= 1, ctx,
        `${ectx}.count must be a positive integer`);
    }
  });
}

export function validateExchanges(host, hostCtx, items) {
  if (host.exchanges == null) return;
  checkArray(host.exchanges, hostCtx, 'exchanges');
  host.exchanges.forEach((entry, i) => {
    const ctx = `${hostCtx} exchanges[${i}]`;
    checkObject(entry, hostCtx, `exchanges[${i}]`);
    check(typeof entry.id === 'string' && entry.id.length > 0, hostCtx,
      `exchanges[${i}].id must be a non-empty string`);
    checkEnum(entry.flavor, ALLOWED_FLAVORS, hostCtx, `exchanges[${i}].flavor`);
    validateExchangeSide(entry.inputs, hostCtx, `exchanges[${i}].inputs`);
    validateExchangeSide(entry.outputs, hostCtx, `exchanges[${i}].outputs`);
    for (const side of ['inputs', 'outputs']) {
      for (const e of entry[side]) {
        if (e.item) check(items.has(e.item), ctx,
          `${side} references unknown item '${e.item}'`);
      }
    }
    if (entry.verb != null) checkObject(entry.verb, ctx, 'verb');
    if (entry.xp != null) {
      check(Number.isInteger(entry.xp) && entry.xp >= 0, ctx,
        'xp must be a non-negative integer');
    }
  });
}
```

- [ ] **Step 2: Wire the validator into NPC and item validation passes**

`validateNpcShops` runs after items are loaded. Add an `exchanges` cross-check next to it. Insert this new export immediately after `validateNpcShops`:

```js
export function validateAllExchanges(npcs, items) {
  const seenIds = new Map(); // id -> "host kind/host id"
  const checkHost = (host, kind) => {
    const ctx = `${kind} '${host.id}'`;
    validateExchanges(host, ctx, items);
    for (const entry of host.exchanges ?? []) {
      const owner = `${kind}/${host.id}`;
      const prior = seenIds.get(entry.id);
      if (prior) {
        throw new Error(`duplicate exchange id '${entry.id}' (in ${owner} and ${prior})`);
      }
      seenIds.set(entry.id, owner);
    }
  };
  for (const npc of npcs.values()) checkHost(npc, 'npc');
  for (const item of items.values()) checkHost(item, 'item');
}
```

- [ ] **Step 3: Call the new validator from the boot path**

Open `server.js`, find where `validateNpcShops` is called, and add a call to `validateAllExchanges` right after it.

```bash
grep -n "validateNpcShops" server.js
```

Add the import in `server.js`:

```js
import { ..., validateAllExchanges } from './src/persist/contentLoader.js';
```

After the `validateNpcShops(npcs, items)` call, add:

```js
validateAllExchanges(npcs, items);
```

- [ ] **Step 4: Boot to confirm no regressions**

Run: `node server.js`
Expected: Clean startup. (No content has `exchanges` yet, so the validator runs but finds nothing.)

- [ ] **Step 5: Commit**

```bash
git add src/persist/contentLoader.js server.js
git commit -m "Add exchanges schema validator (additive)"
```

---

## Task 3: Build `src/game/exchange.js` core

The runner; not yet wired to any action.

**Files:**
- Create: `src/game/exchange.js`

- [ ] **Step 1: Create the file with helpers and the public surface**

Path: `src/game/exchange.js`

```js
import { actorsInRoom, itemsInRoom, broadcastToRoom, world } from './world.js';
import { makeItemInstance, removeFromList } from './items.js';
import { runVerb } from './verbs.js';
import { sendStats } from './messages.js';
import { sourceForActor } from './sources.js';
import { awardXp } from './xp.js';
import { s, t } from '../i18n.js';

export function hostsInRoom(roomId) {
  const out = [];
  for (const a of actorsInRoom(roomId)) {
    if (a.kind === 'npc' && Array.isArray(a.exchanges) && a.exchanges.length) out.push(a);
  }
  for (const inst of itemsInRoom(roomId)) {
    if (Array.isArray(inst.def.exchanges) && inst.def.exchanges.length) out.push(inst);
  }
  return out;
}

function getExchanges(host) {
  if (host.kind === 'npc') return host.exchanges ?? [];
  return host.def?.exchanges ?? [];
}

export function findExchangeById(roomId, id) {
  for (const host of hostsInRoom(roomId)) {
    for (const entry of getExchanges(host)) {
      if (entry.id === id) return { host, entry };
    }
  }
  return null;
}

export function findExchanges(roomId, { flavor, inputItem, outputItem } = {}) {
  const out = [];
  for (const host of hostsInRoom(roomId)) {
    for (const entry of getExchanges(host)) {
      if (flavor && entry.flavor !== flavor) continue;
      if (inputItem && !entry.inputs.some(x => x.item === inputItem)) continue;
      if (outputItem && !entry.outputs.some(x => x.item === outputItem)) continue;
      out.push({ host, entry });
    }
  }
  return out;
}

function inventoryCount(actor, itemId) {
  return actor.inventory.filter(i => i.defId === itemId).length;
}

export function canAfford(actor, entry, units = 1) {
  for (const inp of entry.inputs) {
    if (inp.gold != null) {
      if ((actor.gold ?? 0) < inp.gold * units) return { ok: false, missing: { gold: inp.gold * units - (actor.gold ?? 0) } };
    } else {
      const need = (inp.count ?? 1) * units;
      const have = inventoryCount(actor, inp.item);
      if (have < need) return { ok: false, missing: { item: inp.item, need, have } };
    }
  }
  return { ok: true };
}

function hostDisplayName(host, lang) {
  if (host.kind === 'npc') return t(host.nameAcc ?? host.name, lang);
  return t(host.def.nameAcc ?? host.def.name, lang);
}

function consumeInputs(actor, entry, units) {
  for (const inp of entry.inputs) {
    if (inp.gold != null) {
      actor.gold = (actor.gold ?? 0) - inp.gold * units;
    } else {
      const need = (inp.count ?? 1) * units;
      const matches = actor.inventory.filter(i => i.defId === inp.item).slice(0, need);
      for (const inst of matches) removeFromList(actor.inventory, inst);
    }
  }
}

function produceOutputs(actor, entry, units) {
  const produced = [];
  for (const out of entry.outputs) {
    if (out.gold != null) {
      actor.gold = (actor.gold ?? 0) + out.gold * units;
    } else {
      const def = world.itemDefs.get(out.item);
      const total = (out.count ?? 1) * units;
      for (let i = 0; i < total; i++) actor.inventory.push(makeItemInstance(def));
      produced.push({ def, count: total });
    }
  }
  return produced;
}

function broadcastDefault(actor, host, entry, units) {
  const flavor = entry.flavor;
  const itemInput = entry.inputs.find(x => x.item);
  const goldInput = entry.inputs.find(x => x.gold != null);
  const itemOutput = entry.outputs.find(x => x.item);
  const goldOutput = entry.outputs.find(x => x.gold != null);

  if (flavor === 'buy') {
    const def = world.itemDefs.get(itemOutput.item);
    const price = goldInput.gold * units;
    broadcastToRoom(actor.location, (recipient) => {
      const itemName = t(def.nameAcc ?? def.name, recipient.lang);
      const npcName = hostDisplayName(host, recipient.lang);
      if (recipient === actor) {
        return { kind: 'system', tone: 'good', text: s('shop.bought_self', recipient.lang, { item: itemName, price, npc: npcName }) };
      }
      return {
        kind: 'emote',
        source: sourceForActor(actor, recipient),
        text: s('shop.bought_others', recipient.lang, { actor: actor.name, item: itemName, npc: npcName }),
      };
    });
    return;
  }

  if (flavor === 'sell') {
    const def = world.itemDefs.get(itemInput.item);
    const totalConsume = (itemInput.count ?? 1) * units;
    const totalGold = goldOutput.gold * units;
    broadcastToRoom(actor.location, (recipient) => {
      const itemName = t(def.nameAcc ?? def.name, recipient.lang);
      const npcName = hostDisplayName(host, recipient.lang);
      if (recipient === actor) {
        return { kind: 'system', tone: 'good', text: s('shop.sold_self', recipient.lang, { count: totalConsume, item: itemName, gold: totalGold, npc: npcName }) };
      }
      return {
        kind: 'emote',
        source: sourceForActor(actor, recipient),
        text: s('shop.sold_others', recipient.lang, { actor: actor.name, count: totalConsume, item: itemName, npc: npcName }),
      };
    });
    return;
  }

  // craft with no verb: rely on produce.you_made (sent as a self-system below)
}

export function runExchange(actor, host, entry, { units = 1 } = {}) {
  const aff = canAfford(actor, entry, units);
  if (!aff.ok) {
    if (aff.missing.gold != null) {
      actor.session.send({ kind: 'error', text: s('shop.no_gold', actor.lang, { price: aff.missing.gold + (actor.gold ?? 0), gold: actor.gold ?? 0 }) });
    } else {
      const def = world.itemDefs.get(aff.missing.item);
      if (entry.flavor === 'sell') {
        actor.session.send({ kind: 'error', text: s('shop.need_units', actor.lang, { item: t(def.name, actor.lang), required: aff.missing.need, have: aff.missing.have }) });
      } else {
        actor.session.send({ kind: 'error', text: s('recipe.need_more', actor.lang, { item: t(def.name, actor.lang), required: aff.missing.need, have: aff.missing.have }) });
      }
    }
    return false;
  }

  consumeInputs(actor, entry, units);

  if (entry.verb) {
    runVerb({ actor, def: entry.verb, targetName: hostDisplayName(host, actor.lang) });
  } else {
    broadcastDefault(actor, host, entry, units);
  }

  const produced = produceOutputs(actor, entry, units);

  if (entry.flavor === 'craft' && produced.length > 0) {
    const first = produced[0];
    actor.session.send({ kind: 'system', tone: 'good', text: s('produce.you_made', actor.lang, { item: t(first.def.name, actor.lang) }) });
  }

  if (entry.xp && entry.xp > 0) awardXp(actor, entry.xp, entry.flavor);

  actor.dirty = true;
  sendStats(actor);
  return true;
}
```

- [ ] **Step 2: Boot to confirm no syntax errors**

Run: `node server.js`
Expected: Clean startup. The module is imported by nothing yet but should still parse.

- [ ] **Step 3: Commit**

```bash
git add src/game/exchange.js
git commit -m "Add exchange.js core (runExchange, findExchanges, canAfford)"
```

---

## Task 4: Migrate content — smith, baker, innkeeper, cauldron

Add `exchanges` arrays alongside the existing `shop` / `recipes`. Both shapes coexist until Task 11 flips the switch.

**Files:**
- Modify: `content/npcs/village/village.smith.json`
- Modify: `content/npcs/village/village.baker.json`
- Modify: `content/npcs/village/village.innkeeper.json`
- Modify: `content/items/fixtures/home.cauldron.json`

- [ ] **Step 1: Smith — add `exchanges` (keep `shop` for now)**

In `content/npcs/village/village.smith.json`, alongside the existing `"shop": {...}` block, add:

```json
"exchanges": [
  {
    "id": "smith.buy_rope",
    "flavor": "buy",
    "inputs":  [{ "gold": 10 }],
    "outputs": [{ "item": "item.long_rope" }]
  },
  {
    "id": "smith.sell_ore",
    "flavor": "sell",
    "inputs":  [{ "item": "mine.iron_ore", "count": 1 }],
    "outputs": [{ "gold": 5 }]
  }
]
```

- [ ] **Step 2: Baker — add `exchanges`**

In `content/npcs/village/village.baker.json`:

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
    "inputs":  [{ "item": "forest.red_berries", "count": 3 }],
    "outputs": [{ "gold": 1 }]
  }
]
```

- [ ] **Step 3: Innkeeper — add `exchanges`**

In `content/npcs/village/village.innkeeper.json`:

```json
"exchanges": [
  {
    "id": "innkeeper.buy_beer",
    "flavor": "buy",
    "inputs":  [{ "gold": 3 }],
    "outputs": [{ "item": "potion.beer" }]
  },
  {
    "id": "innkeeper.sell_rat_tail",
    "flavor": "sell",
    "inputs":  [{ "item": "item.rat_tail", "count": 1 }],
    "outputs": [{ "gold": 1 }]
  }
]
```

- [ ] **Step 4: Cauldron — add `exchanges` (keep `recipes` for now)**

In `content/items/fixtures/home.cauldron.json`, alongside the existing `"recipes": {...}` block, add:

```json
"exchanges": [
  {
    "id": "cauldron.brew_mana",
    "flavor": "craft",
    "inputs":  [{ "item": "forest.blue_flower", "count": 1 }],
    "outputs": [{ "item": "potion.mana" }],
    "xp": 2,
    "verb": {
      "en": {
        "to_target": {
          "self": "you drop the blue flower into {target}. The water hisses, turns deep blue, and a small mana potion forms.",
          "others": "{actor} drops a blue flower into {target}. The water hisses and turns deep blue."
        }
      },
      "cs": {
        "to_target": {
          "self": "vhodíš modrý květ do {target}. Voda zasyčí, zmodrá a vznikne malý lektvar many.",
          "others": "{actor} vhazuje modrý květ do {target}. Voda zasyčí a zmodrá."
        }
      }
    }
  },
  {
    "id": "cauldron.brew_heal",
    "flavor": "craft",
    "inputs":  [{ "item": "forest.red_berries", "count": 3 }],
    "outputs": [{ "item": "potion.heal" }],
    "xp": 2,
    "verb": {
      "en": {
        "to_target": {
          "self": "you drop three handfuls of red berries into {target}. The water turns rose-pink and a small healing potion forms.",
          "others": "{actor} drops three handfuls of red berries into {target}. The water turns rose-pink."
        }
      },
      "cs": {
        "to_target": {
          "self": "vhodíš tři hrsti červených bobulí do {target}. Voda zrůžoví a vznikne malý léčivý lektvar.",
          "others": "{actor} vhazuje tři hrsti červených bobulí do {target}. Voda zrůžoví."
        }
      }
    }
  }
]
```

- [ ] **Step 5: Boot to confirm validators accept both shapes**

Run: `node server.js`
Expected: Clean startup. Validator checks `exchanges` ids unique and items resolvable; old `shop` and `recipes` validators still run alongside.

- [ ] **Step 6: Commit**

```bash
git add content/npcs/village/village.smith.json content/npcs/village/village.baker.json content/npcs/village/village.innkeeper.json content/items/fixtures/home.cauldron.json
git commit -m "Migrate smith/baker/innkeeper/cauldron to exchanges schema"
```

---

## Task 5: Rewrite `buy` and `sell` to use `runExchange`

Replace the body of `buy.js` and `sell.js`. Keep the same name-matching logic for the typed query, but route to `runExchange` once a matching entry is found.

**Files:**
- Modify: `src/game/actions/buy.js`
- Modify: `src/game/actions/sell.js`

- [ ] **Step 1: Replace `src/game/actions/buy.js` entirely**

```js
import { s, t, nameVariants } from '../../i18n.js';
import { world } from '../world.js';
import { findExchanges, runExchange } from '../exchange.js';

function nameMatches(def, q) {
  const variants = [
    ...nameVariants(def.name),
    ...nameVariants(def.nameAcc),
    def.id.toLowerCase(),
  ];
  if (variants.some(v => v === q)) return 'exact';
  if (variants.some(v => v.includes(q))) return 'substring';
  for (const v of variants) {
    if (v.split(/\s+/).some(word => word === q)) return 'word';
  }
  return null;
}

export default function buy(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('buy.usage', actor.lang) });
    return;
  }
  const query = args.join(' ').toLowerCase();
  const candidates = findExchanges(actor.location, { flavor: 'buy' });
  if (candidates.length === 0) {
    actor.session.send({ kind: 'error', text: s('shop.no_seller_here', actor.lang) });
    return;
  }
  let exact = null, sub = null, word = null;
  for (const c of candidates) {
    const out = c.entry.outputs.find(x => x.item);
    if (!out) continue;
    const def = world.itemDefs.get(out.item);
    if (!def) continue;
    const m = nameMatches(def, query);
    if (m === 'exact' && !exact) exact = c;
    else if (m === 'substring' && !sub) sub = c;
    else if (m === 'word' && !word) word = c;
  }
  const match = exact ?? sub ?? word;
  if (!match) {
    actor.session.send({ kind: 'error', text: s('shop.not_for_sale', actor.lang, { query }) });
    return;
  }
  runExchange(actor, match.host, match.entry, { units: 1 });
}
```

- [ ] **Step 2: Replace `src/game/actions/sell.js` entirely**

```js
import { s, t, nameVariants } from '../../i18n.js';
import { world } from '../world.js';
import { findExchanges, runExchange } from '../exchange.js';

function nameMatches(def, q) {
  const variants = [
    ...nameVariants(def.name),
    ...nameVariants(def.nameAcc),
    def.id.toLowerCase(),
  ];
  if (variants.some(v => v === q)) return 'exact';
  if (variants.some(v => v.includes(q))) return 'substring';
  for (const v of variants) {
    if (v.split(/\s+/).some(word => word === q)) return 'word';
  }
  return null;
}

export default function sell(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('sell.usage', actor.lang) });
    return;
  }
  const query = args.join(' ').toLowerCase();
  const candidates = findExchanges(actor.location, { flavor: 'sell' });
  if (candidates.length === 0) {
    actor.session.send({ kind: 'error', text: s('shop.no_buyer_here', actor.lang) });
    return;
  }
  let exact = null, sub = null, word = null;
  for (const c of candidates) {
    const inp = c.entry.inputs.find(x => x.item);
    if (!inp) continue;
    const def = world.itemDefs.get(inp.item);
    if (!def) continue;
    const m = nameMatches(def, query);
    if (m === 'exact' && !exact) exact = c;
    else if (m === 'substring' && !sub) sub = c;
    else if (m === 'word' && !word) word = c;
  }
  const match = exact ?? sub ?? word;
  if (!match) {
    actor.session.send({ kind: 'error', text: s('shop.not_buying', actor.lang, { query }) });
    return;
  }
  const inp = match.entry.inputs.find(x => x.item);
  const perUnit = inp.count ?? 1;
  const have = actor.inventory.filter(i => i.defId === inp.item).length;
  const units = Math.floor(have / perUnit);
  if (units === 0) {
    const def = world.itemDefs.get(inp.item);
    actor.session.send({
      kind: 'error',
      text: s('shop.need_units', actor.lang, { item: t(def.name, actor.lang), required: perUnit, have }),
    });
    return;
  }
  runExchange(actor, match.host, match.entry, { units });
}
```

- [ ] **Step 3: Boot and exercise**

Run: `node server.js`
Open the client, log in, walk to the village smith.
- Run `buy rope` (smith should sell rope for 10g — emote + gold deduction).
- Run `sell ore` after giving yourself ore via admin or by going to the mine. Confirm gold added.

Expected behavior identical to before this change.

- [ ] **Step 4: Commit**

```bash
git add src/game/actions/buy.js src/game/actions/sell.js
git commit -m "Route buy/sell through runExchange"
```

---

## Task 6: Rewrite `use ... on` recipe path to use `runExchange`

`use.js` handles three sub-cases today: unlock (item-on-item key), recipe (item-on-fixture), and direct effect. Only the recipe path changes — it now resolves to a craft exchange on the target item.

**Files:**
- Modify: `src/game/actions/use.js`

- [ ] **Step 1: Find and replace the recipe-resolution + run path**

In `use.js`, the function `resolveInteraction` returns `{kind:'recipe', spec}` when source item appears in `targetInst.def.recipes`. Replace this branch (and the `runInteraction` recipe branch) with an exchange lookup against the *target item def*.

Replace `resolveInteraction` (around lines 17-26) with:

```js
function resolveInteraction(sourceInst, targetInst) {
  const tdef = targetInst.def;
  if (tdef.unlocks && tdef.unlocks.key === sourceInst.defId) {
    return { kind: 'unlock', spec: tdef.unlocks };
  }
  const exchanges = tdef.exchanges ?? [];
  const match = exchanges.find(e =>
    e.flavor === 'craft' &&
    e.inputs.some(x => x.item === sourceInst.defId)
  );
  if (match) return { kind: 'craft', entry: match };
  return null;
}
```

- [ ] **Step 2: Replace `runInteraction` body to handle the `craft` kind via `runExchange`**

Replace `runInteraction` (around lines 28-89) with:

```js
function runInteraction(actor, sourceInst, targetInst, interaction) {
  const lang = actor.lang;
  if (interaction.kind === 'unlock') {
    const spec = interaction.spec;
    runVerb({ actor, def: spec.verb, targetName: targetInst.def.nameAcc ?? targetInst.def.name });
    applyEffect({ type: 'unlock', exit: spec.exit }, { actor });
    actor.session.send({
      kind: 'system',
      tone: 'good',
      text: s('unlock.success', lang, { target: t(targetInst.def.name, lang) }),
    });
    if (spec.consume) {
      removeFromList(actor.inventory, sourceInst);
      actor.dirty = true;
      sendStats(actor);
    }
    describeRoomToAll(actor.location);
    awardXp(actor, spec.xp ?? 2, 'unlock');
    return;
  }
  if (interaction.kind === 'craft') {
    runExchange(actor, targetInst, interaction.entry, { units: 1 });
    return;
  }
}
```

- [ ] **Step 3: Update the imports at the top of `use.js`**

Add `runExchange` import:

```js
import { runExchange } from '../exchange.js';
```

Verify these imports are still needed after the rewrite: `awardXp` (still used for unlock), `sendStats` (still used for unlock consume), `applyEffect` (still used for unlock and direct-effect path), `runVerb` (still used elsewhere in the file). Leave them in place. The `findItemInList` and other imports stay.

- [ ] **Step 4: Boot and exercise**

Run: `node server.js`
- Walk to the home shack, type `use blue flower on cauldron`. Should consume the flower and produce a mana potion (now via exchange).
- Acquire 3 red berries, type `use red berries on cauldron`. Should consume 3 and produce a heal potion.
- Type `use copper key on trap door` (or similar unlock target) to confirm unlock path still works.

Expected: identical text and behavior to before.

- [ ] **Step 5: Commit**

```bash
git add src/game/actions/use.js
git commit -m "Route 'use X on Y' recipe path through runExchange"
```

---

## Task 7: Smart `give` routing

`give X to NPC` runs a matching exchange when one exists; otherwise falls back to existing transfer. Also extend the parser to accept `give <N> <item> to <target>`.

**Files:**
- Modify: `src/game/actions/give.js`

- [ ] **Step 1: Read the current `give.js` to confirm structure**

Already reviewed during design. Will replace the file body to add count parsing and exchange routing.

- [ ] **Step 2: Replace `src/game/actions/give.js`**

```js
import { findInRoom, broadcastToRoom } from '../world.js';
import { findItemInList, transferItem, splitOnKeyword } from '../items.js';
import { s, t } from '../../i18n.js';
import { sendStats } from '../messages.js';
import { sourceForActor } from '../sources.js';
import { runExchange } from '../exchange.js';

function parseGiveArgs(args) {
  const split = splitOnKeyword(args, 'to');
  if (split) return { itemQuery: split.before, targetQuery: split.after };
  if (args.length >= 2) {
    return { itemQuery: args.slice(0, -1).join(' '), targetQuery: args[args.length - 1] };
  }
  return null;
}

const GOLD_WORDS = new Set(['gold', 'coin', 'coins', 'zlato', 'zlaťák', 'zlaťáky', 'mince']);

function parseGoldGive(itemQuery) {
  const parts = itemQuery.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const a = parts[0].toLowerCase();
  const b = parts[1].toLowerCase();
  let amountStr = null;
  if (/^\d+$/.test(a) && GOLD_WORDS.has(b)) amountStr = a;
  else if (GOLD_WORDS.has(a) && /^\d+$/.test(b)) amountStr = b;
  if (!amountStr) return null;
  const amount = parseInt(amountStr, 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount };
}

function parseCountedItemGive(itemQuery) {
  const parts = itemQuery.trim().split(/\s+/);
  if (parts.length < 2 || !/^\d+$/.test(parts[0])) return null;
  const count = parseInt(parts[0], 10);
  if (!Number.isFinite(count) || count <= 0) return null;
  return { count, itemQuery: parts.slice(1).join(' ') };
}

function findExchangeForGoldGive(target, amount) {
  const exchanges = target.exchanges ?? [];
  const matches = exchanges.filter(e =>
    e.inputs.length === 1 &&
    e.inputs[0].gold === amount
  );
  return matches;
}

function findExchangeForItemGive(target, itemDefId, count) {
  const exchanges = target.exchanges ?? [];
  return exchanges.filter(e => {
    const inp = e.inputs.find(x => x.item === itemDefId);
    if (!inp) return false;
    const need = inp.count ?? 1;
    return need === count;
  });
}

export default function give(actor, args) {
  if (!args || args.length < 2) {
    actor.session.send({ kind: 'error', text: s('give.usage', actor.lang) });
    return;
  }
  const parsed = parseGiveArgs(args);
  if (!parsed) {
    actor.session.send({ kind: 'error', text: s('give.usage', actor.lang) });
    return;
  }
  const { itemQuery, targetQuery } = parsed;

  const goldGive = parseGoldGive(itemQuery);
  if (goldGive) {
    const target = findInRoom(actor.location, targetQuery);
    if (!target) {
      actor.session.send({ kind: 'error', text: s('error.no_such_target', actor.lang, { query: targetQuery }) });
      return;
    }
    if (target === actor) {
      actor.session.send({ kind: 'error', text: s('give.to_self', actor.lang) });
      return;
    }
    if (target.kind === 'npc' && Array.isArray(target.exchanges)) {
      const matches = findExchangeForGoldGive(target, goldGive.amount);
      if (matches.length === 1) {
        runExchange(actor, target, matches[0], { units: 1 });
        return;
      }
      if (matches.length > 1) {
        actor.session.send({ kind: 'error', text: s('exchange.ambiguous_give', actor.lang) });
        return;
      }
    }
    if (target.kind !== 'player') {
      actor.session.send({ kind: 'error', text: s('give.gold.target_invalid', actor.lang) });
      return;
    }
    if ((actor.gold ?? 0) < goldGive.amount) {
      actor.session.send({ kind: 'error', text: s('give.gold.not_enough', actor.lang, { amount: goldGive.amount, gold: actor.gold ?? 0 }) });
      return;
    }
    actor.gold = (actor.gold ?? 0) - goldGive.amount;
    target.gold = (target.gold ?? 0) + goldGive.amount;
    actor.dirty = true;
    target.dirty = true;
    broadcastToRoom(actor.location, (recipient) => {
      if (recipient === actor) {
        return { kind: 'system', text: s('give.gold.self', recipient.lang, { amount: goldGive.amount, target: target.name }) };
      }
      if (recipient === target) {
        return { kind: 'system', tone: 'good', text: s('give.gold.recipient', recipient.lang, { amount: goldGive.amount, actor: actor.name }) };
      }
      return {
        kind: 'emote',
        source: sourceForActor(actor, recipient),
        text: s('give.gold.others', recipient.lang, { actor: actor.name, amount: goldGive.amount, target: target.name }),
      };
    });
    sendStats(actor);
    sendStats(target);
    return;
  }

  let count = 1;
  let resolvedItemQuery = itemQuery;
  const counted = parseCountedItemGive(itemQuery);
  if (counted) {
    count = counted.count;
    resolvedItemQuery = counted.itemQuery;
  }

  const inst = findItemInList(actor.inventory, resolvedItemQuery);
  if (!inst) {
    actor.session.send({ kind: 'error', text: s('error.no_such_item_inv', actor.lang, { query: resolvedItemQuery }) });
    return;
  }

  const target = findInRoom(actor.location, targetQuery);
  if (!target) {
    actor.session.send({ kind: 'error', text: s('error.no_such_target', actor.lang, { query: targetQuery }) });
    return;
  }
  if (target === actor) {
    actor.session.send({ kind: 'error', text: s('give.to_self', actor.lang) });
    return;
  }

  if (target.kind === 'npc' && Array.isArray(target.exchanges)) {
    const matches = findExchangeForItemGive(target, inst.defId, count);
    if (matches.length === 1) {
      runExchange(actor, target, matches[0], { units: 1 });
      return;
    }
    if (matches.length > 1) {
      actor.session.send({ kind: 'error', text: s('exchange.ambiguous_give', actor.lang) });
      return;
    }
  }

  if (count !== 1) {
    actor.session.send({ kind: 'error', text: s('exchange.ambiguous_give', actor.lang) });
    return;
  }

  transferItem(actor.inventory, target.inventory, inst);
  actor.dirty = true;
  if (target.kind === 'player') target.dirty = true;

  broadcastToRoom(actor.location, (recipient) => {
    const item = t(inst.def.nameAcc ?? inst.def.name, recipient.lang);
    const targetName = target.kind === 'npc'
      ? t(target.nameAcc ?? target.name, recipient.lang)
      : target.name;
    if (recipient === actor) {
      return { kind: 'system', text: s('give.self', recipient.lang, { item, target: targetName }) };
    }
    if (recipient === target) {
      return { kind: 'system', text: s('give.recipient', recipient.lang, { item, actor: actor.name }) };
    }
    return {
      kind: 'emote',
      source: sourceForActor(actor, recipient),
      text: s('give.others', recipient.lang, { actor: actor.name, item, target: targetName }),
    };
  });

  sendStats(actor);
  if (target.kind === 'player') sendStats(target);
}
```

- [ ] **Step 3: Boot and exercise**

Run: `node server.js`
At smith:
- `give ore to smith` — should trigger the `sell` exchange (5 gold), identical to `sell ore`.
- `give 10 gold to smith` — should trigger `buy_rope` exchange (you receive a rope).
- `give rat tail to smith` — should fall back to plain transfer (smith pockets it).
At baker:
- `give 3 red berries to baker` — should trigger sell-flavor exchange (1 gold).

Expected: smart routing works; non-matching gifts still go through.

- [ ] **Step 4: Commit**

```bash
git add src/game/actions/give.js
git commit -m "Smart give routing through matching exchanges"
```

---

## Task 8: Internal `exchange <id>` command for chip transport

Chips drive crafts unambiguously by entry id, sidestepping query parsing.

**Files:**
- Create: `src/game/actions/exchangeChip.js`
- Modify: `src/game/commands.js`

- [ ] **Step 1: Create `src/game/actions/exchangeChip.js`**

```js
import { s } from '../../i18n.js';
import { findExchangeById, runExchange } from '../exchange.js';

export default function exchangeChip(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('use.cant', actor.lang) });
    return;
  }
  const id = args[0];
  const found = findExchangeById(actor.location, id);
  if (!found) {
    actor.session.send({ kind: 'error', text: s('use.cant', actor.lang) });
    return;
  }
  runExchange(actor, found.host, found.entry, { units: 1 });
}
```

- [ ] **Step 2: Register in `src/game/commands.js`**

Look for the existing command registry and add:

```js
import exchangeChip from './actions/exchangeChip.js';
// ...
// in the registry:
'exchange': exchangeChip,
```

(Match the file's existing pattern — likely a `const COMMANDS = { ... }` map. Add the line; do not advertise this in any help listing.)

- [ ] **Step 3: Boot to confirm**

Run: `node server.js`
Send `exchange smith.buy_rope` via the client input box. Should buy a rope identically to `buy rope`.

- [ ] **Step 4: Commit**

```bash
git add src/game/actions/exchangeChip.js src/game/commands.js
git commit -m "Add internal 'exchange <id>' command for chip transport"
```

---

## Task 9: Emit `msg.exchanges` from the inspect builder

`look.js`'s `sendTargetInfo` currently only attaches `shop` data when target is an NPC. Extend it to attach `exchanges` for NPCs *and* for items (when looking at a fixture like the cauldron).

**Files:**
- Modify: `src/game/actions/look.js`

- [ ] **Step 1: Add a helper near `serializeShop`**

Insert above or beside `serializeShop`:

```js
function serializeExchanges(host, lang) {
  const list = host.kind === 'npc' ? host.exchanges : host.def?.exchanges;
  if (!Array.isArray(list) || list.length === 0) return null;
  const formatSide = (side) => side.map(e => {
    if (e.gold != null) return { kind: 'gold', amount: e.gold };
    const def = world.itemDefs.get(e.item);
    return {
      kind: 'item',
      id: e.item,
      name: def ? t(def.name, lang) : e.item,
      count: e.count ?? 1,
    };
  });
  return list.map(e => ({
    id: e.id,
    flavor: e.flavor,
    inputs: formatSide(e.inputs),
    outputs: formatSide(e.outputs),
  }));
}
```

Add `world` to the existing import at the top:
```js
import { ..., world } from '../world.js';
```
(It is already imported — verify no duplicate.)

- [ ] **Step 2: Wire `exchanges` into the NPC `target-info` payload**

In `sendTargetInfo`, in the NPC branch, replace the `shop` line and add `exchanges`. Keep `shop` send for one more task while we transition the client; client will switch in Task 10.

```js
const exchanges = serializeExchanges(target, lang);
const shop = serializeShop(target, lang);
actor.session.send({
  kind: 'target-info',
  name: t(target.name, lang),
  subtitle,
  description: t(target.long, lang) || t(target.short, lang) || s('look.npc_no_desc', lang),
  shop,
  shopSellsLabel: shop ? s('shop.sells_label', lang) : undefined,
  shopBuysLabel: shop ? s('shop.buys_label', lang) : undefined,
  exchanges,
  exchangeRowLabels: {
    buy: s('exchange.row.buy', lang),
    sell: s('exchange.row.sell', lang),
    craft: s('exchange.row.craft', lang),
  },
  // ... rest unchanged
});
```

- [ ] **Step 3: Add an item branch to `sendTargetInfo`**

Currently `sendItemInfo` doesn't include exchange data. Update it:

```js
function sendItemInfo(actor, inst) {
  const lang = actor.lang;
  const exchanges = serializeExchanges(inst, lang);
  actor.session.send({
    kind: 'target-info',
    name: t(inst.def.name, lang),
    subtitle: '',
    description: t(inst.def.long, lang) || t(inst.def.short, lang) || s('look.npc_no_desc', lang),
    exchanges,
    exchangeRowLabels: exchanges ? {
      buy: s('exchange.row.buy', lang),
      sell: s('exchange.row.sell', lang),
      craft: s('exchange.row.craft', lang),
    } : undefined,
  });
}
```

- [ ] **Step 4: Boot and exercise**

Run: `node server.js`
- `look smith` — payload should now include `exchanges` (visible in browser DevTools network tab if curious; chips still render off `shop` for one more task).
- `look cauldron` — payload should include `exchanges` for the two craft entries.

Expected: existing chip rendering unchanged; new field added.

- [ ] **Step 5: Commit**

```bash
git add src/game/actions/look.js
git commit -m "Emit msg.exchanges on inspect (NPC + item)"
```

---

## Task 10: Client chip rendering — group by flavor; remove old shop blocks

**Files:**
- Modify: `client/client.js`
- Modify: `client/style.css`

- [ ] **Step 1: Locate the shop chip render block in `client/client.js`**

Around lines 469–496. The two `if (msg.shop && Array.isArray(msg.shop.sells)...)` blocks. Replace **both** with a unified renderer:

```js
if (Array.isArray(msg.exchanges) && msg.exchanges.length > 0) {
  const labels = msg.exchangeRowLabels ?? { buy: 'For sale', sell: 'Wants to buy', craft: 'Can make' };
  const flavorOrder = ['buy', 'sell', 'craft'];
  for (const flavor of flavorOrder) {
    const rows = msg.exchanges.filter(e => e.flavor === flavor);
    if (rows.length === 0) continue;
    const row = document.createElement('div');
    row.className = 'shop-row';
    const lab = document.createElement('span');
    lab.className = 'shop-label';
    lab.textContent = `${labels[flavor]}: `;
    row.appendChild(lab);
    rows.forEach((entry, i) => {
      if (i > 0) row.appendChild(document.createTextNode(', '));
      const label = formatExchangeChipLabel(entry);
      const send = chipSendForExchange(entry);
      const chip = makeChip(label, `chip-flavor-${flavor}`, () => sendInput(send));
      row.appendChild(chip);
    });
    inspectPanel.appendChild(row);
  }
}
```

- [ ] **Step 2: Add the helpers near the top of the rendering block (or above the `if`)**

```js
function formatExchangeSide(side) {
  return side.map(e => {
    if (e.kind === 'gold') return `${e.amount}g`;
    return e.count > 1 ? `${e.count} ${e.name}` : e.name;
  }).join(' + ');
}

function formatExchangeChipLabel(entry) {
  if (entry.flavor === 'buy') {
    const out = entry.outputs.find(x => x.kind === 'item');
    const gold = entry.inputs.find(x => x.kind === 'gold');
    return `${out.name} — ${gold.amount}g`;
  }
  if (entry.flavor === 'sell') {
    const inp = entry.inputs.find(x => x.kind === 'item');
    const gold = entry.outputs.find(x => x.kind === 'gold');
    const inpStr = inp.count > 1 ? `${inp.count} ${inp.name}` : inp.name;
    return `${inpStr} — ${gold.amount}g`;
  }
  return `${formatExchangeSide(entry.inputs)} → ${formatExchangeSide(entry.outputs)}`;
}

function chipSendForExchange(entry) {
  if (entry.flavor === 'buy') {
    const out = entry.outputs.find(x => x.kind === 'item');
    return `buy ${out.id}`;
  }
  if (entry.flavor === 'sell') {
    const inp = entry.inputs.find(x => x.kind === 'item');
    return `sell ${inp.id}`;
  }
  return `exchange ${entry.id}`;
}
```

- [ ] **Step 3: Add CSS for the craft chip flavor**

In `client/style.css`, find the existing `.shop-sell` and `.shop-buy` classes. Add adjacent:

```css
.chip-flavor-buy { /* reuse shop-sell colors */
  background: var(--chip-shop-sell-bg, #2a4a2a);
  color: var(--chip-shop-sell-fg, #d4f0d4);
}
.chip-flavor-sell {
  background: var(--chip-shop-buy-bg, #4a3a1a);
  color: var(--chip-shop-buy-fg, #f0e0b0);
}
.chip-flavor-craft {
  background: #2a2a4a;
  color: #c8c0f0;
}
```

If the existing shop chip CSS uses concrete hex values rather than CSS vars, copy those values into the new `chip-flavor-buy` / `chip-flavor-sell` rules so they match. Look up the existing `.shop-sell` and `.shop-buy` rules in `style.css` first and mirror their colors exactly.

- [ ] **Step 4: Remove the old shop chip block (lines 469–496) — confirmed replaced in Step 1**

Confirm no remaining references to `msg.shop`, `msg.shopSellsLabel`, `msg.shopBuysLabel` in `client.js`. If any remain, delete them.

- [ ] **Step 5: Boot and exercise**

Run: `node server.js`
- `look smith` — should now show "For sale: rope — 10g" and "Wants to buy: iron ore — 5g" rows. Click each chip to confirm `buy`/`sell` flow runs.
- `look cauldron` — should show "Can make: blue flower → mana potion, 3 red berries → heal potion" with purple/blue chips. Click the heal chip with 3 berries in inventory; should produce a heal potion.

Expected: chips render under flavor-grouped rows on both NPCs and fixtures.

- [ ] **Step 6: Commit**

```bash
git add client/client.js client/style.css
git commit -m "Render exchange chips grouped by flavor on inspect panel"
```

---

## Task 11: Hard switch — loader rejects old `shop` and `recipes` keys

Now that all systems run on `exchanges`, delete the old keys from content and the old validators from the loader.

**Files:**
- Modify: `src/persist/contentLoader.js`
- Modify: `content/npcs/village/village.smith.json`
- Modify: `content/npcs/village/village.baker.json`
- Modify: `content/npcs/village/village.innkeeper.json`
- Modify: `content/items/fixtures/home.cauldron.json`
- Modify: `src/game/actions/look.js`

- [ ] **Step 1: Remove old `shop` keys from the three NPC files**

In `village.smith.json`, `village.baker.json`, `village.innkeeper.json`: delete the `"shop": {...}` block. Keep `"exchanges": [...]`.

- [ ] **Step 2: Remove old `recipes` from cauldron**

In `content/items/fixtures/home.cauldron.json`: delete the `"recipes": {...}` block. Keep `"exchanges": [...]`.

- [ ] **Step 3: Remove old `shop` validation from `contentLoader.js`**

Find the `if (def.shop != null) { ... }` block inside `makeNpcValidator` (around lines 105-125) and **replace it with a hard rejection**:

```js
check(def.shop == null, ctx, `'shop' is no longer supported — use 'exchanges' (see docs/superpowers/specs/2026-05-06-exchange-unification-design.md)`);
```

Find the `validateNpcShops` export and **delete it entirely** (along with its call in `server.js`).

- [ ] **Step 4: Remove old `recipes` validation from `contentLoader.js`**

In `validateItemInteractions`, find the `if (def.recipes != null) { ... }` block and replace with:

```js
check(def.recipes == null, ctx, `'recipes' is no longer supported — use 'exchanges'`);
```

- [ ] **Step 5: Remove `serializeShop` from `look.js`**

The function and the `shop`, `shopSellsLabel`, `shopBuysLabel` fields on the `target-info` payload are now dead. Delete the function, the variable, and those three fields from the NPC branch payload.

- [ ] **Step 6: Remove the `validateNpcShops` import/call from `server.js`**

```bash
grep -n "validateNpcShops" server.js
```

Delete the import and the call.

- [ ] **Step 7: Boot to confirm clean cutover**

Run: `node server.js`
Expected: clean startup with `exchanges`-driven content; no `shop` or `recipes` references anywhere. If the loader complains, fix the offending file.

- [ ] **Step 8: Sanity-check by exercising chips and commands again**

`look smith`, `buy rope`, `sell ore`, `look cauldron`, `use red berries on cauldron`, `give 3 red berries to baker` — all should still work identically.

- [ ] **Step 9: Commit**

```bash
git add -u
git commit -m "Hard-switch to exchanges; delete old shop/recipes paths"
```

---

## Task 12: Add a craft-on-NPC entry — smith forges iron sword

Sanity check that `craft` flavor works on an NPC, not just on fixtures. The smith already sells rope and buys ore; now he can also forge a sword from 5 ore + 20 gold.

**Files:**
- Modify: `content/npcs/village/village.smith.json`

- [ ] **Step 1: Add the new exchange entry**

Append to the smith's `exchanges` array:

```json
{
  "id": "smith.forge_iron_sword",
  "flavor": "craft",
  "inputs":  [{ "item": "mine.iron_ore", "count": 5 }, { "gold": 20 }],
  "outputs": [{ "item": "forest.iron_sword" }],
  "xp": 5,
  "verb": {
    "en": {
      "to_target": {
        "self": "you hand five chunks of iron ore and twenty gold to {target}. He sets to the forge, hammers ring out, and an iron sword takes shape.",
        "others": "{actor} hands iron ore and gold to {target}. The smith works the forge until an iron sword takes shape."
      }
    },
    "cs": {
      "to_target": {
        "self": "podáš pět kusů železné rudy a dvacet zlatých {target}. Pustí se k výhni, kladiva zazvoní a vznikne železný meč.",
        "others": "{actor} podává železnou rudu a zlaté {target}. Kovář pracuje u výhně, dokud nevznikne železný meč."
      }
    }
  }
}
```

- [ ] **Step 2: Boot and exercise**

Run: `node server.js`
With 5 iron ore and 20 gold:
- `look smith` — should show three rows: "For sale", "Wants to buy", and "Can make: 5 iron ore + 20g → iron sword".
- Click the craft chip; or run `use iron ore on smith`; or run `give 5 iron ore to smith` — any path should consume 5 ore + 20 gold and produce an iron sword. XP awarded.

Expected: NPC craft works exactly like fixture craft.

- [ ] **Step 3: Commit**

```bash
git add content/npcs/village/village.smith.json
git commit -m "Add craft-on-NPC sanity entry: smith forges iron sword"
```

---

## Task 13: Final verification pass

- [ ] **Step 1: Boot and run the full smoke list**

Run: `node server.js`. With a fresh login, walk to each location and verify:

| Place | Action | Expected |
|---|---|---|
| smith | `look smith` | three flavor rows render |
| smith | `buy rope` | -10g, +rope |
| smith | (with ore) `sell ore` | -ore, +5g per |
| smith | (5 ore + 20g) `give 5 ore to smith` | exchange ambiguity? if yes — see step 2 |
| smith | (5 ore + 20g) chip on craft | -5 ore, -20g, +iron sword, +5 xp |
| baker | `give 3 red berries to baker` | -3 berries, +1g |
| baker | `give 1 red berry to baker` | falls through to plain transfer (baker only buys 3-stacks) |
| innkeeper | `buy beer` | -3g, +beer |
| cauldron | `use blue flower on cauldron` | -flower, +mana potion |
| cauldron | chip click on heal | -3 berries, +heal potion |

- [ ] **Step 2: Disambiguation check**

When the smith has both `sell_ore` (1 ore) and `forge_iron_sword` (5 ore + 20g): typing `give 1 ore to smith` triggers sell; `give 5 ore to smith` triggers craft. There's no ambiguity because counts differ. If you want to verify the ambiguity error path, temporarily author two craft entries with the same input count on a test NPC, confirm `exchange.ambiguous_give` fires, then revert.

- [ ] **Step 3: Confirm old keys absent**

```bash
grep -rn "\"shop\"" content/npcs/ content/items/
grep -rn "\"recipes\"" content/items/
```

Both should return no results (the room files using `"shop"` as a tag are not in these directories — confirm if needed with the broader scan).

- [ ] **Step 4: Squash review-only commits if any (optional)**

If you accumulated WIP commits during testing, leave them — frequent commits are fine. Do not squash without user request.

- [ ] **Step 5: Final commit (if anything was tweaked)**

If steps 1-3 surfaced any small fix:

```bash
git add -u
git commit -m "Post-merge fixes from exchange unification verification"
```

If everything passed without changes, skip this step.

---

## Self-review notes

- Spec coverage: every section of the design is covered. Schema → Task 2 + 4. Trigger map → Tasks 5/6/7/8. runExchange flow → Task 3. Chip rendering → Tasks 9/10. Strings → Task 1. Migration → Tasks 4/11. Edge cases → Task 7 (smart give fallthrough), Task 13 (disambiguation).
- Type/name consistency: `runExchange`, `findExchanges`, `findExchangeById`, `canAfford`, `hostsInRoom` — used identically across all consuming files.
- No placeholders: every step has full code or exact commands.
- Ordering: additive validator (Task 2) → core module (Task 3) → migrate content with both shapes (Task 4) → rewire actions one by one (Tasks 5-8) → server inspect emit (Task 9) → client render (Task 10) → hard switch and delete old paths (Task 11) → new content (Task 12) → smoke (Task 13). The world boots cleanly between every task.
