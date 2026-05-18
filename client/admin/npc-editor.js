const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  admin: localStorage.getItem('npc-editor-admin') || '',
  npcs: [],
  currentId: null,
  currentDef: null,
  dirtyIds: new Set(),
};

const adminInput = $('#admin-name');
const filterInput = $('#filter');
const listEl = $('#npc-list');
const editorEl = $('#editor');
const saveBtn = $('#save-btn');
const prBtn = $('#pr-btn');
const statusBar = $('#status-bar');

adminInput.value = state.admin;
adminInput.addEventListener('change', () => {
  state.admin = adminInput.value.trim();
  localStorage.setItem('npc-editor-admin', state.admin);
  loadNpcList();
});

function showStatus(text, kind = '') {
  statusBar.textContent = text;
  statusBar.className = kind;
  statusBar.style.display = 'block';
  if (kind === 'ok') setTimeout(() => { statusBar.style.display = 'none'; }, 3000);
}

function showStatusHtml(html, kind = '') {
  statusBar.innerHTML = html;
  statusBar.className = kind;
  statusBar.style.display = 'block';
}

async function api(path, opts = {}) {
  const url = new URL(path, location.origin);
  if (state.admin) url.searchParams.set('admin', state.admin);
  const res = await fetch(url, opts);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

async function loadNpcList() {
  if (!state.admin) {
    listEl.innerHTML = '<li style="color:#8a8d94;padding:12px;">enter admin name</li>';
    return;
  }
  try {
    state.npcs = await api('/admin/api/npcs');
    renderList();
  } catch (err) {
    listEl.innerHTML = `<li style="color:#ff9a9a;padding:12px;">${err.message}</li>`;
  }
}

function renderList() {
  const filter = filterInput.value.toLowerCase();
  const items = state.npcs.filter(n =>
    !filter || n.id.includes(filter) || (n.name || '').toLowerCase().includes(filter)
  );
  listEl.innerHTML = items.map(n => `
    <li data-id="${n.id}" class="${n.id === state.currentId ? 'active' : ''} ${state.dirtyIds.has(n.id) ? 'dirty' : ''}">
      <div>${n.name}</div>
      <div class="meta">${n.id} · ${n.disposition || '—'}</div>
    </li>
  `).join('');
  $$('#npc-list li').forEach(li => {
    li.addEventListener('click', () => selectNpc(li.dataset.id));
  });
}

filterInput.addEventListener('input', renderList);

async function selectNpc(id) {
  try {
    state.currentDef = await api(`/admin/api/npcs/${id}`);
    state.currentId = id;
    renderList();
    renderEditor();
    saveBtn.disabled = false;
  } catch (err) {
    showStatus(`load failed: ${err.message}`, 'error');
  }
}

function localizedField(label, value, onChange, opts = {}) {
  const tag = opts.textarea ? 'textarea' : 'input';
  const cls = opts.textarea ? '' : 'class="text"';
  const en = (value && typeof value === 'object') ? (value.en || '') : (value || '');
  const cs = (value && typeof value === 'object') ? (value.cs || '') : '';
  const wrap = document.createElement('div');
  wrap.className = 'row';
  wrap.innerHTML = `
    <div><label>${label} · en</label><${tag} ${cls} data-lang="en">${opts.textarea ? escapeHtml(en) : ''}</${tag}></div>
    <div><label>${label} · cs</label><${tag} ${cls} data-lang="cs">${opts.textarea ? escapeHtml(cs) : ''}</${tag}></div>
  `;
  const inEn = wrap.querySelector('[data-lang=en]');
  const inCs = wrap.querySelector('[data-lang=cs]');
  if (!opts.textarea) { inEn.value = en; inCs.value = cs; }
  const fire = () => {
    const next = { en: inEn.value, cs: inCs.value };
    onChange(next.en || next.cs ? next : undefined);
    markDirty();
  };
  inEn.addEventListener('input', fire);
  inCs.addEventListener('input', fire);
  return wrap;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function markDirty() {
  state.dirtyIds.add(state.currentId);
  renderList();
}

function renderEditor() {
  const def = state.currentDef;
  if (!def) { editorEl.innerHTML = ''; return; }
  editorEl.innerHTML = '';
  const head = document.createElement('div');
  head.innerHTML = `<h2>${escapeHtml(def.name?.en || def.id)}</h2><div style="color:#8a8d94;margin-bottom:12px;">${def.id}</div>`;
  editorEl.appendChild(head);

  // Identity section
  const id1 = document.createElement('h3'); id1.textContent = 'Identity'; editorEl.appendChild(id1);
  editorEl.appendChild(localizedField('name', def.name, v => def.name = v));
  editorEl.appendChild(localizedField('nameAcc (accusative)', def.nameAcc, v => def.nameAcc = v));
  editorEl.appendChild(localizedField('nameDat (dative)', def.nameDat, v => def.nameDat = v));
  editorEl.appendChild(localizedField('nameGen (genitive)', def.nameGen, v => def.nameGen = v));
  editorEl.appendChild(localizedField('title', def.title, v => def.title = v));
  editorEl.appendChild(localizedField('short', def.short, v => def.short = v, { textarea: true }));
  editorEl.appendChild(localizedField('long', def.long, v => def.long = v, { textarea: true }));

  // Stats
  const stH = document.createElement('h3'); stH.textContent = 'Stats / disposition'; editorEl.appendChild(stH);
  const statsRow = document.createElement('div'); statsRow.className = 'row'; statsRow.style.gridTemplateColumns = 'repeat(4, 1fr)';
  const statFields = ['hp','hpMax','attack','defense','spd','mp','mpMax','int'];
  def.stats = def.stats || {};
  statFields.forEach(f => {
    const w = document.createElement('div');
    w.innerHTML = `<label>${f}</label><input class="text" type="number" value="${def.stats[f] ?? 0}">`;
    w.querySelector('input').addEventListener('input', e => { def.stats[f] = Number(e.target.value); markDirty(); });
    statsRow.appendChild(w);
  });
  editorEl.appendChild(statsRow);

  const dispRow = document.createElement('div'); dispRow.className = 'row';
  dispRow.innerHTML = `
    <div><label>disposition</label><select>${['friendly','neutral','hostile','wary'].map(d => `<option ${def.disposition===d?'selected':''}>${d}</option>`).join('')}</select></div>
    <div><label>respawn ticks</label><input class="text" type="number" value="${def.respawn?.ticks ?? ''}"></div>
  `;
  dispRow.querySelector('select').addEventListener('change', e => { def.disposition = e.target.value; markDirty(); });
  dispRow.querySelector('input').addEventListener('input', e => {
    const n = Number(e.target.value);
    def.respawn = n > 0 ? { ticks: n } : undefined;
    markDirty();
  });
  editorEl.appendChild(dispRow);

  // Behaviors
  const bH = document.createElement('h3'); bH.textContent = 'Behaviors (say / emote frequencies)'; editorEl.appendChild(bH);
  def.behaviors = def.behaviors || [];
  const bWrap = document.createElement('div');
  def.behaviors.forEach((b, i) => bWrap.appendChild(behaviorCard(b, i, def)));
  editorEl.appendChild(bWrap);
  const addB = document.createElement('button');
  addB.className = 'add-btn'; addB.textContent = '+ add behavior';
  addB.addEventListener('click', () => {
    def.behaviors.push({ primitive: 'emote', chance: 0.05, cost: 6, lines: { en: [], cs: [] } });
    markDirty(); renderEditor();
  });
  editorEl.appendChild(addB);

  // Exchanges
  const eH = document.createElement('h3'); eH.textContent = 'Exchanges'; editorEl.appendChild(eH);
  def.exchanges = def.exchanges || [];
  const eWrap = document.createElement('div');
  const header = document.createElement('div'); header.className = 'exch-row';
  header.innerHTML = `<span class="hint">id</span><span class="hint">flavor</span><span class="hint">inputs (e.g. gold:1, item.foo:2)</span><span class="hint">outputs</span><span class="hint">xp</span><span></span>`;
  eWrap.appendChild(header);
  def.exchanges.forEach((x, i) => eWrap.appendChild(exchangeRow(x, i, def)));
  editorEl.appendChild(eWrap);
  const addE = document.createElement('button');
  addE.className = 'add-btn'; addE.textContent = '+ add exchange';
  addE.addEventListener('click', () => {
    def.exchanges.push({ id: '', flavor: 'buy', inputs: [], outputs: [] });
    markDirty(); renderEditor();
  });
  editorEl.appendChild(addE);
}

function behaviorCard(b, i, def) {
  const card = document.createElement('div'); card.className = 'card';
  const head = document.createElement('div'); head.className = 'card-header';
  const prims = ['say','emote','attack','wander','flee','interact','give_item','summon'];
  head.innerHTML = `
    <select>${prims.map(p => `<option ${b.primitive===p?'selected':''}>${p}</option>`).join('')}</select>
    <span class="freq"><label style="margin:0;">chance</label>
      <input type="range" min="0" max="1" step="0.01" value="${b.chance ?? 0}">
      <output>${Math.round((b.chance ?? 0) * 100)}%</output></span>
    <span class="freq"><label style="margin:0;">cost</label>
      <input class="text" type="number" min="1" value="${b.cost ?? 12}" style="width: 60px;"></span>
    <button class="remove">remove</button>
  `;
  const [primSel, range, output, costIn] = head.querySelectorAll('select, input[type=range], output, input[type=number]');
  const rangeIn = head.querySelector('input[type=range]');
  primSel.addEventListener('change', () => { b.primitive = primSel.value; markDirty(); });
  rangeIn.addEventListener('input', () => {
    b.chance = Number(rangeIn.value);
    output.textContent = `${Math.round(b.chance * 100)}%`;
    markDirty();
  });
  costIn.addEventListener('input', () => { b.cost = Number(costIn.value); markDirty(); });
  head.querySelector('.remove').addEventListener('click', () => {
    def.behaviors.splice(i, 1); markDirty(); renderEditor();
  });
  card.appendChild(head);

  if (b.primitive === 'say' || b.primitive === 'emote') {
    const linesEl = document.createElement('div'); linesEl.className = 'lines-grid';
    b.lines = b.lines || { en: [], cs: [] };
    const enTa = document.createElement('textarea');
    const csTa = document.createElement('textarea');
    enTa.placeholder = 'one line per row (en)';
    csTa.placeholder = 'one line per row (cs)';
    enTa.value = (b.lines.en || []).join('\n');
    csTa.value = (b.lines.cs || []).join('\n');
    const sync = () => {
      b.lines.en = enTa.value.split('\n').filter(l => l.length > 0);
      b.lines.cs = csTa.value.split('\n').filter(l => l.length > 0);
      mismatch.style.display = (b.lines.en.length !== b.lines.cs.length) ? 'block' : 'none';
      mismatch.textContent = `line count mismatch: en=${b.lines.en.length}, cs=${b.lines.cs.length}`;
      markDirty();
    };
    enTa.addEventListener('input', sync);
    csTa.addEventListener('input', sync);
    const enWrap = document.createElement('div'); enWrap.innerHTML = '<label>lines · en</label>'; enWrap.appendChild(enTa);
    const csWrap = document.createElement('div'); csWrap.innerHTML = '<label>lines · cs</label>'; csWrap.appendChild(csTa);
    linesEl.appendChild(enWrap); linesEl.appendChild(csWrap);
    card.appendChild(linesEl);
    const mismatch = document.createElement('div'); mismatch.className = 'warn'; mismatch.style.display = 'none';
    card.appendChild(mismatch);
    sync();
  } else {
    const note = document.createElement('div'); note.style.color = '#8a8d94'; note.style.fontSize = '12px';
    note.textContent = `(this primitive has extra fields — edit raw JSON for now; chance/cost editable here)`;
    card.appendChild(note);
  }
  return card;
}

function exchangeRow(x, i, def) {
  const row = document.createElement('div'); row.className = 'exch-row';
  const fmt = (arr) => (arr || []).map(p => {
    if (p.gold != null) return `gold:${p.gold}`;
    if (p.item) return `${p.item}${p.count && p.count > 1 ? `:${p.count}` : ''}`;
    return '';
  }).filter(Boolean).join(', ');
  const parse = (str) => str.split(',').map(s => s.trim()).filter(Boolean).map(tok => {
    const [k, v] = tok.split(':').map(s => s.trim());
    if (k === 'gold') return { gold: Number(v || 1) };
    return v ? { item: k, count: Number(v) } : { item: k };
  });
  row.innerHTML = `
    <input value="${escapeHtml(x.id || '')}" placeholder="id">
    <select>${['buy','sell','craft','trade','gift'].map(f => `<option ${x.flavor===f?'selected':''}>${f}</option>`).join('')}</select>
    <input value="${escapeHtml(fmt(x.inputs))}" placeholder="gold:1, item.foo:2">
    <input value="${escapeHtml(fmt(x.outputs))}" placeholder="item.bar">
    <input type="number" value="${x.xp || ''}" placeholder="xp">
    <button>×</button>
  `;
  const [idIn, flavSel, inIn, outIn, xpIn, rm] = row.querySelectorAll('input, select, button');
  idIn.addEventListener('input', () => { x.id = idIn.value; markDirty(); });
  flavSel.addEventListener('change', () => { x.flavor = flavSel.value; markDirty(); });
  inIn.addEventListener('input', () => { x.inputs = parse(inIn.value); markDirty(); });
  outIn.addEventListener('input', () => { x.outputs = parse(outIn.value); markDirty(); });
  xpIn.addEventListener('input', () => { x.xp = xpIn.value ? Number(xpIn.value) : undefined; markDirty(); });
  rm.addEventListener('click', () => { def.exchanges.splice(i, 1); markDirty(); renderEditor(); });
  return row;
}

saveBtn.addEventListener('click', async () => {
  if (!state.currentId || !state.currentDef) return;
  try {
    await api(`/admin/api/npcs/${state.currentId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state.currentDef, null, 2),
    });
    showStatus(`saved ${state.currentId}`, 'ok');
  } catch (err) {
    showStatus(`save failed: ${err.message}`, 'error');
  }
});

prBtn.addEventListener('click', async () => {
  const title = prompt('PR title:', 'npc edits');
  if (!title) return;
  showStatus('opening PR…');
  try {
    const result = await api('/admin/api/git/open-pr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, body: `Edited via NPC editor.` }),
    });
    state.dirtyIds.clear();
    renderList();
    const link = result.url ? `<a href="${result.url}" target="_blank">${result.url}</a>` : '(no URL parsed)';
    showStatusHtml(`PR opened: ${link}<br><span style="color:#8a8d94;">branch ${result.branch} — ${result.changedFiles.length} file(s)</span>`, 'ok');
  } catch (err) {
    showStatus(`PR failed: ${err.message}`, 'error');
  }
});

loadNpcList();
