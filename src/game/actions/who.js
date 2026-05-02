import { world } from '../world.js';
import { s } from '../../i18n.js';

export default function who(actor) {
  const players = [...world.actorsByName.values()]
    .filter(a => a.kind === 'player')
    .map(a => a.isAdmin ? `${a.name}${s('system.admin_tag', actor.lang)}` : a.name);
  actor.session.send({
    kind: 'system',
    text: s('system.online', actor.lang, { count: players.length, names: players.join(', ') }),
  });
}
