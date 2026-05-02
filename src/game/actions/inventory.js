import { s, t } from '../../i18n.js';

export default function inventory(actor) {
  if (actor.inventory.length === 0) {
    actor.session.send({ kind: 'system', text: s('inventory.empty', actor.lang) });
    return;
  }
  const names = actor.inventory.map(inst => t(inst.def.name, actor.lang));
  actor.session.send({
    kind: 'system',
    text: s('inventory.list', actor.lang, { items: names.join(', '), count: names.length }),
  });
}
