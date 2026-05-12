import { getRoom, actorsInRoom, findInRoom, itemsInRoom, isExitLocked, getGoldInRoom, world } from '../world.js';
import { findItemInList } from '../items.js';
import { serializeActiveEffectsForClient } from '../activeEffects.js';
import { canAfford } from '../exchange.js';
import { getHate } from '../aggro.js';
import { findKnownSpell } from './cast.js';
import { effectDetail } from './spells.js';
import { t, s, dirName } from '../../i18n.js';
import { canPerceiveRoom } from '../light.js';

function withPositionSuffix(name, position, lang) {
  if (!position || position === 'stand') return name;
  const suffix = s(`position.suffix.${position}`, lang);
  return suffix ? `${name} ${suffix}` : name;
}

const STAT_LABELS = {
  attack: 'ATK', defense: 'DEF', int: 'INT', evasion: 'EVA',
  accuracy: 'ACC', magicResist: 'MR', hp: 'HP', mp: 'MP', spd: 'SPD',
};

function bonusSummary(bonus) {
  const parts = [];
  for (const [stat, value] of Object.entries(bonus)) {
    const sign = value >= 0 ? '+' : '';
    parts.push(`${STAT_LABELS[stat] ?? stat.toUpperCase()} ${sign}${value}`);
  }
  return parts.join(', ');
}

function applyEffectShortText(applyId, lang) {
  const def = world.effectDefs.get(applyId);
  if (!def) return applyId;
  const icon = def.icon ?? '';
  return `${icon ? icon + ' ' : ''}${t(def.name, lang)}`;
}

function serializeExchanges(host, lang, actor) {
  let list = host.kind === 'npc' ? host.exchanges : host.def?.exchanges;
  if (!Array.isArray(list) || list.length === 0) return null;
  if (actor) {
    list = list.filter(e => e.flavor !== 'craft' || canAfford(actor, e, 1).ok);
    if (list.length === 0) return null;
  }
  const formatSide = (side) => side.map(e => {
    if (e.gold != null) return { kind: 'gold', amount: e.gold };
    const def = world.itemDefs.get(e.item);
    return {
      kind: 'item',
      id: e.item,
      name: def ? t(def.name, lang) : e.item,
      count: e.count ?? 1,
    };
  });
  return list.map(e => ({
    id: e.id,
    flavor: e.flavor,
    inputs: formatSide(e.inputs),
    outputs: formatSide(e.outputs),
  }));
}

function exitDisplay(exitKey, lang) {
  const named = dirName(exitKey, lang);
  if (named && named !== `dir.${exitKey}`) return named;
  return exitKey;
}

