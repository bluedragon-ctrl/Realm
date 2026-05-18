// Periodic environmental damage applied to players in rooms with an `environment` block,
// unless they have a matching ward equipped. Generalizable to underwater/lava/poison later
// — content adds new environment types and wearables declare which they ward against.
//
// Per-player ephemeral state lives on the actor (not record):
//   actor._envState = { lastType: string|null, nextDamageTick: number }
// Reset whenever the player moves out of (or across) an env zone.

import { world } from './world.js';
import { applyDamageWithFeedback } from './combat.js';
import { equippedSlots } from './wearables.js';
import { getTick } from './clock.js';
import { s } from '../i18n.js';

function hasWard(actor, type) {
  for (const { def } of equippedSlots(actor)) {
    const wards = def?.wards;
    if (Array.isArray(wards) && wards.includes(type)) return true;
  }
  return false;
}

function envState(actor) {
  if (!actor._envState) actor._envState = { lastType: null, nextDamageTick: 0 };
  return actor._envState;
}

// Called once per global tick. Walks every online player, checks the room they're standing
// in, and applies environment damage if they're unprotected. Entry messages fire on a type
// transition; damage messages fire each time an unwarded interval elapses.
export function tickEnvironment() {
  const tick = getTick();
  for (const actor of world.actorsByName.values()) {
    if (actor.kind !== 'player' || !actor.session) continue;
    if (!(actor.stats?.hp > 0)) continue;
    const room = world.rooms.get(actor.location);
    const env = room?.environment;
    const state = envState(actor);

    if (!env) {
      state.lastType = null;
      state.nextDamageTick = 0;
      continue;
    }

    const warded = hasWard(actor, env.type);

    if (state.lastType !== env.type) {
      // Transitioned into a new (or first) env zone. Show the atmospheric line once,
      // and stage the first damage tick `intervalTicks` away so the player isn't
      // hit on the same tick they step in.
      state.lastType = env.type;
      state.nextDamageTick = tick + (env.intervalTicks ?? 6);
      if (!warded) {
        actor.session.send({
          kind: 'system', tone: 'flavor',
          text: s(`env.${env.type}.enter`, actor.lang),
        });
      }
      continue;
    }

    if (warded) {
      // Equipping the ward mid-zone removes pressure but keeps the schedule so removing
      // it later doesn't restart the interval window.
      continue;
    }

    if (tick < state.nextDamageTick) continue;
    state.nextDamageTick = tick + (env.intervalTicks ?? 6);

    const before = actor.stats.hp;
    applyDamageWithFeedback(null, actor, env.damage ?? 1, { damageType: env.type });
    if (actor.stats.hp < before && actor.session) {
      actor.session.send({
        kind: 'system', tone: 'damage',
        text: s(`env.${env.type}.bite`, actor.lang, { amount: env.damage ?? 1 }),
      });
    }
  }
}
