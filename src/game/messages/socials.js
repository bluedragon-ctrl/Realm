// Localized social-button list for the player panel. Cached per language since the
// social registry is static after content load.

import { world } from '../world.js';

const cache = new Map();

export function buildSocialButtons(lang) {
  const cached = cache.get(lang);
  if (cached) return cached;
  const out = [];
  for (const [verb, def] of world.socials) {
    const langDef = def[lang] ?? def.en;
    if (!langDef) continue;
    const en = def.en ?? {};
    const hasToTarget = !!(langDef.to_target ?? en.to_target);
    const hasNoTarget = !!(langDef.no_target ?? en.no_target);
    out.push({
      verb,
      label: langDef.button ?? verb,
      hasToTarget,
      hasNoTarget,
    });
  }
  cache.set(lang, out);
  return out;
}

export function clearSocialButtonCache() {
  cache.clear();
}
