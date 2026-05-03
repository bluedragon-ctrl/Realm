import { broadcastToRoom } from '../world.js';
import { s, t } from '../../i18n.js';
import { findKnownWearable, recomputeStats } from '../wearables.js';
import { syncWearableEffects } from '../activeEffects.js';
import { sendStats } from '../messages.js';
import { sourceForActor } from '../sources.js';

export default function wear(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('wear.no_arg', actor.lang) });
    return;
  }
  const query = args.join(' ');
  const def = findKnownWearable(actor, query);
  if (!def) {
    actor.session.send({ kind: 'error', text: s('wear.unknown', actor.lang, { query }) });
    return;
  }
  const slot = def.wearable.slot;
  if (actor.record.equipped[slot] === def.id) {
    actor.session.send({
      kind: 'error',
      text: s('wear.already_wearing', actor.lang, { item: t(def.name, actor.lang) }),
    });
    return;
  }
  actor.record.equipped[slot] = def.id;
  recomputeStats(actor);
  syncWearableEffects(actor);
  actor.dirty = true;

  broadcastToRoom(actor.location, (recipient) => {
    const item = t(def.nameAcc ?? def.name, recipient.lang);
    if (recipient === actor) {
      return { kind: 'system', text: s('wear.self', recipient.lang, { item }) };
    }
    return {
      kind: 'narration',
      source: sourceForActor(actor, recipient),
      text: s('wear.others', recipient.lang, { actor: actor.name, item }),
    };
  });
  sendStats(actor);
}
