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
    out.push({ verb, label: langDef.button ?? verb });
  }
  cache.set(lang, out);
  return out;
}

export function clearSocialButtonCache() {
  cache.clear();
}
