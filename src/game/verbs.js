import { broadcastToRoom } from './world.js';
import { t } from '../i18n.js';
import { sourceForActor } from './sources.js';
import { resolveName } from './declension.js';
import { setPosition } from './positionGate.js';

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
export function runVerb({ actor, def, targetActor, targetName, params = {} }) {
  const isToTarget = (targetName != null) || (targetActor && targetActor !== actor);
  if (isToTarget && targetActor && targetActor !== actor && targetActor.position === 'sleep') {
    setPosition(targetActor, 'stand', 'woken');
  }
  const formKey = isToTarget ? 'to_target' : 'no_target';

  broadcastToRoom(actor.location, (recipient) => {
    const langDef = def[recipient.lang] ?? def.en;
    const form = langDef?.[formKey];
    if (!form) return null;
    const isAuthor = recipient === actor;
    const template = isAuthor ? form.self : form.others;
    if (!template) return null;

    const text = fillPlaceholders(template, {
      actor,
      target: targetActor,
      targetName,
      lang: recipient.lang,
      params,
    });
    return { kind: 'emote', source: sourceForActor(actor, recipient), text };
  });
}

function renderParams(params, lang) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = (v && typeof v === 'object') ? t(v, lang) : v;
  }
  return out;
}

// Substitute {actor}, {target}, {actor.dat}, {target.gen}, and arbitrary {key}
// params into a template string. Bare {actor} defaults to nominative; bare
// {target} defaults to accusative (the most common direct-object slot); dotted
// suffixes pick a specific case via resolveName. `targetName` (if provided)
// shadows {target} only when no case suffix is requested — used for item-use
// flows that pre-resolve a label.
export function fillPlaceholders(template, { actor, target, targetName = null, lang, params = {} }) {
  const renderedParams = renderParams(params, lang);
  const resolve = (key) => {
    if (key in renderedParams) return renderedParams[key];
    const [base, kase] = key.split('.', 2);
    if (base === 'actor' && actor) {
      return resolveName(actor, kase ?? 'nom', lang);
    }
    if (base === 'target') {
      if (targetName != null && kase == null) {
        return (typeof targetName === 'object') ? t(targetName, lang) : targetName;
      }
      const subject = (!target || target === actor) ? actor : target;
      if (!subject) return '';
      return resolveName(subject, kase ?? 'acc', lang);
    }
    return '';
  };
  return template.replace(/\{([\w.]+)\}/g, (_, k) => resolve(k));
}

export function getMissingMsg(def, lang) {
  return def[lang]?.missing ?? def.en?.missing ?? null;
}

export function hasForm(def, lang, formKey) {
  return !!(def[lang]?.[formKey] ?? def.en?.[formKey]);
}
