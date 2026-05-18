import path from 'node:path';
import { promises as fs } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readJson, writeJsonAtomic, listJsonFiles } from '../persist/jsonStore.js';
import { isAdmin } from '../game/world.js';

const execp = promisify(exec);
const NPC_DIR = path.resolve('content/npcs');
const REPO_ROOT = path.resolve('.');

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function sendErr(res, status, message) {
  send(res, status, { error: message });
}

async function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function requireAdmin(url) {
  const name = url.searchParams.get('admin');
  if (!name) return null;
  return isAdmin(name) ? name : null;
}

function npcPathFromId(id) {
  if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(id)) return null;
  const zone = id.split('.')[0];
  return path.join(NPC_DIR, zone, `${id}.json`);
}

async function listNpcs() {
  const files = await listJsonFiles(NPC_DIR);
  const items = [];
  for (const file of files) {
    try {
      const def = await readJson(file);
      items.push({
        id: def.id,
        zone: path.basename(path.dirname(file)),
        name: def.name?.en ?? def.id,
        title: def.title?.en ?? null,
        disposition: def.disposition ?? null,
      });
    } catch { /* skip malformed */ }
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return items;
}

async function runGit(args) {
  const { stdout, stderr } = await execp(args, { cwd: REPO_ROOT, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
}

async function gitStatusNpcs() {
  const { stdout } = await runGit('git status --porcelain content/npcs');
  const changed = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const file = line.slice(3).trim();
    changed.push(file);
  }
  return changed;
}

async function openPr({ title, body }) {
  const changed = await gitStatusNpcs();
  if (changed.length === 0) {
    throw new Error('no NPC changes to package');
  }
  const { stdout: branchOut } = await runGit('git rev-parse --abbrev-ref HEAD');
  const originalBranch = branchOut.trim();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '_').slice(0, 19);
  const newBranch = `npc-edits/${ts}`;

  const cleanup = async () => {
    try { await runGit(`git checkout ${originalBranch}`); } catch {}
  };

  try {
    await runGit(`git checkout -b ${newBranch}`);
    await runGit('git add content/npcs');
    const msg = title.replace(/"/g, '\\"');
    await runGit(`git commit -m "${msg}"`);
    await runGit(`git push -u origin ${newBranch}`);

    const bodyEscaped = (body || title).replace(/"/g, '\\"');
    const prCmd = `gh pr create --base ${originalBranch} --head ${newBranch} --title "${msg}" --body "${bodyEscaped}"`;
    const { stdout: prOut } = await runGit(prCmd);
    const url = (prOut.match(/https?:\/\/\S+/) || [])[0] || null;

    await runGit(`git checkout ${originalBranch}`);
    return { branch: newBranch, originalBranch, changedFiles: changed, url };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

export async function tryHandleAdminRoute(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  if (!p.startsWith('/admin/')) return false;

  if (p === '/admin/npc-editor') {
    const file = path.resolve('client/admin/npc-editor.html');
    try {
      const data = await fs.readFile(file);
      send(res, 200, data, 'text/html; charset=utf-8');
    } catch {
      send(res, 404, 'not found', 'text/plain');
    }
    return true;
  }

  if (!p.startsWith('/admin/api/')) return false;

  const admin = requireAdmin(url);
  if (!admin) { sendErr(res, 401, 'admin name required (?admin=Name) and must appear in data/admins.json'); return true; }

  try {
    if (p === '/admin/api/npcs' && req.method === 'GET') {
      send(res, 200, await listNpcs());
      return true;
    }

    const match = p.match(/^\/admin\/api\/npcs\/([a-z0-9_.]+)$/);
    if (match) {
      const id = match[1];
      const file = npcPathFromId(id);
      if (!file) { sendErr(res, 400, 'invalid npc id'); return true; }
      if (req.method === 'GET') {
        try {
          const def = await readJson(file);
          send(res, 200, def);
        } catch (err) {
          if (err.code === 'ENOENT') sendErr(res, 404, 'npc not found');
          else sendErr(res, 500, err.message);
        }
        return true;
      }
      if (req.method === 'POST') {
        const raw = await readBody(req);
        let def;
        try { def = JSON.parse(raw); }
        catch { sendErr(res, 400, 'invalid JSON'); return true; }
        if (def.id !== id) { sendErr(res, 400, `id mismatch: body has '${def.id}', expected '${id}'`); return true; }
        await writeJsonAtomic(file, def);
        send(res, 200, { ok: true, file: path.relative(REPO_ROOT, file).replace(/\\/g, '/') });
        return true;
      }
    }

    if (p === '/admin/api/git/status' && req.method === 'GET') {
      send(res, 200, { changed: await gitStatusNpcs() });
      return true;
    }

    if (p === '/admin/api/git/open-pr' && req.method === 'POST') {
      const raw = await readBody(req);
      let payload = {};
      if (raw) {
        try { payload = JSON.parse(raw); } catch { sendErr(res, 400, 'invalid JSON'); return true; }
      }
      const title = payload.title || 'npc edits';
      const body = payload.body || '';
      try {
        const result = await openPr({ title, body });
        send(res, 200, result);
      } catch (err) {
        sendErr(res, 500, err.stderr || err.message);
      }
      return true;
    }

    sendErr(res, 404, 'unknown admin route');
    return true;
  } catch (err) {
    sendErr(res, 500, err.message);
    return true;
  }
}
