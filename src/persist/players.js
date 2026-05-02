import path from 'node:path';
import { promises as fs } from 'node:fs';
import { readJsonOrNull, writeJsonAtomic } from './jsonStore.js';

const PLAYERS_DIR = path.resolve('data/players');

function fileFor(name) {
  return path.join(PLAYERS_DIR, `${name.toLowerCase()}.json`);
}

export async function loadPlayer(name) {
  return readJsonOrNull(fileFor(name));
}

export async function savePlayer(record) {
  await writeJsonAtomic(fileFor(record.name), record);
}

export async function playerExists(name) {
  try {
    await fs.access(fileFor(name));
    return true;
  } catch {
    return false;
  }
}

export async function createPlayer(name, startLocation, lang = 'en') {
  if (await playerExists(name)) {
    throw new Error(`player '${name}' already exists`);
  }
  const now = new Date().toISOString();
  const record = {
    name,
    nameLower: name.toLowerCase(),
    createdAt: now,
    lastSeen: now,
    location: startLocation,
    lang,
  };
  await savePlayer(record);
  return record;
}
