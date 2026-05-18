import { s, t } from '../../i18n.js';
import { world } from '../world.js';

function formatObjective(objective, progress, lang) {
  const required = objective.count ?? 1;
  const current = Math.min(progress[objective.id] ?? 0, required);
  const done = current >= required;
  const desc = t(objective.desc, lang);
  if (required > 1) {
    return s(done ? 'quests.objective.line_done' : 'quests.objective.line_count', lang, {
      desc, current, total: required,
    });
  }
  return s(done ? 'quests.objective.line_done' : 'quests.objective.line', lang, { desc });
}

function showQuestDetail(actor, def, entry) {
  const lang = actor.lang;
  const lines = [];
  lines.push(s('quests.detail.header', lang, { name: t(def.name, lang) }));
  if (def.long) lines.push(t(def.long, lang));
  else if (def.short) lines.push(t(def.short, lang));
  lines.push('');
  lines.push(s('quests.detail.objectives_header', lang));
  for (const obj of def.objectives) {
    lines.push('  ' + formatObjective(obj, entry.objectives, lang));
  }
  if (entry.status === 'complete') {
    lines.push('');
    lines.push(s('quests.detail.status_complete', lang));
  }
  actor.session.send({ kind: 'system', text: lines.join('\n') });
}

export default function quests(actor, args) {
  const lang = actor.lang;
  const record = actor.record.quests ?? {};
  const ids = Object.keys(record);

  if (args && args.length > 0) {
    const query = args.join(' ').trim().toLowerCase();
    let match = null;
    for (const id of ids) {
      const def = world.questDefs.get(id);
      if (!def) continue;
      if (id.toLowerCase() === query
        || id.toLowerCase().endsWith('.' + query)
        || t(def.name, lang).toLowerCase().includes(query)) {
        match = { def, entry: record[id] };
        break;
      }
    }
    if (!match) {
      actor.session.send({ kind: 'error', text: s('quests.not_found', lang, { query }) });
      return;
    }
    showQuestDetail(actor, match.def, match.entry);
    return;
  }

  if (ids.length === 0) {
    actor.session.send({ kind: 'system', text: s('quests.empty', lang) });
    return;
  }

  const active = [];
  const completed = [];
  for (const id of ids) {
    const def = world.questDefs.get(id);
    if (!def) continue;
    const entry = record[id];
    if (entry.status === 'active') active.push({ def, entry });
    else if (entry.status === 'complete') completed.push({ def, entry });
  }

  const lines = [];
  lines.push(s('quests.header', lang, { active: active.length, completed: completed.length }));
  if (active.length > 0) {
    lines.push('');
    lines.push(s('quests.active_header', lang));
    for (const { def, entry } of active) {
      lines.push(s('quests.entry', lang, { name: t(def.name, lang) }));
      lines.push('  ' + t(def.short, lang));
      for (const obj of def.objectives) {
        lines.push('  ' + formatObjective(obj, entry.objectives, lang));
      }
    }
  }
  if (completed.length > 0) {
    lines.push('');
    lines.push(s('quests.completed_header', lang, { count: completed.length }));
    for (const { def } of completed) {
      lines.push('  ' + t(def.name, lang));
    }
  }
  actor.session.send({ kind: 'system', text: lines.join('\n') });
}
