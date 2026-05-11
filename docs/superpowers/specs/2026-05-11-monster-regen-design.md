# Out-of-combat NPC regen — design

Status: draft
Date: 2026-05-11

## Goal

Wounded NPCs recover HP and MP once disengaged from combat. Closes the exploit
where a player engages a tough mob, dies, respawns, and walks back to finish it
off at near-zero HP. After a short lull following the last combat event, a
mob's HP and MP tick back toward maximum at a tunable rate.

## Mechanics

### Out-of-combat detection (per NPC)

Each NPC carries `lastCombatTick`. It is stamped to the current `tickCount`
whenever any of the following happen:

- The NPC takes damage (any source).
- The NPC deals damage (any source).
- During its own tick, `hasInRoomTarget(npc)` returns true — i.e. it has a
  positive-hate, alive, perceivable target standing in the same room.

The NPC is **out of combat** when `tickCount - lastCombatTick >= LULL_TICKS`
(default 6). Initial value: `-Infinity`, so a freshly spawned NPC is
immediately out of combat (it will regen toward full if it spawned below max
for any reason — defensive; not expected to happen in practice).

### Regen application

In `tickActor`, after the existing aggression / behavior block, and only when:

- `actor.kind === 'npc'`, `actor.alive`, **and**
- `tickCount - actor.lastCombatTick >= LULL_TICKS`, **and**
- `actor.stats.hp < actor.stats.hpMax || actor.stats.mp < actor.stats.mpMax`

apply `actor.regen.hp` and `actor.regen.mp`, clamped to max:

```js
const before = { hp: actor.stats.hp, mp: actor.stats.mp };
actor.stats.hp = Math.min(actor.stats.hpMax, actor.stats.hp + actor.regen.hp);
actor.stats.mp = Math.min(actor.stats.mpMax, actor.stats.mp + actor.regen.mp);
const changed = actor.stats.hp !== before.hp || actor.stats.mp !== before.mp;
```

If `changed` and any in-room player is inspecting this NPC, push fresh stats
via the existing `pushTargetInfo(player, npc)` path already used for
active-effect ticks. No broadcasts, no console messages.

### Defaults and overrides

In `src/game/stats.js`:

```js
export const DEFAULT_NPC_REGEN = Object.freeze({ hp: 1, mp: 1 });
export const LULL_TICKS = 6;
```

NPC JSON may declare an optional `regen` block:

```json
{ "regen": { "hp": 2, "mp": 0 } }
```

Both keys optional, each defaults from `DEFAULT_NPC_REGEN`. Validation at load
time: non-negative integers, no other keys allowed.

`LULL_TICKS` is global. Per-def override is not in this design; if a future
boss needs a longer recovery window we add `lullTicks` to the def block then.

## Touch list

| File | Change |
|---|---|
| `src/game/stats.js` | Add `DEFAULT_NPC_REGEN`, `LULL_TICKS`. |
| `src/game/actors.js` | In `makeNpcActor`, init `lastCombatTick: -Infinity` and resolve `regen` from `def.regen` against `DEFAULT_NPC_REGEN`. |
| `src/game/world/load.js` (NPC validator) | Validate optional `regen: { hp?, mp? }` block — non-negative integers, no extra keys. |
| `src/game/clock.js` (new) | Small leaf module owning `tickCount`. Exports `getTick()`, `bumpTick()`. Avoids a circular import between `combat.js` and `tick.js`. |
| `src/game/combat.js` | In `applyDamageWithFeedback`, stamp `lastCombatTick = getTick()` on `actor` if npc and on `target` if npc. Import `getTick` from `clock.js`. |
| `src/game/tick.js` | Replace local `tickCount` with `getTick()` / `bumpTick()` from `clock.js`. In `tickActor` for npcs: after the passive-aggression block, if `hasInRoomTarget(actor)` stamp `lastCombatTick = getTick()`. After the behavior block, if alive and out-of-combat and below max on HP or MP, apply regen and push inspector refresh. |

## Edge cases

- **Pacified mob (negative hate only):** `hasInRoomTarget` returns false →
  lull timer counts down → regen runs. Matches pacify's intent.
- **Hate table has stale entries (target left room):** `clearAggroOnLeave`
  already removes leaving actors. If a stale entry somehow persists,
  `hasInRoomTarget` filters by `actor.location !== npc.location` → returns
  false → regen runs.
- **Multi-instance NPCs:** state is per-instance, so two rats wounded
  separately recover on separate timers.
- **Buffed `hpMax` / `mpMax`:** clamp reads live `actor.stats.hpMax/mpMax`,
  which active effects mutate. Regen heals toward the buffed cap. No special
  case.
- **NPC HP at 0:** `tickActor` already returns early for dead NPCs. Respawn
  brings a fresh instance from `baseStats` — no regen state to carry over.
- **DoT vs regen race:** if a poison effect ticks the NPC down by N and regen
  ticks up by 1 in the same tick, ordering matters. `tickActiveEffects` runs
  before regen in `tickActor`. Damage from DoT stamps `lastCombatTick` via
  `applyDamageWithFeedback` → regen skipped this tick. Correct.

## Tuning anchor (the targeted exploit)

Rat at 1 HP, player dies. Death respawn delay is ~5s + walk back ~10s ≈ 15s
real time. `handlePlayerDeath` empties every NPC's hate table for the dead
player. With `LULL_TICKS = 6`:

- Ticks 0–5: lull. Rat stays at 1 HP.
- Ticks 6–14 (9 ticks): regen at 1 HP/tick → rat is at 10 HP when player
  returns. Roughly full for a 10-HP rat.

To finish a wounded mob, the player must sprint back within ~6 seconds. Tune
by adjusting `LULL_TICKS` (lower = harsher, higher = friendlier) or per-mob
`regen.hp` (higher = mob recovers faster once lull elapses).

## Out of scope

- Player regen. Players still rely on food/potions/spells; rest mechanics
  belong to a later phase.
- Position-based regen scaling (sit/sleep multipliers). Comes with actor
  positions, the next roadmap item.
- Visible regen feedback ("the wolf licks its wounds"). Silent for v1.
- Per-def `lullTicks` override. Add only when a content need appears.
