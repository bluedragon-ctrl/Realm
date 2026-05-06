// Content loaders. Each `load*` walks `content/<kind>/` recursively, validates every JSON file,
// and returns a Map<id, def>. Validation throws on first error so misconfigured content fails at boot.
// Schema-level constants (allowed enums) live next to their behavior in `*Meta.js` modules.

import path from 'node:path';
import { readJson, listJsonFiles } from './jsonStore.js';
import { SUPPORTED_LANGS } from '../i18n.js';
import {
  check, checkRequired, checkEnum, checkLocalizedText,
  checkPositiveInt, checkObject, checkArray, checkLines,
} from './validate.js';
import { PRIMITIVE_NAMES, DISPOSITIONS } from '../game/npcMeta.js';
import { WEARABLE_SLOT_SET, ALLOWED_BONUS_KEYS } from '../game/wearableMeta.js';
import { SPELL_TARGETS } from '../game/spellMeta.js';
import { EFFECT_KINDS, EFFECT_STACKS, TICK_EFFECT_TYPES } from '../game/effectMeta.js';

function assertFilenameMatchesId(kind, def, file) {
  const expected = path.basename(file, '.json');
  if (def.id !== expected) {
    throw new Error(`${kind} filename/id mismatch: '${path.basename(file)}' has id '${def.id}' (expected file '${def.id}.json')`);
  }
}

// Generic discover/validate/dedupe pipeline used by every content kind.
//   kind         — label used in error messages ('room', 'npc', ...)
//   dir          — directory to walk (recursive)
//   validate     — (def, file) => void; throws on failure. May be omitted.
//   missingDirOk — return empty Map if the directory doesn't exist
async function loadDir(kind, dir, validate, { missingDirOk = false } = {}) {
  let files;
  try {
    files = await listJsonFiles(dir);
  } catch (err) {
    if (missingDirOk && err.code === 'ENOENT') return new Map();
    throw err;
  }
  const map = new Map();
  for (const file of files) {
    const def = await readJson(file);
    if (!def.id) throw new Error(`${kind} missing id: ${file}`);
    assertFilenameMatchesId(kind, def, file);
    if (map.has(def.id)) throw new Error(`duplicate ${kind} id '${def.id}' in ${file}`);
    if (validate) validate(def, file);
    map.set(def.id, def);
  }
  return map;
}

// ---------- rooms ----------

export async function loadRooms() {
  const rooms = await loadDir('room', path.resolve('content/rooms'));
  for (const room of rooms.values()) {
    const ctx = `room '${room.id}'`;
    for (const [exitCmd, targetId] of Object.entries(room.exits ?? {})) {
      check(rooms.has(targetId), ctx, `exit '${exitCmd}' -> unknown room '${targetId}'`);
    }
    if (room.lockedExits != null) {
      checkObject(room.lockedExits, ctx, 'lockedExits');
      for (const exitKey of Object.keys(room.lockedExits)) {
        check(exitKey in (room.exits ?? {}), ctx, `lockedExits references unknown exit '${exitKey}'`);
      }
    }
  }
  return rooms;
}

// ---------- npcs ----------

function makeNpcValidator(knownRooms) {
  return (def, file) => {
    const ctx = `npc '${def.id}' (${path.basename(file)})`;
    checkLocalizedText(def.name, ctx, 'name');
    if (def.locations) {
      checkObject(def.locations, ctx, 'locations');
      for (const [roomId, n] of Object.entries(def.locations)) {
        check(knownRooms.has(roomId), ctx, `locations key '${roomId}' is not a known room`);
        check(typeof n === 'number' && n >= 1 && Number.isInteger(n), ctx,
          `locations['${roomId}'] must be a positive integer`);
      }
      check(!def.location, ctx, `location and locations are mutually exclusive`);
      check(def.count == null, ctx, `count is not used when locations is set`);
    } else {
      checkRequired(def.location, ctx, 'location');
      check(knownRooms.has(def.location), ctx, `location '${def.location}' is not a known room`);
      checkPositiveInt(def.count, ctx, 'count');
    }
    checkEnum(def.disposition, DISPOSITIONS, ctx, 'disposition');
    if (def.spawn?.requires) {
      check(def.spawn.requires === 'room_clear', ctx,
        `spawn.requires must be 'room_clear' (got '${def.spawn.requires}')`);
    }

    const behaviors = def.behaviors ?? [];
    checkArray(behaviors, ctx, 'behaviors');
    for (const [i, b] of behaviors.entries()) {
      const bctx = `${ctx} behavior #${i}`;
      check(PRIMITIVE_NAMES.has(b.primitive), bctx, `unknown primitive '${b.primitive}'`);
      if (b.primitive === 'say' || b.primitive === 'emote') checkLines(b.lines, bctx);
      if (b.primitive === 'interact' || b.primitive === 'give_item' || b.primitive === 'flee') {
        checkLines(b.templates, bctx);
      }
    }

    check(def.shop == null, ctx, `'shop' is no longer supported — use 'exchanges'`);
  };
}

