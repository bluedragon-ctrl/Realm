const consoleEl = document.getElementById('console');
const form = document.getElementById('input-form');
const input = document.getElementById('input');
const whoEl = document.getElementById('who');
const whereEl = document.getElementById('where');
const quickbar = document.getElementById('quickbar');
const playerPanel = document.getElementById('player-panel');
const playerPanelTitle = document.getElementById('player-panel-title');
const playerStatsEl = document.getElementById('player-stats');
const inspectPanel = document.getElementById('inspect-panel');
const inspectTitle = document.getElementById('inspect-title');
const inspectBody = document.getElementById('inspect-body');
const backBtn = document.getElementById('back-to-room');
const popover = document.getElementById('action-popover');
const tickEl = document.getElementById('tick');
const scrollBtn = document.getElementById('scroll-btn');
const deathOverlay = document.getElementById('death-overlay');
const deathCountEl = document.getElementById('death-count');
const dirButtonsEl = document.getElementById('dir-buttons');
const dirSepEl = document.getElementById('dir-sep');
const useBtn = document.getElementById('use-btn');
const giveBtn = document.getElementById('give-btn');
const socialBtn = document.getElementById('social-btn');
const statusStrip = document.getElementById('status-strip');
const stripHpRow = document.getElementById('strip-hp');
const stripHpFill = stripHpRow.querySelector('.strip-fill');
const stripHpNum = stripHpRow.querySelector('.strip-num');
const stripHpLabel = stripHpRow.querySelector('.strip-label');
const stripMpRow = document.getElementById('strip-mp');
const stripMpFill = stripMpRow.querySelector('.strip-fill');
const stripMpNum = stripMpRow.querySelector('.strip-num');
const stripMpLabel = stripMpRow.querySelector('.strip-label');

let ws = null;
let loggedIn = false;
let lastRoomMsg = null;
let lockedTarget = null;
let lastStatsMsg = null;
let labels = {};
let socialList = [];
const history = [];
let historyIdx = -1;
let scrollLocked = false;
let deathTimer = null;
let pendingRoomTransition = false;

function appendText(cls, text, extra = '') {
  const div = document.createElement('div');
  div.className = `line ${cls}${extra ? ' ' + extra : ''}`;
  div.textContent = text;
  consoleEl.appendChild(div);
  if (!scrollLocked) consoleEl.scrollTop = consoleEl.scrollHeight;
}

function appendRoomSep(roomName) {
  const div = document.createElement('div');
  div.className = 'room-sep';
  div.textContent = roomName;
  consoleEl.appendChild(div);
  if (!scrollLocked) consoleEl.scrollTop = consoleEl.scrollHeight;
}

consoleEl.addEventListener('scroll', () => {
  const atBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 8;
  if (atBottom && scrollLocked) {
    scrollLocked = false;
    scrollBtn.hidden = true;
  } else if (!atBottom && !scrollLocked) {
    scrollLocked = true;
    scrollBtn.hidden = false;
  }
});

scrollBtn.addEventListener('click', () => {
  scrollLocked = false;
  scrollBtn.hidden = true;
  consoleEl.scrollTop = consoleEl.scrollHeight;
});

function showDeathOverlay() {
  let count = 3;
  deathCountEl.textContent = count;
  deathOverlay.hidden = false;
  if (deathTimer) clearInterval(deathTimer);
  deathTimer = setInterval(() => {
    count--;
    deathCountEl.textContent = Math.max(count, 0);
    if (count <= 0) { clearInterval(deathTimer); deathTimer = null; }
  }, 1000);
}

function dismissDeathOverlay() {
  if (deathTimer) { clearInterval(deathTimer); deathTimer = null; }
  deathOverlay.hidden = true;
}

function extraClasses(msg) {
  const parts = [];
  if (msg.source) parts.push(`source-${msg.source}`);
  if (msg.tone) parts.push(`tone-${msg.tone}`);
  return parts.join(' ');
}

function makeChip(label, cls, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `chip ${cls}`;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function sendInput(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !loggedIn) return;
  const m = /^\s*(attack|kill|hit)\s+(.+?)\s*$/i.exec(text);
  if (m) lockedTarget = m[2].toLowerCase();
  ws.send(JSON.stringify({ kind: 'input', text }));
}

function lockedTargetStillHostileHere() {
  if (!lockedTarget || !lastRoomMsg?.npcs) return null;
  for (const n of lastRoomMsg.npcs) {
    if (typeof n === 'string') continue;
    if ((n.disposition ?? 'neutral') !== 'hostile') continue;
    if (n.name.toLowerCase() === lockedTarget) return n.name;
  }
  return null;
}

function fillInput(prefix) {
  input.value = prefix;
  input.focus();
  input.setSelectionRange(prefix.length, prefix.length);
}

function makeBar(label, num, pct, cls) {
  const wrap = document.createElement('div'); wrap.className = 'bar';
  const lab = document.createElement('span'); lab.className = 'bar-label'; lab.textContent = label;
  const track = document.createElement('div'); track.className = 'bar-track';
  const fill = document.createElement('div'); fill.className = `bar-fill ${cls}`; fill.style.width = `${pct}%`;
  track.appendChild(fill);
  const n = document.createElement('span'); n.className = 'bar-num'; n.textContent = num;
  wrap.appendChild(lab); wrap.appendChild(track); wrap.appendChild(n);
  return wrap;
}

let actionCooldownTimer = null;
function applyActionCooldown(ms) {
  const btns = [document.getElementById('attack-btn'), document.getElementById('spell-btn')];
  if (actionCooldownTimer) { clearTimeout(actionCooldownTimer); actionCooldownTimer = null; }
  for (const btn of btns) {
    if (!btn) continue;
    btn.classList.remove('cooldown');
    btn.style.removeProperty('--cd-ms');
  }
  if (ms <= 0) return;
  for (const btn of btns) {
    if (!btn) continue;
    void btn.offsetWidth;
    btn.style.setProperty('--cd-ms', `${ms}ms`);
    btn.classList.add('cooldown');
  }
  actionCooldownTimer = setTimeout(() => {
    for (const btn of btns) {
      if (!btn) continue;
      btn.classList.remove('cooldown');
      btn.style.removeProperty('--cd-ms');
    }
    actionCooldownTimer = null;
  }, ms);
}

