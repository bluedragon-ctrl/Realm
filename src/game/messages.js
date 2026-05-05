import { s, t } from '../i18n.js';
import { getRoom, world } from './world.js';
import { WEARABLE_SLOTS } from './wearables.js';
import { serializeActiveEffectsForClient } from './activeEffects.js';
import { xpToNext } from './xp.js';

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
      const use = inst.def.use;
      groups.set(key, {
        instanceId: inst.instanceId,
        defId: inst.defId,
        name: t(inst.def.name, actor.lang),
        count: 1,
        usable: !!use,
        consumable: !!(use && use.consumable),
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
      description: def.description ? t(def.description, actor.lang) : '',
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
    level: actor.record.level ?? 1,
    xp: actor.record.xp ?? 0,
    xpToNext: xpToNext(actor.record.level ?? 1),
    labels: {
      level: s('panel.level', actor.lang),
      xp: s('panel.xp', actor.lang),
      hp: s('panel.hp', actor.lang),
      mp: s('panel.mp', actor.lang),
      atk: s('panel.atk', actor.lang),
      def: s('panel.def', actor.lang),
      int: s('panel.int', actor.lang),
      mres: s('panel.mres', actor.lang),
      acc: s('panel.acc', actor.lang),
      eva: s('panel.eva', actor.lang),
      spd: s('panel.spd', actor.lang),
      panelTitle: s('panel.player_info', actor.lang),
      inspectTitle: s('panel.inspect', actor.lang),
      backToRoom: s('panel.back_to_room', actor.lang),
      lookButton: s('panel.look_button', actor.lang),
      inventoryTitle: s('panel.inventory', actor.lang),
      inventoryEmpty: s('panel.inventory_empty', actor.lang),
      pickUpButton: s('panel.pickup_button', actor.lang),
      useButton: s('panel.use_button', actor.lang),
      useItemOnButton: s('panel.use_item_on_button', actor.lang),
      noItemsLabel: s('panel.no_items', actor.lang),
      dropButton: s('panel.drop_button', actor.lang),
      giveButton: s('panel.give_button', actor.lang),
      yourselfLabel: s('panel.yourself', actor.lang),
      backButton: s('panel.back', actor.lang),
      spellbookTitle: s('panel.spellbook', actor.lang),
      spellbookEmpty: s('panel.spellbook_empty', actor.lang),
      castButton: s('panel.cast_button', actor.lang),
      attackButton: s('panel.attack_button', actor.lang),
      fleeButton: s('panel.flee_button', actor.lang),
      useFixtureButton: s('panel.use_fixture_button', actor.lang),
      useOnButton: s('panel.use_on_button', actor.lang),
      consumablesButton: s('panel.consumables_button', actor.lang),
      useFixturePickerTitle: s('panel.use_fixture_picker_title', actor.lang),
      useFixturePickerEmpty: s('panel.use_fixture_picker_empty', actor.lang),
      useOnPickerTitle: s('panel.use_on_picker_title', actor.lang),
      useOnTargetTitle: s('panel.use_on_target_title', actor.lang),
      consumablesPickerTitle: s('panel.consumables_picker_title', actor.lang),
      spellPickerTitle: s('panel.spell_picker_title', actor.lang),
      attackPickerTitle: s('panel.attack_picker_title', actor.lang),
      spellNoMp: s('panel.spell_no_mp', actor.lang),
      attackPickerEmpty: s('panel.attack_picker_empty', actor.lang),
      equipmentTitle: s('panel.equipment', actor.lang),
      equipmentEmpty: s('panel.equipment_empty', actor.lang),
      effectsTitle: s('panel.effects', actor.lang),
      effectsEmpty: s('panel.effects_empty', actor.lang),
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
    activeEffects: serializeActiveEffectsForClient(actor, actor.lang),
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
