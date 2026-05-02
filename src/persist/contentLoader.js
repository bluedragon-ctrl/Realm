import path from 'node:path';
import { readJson, listJsonFiles } from './jsonStore.js';
import { SUPPORTED_LANGS } from '../i18n.js';

const KNOWN_PRIMITIVES = new Set(['say', 'emote', 'wait', 'move', 'attack', 'cast', 'interact', 'give_item', 'flee']);
const KNOWN_DISPOSITIONS = new Set(['friendly', 'neutral', 'hostile']);

function isLocalizedText(v) {
  return typeof v === 'string' || (v && typeof v === 'object' && !Array.isArray(v));
}

function validateLines(lines, ctx) {
  if (Array.isArray(lines)) return;
  if (lines && typeof lines === 'object') {
    let refLen = null;
    for (const lang of Object.keys(lines)) {
      if (!Array.isArray(lines[lang])) {
        throw new Error(`${ctx}: 'lines.${lang}' must be an array`);
      }
      if (refLen == null) refLen = lines[lang].length;
      else if (lines[lang].length !== refLen) {
        console.warn(`${ctx}: 'lines.${lang}' length (${lines[lang].length}) does not match other languages (${refLen})`);
      }
    }
    return;
  }
  throw new Error(`${ctx}: 'lines' must be an array or object of arrays`);
}

export async function loadRooms() {
  const files = await listJsonFiles(path.resolve('content/rooms'));
  const rooms = new Map();
  for (const file of files) {
    const data = await readJson(file);
    if (!data.id) throw new Error(`room missing id: ${file}`);
    if (rooms.has(data.id)) throw new Error(`duplicate room id '${data.id}' in ${file}`);
    rooms.set(data.id, data);
  }
  for (const room of rooms.values()) {
    for (const [exitCmd, targetId] of Object.entries(room.exits ?? {})) {
      if (!rooms.has(targetId)) {
        throw new Error(`room '${room.id}' exit '${exitCmd}' -> unknown room '${targetId}'`);
      }
    }
  }
  return rooms;
}

function validateNpc(def, file, knownRooms) {
  if (!def.id) throw new Error(`npc missing id: ${file}`);
  if (!isLocalizedText(def.name)) throw new Error(`npc '${def.id}' missing or invalid name (${file})`);
  if (!def.location) throw new Error(`npc '${def.id}' missing location (${file})`);
  if (!knownRooms.has(def.location)) {
    throw new Error(`npc '${def.id}' location '${def.location}' is not a known room (${file})`);
  }
  if (def.disposition && !KNOWN_DISPOSITIONS.has(def.disposition)) {
    throw new Error(`npc '${def.id}' has unknown disposition '${def.disposition}' (${file})`);
  }
  if (def.count != null && (typeof def.count !== 'number' || def.count < 1 || !Number.isInteger(def.count))) {
    throw new Error(`npc '${def.id}' count must be a positive integer (${file})`);
  }
  const behaviors = def.behaviors ?? [];
  if (!Array.isArray(behaviors)) {
    throw new Error(`npc '${def.id}' behaviors must be an array (${file})`);
  }
  for (const [i, b] of behaviors.entries()) {
    if (!KNOWN_PRIMITIVES.has(b.primitive)) {
      throw new Error(`npc '${def.id}' behavior #${i} has unknown primitive '${b.primitive}' (${file})`);
    }
    if (b.primitive === 'say' || b.primitive === 'emote') {
      validateLines(b.lines, `npc '${def.id}' behavior #${i}`);
    }
    if (b.primitive === 'interact' || b.primitive === 'give_item' || b.primitive === 'flee') {
      validateLines(b.templates, `npc '${def.id}' behavior #${i}`);
    }
  }
}

function validateItem(def, file, knownRooms) {
  if (!def.id) throw new Error(`item missing id: ${file}`);
  if (!isLocalizedText(def.name)) throw new Error(`item '${def.id}' missing or invalid name (${file})`);
  if (def.spawn?.location && !knownRooms.has(def.spawn.location)) {
    throw new Error(`item '${def.id}' spawn location '${def.spawn.location}' is not a known room (${file})`);
  }
}

export async function loadItems(knownRooms) {
  const files = await listJsonFiles(path.resolve('content/items'));
  const items = new Map();
  for (const file of files) {
    const def = await readJson(file);
    validateItem(def, file, knownRooms);
    if (items.has(def.id)) throw new Error(`duplicate item id '${def.id}' in ${file}`);
    items.set(def.id, def);
  }
  return items;
}

export async function loadNpcs(knownRooms) {
  const files = await listJsonFiles(path.resolve('content/npcs'));
  const npcs = new Map();
  for (const file of files) {
    const def = await readJson(file);
    validateNpc(def, file, knownRooms);
    if (npcs.has(def.id)) throw new Error(`duplicate npc id '${def.id}' in ${file}`);
    npcs.set(def.id, def);
  }
  return npcs;
}

const KNOWN_SPELL_TARGETS = new Set(['self', 'friendly', 'hostile', 'any']);

function validateSpell(def, file) {
  if (!def.id) throw new Error(`spell missing id: ${file}`);
  if (!isLocalizedText(def.name)) throw new Error(`spell '${def.id}' missing or invalid name (${file})`);
  if (!def.verb || typeof def.verb !== 'object') {
    throw new Error(`spell '${def.id}' missing 'verb' block (${file})`);
  }
  if (def.target != null && !KNOWN_SPELL_TARGETS.has(def.target)) {
    throw new Error(`spell '${def.id}' has unknown target '${def.target}' (must be one of: ${[...KNOWN_SPELL_TARGETS].join(', ')}) (${file})`);
  }
}

export async function loadSpells() {
  const files = await listJsonFiles(path.resolve('content/spells'));
  const spells = new Map();
  for (const file of files) {
    const def = await readJson(file);
    validateSpell(def, file);
    if (spells.has(def.id)) throw new Error(`duplicate spell id '${def.id}' in ${file}`);
    spells.set(def.id, def);
  }
  return spells;
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
