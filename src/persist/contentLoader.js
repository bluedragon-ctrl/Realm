// Content loaders. Each `load*` walks `content/<kind>/` recursively, validates every JSON file,
// and returns a Map<id, def>. Per-kind validators live under `validators/`. Validation throws
// on first error so misconfigured content fails at boot.

import path from 'node:path';
import { readJson, listJsonFiles } from './jsonStore.js';
import { SUPPORTED_LANGS } from '../i18n.js';
import { validateRoomGraph } from './validators/room.js';
import { makeNpcValidator } from './validators/npc.js';
import { makeItemValidator, validateItemInteractions } from './validators/item.js';
import { makeSpellValidator } from './validators/spell.js';
import { validateEffect } from './validators/effect.js';
import { makeQuestValidator } from './validators/quest.js';

export { validateAllExchanges } from './validators/exchange.js';

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

export async function loadRooms() {
  const rooms = await loadDir('room', path.resolve('content/rooms'));
  validateRoomGraph(rooms);
  return rooms;
}

export async function loadNpcs(knownRooms) {
  const npcs = await loadDir('npc', path.resolve('content/npcs'), makeNpcValidator(knownRooms));
  for (const def of npcs.values()) {
    for (const b of def.behaviors ?? []) {
      if (b.primitive === 'summon' && !npcs.has(b.spawn)) {
        throw new Error(`npc '${def.id}': summon.spawn references unknown npc '${b.spawn}'`);
      }
    }
  }
  return npcs;
}

export async function loadItems(knownRooms, knownEffects, knownNpcs) {
  const effects = knownEffects ?? new Map();
  const items = await loadDir('item', path.resolve('content/items'), makeItemValidator(knownRooms, effects));
  validateItemInteractions(items, knownRooms, knownNpcs ?? new Map());
  for (const room of knownRooms.values()) {
    if (room.hiddenFixtures) {
      for (const defId of Object.keys(room.hiddenFixtures)) {
        if (!items.has(defId)) {
          throw new Error(`room '${room.id}': hiddenFixtures references unknown item '${defId}'`);
        }
      }
    }
    if (room.exitRequires) {
      for (const [exitKey, req] of Object.entries(room.exitRequires)) {
        const defId = req.equipped;
        const def = items.get(defId);
        if (!def) {
          throw new Error(`room '${room.id}': exits.${exitKey}.requires.equipped references unknown item '${defId}'`);
        }
        if (!def.wearable?.slot) {
          throw new Error(`room '${room.id}': exits.${exitKey}.requires.equipped item '${defId}' is not wearable`);
        }
      }
    }
  }
  return items;
}

export async function loadSpells(knownEffects, knownNpcs) {
  const validate = makeSpellValidator(knownEffects ?? new Map(), knownNpcs ?? new Map());
  return loadDir('spell', path.resolve('content/spells'), validate);
}

export async function loadQuests(knownRooms, knownNpcs, knownItems) {
  const validate = makeQuestValidator(knownRooms, knownNpcs ?? new Map(), knownItems ?? new Map());
  return loadDir('quest', path.resolve('content/quests'), validate, { missingDirOk: true });
}

export async function loadEffects() {
  return loadDir('effect', path.resolve('content/effects'), validateEffect, { missingDirOk: true });
}

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