function renderStats(msg) {
  lastStatsMsg = msg;
  labels = msg.labels ?? labels;
  if (Array.isArray(msg.socials)) socialList = msg.socials;
  playerPanelTitle.textContent = labels.panelTitle ?? 'Character';
  inspectTitle.textContent = labels.inspectTitle ?? 'Inspect';
  if (labels.backToRoom) backBtn.textContent = labels.backToRoom;
  // Update quickbar button labels per language
  const fleeBtn = document.getElementById('flee-btn');
  if (fleeBtn && labels.fleeButton) fleeBtn.textContent = labels.fleeButton;
  const attackBtn = document.getElementById('attack-btn');
  if (attackBtn && labels.attackButton) attackBtn.textContent = labels.attackButton;
  if (attackBtn) attackBtn.classList.toggle('queued', msg.queuedAction === 'attack');
  applyActionCooldown(msg.actionCooldownMs ?? 0);
  const spellBtn = document.getElementById('spell-btn');
  if (spellBtn) {
    if (labels.castButton) spellBtn.textContent = `${labels.castButton} ▶`;
    spellBtn.hidden = !(Array.isArray(msg.knownSpells) && msg.knownSpells.length > 0);
    spellBtn.classList.toggle('queued', msg.queuedAction === 'cast');
  }
  if (labels.useButtonQuickbar) useBtn.textContent = labels.useButtonQuickbar;
  if (labels.giveButton) giveBtn.textContent = `${labels.giveButton} ▶`;
  if (labels.socialButton) socialBtn.textContent = `${labels.socialButton} ▶`;
  refreshActionButtons();
  whoEl.textContent = msg.isAdmin ? `${msg.name} (admin)` : msg.name;
  whereEl.textContent = msg.location ?? '';

  const s = msg.stats ?? {};
  const hpPct = s.hpMax > 0 ? Math.max(0, Math.min(100, (s.hp / s.hpMax) * 100)) : 0;
  const mpPct = s.mpMax > 0 ? Math.max(0, Math.min(100, (s.mp / s.mpMax) * 100)) : 0;
  const hpClass = hpPct < 30 ? 'low' : hpPct < 60 ? 'mid' : '';

  // Mirror HP/MP into the always-visible bottom-left status strip.
  stripHpLabel.textContent = labels.hp ?? 'HP';
  stripHpNum.textContent = `${s.hp ?? 0}/${s.hpMax ?? 0}`;
  stripHpFill.className = `strip-fill hp ${hpClass}`;
  stripHpFill.style.width = `${hpPct}%`;
  if (s.mpMax > 0) {
    stripMpRow.hidden = false;
    stripMpLabel.textContent = labels.mp ?? 'MP';
    stripMpNum.textContent = `${s.mp ?? 0}/${s.mpMax}`;
    stripMpFill.style.width = `${mpPct}%`;
  } else {
    stripMpRow.hidden = true;
  }

  playerStatsEl.innerHTML = '';
  if (typeof msg.level === 'number') {
    const xp = msg.xp ?? 0;
    const xpNext = msg.xpToNext ?? 0;
    const xpPct = xpNext > 0 ? Math.max(0, Math.min(100, (xp / xpNext) * 100)) : 0;
    const xpLabel = `${labels.level ?? 'Lv'} ${msg.level}`;
    playerStatsEl.appendChild(makeBar(xpLabel, `${xp}/${xpNext} ⭐`, xpPct, 'xp'));
  }
  if (typeof msg.unspentPoints === 'number' && msg.unspentPoints > 0) {
    const wrap = document.createElement('div');
    wrap.className = 'unspent-points-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip unspent-points';
    btn.textContent = (labels.unspentPoints ?? '★ {count}').replace('{count}', msg.unspentPoints);
    const tooltipPhrase = msg.unspentPointsPhrase ?? msg.unspentPoints;
    btn.title = (labels.unspentPointsTooltip ?? '{count} — click to train.')
      .replace('{count}', tooltipPhrase);
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openTrainPopover(btn, msg);
    });
    wrap.appendChild(btn);
    playerStatsEl.appendChild(wrap);
  }
  const vitals = document.createElement('div');
  vitals.className = 'vitals-line';
  const hpSpan = document.createElement('span');
  const hpLab = document.createElement('span');
  hpLab.className = 'vital-label';
  hpLab.textContent = labels.hp ?? 'HP';
  const hpVal = document.createElement('span');
  hpVal.className = `vital-value hp ${hpClass}`;
  hpVal.textContent = `${s.hp ?? 0}/${s.hpMax ?? 0}`;
  hpSpan.appendChild(hpLab);
  hpSpan.appendChild(hpVal);
  vitals.appendChild(hpSpan);
  if (s.mpMax > 0) {
    const mpSpan = document.createElement('span');
    const mpLab = document.createElement('span');
    mpLab.className = 'vital-label';
    mpLab.textContent = labels.mp ?? 'MP';
    const mpVal = document.createElement('span');
    mpVal.className = 'vital-value mp';
    mpVal.textContent = `${s.mp}/${s.mpMax}`;
    mpSpan.appendChild(mpLab);
    mpSpan.appendChild(mpVal);
    vitals.appendChild(mpSpan);
  }
  playerStatsEl.appendChild(vitals);
  const grid = document.createElement('div');
  grid.className = 'stat-grid';
  for (const [key, val] of [
    [labels.atk ?? 'ATK', s.attack],
    [labels.acc ?? 'ACC', s.accuracy],
    [labels.def ?? 'DEF', s.defense],
    [labels.eva ?? 'EVA', s.evasion],
    [labels.int ?? 'INT', s.int],
    [labels.mres ?? 'MRES', s.magicResist],
    [labels.perception ?? 'PER', s.perception ?? 0],
  ]) {
    const span = document.createElement('span');
    span.textContent = `${key} ${val ?? '?'}`;
    grid.appendChild(span);
  }
  playerStatsEl.appendChild(grid);

  if (typeof msg.gold === 'number') {
    const goldRow = document.createElement('div');
    goldRow.className = 'gold-row';
    goldRow.textContent = `${labels.gold ?? 'Gold'}: 🪙 ${msg.gold}`;
    playerStatsEl.appendChild(goldRow);
  }

  const effects = Array.isArray(msg.activeEffects) ? msg.activeEffects : [];
  if (effects.length > 0) {
    const effectsRow = document.createElement('div');
    effectsRow.className = 'effects-inline';
    effects.forEach((eff, i) => {
      if (i > 0) effectsRow.append(' ');
      const chip = document.createElement('span');
      chip.className = `chip effect ${eff.kind || 'neutral'}`;
      chip.textContent = `${eff.icon ? eff.icon + ' ' : ''}${eff.name}`;
      if (eff.pulsesLeft != null) {
        const counter = document.createElement('span');
        counter.className = 'effect-counter';
        counter.textContent = `${eff.pulsesLeft}`;
        chip.appendChild(counter);
      } else if (eff.chancePct != null) {
        const counter = document.createElement('span');
        counter.className = 'effect-counter';
        counter.textContent = `${eff.chancePct}%`;
        chip.appendChild(counter);
      }
      effectsRow.appendChild(chip);
    });
    playerStatsEl.appendChild(effectsRow);
  }

  // Tab bar: Spells / Items / Gear
  const inv = Array.isArray(msg.inventory) ? msg.inventory : [];
  const invConsumables = inv.filter(i => i.consumable);
  const invGear = inv.filter(i => i.wearable);
  const invOthers = inv.filter(i => !i.consumable && !i.wearable);

  const SPELL_HIDDEN_KEY = 'realm.quickbar.spells.hidden';
  const CONSUMABLE_HIDDEN_KEY = 'realm.quickbar.consumables.hidden';
  function loadHidden(key) { try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { return new Set(); } }
  function saveHidden(key, set) { localStorage.setItem(key, JSON.stringify([...set])); }

  function makeQuickbarCheckbox(id, hiddenKey) {
    const hidden = loadHidden(hiddenKey);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'quickbar-cb';
    cb.checked = !hidden.has(id);
    cb.title = 'Show in quick bar';
    cb.addEventListener('change', () => {
      const h = loadHidden(hiddenKey);
      if (cb.checked) h.delete(id); else h.add(id);
      saveHidden(hiddenKey, h);
    });
    return cb;
  }

  function buildSpellsTab(el) {
    const spells = Array.isArray(msg.knownSpells) ? msg.knownSpells : [];
    if (spells.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'empty';
      empty.textContent = labels.spellbookEmpty ?? '(none)';
      el.appendChild(empty);
      return;
    }
    for (const spell of spells) {
      const row = document.createElement('div');
      row.className = 'panel-list-row spell-row';
      const top = document.createElement('div');
      top.className = 'panel-list-row-top';
      const nameEl = document.createElement('span');
      nameEl.className = 'panel-list-row-name';
      nameEl.textContent = spell.name;
      const badges = document.createElement('span');
      badges.className = 'panel-list-row-badges';
      const targetBadge = document.createElement('span');
      targetBadge.className = 'panel-badge target';
      targetBadge.textContent = spell.targetLabel ?? spell.target;
      const mpBadge = document.createElement('span');
      mpBadge.className = 'panel-badge mp';
      mpBadge.textContent = `${spell.mpCost} MP`;
      badges.appendChild(targetBadge);
      badges.appendChild(mpBadge);
      top.appendChild(nameEl);
      top.appendChild(badges);
      row.appendChild(top);
      if (spell.description) {
        const desc = document.createElement('div');
        desc.className = 'panel-list-row-desc';
        desc.textContent = spell.description;
        row.appendChild(desc);
      }
      const actions = document.createElement('span');
      actions.className = 'panel-list-row-actions';
      const info = document.createElement('button');
      info.type = 'button';
      info.className = 'panel-list-row-info';
      info.textContent = 'ⓘ';
      info.title = labels.lookButton ?? 'Look';
      info.addEventListener('click', (ev) => {
        ev.stopPropagation();
        sendInput(`look ${spell.name}`);
      });
      actions.appendChild(info);
      actions.appendChild(makeQuickbarCheckbox(spell.id, SPELL_HIDDEN_KEY));
      row.appendChild(actions);
      el.appendChild(row);
    }
  }

  function buildItemsTab(el) {
    const filterKey = 'realm.panel.inventory.filter';
    let activeFilter = localStorage.getItem(filterKey) ?? 'all';
    const pillFilters = [
      { key: 'all', label: labels.filterAll ?? 'All' },
      { key: 'usable', label: labels.filterUsable ?? 'Usable' },
      { key: 'gear', label: labels.filterGear ?? 'Gear' },
      { key: 'other', label: labels.filterOther ?? 'Other' },
    ];
    const pillsRow = document.createElement('div');
    pillsRow.className = 'filter-pills';
    const listEl = document.createElement('div');
    const renderInvList = () => {
      listEl.innerHTML = '';
      const items = activeFilter === 'usable' ? invConsumables
        : activeFilter === 'gear' ? invGear
        : activeFilter === 'other' ? invOthers
        : inv;
      if (items.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'empty';
        empty.textContent = labels.inventoryEmpty ?? '(empty)';
        listEl.appendChild(empty);
        return;
      }
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'panel-list-row item-row';
        const nameEl = document.createElement('span');
        nameEl.className = 'panel-list-row-name';
        nameEl.textContent = item.name;
        row.appendChild(nameEl);
        if (item.count > 1) {
          const countEl = document.createElement('span');
          countEl.className = 'panel-list-row-count';
          countEl.textContent = `×${item.count}`;
          row.appendChild(countEl);
        }
        const actions = document.createElement('span');
        actions.className = 'panel-list-row-actions';
        const info = document.createElement('button');
        info.type = 'button';
        info.className = 'panel-list-row-info';
        info.textContent = 'ⓘ';
        info.title = labels.lookButton ?? 'Look';
        info.addEventListener('click', (ev) => {
          ev.stopPropagation();
          sendInput(`look ${item.name}`);
        });
        actions.appendChild(info);
        if (item.consumable) actions.appendChild(makeQuickbarCheckbox(item.defId, CONSUMABLE_HIDDEN_KEY));
        row.appendChild(actions);
        listEl.appendChild(row);
      }
    };
    for (const f of pillFilters) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `filter-pill${activeFilter === f.key ? ' active' : ''}`;
      pill.textContent = f.label;
      pill.addEventListener('click', () => {
        activeFilter = f.key;
        localStorage.setItem(filterKey, f.key);
        for (const p of pillsRow.querySelectorAll('.filter-pill')) p.classList.toggle('active', p === pill);
        renderInvList();
      });
      pillsRow.appendChild(pill);
    }
    el.appendChild(pillsRow);
    renderInvList();
    el.appendChild(listEl);
  }

  function buildGearTab(el) {
    const eq = msg.equipment ?? { slots: [], inInventory: [] };
    const slotLabels = labels.slotLabels ?? {};
    const slotEmpty = labels.slotEmpty ?? '—';
    for (const slotInfo of eq.slots) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'equipment-row';
      const slotLabel = document.createElement('span');
      slotLabel.className = 'equipment-row-slot';
      slotLabel.textContent = slotLabels[slotInfo.slot] ?? slotInfo.slot;
      const itemEl = document.createElement('span');
      itemEl.className = `equipment-row-item${slotInfo.defId ? '' : ' empty'}`;
      itemEl.textContent = slotInfo.name ?? slotEmpty;
      row.appendChild(slotLabel);
      row.appendChild(itemEl);
      row.addEventListener('click', (ev) => openEquipmentSlotPopover(row, slotInfo, eq.inInventory, ev));
      el.appendChild(row);
    }
  }

  const tabKey = 'realm.panel.tab';
  let activeTab = localStorage.getItem(tabKey) ?? 'spells';
  const tabDefs = [
    { key: 'spells', label: labels.spellbookTitle ?? 'Spells', build: buildSpellsTab },
    { key: 'items', label: labels.inventoryTitle ?? 'Items', build: buildItemsTab },
    { key: 'gear', label: labels.gearTitle ?? 'Gear', build: buildGearTab },
  ];

  const tabBar = document.createElement('div');
  tabBar.className = 'panel-tabs';
  const tabContent = document.createElement('div');
  tabContent.className = 'panel-tab-content';

  const buildActiveTab = () => {
    tabContent.innerHTML = '';
    (tabDefs.find(t => t.key === activeTab) ?? tabDefs[0]).build(tabContent);
  };

  for (const def of tabDefs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `panel-tab${activeTab === def.key ? ' active' : ''}`;
    btn.textContent = def.label;
    btn.addEventListener('click', () => {
      activeTab = def.key;
      localStorage.setItem(tabKey, def.key);
      for (const b of tabBar.querySelectorAll('.panel-tab')) b.classList.toggle('active', b === btn);
      buildActiveTab();
    });
    tabBar.appendChild(btn);
  }

  buildActiveTab();
  playerStatsEl.appendChild(tabBar);
  playerStatsEl.appendChild(tabContent);

  playerPanel.hidden = false;
  statusStrip.hidden = false;
}

