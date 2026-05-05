#!/usr/bin/env node
// Reads content/rooms/*.json, computes a grid layout via BFS, writes map.html.
// Run: node build-map.js

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ROOMS_DIR = join(ROOT, "content", "rooms");
const OUT = join(ROOT, "map.html");

// Cardinal directions → [dx, dy]. Up/down treated as north/south with
// fallback offsets tried in order when the primary cell is occupied.
const DIR_PRIMARY = { n:[0,-1], s:[0,1], e:[1,0], w:[-1,0], u:[0,-1], d:[0,1] };
const DIR_FALLBACKS = {
  u: [[0,-1],[-1,-1],[1,-1],[0,-2],[-1,0],[1,0]],
  d: [[0, 1],[-1, 1],[1, 1],[0, 2],[-1,0],[1,0]],
};
// For plain directions use a short fallback spiral when blocked.
const SPIRAL = [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1],[2,0],[-2,0],[0,2],[0,-2]];

function fallbacks(dir, [bx, by]) {
  const list = DIR_FALLBACKS[dir] || SPIRAL.map(([dx,dy]) => [bx+dx, by+dy]);
  if (DIR_FALLBACKS[dir]) return list.map(([dx,dy]) => [bx+dx, by+dy]);
  const [pdx, pdy] = DIR_PRIMARY[dir] || [0,0];
  return [[bx+pdx, by+pdy], ...SPIRAL.map(([dx,dy]) => [bx+dx, by+dy])];
}

function buildLayout(rooms) {
  const roomMap = Object.fromEntries(rooms.map(r => [r.id, r]));
  const pos = {};      // id → [gx, gy]
  const occupied = new Set();
  const key = ([x,y]) => `${x},${y}`;

  function place(id, gx, gy) {
    pos[id] = [gx, gy];
    occupied.add(key([gx, gy]));
  }

  // Find a good start: prefer home.cottage, else first room alphabetically.
  const startId = rooms.find(r => r.id === "home.cottage")?.id ?? rooms[0]?.id;
  if (!startId) return pos;

  place(startId, 0, 0);
  const queue = [startId];

  while (queue.length) {
    const id = queue.shift();
    const room = roomMap[id];
    if (!room) continue;
    const [bx, by] = pos[id];

    for (const [dir, targetId] of Object.entries(room.exits || {})) {
      if (pos[targetId] !== undefined) continue;
      if (!roomMap[targetId]) continue;

      const candidates = fallbacks(dir, [bx, by]);
      let placed = false;
      for (const cell of candidates) {
        if (!occupied.has(key(cell))) {
          place(targetId, ...cell);
          queue.push(targetId);
          placed = true;
          break;
        }
      }
      if (!placed) {
        // Last resort: try a wider spiral
        for (let r = 3; r <= 6; r++) {
          let found = false;
          for (let dx = -r; dx <= r && !found; dx++) {
            for (let dy = -r; dy <= r && !found; dy++) {
              const cell = [bx+dx, by+dy];
              if (!occupied.has(key(cell))) {
                place(targetId, ...cell);
                queue.push(targetId);
                found = true;
              }
            }
          }
          if (found) break;
        }
      }
    }
  }

  // Any rooms not reachable from start (disconnected) get placed below the main graph.
  const maxY = Math.max(...Object.values(pos).map(([,y]) => y), 0);
  let floatX = 0, floatY = maxY + 2;
  for (const room of rooms) {
    if (pos[room.id] !== undefined) continue;
    while (occupied.has(key([floatX, floatY]))) floatX++;
    place(room.id, floatX++, floatY);
  }

  return pos;
}

