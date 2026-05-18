import path from 'node:path';
import {
  check, checkRequired, checkObject, checkArray, checkLocalizedText, checkPositiveInt,
} from '../validate.js';

const DISCOVERY_TYPES = new Set(['enter_room', 'kill', 'pickup_item']);
const OBJECTIVE_TYPES = new Set(['enter_room', 'kill', 'room_clear', 'pickup_item', 'deliver_item']);

function checkDiscovery(disc, ctx, knownRooms, knownNpcs, knownItems) {
  checkRequired(disc, ctx, 'discovery');
  checkObject(disc, ctx, 'discovery');
  check(DISCOVERY_TYPES.has(disc.type), ctx,
    `discovery.type '${disc.type}' must be one of: ${[...DISCOVERY_TYPES].join(', ')}`);
  if (disc.type === 'enter_room') {
    check(typeof disc.room === 'string' && knownRooms.has(disc.room), ctx,
      `discovery references unknown room '${disc.room}'`);
  } else if (disc.type === 'kill') {
    check(typeof disc.defId === 'string' && knownNpcs.has(disc.defId), ctx,
      `discovery references unknown npc '${disc.defId}'`);
  } else if (disc.type === 'pickup_item') {
    check(typeof disc.defId === 'string' && knownItems.has(disc.defId), ctx,
      `discovery references unknown item '${disc.defId}'`);
  }
}

function checkObjective(obj, ctx, knownRooms, knownNpcs, knownItems) {
  checkObject(obj, ctx, 'objective');
  check(typeof obj.id === 'string' && obj.id.length > 0, ctx, `objective missing 'id'`);
  const objCtx = `${ctx} objective '${obj.id}'`;
  check(OBJECTIVE_TYPES.has(obj.type), objCtx,
    `type '${obj.type}' must be one of: ${[...OBJECTIVE_TYPES].join(', ')}`);
  checkLocalizedText(obj.desc, objCtx, 'desc');
  if (obj.count != null) checkPositiveInt(obj.count, objCtx, 'count');
  if (obj.type === 'enter_room' || obj.type === 'room_clear') {
    check(typeof obj.room === 'string' && knownRooms.has(obj.room), objCtx,
      `references unknown room '${obj.room}'`);
  } else if (obj.type === 'kill') {
    check(typeof obj.defId === 'string' && knownNpcs.has(obj.defId), objCtx,
      `references unknown npc '${obj.defId}'`);
  } else if (obj.type === 'pickup_item') {
    check(typeof obj.defId === 'string' && knownItems.has(obj.defId), objCtx,
      `references unknown item '${obj.defId}'`);
  } else if (obj.type === 'deliver_item') {
    check(typeof obj.defId === 'string' && knownItems.has(obj.defId), objCtx,
      `references unknown item '${obj.defId}'`);
    check(typeof obj.recipient === 'string' && knownNpcs.has(obj.recipient), objCtx,
      `references unknown npc recipient '${obj.recipient}'`);
  }
}

function checkRewards(rewards, ctx, knownItems) {
  if (rewards == null) return;
  checkObject(rewards, ctx, 'rewards');
  if (rewards.xp != null) checkPositiveInt(rewards.xp, ctx, 'rewards.xp');
  if (rewards.gold != null) checkPositiveInt(rewards.gold, ctx, 'rewards.gold');
  if (rewards.items != null) {
    checkArray(rewards.items, ctx, 'rewards.items');
    for (const id of rewards.items) {
      check(typeof id === 'string' && knownItems.has(id), ctx,
        `rewards.items references unknown item '${id}'`);
    }
  }
}

export function makeQuestValidator(knownRooms, knownNpcs, knownItems) {
  return (def, file) => {
    const ctx = `quest '${def.id}' (${path.basename(file)})`;
    checkLocalizedText(def.name, ctx, 'name');
    checkLocalizedText(def.short, ctx, 'short');
    if (def.long != null) checkLocalizedText(def.long, ctx, 'long');
    checkDiscovery(def.discovery, ctx, knownRooms, knownNpcs, knownItems);
    checkArray(def.objectives, ctx, 'objectives');
    check(Array.isArray(def.objectives) && def.objectives.length > 0, ctx,
      `'objectives' must be a non-empty array`);
    const seen = new Set();
    for (const obj of def.objectives) {
      check(!seen.has(obj.id), ctx, `duplicate objective id '${obj.id}'`);
      seen.add(obj.id);
      checkObjective(obj, ctx, knownRooms, knownNpcs, knownItems);
    }
    checkRewards(def.rewards, ctx, knownItems);
  };
}
