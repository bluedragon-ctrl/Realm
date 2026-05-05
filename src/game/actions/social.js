import { world } from '../world.js';
import { runVerb, getMissingMsg, hasForm } from '../verbs.js';
import { resolveActorTarget } from '../targeting.js';

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
}
