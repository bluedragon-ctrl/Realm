import path from 'node:path';
import { loadRooms, loadAdmins, loadNpcs, loadSocials, loadItems, loadSpells } from '../persist/contentLoader.js';
import { playerExists, createPlayer } from '../persist/players.js';
import { readJson, listJsonFiles } from '../persist/jsonStore.js';
import { makeNpcActor } from './actors.js';
import { makeItemInstance } from './items.js';
import { nameVariants } from '../i18n.js';

export const START_ROOM = 'home.yard';

export const world = {
  rooms: new Map(),
  npcDefs: new Map(),
  socials: new Map(),
  itemDefs: new Map(),
  spellDefs: new Map(),
  admins: new Set(),
  actorsByName: new Map(),
  actorsByRoom: new Map(),
  itemsByRoom: new Map(),
  npcsByInstance: new Map(),
  unlockedExits: new Set(),
};

export function unlockExit(roomId, exitKey) {
  world.unlockedExits.add(`${roomId}:${exitKey}`);
}

export function isExitUnlocked(roomId, exitKey) {
  return world.unlockedExits.has(`${roomId}:${exitKey}`);
}

export function isExitLocked(room, exitKey) {
  const locked = room?.lockedExits;
  if (!locked || !(exitKey in locked)) return false;
  return !isExitUnlocked(room.id, exitKey);
}

export async function loadWorld() {
  world.rooms = await loadRooms();
  world.admins = await loadAdmins();
  world.npcDefs = await loadNpcs(world.rooms);
  world.socials = await loadSocials();
  world.itemDefs = await loadItems(world.rooms);
  world.spellDefs = await loadSpells();
  if (!world.rooms.has(START_ROOM)) {
    throw new Error(`start room '${START_ROOM}' not found in content/rooms`);
  }
  for (const adminLower of world.admins) {
    if (!await playerExists(adminLower)) {
      const display = adminLower.charAt(0).toUpperCase() + adminLower.slice(1);
      await createPlayer(display, START_ROOM);
      console.log(`bootstrapped admin character '${display}'`);
    }
  }
  spawnAllNpcs();
  await spawnAllItems();
}

export function countItemsInWorldMemory(defId) {
  let n = 0;
  for (const list of world.itemsByRoom.values()) {
    for (const inst of list) if (inst.defId === defId) n++;
  }
  for (const a of allActors()) {
    if (!a.inventory) continue;
    for (const inst of a.inventory) if (inst.defId === defId) n++;
  }
  return n;
}

export async function countItemsTotal(defId) {
  let n = countItemsInWorldMemory(defId);
  const online = new Set();
  for (const a of world.actorsByName.values()) online.add(a.name.toLowerCase());
  const files = await listJsonFiles(path.resolve('data/players'));
  for (const file of files) {
    try {
      const rec = await readJson(file);
      if (rec?.nameLower && online.has(rec.nameLower)) continue;
      if (Array.isArray(rec?.inventory)) {
        for (const it of rec.inventory) if (it?.defId === defId) n++;
      }
    } catch {
      // skip unreadable file
    }
  }
  return n;
}

export async function spawnAllItems() {
  world.itemsByRoom.clear();
  for (const def of world.itemDefs.values()) {
    if (!def.spawn?.location) continue;
    const cap = def.spawn.count ?? 1;
    const existing = await countItemsTotal(def.id);
    const toSpawn = Math.max(0, cap - existing);
    for (let i = 0; i < toSpawn; i++) {
      const inst = makeItemInstance(def);
      placeItemInRoom(inst, def.spawn.location);
    }
  }
}

export function respawnItemsTick() {
  for (const def of world.itemDefs.values()) {
    if (!def.spawn?.location) continue;
    const cap = def.spawn.count ?? 1;
    const existing = countItemsInWorldMemory(def.id);
    const toSpawn = Math.max(0, cap - existing);
    for (let i = 0; i < toSpawn; i++) {
      const inst = makeItemInstance(def);
      placeItemInRoom(inst, def.spawn.location);
    }
  }
}

export function itemsInRoom(roomId) {
  return world.itemsByRoom.get(roomId) ?? [];
}

export function placeItemInRoom(instance, roomId) {
  if (!world.itemsByRoom.has(roomId)) world.itemsByRoom.set(roomId, []);
  world.itemsByRoom.get(roomId).push(instance);
}

export function removeItemFromRoom(instance, roomId) {
  const list = world.itemsByRoom.get(roomId);
  if (!list) return false;
  const idx = list.indexOf(instance);
  if (idx >= 0) { list.splice(idx, 1); return true; }
  return false;
}