export async function loadNpcs(knownRooms) {
  return loadDir('npc', path.resolve('content/npcs'), makeNpcValidator(knownRooms));
}

const ALLOWED_FLAVORS = new Set(['buy', 'sell', 'craft']);

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

// ---------- items ----------

function makeItemValidator(knownRooms, knownEffects) {
  return (def, file) => {
    const ctx = `item '${def.id}' (${path.basename(file)})`;
    checkLocalizedText(def.name, ctx, 'name');
    if (def.spawn?.location) {
      check(knownRooms.has(def.spawn.location), ctx, `spawn.location '${def.spawn.location}' is not a known room`);
    }
    if (def.spawn?.locations) {
      checkObject(def.spawn.locations, ctx, 'spawn.locations');
      for (const [roomId, n] of Object.entries(def.spawn.locations)) {
        check(knownRooms.has(roomId), ctx, `spawn.locations key '${roomId}' is not a known room`);
        check(typeof n === 'number' && n >= 1 && Number.isInteger(n), ctx,
          `spawn.locations['${roomId}'] must be a positive integer`);
      }
      check(!def.spawn.location, ctx, `spawn.location and spawn.locations are mutually exclusive`);
    }
    if (def.wearable != null) {
      checkObject(def.wearable, ctx, 'wearable');
      check(WEARABLE_SLOT_SET.has(def.wearable.slot), ctx,
        `wearable.slot must be one of: ${[...WEARABLE_SLOT_SET].join(', ')}`);
      const bonus = def.wearable.bonus ?? {};
      checkObject(bonus, ctx, 'wearable.bonus');
      for (const [k, v] of Object.entries(bonus)) {
        check(ALLOWED_BONUS_KEYS.has(k), ctx,
          `wearable.bonus has unknown stat '${k}' (allowed: ${[...ALLOWED_BONUS_KEYS].join(', ')})`);
        check(typeof v === 'number', ctx, `wearable.bonus.${k} must be a number`);
      }
      if (def.wearable.effects != null) {
        checkArray(def.wearable.effects, ctx, 'wearable.effects');
        for (const eid of def.wearable.effects) {
          check(typeof eid === 'string' && knownEffects.has(eid), ctx,
            `wearable.effects references unknown effect '${eid}'`);
        }
      }
      if (def.wearable.onHit != null) {
        const hits = Array.isArray(def.wearable.onHit) ? def.wearable.onHit : [def.wearable.onHit];
        for (const hit of hits) {
          checkObject(hit, ctx, 'wearable.onHit');
          check(typeof hit.applyEffect === 'string' && knownEffects.has(hit.applyEffect), ctx,
            `wearable.onHit.applyEffect references unknown effect '${hit.applyEffect}'`);
        }
      }
      if (def.wearable.damage != null) {
        check(def.wearable.slot === 'weapon', ctx,
          `wearable.damage is only valid on weapons (slot=weapon)`);
        check(typeof def.wearable.damage === 'string' && def.wearable.damage.length > 0, ctx,
          `wearable.damage must be a non-empty dice formula string`);
      }
      if (def.wearable.cost != null) {
        check(def.wearable.slot === 'weapon', ctx,
          `wearable.cost is only valid on weapons (slot=weapon)`);
        check(Number.isInteger(def.wearable.cost) && def.wearable.cost > 0, ctx,
          `wearable.cost must be a positive integer`);
      }
    }
    if (def.use?.effect?.type === 'apply_effect') {
      const eid = def.use.effect.effectId;
      check(eid && knownEffects.has(eid), ctx, `use.effect references unknown effect '${eid}'`);
    }
  };
}

