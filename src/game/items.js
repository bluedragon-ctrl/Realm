import { nameVariants } from '../i18n.js';
import { allNameVariants } from './declension.js';

let nextItemInstanceId = 1;

export function makeItemInstance(def, state = {}) {
  return {
    instanceId: nextItemInstanceId++,
    defId: def.id,
    def,
    state,
  };
}

export function instanceFromSaved(saved, defs) {
  const def = defs.get(saved.defId);
  if (!def) return null;
  return makeItemInstance(def, saved.state ?? {});
}

export function serializeInstance(inst) {
  return { defId: inst.defId, state: inst.state ?? {} };
}

export function serializeInventory(list) {
  return list.map(serializeInstance);
}

function itemMatches(inst, q) {
  const variants = [
    ...allNameVariants(inst.def),
    ...nameVariants(inst.def.title),
    inst.defId.toLowerCase(),
  ];
  if (variants.some(v => v === q)) return 'exact';
  if (variants.some(v => v.includes(q))) return 'substring';
  for (const v of variants) {
    if (v.split(/\s+/).some(word => word === q)) return 'word';
  }
  return null;
}

export function findItemInList(list, query) {
  const q = query.toLowerCase();
  let exact = null, sub = null, word = null;
  for (const inst of list) {
    const m = itemMatches(inst, q);
    if (m === 'exact' && !exact) exact = inst;
    else if (m === 'substring' && !sub) sub = inst;
    else if (m === 'word' && !word) word = inst;
  }
  return exact ?? sub ?? word ?? null;
}

export function removeFromList(list, instance) {
  const idx = list.indexOf(instance);
  if (idx >= 0) list.splice(idx, 1);
  return idx >= 0;
}

export function transferItem(sourceList, targetList, instance) {
  if (!removeFromList(sourceList, instance)) return false;
  targetList.push(instance);
  return true;
}

export function splitOnKeyword(args, keyword) {
  const idx = args.findIndex(w => w.toLowerCase() === keyword);
  if (idx > 0 && idx < args.length - 1) {
    return { before: args.slice(0, idx).join(' '), after: args.slice(idx + 1).join(' ') };
  }
  return null;
}