const npcRespawnQueue = [];

export function queueNpcRespawn(defId, ticksFromNow) {
  npcRespawnQueue.push({ defId, ticksRemaining: ticksFromNow });
}

export function processNpcRespawns() {
  for (let i = npcRespawnQueue.length - 1; i >= 0; i--) {
    npcRespawnQueue[i].ticksRemaining--;
    if (npcRespawnQueue[i].ticksRemaining > 0) continue;
    const def = world.npcDefs.get(npcRespawnQueue[i].defId);
    npcRespawnQueue.splice(i, 1);
    if (def) {
      const npc = spawnNpc(def);
      // Room refresh handled by caller
      _onNpcRespawn?.(npc);
    }
  }
}

let _onNpcRespawn = null;
export function setNpcRespawnHandler(fn) { _onNpcRespawn = fn; }

export function clearNpcRespawnQueue() {
  npcRespawnQueue.length = 0;
}

export function spawnAllNpcs() {
  for (const def of world.npcDefs.values()) {
    const count = def.count ?? 1;
    for (let i = 0; i < count; i++) spawnNpc(def);
  }
}

export function despawnAllNpcs() {
  for (const npc of [...world.npcsByInstance.values()]) {
    despawnNpc(npc);
  }
}

export function spawnNpc(def) {
  const npc = makeNpcActor(def);
  world.npcsByInstance.set(npc.instanceId, npc);
  placeActor(npc, def.location);
  return npc;
}

export function despawnNpc(npc) {
  if (npc.location && world.actorsByRoom.has(npc.location)) {
    world.actorsByRoom.get(npc.location).delete(npc);
  }
  world.npcsByInstance.delete(npc.instanceId);
}

export function getRoom(id) {
  return world.rooms.get(id);
}

export function actorsInRoom(roomId) {
  return world.actorsByRoom.get(roomId) ?? new Set();
}

export function placeActor(actor, roomId) {
  if (actor.location && world.actorsByRoom.has(actor.location)) {
    world.actorsByRoom.get(actor.location).delete(actor);
  }
  actor.location = roomId;
  if (!world.actorsByRoom.has(roomId)) world.actorsByRoom.set(roomId, new Set());
  world.actorsByRoom.get(roomId).add(actor);
}

export function removeActor(actor) {
  if (actor.location && world.actorsByRoom.has(actor.location)) {
    world.actorsByRoom.get(actor.location).delete(actor);
  }
  if (actor.kind === 'player') {
    world.actorsByName.delete(actor.name.toLowerCase());
  } else if (actor.kind === 'npc') {
    world.npcsByInstance.delete(actor.instanceId);
  }
}

export function registerActor(actor) {
  if (actor.kind === 'player') {
    world.actorsByName.set(actor.name.toLowerCase(), actor);
  }
}

export function findActor(name) {
  return world.actorsByName.get(name.toLowerCase());
}

function actorVariants(a) {
  return [...nameVariants(a.name), ...(a.kind === 'npc' ? nameVariants(a.title) : [])];
}

export function findInRoom(roomId, query) {
  const q = query.toLowerCase();
  let exact = null, sub = null, word = null;
  for (const a of actorsInRoom(roomId)) {
    const variants = actorVariants(a);
    for (const v of variants) {
      if (v === q) { exact = a; break; }
    }
    if (exact) break;
    if (sub == null && variants.some(v => v.includes(q))) sub = a;
    if (word == null && variants.some(v => v.split(/\s+/).some(w => w === q))) word = a;
  }
  return exact ?? sub ?? word ?? null;
}

export function playersInRoom(roomId) {
  const out = [];
  for (const a of actorsInRoom(roomId)) {
    if (a.kind === 'player' && a.session) out.push(a);
  }
  return out;
}

export function broadcastToRoom(roomId, msgOrBuilder, except = null) {
  for (const a of actorsInRoom(roomId)) {
    if (a === except) continue;
    if (!a.session) continue;
    let msg;
    try {
      msg = typeof msgOrBuilder === 'function' ? msgOrBuilder(a) : msgOrBuilder;
    } catch (err) {
      console.error(`broadcast builder failed for ${a.name} in ${roomId}:`, err);
      continue;
    }
    if (msg) a.session.send(msg);
  }
}

export function* allActors() {
  for (const a of world.actorsByName.values()) yield a;
  for (const a of world.npcsByInstance.values()) yield a;
}

export function isAdmin(name) {
  return world.admins.has(name.toLowerCase());
}