function validateItemInteractions(items, knownRooms) {
  for (const def of items.values()) {
    const ctx = `item '${def.id}'`;
    if (def.unlocks != null) {
      const u = def.unlocks;
      checkObject(u, ctx, 'unlocks');
      check(typeof u.exit === 'string', ctx, 'unlocks.exit must be a string');
      check(u.key && items.has(u.key), ctx, `unlocks.key references unknown item '${u.key}'`);
      checkObject(u.verb, ctx, 'unlocks.verb');
      const roomId = def.spawn?.location;
      if (roomId) {
        const room = knownRooms.get(roomId);
        const declared = room?.lockedExits?.[u.exit];
        check(declared === def.id, ctx,
          `unlocks exit '${u.exit}' but room '${roomId}' lockedExits.${u.exit} = ${JSON.stringify(declared ?? null)} (expected '${def.id}')`);
      }
    }
    check(def.recipes == null, ctx, `'recipes' is no longer supported — use 'exchanges'`);
  }
}

export async function loadItems(knownRooms, knownEffects) {
  const effects = knownEffects ?? new Map();
  const items = await loadDir('item', path.resolve('content/items'), makeItemValidator(knownRooms, effects));
  validateItemInteractions(items, knownRooms);
  return items;
}

// ---------- spells ----------

function makeSpellValidator(knownEffects) {
  return (def, file) => {
    const ctx = `spell '${def.id}' (${path.basename(file)})`;
    checkLocalizedText(def.name, ctx, 'name');
    checkObject(def.verb, ctx, 'verb');
    checkRequired(def.verb, ctx, 'verb');
    checkEnum(def.target, SPELL_TARGETS, ctx, 'target');
    if (def.effect?.type === 'apply_effect') {
      const eid = def.effect.effectId;
      check(eid && knownEffects.has(eid), ctx, `applies unknown effect '${eid}'`);
    }
  };
}

export async function loadSpells(knownEffects) {
  return loadDir('spell', path.resolve('content/spells'), makeSpellValidator(knownEffects ?? new Map()));
}

// ---------- effects ----------

function validateEffect(def, file) {
  const ctx = `effect '${def.id}' (${path.basename(file)})`;
  checkLocalizedText(def.name, ctx, 'name');
  checkEnum(def.kind, EFFECT_KINDS, ctx, 'kind');
  checkEnum(def.stack, EFFECT_STACKS, ctx, 'stack');
  if (def.tick != null) {
    checkObject(def.tick, ctx, 'tick');
    check(typeof def.tick.every === 'number' && def.tick.every >= 1, ctx, 'tick.every must be a positive number');
    if (def.tick.pulses != null) {
      check(typeof def.tick.pulses === 'number' && def.tick.pulses >= 1, ctx, 'tick.pulses must be a positive number when set');
    }
    checkObject(def.tick.effect, ctx, 'tick.effect');
    check(def.tick.effect && TICK_EFFECT_TYPES.has(def.tick.effect.type), ctx,
      `tick.effect.type must be one of: ${[...TICK_EFFECT_TYPES].join(', ')}`);
  }
  if (def.duration != null) {
    check(typeof def.duration === 'number' && def.duration >= 1 && Number.isInteger(def.duration),
      ctx, 'duration must be a positive integer (ticks)');
  }
  if (def.statMod != null) {
    checkObject(def.statMod, ctx, 'statMod');
    for (const [k, v] of Object.entries(def.statMod)) {
      check(typeof v === 'number', ctx, `statMod.${k} must be a number`);
    }
  }
}

export async function loadEffects() {
  return loadDir('effect', path.resolve('content/effects'), validateEffect, { missingDirOk: true });
}

// ---------- socials ----------

export async function loadSocials() {
  const file = path.resolve('content/socials.json');
  let data;
  try {
    data = await readJson(file);
  } catch (err) {
    if (err.code === 'ENOENT') return new Map();
    throw err;
  }
  const map = new Map();
  for (const [verb, def] of Object.entries(data)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(verb)) {
      throw new Error(`socials: invalid verb '${verb}'`);
    }
    map.set(verb, def);
  }
  return map;
}

// ---------- strings & admins ----------

export async function loadStrings() {
  const dir = path.resolve('content/strings');
  const tables = {};
  for (const lang of SUPPORTED_LANGS) {
    const file = path.join(dir, `${lang}.json`);
    try {
      tables[lang] = await readJson(file);
    } catch (err) {
      if (err.code === 'ENOENT') {
        tables[lang] = {};
        console.warn(`no strings file for language '${lang}' (${file})`);
      } else throw err;
    }
  }
  return tables;
}

export async function loadAdmins() {
  const file = path.resolve('data/admins.json');
  try {
    const data = await readJson(file);
    return new Set(data.map(s => s.toLowerCase()));
  } catch (err) {
    if (err.code === 'ENOENT') return new Set();
    throw err;
  }
}
