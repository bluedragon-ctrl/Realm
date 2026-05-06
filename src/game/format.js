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