function renderRoomInInspect(msg) {
  inspectPanel.hidden = false;
  backBtn.hidden = true;
  inspectBody.innerHTML = '';

  const name = document.createElement('div'); name.className = 'inspect-name'; name.textContent = msg.name;
  inspectBody.appendChild(name);

  if (msg.long || msg.short) {
    const desc = document.createElement('div'); desc.className = 'inspect-desc';
    desc.textContent = msg.long || msg.short;
    inspectBody.appendChild(desc);
  }

  if (msg.exits?.length) {
    const row = document.createElement('div'); row.className = 'inspect-row';
    const lab = document.createElement('span'); lab.className = 'inspect-row-label';
    lab.textContent = `${msg.exitsLabel ?? 'exits'}: `;
    row.appendChild(lab);
    msg.exits.forEach((ex, i) => {
      if (i > 0) row.append(' ');
      const group = document.createElement('span');
      group.className = 'inspect-exit';
      group.appendChild(makeChip(ex.label, 'exit', () => sendInput(ex.key)));
      if (ex.target) {
        const dest = document.createElement('span');
        dest.className = 'inspect-exit-dest';
        dest.textContent = ` → ${ex.target}`;
        group.appendChild(dest);
      }
      row.appendChild(group);
    });
    inspectBody.appendChild(row);
  }

  if (msg.items?.length || msg.gold > 0) {
    const row = document.createElement('div'); row.className = 'inspect-row';
    const lab = document.createElement('span'); lab.className = 'inspect-row-label';
    lab.textContent = `${msg.itemsLabel ?? 'on the ground'}: `;
    row.appendChild(lab);
    let first = true;
    if (msg.gold > 0) {
      const chip = makeChip(`🪙 ${msg.gold}`, 'item gold', () => sendInput('take gold'));
      row.appendChild(chip);
      first = false;
    }
    (msg.items ?? []).forEach((item) => {
      if (!first) row.append(' ');
      first = false;
      const label = item.count > 1 ? `${item.name} ×${item.count}` : item.name;
      const cssClass = item.pickable === false ? 'fixture' : 'item';
      const chip = makeChip(label, cssClass, (ev) => openRoomItemPopover(chip, item, ev));
      row.appendChild(chip);
    });
    inspectBody.appendChild(row);
  }

  if (msg.npcs?.length) {
    const row = document.createElement('div'); row.className = 'inspect-row';
    const lab = document.createElement('span'); lab.className = 'inspect-row-label';
    lab.textContent = `${msg.npcsLabel ?? 'you also see'}: `;
    row.appendChild(lab);
    msg.npcs.forEach((n, i) => {
      if (i > 0) row.append(' ');
      const name = typeof n === 'string' ? n : n.name;
      const disposition = typeof n === 'string' ? 'neutral' : (n.disposition ?? 'neutral');
      const cssClass = disposition === 'hostile' ? 'npc hostile' : 'npc';
      let chip;
      if (disposition === 'hostile') {
        chip = makeChip(`⚔️ ${name}`, cssClass, () => sendInput(`attack ${name}`));
      } else {
        chip = makeChip(name, cssClass, (ev) => openActorPopover(chip, name, ev, { disposition, kind: 'npc' }));
      }
      row.appendChild(chip);
    });
    inspectBody.appendChild(row);
  }

  if (msg.others?.length) {
    const row = document.createElement('div'); row.className = 'inspect-row';
    const lab = document.createElement('span'); lab.className = 'inspect-row-label';
    lab.textContent = `${msg.othersLabel ?? 'also here'}: `;
    row.appendChild(lab);
    msg.others.forEach((n, i) => {
      if (i > 0) row.append(' ');
      const chip = makeChip(n, 'player', (ev) => openActorPopover(chip, n, ev, { disposition: 'friendly', kind: 'player' }));
      row.appendChild(chip);
    });
    inspectBody.appendChild(row);
  }

  whereEl.textContent = msg.name;
}

