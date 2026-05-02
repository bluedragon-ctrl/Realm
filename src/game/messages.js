import { s, t } from '../i18n.js';
import { getRoom, world } from './world.js';

function stateKey(state) {
  if (!state || Object.keys(state).length === 0) return '';
  return JSON.stringify(state);
}

function buildInventory(actor) {
  const groups = new Map();
  for (const inst of actor.inventory) {
    const key = `${inst.defId}:${stateKey(inst.state)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
    } else {
      groups.set(key, {
        instanceId: inst.instanceId,
        defId: inst.defId,
        name: t(inst.def.name, actor.lang),
        count: 1,
      });
    }
  }
  return [...groups.values()];
}

function buildKnownSpells(actor) {
  const out = [];
  for (const id of actor.knownSpells ?? []) {
    const def = world.spellDefs.get(id);
    if (!def) continue;
    out.push({
      id: def.id,
      name: t(def.name, actor.lang),
      mpCost: def.mpCost ?? 0,
      target: def.target ?? 'any',
    });
  }
  return out;
}

export function buildStatsMsg(actor) {
  const room = getRoom(actor.location);
  return {
    kind: 'stats',
    name: actor.name,
    isAdmin: !!actor.isAdmin,
    lang: actor.lang,
    location: room ? t(room.name, actor.lang) : actor.location,
    locationId: actor.location,
    stats: { ...actor.stats },
    labels: {
      hp: s('panel.hp', actor.lang),
      mp: s('panel.mp', actor.lang),
      atk: s('panel.atk', actor.lang),
      def: s('panel.def', actor.lang),
      int: s('panel.int', actor.lang),
      spd: s('panel.spd', actor.lang),
      panelTitle: s('panel.player_info', actor.lang),
      inspectTitle: s('panel.inspect', actor.lang),
      backToRoom: s('panel.back_to_room', actor.lang),
      lookButton: s('panel.look_button', actor.lang),
      inventoryTitle: s('panel.inventory', actor.lang),
      inventoryEmpty: s('panel.inventory_empty', actor.lang),
      pickUpButton: s('panel.pickup_button', actor.lang),
      useButton: s('panel.use_button', actor.lang),
      dropButton: s('panel.drop_button', actor.lang),
      giveButton: s('panel.give_button', actor.lang),
      yourselfLabel: s('panel.yourself', actor.lang),
      backButton: s('panel.back', actor.lang),
      spellbookTitle: s('panel.spellbook', actor.lang),
      spellbookEmpty: s('panel.spellbook_empty', actor.lang),
      castButton: s('panel.cast_button', actor.lang),
      attackButton: s('panel.attack_button', actor.lang),
      fleeButton: s('panel.flee_button', actor.lang),
    },
    socials: buildSocialButtons(actor.lang),
    inventory: buildInventory(actor),
    knownSpells: buildKnownSpells(actor),
  };
}

const socialButtonCache = new Map();

function buildSocialButtons(lang) {
  const cached = socialButtonCache.get(lang);
  if (cached) return cached;
  const out = [];
  for (const [verb, def] of world.socials) {
    const langDef = def[lang] ?? def.en;
    if (!langDef) continue;
    out.push({ verb, label: langDef.button ?? verb });
  }
  socialButtonCache.set(lang, out);
  return out;
}

export function clearSocialButtonCache() {
  socialButtonCache.clear();
}

export function sendStats(actor) {
  if (actor.session) actor.session.send(buildStatsMsg(actor));
}
