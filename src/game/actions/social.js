import { world, findInRoom } from '../world.js';
import { s } from '../../i18n.js';
import { runVerb, getMissingMsg, hasForm } from '../verbs.js';

const SELF_TOKENS = new Set(['me', 'self', 'myself']);

export default function social(actor, verb, args) {
  const def = world.socials.get(verb);
  if (!def) return;

  if (!args || args.length === 0) {
    actor.session.send({ kind: 'error', text: getMissingMsg(def, actor.lang) ?? 'whom?' });
    return;
  }

  const query = args.join(' ');
  let target;
  if (SELF_TOKENS.has(query.toLowerCase())) {
    target = actor;
  } else {
    target = findInRoom(actor.location, query);
    if (!target) {
      actor.session.send({ kind: 'error', text: s('error.no_such_target', actor.lang, { query }) });
      return;
    }
  }

  const formKey = target === actor ? 'no_target' : 'to_target';
  if (!hasForm(def, actor.lang, formKey)) {
    actor.session.send({ kind: 'error', text: getMissingMsg(def, actor.lang) ?? 'whom?' });
    return;
  }

  runVerb({ actor, def, targetActor: target });
}