function renderTargetInfo(msg) {
  inspectPanel.hidden = false;
  backBtn.hidden = !lastRoomMsg;
  inspectBody.innerHTML = '';

  const name = document.createElement('div'); name.className = 'inspect-name'; name.textContent = msg.name;
  inspectBody.appendChild(name);

  if (msg.subtitle) {
    const sub = document.createElement('div'); sub.className = 'inspect-subtitle'; sub.textContent = msg.subtitle;
    inspectBody.appendChild(sub);
  }
  if (msg.description) {
    const desc = document.createElement('div'); desc.className = 'inspect-desc';
    desc.textContent = msg.description;
    inspectBody.appendChild(desc);
  }
  if (Array.isArray(msg.details) && msg.details.length > 0) {
    for (const line of msg.details) {
      const row = document.createElement('div');
      row.className = 'inspect-desc';
      row.textContent = line;
      inspectBody.appendChild(row);
    }
  }
  if (msg.stats) {
    const labels = msg.statLabels ?? {};
    const s = msg.stats;
    const block = document.createElement('div');
    block.className = 'inspect-stats';
    const hpPct = s.hpMax > 0 ? Math.max(0, Math.min(100, (s.hp / s.hpMax) * 100)) : 0;
    const hpClass = hpPct <= 25 ? 'low' : hpPct <= 50 ? 'mid' : '';
    block.appendChild(makeBar(labels.hp ?? 'HP', `${s.hp}/${s.hpMax}`, hpPct, `hp ${hpClass}`));
    if (s.mpMax > 0) {
      const mpPct = s.mpMax > 0 ? Math.max(0, Math.min(100, (s.mp / s.mpMax) * 100)) : 0;
      block.appendChild(makeBar(labels.mp ?? 'MP', `${s.mp}/${s.mpMax}`, mpPct, 'mp'));
    }
    const grid = document.createElement('div');
    grid.className = 'inspect-stat-grid';
    for (const [k, v] of [
      [labels.atk ?? 'ATK', s.attack],
      [labels.acc ?? 'ACC', s.accuracy],
      [labels.def ?? 'DEF', s.defense],
      [labels.eva ?? 'EVA', s.evasion],
      [labels.int ?? 'INT', s.int],
      [labels.mres ?? 'MRES', s.magicResist],
    ]) {
      const span = document.createElement('span');
      span.textContent = `${k} ${v}`;
      grid.appendChild(span);
    }
    block.appendChild(grid);
    inspectBody.appendChild(block);
  }
  function formatExchangeSide(side) {
    return side.map(e => {
      if (e.kind === 'gold') return `${e.amount}g`;
      return e.count > 1 ? `${e.count} ${e.name}` : e.name;
    }).join(' + ');
  }

  function formatExchangeChipLabel(entry) {
    if (entry.flavor === 'buy') {
      const out = entry.outputs.find(x => x.kind === 'item');
      const gold = entry.inputs.find(x => x.kind === 'gold');
      return `${out.name} — ${gold.amount}g`;
    }
    if (entry.flavor === 'sell') {
      const inp = entry.inputs.find(x => x.kind === 'item');
      const gold = entry.outputs.find(x => x.kind === 'gold');
      const inpStr = inp.count > 1 ? `${inp.count} ${inp.name}` : inp.name;
      return `${inpStr} — ${gold.amount}g`;
    }
    return `${formatExchangeSide(entry.inputs)} → ${formatExchangeSide(entry.outputs)}`;
  }

  function chipSendForExchange(entry) {
    if (entry.flavor === 'buy') {
      const out = entry.outputs.find(x => x.kind === 'item');
      return `buy ${out.id}`;
    }
    if (entry.flavor === 'sell') {
      const inp = entry.inputs.find(x => x.kind === 'item');
      return `sell ${inp.id}`;
    }
    return `exchange ${entry.id}`;
  }

  if (Array.isArray(msg.exchanges) && msg.exchanges.length > 0) {
    const labels = msg.exchangeRowLabels ?? { buy: 'For sale', sell: 'Wants to buy', craft: 'Can make' };
    const flavorOrder = ['buy', 'sell', 'craft'];
    for (const flavor of flavorOrder) {
      const rows = msg.exchanges.filter(e => e.flavor === flavor);
      if (rows.length === 0) continue;
      const row = document.createElement('div');
      row.className = 'inspect-row';
      const lab = document.createElement('span');
      lab.className = 'inspect-row-label';
      lab.textContent = `${labels[flavor]}: `;
      row.appendChild(lab);
      rows.forEach((entry, i) => {
        if (i > 0) row.appendChild(document.createTextNode(', '));
        const label = formatExchangeChipLabel(entry);
        const send = chipSendForExchange(entry);
        const chip = makeChip(label, `chip-flavor-${flavor}`, () => sendInput(send));
        row.appendChild(chip);
      });
      inspectBody.appendChild(row);
    }
  }
  if (Array.isArray(msg.effects) && msg.effects.length > 0) {
    const row = document.createElement('div'); row.className = 'inspect-row';
    const lab = document.createElement('span'); lab.className = 'inspect-row-label';
    lab.textContent = `${msg.effectsLabel ?? 'effects'}: `;
    row.appendChild(lab);
    msg.effects.forEach((eff, i) => {
      if (i > 0) row.append(' ');
      const chip = document.createElement('span');
      chip.className = `chip effect ${eff.kind || 'neutral'}`;
      const iconText = eff.icon ? `${eff.icon} ` : '';
      chip.textContent = `${iconText}${eff.name}`;
      row.appendChild(chip);
    });
    inspectBody.appendChild(row);
  }
}

function makeInspectStatLine(text) {
  const div = document.createElement('div');
  div.className = 'inspect-stat-line';
  div.textContent = text;
  return div;
}

