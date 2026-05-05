import { applyTrain, resolveStatKey, STAT_RATIOS } from '../leveling.js';
import { sendStats } from '../messages.js';
import { s } from '../../i18n.js';

export default function train(actor, args) {
  if (!actor.session) return;
  const arg = (args[0] ?? '').trim();
  if (!arg) {
    actor.session.send({
      kind: 'error',
      text: s('train.no_arg', actor.lang),
    });
    return;
  }

  if (!actor.record.unspentPoints || actor.record.unspentPoints <= 0) {
    actor.session.send({
      kind: 'error',
      text: s('train.no_points', actor.lang),
    });
    return;
  }

  const key = resolveStatKey(arg);
  if (!key) {
    actor.session.send({
      kind: 'error',
      text: s('train.unknown_stat', actor.lang, { stat: arg }),
    });
    return;
  }

  const ok = applyTrain(actor, key);
  if (!ok) {
    actor.session.send({
      kind: 'error',
      text: s('train.failed', actor.lang),
    });
    return;
  }

  actor.session.send({
    kind: 'system',
    tone: 'good',
    text: s('train.success', actor.lang, {
      stat: s(`panel.train_label_${key}`, actor.lang),
      gain: STAT_RATIOS[key],
    }),
  });
  sendStats(actor);
}
