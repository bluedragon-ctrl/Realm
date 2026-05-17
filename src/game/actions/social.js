import { world, broadcastToRoom } from '../world.js';
import { runVerb, getMissingMsg, hasForm, fillPlaceholders } from '../verbs.js';
import { resolveActorTarget } from '../targeting.js';
import { canPerceive } from '../perception.js';
import { sourceForActor } from '../sources.js';
import { pickListIndex, tListAt, t, s } from '../../i18n.js';

export default function social(actor, verb, args) {
  const def = world.socials.get(verb);
  if (!def) return;

  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: getMissingMsg(def, actor.lang) ?? 'whom?' });
    return;
  }

  const query = args.join(' ');
  const target = resolveActorTarget(actor, query);
  if (!target) return;

  const formKey = target === actor ? 'no_target' : 'to_target';
  if (!hasForm(def, actor.lang, formKey)) {
    actor.session.send({ kind: 'error', text: getMissingMsg(def, actor.lang) ?? 'whom?' });
    return;
  }

  runVerb({ actor, def, targetActor: target });

  if (target !== actor && target.kind === 'npc' && target.reactions?.[verb]) {
    const lines = target.reactions[verb];
    const idx = pickListIndex(lines);
    broadcastToRoom(target.location, (recipient) => {
      if (!canPerceive(recipient, target)) return null;
      const lang = recipient.lang;
      const from = t(target.name, lang);
      const tmpl = tListAt(lines, lang, idx);
      const filled = fillPlaceholders(tmpl, { actor: target, target: actor, lang });
      return { kind: 'emote', source: sourceForActor(target, recipient), text: s('emote.line', lang, { from, text: filled }) };
    });
  }
}
