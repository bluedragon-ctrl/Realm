import { broadcastToRoom } from './world.js';
import { t } from '../i18n.js';
import { sourceForActor } from './sources.js';

/**
 * Run a verb-shaped def (social or item.use) as a per-recipient broadcast.
 *
 * Verb def shape:
 *   {
 *     en: {
 *       to_target?: { self: "...", others: "..." },
 *       no_target?: { self: "...", others: "..." },
 *       missing?:   "..."
 *     },
 *     cs: { ... }
 *   }
 *
 * targetActor === actor means self-target (no_target form is used).
 * targetActor === null means undirected (no_target form is used).
 */
export function runVerb({ actor, def, targetActor, params = {} }) {
  const isSelfOrNone = !targetActor || targetActor === actor;
  const formKey = isSelfOrNone ? 'no_target' : 'to_target';

  broadcastToRoom(actor.location, (recipient) => {
    const langDef = def[recipient.lang] ?? def.en;
    const form = langDef?.[formKey];
    if (!form) return null;
    const isAuthor = recipient === actor;
    const template = isAuthor ? form.self : form.others;
    if (!template) return null;

    const targetName = !targetActor ? actor.name :
      targetActor === actor ? actor.name :
      targetActor.kind === 'npc'
        ? t(targetActor.nameAcc ?? targetActor.name, recipient.lang)
        : targetActor.name;

    const allParams = {
      actor: actor.name,
      target: targetName,
      ...renderParams(params, recipient.lang),
    };

    return {
      kind: 'emote',
      source: sourceForActor(actor, recipient),
      text: template.replace(/\{(\w+)\}/g, (_, k) => (allParams[k] ?? '')),
    };
  });
}

function renderParams(params, lang) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = (v && typeof v === 'object') ? t(v, lang) : v;
  }
  return out;
}

export function getMissingMsg(def, lang) {
  return def[lang]?.missing ?? def.en?.missing ?? null;
}

export function hasForm(def, lang, formKey) {
  return !!(def[lang]?.[formKey] ?? def.en?.[formKey]);
}
