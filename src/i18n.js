export const SUPPORTED_LANGS = ['en', 'cs'];
export const DEFAULT_LANG = 'en';

let stringTables = { en: {}, cs: {} };

export function setStringTables(tables) {
  stringTables = { ...stringTables, ...tables };
}

export function normalizeLang(lang) {
  if (!lang || typeof lang !== 'string') return DEFAULT_LANG;
  const lower = lang.toLowerCase();
  return SUPPORTED_LANGS.includes(lower) ? lower : DEFAULT_LANG;
}

export function t(value, lang) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    return value[lang] ?? value[DEFAULT_LANG] ?? Object.values(value).find(v => typeof v === 'string') ?? '';
  }
  return String(value);
}

export function pickListIndex(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? Math.floor(Math.random() * value.length) : 0;
  }
  if (value && typeof value === 'object') {
    const ref = value[DEFAULT_LANG] ?? Object.values(value).find(Array.isArray);
    if (Array.isArray(ref) && ref.length > 0) {
      return Math.floor(Math.random() * ref.length);
    }
  }
  return 0;
}

export function tListAt(value, lang, idx) {
  if (Array.isArray(value)) return value[idx] ?? '';
  if (value && typeof value === 'object') {
    const arr = value[lang] ?? value[DEFAULT_LANG];
    if (Array.isArray(arr) && arr[idx] != null) return arr[idx];
    const fallback = value[DEFAULT_LANG];
    if (Array.isArray(fallback)) return fallback[idx] ?? '';
  }
  return '';
}

export function s(key, lang, params) {
  const langKey = normalizeLang(lang);
  const table = stringTables[langKey] ?? {};
  let str = table[key];
  if (str == null) str = stringTables[DEFAULT_LANG]?.[key];
  if (str == null) str = key;
  if (params) {
    str = str.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ''));
  }
  return str;
}

export function dirName(exitKey, lang) {
  return s(`dir.${exitKey}`, lang);
}

export function nameVariants(value) {
  if (value == null) return [];
  if (typeof value === 'string') return [value.toLowerCase()];
  if (typeof value === 'object') {
    return Object.values(value).filter(v => typeof v === 'string').map(v => v.toLowerCase());
  }
  return [];
}
