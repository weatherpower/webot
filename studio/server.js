// WeBot Studio: a control room for WeatherPower Live that runs on your own PC.
// It edits WeBot's brain, the stream server's settings and the code, shows logs and health, and deploys
// to the cloud server over SSH (the same key and port you already use). Start it with "WeBot Studio.cmd".
//
// It only listens on this computer (127.0.0.1) and refuses requests from other websites.
import express from 'express';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import crypto from 'node:crypto';
import { replyTo, kindOf } from '../src/personality.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const CONFIG_FILE = path.join(here, 'studio.config.json');
const DEFAULTS = { port: 7777, host: '207.244.248.128', sshPort: 22022, sshUser: 'root', remoteDir: '/opt/weatherpower', controlPort: 8899, statusPort: 80 };
const config = { ...DEFAULTS, ...(existsSync(CONFIG_FILE) ? JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')) : {}), ...(process.env.STUDIO_PORT ? { port: Number(process.env.STUDIO_PORT) } : {}) };
// For testing against a local server: STUDIO_CONTROL_BASE=http://localhost:8898 STUDIO_TOKEN=...
const CONTROL_BASE = process.env.STUDIO_CONTROL_BASE || `http://${config.host}:${config.controlPort}`;
const STATUS_BASE = process.env.STUDIO_STATUS_BASE || `http://${config.host}${config.statusPort === 80 ? '' : ':' + config.statusPort}`;
// Web mode (STUDIO_WEB=1): Studio runs on the cloud server itself (deploy/studio-web), behind HTTPS with a sign-in.
// Server commands run right there instead of over SSH; code editing and deploys stay in the desktop app.
const WEB = process.env.STUDIO_WEB === '1';
const PUBLIC_STATUS = `http://${config.host}${config.statusPort === 80 ? '' : ':' + config.statusPort}`;

/* ---------------- shell helpers ---------------- */
const run = (cmd, args, { input, timeout = 60000, cwd = projectRoot } = {}) => new Promise((resolve) => {
  // ELECTRON_RUN_AS_NODE: inside the desktop program, process.execPath is the program itself; this makes it act as Node.
  const child = spawn(cmd, args, { cwd, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  let out = '', err = '';
  const timer = setTimeout(() => { child.kill(); err += '\n(timed out)'; }, timeout);
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', (e) => { err += e.message; });
  child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  if (input != null) child.stdin.end(input); else child.stdin.end();
});
const sshArgs = () => ['-p', String(config.sshPort), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', `${config.sshUser}@${config.host}`];
const ssh = (command, opts = {}) => (WEB ? run('bash', ['-c', command], opts) : run('ssh', [...sshArgs(), command], opts));
const scp = (local, remote) => run('scp', ['-P', String(config.sshPort), '-o', 'BatchMode=yes', '-q', local, `${config.sshUser}@${config.host}:${remote}`], { timeout: 120000 });
const git = (args, opts) => run('git', args, opts);
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;   // single-quote for the remote shell
const R = (p = '') => config.remoteDir + (p ? '/' + p : '');

/* ---------------- the controller token (read from the server, kept in memory) ---------------- */
let token = process.env.STUDIO_TOKEN || '';
const getToken = async () => {
  if (token) return token;
  const r = await ssh(`grep -E '^CONTROLLER_TOKEN=' ${R('.env')} | head -1 | cut -d= -f2-`);
  token = r.out.trim();
  if (!token) throw new Error('Could not read the controller token from the server (' + (r.err.trim() || 'empty') + ')');
  return token;
};
const control = async (body) => {
  const r = await fetch(`${CONTROL_BASE}/warningcenter/api/v3/live/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Controller-Token': await getToken() },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(json.error || 'Live Control said ' + r.status), { status: r.status });
  return json.control || json;
};
const getJson = async (url, ms = 10000) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  return r.json();
};

/* ---------------- server health (one SSH round trip, cached) ---------------- */
const HEALTH_SCRIPT = `cd ${R()} 2>/dev/null || exit 1
echo "@@stats"; docker stats --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}' 2>/dev/null | head -1
echo "@@ps"; docker compose ps --format '{{.Status}}' 2>/dev/null | head -1
echo "@@host"; cat /proc/loadavg; nproc; free -m | awk '/Mem:/ {print $2" "$3}'; df -m / | awk 'NR==2 {print $2" "$3}'; cut -d. -f1 /proc/uptime
echo "@@procs"; pgrep -c ffmpeg; pgrep -fc 'chrome --kiosk'
echo "@@env"; grep -E '^(STREAM_WIDTH|STREAM_HEIGHT|STREAM_FPS|STREAM_BITRATE|STREAM_PRESET|STREAM_CPUS)=' .env
echo "@@log"; docker compose logs --no-color --since 30m 2>&1 | grep -E 'streaming [0-9]+x|stopped|restarting|\\[chat\\]|Error|error' | tail -8
echo "@@deployed"; cat .deployed-commit 2>/dev/null`;
let healthCache = { at: 0, body: null };
const health = async () => {
  if (healthCache.body && Date.now() - healthCache.at < 8000) return healthCache.body;
  const r = await ssh(HEALTH_SCRIPT, { timeout: 25000 });
  if (r.code === 255 || (!r.out && r.err)) throw new Error('Can’t reach the server over SSH: ' + (r.err.trim().split('\n').pop() || 'no answer'));
  const part = {};
  let key = null;
  for (const line of r.out.split('\n')) {
    const m = line.match(/^@@(\w+)/);
    if (m) { key = m[1]; part[key] = []; } else if (key && line.trim()) part[key].push(line.trim());
  }
  const [cpu, mem, net] = (part.stats?.[0] || '').split('|');
  const [load1, load5, load15] = (part.host?.[0] || '').split(' ');
  const [memTotal, memUsed] = (part.host?.[2] || '').split(' ').map(Number);
  const [diskTotal, diskUsed] = (part.host?.[3] || '').split(' ').map(Number);
  const env = Object.fromEntries((part.env || []).map((l) => l.split('=')));
  const body = {
    at: new Date().toISOString(),
    container: { status: part.ps?.[0] || 'not running', cpu: parseFloat(cpu) || 0, cpuLimit: Number(env.STREAM_CPUS || 3) * 100, mem: mem || '', net: net || '' },
    host: { load: [load1, load5, load15].map(Number), cores: Number(part.host?.[1]) || 0, memTotal, memUsed, diskTotal, diskUsed, uptimeSec: Number(part.host?.[4]) || 0 },
    procs: { ffmpeg: Number(part.procs?.[0]) || 0, chrome: Number(part.procs?.[1]) || 0 },
    stream: { width: Number(env.STREAM_WIDTH) || 1920, height: Number(env.STREAM_HEIGHT) || 1080, fps: Number(env.STREAM_FPS) || 30, bitrate: env.STREAM_BITRATE || '6000k', preset: env.STREAM_PRESET || 'veryfast' },
    log: part.log || [],
    deployed: (part.deployed?.[0] || '').trim()
  };
  healthCache = { at: Date.now(), body };
  return body;
};

/* ---------------- .env ---------------- */
const SECRET = /(KEY|TOKEN|SECRET|PASSWORD|PASS|WEBHOOK)/i;
const parseEnv = (text) => text.split(/\r?\n/).map((line) => {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  return m ? { key: m[1], value: m[2] } : { raw: line };
});
const readEnv = async () => {
  const r = await ssh(`cat ${R('.env')}`);
  if (r.code !== 0) throw new Error('Could not read .env: ' + r.err.trim());
  return parseEnv(r.out);
};

/* ---------------- project files (code editor) ---------------- */
const EDITABLE = /\.(js|mjs|cjs|html|css|json|md|sh|yml|yaml|txt|service)$|(^|\/)(Dockerfile|\.env\.example|\.dockerignore|\.gitignore)$/;
const SKIP = /^(node_modules|src\/places|data|cards|studio\/\.backups)\//;
const DEPLOYABLE = /^(src\/|public\/|deploy\/|scripts\/|Dockerfile$|docker-compose\.yml$|package\.json$|package-lock\.json$|app\.js$|custom-products\/)/;
const safePath = (p) => {
  const rel = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(projectRoot, rel);
  if (!abs.startsWith(projectRoot + path.sep) || SKIP.test(rel) || /(^|\/)\.env$/.test(rel) || rel.includes('..')) throw Object.assign(new Error('Not an editable file'), { status: 400 });
  return { rel, abs };
};
const changedFiles = async () => {
  const r = await git(['status', '--porcelain', '--untracked-files=all']);
  return Object.fromEntries(r.out.split('\n').filter(Boolean).map((l) => [l.slice(3).replace(/^"|"$/g, ''), l.slice(0, 2).trim() || 'M']));
};
const checkSyntax = async (rel, abs) => {
  if (/\.(js|mjs|cjs)$/.test(rel)) {
    const r = await run(process.execPath, ['--check', abs], { timeout: 20000 });
    return r.code === 0 ? null : r.err.split('\n').slice(0, 6).join('\n');
  }
  if (/\.html$/.test(rel)) {
    const html = await fs.readFile(abs, 'utf8');
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n;\n');
    if (!scripts.trim()) return null;
    const tmp = path.join(here, '.backups', '_check.mjs');
    await fs.mkdir(path.dirname(tmp), { recursive: true });
    await fs.writeFile(tmp, scripts);
    const r = await run(process.execPath, ['--check', tmp], { timeout: 20000 });
    return r.code === 0 ? null : 'Script problem: ' + r.err.split('\n').slice(1, 6).join('\n');
  }
  if (/\.json$/.test(rel)) { try { JSON.parse(await fs.readFile(abs, 'utf8')); return null; } catch (e) { return 'JSON problem: ' + e.message; } }
  return null;
};

/* ---------------- app ---------------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
// Only this computer, and only this page: no other website can drive the studio.
const COOKIE = 'wpstudio';
const signFor = async (exp) => crypto.createHmac('sha256', 'studio-web|' + await getToken()).update(String(exp)).digest('hex');
const signedIn = async (req) => {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)wpstudio=(\d+)\.([0-9a-f]{64})/);
  if (!m || Number(m[1]) < Date.now()) return false;
  const want = Buffer.from(await signFor(m[1])), got = Buffer.from(m[2]);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};
const tries = new Map();   // sign-in attempts per address: at most 8 every 15 minutes
if (WEB) app.use(async (req, res, next) => {
  // Same-site only: other websites can't drive Studio with your sign-in.
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && origin !== 'https://' + req.headers.host) return res.status(403).json({ error: 'Blocked: request from another site' });
  if (req.path === '/api/login' && req.method === 'POST') {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',').pop().trim();
    const t = (tries.get(ip) || []).filter((at) => Date.now() - at < 15 * 60000);
    if (t.length >= 8) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
    t.push(Date.now()); tries.set(ip, t);
    const pass = String(req.body?.password || '').trim();
    const goods = [await getToken().catch(() => ''), process.env.STUDIO_PASSWORD || ''].filter(Boolean).map((g) => crypto.createHash('sha256').update(g).digest());
    const mine = crypto.createHash('sha256').update(pass).digest();
    if (!pass || !goods.some((g) => crypto.timingSafeEqual(g, mine))) return res.status(401).json({ error: 'Wrong password' });
    tries.delete(ip);
    const exp = Date.now() + 30 * 86400000;
    res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${await signFor(exp)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; Secure; SameSite=Strict`);
    return res.json({ ok: true });
  }
  if (req.path === '/api/logout') { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`); return res.json({ ok: true }); }
  if (!/^\/(api|warningcenter)(\/|$)/.test(req.path)) return next();   // the page itself (no secrets in it)
  if (!(await signedIn(req).catch(() => false))) return res.status(401).json({ error: 'Sign in', signIn: true });
  if (/^\/api\/(files?|git|deploy|firewall)(\/|$)/.test(req.path)) return res.status(400).json({ error: 'Code, deploys and the firewall are in the desktop app.' });
  if (req.path.startsWith('/warningcenter')) {
    // Live Control (and the stream page) through Studio, so they work over HTTPS from anywhere once signed in.
    const up = new URL(CONTROL_BASE);
    const headers = { ...req.headers, host: up.host };
    delete headers.cookie;
    const p = http.request({ hostname: up.hostname, port: up.port || 80, path: req.originalUrl, method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', (e) => { if (!res.headersSent) res.status(502).json({ error: 'Live Control not answering: ' + e.message }); else res.end(); });
    if (req.body && Object.keys(req.body).length) { const b = JSON.stringify(req.body); p.setHeader('content-length', Buffer.byteLength(b)); p.end(b); } else req.pipe(p);
    return;
  }
  next();
});
app.use((req, res, next) => {
  if (WEB) return next();
  const host = String(req.headers.host || '');
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return res.status(403).send('Local only');
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return res.status(403).json({ error: 'Blocked: request from another site' });
  next();
});
app.use(express.static(path.join(here, 'public'), { index: 'index.html' }));
app.use('/assets', express.static(path.join(projectRoot, 'public', 'assets')));
const api = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (e) { res.status(e.status && e.status < 600 ? e.status : 500).json({ error: e.message }); }
};

app.get('/api/config', api(async () => (WEB ? { host: config.host, web: true, controlBase: '', statusBase: PUBLIC_STATUS } : { ...config, controlBase: CONTROL_BASE, statusBase: STATUS_BASE, projectRoot })));
// The Controls page (Live Control inside Studio) opens already signed in with the controller token.
app.get('/api/control-url', api(async () => ({ url: `${WEB ? '' : CONTROL_BASE}/warningcenter/live/control#token=${encodeURIComponent(await getToken())}` })));

app.get('/api/overview', api(async () => {
  const [status, server, ctl] = await Promise.allSettled([
    getJson(`${STATUS_BASE}/warningcenter/api/v3/webot/status`),
    health(),
    control({ action: 'ping' })
  ]);
  const val = (p) => (p.status === 'fulfilled' ? p.value : { error: p.reason?.message || 'failed' });
  const c = val(ctl);
  return {
    status: val(status),
    server: val(server),
    control: c.error ? c : { mode: c.mode, talk: c.talk, theme: c.theme, voice: c.voice, sound: c.sound, brb: c.brb, pin: c.pin, music: c.music, headlines: c.headlines, gas: c.gas, chatRead: c.chatRead, tts: c.tts, state: c.state, stream: c.stream }
  };
}));

app.post('/api/control', api(async (req) => control(req.body || {})));

app.get('/api/brain', api(async () => getJson(`${CONTROL_BASE}/warningcenter/api/v3/live/brain`)));
// Try WeBot's personality on a made-up chat message, with the brain as it is in the editor (not saved).
app.post('/api/brain/try', api(async (req) => {
  const text = String(req.body?.text || '').slice(0, 160), user = String(req.body?.user || '').slice(0, 24);
  return { kind: kindOf(text), reply: replyTo(text, user, req.body?.brain) };
}));
app.put('/api/brain', api(async (req) => {
  await control({ action: 'brain', brain: req.body || {} });
  return getJson(`${CONTROL_BASE}/warningcenter/api/v3/live/brain`);
}));

app.get('/api/env', api(async () => (await readEnv()).filter((l) => l.key).map((l) => ({ key: l.key, value: SECRET.test(l.key) ? '' : l.value, secret: SECRET.test(l.key), set: l.value !== '' }))));
app.get('/api/env/reveal', api(async (req) => {
  const line = (await readEnv()).find((l) => l.key === req.query.key);
  if (!line) throw Object.assign(new Error('No such setting'), { status: 404 });
  return { key: line.key, value: line.value };
}));
app.put('/api/env', api(async (req) => {
  const { set = {}, remove = [] } = req.body || {};
  const lines = await readEnv();
  for (const [k, v] of Object.entries(set)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || /[\r\n]/.test(String(v))) throw Object.assign(new Error('Bad setting ' + k), { status: 400 });
    const hit = lines.find((l) => l.key === k);
    if (hit) hit.value = String(v); else lines.push({ key: k, value: String(v) });
  }
  const text = lines.filter((l) => !(l.key && remove.includes(l.key))).map((l) => (l.key ? `${l.key}=${l.value}` : l.raw)).join('\n').replace(/\n*$/, '\n');
  const r = await ssh(`cd ${R()} && cp .env .env.bak-$(date +%Y%m%d-%H%M%S) && cat > .env.new && mv .env.new .env && ls .env.bak-* | sort | head -n -10 | xargs -r rm -f && echo saved`, { input: text });
  if (!/saved/.test(r.out)) throw new Error('Could not save .env: ' + r.err.trim());
  if (set.CONTROLLER_TOKEN) token = '';
  healthCache.at = 0;
  return { ok: true, restartNeeded: true };
}));

app.post('/api/server/restart', api(async () => {
  const r = await ssh(`cd ${R()} && docker compose up -d --force-recreate 2>&1 | tail -3`, { timeout: 180000 });
  healthCache.at = 0;
  return { ok: r.code === 0, out: (r.out + r.err).trim() };
}));
app.post('/api/server/rebuild', api(async () => {
  const r = await ssh(`cd ${R()} && docker compose build -q 2>&1 | tail -3 && docker compose up -d 2>&1 | tail -2`, { timeout: 600000 });
  healthCache.at = 0;
  return { ok: r.code === 0, out: (r.out + r.err).trim() };
}));

app.get('/api/logs', api(async (req) => {
  const n = Math.min(2000, Math.max(20, Number(req.query.n) || 300));
  const r = await ssh(`cd ${R()} && docker compose logs --no-color --timestamps --tail ${n} 2>&1`, { timeout: 30000 });
  return { lines: r.out.split('\n').filter(Boolean).map((l) => l.replace(/^stream-1\s+\|\s?/, '')) };
}));

app.get('/api/firewall', api(async () => {
  const [list, mine] = await Promise.all([
    ssh(`cat ${R('allowed-ips.txt')}`),
    fetch('https://api.ipify.org', { signal: AbortSignal.timeout(8000) }).then((r) => r.text()).catch(() => '')
  ]);
  return { ips: list.out.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')), myIp: mine.trim() };
}));
app.put('/api/firewall', api(async (req) => {
  const ips = [...new Set((req.body?.ips || []).map((s) => String(s).trim()).filter(Boolean))];
  if (!ips.length) throw Object.assign(new Error('Keep at least one address, or Live Control locks everyone out'), { status: 400 });
  if (ips.some((ip) => !/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(ip))) throw Object.assign(new Error('Use IPv4 addresses like 192.24.21.67'), { status: 400 });
  const text = '# Live Control (port 8899) is open only to these addresses. Edited in WeBot Studio.\n' + ips.join('\n') + '\n';
  const r = await ssh(`cat > ${R('allowed-ips.txt')} && systemctl restart wp-firewall && echo ok`, { input: text });
  if (!/ok/.test(r.out)) throw new Error('Firewall update failed: ' + r.err.trim());
  return { ok: true, ips };
}));

// A picture of what the stream is showing right now (from the stream's own Chrome).
app.get('/api/snapshot', async (req, res) => {
  const r = await ssh(`cd ${R()} && docker compose exec -T stream node /app/deploy/cloud-stream/snapshot.cjs`, { timeout: 45000 });
  const b64 = r.out.trim();
  if (!b64 || r.code !== 0) {
    const missing = /Cannot find module|MODULE_NOT_FOUND|snapshot\.cjs/.test(r.err || '');
    const why = (r.err || '').split('\n').map((l) => l.trim()).find((l) => /error|not found|no such|cannot|failed/i.test(l) && !/^at /.test(l));
    return res.status(502).json({ error: missing ? 'Snapshot isn’t on the server yet: deploy once (Code → Deploy) to add it.' : why || 'No picture from the stream page' });
  }
  res.type('image/jpeg').send(Buffer.from(b64, 'base64'));
});

// 15 seconds of the stream's sound: gaps (sputtering) and loudness.
app.post('/api/check/audio', api(async () => {
  const cmd = `cd ${R()} && docker compose exec -T -u node stream sh -c 'export XDG_RUNTIME_DIR=/tmp/runtime-$(id -u); ffmpeg -hide_banner -loglevel error -f pulse -i stream.monitor -t 15 -y /tmp/check.wav && ffmpeg -hide_banner -nostats -i /tmp/check.wav -af silencedetect=noise=-60dB:d=0.004,ebur128 -f null - 2>&1 | grep -E "silence_end|I:" ; rm -f /tmp/check.wav'`;
  const r = await ssh(cmd, { timeout: 60000 });
  const gaps = (r.out.match(/silence_end/g) || []).length;
  const lufs = Number((r.out.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
  return { gaps, loudness: Number.isFinite(lufs) ? lufs : null, raw: r.err.trim().slice(0, 300) };
}));

/* ---------- code ---------- */
app.get('/api/files', api(async () => {
  const [ls, changed, head] = await Promise.all([git(['ls-files']), changedFiles(), git(['rev-parse', '--short', 'HEAD'])]);
  const files = new Set(ls.out.split('\n').filter(Boolean));
  Object.keys(changed).forEach((f) => files.add(f));
  return {
    head: head.out.trim(),
    files: [...files].filter((f) => EDITABLE.test(f) && !SKIP.test(f) && !/(^|\/)\.env$/.test(f)).sort().map((f) => ({ path: f, status: changed[f] || '', deployable: DEPLOYABLE.test(f) }))
  };
}));
app.get('/api/file', api(async (req) => {
  const { rel, abs } = safePath(req.query.path);
  const stat = await fs.stat(abs);
  if (stat.size > 3 * 1024 * 1024) throw Object.assign(new Error('Too big to edit here'), { status: 400 });
  return { path: rel, content: await fs.readFile(abs, 'utf8') };
}));
app.put('/api/file', api(async (req) => {
  const { rel, abs } = safePath(req.body?.path);
  const content = String(req.body?.content ?? '');
  if (existsSync(abs)) {
    const backup = path.join(here, '.backups', new Date().toISOString().replace(/[:.]/g, '-') + '__' + rel.replace(/\//g, '__'));
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.copyFile(abs, backup);
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
  return { ok: true, problem: await checkSyntax(rel, abs) };
}));
app.post('/api/file/revert', api(async (req) => {
  const { rel } = safePath(req.body?.path);
  const r = await git(['checkout', '--', rel]);
  if (r.code !== 0) throw new Error(r.err.trim() || 'Could not undo');
  return { ok: true };
}));
app.post('/api/git/commit', api(async (req) => {
  const message = String(req.body?.message || '').trim() || 'Edits from WeBot Studio';
  await git(['add', '-A', '--', '.', ':!data', ':!cards', ':!studio/.backups']);
  const r = await git(['commit', '-m', message]);
  return { ok: r.code === 0, out: (r.out + r.err).trim().split('\n').slice(0, 4).join('\n') };
}));
app.get('/api/git/log', api(async () => {
  const r = await git(['log', '--pretty=format:%h|%ad|%s', '--date=format:%b %d %H:%M', '-25']);
  return r.out.split('\n').filter(Boolean).map((l) => { const [hash, date, ...msg] = l.split('|'); return { hash, date, message: msg.join('|') }; });
}));

const studioUpdateState = async () => {
  if (WEB) throw Object.assign(new Error('Update Studio from the desktop app, not web mode.'), { status: 400 });
  const branch = (await git(['branch', '--show-current'])).out.trim();
  const head = (await git(['rev-parse', '--short', 'HEAD'])).out.trim();
  const tracked = (await git(['status', '--porcelain', '--untracked-files=no'])).out.trim();
  return { branch, head, dirty: Boolean(tracked) };
};

app.get('/api/studio/update/check', api(async () => {
  const state = await studioUpdateState();
  if (state.branch !== 'master') return { ...state, available: null, reason: 'Switch to the master branch before updating Studio.' };
  const fetch = await git(['fetch', 'origin', 'master', '--quiet'], { timeout: 120000 });
  if (fetch.code !== 0) throw new Error(fetch.err.trim() || 'Could not check GitHub for Studio updates');
  const remote = (await git(['rev-parse', '--short', 'origin/master'])).out.trim();
  const counts = (await git(['rev-list', '--left-right', '--count', 'HEAD...origin/master'])).out.trim().split(/\s+/).map(Number);
  return { ...state, remote, ahead: counts[0] || 0, available: counts[1] || 0 };
}));

app.post('/api/studio/update', api(async () => {
  const state = await studioUpdateState();
  if (state.branch !== 'master') throw Object.assign(new Error('Studio updater only runs from the master branch.'), { status: 400 });
  if (state.dirty) throw Object.assign(new Error('You have local code changes. Save a version or undo them before updating Studio.'), { status: 409 });

  const fetch = await git(['fetch', 'origin', 'master', '--quiet'], { timeout: 120000 });
  if (fetch.code !== 0) throw new Error(fetch.err.trim() || 'Could not download the latest Studio files');

  const ancestor = await git(['merge-base', '--is-ancestor', 'HEAD', 'origin/master']);
  if (ancestor.code !== 0) throw Object.assign(new Error('Your local master has commits that do not fast-forward to origin/master. Save/back up your work before updating.'), { status: 409 });

  const before = (await git(['rev-parse', '--short', 'HEAD'])).out.trim();
  const merge = await git(['merge', '--ff-only', 'origin/master'], { timeout: 120000 });
  if (merge.code !== 0) throw new Error(merge.err.trim() || merge.out.trim() || 'Studio update failed');
  const after = (await git(['rev-parse', '--short', 'HEAD'])).out.trim();

  return {
    ok: true,
    updated: before !== after,
    before,
    after,
    restartRequired: before !== after,
    message: before === after ? 'Studio is already up to date.' : 'Studio files updated. Close and reopen WeBot Studio to load the new server code.'
  };
}));

/* ---------- deploy ---------- */
const deployPlan = async () => {
  const [{ deployed }, head, changed] = await Promise.all([health(), git(['rev-parse', 'HEAD']), changedFiles()]);
  let files = Object.keys(changed);
  let baselineUnknown = false;

  if (deployed) {
    // Normally deploy only files changed since the server's recorded commit.
    // If that commit came from an older/local history and no longer exists here,
    // prepare one archive of the current tracked stream code instead of SCPing hundreds
    // of files one at a time (which looks like Studio is frozen).
    const known = await git(['cat-file', '-e', deployed + '^{commit}']);
    if (known.code === 0) {
      const diff = await git(['diff', '--name-only', deployed, 'HEAD']);
      if (diff.code === 0) files = [...new Set([...files, ...diff.out.split('\n').filter(Boolean)])];
    } else {
      baselineUnknown = true;
      const tracked = await git(['ls-files']);
      if (tracked.code === 0) files = [...new Set([...files, ...tracked.out.split('\n').filter(Boolean)])];
    }
  }

  files = files.filter((f) => DEPLOYABLE.test(f) && existsSync(path.join(projectRoot, f)));
  const dirty = Object.keys(changed).length > 0;
  const hot = !baselineUnknown && files.length > 0 && files.every((f) => /^public\//.test(f));
  return {
    deployed,
    head: head.out.trim(),
    files,
    mode: baselineUnknown && !dirty ? 'bundle' : hot ? 'hot' : 'rebuild',
    dirty,
    knownBaseline: Boolean(deployed) && !baselineUnknown,
    baselineUnknown
  };
};
app.get('/api/deploy/plan', api(deployPlan));
app.post('/api/deploy', async (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  const say = (line) => res.write(line + '\n');
  try {
    const plan = await deployPlan();
    if (!plan.files.length) { say('Nothing to deploy: the server already has everything.'); return res.end(); }
    for (const f of plan.files) {
      const problem = await checkSyntax(f, path.join(projectRoot, f));
      if (problem) { say(`STOP: ${f} has a problem, nothing was deployed.\n${problem}`); return res.end(); }
    }
    if (plan.mode === 'bundle') {
      say('Older server baseline detected: packaging the current tracked stream code into one repair bundle…');
      const roots = ['src', 'public', 'deploy', 'scripts', 'custom-products', 'Dockerfile', 'docker-compose.yml', 'package.json', 'package-lock.json', 'app.js']
        .filter((p) => existsSync(path.join(projectRoot, p)));
      const archive = path.join(here, '.backups', '_server-repair-' + Date.now() + '.tar');
      await fs.mkdir(path.dirname(archive), { recursive: true });

      const packed = await git(['archive', '--format=tar', '-o', archive, 'HEAD', '--', ...roots], { timeout: 180000 });
      if (packed.code !== 0) {
        say('Bundle build FAILED: ' + (packed.err.trim() || packed.out.trim()));
        await fs.rm(archive, { force: true }).catch(() => {});
        return res.end();
      }

      say('Uploading repair bundle to the stream server…');
      const remoteArchive = R('.studio-repair.tar');
      const sent = await scp(archive, remoteArchive);
      await fs.rm(archive, { force: true }).catch(() => {});
      if (sent.code !== 0) {
        say('Bundle upload FAILED: ' + sent.err.trim());
        return res.end();
      }

      say('Unpacking repair bundle…');
      const unpacked = await ssh(`cd ${R()} && tar -xf .studio-repair.tar && rm -f .studio-repair.tar`, { timeout: 180000 });
      if (unpacked.code !== 0) {
        say('Bundle unpack FAILED: ' + (unpacked.err.trim() || unpacked.out.trim()));
        return res.end();
      }

      say('Rebuilding and restarting the stream (about 1–2 minutes, the stream blips once)…');
      const rebuilt = await ssh(`cd ${R()} && docker compose build -q 2>&1 | tail -3 && docker compose up -d 2>&1 | tail -2`, { timeout: 600000 });
      say((rebuilt.out + rebuilt.err).trim() || 'done');
      if (rebuilt.code !== 0) {
        say('Deploy FAILED. The old version may still be running. Check Logs.');
        return res.end();
      }

      await ssh(`echo ${q(plan.head)} > ${R('.deployed-commit')}`);
      healthCache.at = 0;
      say('DONE');
      return res.end();
    }

    const dirs = [...new Set(plan.files.map((f) => path.posix.dirname(f)).filter((d) => d !== '.'))];
    if (dirs.length) await ssh(`cd ${R()} && mkdir -p ${dirs.map(q).join(' ')}`);
    for (const f of plan.files) {
      const r = await scp(path.join(projectRoot, f), R(f));
      say((r.code === 0 ? 'sent  ' : 'FAILED ') + f + (r.code === 0 ? '' : '  ' + r.err.trim()));
      if (r.code !== 0) return res.end();
    }
    if (plan.mode === 'hot') {
      say('Page-only change: updating the running stream page (no restart)…');
      const cp = plan.files.map((f) => `docker compose cp ${q(f)} stream:/app/${q(f)} >/dev/null`).join(' && ');
      const r = await ssh(`cd ${R()} && ${cp} && echo copied`, { timeout: 60000 });
      say(/copied/.test(r.out) ? 'copied into the running container' : 'copy failed: ' + r.err.trim());
      await control({ action: 'reload' }).then(() => say('stream page reloading')).catch((e) => say('reload failed: ' + e.message));
      say('Rebuilding the image in the background so a restart keeps it…');
      ssh(`cd ${R()} && docker compose build -q >/dev/null 2>&1`, { timeout: 600000 });
    } else {
      say('Rebuilding and restarting the stream (about 1–2 minutes, the stream blips once)…');
      const r = await ssh(`cd ${R()} && docker compose build -q 2>&1 | tail -3 && docker compose up -d 2>&1 | tail -2`, { timeout: 600000 });
      say((r.out + r.err).trim() || 'done');
      if (r.code !== 0) { say('Deploy FAILED. The old version may still be running. Check Logs.'); return res.end(); }
    }
    const marker = plan.dirty ? '' : plan.head;
    if (marker) await ssh(`echo ${q(marker)} > ${R('.deployed-commit')}`);
    else say('Note: you have unsaved-to-git changes. Commit them so the next deploy knows what is already on the server.');
    healthCache.at = 0;
    say('DONE');
  } catch (e) {
    say('ERROR: ' + e.message);
  }
  res.end();
});
app.post('/api/deploy/mark', api(async () => {
  const head = (await git(['rev-parse', 'HEAD'])).out.trim();
  await ssh(`echo ${q(head)} > ${R('.deployed-commit')}`);
  healthCache.at = 0;
  return { ok: true, deployed: head };
}));

app.listen(config.port, '127.0.0.1', () => {
  console.log(`WeBot Studio is running: http://localhost:${config.port}`);
  console.log(`Server: ${config.sshUser}@${config.host}:${config.sshPort} (${config.remoteDir})`);
});
