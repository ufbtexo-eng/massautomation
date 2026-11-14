// Mass Auto Bot — License Key Server
// Node.js, zero dependencies (only built-in http / fs / crypto).
// Run:  node server.js        (or: PORT=3000 ADMIN_KEY=your-secret node server.js)
//
// What it replaces:
//   The extension used to call Supabase REST at /rest/v1/licenses.
//   This server speaks the SAME endpoints, so the extension works
//   with only ONE change: SUPABASE_URL in popup.js -> your server URL.
//   (See README.md for that change + the manifest host_permissions change.)
//
// Data: licenses.json next to this file
//   { key, status: "active" | "revoked", device_id: null | "dev_...",
//     created_at: ISO date }
//
// Admin web UI:  GET /admin   (login with ADMIN_KEY, see .env.example)
// Clean API:      POST /api/verify  { key, device_id }
//                 GET  /api/admin/licenses   (header: x-admin-key)
//                 POST /api/admin/generate   { prefix }
//                 POST /api/admin/toggle     { key }
//                 POST /api/admin/unbind     { key }
//                 DELETE /api/admin/licenses/:key
//
// SECURITY NOTE:
//   The /rest/v1/* endpoints are intentionally open, exactly like the
//   old Supabase anon-key setup — the extension's admin panel calls
//   them with no server token. Anyone who knows your server URL can
//   call them. Do NOT publish the URL publicly. If you want it locked
//   down, set REQUIRE_ADMIN_FOR_WRITE=1 (see below) — then key
//   generation / revoke / delete must go through /admin or /api/admin/*
//   with x-admin-key, and the extension's in-popup admin panel will
//   stop working for those actions (unlock/verify still works).

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const REQUIRE_ADMIN_FOR_WRITE = process.env.REQUIRE_ADMIN_FOR_WRITE === '1';
const DB_FILE = path.join(__dirname, 'licenses.json');

// If no ADMIN_KEY is set, generate a random one at startup and print it.
// The admin UI will not work without it — check the terminal output.
const adminKey = ADMIN_KEY || crypto.randomBytes(16).toString('hex');
if (!ADMIN_KEY) {
  console.log('\n[license-server] No ADMIN_KEY set — generated a temporary one:');
  console.log('[license-server] ADMIN_KEY=' + adminKey);
  console.log('[license-server] Set it in .env / environment to keep the same key.\n');
}

// ---------- storage ----------
function loadDb() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (_) { return []; }
}
function saveDb(list) {
  fs.writeFileSync(DB_FILE, JSON.stringify(list, null, 2) + '\n');
}
function findKey(list, key) {
  return list.find((r) => r.key === key);
}
function publicRow(r) {
  return { key: r.key, status: r.status, device_id: r.device_id || null, created_at: r.created_at };
}
function randomString(n) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < n; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}
function makeKey(prefix) {
  const p = (prefix || 'USER').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'USER';
  return `${p}-${randomString(4)}-${randomString(4)}-${randomString(4)}`;
}

// ---------- http helpers ----------
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'apikey, Authorization, Content-Type, Prefer, x-admin-key',
  });
  res.end(body);
}
function sendText(res, status, text, type = 'text/html; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(text);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (_) { resolve({}); }
    });
  });
}
function isAdmin(req) {
  const h = req.headers['x-admin-key'] || '';
  return h && h === adminKey;
}
function keyFromQuery(url) {
  // ?key=eq.MASS-XXXX-XXXX-XXXX  (Supabase style) or ?key=MASS-...
  const v = url.searchParams.get('key');
  if (!v) return null;
  return v.startsWith('eq.') ? v.slice(3) : v;
}

