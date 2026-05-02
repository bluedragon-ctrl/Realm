import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadPlayer, savePlayer } from '../persist/players.js';
import { world, isAdmin, registerActor, removeActor, placeActor, findActor } from '../game/world.js';
import { makePlayerActor } from '../game/actors.js';
import { runCommand } from '../game/commands.js';
import { describeRoom, describeRoomToAll } from '../game/actions/look.js';
import { sendStats } from '../game/messages.js';
import { serializeInventory } from '../game/items.js';
import { applyAggressionOnEnter } from '../game/combat.js';
import { s, DEFAULT_LANG } from '../i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, '../../client');
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(CLIENT_DIR, urlPath);
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'content-type': STATIC_TYPES[ext] ?? 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404); res.end('not found');
    } else {
      res.writeHead(500); res.end('server error');
    }
  }
}

function makeSession(ws) {
  return {
    ws,
    actor: null,
    send(msg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
    close() {
      try { ws.close(); } catch {}
    },
  };
}

async function handleLogin(session, name) {
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{1,23}$/.test(name)) {
    session.send({ kind: 'login-failed', text: s('login.invalid_name', DEFAULT_LANG) });
    return;
  }
  const record = await loadPlayer(name);
  if (!record) {
    session.send({ kind: 'login-failed', text: s('login.no_such', DEFAULT_LANG, { name }) });
    return;
  }
  if (findActor(record.name)) {
    session.send({ kind: 'login-failed', text: s('login.already_online', DEFAULT_LANG, { name: record.name }) });
    return;
  }
  const admin = isAdmin(record.name);
  const actor = makePlayerActor(record, session, admin);
  session.actor = actor;
  registerActor(actor);
  const startRoom = world.rooms.has(record.location) ? record.location : 'home.yard';
  placeActor(actor, startRoom);
  actor.dirty = true;

  session.send({ kind: 'login-ok', name: record.name, isAdmin: admin, lang: actor.lang });
  session.send({ kind: 'system', text: s('system.welcome', actor.lang, { name: record.name }) });
  sendStats(actor);
  describeRoom(actor);
  for (const a of world.actorsByRoom.get(actor.location)) {
    if (a !== actor && a.session) {
      a.session.send({ kind: 'narration', source: 'ambient', text: s('narration.appears', a.lang, { name: actor.name }) });
    }
  }
  describeRoomToAll(actor.location);
  applyAggressionOnEnter(actor, actor.location);
}

async function handleClose(session) {
  const actor = session.actor;
  if (!actor) return;
  const lastRoom = actor.location;
  for (const a of world.actorsByRoom.get(actor.location) ?? []) {
    if (a !== actor && a.session) {
      a.session.send({ kind: 'narration', source: 'ambient', text: s('narration.vanishes', a.lang, { name: actor.name }) });
    }
  }
  try {
    actor.record.location = actor.location;
    actor.record.lastSeen = new Date().toISOString();
    actor.record.inventory = serializeInventory(actor.inventory);
    await savePlayer(actor.record);
  } catch (err) {
    console.error(`failed to save ${actor.name} on disconnect:`, err);
  }
  removeActor(actor);
  session.actor = null;
  if (lastRoom) describeRoomToAll(lastRoom);
}

export function startWsServer(port) {
  const httpServer = http.createServer((req, res) => { serveStatic(req, res); });
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    const session = makeSession(ws);
    session.send({ kind: 'login-required', text: s('login.welcome_prompt', DEFAULT_LANG) });

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { session.send({ kind: 'error', text: s('error.bad_message', session.actor?.lang ?? DEFAULT_LANG) }); return; }

      if (msg.kind === 'login') {
        if (session.actor) return;
        await handleLogin(session, msg.name);
        return;
      }
      if (msg.kind === 'input') {
        if (!session.actor) {
          session.send({ kind: 'error', text: s('error.login_first', DEFAULT_LANG) });
          return;
        }
        await runCommand(session.actor, String(msg.text ?? ''));
        return;
      }
    });

    ws.on('close', () => { handleClose(session); });
    ws.on('error', (err) => { console.error('ws error:', err.message); });
  });

  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      console.log(`Realm listening on http://localhost:${port}`);
      resolve(httpServer);
    });
  });
}
