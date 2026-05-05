import { getRoom, actorsInRoom, findInRoom, itemsInRoom, isExitLocked, getGoldInRoom, world } from '../world.js';
import { findItemInList } from '../items.js';
import { serializeActiveEffectsForClient } from '../activeEffects.js';
import { t, s, dirName } from '../../i18n.js';

function serializeShop(npc, lang) {
  if (!npc.shop) return null;
  const out = {};
  const map = (entry) => {
    const def = world.itemDefs.get(entry.item);
    if (!def) return null;
    return {
      itemId: entry.item,
      name: t(def.name, lang),
      price: entry.price,
      perUnit: entry.perUnit ?? 1,
    };
  };
  if (Array.isArray(npc.shop.sells) && npc.shop.sells.length) {
    out.sells = npc.shop.sells.map(map).filter(Boolean);
  }
  if (Array.isArray(npc.shop.buys) && npc.shop.buys.length) {
    out.buys = npc.shop.buys.map(map).filter(Boolean);
  }
  if (!out.sells && !out.buys) return null;
  return out;
}

function exitDisplay(exitKey, lang) {
  const named = dirName(exitKey, lang);
  if (named && named !== `dir.${exitKey}`) return named;
  return exitKey;
}

export function describeRoomToAll(roomId) {
  for (const a of actorsInRoom(roomId)) {
    if (a.kind === 'player' && a.session) describeRoom(a);
  }
}

export function describeRoom(actor) {
  actor.inspecting = null;
  const room = getRoom(actor.location);
  if (!room) {
    actor.session.send({
      kind: 'error',
      text: s('error.you_are_nowhere', actor.lang, { room: actor.location }),
    });
    return;
  }
  const lang = actor.lang;
  const players = [];
  const npcs = [];
  for (const a of actorsInRoom(room.id)) {
    if (a === actor) continue;
    if (a.kind === 'player') players.push(a.name);
    else if (a.kind === 'npc') {
      npcs.push({
        name: t(a.name, lang),
        disposition: a.disposition ?? 'neutral',
      });
    }
  }
  const exitKeys = Object.keys(room.exits ?? {}).filter(k => !isExitLocked(room, k));
  const exits = exitKeys.map(k => ({ key: k, label: exitDisplay(k, lang) }));
  const itemGroups = new Map();
  for (const inst of itemsInRoom(room.id)) {
    const stateKey = !inst.state || Object.keys(inst.state).length === 0 ? '' : JSON.stringify(inst.state);
    const key = `${inst.defId}:${stateKey}`;
    const existing = itemGroups.get(key);
    if (existing) {
      existing.count++;
    } else {
      itemGroups.set(key, {
        instanceId: inst.instanceId,
        defId: inst.defId,
        name: t(inst.def.name, lang),
        count: 1,
        pickable: inst.def.pickable !== false,
        usable: !!inst.def.use,
      });

    }
  }
  const items = [...itemGroups.values()];
  const gold = getGoldInRoom(room.id);
  actor.session.send({
    kind: 'room',
    name: t(room.name, lang),
    short: t(room.short, lang),
    long: t(room.long, lang),
    exitsLabel: s('room.exits_label', lang),
    exits,
    noExitsLabel: s('room.no_exits', lang),
    npcsLabel: s('room.npcs_label', lang),
    npcs,
    othersLabel: s('room.others_label', lang),
    others: players,
    itemsLabel: s('room.items_label', lang),
    items,
    gold,
    goldLabel: s('room.gold_label', lang),
  });
}

export function pushTargetInfo(actor, target) {
  return sendTargetInfo(actor, target);
}

function sendTargetInfo(actor, target) {
  const lang = actor.lang;
  if (target.kind === 'npc') {
    actor.inspecting = target;
    let subtitle = t(target.title ?? target.name, lang);
    if (target.disposition && target.disposition !== 'neutral') {
      subtitle += ` (${s(`look.disposition_${target.disposition}`, lang)})`;
    }
    const effectsForClient = serializeActiveEffectsForClient(target, lang)
      .map(e => ({ defId: e.defId, name: e.name, icon: e.icon, kind: e.kind }));
    const shop = serializeShop(target, lang);
    actor.session.send({
      kind: 'target-info',
      name: t(target.name, lang),
      subtitle,
      description: t(target.long, lang) || t(target.short, lang) || s('look.npc_no_desc', lang),
      shop,
      shopSellsLabel: shop ? s('shop.sells_label', lang) : undefined,
      shopBuysLabel: shop ? s('shop.buys_label', lang) : undefined,
      stats: target.stats ? { ...target.stats } : null,
      statLabels: {
        hp: s('panel.hp', lang),
        mp: s('panel.mp', lang),
        atk: s('panel.atk', lang),
        def: s('panel.def', lang),
        int: s('panel.int', lang),
        mres: s('panel.mres', lang),
        acc: s('panel.acc', lang),
        eva: s('panel.eva', lang),
        spd: s('panel.spd', lang),
      },
      effects: effectsForClient,
      effectsLabel: s('panel.effects', lang),
    });
    return;
  }
  if (target.kind === 'player') {
    actor.inspecting = null;
    actor.session.send({
      kind: 'target-info',
      name: target.name,
      subtitle: s('look.adventurer_subtitle', lang),
      description: target === actor
        ? s('look.player_self', lang, { name: actor.name })
        : s('look.player_other', lang, { name: target.name }),
    });
    return;
  }
  actor.inspecting = null;
  actor.session.send({ kind: 'system', text: s('look.you_see_nothing', lang) });
}

export default function look(actor, args) {
  if (!args || args.length === 0) {
    describeRoom(actor);
    return;
  }
  const query = args.join(' ');
  if (query.toLowerCase() === 'me' || query.toLowerCase() === 'self') {
    sendTargetInfo(actor, actor);
    actor.session.send({ kind: 'system', text: s('narration.you_look_at', actor.lang, { target: actor.name }) });
    return;
  }
  const target = findInRoom(actor.location, query);
  if (target) {
    sendTargetInfo(actor, target);
    const targetName = target.kind === 'npc' ? t(target.name, actor.lang) : target.name;
    actor.session.send({ kind: 'system', text: s('narration.you_look_at', actor.lang, { target: targetName }) });
    return;
  }

  const itemInRoom = findItemInList(itemsInRoom(actor.location), query);
  const itemInInv = findItemInList(actor.inventory, query);
  const item = itemInRoom ?? itemInInv;
  if (item) {
    sendItemInfo(actor, item);
    const itemName = t(item.def.name, actor.lang);
    actor.session.send({ kind: 'system', text: s('narration.you_look_at', actor.lang, { target: itemName }) });
    return;
  }

  actor.session.send({ kind: 'error', text: s('error.no_such_target', actor.lang, { query }) });
}

function sendItemInfo(actor, inst) {
  const lang = actor.lang;
  actor.session.send({
    kind: 'target-info',
    name: t(inst.def.name, lang),
    subtitle: '',
    description: t(inst.def.long, lang) || t(inst.def.short, lang) || s('look.npc_no_desc', lang),
  });
}