function handle(msg) {
  switch (msg.kind) {
    case 'login-required':
      appendText('system', msg.text ?? "welcome to Realm. type your character's name and press enter.");
      input.placeholder = 'character name...';
      break;
    case 'login-ok':
      loggedIn = true;
      whoEl.textContent = msg.isAdmin ? `${msg.name} (admin)` : msg.name;
      input.placeholder = "type a command (try 'help')";
      quickbar.hidden = false;
      break;
    case 'login-failed':
      appendText('error', msg.text);
      input.placeholder = 'character name...';
      break;
    case 'system':
      if (msg.tone === 'death') showDeathOverlay();
      appendText('system', msg.text, extraClasses(msg));
      break;
    case 'error':      appendText('error', msg.text, extraClasses(msg)); break;
    case 'say':        appendText('say', msg.text, extraClasses(msg)); break;
    case 'emote':      appendText('emote', msg.text, extraClasses(msg)); break;
    case 'room-transition':
      pendingRoomTransition = true;
      break;
    case 'room':
      dismissDeathOverlay();
      if (pendingRoomTransition) { appendRoomSep(msg.name); pendingRoomTransition = false; }
      lastRoomMsg = msg;
      if (!lockedTargetStillHostileHere()) lockedTarget = null;
      renderRoomInInspect(msg);
      renderDirButtons(msg);
      refreshActionButtons();
      break;
    case 'target-info':
      renderTargetInfo(msg);
      break;
    case 'stats':
      renderStats(msg);
      break;
    case 'tick':
      tickEl.textContent = `tick ${msg.count}`;
      break;
    default:
      appendText('system', JSON.stringify(msg));
  }
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.addEventListener('open', () => appendText('system', 'connected.'));
  ws.addEventListener('message', (ev) => {
    try { handle(JSON.parse(ev.data)); }
    catch { appendText('error', 'bad message from server'); }
  });
  ws.addEventListener('close', () => {
    appendText('error', 'disconnected. reload to reconnect.');
    loggedIn = false;
    whoEl.textContent = 'not connected';
    quickbar.hidden = true;
    playerPanel.hidden = true;
    statusStrip.hidden = true;
    inspectPanel.hidden = true;
  });
  ws.addEventListener('error', () => appendText('error', 'connection error'));
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const text = input.value;
  if (!text.trim()) return;
  input.value = '';
  history.push(text);
  if (history.length > 200) history.shift();
  historyIdx = history.length;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    appendText('error', 'not connected.');
    return;
  }
  if (!loggedIn) {
    ws.send(JSON.stringify({ kind: 'login', name: text.trim() }));
  } else {
    appendText('', `> ${text}`);
    ws.send(JSON.stringify({ kind: 'input', text }));
  }
});

const VERB_LIST = [
  'look', 'l', 'go', 'say', 'emote', 'who', 'help', 'quit', 'lang',
  'take', 'get', 'pick', 'drop', 'inventory', 'inv', 'give', 'buy', 'sell',
  'use', 'cast', 'attack', 'kill', 'hit', 'flee', 'search',
  'wear', 'equip', 'remove', 'unwear', 'equipment', 'eq',
  'n', 's', 'e', 'w', 'u', 'd', 'ne', 'nw', 'se', 'sw',
  'north', 'south', 'east', 'west', 'up', 'down',
  'northeast', 'northwest', 'southeast', 'southwest',
];

let tabCandidates = null;
let tabIdx = 0;

function buildTabCandidates(val) {
  const trimmed = val.trimStart();
  const parts = trimmed.split(/\s+/);
  const hasTrailingSpace = val.endsWith(' ');
  const verb = parts[0]?.toLowerCase() ?? '';
  const argParts = hasTrailingSpace ? parts.slice(1) : parts.slice(1, -1);
  const argPrefix = (hasTrailingSpace ? '' : (parts[parts.length - 1] ?? '')).toLowerCase();

  if (parts.length === 1 && !hasTrailingSpace) {
    const socials = (lastStatsMsg?.socials ?? []).map(s => s.verb);
    const pool = [...VERB_LIST, ...socials];
    return pool
      .filter(v => v.startsWith(verb) && v !== verb)
      .map(v => v + ' ');
  }

  const npcNames = (lastRoomMsg?.npcs ?? []).map(n => typeof n === 'string' ? n : n.name);
  const playerNames = lastRoomMsg?.others ?? [];
  const roomItems = (lastRoomMsg?.items ?? []).map(i => i.name);
  const invItems = (lastStatsMsg?.inventory ?? []).map(i => i.name);
  const spellIds = (lastStatsMsg?.knownSpells ?? []).map(s => s.id);

  let pool = [];
  if (['attack', 'kill', 'hit'].includes(verb)) {
    pool = [...npcNames, ...playerNames];
  } else if (['look', 'l'].includes(verb)) {
    pool = [...npcNames, ...playerNames, ...roomItems];
  } else if (['take', 'get', 'pick'].includes(verb)) {
    pool = roomItems;
  } else if (['drop', 'use', 'wear', 'equip', 'remove', 'unwear'].includes(verb)) {
    pool = invItems;
  } else if (['cast', 'c'].includes(verb)) {
    pool = spellIds;
  } else if (verb === 'give') {
    pool = argParts.length === 0 ? invItems : playerNames;
  }

  return pool
    .filter(n => n.toLowerCase().startsWith(argPrefix) && n.toLowerCase() !== argPrefix)
    .map(n => {
      const base = argParts.length > 0 ? `${verb} ${argParts.join(' ')} ${n}` : `${verb} ${n}`;
      return base + ' ';
    });
}

input.addEventListener('keydown', (ev) => {
  if (ev.key === 'Tab') {
    ev.preventDefault();
    if (!loggedIn) return;
    if (tabCandidates === null) {
      tabCandidates = buildTabCandidates(input.value);
      tabIdx = 0;
    }
    if (tabCandidates.length === 0) return;
    const completed = tabCandidates[tabIdx % tabCandidates.length];
    tabIdx++;
    input.value = completed;
    return;
  }

  tabCandidates = null;

  if (ev.key === 'ArrowUp') {
    if (historyIdx > 0) { historyIdx--; input.value = history[historyIdx]; }
    ev.preventDefault();
  } else if (ev.key === 'ArrowDown') {
    if (historyIdx < history.length - 1) { historyIdx++; input.value = history[historyIdx]; }
    else { historyIdx = history.length; input.value = ''; }
    ev.preventDefault();
  }
});

quickbar.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button');
  if (!btn) return;
  if (btn.id === 'attack-btn') { openAttackPicker(btn, ev); return; }
  if (btn.id === 'spell-btn') { openSpellPicker(btn, ev); return; }
  if (btn.id === 'look-btn') { openLookPicker(btn, ev); return; }
  if (btn.id === 'use-btn') { openUsePicker(btn, ev); return; }
  if (btn.id === 'give-btn') { openGivePicker(btn, ev); return; }
  if (btn.id === 'social-btn') { openSocialPicker(btn, ev); return; }
  if (btn.dataset.cmd) sendInput(btn.dataset.cmd);
  else if (btn.dataset.prefix) fillInput(btn.dataset.prefix);
});

backBtn.addEventListener('click', () => {
  if (lastRoomMsg) renderRoomInInspect(lastRoomMsg);
});

// ---- Popover system ----

function closePopover() {
  popover.hidden = true;
  popover.innerHTML = '';
  popover.dataset.anchor = '';
}

function positionPopover(anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  let top = rect.top - popRect.height - 4;
  if (top < 8) top = rect.bottom + 4;
  let left = rect.left;
  if (left + popRect.width > window.innerWidth - 8) {
    left = window.innerWidth - popRect.width - 8;
  }
  popover.style.top = `${Math.max(8, top)}px`;
  popover.style.left = `${Math.max(8, left)}px`;
}

function startPopover(anchorEl, titleText) {
  popover.innerHTML = '';
  popover.hidden = false;
  popover._anchor = anchorEl;
  if (titleText) {
    const title = document.createElement('div');
    title.className = 'popover-title';
    title.textContent = titleText;
    popover.appendChild(title);
  }
  return popover;
}

