// Czech (and other Slavic) noun count agreement.
//
// Czech distinguishes three plural classes for counted nouns:
//   1     → singular nominative (1 zlatý)
//   2-4   → plural nominative   (2 zlaté, 3 jablka)
//   0, 5+ → genitive plural     (5 zlatých, 0 jablek)
//
// English doesn't agree this way — only one/many. Helpers below keep call sites
// language-aware so templates can read naturally in both.

export function pluralCs(n, { one, few, many }) {
  const abs = Math.abs(Math.trunc(n));
  if (abs === 1) return one;
  if (abs >= 2 && abs <= 4) return few;
  return many;
}

export function goldPhrase(n, lang) {
  if (lang === 'cs') {
    const word = pluralCs(n, { one: 'zlatý', few: 'zlaté', many: 'zlatých' });
    return `${n} ${word}`;
  }
  return `${n} gold`;
}

// Stat allocation points ("body"). Czech adjective "volný" agrees with the noun.
// English keeps it simple: "1 point" / "N points".
export function pointsPhrase(n, lang) {
  if (lang === 'cs') {
    const word = pluralCs(n, { one: 'bod', few: 'body', many: 'bodů' });
    return `${n} ${word}`;
  }
  return `${n} ${Math.abs(n) === 1 ? 'point' : 'points'}`;
}

// Recognized words for the "gold" noun across supported languages. Used by take/drop/give
// to detect that the player is talking about coins, not an item named "gold".
export const GOLD_WORDS = new Set(['gold', 'coin', 'coins', 'zlato', 'zlaťák', 'zlaťáky', 'mince']);

export function isGoldQuery(args) {
  if (!args.length) return false;
  return args.some(w => GOLD_WORDS.has(w.toLowerCase()));
}

// Parse a two-token "<amount> gold" / "gold <amount>" pair. Returns { amount, word } or null.
export function parseAmountGold(args) {
  if (args.length !== 2) return null;
  const a = args[0].toLowerCase();
  const b = args[1].toLowerCase();
  let amountStr = null, word = null;
  if (/^\d+$/.test(a) && GOLD_WORDS.has(b)) { amountStr = a; word = b; }
  else if (GOLD_WORDS.has(a) && /^\d+$/.test(b)) { amountStr = b; word = a; }
  if (!amountStr) return null;
  const amount = parseInt(amountStr, 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, word };
}

// Same shape as parseAmountGold but accepts the already-joined query string.
export function parseAmountGoldQuery(query) {
  return parseAmountGold(query.trim().split(/\s+/));
}

export function freePointsPhrase(n, lang) {
  if (lang === 'cs') {
    return pluralCs(n, {
      one: `${n} volný bod`,
      few: `${n} volné body`,
      many: `${n} volných bodů`,
    });
  }
  return `${n} free ${Math.abs(n) === 1 ? 'point' : 'points'}`;
}
