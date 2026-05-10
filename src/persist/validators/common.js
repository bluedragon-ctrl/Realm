// Shared validator helpers used by per-kind validators.

import { checkLocalizedText } from '../validate.js';

export function checkOptionalNameForms(def, ctx) {
  for (const field of ['nameAcc', 'nameDat', 'nameGen', 'nameVoc']) {
    if (def[field] != null) checkLocalizedText(def[field], ctx, field);
  }
}