function popoverButton(label, cls, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  if (cls) btn.className = cls;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function popoverSection(text) {
  const div = document.createElement('div');
  div.className = 'popover-section';
  div.textContent = text;
  return div;
}

function openTrainPopover(anchorEl, msg) {
  const order = ['attack', 'defense', 'int', 'magicResist', 'accuracy', 'evasion', 'hpMax', 'mpMax'];
  const ratios = { attack: 1, defense: 1, int: 1, magicResist: 1, accuracy: 1, evasion: 1, hpMax: 5, mpMax: 2 };
  const shortNames = {
    attack: 'atk', defense: 'def', int: 'int', magicResist: 'mr',
    accuracy: 'acc', evasion: 'eva', hpMax: 'hp', mpMax: 'mp',
  };
  startPopover(anchorEl, labels.trainButton ?? 'Train');
  for (const key of order) {
    const label = labels[`trainLabel_${key}`] ?? key;
    const allocated = msg.allocated?.[key] ?? 0;
    const text = `${label} +${ratios[key]}` + (allocated > 0 ? ` (${allocated})` : '');
    popover.appendChild(popoverButton(text, 'chip train-stat', () => {
      sendInput(`train ${shortNames[key]}`);
      closePopover();
    }));
  }
  positionPopover(anchorEl);
}

function openActorPopover(anchorEl, targetName, ev, opts = {}) {
  ev?.stopPropagation();
  startPopover(anchorEl, targetName);
  popover.appendChild(popoverButton(labels.lookButton ?? 'Look', 'primary', () => {
    sendInput(`look ${targetName}`); closePopover();
  }));
  popover.appendChild(popoverButton(`${labels.giveButton ?? 'Give'} ▶`, '', () => {
    openGiveToActorSubmenu(anchorEl, targetName, opts);
  }));
  for (const social of socialList) {
    popover.appendChild(popoverButton(social.label, '', () => {
      sendInput(`${social.verb} ${targetName}`); closePopover();
    }));
  }
  positionPopover(anchorEl);
}

function openGiveToActorSubmenu(anchorEl, targetName, opts = {}) {
  startPopover(anchorEl, `${labels.giveButton ?? 'Give'}: ${targetName}`);
  popover.appendChild(popoverButton(labels.backButton ?? '← back', '', () => {
    openActorPopover(anchorEl, targetName, null, opts);
  }));
  const inv = Array.isArray(lastStatsMsg?.inventory) ? lastStatsMsg.inventory : [];
  const gold = lastStatsMsg?.gold ?? 0;
  const canGiveGold = opts.kind === 'player' && gold > 0;
  if (inv.length === 0 && !canGiveGold) {
    const empty = document.createElement('div');
    empty.style.padding = '4px';
    empty.style.color = 'var(--dim)';
    empty.style.fontSize = '12px';
    empty.textContent = labels.noItemsLabel ?? '(no items)';
    popover.appendChild(empty);
  } else {
    if (canGiveGold) {
      popover.appendChild(popoverButton(`🪙 ${labels.gold ?? 'Gold'}... (${gold})`, '', () => {
        const raw = window.prompt(`${labels.gold ?? 'Gold'} → ${targetName}`, '');
        if (raw === null) return;
        const amt = parseInt(raw.trim(), 10);
        if (!Number.isFinite(amt) || amt <= 0) { closePopover(); return; }
        sendInput(`give ${amt} gold to ${targetName}`); closePopover();
      }));
    }
    for (const invItem of inv) {
      const label = invItem.count > 1 ? `${invItem.name} ×${invItem.count}` : invItem.name;
      popover.appendChild(popoverButton(label, '', () => {
        sendInput(`give ${invItem.name} to ${targetName}`); closePopover();
      }));
    }
  }
  positionPopover(anchorEl);
}

function openRoomItemPopover(anchorEl, item, ev) {
  ev?.stopPropagation();
  startPopover(anchorEl, item.name);
  popover.appendChild(popoverButton(labels.lookButton ?? 'Look', 'primary', () => {
    sendInput(`look ${item.name}`); closePopover();
  }));
  if (item.pickable !== false) {
    popover.appendChild(popoverButton(labels.pickUpButton ?? 'Pick up', '', () => {
      sendInput(`take ${item.name}`); closePopover();
    }));
  }
  if (item.usable && item.pickable === false) {
    popover.appendChild(popoverButton(labels.useButton ?? 'Use', '', () => {
      sendInput(`use ${item.name}`); closePopover();
    }));
  }
  popover.appendChild(popoverButton(`${labels.useItemOnButton ?? 'Use item on this'} ▶`, '', () => {
    openUseInventoryOnSubmenu(anchorEl, item);
  }));
  positionPopover(anchorEl);
}

function openUseInventoryOnSubmenu(anchorEl, roomItem) {
  startPopover(anchorEl, `${labels.useItemOnButton ?? 'Use item on'}: ${roomItem.name}`);
  popover.appendChild(popoverButton(labels.backButton ?? '← back', '', () => {
    openRoomItemPopover(anchorEl, roomItem);
  }));
  const inv = Array.isArray(lastStatsMsg?.inventory) ? lastStatsMsg.inventory : [];
  if (inv.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '4px';
    empty.style.color = 'var(--dim)';
    empty.style.fontSize = '12px';
    empty.textContent = labels.noItemsLabel ?? '(no items)';
    popover.appendChild(empty);
  } else {
    for (const invItem of inv) {
      const label = invItem.count > 1 ? `${invItem.name} ×${invItem.count}` : invItem.name;
      popover.appendChild(popoverButton(label, '', () => {
        sendInput(`use ${invItem.name} on ${roomItem.name}`); closePopover();
      }));
    }
  }
  positionPopover(anchorEl);
}

function openInventoryItemPopover(anchorEl, item, ev) {
  ev?.stopPropagation();
  startPopover(anchorEl, item.name);
  popover.appendChild(popoverButton(labels.lookButton ?? 'Look', 'primary', () => {
    sendInput(`look ${item.name}`); closePopover();
  }));
  if (item.wearable) {
    popover.appendChild(popoverButton(labels.wearButton ?? 'Wear', '', () => {
      sendInput(`wear ${item.name}`); closePopover();
    }));
  }
  popover.appendChild(popoverButton(`${labels.useButton ?? 'Use'} ▶`, '', () => {
    openUseSubmenu(anchorEl, item);
  }));
  popover.appendChild(popoverButton(labels.dropButton ?? 'Drop', '', () => {
    sendInput(`drop ${item.name}`); closePopover();
  }));
  popover.appendChild(popoverButton(`${labels.giveButton ?? 'Give'} ▶`, '', () => {
    openGiveSubmenu(anchorEl, item);
  }));
  positionPopover(anchorEl);
}

function openUseSubmenu(anchorEl, item) {
  startPopover(anchorEl, `${labels.useButton ?? 'Use'}: ${item.name}`);
  popover.appendChild(popoverButton(labels.backButton ?? '← back', '', () => {
    openInventoryItemPopover(anchorEl, item);
  }));
  if (item.usable) {
    popover.appendChild(popoverButton(labels.yourselfLabel ?? 'Yourself', 'primary', () => {
      sendInput(`use ${item.name}`); closePopover();
    }));
    for (const t of currentRoomTargets()) {
      popover.appendChild(popoverButton(t.name, t.disposition === 'hostile' ? 'attack' : '', () => {
        sendInput(`use ${item.name} on ${t.name}`); closePopover();
      }));
    }
  }
  for (const roomItem of (lastRoomMsg?.items ?? [])) {
    popover.appendChild(popoverButton(roomItem.name, '', () => {
      sendInput(`use ${item.name} on ${roomItem.name}`); closePopover();
    }));
  }
  positionPopover(anchorEl);
}

function openGiveSubmenu(anchorEl, item) {
  startPopover(anchorEl, `${labels.giveButton ?? 'Give'}: ${item.name}`);
  popover.appendChild(popoverButton(labels.backButton ?? '← back', '', () => {
    openInventoryItemPopover(anchorEl, item);
  }));
  const targets = currentRoomTargets();
  if (targets.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '4px';
    empty.style.color = 'var(--dim)';
    empty.style.fontSize = '12px';
    empty.textContent = '(no one here)';
    popover.appendChild(empty);
  } else {
    for (const t of targets) {
      popover.appendChild(popoverButton(t.name, t.disposition === 'hostile' ? 'attack' : '', () => {
        sendInput(`give ${item.name} to ${t.name}`); closePopover();
      }));
    }
  }
  positionPopover(anchorEl);
}

function openEquipmentSlotPopover(anchorEl, slotInfo, inInventory, ev) {
  ev?.stopPropagation();
  const slotLabels = labels.slotLabels ?? {};
  const slotName = slotLabels[slotInfo.slot] ?? slotInfo.slot;
  startPopover(anchorEl, slotName);

  if (slotInfo.defId) {
    popover.appendChild(popoverButton(`✓ ${slotInfo.name}`, 'equipped', () => {
      sendInput(`remove ${slotInfo.name}`); closePopover();
    }));
  }

  const candidates = (inInventory || []).filter(w => w.slot === slotInfo.slot && w.defId !== slotInfo.defId);
  if (candidates.length === 0 && !slotInfo.defId) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = labels.equipmentEmpty ?? '(none)';
    popover.appendChild(empty);
  } else {
    for (const w of candidates) {
      const label = w.count > 1 ? `${w.name} ×${w.count}` : w.name;
      popover.appendChild(popoverButton(label, '', () => {
        sendInput(`wear ${w.name}`); closePopover();
      }));
    }
  }
  positionPopover(anchorEl);
}

