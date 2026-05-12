# Actor positions — design

Status: draft
Date: 2026-05-12

## Goal

Add a `position` state (`stand` / `sit` / `sleep`) to every actor (players and NPCs). Sleep gates passive perception, so a sleeping NPC doesn't see incoming players — enabling sneak-past gameplay and a meaningful "I'm safe" commitment for resting players. Reactive auto-stand on damage and on targeted socials keeps the system from soft-locking. Couples with the existing OOC regen by leaving a one-line hook for position-scaled regen when player regen lands.

## Scope

In scope:

- `actor.position` field on both players and NPCs, three values: `"stand"` (default), `"sit"`, `"sleep"`. Transient (never persisted).
- Player commands `stand`, `sit`, `sleep` (English verbs only, no energy cost, immediate).
- Per-command position gate: active commands require standing; failure returns a localized prompt.
- Reactive auto-stand on damage. Reactive wake on a targeted social.
- Sleep gate inside `canPerceive(observer, target)` — sleeping observer perceives nothing.
- Sleeping NPC tick skips the behavior block (still ticks effects and regen).
- Optional `position` field on NPC defs (default `"stand"`); validated at boot.
- Room-render suffix on non-standing actors (`(sitting)` / `(asleep)`).
- Position included in `sendStats` packet for future client indicator.
- v1 content: both `forest.fox_pup` instances start sleeping; `forest.bear` starts sleeping with a rewritten `short`.

Out of scope:

- Position-scaled regen multipliers. Hook is left in; tuning lands with player regen.
- Per-NPC `shortAt: { sit, sleep }` flavor overrides.
- A separate `"rest"` state between sit and sleep.
- Day/night driven schedule changes.
- Client quickbar buttons for stand/sit/sleep (typed commands are fine for v1).
- Inspect-panel position rendering (the value is on the stats packet; client UI is optional polish).
- Persistence across logout.

## Mechanics

### State

- `actor.position: "stand" | "sit" | "sleep"`, defaults to `"stand"`.
- Players: initialized in `makePlayerActor` to `"stand"`. Not read from or written to `record` — always reset on connect.
- NPCs: initialized in `makeNpcActor` from `def.position ?? "stand"`. NPC respawn produces a fresh instance, so the def position is restored automatically on respawn.

### Player commands

`stand`, `sit`, `sleep`. Immediate (player commands skip the energy scheduler), no energy cost. No-op on same-position returns `position.already.<pos>`.

Combat gate: `sit` and `sleep` reject with `position.in_combat` if any NPC in the same room has `getHate(npc, player) > 0`. Reuses the aggro table; no new bookkeeping.

Broadcasts:

- Self: `s('position.<pos>.self', lang)`.
- Others in room: `s('position.<pos>.others', lang, { actor })`.

### Active-command gate

A shared helper:

```js
// src/game/positionGate.js
import { s } from '../i18n.js';
export function requireStanding(actor) {
  if (actor.position === 'sleep') return { ok: false, msg: s('position.must_wake', actor.lang) };
  if (actor.position === 'sit')   return { ok: false, msg: s('position.must_stand', actor.lang) };
  return { ok: true };
}
```

Active commands call `requireStanding(actor)` first and short-circuit on failure with the localized message. Active set:

- `move` (all directions)
- `attack`
- `flee`
- `use` (consume/activate an item)
- `search`
- `cast`, **but only when the spell's `target` is `"hostile"`** — self and friendly casts work in any position.

Inert commands (no gate): `look`, `say`, `emote`, social verbs, `stats`, `inventory`, `equipment`, `wear`, `remove`, `drop`, `take`, `give`, self/friendly `cast`, `who`, `help`, `lang`, `quit`, `follow`.

Commands do not auto-transition. Sleeping or sitting is an explicit commitment; the player must explicitly `stand` first.

### Reactive auto-stand

Inside `applyDamageWithFeedback(actor, target, amount)` in `src/game/combat.js`, before hit feedback:

