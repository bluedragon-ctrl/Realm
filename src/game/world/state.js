// Central in-memory world state. Submodules under world/ mutate this object via the
// helpers exported from sibling files; external code imports from `../world.js` (the barrel).

export const START_ROOM = 'home.yard';

// Where players reappear after death. Distinct from START_ROOM (which is the room a brand-new
// character is placed in on first login).
export const RESPAWN_ROOM = 'home.cottage';

export const world = {
  rooms: new Map(),
  npcDefs: new Map(),
  socials: new Map(),
  itemDefs: new Map(),
  spellDefs: new Map(),
  effectDefs: new Map(),
  admins: new Set(),
  actorsByName: new Map(),
  actorsByRoom: new Map(),
  itemsByRoom: new Map(),
  goldByRoom: new Map(),
  npcsByInstance: new Map(),
  unlockedExits: new Set(),
};

export function getRoom(id) {
  return world.rooms.get(id);
}

export function isAdmin(name) {
  return world.admins.has(name.toLowerCase());
}
