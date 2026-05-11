import { check, checkEnum, checkObject, checkArray } from '../validate.js';

const ALLOWED_FLAVORS = new Set(['buy', 'sell', 'craft', 'sink']);

function validateExchangeSide(side, ctx, label) {
  checkArray(side, ctx, label);
  check(side.length >= 1, ctx, `${label} must contain at least one entry`);
  side.forEach((entry, i) => {
    const ectx = `${label}[${i}]`;
    checkObject(entry, ctx, ectx);
    const hasItem = typeof entry.item === 'string';
    const hasGold = typeof entry.gold === 'number';
    check(hasItem !== hasGold, ctx,
      `${ectx} must have exactly one of 'item' or 'gold'`);
    if (hasGold) {
      check(Number.isInteger(entry.gold) && entry.gold >= 0, ctx,
        `${ectx}.gold must be a non-negative integer`);
    }
    if (hasItem && entry.count != null) {
      check(Number.isInteger(entry.count) && entry.count >= 1, ctx,
        `${ectx}.count must be a positive integer`);
    }
  });
}

export function validateExchanges(host, hostCtx, items) {
  if (host.exchanges == null) return;
  checkArray(host.exchanges, hostCtx, 'exchanges');
  host.exchanges.forEach((entry, i) => {
    const ctx = `${hostCtx} exchanges[${i}]`;
    checkObject(entry, hostCtx, `exchanges[${i}]`);
    check(typeof entry.id === 'string' && entry.id.length > 0, hostCtx,
      `exchanges[${i}].id must be a non-empty string`);
    checkEnum(entry.flavor, ALLOWED_FLAVORS, hostCtx, `exchanges[${i}].flavor`);
    if (entry.flavor === 'sink') {
      check(entry.verb != null, ctx, `sink entries require a 'verb' block`);
      validateExchangeSide(entry.outputs, hostCtx, `exchanges[${i}].outputs`);
    } else {
      validateExchangeSide(entry.inputs, hostCtx, `exchanges[${i}].inputs`);
      validateExchangeSide(entry.outputs, hostCtx, `exchanges[${i}].outputs`);
      for (const side of ['inputs', 'outputs']) {
        for (const e of entry[side]) {
          if (e.item) check(items.has(e.item), ctx,
            `${side} references unknown item '${e.item}'`);
        }
      }
      if (entry.flavor === 'craft') {
        check(entry.verb != null, ctx, `craft entries require a 'verb' block (so onlookers see the action)`);
      }
    }
    if (entry.verb != null) checkObject(entry.verb, ctx, 'verb');
    if (entry.xp != null) {
      check(Number.isInteger(entry.xp) && entry.xp >= 0, ctx,
        'xp must be a non-negative integer');
    }
  });
}

export function validateAllExchanges(npcs, items) {
  const seenIds = new Map();
  const checkHost = (host, kind) => {
    const ctx = `${kind} '${host.id}'`;
    validateExchanges(host, ctx, items);
    for (const entry of host.exchanges ?? []) {
      const owner = `${kind}/${host.id}`;
      const prior = seenIds.get(entry.id);
      if (prior) {
        throw new Error(`duplicate exchange id '${entry.id}' (in ${owner} and ${prior})`);
      }
      seenIds.set(entry.id, owner);
    }
  };
  for (const npc of npcs.values()) checkHost(npc, 'npc');
  for (const item of items.values()) checkHost(item, 'item');
}