function openSpellPopover(anchorEl, spell, ev) {
  ev?.stopPropagation();
  const targetKind = spell.target ?? 'any';

  if (targetKind === 'self' || targetKind === 'hostile_room' || targetKind === 'friendly_room') {
    sendInput(`cast ${spell.id}`);
    return;
  }

  if (targetKind === 'hostile') {
    const hostiles = currentRoomTargets({ hostileOnly: true });
    if (hostiles.length === 0) {
      sendInput(`cast ${spell.id}`);
      return;
    }
    if (hostiles.length === 1) {
      sendInput(`cast ${spell.id} on ${hostiles[0].name}`);
      return;
    }
    startPopover(anchorEl, `${labels.castButton ?? 'Cast'}: ${spell.name} (${spell.mpCost}MP)`);
    for (const t of hostiles) {
      popover.appendChild(popoverButton(t.name, 'attack', () => {
        sendInput(`cast ${spell.id} on ${t.name}`); closePopover();
      }));
    }
    positionPopover(anchorEl);
    return;
  }

  const candidates = currentRoomTargets({ excludeHostile: targetKind === 'friendly' });
  startPopover(anchorEl, `${labels.castButton ?? 'Cast'}: ${spell.name} (${spell.mpCost}MP)`);
  popover.appendChild(popoverButton(labels.yourselfLabel ?? 'Yourself', 'primary', () => {
    sendInput(`cast ${spell.id}`); closePopover();
  }));
  for (const t of candidates) {
    popover.appendChild(popoverButton(t.name, t.disposition === 'hostile' ? 'attack' : '', () => {
      sendInput(`cast ${spell.id} on ${t.name}`); closePopover();
    }));
  }
  positionPopover(anchorEl);
}

function openAttackPicker(anchorEl, ev) {
  ev?.stopPropagation();
  const lockedName = lockedTargetStillHostileHere();
  if (lockedName) {
    sendInput(`attack ${lockedName}`);
    return;
  }
  const targets = currentRoomTargets();
  const hostiles = currentRoomTargets({ hostileOnly: true });
  if (targets.length === 1 && hostiles.length === 1) {
    sendInput(`attack ${targets[0].name}`);
    return;
  }
  startPopover(anchorEl, labels.attackPickerTitle ?? 'Attack who?');
  if (targets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = labels.attackPickerEmpty ?? '(no targets)';
    popover.appendChild(empty);
  } else {
    for (const t of targets) {
      popover.appendChild(popoverButton(t.name, t.disposition === 'hostile' ? 'attack' : '', () => {
        sendInput(`attack ${t.name}`); closePopover();
      }));
    }
  }
  positionPopover(anchorEl);
}

function openSpellPicker(anchorEl, ev) {
  ev?.stopPropagation();
  const hidden = (() => { try { return new Set(JSON.parse(localStorage.getItem('realm.quickbar.spells.hidden') ?? '[]')); } catch { return new Set(); } })();
  const spells = (lastStatsMsg?.knownSpells ?? []).filter(s => !hidden.has(s.id));
  if (spells.length === 0) return;
  const currentMp = lastStatsMsg?.stats?.mp ?? 0;
  const sorted = [...spells].sort((a, b) => {
    const aOk = (a.mpCost ?? 0) <= currentMp;
    const bOk = (b.mpCost ?? 0) <= currentMp;
    if (aOk !== bOk) return aOk ? -1 : 1;
    return 0;
  });
  startPopover(anchorEl, labels.spellPickerTitle ?? 'Cast which spell?');
  for (const spell of sorted) {
    const canCast = (spell.mpCost ?? 0) <= currentMp;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = canCast ? 'spell-row' : 'spell-row disabled';
    if (!canCast) row.title = labels.spellNoMp ?? 'not enough mana';
    const name = document.createElement('span');
    name.className = 'spell-row-name';
    name.textContent = spell.name;
    const cost = document.createElement('span');
    cost.className = 'spell-row-cost';
    cost.textContent = `${spell.mpCost} MP`;
    row.appendChild(name);
    row.appendChild(cost);
    if (canCast) {
      row.addEventListener('click', () => {
        closePopover();
        openSpellPopover(anchorEl, spell);
      });
    }
    popover.appendChild(row);
  }
  positionPopover(anchorEl);
}

const DIR_LABELS = {
  n: 'N', s: 'S', e: 'E', w: 'W', u: 'U', d: 'D',
  ne: 'NE', nw: 'NW', se: 'SE', sw: 'SW',
  north: 'N', south: 'S', east: 'E', west: 'W', up: 'U', down: 'D',
  northeast: 'NE', northwest: 'NW', southeast: 'SE', southwest: 'SW',
};

function dirShortLabel(key) {
  const lower = (key ?? '').toLowerCase();
  if (DIR_LABELS[lower]) return DIR_LABELS[lower];
  return lower ? lower[0].toUpperCase() + lower.slice(1) : '?';
}

function renderDirButtons(roomMsg) {
  dirButtonsEl.innerHTML = '';
  const exits = roomMsg?.exits ?? [];
  if (exits.length === 0) {
    dirSepEl.hidden = true;
    return;
  }
  dirSepEl.hidden = false;
  for (const ex of exits) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.cmd = ex.key;
    btn.title = ex.label ?? ex.key;
    btn.textContent = dirShortLabel(ex.key);
    dirButtonsEl.appendChild(btn);
  }
}

function refreshActionButtons() {
}

function openLookPicker(anchorEl, ev) {
  ev?.stopPropagation();
  startPopover(anchorEl, 'Look at…');
  popover.appendChild(popoverButton('Room', 'primary', () => { sendInput('look'); closePopover(); }));
  for (const n of (lastRoomMsg?.npcs ?? [])) {
    const name = typeof n === 'string' ? n : n.name;
    popover.appendChild(popoverButton(name, '', () => { sendInput(`look ${name}`); closePopover(); }));
  }
  for (const item of (lastRoomMsg?.items ?? [])) {
    popover.appendChild(popoverButton(item.name, '', () => { sendInput(`look ${item.name}`); closePopover(); }));
  }
  popover.appendChild(popoverButton(labels.searchButton ?? 'Search', '', () => { sendInput('search'); closePopover(); }));
  positionPopover(anchorEl);
}

