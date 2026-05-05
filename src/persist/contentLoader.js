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
    checkRequired(def.location, ctx, 'location');
    check(knownRooms.has(def.location), ctx, `location '${def.location}' is not a known room`);
    checkEnum(def.disposition, DISPOSITIONS, ctx, 'disposition');
    checkPositiveInt(def.count, ctx, 'count');

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
  };
}

export async function loadNpcs(knownRooms) {
  return loadDir('npc', path.resolve('content/npcs'), makeNpcValidator(knownRooms));
}

// ---------- items ----------

function makeItemValidator(knownRooms, knownEffects) {
  return (def, file) => {
    const ctx = `item '${def.id}' (${path.basename(file)})`;
    checkLocalizedText(def.name, ctx, 'name');
    if (def.spawn?.location) {
      check(knownRooms.has(def.spawn.location), ctx, `spawn.location '${def.spawn.location}' is not a known room`);
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
    if (def.recipes != null) {
      checkObject(def.recipes, ctx, 'recipes');
      for (const [reagentId, spec] of Object.entries(def.recipes)) {
        check(items.has(reagentId), ctx, `recipe references unknown reagent '${reagentId}'`);
        check(spec.produces && items.has(spec.produces), ctx,
          `recipe[${reagentId}].produces references unknown item '${spec.produces}'`);
        checkObject(spec.verb, ctx, `recipe[${reagentId}].verb`);
      }
    }
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
