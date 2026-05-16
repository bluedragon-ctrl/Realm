import { t } from '../i18n.js';

export const CASES = ['nom', 'acc', 'dat', 'gen', 'voc'];
const CASE_FIELD = {
  nom: 'name',
  acc: 'nameAcc',
  dat: 'nameDat',
  gen: 'nameGen',
  voc: 'nameVoc',
};

// Languages whose templates rely on player nameForms declensions. EN/other don't
// inflect player names, so a Czech-style {target.gen} in an EN template should
// render the plain nominative — not the Czech declined form sitting in nameForms.
const DECLINING_LANGS = new Set(['cs']);

// Resolve a localized name in the requested grammatical case.
//
// Accepts:
//   - NPC actors / item defs: localized {en,cs} values stored on `name`, `nameAcc`, etc.
//   - Player actors / records: plain strings on `name` plus an optional `nameForms` map
//     { acc, dat, gen, voc } populated by @create-player.
//
// Falls back to nominative when the requested case is not declared, so EN content
// and Czech content without explicit forms keep working.
export function resolveName(source, kase, lang) {
  if (!source) return '';
  const k = CASES.includes(kase) ? kase : 'nom';

  // Player-shaped: nameForms is a flat string map keyed by case. The declensions
  // stored there are Czech (the only declining language today), so only consume
  // them when the rendering language actually inflects.
  if (source.nameForms && typeof source.nameForms === 'object') {
    if (DECLINING_LANGS.has(lang) && k !== 'nom' && typeof source.nameForms[k] === 'string') {
      return source.nameForms[k];
    }
    if (typeof source.name === 'string') return source.name;
  }

  // NPC / item-shaped: localized value on a per-case field.
  const field = CASE_FIELD[k];
  const val = source[field] ?? source.name;
  return t(val, lang);
}

// Empty form set (all cases default to nom). Used at player record creation when
// the admin did not supply any extra forms.
export function emptyNameForms() {
  return { acc: null, dat: null, gen: null, voc: null };
}

// Lowercase variants of every declared form (nom + acc/dat/gen/voc), suitable for
// command-match lookup so players can type any case form to refer to a target.
// Returns lowercase strings; localized objects are flattened to all their string values.
export function allNameVariants(source) {
  if (!source) return [];
  const out = [];
  const push = (v) => {
    if (v == null) return;
    if (typeof v === 'string') out.push(v.toLowerCase());
    else if (typeof v === 'object') {
      for (const s of Object.values(v)) {
        if (typeof s === 'string') out.push(s.toLowerCase());
      }
    }
  };
  push(source.name);
  for (const f of ['nameAcc', 'nameDat', 'nameGen', 'nameVoc']) push(source[f]);
  if (source.nameForms && typeof source.nameForms === 'object') {
    for (const v of Object.values(source.nameForms)) push(v);
  }
  return out;
}

// Pick the best match in `items` for the lowercase `query`, ranked exact > substring > word.
// `getVariants(item)` returns the lowercase strings to consider. Used by every name-fuzzy
// command (find item / actor / spell / equipped wearable) so all of them share one ranking.
export function pickByVariants(items, query, getVariants) {
  const q = query.toLowerCase();
  let exact = null, sub = null, word = null;
  for (const item of items) {
    const variants = getVariants(item);
    if (variants.some(v => v === q)) return item;
    if (sub == null && variants.some(v => v.includes(q))) sub = item;
    if (word == null && variants.some(v => v.split(/\s+/).some(w => w === q))) word = item;
  }
  return exact ?? sub ?? word ?? null;
}

// Build a nameForms object from positional admin args. Empty / nullish entries
// fall back to nominative via resolveName.
export function makeNameForms({ acc, dat, gen, voc } = {}) {
  return {
    acc: typeof acc === 'string' && acc.length ? acc : null,
    dat: typeof dat === 'string' && dat.length ? dat : null,
    gen: typeof gen === 'string' && gen.length ? gen : null,
    voc: typeof voc === 'string' && voc.length ? voc : null,
  };
}
