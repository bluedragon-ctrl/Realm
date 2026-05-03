import { broadcastToRoom } from '../world.js';
import { s, t } from '../../i18n.js';
import { findEquippedWearable, recomputeStats } from '../wearables.js';
import { syncWearableEffects } from '../activeEffects.js';
import { sendStats } from '../messages.js';
import { sourceForActor } from '../sources.js';

export default function removeWearable(actor, args) {
  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: s('remove.no_arg', actor.lang) });
    return;
  }
  const query = args.join(' ');
  const found = findEquippedWearable(actor, query);
  if (!found) {
    actor.session.send({ kind: 'error', text: s('remove.unknown', actor.lang, { query }) });
    return;
  }
  const { def, slot } = found;
  actor.record.equipped[slot] = null;
  recomputeStats(actor);
  syncWearableEffects(actor);
  actor.dirty = true;

  broadcastToRoom(actor.location, (recipient) => {
    const item = t(def.nameAcc ?? def.name, recipient.lang);
    if (recipient === actor) {
      return { kind: 'system', text: s('remove.self', recipient.lang, { item }) };
    }
    return {
      kind: 'narration',
      source: sourceForActor(actor, recipient),
      text: s('remove.others', recipient.lang, { actor: actor.name, item }),
    };
  });
  sendStats(actor);
}
