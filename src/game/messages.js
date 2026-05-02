import { s, t } from '../i18n.js';
import { getRoom, world } from './world.js';
import { WEARABLE_SLOTS } from './wearables.js';

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

function buildEquipment(actor) {
  const lang = actor.lang;
  const slots = WEARABLE_SLOTS.map(slot => {
    const defId = actor.record.equipped?.[slot];
    if (!defId) return { slot, defId: null, name: null };
    const def = world.itemDefs.get(defId);
    return {
      slot,
      defId,
      name: def ? t(def.name, lang) : defId,
    };
  });
  const known = [];
  for (const id of actor.record.knownWearables ?? []) {
    const def = world.itemDefs.get(id);
    if (!def?.wearable) continue;
    known.push({
      defId: id,
      name: t(def.name, lang),
      slot: def.wearable.slot,
    });
  }
  return { slots, known };
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
      equipmentTitle: s('panel.equipment', actor.lang),
      equipmentEmpty: s('panel.equipment_empty', actor.lang),
      wearButton: s('panel.wear_button', actor.lang),
      removeButton: s('panel.remove_button', actor.lang),
      slotEmpty: s('panel.slot_empty_label', actor.lang),
      slotLabels: {
        body: s('panel.slot_body', actor.lang),
        head: s('panel.slot_head', actor.lang),
        weapon: s('panel.slot_weapon', actor.lang),
        amulet: s('panel.slot_amulet', actor.lang),
      },
    },
    socials: buildSocialButtons(actor.lang),
    inventory: buildInventory(actor),
    knownSpells: buildKnownSpells(actor),
    equipment: buildEquipment(actor),
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
