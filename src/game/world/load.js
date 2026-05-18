// World boot: load all content, bootstrap admins, spawn NPCs and items.

import { world, START_ROOM } from './state.js';
import { spawnAllNpcs } from './npcs.js';
import { spawnAllItems } from './items.js';
import { loadRooms, loadAdmins, loadNpcs, loadSocials, loadItems, loadSpells, loadEffects, loadQuests, validateAllExchanges, validateItemQuestRumors }
  from '../../persist/contentLoader.js';
import { playerExists, createPlayer } from '../../persist/players.js';

export async function loadWorld() {
  world.rooms = await loadRooms();
  for (const room of world.rooms.values()) {
    room.activeLight = [];
  }
  world.admins = await loadAdmins();
  world.npcDefs = await loadNpcs(world.rooms);
  world.socials = await loadSocials();
  world.effectDefs = await loadEffects();
  world.itemDefs = await loadItems(world.rooms, world.effectDefs, world.npcDefs);
  world.spellDefs = await loadSpells(world.effectDefs, world.npcDefs);
  world.questDefs = await loadQuests(world.rooms, world.npcDefs, world.itemDefs);
  // Exchanges may reference quests via `requires`, so validate after quests load.
  validateAllExchanges(world.npcDefs, world.itemDefs, world.questDefs);
  validateItemQuestRumors(world.itemDefs, world.questDefs);
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
