// WeBot, your Jarvis: a single desktop window (Edge app window, see desktop/launch_signed.pyw jarvis) where
// WeBot listens to you, thinks with your own Claude Code, and talks back in his Puter voice.
//
// This little server only listens on 127.0.0.1. It serves the window and runs Claude Code headless
// (`claude -p`) for each thing you say, keeping one conversation going until you start a new one or
// it sits idle for 30 minutes. Claude Code here can look things up (web search, read files) but can't
// change anything on the PC.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.JARVIS_PORT || 7790);
const ROOT = __dirname;
const DATA = path.join(process.env.LOCALAPPDATA || ROOT, 'WeatherPower', 'webot-jarvis');
const HOME = path.join(DATA, 'home'); // Claude Code's working folder for these chats
fs.mkdirSync(HOME, { recursive: true });

const PERSONA = [
  "You are WeBot, the user's personal voice assistant, like Jarvis, living in a window on their Windows PC.",
  "You're the sassy, funny Southern robot from the WeatherPower 24/7 weather stream: warm, quick, a little mean in a loving way, and you never cuss.",
  'Everything you say is read out loud by a text-to-speech voice, so answer in one to three short sentences unless they ask for more.',
  'Never use markdown, bullet points, headings, code blocks, links, or emojis. Write numbers, symbols and units the way you would say them.',
  'You can search the web, fetch pages and read files when it helps. You cannot click, type, run programs or change anything on this PC; if they ask for that, say so in one line.',
  "If you didn't catch what they meant, ask one short question."
].join(' ');
const TOOLS = 'WebSearch,WebFetch,Read,Glob,Grep';
const IDLE_MS = 30 * 60 * 1000;

// The Claude app keeps its Claude Code in a versioned folder that changes on updates: use the newest one.
const findClaude = () => {
  const base = path.join(process.env.APPDATA || '', 'Claude', 'claude-code');
  const found = [];
  try {
    for (const ver of fs.readdirSync(base)) {
      const vdir = path.join(base, ver);
      for (const sub of fs.readdirSync(vdir)) {
        const exe = path.join(vdir, sub, 'claude.exe');
        if (fs.existsSync(exe)) found.push({ exe, t: fs.statSync(exe).mtimeMs });
      }
    }
  } catch { /* not installed there */ }
  for (const exe of [path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe')]) if (fs.existsSync(exe)) found.push({ exe, t: 0 });
  return found.sort((a, b) => b.t - a.t)[0]?.exe || null;
};

let session = { id: null, at: 0 };
let busy = Promise.resolve();

const runClaude = (text) => new Promise((resolve) => {
  const exe = findClaude();
  if (!exe) return resolve({ error: 'I can’t find Claude Code on this PC. Is the Claude app installed?' });
  if (session.id && Date.now() - session.at > IDLE_MS) session = { id: null, at: 0 };
  const args = ['-p', '--output-format', 'json', '--append-system-prompt', PERSONA, '--allowedTools', TOOLS, '--max-turns', '10'];
  if (session.id) args.push('--resume', session.id);
  const child = spawn(exe, args, { cwd: HOME, windowsHide: true, env: { ...process.env } });
  let out = '';
  let err = '';
  const timer = setTimeout(() => child.kill(), 3 * 60 * 1000);
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', (e) => { clearTimeout(timer); resolve({ error: 'Claude Code would not start: ' + e.message }); });
  child.on('close', () => {
    clearTimeout(timer);
    let body = null;
    try { body = JSON.parse(out.trim().split('\n').pop()); } catch { /* not JSON */ }
    const result = String(body?.result || '').trim();
    if (/not logged in|\/login/i.test(result + err)) return resolve({ needsLogin: true });
    if (!body || body.is_error) {
      // A resumed conversation that's gone (cleaned up, expired): start fresh next time.
      if (session.id) session = { id: null, at: 0 };
      return resolve({ error: result || err.trim().slice(0, 200) || 'Claude Code did not answer.' });
    }
    session = { id: body.session_id || session.id, at: Date.now() };
    resolve({ reply: result });
  });
  child.stdin.end(text);
});

const ask = (text) => {
  const p = busy.then(() => runClaude(text));
  busy = p.catch(() => {});
  return p;
};

// Sign-in: Claude Code opens in its own console window with /login; you finish it in the browser.
const openLogin = () => {
  const exe = findClaude();
  if (!exe) return false;
  spawn('cmd.exe', ['/c', 'start', '"Sign in to Claude Code"', '"' + exe + '"', '/login'], { cwd: HOME, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  return true;
};

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((resolve) => {
  let s = '';
  req.on('data', (d) => { s += d; if (s.length > 20000) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  // Only this PC's own window may talk to the brain.
  if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://127.0.0.1:${PORT}`) return send(res, 403, { error: 'forbidden' });
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, fs.readFileSync(path.join(ROOT, 'index.html')), 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/webot.png') return send(res, 200, fs.readFileSync(path.join(ROOT, '..', 'public', 'assets', 'webot.png')), 'image/png');
  if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, { claude: Boolean(findClaude()), session: Boolean(session.id) });
  if (req.method === 'POST' && url.pathname === '/api/ask') {
    const { text } = await readBody(req);
    const t = String(text || '').trim().slice(0, 4000);
    if (!t) return send(res, 400, { error: 'Nothing to ask' });
    return send(res, 200, await ask(t));
  }
  if (req.method === 'POST' && url.pathname === '/api/new') { session = { id: null, at: 0 }; return send(res, 200, { ok: true }); }
  if (req.method === 'POST' && url.pathname === '/api/login') return send(res, 200, { ok: openLogin() });
  send(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`WeBot Jarvis on http://127.0.0.1:${PORT}/ (Claude Code: ${findClaude() || 'not found'})`));