const EXIT_ORDER = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'u', 'd'];
function exitSortIndex(key) {
  const i = EXIT_ORDER.indexOf(key.toLowerCase());
  return i === -1 ? EXIT_ORDER.length : i;
}
function compareExitKeys(a, b) {
  const ia = exitSortIndex(a);
  const ib = exitSortIndex(b);
  if (ia !== ib) return ia - ib;
  return a.localeCompare(b);
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
  const perceived = canPerceiveRoom(actor, room);
  const lang = actor.lang;

  if (perceived === 'dark') {
    actor.session.send({
      kind: 'room',
      light: 'dark',
      name: t(room.name, lang),
      short: s('room.dark', lang),
    });
    return;
  }

  const foundSecrets = new Set(actor.record?.foundSecrets ?? []);
  const hiddenExits = room.hiddenExits ?? {};
  const hiddenFixtures = room.hiddenFixtures ?? {};
  const players = [];
  const npcs = [];
  for (const a of actorsInRoom(room.id)) {
    if (a === actor) continue;
    if (a.kind === 'player') {
      players.push({ name: a.name, display: withPositionSuffix(a.name, a.position, lang) });
    } else if (a.kind === 'npc') {
      const baseDisposition = a.disposition ?? 'neutral';
      const hate = getHate(a, actor);
      const effective = baseDisposition === 'hostile' && hate < 0 ? 'neutral' : baseDisposition;
      const bareName = t(a.name, lang);
      npcs.push({
        name: bareName,
        display: withPositionSuffix(bareName, a.position, lang),
        disposition: effective,
      });
    }
  }
  const exitKeys = Object.keys(room.exits ?? {})
    .filter(k => !isExitLocked(room, k))
    .filter(k => !hiddenExits[k] || foundSecrets.has(hiddenExits[k].id))
    .sort(compareExitKeys);
  const exits = exitKeys.map(k => {
    const targetRoom = getRoom(room.exits[k]);
    return {
      key: k,
      label: exitDisplay(k, lang),
      target: targetRoom ? t(targetRoom.name, lang) : null,
    };
  });
  const itemGroups = new Map();
  for (const inst of itemsInRoom(room.id)) {
    const hf = hiddenFixtures[inst.defId];
    if (hf && !foundSecrets.has(hf.id ?? inst.defId)) continue;
    const stateKey = !inst.state || Object.keys(inst.state).length === 0 ? '' : JSON.stringify(inst.state);
    const key = `${inst.defId}:${stateKey}`;
    const existing = itemGroups.get(key);
    if (existing) {
      existing.count++;
    } else {
      const def = inst.def;
      const hasExchanges = Array.isArray(def.exchanges) && def.exchanges.length > 0;
      itemGroups.set(key, {
        instanceId: inst.instanceId,
        defId: inst.defId,
        name: t(def.name, lang),
        count: 1,
        pickable: def.pickable !== false,
        usable: !!def.use,
        interactable: !!(def.use || def.unlocks || hasExchanges),
      });

    }
  }
  const items = [...itemGroups.values()];
  const gold = getGoldInRoom(room.id);

  if (perceived === 'dim') {
    actor.session.send({
      kind: 'room',
      light: 'dim',
      name: t(room.name, lang),
      short: `${s('room.dim_hint', lang)} ${t(room.short, lang)}`,
      exitsLabel: s('room.exits_label', lang),
      exits,
      noExitsLabel: s('room.no_exits', lang),
      npcsLabel: s('room.npcs_label', lang),
      npcs,
      othersLabel: s('room.others_label', lang),
      others: players,
      itemsLabel: s('room.items_label', lang),
      items: items.map(i => ({
        instanceId: i.instanceId,
        defId: i.defId,
        name: i.name,
        count: i.count,
        pickable: i.pickable,
      })),
      gold,
      goldLabel: s('room.gold_label', lang),
    });
    return;
  }

  actor.session.send({
    kind: 'room',
    light: 'light',
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
  const room = getRoom(actor.location);
  const perceived = canPerceiveRoom(actor, room);
  if (perceived === 'dark') {
    actor.session.send({ kind: 'system', text: s('look.too_dark', lang) });
    return;
  }
  if (target.kind === 'npc') {
    actor.inspecting = target;
    let subtitle = t(target.title ?? target.name, lang);
    if (target.disposition && target.disposition !== 'neutral') {
      subtitle += ` (${s(`look.disposition_${target.disposition}`, lang)})`;
    }
    const isFriendly = target.disposition === 'friendly';
    const effectsForClient = isFriendly ? [] : serializeActiveEffectsForClient(target, lang)
      .map(e => ({ defId: e.defId, name: e.name, icon: e.icon, kind: e.kind }));
    const exchanges = serializeExchanges(target, lang, actor);
    if (perceived === 'dim') {
      actor.session.send({
        kind: 'target-info',
        name: t(target.name, lang),
        subtitle,
        description: s('look.target_dim_hint', lang),
      });
      return;
    }
    actor.session.send({
      kind: 'target-info',
      name: t(target.name, lang),
      subtitle,
      description: t(target.long, lang) || t(target.short, lang) || s('look.npc_no_desc', lang),
      exchanges,
      exchangeRowLabels: exchanges ? {
        buy: s('exchange.row.buy', lang),
        sell: s('exchange.row.sell', lang),
        craft: s('exchange.row.craft', lang),
      } : undefined,
      stats: isFriendly || !target.stats ? null : { ...target.stats },
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
    if (perceived === 'dim') {
      actor.session.send({
        kind: 'target-info',
        name: target.name,
        subtitle: s('look.adventurer_subtitle', lang),
        description: s('look.target_dim_hint', lang),
      });
      return;
    }
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

  const room = getRoom(actor.location);
  const perceivedHere = canPerceiveRoom(actor, room);
  const itemInRoom = perceivedHere === 'dark' ? null : findItemInList(itemsInRoom(actor.location), query);
  const itemInInv = findItemInList(actor.inventory, query);
  const item = itemInRoom ?? itemInInv;
  if (item) {
    sendItemInfo(actor, item);
    const itemName = t(item.def.name, actor.lang);
    actor.session.send({ kind: 'system', text: s('narration.you_look_at', actor.lang, { target: itemName }) });
    return;
  }

  const spell = findKnownSpell(actor, query);
  if (spell) {
    sendSpellInfo(actor, spell);
    actor.session.send({ kind: 'system', text: s('narration.you_look_at', actor.lang, { target: t(spell.name, actor.lang) }) });
    return;
  }

  actor.session.send({ kind: 'error', text: s('error.no_such_target', actor.lang, { query }) });
}

function sendSpellInfo(actor, spell) {
  const lang = actor.lang;
  const targetLabel = s(`spells.target.${spell.target ?? 'any'}`, lang);
  const mpCost = spell.mpCost ?? 0;
  const details = [];
  const detail = effectDetail(spell, actor);
  if (detail) details.push(detail);
  actor.session.send({
    kind: 'target-info',
    name: t(spell.name, lang),
    subtitle: `${mpCost} ${s('panel.mp', lang)} · ${targetLabel}`,
    description: spell.description ? t(spell.description, lang) : '',
    details,
  });
}

function sendItemInfo(actor, inst) {
  const lang = actor.lang;
  const exchanges = serializeExchanges(inst, lang, actor);
  const def = inst.def;
  const details = [];
  const w = def.wearable;
  if (w) {
    if (w.damage) {
      details.push(s('item.detail.damage', lang, { formula: String(w.damage) }));
    }
    if (w.bonus && Object.keys(w.bonus).length > 0) {
      details.push(s('item.detail.bonus', lang, { mods: bonusSummary(w.bonus) }));
    }
    if (w.onHit?.applyEffect) {
      const chance = Math.round((w.onHit.chance ?? 1) * 100);
      details.push(s('item.detail.on_hit', lang, {
        chance,
        effect: applyEffectShortText(w.onHit.applyEffect, lang),
      }));
    }
  }
  if (def.use?.effect) {
    const fake = { effect: def.use.effect };
    const text = effectDetail(fake, actor);
    if (text) details.push(s('item.detail.on_use', lang, { effect: text }));
  }
  actor.session.send({
    kind: 'target-info',
    name: t(def.name, lang),
    subtitle: '',
    description: t(def.long, lang) || t(def.short, lang) || s('look.npc_no_desc', lang),
    details,
    exchanges,
    exchangeRowLabels: exchanges ? {
      buy: s('exchange.row.buy', lang),
      sell: s('exchange.row.sell', lang),
      craft: s('exchange.row.craft', lang),
    } : undefined,
  });
}
