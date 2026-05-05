import look from './actions/look.js';
import move from './actions/move.js';
import say from './actions/say.js';
import emote from './actions/emote.js';
import who from './actions/who.js';
import help from './actions/help.js';
import quit from './actions/quit.js';
import lang from './actions/lang.js';
import social from './actions/social.js';
import take from './actions/take.js';
import drop from './actions/drop.js';
import inventory from './actions/inventory.js';
import give from './actions/give.js';
import use from './actions/use.js';
import cast from './actions/cast.js';
import attack from './actions/attack.js';
import flee from './actions/flee.js';
import wear from './actions/wear.js';
import removeWearable from './actions/remove.js';
import equipment from './actions/equipment.js';
import stats from './actions/stats.js';
import spells from './actions/spells.js';
import train from './actions/train.js';
import { world } from './world.js';
import { runAdminCommand, isAdminCommand } from '../admin/adminCommands.js';
import { parseCommand, executeHandler } from './dispatch.js';
import { s } from '../i18n.js';

const DIRECTIONS = new Set([
  'n','s','e','w','u','d',
  'ne','nw','se','sw',
  'north','south','east','west','up','down',
  'northeast','northwest','southeast','southwest',
]);

const COMMANDS = {
  look, l: look,
  go: move,
  say, "'": say,
  emote, ':': emote, '/me': emote,
  who,
  help, '?': help,
  quit, q: quit,
  lang,
  take, get: take,
  pick: (actor, args) => take(actor, args[0]?.toLowerCase() === 'up' ? args.slice(1) : args),
  drop,
  inventory, inv: inventory, i: inventory,
  give,
  use,
  cast, c: cast,
  attack, kill: attack, hit: attack,
  flee, f: flee,
  wear, equip: wear,
  remove: removeWearable, unwear: removeWearable,
  equipment, eq: equipment,
  stats, st: stats,
  spells, sp: spells,
  train, tr: train,
};

export async function runCommand(actor, line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  if (trimmed.startsWith('"')) {
    return say(actor, [trimmed.slice(1)]);
  }
  if (trimmed.startsWith(':')) {
    return emote(actor, [trimmed.slice(1).trim()]);
  }

  if (isAdminCommand(trimmed)) {
    return runAdminCommand(actor, trimmed);
  }

  const { verb, args } = parseCommand(trimmed);

  if (DIRECTIONS.has(verb)) {
    return move(actor, [verb]);
  }

  const handler = COMMANDS[verb];
  if (handler) {
    return executeHandler(handler, actor, args, {
      logLabel: `command '${verb}'`,
      errorKey: 'error.command_failed',
    });
  }

  if (world.socials.has(verb)) {
    return executeHandler((a, ar) => social(a, verb, ar), actor, args, {
      logLabel: `social '${verb}'`,
      errorKey: 'error.command_failed',
    });
  }

  actor.session.send({ kind: 'error', text: s('error.unknown_command', actor.lang, { verb }) });
}
