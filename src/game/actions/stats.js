import { s } from '../../i18n.js';
import { xpToNext } from '../xp.js';

const STAT_LINES = [
  ['attack', 'panel.atk', 'stats.help.atk'],
  ['defense', 'panel.def', 'stats.help.def'],
  ['int', 'panel.int', 'stats.help.int'],
  ['magicResist', 'panel.mres', 'stats.help.mres'],
  ['accuracy', 'panel.acc', 'stats.help.acc'],
  ['evasion', 'panel.eva', 'stats.help.eva'],
  ['spd', 'panel.spd', 'stats.help.spd'],
];

export default function stats(actor) {
  const lang = actor.lang;
  const st = actor.stats;
  const level = actor.record.level ?? 1;
  const xp = actor.record.xp ?? 0;
  const lines = [];
  lines.push(s('stats.header', lang, {
    level,
    xp,
    xpNext: xpToNext(level),
  }));
  lines.push(s('stats.bars', lang, {
    hpLabel: s('panel.hp', lang),
    hp: st.hp,
    hpMax: st.hpMax,
    mpLabel: s('panel.mp', lang),
    mp: st.mp,
    mpMax: st.mpMax,
  }));
  lines.push('');
  for (const [key, labelKey, helpKey] of STAT_LINES) {
    lines.push(s('stats.line', lang, {
      label: s(labelKey, lang),
      value: st[key] ?? 0,
      help: s(helpKey, lang),
    }));
  }
  actor.session.send({ kind: 'system', text: lines.join('\n') });
}