function openUsePicker(anchorEl, ev) {
  ev?.stopPropagation();
  const fixtures = (lastRoomMsg?.items ?? []).filter(it => it.usable && it.pickable === false);
  const inv = Array.isArray(lastStatsMsg?.inventory) ? lastStatsMsg.inventory : [];
  const hiddenConsumables = (() => { try { return new Set(JSON.parse(localStorage.getItem('realm.quickbar.consumables.hidden') ?? '[]')); } catch { return new Set(); } })();

  const gear = inv.filter(it => it.wearable);
  const others = inv.filter(it => it.usable && !it.wearable && !it.consumable);
  const consumables = inv.filter(it => it.consumable && !it.wearable && !hiddenConsumables.has(it.defId));

  startPopover(anchorEl, labels.usePickerTitle ?? 'Use…');

  if (fixtures.length === 0 && gear.length === 0 && others.length === 0 && consumables.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = labels.usePickerEmpty ?? '(nothing to use)';
    popover.appendChild(empty);
    positionPopover(anchorEl);
    return;
  }

  if (fixtures.length > 0) {
    popover.appendChild(popoverSection(labels.useSectionRoom ?? 'In room'));
    for (const f of fixtures) {
      popover.appendChild(popoverButton(f.name, '', () => { sendInput(`use ${f.name}`); closePopover(); }));
    }
  }

  if (gear.length > 0) {
    popover.appendChild(popoverSection(labels.useSectionGear ?? 'Gear'));
    for (const item of gear) {
      const label = item.count > 1 ? `${item.name} ×${item.count}` : item.name;
      if (item.usable) {
        popover.appendChild(popoverButton(`${label} ▶`, '', () => openGearItemSubmenu(anchorEl, item)));
      } else {
        popover.appendChild(popoverButton(label, '', () => { sendInput(`wear ${item.name}`); closePopover(); }));
      }
    }
  }

  if (others.length > 0) {
    popover.appendChild(popoverSection(labels.useSectionItems ?? 'Items'));
    for (const item of others) {
      const label = item.count > 1 ? `${item.name} ×${item.count}` : item.name;
      popover.appendChild(popoverButton(`${label} ▶`, '', () => openUseOnTargetPicker(anchorEl, item)));
    }
  }

  if (consumables.length > 0) {
    popover.appendChild(popoverSection(labels.useSectionConsumables ?? 'Consumables'));
    for (const item of consumables) {
      const label = item.count > 1 ? `${item.name} ×${item.count}` : item.name;
      popover.appendChild(popoverButton(label, '', () => { sendInput(`use ${item.name}`); closePopover(); }));
    }
  }

  positionPopover(anchorEl);
}

function openGearItemSubmenu(anchorEl, item) {
  startPopover(anchorEl, item.name);
  popover.appendChild(popoverButton(labels.backButton ?? '← back', '', () => openUsePicker(anchorEl)));
  popover.appendChild(popoverButton(labels.wearButton ?? 'Wear', '', () => { sendInput(`wear ${item.name}`); closePopover(); }));
  popover.appendChild(popoverButton(`${labels.useButton ?? 'Use'} ▶`, '', () => openUseOnTargetPicker(anchorEl, item)));
  positionPopover(anchorEl);
}

function openUseOnTargetPicker(anchorEl, item) {
  const tmpl = labels.useOnTargetTitle ?? 'Use {item} on…';
  startPopover(anchorEl, tmpl.replace('{item}', item.name));
  popover.appendChild(popoverButton(labels.backButton ?? '← back', '', () => {
    openUsePicker(anchorEl);
  }));
  if (item.usable) {
    popover.appendChild(popoverButton(labels.yourselfLabel ?? 'Yourself', 'primary', () => {
      sendInput(`use ${item.name}`); closePopover();
    }));
    for (const t of currentRoomTargets()) {
      popover.appendChild(popoverButton(t.name, t.disposition === 'hostile' ? 'attack' : '', () => {
        sendInput(`use ${item.name} on ${t.name}`); closePopover();
      }));
    }
  }
  for (const roomItem of (lastRoomMsg?.items ?? [])) {
    popover.appendChild(popoverButton(roomItem.name, '', () => {
      sendInput(`use ${item.name} on ${roomItem.name}`); closePopover();
    }));
  }
  positionPopover(anchorEl);
}

function openSocialPicker(anchorEl, ev) {
  ev?.stopPropagation();
  startPopover(anchorEl, labels.socialPickerTitle ?? 'Social');
  popover.appendChild(popoverButton('Say…', '', () => { fillInput('say '); closePopover(); }));
  popover.appendChild(popoverButton('Emote…', '', () => { fillInput('emote '); closePopover(); }));
  popover.appendChild(popoverButton('Who', '', () => { sendInput('who'); closePopover(); }));
  positionPopover(anchorEl);
}

function openGivePicker(anchorEl, ev) {
  ev?.stopPropagation();
  const inv = Array.isArray(lastStatsMsg?.inventory) ? lastStatsMsg.inventory : [];
  const gold = lastStatsMsg?.gold ?? 0;
  startPopover(anchorEl, labels.givePickerTitle ?? 'Give…');
  if (inv.length === 0 && gold === 0) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = labels.givePickerEmpty ?? '(nothing to give)';
    popover.appendChild(empty);
    positionPopover(anchorEl);
    return;
  }
  for (const item of inv) {
    const label = item.count > 1 ? `${item.name} ×${item.count}` : item.name;
    popover.appendChild(popoverButton(label, '', () => openGiveItemTargetPicker(anchorEl, item)));
  }
  if (gold > 0) {
    popover.appendChild(popoverButton(`${labels.gold ?? 'Gold'} (${gold})`, '', () => openGiveGoldTargetPicker(anchorEl)));
  }
  positionPopover(anchorEl);
}

function openGiveItemTargetPicker(anchorEl, item) {
  const targets = currentRoomTargets();
  const tmpl = labels.giveTargetTitle ?? 'Give {item} to…';
  startPopover(anchorEl, tmpl.replace('{item}', item.name));
  popover.appendChild(popoverButton(labels.backButton ?? '← back', '', () => openGivePicker(anchorEl)));
  if (targets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = labels.givePickerNoRecipients ?? '(no one here)';
    popover.appendChild(empty);
  } else {
    for (const t of targets) {
      popover.appendChild(popoverButton(t.name, '', () => { sendInput(`give ${item.name} to ${t.name}`); closePopover(); }));
    }
  }
  positionPopover(anchorEl);
}

function openGiveGoldTargetPicker(anchorEl) {
  const targets = currentRoomTargets();
  startPopover(anchorEl, labels.giveGoldTitle ?? 'Give gold to…');
  popover.appendChild(popoverButton(labels.backButton ?? '← back', '', () => openGivePicker(anchorEl)));
  if (targets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = labels.givePickerNoRecipients ?? '(no one here)';
    popover.appendChild(empty);
  } else {
    for (const t of targets) {
      popover.appendChild(popoverButton(t.name, '', () => { fillInput(`give gold to ${t.name}`); closePopover(); }));
    }
  }
  positionPopover(anchorEl);
}

function currentRoomTargets(opts = {}) {
  const out = [];
  if (lastRoomMsg?.npcs) {
    for (const n of lastRoomMsg.npcs) {
      const name = typeof n === 'string' ? n : n.name;
      const disposition = typeof n === 'string' ? 'neutral' : (n.disposition ?? 'neutral');
      if (opts.hostileOnly && disposition !== 'hostile') continue;
      if (opts.excludeHostile && disposition === 'hostile') continue;
      out.push({ name, disposition });
    }
  }
  if (!opts.hostileOnly && lastRoomMsg?.others) {
    for (const name of lastRoomMsg.others) out.push({ name, disposition: 'friendly' });
  }
  return out;
}

popover.addEventListener('click', (ev) => ev.stopPropagation());

document.addEventListener('click', (ev) => {
  if (popover.hidden) return;
  if (ev.target.classList?.contains('chip')) return;
  closePopover();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closePopover();
});

connect();
