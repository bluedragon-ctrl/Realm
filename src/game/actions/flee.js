import { getRoom } from '../world.js';
import { s } from '../../i18n.js';
import move from './move.js';
import { requireStanding } from '../positionGate.js';

export default function flee(actor) {
  const gate = requireStanding(actor);
  if (!gate.ok) {
    actor.session?.send({ kind: 'error', text: gate.msg });
    return;
  }
  const room = getRoom(actor.location);
  const exitKeys = Object.keys(room?.exits ?? {});
  if (exitKeys.length === 0) {
    actor.session.send({ kind: 'error', text: s('flee.no_exits', actor.lang) });
    return;
  }
  const exitKey = exitKeys[Math.floor(Math.random() * exitKeys.length)];
  return move(actor, [exitKey]);
}