// ---------- admin UI (single page, served from /admin) ----------
const ADMIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mass Auto Bot — License Admin</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0b14;color:#eee;max-width:720px;margin:30px auto;padding:0 16px}
input,button{padding:10px 12px;border-radius:8px;border:1px solid #333;background:#17172a;color:#eee;font-size:14px}
button{background:#6b4cde;border:0;cursor:pointer}button:disabled{opacity:.5}
.row{display:flex;gap:8px;margin:12px 0}.card{background:#141424;border:1px solid #262640;border-radius:10px;padding:12px;margin:8px 0;font-family:monospace;font-size:13px}
small{color:#888}.green{color:#22c55e}.red{color:#ef4444}</style></head><body>
<h2>🔐 Mass Auto Bot — License Admin</h2>
<div id="login"><p>Enter your ADMIN_KEY to manage license keys.</p>
<div class="row"><input id="ak" type="password" placeholder="ADMIN_KEY" style="flex:1"><button onclick="login()">Login</button></div>
<p><small>ADMIN_KEY is set in the server environment (.env). It is NOT the extension master key.</small></p></div>
<div id="app" style="display:none">
<div class="row"><input id="prefix" placeholder="Prefix, e.g. USER" maxlength="4" style="width:130px"><button onclick="gen()">+ Generate Key</button>
<button onclick="load()" style="background:#323248">Refresh</button></div>
<p><span id="count"></span></p><div id="list"></div></div>
<script>
let AK='';
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{...(opts.headers||{}),'x-admin-key':AK,'Content-Type':'application/json'}});return r.json().catch(()=>({}));}
async function login(){AK=document.getElementById('ak').value.trim();const d=await api('/api/admin/licenses');if(d.error){alert(d.error);return;}
document.getElementById('login').style.display='none';document.getElementById('app').style.display='block';load();}
async function load(){const d=await api('/api/admin/licenses');const list=document.getElementById('list');
document.getElementById('count').textContent=(d.licenses||[]).length+' keys';
list.innerHTML=(d.licenses||[]).map(k=>'<div class="card"><b class="'+(k.status==='active'?'green':'red')+'">'+k.key+'</b> — '+k.status+'<br><small>'+(k.device_id?'🔒 Locked: '+k.device_id:'🔓 Unused')+' · '+k.created_at+'</small><br><br><button onclick="toggleKey(\\''+k.key+'\\')">'+(k.status==='active'?'Revoke':'Unlock')+'</button> <button onclick="unbind(\\''+k.key+'\\')" style="background:#323248">Unbind device</button> <button onclick="del(\\''+k.key+'\\')" style="background:#7f1d1d">Delete</button></div>').join('')||'<p>No keys yet.</p>';}
async function gen(){const d=await api('/api/admin/generate',{method:'POST',body:JSON.stringify({prefix:document.getElementById('prefix').value})});if(d.key){alert('New key: '+d.key);}load();}
async function toggleKey(k){await api('/api/admin/toggle',{method:'POST',body:JSON.stringify({key:k})});load();}
async function unbind(k){await api('/api/admin/unbind',{method:'POST',body:JSON.stringify({key:k})});load();}
async function del(k){if(!confirm('Delete '+k+'?'))return;await fetch('/api/admin/licenses/'+encodeURIComponent(k),{method:'DELETE',headers:{'x-admin-key':AK}});load();}
</script></body></html>`;

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }

  // Health + root
  if (pathname === '/' && req.method === 'GET') {
    return send(res, 200, { ok: true, service: 'mass-auto-bot-license-server', endpoints: ['/rest/v1/licenses', '/api/verify', '/admin'] });
  }
  if (pathname === '/health' && req.method === 'GET') return send(res, 200, { ok: true });

  // Admin UI
  if (pathname === '/admin' && req.method === 'GET') return sendText(res, 200, ADMIN_HTML);

  // ---- Clean API: verify (used by anything, not by the current extension) ----
  if (pathname === '/api/verify' && req.method === 'POST') {
    const body = await readBody(req);
    const key = (body.key || '').trim();
    const deviceId = (body.device_id || '').trim();
    const list = loadDb();
    const row = findKey(list, key);
    if (!row) return send(res, 200, { valid: false, reason: 'invalid' });
    if (row.status === 'revoked') return send(res, 200, { valid: false, reason: 'revoked' });
    if (row.device_id && deviceId && row.device_id !== deviceId) {
      return send(res, 200, { valid: false, reason: 'locked_to_another_device' });
    }
    if (!row.device_id && deviceId) { row.device_id = deviceId; saveDb(list); }
    return send(res, 200, { valid: true, status: row.status, device_id: row.device_id || null });
  }

  // ---- Clean API: admin (x-admin-key required) ----
  if (pathname.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized — send x-admin-key header' });
    const list = loadDb();
    if (pathname === '/api/admin/licenses' && req.method === 'GET') {
      const sorted = [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return send(res, 200, { licenses: sorted.map(publicRow) });
    }
    if (pathname === '/api/admin/generate' && req.method === 'POST') {
      const body = await readBody(req);
      let key = makeKey(body.prefix);
      while (findKey(list, key)) key = makeKey(body.prefix);
      const row = { key, status: 'active', device_id: null, created_at: new Date().toISOString() };
      list.push(row); saveDb(list);
      return send(res, 200, { key, status: 'active' });
    }
    if (pathname === '/api/admin/toggle' && req.method === 'POST') {
      const body = await readBody(req);
      const row = findKey(list, (body.key || '').trim());
      if (!row) return send(res, 404, { error: 'not found' });
      row.status = row.status === 'active' ? 'revoked' : 'active';
      saveDb(list);
      return send(res, 200, publicRow(row));
    }
    if (pathname === '/api/admin/unbind' && req.method === 'POST') {
      const body = await readBody(req);
      const row = findKey(list, (body.key || '').trim());
      if (!row) return send(res, 404, { error: 'not found' });
      row.device_id = null; saveDb(list);
      return send(res, 200, publicRow(row));
    }
    if (pathname.startsWith('/api/admin/licenses/') && req.method === 'DELETE') {
      const key = decodeURIComponent(pathname.slice('/api/admin/licenses/'.length));
      const next = list.filter((r) => r.key !== key);
      if (next.length === list.length) return send(res, 404, { error: 'not found' });
      saveDb(next);
      return send(res, 200, { deleted: true });
    }
    return send(res, 404, { error: 'not found' });
  }

  // ---- Supabase-compatible: /rest/v1/licenses ----
  // This is what the current popup.js calls. Headers apikey / Authorization are ignored.
  if (pathname === '/rest/v1/licenses') {
    const list = loadDb();
    const qkey = keyFromQuery(url);

    if (req.method === 'GET') {
      let rows = list;
      if (qkey) rows = rows.filter((r) => r.key === qkey);
      // ?order=created_at.desc
      if (url.searchParams.get('order') === 'created_at.desc') {
        rows = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }
      return send(res, 200, rows.map(publicRow));
    }

    if (req.method === 'POST') {
      if (REQUIRE_ADMIN_FOR_WRITE && !isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
      const body = await readBody(req);
      const key = (body.key || '').trim();
      if (!key) return send(res, 400, { error: 'key is required' });
      if (findKey(list, key)) return send(res, 409, { error: 'key already exists' });
      const row = { key, status: body.status === 'revoked' ? 'revoked' : 'active', device_id: body.device_id || null, created_at: new Date().toISOString() };
      list.push(row); saveDb(list);
      return send(res, 201, publicRow(row));
    }

    if (req.method === 'PATCH') {
      if (!qkey) return send(res, 400, { error: 'key query param is required' });
      const row = findKey(list, qkey);
      if (!row) return send(res, 404, { error: 'not found' });
      const body = await readBody(req);
      if (typeof body.status === 'string') row.status = body.status === 'revoked' ? 'revoked' : 'active';
      if (typeof body.device_id === 'string') row.device_id = body.device_id || null;
      if (body.device_id === null) row.device_id = null;
      saveDb(list);
      // Supabase with Prefer: return=minimal returns an empty body — return the row anyway, the extension ignores it.
      return send(res, 200, publicRow(row));
    }

    if (req.method === 'DELETE') {
      if (REQUIRE_ADMIN_FOR_WRITE && !isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
      if (!qkey) return send(res, 400, { error: 'key query param is required' });
      const next = list.filter((r) => r.key !== qkey);
      if (next.length === list.length) return send(res, 404, { error: 'not found' });
      saveDb(next);
      return send(res, 200, { deleted: true });
    }
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[license-server] listening on http://localhost:${PORT}`);
  console.log(`[license-server] admin UI: http://localhost:${PORT}/admin`);
  console.log(`[license-server] verify: POST http://localhost:${PORT}/api/verify`);
});
