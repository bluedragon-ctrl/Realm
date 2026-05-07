import { actorsInRoom } from './world.js';

export function roomEnemiesOf(actor) {
  const out = [];
  if (!actor?.location) return out;
  if (actor.kind === 'player') {
    for (const a of actorsInRoom(actor.location)) {
      if (a.kind === 'npc' && a.disposition === 'hostile' && a.alive !== false && a.stats?.hp > 0) out.push(a);
    }
  } else if (actor.kind === 'npc') {
    for (const a of actorsInRoom(actor.location)) {
      if (a.kind === 'player' && a.session && a.stats?.hp > 0) out.push(a);
    }
  }
  return out;
}

export function roomFriendliesOf(actor) {
  const out = [];
  if (!actor?.location) return out;
  if (actor.kind === 'player') {
    for (const a of actorsInRoom(actor.location)) {
      if (a.kind === 'player' && a.stats?.hp > 0) out.push(a);
    }
  } else if (actor.kind === 'npc') {
    for (const a of actorsInRoom(actor.location)) {
      if (a.kind === 'npc' && a.alive !== false && a.stats?.hp > 0) out.push(a);
    }
  }
  return out;
}