```js
if (target.position !== 'stand') {
  const was = target.position;
  target.position = 'stand';
  const key = was === 'sleep' ? 'position.woken' : 'position.stood';
  broadcastToRoom(target.location, r => buildLocalized(key, r, target));
}
```

Symmetric for both kinds. Applies before the hit-feedback broadcast so the wake message reads in narrative order ("the bear jolts awake! Then it takes 4 damage.").

Damage from any source (melee, damage spells, future DoTs) routes through `applyDamageWithFeedback`, so this is the single junction.

### Targeted-social wake

Inside `runVerb` in `src/game/verbs.js`, when the verb is invoked with an explicit target (the `to_target` branch, not `no_target`): if `target.position === 'sleep'`, transition to `"stand"` and emit `position.woken.*` before the social's own broadcast. Sitting targets are unchanged (sitting is already awake).

Wake from social does **not** modify the hate table. The NPC reverts to its normal awake behavior — an aggressive NPC's passive aggression block will pick the player up on the next tick if it wishes; a neutral NPC just stands and resumes its behavior loop.

### Perception gate

`src/game/perception.js` body becomes:

```js
export function canPerceive(observer, _target) {
  if (observer?.position === 'sleep') return false;
  return true;
}
```

Single-axis change. The `target` axis stays untouched for the future light engine. Sitting NPCs perceive normally.

Call sites today: `aggroTargetInRoom` and the passive-aggression candidate loop (see `src/game/aggro.js`). Both already pass `observer = npc`. Sleeping NPCs therefore acquire no targets and select no targets.

### NPC tick behavior

In `tickActor` (`src/game/tick.js`), before the behavior loop:

```js
if (actor.kind === 'npc' && actor.position === 'sleep') {
  // Effects + OOC regen still ran above. No behaviors while asleep.
  return;
}
```

Effects and regen run normally. A sleeping wounded NPC therefore heals on the standard schedule with no in-room target (`hasInRoomTarget` returns false because `canPerceive` is false), which matches the existing OOC-regen contract.

### OOC regen coupling (deferred hook)

No multiplier table in v1. `actor.regen.hp / mp` continues to apply as a flat per-tick value. When player regen lands, a per-position multiplier (e.g. `stand: 1, sit: 2, sleep: 4`) becomes a one-line tweak in `tickActor`'s regen block. Position is already where it needs to be.

## Room rendering

Per-actor line in `describeRoomToAll` (and any `look <room>` path) appends a localized suffix when `actor.position !== 'stand'`:

- `position.suffix.sit` — `"(sitting)"` / `"(sedí)"`
- `position.suffix.sleep` — `"(asleep)"` / `"(spí)"`

Applies uniformly to player and NPC entries. Suffix sits at end of the existing line; no new line, no per-NPC override. NPC `short` and player name are untouched.

`sendStats(actor)` payload gains a `position` field. Client UI work to render an indicator is optional v1 polish; the field is on the wire so the client can pick it up later without a server change.

## NPC content shape

Optional `position` field on NPC defs. Validator (in `src/game/world/load.js` or wherever NPC defs are validated) accepts `position ∈ {"stand", "sit", "sleep"}`. Unknown values fail at boot (project convention: fail loud).

```json
{
  "id": "forest.bear",
  "position": "sleep",
  ...
}
```

## v1 content

Three NPC edits, no new files.

1. **`forest.fox_pup`** — add `"position": "sleep"` on the def. Both spawned instances start asleep, matching the "fox den at night" framing introduced by the perception PR.
2. **`forest.bear`** — add `"position": "sleep"`. Rewrite `short`:
   - EN: `"A massive brown bear lies curled in the back of the cave, its flanks rising and falling with slow breaths."`
   - CS: `"Obrovský hnědý medvěd leží stočený v zadní části jeskyně, boky mu zvolna stoupají a klesají."`
   - `long` stays as-is — it's the inspect text and reads fine for either pose.
