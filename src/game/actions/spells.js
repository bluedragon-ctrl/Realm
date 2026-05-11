import { s, t } from '../../i18n.js';
import { world } from '../world.js';
import { formulaRange } from '../dice.js';

const STAT_LABELS = {
  defense: 'DEF',
  attack: 'ATK',
  int: 'INT',
  evasion: 'EVA',
  accuracy: 'ACC',
  magicResist: 'MR',
  hp: 'HP',
  mp: 'MP',
  spd: 'SPD',
};

function statModSummary(statMod) {
  const parts = [];
  for (const [stat, value] of Object.entries(statMod)) {
    const sign = value >= 0 ? '+' : '';
    const label = STAT_LABELS[stat] ?? stat.toUpperCase();
    parts.push(`${label} ${sign}${value}`);
  }
  return parts.join(', ');
}

function rangeText(min, max, lang, kind) {
  const unit = s(kind === 'damage' ? 'stats.unit.dmg' : 'stats.unit.hp', lang);
  if (min === max) return s('spells.range_one', lang, { value: min, unit });
  return s('spells.range', lang, { min, max, unit });
}

function effectDetail(spell, actor) {
  const lang = actor.lang;
  const eff = spell.effect;
  if (!eff) return null;
  if (eff.type === 'damage' || eff.type === 'damage_room_enemies') {
    const { min, max } = formulaRange(eff.formula ?? '0', { actor });
    return s('spells.detail.damage', lang, {
      formula: eff.formula ?? '?',
      range: rangeText(Math.max(1, min), Math.max(1, max), lang, 'damage'),
    });
  }
  if (eff.type === 'heal' || eff.type === 'heal_room_friendlies') {
    const formula = eff.amount ?? eff.hp ?? eff.mp ?? '0';
    const { min, max } = formulaRange(formula, { actor });
    return s('spells.detail.heal', lang, {
      formula: String(formula),
      range: rangeText(min, max, lang, 'heal'),
    });
  }
  if (eff.type === 'drain') {
    const formula = eff.formula ?? eff.amount ?? '0';
    const { min, max } = formulaRange(String(formula), { actor });
    const ratio = Math.round((eff.ratio ?? 0.5) * 100);
    return s('spells.detail.drain', lang, {
      formula: String(formula),
      range: rangeText(Math.max(1, min), Math.max(1, max), lang, 'damage'),
      ratio,
    });
  }
  if (eff.type === 'apply_effect') {
    const def = world.effectDefs.get(eff.effectId);
    if (!def) return s('spells.detail.apply_unknown', lang, { id: eff.effectId });
    const name = t(def.name, lang);
    const icon = def.icon ?? '';
    const duration = def.duration ?? 0;
    const tick = def.tick;
    if (tick && tick.effect) {
      const inner = tick.effect;
      const pulses = tick.pulses ?? 0;
      const every = tick.every ?? 0;
      let amount = 0;
      let unitKey = 'stats.unit.hp';
      if (inner.type === 'heal') amount = inner.hp ?? inner.mp ?? 0;
      else if (inner.type === 'damage') { amount = inner.amount ?? 0; unitKey = 'stats.unit.dmg'; }
      const unit = s(unitKey, lang);
      return s('spells.detail.apply', lang, {
        name, icon, pulses, every, amount, unit,
      });
    }
    if (def.statMod) {
      const mods = statModSummary(def.statMod);
      return s('spells.detail.apply_stats', lang, { name, icon, mods, duration });
    }
    if (def.reflect) {
      return s('spells.detail.apply_reflect', lang, { name, icon, amount: def.reflect, duration });
    }
    if (duration > 0) {
      return s('spells.detail.apply_duration', lang, { name, icon, duration });
    }
    return s('spells.detail.apply_simple', lang, { name, icon });
  }
  return null;
}

export default function spells(actor) {
  const lang = actor.lang;
  const known = actor.knownSpells ?? [];
  if (known.length === 0) {
    actor.session.send({ kind: 'system', text: s('spells.empty', lang) });
    return;
  }
  const lines = [];
  lines.push(s('spells.header', lang, { count: known.length }));
  lines.push('');
  for (const id of known) {
    const def = world.spellDefs.get(id);
    if (!def) continue;
    lines.push(s('spells.entry', lang, {
      name: t(def.name, lang),
      mp: def.mpCost ?? 0,
      action: def.actionCost ?? 12,
      target: s(`spells.target.${def.target ?? 'any'}`, lang),
      description: def.description ? t(def.description, lang) : '',
    }));
    const detail = effectDetail(def, actor);
    if (detail) lines.push('  ' + detail);
  }
  actor.session.send({ kind: 'system', text: lines.join('\n') });
}
