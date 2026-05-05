// Dice formula evaluator.
// Supports: integer literals, XdY rolls, +/- chains, *N and /N postfix modifiers,
// and stat variables (ATK/DEF/INT/HP/MP/MR). Variables resolve against ctx.actor.stats.
// /N is integer division (floor toward -inf via Math.floor). Whitespace is ignored.

const DICE_RE = /^(\d+)d(\d+)/i;
const NUM_RE = /^(\d+)/;
const VAR_RE = /^(ATK|DEF|INT|HP|MP|MR|ACC|EVA)/i;
const SIGN_RE = /^([+\-])/;
const MULDIV_RE = /^([*\/])(\d+)/;

function varValue(name, ctx) {
  const a = ctx.actor;
  if (!a?.stats) return 0;
  switch (name.toUpperCase()) {
    case 'ATK': return a.stats.attack ?? 0;
    case 'DEF': return a.stats.defense ?? 0;
    case 'INT': return a.stats.int ?? 0;
    case 'HP':  return a.stats.hp ?? 0;
    case 'MP':  return a.stats.mp ?? 0;
    case 'MR':  return a.stats.magicResist ?? 0;
    case 'ACC': return a.stats.accuracy ?? 0;
    case 'EVA': return a.stats.evasion ?? 0;
    default:    return 0;
  }
}

function readTerm(str, ctx) {
  const dm = str.match(DICE_RE);
  if (dm) {
    const n = +dm[1], d = +dm[2];
    let r = 0;
    for (let i = 0; i < n; i++) r += 1 + Math.floor(Math.random() * d);
    return { value: r, rest: str.slice(dm[0].length) };
  }
  const nm = str.match(NUM_RE);
  if (nm) return { value: +nm[1], rest: str.slice(nm[0].length) };
  const vm = str.match(VAR_RE);
  if (vm) return { value: varValue(vm[1], ctx), rest: str.slice(vm[0].length) };
  return null;
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

    const term = readTerm(str, ctx);
    if (!term) { str = str.slice(1); continue; }
    let value = term.value;
    str = term.rest;

    while (true) {
      const md = str.match(MULDIV_RE);
      if (!md) break;
      const n = +md[2];
      if (md[1] === '*') value = value * n;
      else value = n === 0 ? 0 : Math.floor(value / n);
      str = str.slice(md[0].length);
    }

    total += sign * value;
    sign = 1;
  }
  return total;
}

export function formulaRange(formula, ctx = {}) {
  if (typeof formula === 'number') return { min: formula, max: formula };
  if (typeof formula !== 'string') return { min: 0, max: 0 };
  let str = formula.replace(/\s+/g, '');
  let totalMin = 0, totalMax = 0;
  let sign = 1;
  while (str.length) {
    const sm = str.match(SIGN_RE);
    if (sm) { sign = sm[1] === '-' ? -1 : 1; str = str.slice(1); continue; }

    let lo, hi;
    const dm = str.match(DICE_RE);
    if (dm) {
      const n = +dm[1], d = +dm[2];
      lo = n; hi = n * d;
      str = str.slice(dm[0].length);
    } else {
      const nm = str.match(NUM_RE);
      if (nm) { lo = hi = +nm[1]; str = str.slice(nm[0].length); }
      else {
        const vm = str.match(VAR_RE);
        if (vm) { lo = hi = varValue(vm[1], ctx); str = str.slice(vm[0].length); }
        else { str = str.slice(1); continue; }
      }
    }

    while (true) {
      const md = str.match(MULDIV_RE);
      if (!md) break;
      const n = +md[2];
      if (md[1] === '*') { lo *= n; hi *= n; }
      else { lo = n === 0 ? 0 : Math.floor(lo / n); hi = n === 0 ? 0 : Math.floor(hi / n); }
      str = str.slice(md[0].length);
    }

    if (sign < 0) { const t = lo; lo = -hi; hi = -t; }
    totalMin += lo;
    totalMax += hi;
    sign = 1;
  }
  return { min: totalMin, max: totalMax };
}