3. Optional: `village.tavern_keeper` or another flavor NPC could start `"sit"`. If no obvious candidate exists in current content, skip — sit is cosmetic only and adds no testing value.

## Server strings

Added to `content/strings/en.json` and `content/strings/cs.json`:

| Key | EN | CS |
|---|---|---|
| `position.stand.self` | You stand up. | Postavíš se. |
| `position.stand.others` | {actor} stands up. | {actor} se postaví. |
| `position.sit.self` | You sit down. | Sedneš si. |
| `position.sit.others` | {actor} sits down. | {actor} si sedne. |
| `position.sleep.self` | You lie down to sleep. | Lehneš si a usneš. |
| `position.sleep.others` | {actor} lies down to sleep. | {actor} si lehne a usne. |
| `position.woken.self` | You jolt awake! | Probudíš se! |
| `position.woken.others` | {actor} jolts awake! | {actor} se probudí! |
| `position.stood.self` | You scramble to your feet. | Vyskočíš na nohy. |
| `position.stood.others` | {actor} scrambles to their feet. | {actor} vyskočí na nohy. |
| `position.must_stand` | You must stand first. | Nejdřív se postav. |
| `position.must_wake` | You're asleep. | Spíš. |
| `position.in_combat` | Not while fighting. | Ne uprostřed boje. |
| `position.already.stand` | You are already standing. | Už stojíš. |
| `position.already.sit` | You are already sitting. | Už sedíš. |
| `position.already.sleep` | You are already asleep. | Už spíš. |
| `position.suffix.sit` | (sitting) | (sedí) |
| `position.suffix.sleep` | (asleep) | (spí) |

CS strings are a starting draft; tune at implementation time.

## Edge cases

- **Sleeping NPC takes a poison DoT.** DoT routes through `applyDamageWithFeedback` → NPC auto-stands, wakes, broadcasts `position.woken.*`, then takes damage. Correct.
- **Player sleeping when an NPC wanders in with passive aggression.** Sleeping player's position doesn't gate them as a *target*; `canPerceive(npc, player)` returns true (only the observer axis is gated). NPC acquires hate normally, attacks → player takes damage → reactive auto-stand wakes them. The sleeping player isn't immune to ambush, just doesn't initiate.
- **Player in another player's hate via PvP (not in scope today).** `sit`/`sleep` combat gate iterates NPC aggro tables only. PvP would need its own gate when it lands.
- **Stale hate after target leaves room.** `getHate` reads the entry directly; `aggroTargetInRoom` already filters by `actor.location`. Combat gate uses `getHate > 0` per NPC in the current room. A stale entry on an NPC in another room doesn't block sitting. Correct.
- **Targeted social on a sleeping NPC the player can't see.** Not possible — target resolution requires the NPC be in the current room and findable by name. No change.
- **Sleeping NPC with active effects (e.g. a buff or DoT).** Effects tick before behaviors; regen runs after. Sleeping skips only the behavior block. All other state continues to update.
- **`forest.bear` short refers to "watching you".** Rewritten to a sleeping pose (see content section); the suffix `(asleep)` then reads consistently.
- **Multi-instance NPCs (`count: 2` fox pups).** Each instance has its own `position` from the same def value. Killing one wakes the other only if pack-hate transfer pulls the survivor into combat (existing mechanic) → its hate updates → first time it takes damage, it auto-stands. Pack-hate alone does not wake a sleeping packmate. Acceptable for v1.

## Touch list

New:

- `src/game/actions/position.js` — `stand`, `sit`, `sleep` handlers + shared transition helper.
- `src/game/positionGate.js` — `requireStanding(actor)` helper consumed by every active command.

Modified:

- `src/game/actors.js` — init `position` in both `makePlayerActor` and `makeNpcActor` (from `def.position ?? "stand"` for NPCs).
- `src/game/world/load.js` — NPC validator accepts optional `position`, rejects unknown values.
- `src/game/perception.js` — body becomes `observer?.position === 'sleep' ? false : true`. Update the leading comment to mention sleep as the observer-axis gate.
- `src/game/combat.js` — reactive auto-stand in `applyDamageWithFeedback` before hit feedback.
- `src/game/tick.js` — skip behavior block when `npc.position === 'sleep'`.
- `src/game/verbs.js` — `runVerb` wakes a sleeping target on the `to_target` branch.
- `src/game/commands.js` — register `stand`, `sit`, `sleep`.
- `src/game/actions/move.js` — `requireStanding` gate.
- `src/game/actions/attack.js` — `requireStanding` gate.
- `src/game/actions/cast.js` — `requireStanding` gate only when the resolved spell target is `"hostile"`.
- `src/game/actions/flee.js` — `requireStanding` gate.
- `src/game/actions/use.js` — `requireStanding` gate.
- `src/game/actions/search.js` — `requireStanding` gate.
- Room renderer (wherever `describeRoomToAll` builds the actor list) — append position suffix to non-standing actor lines.
- `sendStats` builder — include `position` in the packet.
- `content/strings/en.json`, `content/strings/cs.json` — new `position.*` keys.
- `content/npcs/forest/forest.fox_pup.json` — `"position": "sleep"`.
- `content/npcs/forest/forest.bear.json` — `"position": "sleep"` and rewritten `short`.

## Testing

Unit:

- `canPerceive(npc, anything)` returns `false` when `npc.position === 'sleep'`; returns `true` for `'stand'` and `'sit'`. Target axis ignored.
- NPC `tickActor`: sleeping NPC skips behavior block; sitting NPC runs behaviors; standing NPC runs behaviors. Effects and regen still tick in all three.
- `applyDamageWithFeedback` flips a sleeping target to `'stand'` with `position.woken.*` broadcast; a sitting target with `position.stood.*`; a standing target unchanged. Damage application order: wake broadcast → damage broadcast.
- `runVerb` with a sleeping target on the `to_target` branch wakes the target with `position.woken.*` before the social emote. Untargeted (`no_target`) verbs do not wake anyone in the room.
- Position transitions: each of `stand`/`sit`/`sleep` from each starting state produces correct self+others broadcast; same-position returns `position.already.<pos>`.
- Combat gate on `sit`/`sleep`: rejects with `position.in_combat` when any in-room NPC has positive hate on the player; passes otherwise.
- Active-command gate: `move`, `attack`, `flee`, `use`, hostile `cast`, `search` all fail with `position.must_stand` (sitting) or `position.must_wake` (sleeping); inert commands succeed in all three positions.
- Validator: NPC def with `position: "lounging"` fails boot loudly.

Integration:

- Walk into `forest.cave` with the bear asleep. Bear stays asleep (passive aggression gated by `canPerceive`). Look at bear: `(asleep)` suffix present. Walk back out.
- `attack bear`: bear flips to standing, `position.woken.*` broadcast emitted, combat then proceeds under existing flow on subsequent ticks.
- `pat bear` (a targeted social): bear wakes; on the next tick, passive aggression acquires the player and the bear goes hostile.
- `forest.fox_den` with both pups asleep: `search` reveals den contents; players can leave without combat. Or `attack fox_pup` to wake one and engage; the second pup wakes via pack-hate the moment it first takes damage.
- Player relog: position returns to `"stand"` regardless of prior state.
- Player in combat: `sit` rejected; resolve combat (kill or flee) and `sit` then succeeds.
- Player sits beside a sleeping fox pup, casts `spell.heal` on self: succeeds (self-target, no gate).
- Player sits beside a sleeping bear, casts `spell.spark` on bear: rejected with `position.must_stand` (hostile cast).

Manual smoke:

- Two players in the same room, one types `sit`: the other sees `position.sit.others` and the suffix on the actor line. Type `stand`: suffix gone.
- Stats packet includes `position` after `sendStats(actor)` (verify via client console or test harness).
