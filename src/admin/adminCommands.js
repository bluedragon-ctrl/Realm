import { loadRooms, loadNpcs, loadStrings, loadSocials, loadItems, loadSpells, loadEffects } from '../persist/contentLoader.js';
import { createPlayer, loadPlayer, savePlayer } from '../persist/players.js';
import { world, START_ROOM, despawnAllNpcs, spawnAllNpcs, spawnAllItems } from '../game/world.js';
import { parseCommand, executeHandler } from '../game/dispatch.js';
import { clearSocialButtonCache, sendStats } from '../game/messages.js';
import { s, normalizeLang, setStringTables } from '../i18n.js';
import { resetAllocations, ensureAllocationFields } from '../game/leveling.js';
import { recomputeStats } from '../game/wearables.js';
import { PLAYER_DEFAULT_STATS, normalizeStats } from '../game/stats.js';
import { makeNameForms } from '../game/declension.js';
import { pointsPhrase } from '../game/format.js';

export function isAdminCommand(line) {
  return line.startsWith('@');
}

const ADMIN_HANDLERS = {
  'create-player': createPlayerCmd,
  'reload': reloadCmd,
  'who': adminWhoCmd,
  'reset-stats': resetStatsCmd,
};

export async function runAdminCommand(actor, line) {
  if (!actor.isAdmin) {
    actor.session.send({ kind: 'error', text: s('error.admin_only', actor.lang) });
    return;
  }
  const { verb, args } = parseCommand(line.slice(1));
  const handler = ADMIN_HANDLERS[verb];
  if (!handler) {
    actor.session.send({ kind: 'error', text: s('error.no_such_admin_command', actor.lang, { verb }) });
    return;
  }
  await executeHandler(handler, actor, args, {
    logLabel: `admin command '@${verb}'`,
    errorKey: 'error.admin_failed',
    errorParams: { verb },
  });
}

async function createPlayerCmd(actor, args) {
  const name = args[0];
  if (!name || !/^[A-Za-z][A-Za-z0-9_-]{1,23}$/.test(name)) {
    actor.session.send({ kind: 'error', text: s('admin.create_usage', actor.lang) });
    return;
  }
  const lang = normalizeLang(args[1]);
  const nameForms = makeNameForms({ acc: args[2], dat: args[3], gen: args[4], voc: args[5] });
  const record = await createPlayer(name, START_ROOM, lang, nameForms);
  actor.session.send({
    kind: 'system',
    tone: 'good',
    text: s('admin.created', actor.lang, { name: record.name, lang: record.lang }),
  });
}

async function reloadCmd(actor) {
  const rooms = await loadRooms();
  const npcs = await loadNpcs(rooms);
  const socials = await loadSocials();
  const effects = await loadEffects();
  const items = await loadItems(rooms, effects);
  const spells = await loadSpells(effects);
  const strings = await loadStrings();
  world.rooms = rooms;
  world.npcDefs = npcs;
  world.socials = socials;
  world.effectDefs = effects;
  world.itemDefs = items;
  world.spellDefs = spells;
  setStringTables(strings);
  clearSocialButtonCache();
  despawnAllNpcs();
  spawnAllNpcs();
  await spawnAllItems();
  actor.session.send({
    kind: 'system',
    text: s('admin.reloaded', actor.lang, { rooms: rooms.size, npcs: npcs.size }),
  });
}

async function adminWhoCmd(actor) {
  const lines = [];
  for (const a of world.actorsByName.values()) {
    if (a.kind !== 'player') continue;
    lines.push(s('admin.who_line', actor.lang, {
      name: a.name,
      adminTag: a.isAdmin ? s('system.admin_tag', actor.lang) : '',
      location: a.location,
      lang: a.lang,
    }));
  }
  actor.session.send({
    kind: 'system',
    text: `${s('admin.who_header', actor.lang, { count: lines.length })}\n${lines.join('\n')}`,
  });
}

async function resetStatsCmd(actor, args) {
  const name = args[0];
  if (!name) {
    actor.session.send({ kind: 'error', text: s('admin.reset_stats_usage', actor.lang) });
    return;
  }

  // Online path: mutate the live actor.
  const online = world.actorsByName.get(name.toLowerCase());
  if (online && online.kind === 'player') {
    const refunded = resetAllocations(online);
    sendStats(online);
    actor.session.send({
      kind: 'system',
      tone: 'good',
      text: s('admin.reset_stats_done', actor.lang, {
        name: online.name,
        refunded: pointsPhrase(refunded, actor.lang),
        total: pointsPhrase(online.record.unspentPoints, actor.lang),
      }),
    });
    return;
  }

  // Offline path: edit the saved record directly.
  const record = await loadPlayer(name);
  if (!record) {
    actor.session.send({ kind: 'error', text: s('admin.reset_stats_no_such', actor.lang, { name }) });
    return;
  }
  record.stats = normalizeStats(record.stats, PLAYER_DEFAULT_STATS);
  record.baseStats = normalizeStats(record.baseStats ?? record.stats, PLAYER_DEFAULT_STATS);
  ensureAllocationFields(record);
  // Use a tiny shim actor so resetAllocations can call recomputeStats on the offline record.
  const shim = { record, stats: record.stats };
  const refunded = resetAllocations(shim);
  await savePlayer(record);
  actor.session.send({
    kind: 'system',
    tone: 'good',
    text: s('admin.reset_stats_done', actor.lang, {
      name: record.name,
      refunded: pointsPhrase(refunded, actor.lang),
      total: pointsPhrase(record.unspentPoints, actor.lang),
    }),
  });
}
