// Floor items per room + spawn cap accounting.
// Cap is enforced at boot across rooms+inventories+offline player files; the in-memory
// `respawnItemsTick` only tops up against rooms+online inventories.

import path from 'node:path';
import { world } from './state.js';
import { allActors } from './actors.js';
import { readJson, listJsonFiles } from '../../persist/jsonStore.js';
import { makeItemInstance } from '../items.js';

export function itemsInRoom(roomId) {
  return world.itemsByRoom.get(roomId) ?? [];
}

export function getGoldInRoom(roomId) {
  return world.goldByRoom.get(roomId) ?? 0;
}

export function addGoldToRoom(roomId, amount) {
  const n = Math.max(0, Math.floor(amount));
  if (n <= 0) return 0;
  const cur = world.goldByRoom.get(roomId) ?? 0;
  world.goldByRoom.set(roomId, cur + n);
  return cur + n;
}

export function clearGoldInRoom(roomId) {
  const cur = world.goldByRoom.get(roomId) ?? 0;
  world.goldByRoom.delete(roomId);
  return cur;
}

export function takeGoldFromRoom(roomId, amount) {
  const cur = world.goldByRoom.get(roomId) ?? 0;
  const take = Math.min(cur, Math.max(0, Math.floor(amount)));
  if (take <= 0) return 0;
  if (cur - take <= 0) world.goldByRoom.delete(roomId);
  else world.goldByRoom.set(roomId, cur - take);
  return take;
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

export function countItemsInRoomMemory(defId, roomId) {
  const list = world.itemsByRoom.get(roomId);
  if (!list) return 0;
  let n = 0;
  for (const inst of list) if (inst.defId === defId) n++;
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
    if (def.spawn?.locations) {
      for (const [roomId, perRoomCap] of Object.entries(def.spawn.locations)) {
        for (let i = 0; i < perRoomCap; i++) {
          placeItemInRoom(makeItemInstance(def), roomId);
        }
      }
      continue;
    }
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
    if (def.spawn?.locations) {
      for (const [roomId, perRoomCap] of Object.entries(def.spawn.locations)) {
        const existing = countItemsInRoomMemory(def.id, roomId);
        const toSpawn = Math.max(0, perRoomCap - existing);
        for (let i = 0; i < toSpawn; i++) {
          placeItemInRoom(makeItemInstance(def), roomId);
        }
      }
      continue;
    }
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
