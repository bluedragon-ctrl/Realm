import { s, t } from '../../i18n.js';
import { world } from '../world.js';
import { formulaRange } from '../dice.js';

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
  if (eff.type === 'apply_effect') {
    const def = world.effectDefs.get(eff.effectId);
    if (!def) return s('spells.detail.apply_unknown', lang, { id: eff.effectId });
    const name = t(def.name, lang);
    const icon = def.icon ?? '';
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
      target: s(`spells.target.${def.target ?? 'any'}`, lang),
      description: def.description ? t(def.description, lang) : '',
    }));
    const detail = effectDetail(def, actor);
    if (detail) lines.push('  ' + detail);
  }
  actor.session.send({ kind: 'system', text: lines.join('\n') });
}