function loadRooms() {
  const files = [];
  for (const entry of readdirSync(ROOMS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const sub of readdirSync(join(ROOMS_DIR, entry.name), { withFileTypes: true })) {
        if (sub.isFile() && sub.name.endsWith(".json"))
          files.push(join(ROOMS_DIR, entry.name, sub.name));
      }
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(join(ROOMS_DIR, entry.name));
    }
  }
  return files
    .map(f => {
      try { return JSON.parse(readFileSync(f, "utf8")); }
      catch (e) { console.warn(`Skipping ${f}: ${e.message}`); return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function nodeColor(room) {
  const tags = room.tags || [];
  if (tags.includes("tower"))  return "#3d2b6e";
  if (tags.includes("cave") || tags.includes("cellar")) return "#4a3728";
  const area = room.id.split(".")[0];
  return { home: "#2d6a4f", forest: "#1b4332" }[area] ?? "#1b4332";
}

function generateHTML(rooms, positions) {
  const roomsJSON = JSON.stringify(rooms, null, 2);
  const posJSON   = JSON.stringify(positions, null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Realm Map</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#1a1a2e;color:#e0e0e0;font-family:'Segoe UI',sans-serif;display:flex;height:100vh;overflow:hidden}
  #map-container{flex:1;overflow:hidden;position:relative;cursor:grab}
  #map-container.dragging{cursor:grabbing}
  svg{width:100%;height:100%;display:block}
  .room-node{cursor:pointer}
  .room-node:hover rect{filter:brightness(1.3)}
  .edge{stroke:#555;stroke-width:1.5;fill:none}
  .edge.vertical{stroke-dasharray:4 3;stroke:#444}
  .room-label{font-size:11px;fill:#fff;text-anchor:middle;dominant-baseline:middle;pointer-events:none;font-weight:600}
  .room-id-label{font-size:8px;fill:rgba(255,255,255,0.5);text-anchor:middle;dominant-baseline:middle;pointer-events:none}
  #sidebar{width:300px;background:#16213e;border-left:1px solid #0f3460;display:flex;flex-direction:column;overflow:hidden}
  #sidebar-header{padding:16px;background:#0f3460;border-bottom:1px solid #1a4a8a}
  #sidebar-header h2{font-size:11px;color:#a8d8ea;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
  #room-name{font-size:20px;font-weight:700;color:#fff}
  #room-id{font-size:11px;color:#6a8caf;margin-top:3px}
  #sidebar-body{padding:16px;overflow-y:auto;flex:1}
  #room-short{font-size:13px;color:#c0d8f0;font-style:italic;margin-bottom:14px;line-height:1.5}
  #room-long{font-size:12px;color:#a0b8cc;line-height:1.7;margin-bottom:14px}
  .section-label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#4a7a9b;margin-bottom:6px;margin-top:12px}
  .tags-row{display:flex;flex-wrap:wrap;gap:5px}
  .tag{background:#0f3460;border:1px solid #1a4a8a;border-radius:3px;font-size:10px;padding:2px 7px;color:#7ab}
  .exits-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px}
  .exit-item{background:#0d2137;border:1px solid #1a3a5a;border-radius:4px;padding:5px 8px;font-size:11px;cursor:pointer;transition:background .15s}
  .exit-item:hover{background:#1a4070}
  .exit-dir{color:#6a8caf;font-size:9px;text-transform:uppercase}
  .exit-name{color:#c0d8f0}
  .exit-item.unknown{opacity:.5;cursor:default}
  #empty-state{padding:32px 16px;color:#4a6a8a;font-size:13px;text-align:center;line-height:1.8}
  #controls{position:absolute;bottom:12px;left:12px;display:flex;gap:6px}
  .ctrl-btn{background:#16213e;border:1px solid #0f3460;color:#a8d8ea;width:32px;height:32px;border-radius:6px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:background .15s}
  .ctrl-btn:hover{background:#0f3460}
  #legend{position:absolute;top:12px;left:12px;background:rgba(22,33,62,.9);border:1px solid #0f3460;border-radius:6px;padding:10px 12px;font-size:11px}
  #legend h3{font-size:10px;color:#6a8caf;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
  .legend-row{display:flex;align-items:center;gap:7px;margin-bottom:4px}
  .legend-dot{width:12px;height:12px;border-radius:3px;flex-shrink:0}
  #lang-toggle{position:absolute;top:12px;right:12px;background:#16213e;border:1px solid #0f3460;color:#a8d8ea;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px}
  #lang-toggle:hover{background:#0f3460}
  #room-count{position:absolute;bottom:12px;right:12px;font-size:11px;color:#4a6a8a}
</style>
</head>
<body>
<div id="map-container">
  <svg id="svg">
    <g id="root-g"></g>
  </svg>
  <div id="controls">
    <button class="ctrl-btn" id="zoom-in" title="Zoom in">+</button>
    <button class="ctrl-btn" id="zoom-out" title="Zoom out">−</button>
    <button class="ctrl-btn" id="zoom-reset" title="Reset view">⊙</button>
  </div>
  <div id="legend">
    <h3>Areas</h3>
    <div class="legend-row"><div class="legend-dot" style="background:#2d6a4f"></div>Home</div>
    <div class="legend-row"><div class="legend-dot" style="background:#1b4332"></div>Forest</div>
    <div class="legend-row"><div class="legend-dot" style="background:#4a3728"></div>Cave/Cellar</div>
    <div class="legend-row"><div class="legend-dot" style="background:#3d2b6e"></div>Tower</div>
    <hr style="border:none;border-top:1px solid #1a3a5a;margin:7px 0">
    <div class="legend-row"><span style="color:#555">───</span>&nbsp;Cardinal</div>
    <div class="legend-row"><span style="color:#444">- - -</span>&nbsp;Up/Down</div>
  </div>
  <button id="lang-toggle">CS / EN</button>
  <div id="room-count"></div>
</div>
<div id="sidebar">
  <div id="sidebar-header">
    <h2>Room Inspector</h2>
    <div id="room-name">—</div>
    <div id="room-id"></div>
  </div>
  <div id="sidebar-body">
    <div id="empty-state">Click any room node to see its details.</div>
    <div id="room-detail" style="display:none">
      <div class="section-label">Short</div>
      <div id="room-short"></div>
      <div class="section-label">Description</div>
      <div id="room-long"></div>
      <div class="section-label">Tags</div>
      <div class="tags-row" id="room-tags"></div>
      <div class="section-label">Exits</div>
      <div class="exits-grid" id="room-exits"></div>
    </div>
  </div>
</div>
<script>
const ROOMS = ${roomsJSON};
const GRID_POSITIONS = ${posJSON};

const CELL = 110, NODE_W = 90, NODE_H = 36;
const VERTICAL = new Set(["u","d"]);
const DIR_NAMES = {n:"North",s:"South",e:"East",w:"West",u:"Up",d:"Down"};

const roomMap = Object.fromEntries(ROOMS.map(r => [r.id, r]));
let lang = "en", selectedId = null;
let transform = {x:0, y:0, scale:1};

function t(val) { return typeof val === "string" ? val : (val[lang] ?? val.en ?? ""); }

function nodeColor(room) {
  const tags = room.tags || [];
  if (tags.includes("tower")) return "#3d2b6e";
  if (tags.includes("cave") || tags.includes("cellar")) return "#4a3728";
  const area = room.id.split(".")[0];
  return {home:"#2d6a4f", forest:"#1b4332"}[area] ?? "#1b4332";
}

function getPos(id) {
  const [gx, gy] = GRID_POSITIONS[id] || [0, 0];
  return [gx * CELL, gy * CELL];
}

function buildSVG() {
  const g = document.getElementById("root-g");
  g.innerHTML = "";
  const edgeG = document.createElementNS("http://www.w3.org/2000/svg","g");
  const nodeG = document.createElementNS("http://www.w3.org/2000/svg","g");
  g.append(edgeG, nodeG);

  const drawn = new Set();
  ROOMS.forEach(room => {
    const [x1,y1] = getPos(room.id);
    Object.entries(room.exits||{}).forEach(([dir, tid]) => {
      const key = [room.id, tid].sort().join("|");
      if (drawn.has(key) || !roomMap[tid]) return;
      drawn.add(key);
      const [x2,y2] = getPos(tid);
      const line = document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1",x1); line.setAttribute("y1",y1);
      line.setAttribute("x2",x2); line.setAttribute("y2",y2);
      line.setAttribute("class", VERTICAL.has(dir) ? "edge vertical" : "edge");
      edgeG.appendChild(line);
    });
  });

  ROOMS.forEach(room => {
    const [cx,cy] = getPos(room.id);
    const sel = room.id === selectedId;
    const g2 = document.createElementNS("http://www.w3.org/2000/svg","g");
    g2.setAttribute("class","room-node");
    g2.setAttribute("data-id",room.id);

    const rect = document.createElementNS("http://www.w3.org/2000/svg","rect");
    rect.setAttribute("x", cx-NODE_W/2); rect.setAttribute("y", cy-NODE_H/2);
    rect.setAttribute("width", NODE_W); rect.setAttribute("height", NODE_H);
    rect.setAttribute("rx", 6);
    rect.setAttribute("fill", nodeColor(room));
    rect.setAttribute("stroke", sel ? "#fff" : "rgba(255,255,255,0.15)");
    rect.setAttribute("stroke-width", sel ? 2.5 : 1);

    const lbl = document.createElementNS("http://www.w3.org/2000/svg","text");
    lbl.setAttribute("class","room-label");
    lbl.setAttribute("x",cx); lbl.setAttribute("y",cy-5);
    lbl.textContent = t(room.name);

    const idl = document.createElementNS("http://www.w3.org/2000/svg","text");
    idl.setAttribute("class","room-id-label");
    idl.setAttribute("x",cx); idl.setAttribute("y",cy+10);
    idl.textContent = room.id;

    g2.append(rect, lbl, idl);
    g2.addEventListener("click", () => selectRoom(room.id));
    nodeG.appendChild(g2);
  });

  document.getElementById("room-count").textContent = ROOMS.length + " rooms";
}

function applyTransform() {
  document.getElementById("root-g").setAttribute("transform",
    \`translate(\${transform.x},\${transform.y}) scale(\${transform.scale})\`);
}

function centerView() {
  const svg = document.getElementById("svg");
  transform.scale = 1;
  transform.x = svg.clientWidth / 2 - 1 * CELL;
  transform.y = svg.clientHeight / 2;
  applyTransform();
}

function selectRoom(id) {
  selectedId = id;
  buildSVG(); applyTransform();
  const room = roomMap[id];
  if (!room) return;
  document.getElementById("empty-state").style.display = "none";
  document.getElementById("room-detail").style.display = "block";
  document.getElementById("room-name").textContent = t(room.name);
  document.getElementById("room-id").textContent = room.id;
  document.getElementById("room-short").textContent = t(room.short);
  document.getElementById("room-long").textContent = t(room.long);
  document.getElementById("room-tags").innerHTML =
    (room.tags||[]).map(tag => \`<span class="tag">\${tag}</span>\`).join("");
  document.getElementById("room-exits").innerHTML =
    Object.entries(room.exits||{}).map(([dir,tid]) => {
      const tr = roomMap[tid];
      const cls = tr ? "" : " unknown";
      const name = tr ? t(tr.name) : tid;
      return \`<div class="exit-item\${cls}" \${tr?'onclick="selectRoom(\\\''+tid+'\\\')"':''}>
        <div class="exit-dir">\${DIR_NAMES[dir]||dir}</div>
        <div class="exit-name">\${name}</div>
      </div>\`;
    }).join("");
}

let dragging=false, dragStart=null, transformStart=null;
const container = document.getElementById("map-container");
container.addEventListener("mousedown", e => {
  if (e.target.closest(".room-node")) return;
  dragging=true; dragStart={x:e.clientX,y:e.clientY};
  transformStart={x:transform.x,y:transform.y};
  container.classList.add("dragging");
});
window.addEventListener("mousemove", e => {
  if (!dragging) return;
  transform.x = transformStart.x + (e.clientX - dragStart.x);
  transform.y = transformStart.y + (e.clientY - dragStart.y);
  applyTransform();
});
window.addEventListener("mouseup", () => { dragging=false; container.classList.remove("dragging"); });
container.addEventListener("wheel", e => {
  e.preventDefault();
  const rect = container.getBoundingClientRect();
  const mx = e.clientX-rect.left, my = e.clientY-rect.top;
  const f = e.deltaY < 0 ? 1.12 : 1/1.12;
  const ns = Math.min(3, Math.max(0.3, transform.scale * f));
  transform.x = mx - (mx-transform.x)*(ns/transform.scale);
  transform.y = my - (my-transform.y)*(ns/transform.scale);
  transform.scale = ns; applyTransform();
}, {passive:false});
document.getElementById("zoom-in").onclick  = () => { transform.scale=Math.min(3,transform.scale*1.2); applyTransform(); };
document.getElementById("zoom-out").onclick = () => { transform.scale=Math.max(0.3,transform.scale/1.2); applyTransform(); };
document.getElementById("zoom-reset").onclick = centerView;
document.getElementById("lang-toggle").onclick = () => {
  lang = lang==="en" ? "cs" : "en";
  document.getElementById("lang-toggle").textContent = lang==="en" ? "CS / EN" : "EN / CS";
  buildSVG(); applyTransform();
  if (selectedId) selectRoom(selectedId);
};

buildSVG();
window.addEventListener("load", centerView);
setTimeout(centerView, 50);
</script>
</body>
</html>`;
}

const rooms = loadRooms();
const positions = buildLayout(rooms);
const html = generateHTML(rooms, positions);
writeFileSync(OUT, html, "utf8");
console.log(`map.html written — ${rooms.length} rooms`);
