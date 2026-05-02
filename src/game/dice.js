// Dice formula evaluator.
// Supports: integer literals, XdY rolls, +/- chains, and stat variables (ATK/DEF/INT/HP/MP).
// Variables resolve against ctx.actor.stats.
// Whitespace is ignored. Unknown characters are skipped.

const DICE_RE = /^(\d+)d(\d+)/i;
const NUM_RE = /^(\d+)/;
const VAR_RE = /^(ATK|DEF|INT|HP|MP)/i;
const SIGN_RE = /^([+\-])/;

function varValue(name, ctx) {
  const a = ctx.actor;
  if (!a?.stats) return 0;
  switch (name.toUpperCase()) {
    case 'ATK': return a.stats.attack ?? 0;
    case 'DEF': return a.stats.defense ?? 0;
    case 'INT': return a.stats.int ?? 0;
    case 'HP':  return a.stats.hp ?? 0;
    case 'MP':  return a.stats.mp ?? 0;
    default:    return 0;
  }
}

export function roll(formula, ctx = {}) {
  if (typeof formula === 'number') return formula;
  if (typeof formula !== 'string') return 0;
  let str = formula.replace(/\s+/g, '');
  let total = 0;
  let sign = 1;
  while (str.length) {
    const sm = str.match(SIGN_RE);
    if (sm) { sign = sm[1] === '-' ? -1 : 1; str = str.slice(1); continue; }

    const dm = str.match(DICE_RE);
    if (dm) {
      const n = +dm[1], d = +dm[2];
      let r = 0;
      for (let i = 0; i < n; i++) r += 1 + Math.floor(Math.random() * d);
      total += sign * r;
      str = str.slice(dm[0].length);
      sign = 1;
      continue;
    }

    const nm = str.match(NUM_RE);
    if (nm) {
      total += sign * Number(nm[1]);
      str = str.slice(nm[0].length);
      sign = 1;
      continue;
    }

    const vm = str.match(VAR_RE);
    if (vm) {
      total += sign * varValue(vm[1], ctx);
      str = str.slice(vm[0].length);
      sign = 1;
      continue;
    }

    str = str.slice(1);
  }
  return total;
}
