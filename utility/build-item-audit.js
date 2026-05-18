#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ITEMS_DIR = join(ROOT, "content", "items");
const NPCS_DIR  = join(ROOT, "content", "npcs");
const OUT       = join(ROOT, "item-audit.html");

function loadItems() {
  const items = [];
  for (const cat of readdirSync(ITEMS_DIR, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    const category = cat.name.replace(/^_/, "");
    for (const file of readdirSync(join(ITEMS_DIR, cat.name), { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(readFileSync(join(ITEMS_DIR, cat.name, file.name), "utf8"));
        items.push({ ...raw, _category: category });
      } catch (e) { console.warn(`Skipping ${file.name}: ${e.message}`); }
    }
  }
  return items.sort((a, b) => a.id.localeCompare(b.id));
}

function loadNPCs() {
  const npcs = [];
  for (const area of readdirSync(NPCS_DIR, { withFileTypes: true })) {
    if (!area.isDirectory()) continue;
    for (const file of readdirSync(join(NPCS_DIR, area.name), { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      try {
        npcs.push(JSON.parse(readFileSync(join(NPCS_DIR, area.name, file.name), "utf8")));
      } catch (e) { console.warn(`Skipping ${file.name}: ${e.message}`); }
    }
  }
  return npcs;
}

function buildXref(items, npcs) {
  const lootOf   = {};
  const outputOf = {};
  const inputOf  = {};
  const keyFor   = {};

  const addLoot   = (id, src)           => (lootOf[id]   ??= []).push(src);
  const addOutput = (id, src, exId)     => (outputOf[id] ??= []).push({ source: src, exchangeId: exId });
  const addInput  = (id, src, exId, fl) => (inputOf[id]  ??= []).push({ source: src, exchangeId: exId, flavor: fl });
  const addKey    = (id, doorId)        => (keyFor[id]   ??= []).push(doorId);

  for (const npc of npcs) {
    for (const l of npc.loot || [])
      if (l.defId) addLoot(l.defId, npc.id);
    for (const ex of npc.exchanges || []) {
      for (const inp of ex.inputs  || []) if (inp.item) addInput (inp.item, npc.id, ex.id, ex.flavor);
      for (const out of ex.outputs || []) if (out.item) addOutput(out.item, npc.id, ex.id);
    }
  }

  for (const item of items) {
    for (const ex of item.exchanges || []) {
      for (const inp of ex.inputs  || []) if (inp.item) addInput (inp.item, item.id, ex.id, ex.flavor);
      for (const out of ex.outputs || []) if (out.item) addOutput(out.item, item.id, ex.id);
    }
    if (item.unlocks?.key) addKey(item.unlocks.key, item.id);
  }

  return { lootOf, outputOf, inputOf, keyFor };
}

function hasSpawnBlock(item) {
  return !!item.spawn && (!!item.spawn.location || !!item.spawn.locations);
}

function spawnDesc(item) {
  if (!item.spawn) return null;
  const sp = item.spawn;
  if (sp.location) return sp.location + " x" + (sp.count || 1) + (sp.respawnTicks ? " (respawn " + sp.respawnTicks + "t)" : "");
  if (sp.locations) {
    const rooms = Object.keys(sp.locations);
    return rooms.join(", ") + (sp.respawnTicks ? " (respawn " + sp.respawnTicks + "t)" : "");
  }
  return null;
}

function annotate(item, { lootOf, outputOf, inputOf, keyFor }) {
  const loot        = lootOf  [item.id] || [];
  const craftedFrom = outputOf[item.id] || [];
  const usedIn      = inputOf [item.id] || [];
  const isKeyFor    = keyFor  [item.id] || [];
  const hasSource   = hasSpawnBlock(item) || loot.length > 0 || craftedFrom.length > 0;
  const hasPurpose  = !!item.use || !!item.wearable || !!(item.exchanges?.length) ||
                      !!item.unlocks || usedIn.length > 0 || isKeyFor.length > 0;
  return { ...item, _loot: loot, _craftedFrom: craftedFrom, _usedIn: usedIn,
           _keyFor: isKeyFor, _hasSource: hasSource, _hasPurpose: hasPurpose };
}

function generateHTML(items) {
  const data   = JSON.stringify(items);
  const noSrc  = items.filter(i => !i._hasSource).length;
  const noPurp = items.filter(i => !i._hasPurpose).length;
  const dead   = items.filter(i => !i._hasSource && !i._hasPurpose).length;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Realm Item Audit</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1a1a2e;color:#e0e0e0;font-family:'Segoe UI',sans-serif;height:100vh;overflow:hidden;display:flex;flex-direction:column}
#hdr{background:#0f1630;border-bottom:1px solid #1a3a6a;padding:10px 16px;flex-shrink:0}
#hdr-top{display:flex;align-items:center;gap:10px;margin-bottom:8px}
h1{font-size:15px;font-weight:700;color:#a8d8ea;letter-spacing:.5px;flex-shrink:0}
.pill{background:#16213e;border:1px solid #1a4a8a;border-radius:10px;padding:2px 9px;font-size:11px;color:#6a9cbf;white-space:nowrap}
.pill b{color:#fff}
.pill.warn{border-color:#5a3a1a;color:#9a7a4a}.pill.warn b{color:#cf9a5a}
.pill.danger{border-color:#5a1a1a;color:#9a4a4a}.pill.danger b{color:#cf5a5a}
#search{flex:1;background:#16213e;border:1px solid #1a4a8a;border-radius:6px;color:#e0e0e0;padding:5px 10px;font-size:12px;outline:none;min-width:0}
#search:focus{border-color:#4a8aba}
#lang-btn{background:#16213e;border:1px solid #1a4a8a;border-radius:6px;color:#a8d8ea;padding:4px 11px;cursor:pointer;font-size:12px;flex-shrink:0}
#lang-btn:hover{background:#0f3460}
#frow{display:flex;gap:6px}
.fb{background:#16213e;border:1px solid #1a4a8a;border-radius:6px;color:#6a9cbf;padding:4px 12px;cursor:pointer;font-size:11px;transition:background .15s,color .15s}
.fb:hover{background:#1a3a6a;color:#a8d8ea}
.fb.on{background:#0f3460;color:#a8d8ea;border-color:#4a7aba}
.fb .n{display:inline-block;background:#0d1e40;border-radius:8px;padding:1px 6px;margin-left:4px;font-weight:600}
.fb.on .n{background:#1a4a8a}
#main{display:flex;flex:1;overflow:hidden}
#tbl-wrap{flex:1;overflow-y:auto}
table{width:100%;border-collapse:collapse}
thead tr{background:#0d1e40;position:sticky;top:0;z-index:1}
th{padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#4a7a9b;text-align:left;border-bottom:1px solid #1a3a5a;font-weight:600}
tbody tr{border-bottom:1px solid #0d1a30;cursor:pointer;transition:background .1s}
tbody tr:hover{background:#1a2a4a!important}
tbody tr.sel{background:#1a3a6a!important}
tbody tr.dead{background:rgba(180,40,40,.12)}
tbody tr.nosrc{background:rgba(180,110,30,.10)}
tbody tr.nopurp{background:rgba(160,130,30,.08)}
td{padding:7px 10px;font-size:12px;vertical-align:middle}
.si{font-size:15px;line-height:1;text-align:center}
.iname{font-weight:600;color:#d0e8f8}
.iid{font-size:10px;color:#4a7a9b;font-family:monospace;margin-top:1px}
.cb{display:inline-block;border-radius:3px;padding:1px 7px;font-size:10px;font-weight:600;letter-spacing:.3px}
.cb-generic{background:#1b3040;color:#5a9abf}
.cb-consumables{background:#1b3020;color:#5abf7a}
.cb-wearables{background:#2a1b40;color:#9a7abf}
.cb-fixtures{background:#3a2a10;color:#bf9a4a}
.badges{display:flex;flex-wrap:wrap;gap:3px}
.bx{display:inline-block;border-radius:3px;padding:1px 6px;font-size:10px;font-weight:500}
.bx-spawn{background:#1a3a5a;color:#5a9acf}
.bx-loot{background:#1a3a2a;color:#5abf7a}
.bx-craf{background:#2a1a4a;color:#9a7abf}
.bx-none{background:#2a1a1a;color:#8a5a5a}
.bx-use{background:#2a1a10;color:#cf8a4a}
.bx-wear{background:#1a2a4a;color:#5a8acf}
.bx-exch{background:#1a3a3a;color:#4abfbf}
.bx-key{background:#2a2a10;color:#bfbf4a}
.bx-ingr{background:#2a1a3a;color:#af6abf}
#sb{width:320px;background:#16213e;border-left:1px solid #1a3a5a;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0}
#sb-hdr{padding:12px 16px;background:#0f2040;border-bottom:1px solid #1a4a8a}
#sb-hdr h2{font-size:9px;color:#4a7a9b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
#sb-name{font-size:17px;font-weight:700;color:#fff;line-height:1.2}
#sb-id{font-size:10px;color:#4a7a9b;margin-top:3px;font-family:monospace}
#sb-meta{margin-top:7px;display:flex;gap:4px;flex-wrap:wrap}
#sb-body{padding:14px 16px;overflow-y:auto;flex:1;font-size:12px;line-height:1.6}
.sec{margin-top:14px}.sec:first-child{margin-top:0}
.sec-lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#4a7a9b;margin-bottom:5px;font-weight:600;border-bottom:1px solid #0d1a30;padding-bottom:4px}
.kv{display:flex;margin-bottom:3px;gap:6px;align-items:baseline}
.kv .k{color:#5a8abf;font-size:10px;text-transform:uppercase;width:76px;flex-shrink:0}
.kv .v{color:#d0e8f8;word-break:break-word;font-size:11px}
.short-txt{font-style:italic;color:#8aaabf;margin-bottom:10px;line-height:1.5}
.long-txt{color:#7a9aac;margin-bottom:10px;line-height:1.6;font-size:11px}
.warn-row{color:#9a5a5a;margin-top:5px;font-size:11px;padding:5px 8px;background:rgba(140,40,40,.15);border-radius:4px;border-left:2px solid #7a3a3a}
#empty{padding:32px 16px;color:#4a6a8a;font-size:12px;text-align:center;line-height:2}
#tbl-foot{font-size:11px;color:#3a5a7a;padding:6px 10px;border-top:1px solid #0d1a30;flex-shrink:0}
</style>
</head><body>
<div id="hdr">
  <div id="hdr-top">
    <h1>Realm Item Audit</h1>
    <div class="pill">Total <b>${items.length}</b></div>
    <div class="pill warn">No source <b>${noSrc}</b></div>
    <div class="pill warn">No purpose <b>${noPurp}</b></div>
    <div class="pill danger">Dead <b>${dead}</b></div>
    <input type="search" id="search" placeholder="Filter by name or ID…">
    <button id="lang-btn">CS</button>
  </div>
  <div id="frow">
    <button class="fb on" data-f="all">All <span class="n">${items.length}</span></button>
    <button class="fb" data-f="nosrc">No Source <span class="n">${noSrc}</span></button>
    <button class="fb" data-f="nopurp">No Purpose <span class="n">${noPurp}</span></button>
    <button class="fb" data-f="dead" style="color:#9a5a5a">Dead (both) <span class="n" style="background:#2a1a1a">${dead}</span></button>
  </div>
</div>
<div id="main">
  <div id="tbl-wrap">
    <table>
      <thead><tr>
        <th style="width:30px"></th>
        <th>Name / ID</th>
        <th style="width:88px">Category</th>
        <th>Source</th>
        <th>Purpose</th>
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table>
    <div id="tbl-foot"></div>
  </div>
  <div id="sb">
    <div id="sb-hdr">
      <h2>Item Inspector</h2>
      <div id="sb-name">—</div>
      <div id="sb-id"></div>
      <div id="sb-meta"></div>
    </div>
    <div id="sb-body">
      <div id="empty">Click any item to inspect it.</div>
      <div id="detail" style="display:none"></div>
    </div>
  </div>
</div>
<script>
const ITEMS = ${data};
const imap = Object.fromEntries(ITEMS.map(function(i){ return [i.id, i]; }));
var lang = "en", flt = "all", qry = "", sel = null;

function t(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  return v[lang] || v.en || "";
}

function srcBadges(item) {
  var b = [];
  if (item.spawn) {
    if (item.spawn.location) {
      b.push('<span class="bx bx-spawn">spawn: ' + item.spawn.location + '</span>');
    } else if (item.spawn.locations) {
      var rooms = Object.keys(item.spawn.locations);
      b.push('<span class="bx bx-spawn">spawn: ' + rooms.length + ' room' + (rooms.length > 1 ? 's' : '') + '</span>');
    }
  }
  (item._loot || []).forEach(function(n){ b.push('<span class="bx bx-loot">loot: ' + n + '</span>'); });
  (item._craftedFrom || []).forEach(function(c){ b.push('<span class="bx bx-craf">craft: ' + c.source + '</span>'); });
  return b.length ? b.join(" ") : '<span class="bx bx-none">none</span>';
}

function purpBadges(item) {
  var b = [];
  if (item.use) b.push('<span class="bx bx-use">use</span>');
  if (item.wearable) b.push('<span class="bx bx-wear">wear: ' + item.wearable.slot + '</span>');
  if (item.exchanges && item.exchanges.length) b.push('<span class="bx bx-exch">exchanges \xd7' + item.exchanges.length + '</span>');
  if (item.unlocks) b.push('<span class="bx bx-key">lockable</span>');
  (item._keyFor || []).forEach(function(){ b.push('<span class="bx bx-key">key</span>'); });
  (item._usedIn || []).forEach(function(u){ b.push('<span class="bx bx-ingr">' + (u.flavor || "used") + ': ' + u.source + '</span>'); });
  return b.length ? b.join(" ") : '<span class="bx bx-none">none</span>';
}

function icon(item) {
  if (!item._hasSource && !item._hasPurpose) return '<span title="Dead: no source, no purpose">🔴</span>';
  if (!item._hasSource)  return '<span title="No source">🟠</span>';
  if (!item._hasPurpose) return '<span title="No purpose">🟡</span>';
  return '<span title="OK">🟢</span>';
}

function rowCls(item) {
  if (!item._hasSource && !item._hasPurpose) return "dead";
  if (!item._hasSource)  return "nosrc";
  if (!item._hasPurpose) return "nopurp";
  return "";
}

function catBadge(cat) { return '<span class="cb cb-' + cat + '">' + cat + '</span>'; }

function visible() {
  return ITEMS.filter(function(item) {
    if (flt === "nosrc"  &&  item._hasSource)  return false;
    if (flt === "nopurp" &&  item._hasPurpose) return false;
    if (flt === "dead"   && (item._hasSource || item._hasPurpose)) return false;
    if (qry) {
      var q = qry.toLowerCase();
      if (item.id.toLowerCase().indexOf(q) < 0 && t(item.name).toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  });
}

function render() {
  var vis = visible();
  document.getElementById("tbl-foot").textContent = "Showing " + vis.length + " of " + ITEMS.length + " items";
  document.getElementById("tbody").innerHTML = vis.map(function(item) {
    var cls = rowCls(item) + (item.id === sel ? " sel" : "");
    return '<tr class="' + cls.trim() + '" data-id="' + item.id + '">' +
      '<td class="si">' + icon(item) + '</td>' +
      '<td><div class="iname">' + t(item.name) + '</div><div class="iid">' + item.id + '</div></td>' +
      '<td>' + catBadge(item._category) + '</td>' +
      '<td><div class="badges">' + srcBadges(item) + '</div></td>' +
      '<td><div class="badges">' + purpBadges(item) + '</div></td>' +
      '</tr>';
  }).join("");
  document.querySelectorAll("#tbody tr").forEach(function(row) {
    row.addEventListener("click", function(){ selectItem(row.dataset.id); });
  });
}

function fmtBonus(bonus) {
  if (!bonus) return "—";
  return Object.keys(bonus).map(function(k) {
    var v = bonus[k];
    return k + " " + (v > 0 ? "+" : "") + v;
  }).join(", ");
}

function selectItem(id) {
  sel = id;
  render();
  var item = imap[id];
  if (!item) return;
  document.getElementById("empty").style.display = "none";
  document.getElementById("detail").style.display = "block";
  document.getElementById("sb-name").textContent = t(item.name);
  document.getElementById("sb-id").textContent = item.id;
  document.getElementById("sb-meta").innerHTML = catBadge(item._category) + " " +
    (item.tags || []).map(function(tag) {
      return '<span class="bx" style="background:#0f1830;color:#5a7a9b">' + tag + '</span>';
    }).join(" ");

  var h = "";
  if (item.short) h += '<div class="short-txt">' + t(item.short) + '</div>';
  if (item.long)  h += '<div class="long-txt">'  + t(item.long)  + '</div>';

  h += '<div class="sec"><div class="sec-lbl">Source</div>';
  if (item.spawn) {
    var sp = item.spawn;
    if (sp.location) {
      h += kv("Spawn", sp.location + " \xd7" + (sp.count || 1) + (sp.respawnTicks ? " (respawn " + sp.respawnTicks + "t)" : ""));
    } else if (sp.locations) {
      Object.keys(sp.locations).forEach(function(room) {
        h += kv("Spawn", room + " \xd7" + sp.locations[room] + (sp.respawnTicks ? " (respawn " + sp.respawnTicks + "t)" : ""));
      });
    }
  }
  if ((item._loot || []).length)
    h += kv("Loot", item._loot.join(", "));
  if ((item._craftedFrom || []).length)
    item._craftedFrom.forEach(function(c){ h += kv("Crafted", c.source + " / " + c.exchangeId); });
  if (!item._hasSource)
    h += '<div class="warn-row">⚠ No source — item cannot enter the game.</div>';
  h += '</div>';

  h += '<div class="sec"><div class="sec-lbl">Purpose</div>';
  if (item.use)
    h += kv("Use", "consumable");
  if (item.wearable) {
    h += kv("Slot", item.wearable.slot);
    if (item.wearable.bonus) h += kv("Bonus", fmtBonus(item.wearable.bonus));
    if (item.wearable.damage) h += kv("Damage", item.wearable.damage);
  }
  if (item.unlocks)
    h += kv("Lockable", "key: " + item.unlocks.key + ", exit: " + item.unlocks.exit);
  if (item.exchanges && item.exchanges.length)
    h += kv("Exchanges", item.exchanges.length + " recipe(s)");
  if ((item._keyFor || []).length)
    h += kv("Key for", item._keyFor.join(", "));
  if ((item._usedIn || []).length)
    item._usedIn.forEach(function(u){ h += kv(u.flavor || "used", u.source + " / " + u.exchangeId); });
  if (!item._hasPurpose)
    h += '<div class="warn-row">⚠ No purpose — cannot be equipped, used, traded, or used as ingredient.</div>';
  h += '</div>';

  if (item.weight !== undefined) {
    h += '<div class="sec"><div class="sec-lbl">Physical</div>';
    h += kv("Weight", item.weight);
    if (item.pickable === false) h += kv("Pickable", "no (fixture)");
    h += '</div>';
  }

  document.getElementById("detail").innerHTML = h;
}

function kv(key, val) {
  return '<div class="kv"><span class="k">' + key + '</span><span class="v">' + val + '</span></div>';
}

document.querySelectorAll(".fb").forEach(function(btn) {
  btn.addEventListener("click", function() {
    flt = btn.dataset.f;
    document.querySelectorAll(".fb").forEach(function(b){ b.classList.remove("on"); });
    btn.classList.add("on");
    render();
  });
});
document.getElementById("search").addEventListener("input", function(e){ qry = e.target.value; render(); });
document.getElementById("lang-btn").addEventListener("click", function() {
  lang = lang === "en" ? "cs" : "en";
  document.getElementById("lang-btn").textContent = lang === "en" ? "CS" : "EN";
  render();
  if (sel) selectItem(sel);
});

render();
</script>
</body></html>`;
}

const items     = loadItems();
const npcs      = loadNPCs();
const xref      = buildXref(items, npcs);
const annotated = items.map(item => annotate(item, xref));
const html      = generateHTML(annotated);
writeFileSync(OUT, html, "utf8");

const dead   = annotated.filter(i => !i._hasSource && !i._hasPurpose).length;
const noSrc  = annotated.filter(i => !i._hasSource).length;
const noPurp = annotated.filter(i => !i._hasPurpose).length;
console.log(`item-audit.html written — ${items.length} items, ${noSrc} no source, ${noPurp} no purpose, ${dead} dead`);
