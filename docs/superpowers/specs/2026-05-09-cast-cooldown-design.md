# Cast cooldown — shared action queue with attack

## Problem

Player attacks already obey an energy-style cooldown (`actor.nextAttackAt`, `cost / spd * 1000`, see `src/game/actions/attack.js:21-30`). Casting does not — `cast.js` only checks MP. A player can spam casts at typing speed and can also weave attacks and casts in the same instant. This blocks the design space for slow, expensive, high-impact spells (long incantations, summoning rituals, big nukes) and dilutes the meaning of `spd` for casters.

## Goal

Make casting and attacking share **one action queue per actor**, so a cast commits the actor for `cost / spd * 1000` ms during which neither another cast nor an attack can fire. Open a `cost` field on spell defs to author cantrips (cheap+fast), standard spells (default), and slow nukes (expensive+strong). Reuse the existing combat in-progress visual on the attack button for spell casts, so the client surface is unchanged.

## Design

### Shared action timer

Rename `actor.nextAttackAt` to `actor.nextActionAt` (same field, same semantics). Both attack and cast read and write it.

- Attack path: unchanged behavior, just renamed field. `attackCooldownMs(action, actor)` already returns the right wait.
- Cast path: compute `castCooldownMs(spell, actor) = (spell.cost ?? 12) / (actor.stats?.spd ?? 6) * 1000`, set `actor.nextActionAt = Date.now() + castCooldownMs(...)` after the cast resolves.

A single helper `actionCooldownMs(cost, actor)` in a shared spot (probably `src/game/actions/cooldown.js`, new file) keeps both paths from drifting.

### Queueing vs refusing

Attack queues with a `setTimeout` and re-resolves the target on fire (`attack.js:69-80`). Cast does **not** queue in v1: if the actor is mid-action (`Date.now() < nextActionAt`), the cast is refused with a system message (`s('cast.still_recovering', lang, { msLeft })`).

Rationale: queued casts have semantics worth deciding deliberately (does the queued cast lose MP if cancelled? does target legality re-check? what if the spell becomes unknown mid-wait?). Refuse-now is the simplest correct behavior; we can layer a queue on top in v2 once the policy questions are answered. Refuse-now also means a player can't accidentally chain a slow nuke into a melee swing.

This creates one **asymmetry to flag**: attacks queue, casts don't. Acceptable because attack queueing exists primarily for "click attack on the same target every cycle" combat flow, which has a clear continuation. Casts with explicit targets and MP cost don't share that pattern.

### MP commit timing

MP is deducted **on cast commit** (the moment the cast fires), not on completion. Since v1 has no slow-cast wind-up phase between commit and completion (the cooldown is post-resolution, not pre-resolution), this is moot in practice — there's nothing to interrupt. The decision matters for v2 if we add a wind-up phase; recording it now so the policy is fixed:

> Slow casts in v2 will charge MP on the start of the wind-up. Damage taken during wind-up does not refund MP. Interruption (if added) wastes the cast.

### Spell content schema

New optional field on spell defs:

```json
{
  "id": "spell.heal",
  ...
  "cost": 8
}
```

`cost` is action-cost (energy units), not MP. Default `12` (matches the default attack cost). Validator: positive integer, ≤ some reasonable max (say 100 — at spd=6 that's ~17s, plenty for "big ritual" framing).

Initial content tuning suggestion (no schema impact, just numbers to seed the design space):

| Spell | cost | rationale |
|---|---:|---|
| spell.spark | 6 | cantrip-tier, fast cycle |
| spell.heal | 12 | default |
| spell.poison_dart | 12 | default |
| spell.burning_hands | 16 | bigger AoE-flavored, slight wind-down |
| spell.life_drain | 20 | slow, expensive nuke |
| spell.ward | 12 | default |

These are starting values for content tuners, not a binding part of the spec.

### Client visual

`stats` messages already publish whatever drives the attack button's "in progress" state (the client computes `Date.now() < nextAttackAt` against the field the server sends). Today that field is named for attack; we rename the server field to `nextActionAt` (or expose both for one release if a hot reload of clients is undesirable).

The attack button's existing in-progress style applies during spell casts the same way — no new client state, no new CSS. Cast chips visibly become non-firing during the cooldown because the same `nextActionAt` clock gates them.

One new system string to send when a cast is refused:

- `cast.still_recovering` — "You are still recovering from your last action." / "Ještě se vzpamatováváš z poslední akce."

### Persistence

`nextActionAt` is in-memory only, like `nextAttackAt` is today. Save/load unchanged.

## Files touched

- `src/game/actions/cooldown.js` (new) — `actionCooldownMs(cost, actor)` helper.
- `src/game/actions/attack.js` — rename `nextAttackAt` → `nextActionAt`; route through the new helper.
- `src/game/actions/cast.js` — add cooldown gate at entry (refuse if `Date.now() < nextActionAt`), set `nextActionAt` after successful cast.
- `src/game/playerCombatState.js` — if it tracks `nextAttackAt` for queue clearing, follow the rename.
- `src/persist/validators/spell.js` — accept and validate optional `cost` (positive integer, ≤ 100).
- `src/game/messages/stats.js` — rename outgoing field name; or expose both during transition.
- `client/client.js` — rename `nextAttackAt` reference to `nextActionAt`; verify cast chips disable on the same clock.
- `content/spells/*.json` — optional initial cost tuning per the table above (content task, not gating).
- `content/strings/en.json`, `content/strings/cs.json` — add `cast.still_recovering`.

## Out of scope (v2+)

- **Cast queueing.** A queued cast that fires when the action timer expires. Requires a policy on MP refund/legality re-check on fire, which we haven't agreed on.
- **Wind-up phase / interruptible casts.** A "you begin chanting…" pre-resolution window where damage cancels the cast. Requires concentration rules; bigger feature than this spec.
- **Per-spell categories with different cooldowns** (e.g. instant cantrips that bypass the action queue entirely). v1 keeps the rule uniform.
- **Off-GCD spells / utility casts that don't trigger cooldown.** Same reason.
- **Progress bar UI** during a wind-up phase. Not needed in v1; the attack-button visual is sufficient.

## Risks

- **Field rename touches a few sites at once.** Server, client, possibly playerCombatState. Search for `nextAttackAt` across the tree before merging to make sure no consumers are missed. (Safer alternative: leave the server field unchanged on the wire as `nextAttackAt`, alias internally to `nextActionAt`. Skip the wire rename if the client risk feels too tall.)
- **Attack button "in progress" generalizing to casts.** The button visual was authored with attack in mind. Confirm the styling still reads correctly when the in-progress state was caused by a cast — there shouldn't be any difference, but worth a quick check on the live client.
- **Spell balance.** Once `cost` is meaningful, existing spells' implicit "instant fire" balance changes. Need a tuning pass on the existing 12 spells; the table above is a starting point, not final.
- **Queued attack interaction.** A player has a queued attack that will fire when `nextActionAt` expires. Player tries to cast in that window. The cast is refused (per "no cast queue" rule), but the queued attack still fires. Confirm this is the desired behavior — the queued attack will land, the cast won't. Probably fine; the player can re-issue the cast after the queued attack fires. Worth a comment in code so the next reader doesn't think it's a bug.
