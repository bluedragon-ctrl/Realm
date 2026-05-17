// Item category + fixture-accepts derivation. Centralized so inventory payloads
// and room payloads stay in sync.

import { ITEM_CATEGORIES } from './contentMeta.js';

// Resolve an item def's display category.
// Authored `def.category` wins; otherwise we derive from existing flags/tags so most
// content needs no edits. Priority is most-specific-first.
export function categoryOf(def) {
  if (def.category && ITEM_CATEGORIES.has(def.category)) return def.category;
  const tags = Array.isArray(def.tags) ? def.tags : [];
  if (tags.includes('key')) return 'key';
  if (def.wearable) return 'gear';
  if (tags.includes('quest')) return 'quest';
  if (tags.includes('reagent')) return 'reagent';
  if (tags.includes('tool')) return 'tool';
  if (def.use?.consumable) return 'consumable';
  if (tags.includes('food')) return 'food';
  return 'misc';
}

// List of item defIds this fixture can meaningfully be combined with via `use X on FIX`.
// Mirrors the server-side resolution in actions/use.js (unlock by key, or craft input).
export function acceptsFor(def) {
  const out = new Set();
  if (def.unlocks?.key) out.add(def.unlocks.key);
  if (Array.isArray(def.exchanges)) {
    for (const ex of def.exchanges) {
      if (!Array.isArray(ex.inputs)) continue;
      for (const input of ex.inputs) {
        if (input?.item) out.add(input.item);
      }
    }
  }
  return [...out];
}
