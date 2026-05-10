import { findInRoom, world } from '../world.js';
import { s } from '../../i18n.js';
import { DEFAULT_PLAYER_ATTACK } from '../stats.js';
import { executeAttack } from '../combat.js';
import { resolveName } from '../declension.js';
import { sendStats } from '../messages.js';
import { clearPlayerActionQueue } from '../playerCombatState.js';
import { resolveActorTarget } from '../targeting.js';

export function buildPlayerAttack(actor) {
  const weaponId = actor.record?.equipped?.weapon;
  const weapon = weaponId ? world.itemDefs.get(weaponId)?.wearable : null;
  if (!weapon) return DEFAULT_PLAYER_ATTACK;
  const out = { ...DEFAULT_PLAYER_ATTACK };
  if (weapon.damage) out.damage = weapon.damage;
  if (weapon.cost) out.cost = weapon.cost;
  if (weapon.onHit) out.onHit = weapon.onHit;
  return out;
}

function attackCooldownMs(action, actor) {
  const cost = action.cost ?? 12;
  const spd = actor.stats?.spd ?? 6;
  return Math.max(0, Math.round((cost / spd) * 1000));
}

function fireAttack(actor, target) {
  const action = buildPlayerAttack(actor);
  executeAttack(actor, action, target);
  actor.nextActionAt = Date.now() + attackCooldownMs(action, actor);
  if (actor.session) sendStats(actor);
}

function resolveTarget(actor, query) {
  const target = findInRoom(actor.location, query);
  if (!target) return null;
  if (target === actor) return null;
  if (target.kind === 'player') return null;
  if (target.kind === 'npc' && target.alive === false) return null;
  return target;
}

export default function attack(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('attack.no_arg', actor.lang) });
    return;
  }
  const query = args.join(' ');
  const target = resolveActorTarget(actor, query);
  if (!target) return;
  if (target === actor) {
    actor.session.send({ kind: 'error', text: s('attack.no_target_self', actor.lang) });
    return;
  }
  if (target.kind === 'player') {
    actor.session.send({ kind: 'error', text: s('attack.no_target_player', actor.lang) });
    return;
  }
  if (target.kind === 'npc' && target.alive === false) {
    actor.session.send({
      kind: 'error',
      text: s('attack.dead_target', actor.lang, {
        target: resolveName(target, 'nom', actor.lang),
      }),
    });
    return;
  }

  const remaining = (actor.nextActionAt ?? 0) - Date.now();
  if (remaining > 0) {
    clearPlayerActionQueue(actor);
    const timer = setTimeout(() => {
      actor.queuedAction = null;
      const next = resolveTarget(actor, query);
      if (!next) return;
      fireAttack(actor, next);
    }, remaining);
    actor.queuedAction = { timer, query, kind: 'attack' };
    return;
  }

  fireAttack(actor, target);
}
