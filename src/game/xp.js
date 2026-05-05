import { broadcastToRoom } from './world.js';
import { sendStats } from './messages.js';
import { s } from '../i18n.js';

const HP_PER_LEVEL = 2;
const MP_PER_LEVEL = 1;

export function xpToNext(level) {
  return 10 * level * level;
}

export function awardXp(actor, amount, reason = '') {
  if (!actor || actor.kind !== 'player' || !amount || amount <= 0) return;
  if (actor.stats.hp <= 0) return;

  const record = actor.record;
  record.xp = (record.xp ?? 0) + amount;
  record.level = record.level ?? 1;
  actor.dirty = true;

  if (actor.session) {
    actor.session.send({
      kind: 'system',
      tone: 'good',
      text: s('xp.gained', actor.lang, { amount }),
    });
  }

  while (record.xp >= xpToNext(record.level)) {
    record.xp -= xpToNext(record.level);
    record.level += 1;
    levelUp(actor);
  }

  sendStats(actor);
}

function levelUp(actor) {
  const record = actor.record;
  actor.stats.hpMax += HP_PER_LEVEL;
  actor.stats.mpMax += MP_PER_LEVEL;
  actor.stats.hp = actor.stats.hpMax;
  actor.stats.mp = actor.stats.mpMax;
  if (record.baseStats) {
    record.baseStats.hpMax = (record.baseStats.hpMax ?? actor.stats.hpMax) + HP_PER_LEVEL;
    record.baseStats.mpMax = (record.baseStats.mpMax ?? actor.stats.mpMax) + MP_PER_LEVEL;
    record.baseStats.hp = record.baseStats.hpMax;
    record.baseStats.mp = record.baseStats.mpMax;
  }

  if (actor.session) {
    actor.session.send({
      kind: 'system',
      tone: 'levelup',
      text: s('xp.level_up', actor.lang, { level: record.level }),
    });
  }

  if (actor.location) {
    broadcastToRoom(actor.location, (recipient) => ({
      kind: 'system',
      tone: 'levelup',
      text: s('xp.level_up_observed', recipient.lang, {
        name: actor.name,
        level: record.level,
      }),
    }), actor);
  }
}

export function markRoomVisited(actor, roomId) {
  if (!actor || actor.kind !== 'player' || !roomId) return false;
  if (!actor.visitedRooms) actor.visitedRooms = new Set();
  if (actor.visitedRooms.has(roomId)) return false;
  actor.visitedRooms.add(roomId);
  if (!Array.isArray(actor.record.visitedRooms)) actor.record.visitedRooms = [];
  actor.record.visitedRooms.push(roomId);
  actor.dirty = true;
  return true;
}
