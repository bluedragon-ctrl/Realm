// Tiny declarative validator primitives for content loaders.
// Each helper throws on failure with `${ctx}: ${message}` so errors point at the offending def + file.

export function check(cond, ctx, msg) {
  if (!cond) throw new Error(`${ctx}: ${msg}`);
}

export function checkRequired(value, ctx, field) {
  if (value == null) throw new Error(`${ctx}: missing '${field}'`);
}

export function checkEnum(value, allowed, ctx, field) {
  if (value == null) return;
  if (!allowed.has(value)) {
    throw new Error(`${ctx}: '${field}' = '${value}' must be one of: ${[...allowed].join(', ')}`);
  }
}

export function checkLocalizedText(value, ctx, field) {
  const ok = typeof value === 'string' || (value && typeof value === 'object' && !Array.isArray(value));
  if (!ok) throw new Error(`${ctx}: '${field}' must be a string or {lang: string}`);
}

export function checkPositiveInt(value, ctx, field) {
  if (value == null) return;
  if (typeof value !== 'number' || value < 1 || !Number.isInteger(value)) {
    throw new Error(`${ctx}: '${field}' must be a positive integer`);
  }
}

export function checkObject(value, ctx, field) {
  if (value == null) return;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${ctx}: '${field}' must be an object`);
  }
}

export function checkArray(value, ctx, field) {
  if (value == null) return;
  if (!Array.isArray(value)) throw new Error(`${ctx}: '${field}' must be an array`);
}

// Lines may be a flat array, or an object {lang: array} where lang arrays should match length.
export function checkLines(value, ctx) {
  if (Array.isArray(value)) return;
  if (value && typeof value === 'object') {
    let refLen = null;
    for (const lang of Object.keys(value)) {
      if (!Array.isArray(value[lang])) {
        throw new Error(`${ctx}: 'lines.${lang}' must be an array`);
      }
      if (refLen == null) refLen = value[lang].length;
      else if (value[lang].length !== refLen) {
        console.warn(`${ctx}: 'lines.${lang}' length (${value[lang].length}) does not match other languages (${refLen})`);
      }
    }
    return;
  }
  throw new Error(`${ctx}: 'lines' must be an array or object of arrays`);
}
