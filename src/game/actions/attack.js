import { findInRoom } from '../world.js';
import { s, t } from '../../i18n.js';
import { DEFAULT_PLAYER_ATTACK } from '../stats.js';
import { executeAttack } from '../combat.js';

export default function attack(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('attack.no_arg', actor.lang) });
    return;
  }
  const query = args.join(' ');
  const target = findInRoom(actor.location, query);
  if (!target) {
    actor.session.send({ kind: 'error', text: s('error.no_such_target', actor.lang, { query }) });
    return;
  }
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
        target: t(target.nameAcc ?? target.name, actor.lang),
      }),
    });
    return;
  }
  executeAttack(actor, DEFAULT_PLAYER_ATTACK, target);
}
