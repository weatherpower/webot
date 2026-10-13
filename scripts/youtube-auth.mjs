// One-time: give the stream permission to manage your YouTube live chat and broadcast (daily title/thumbnail,
// timeouts). Run on your PC:  node scripts/youtube-auth.mjs "C:\path\to\client_secret.json"
// The client file comes from Google Cloud → APIs & Services → Credentials → OAuth client ID (Desktop app).
// It opens Google's sign-in in your browser; after you click Allow, the permission is saved straight to the
// server (data/youtube-oauth.json, readable only by root) and never printed.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const SERVER = process.env.WP_SERVER || 'root@207.244.248.128';
const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/`;
const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.log('Usage: node scripts/youtube-auth.mjs "C:\\path\\to\\client_secret.json"');
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const client = raw.installed || raw.web || raw;
if (!client.client_id || !client.client_secret) {
  console.log('That file is not an OAuth client file (it needs client_id and client_secret).');
  process.exit(1);
}

const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: client.client_id, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent'
});

const server = http.createServer(async (req, res) => {
  const q = new URL(req.url, REDIRECT).searchParams;
  if (!q.get('code') && !q.get('error')) { res.end(); return; }
  const done = (msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<body style="font:20px system-ui;padding:40px;background:#0d1117;color:#e6edf3">${msg}</body>`); };
  if (q.get('error')) { done('Google said: ' + q.get('error') + '. You can close this tab and try again.'); console.log('Cancelled:', q.get('error')); server.close(); return; }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: q.get('code'), client_id: client.client_id, client_secret: client.client_secret, redirect_uri: REDIRECT, grant_type: 'authorization_code' })
    });
    const tok = await r.json();
    if (!tok.refresh_token) throw new Error(tok.error_description || tok.error || 'Google did not send a refresh token');
    const tmp = path.join(os.tmpdir(), 'youtube-oauth.json');
    fs.writeFileSync(tmp, JSON.stringify({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: tok.refresh_token, linkedAt: new Date().toISOString() }), { mode: 0o600 });
    execFileSync('scp', ['-P', '22022', '-q', '-o', 'BatchMode=yes', tmp, `${SERVER}:/opt/weatherpower/data/youtube-oauth.json`]);
    fs.rmSync(tmp, { force: true });
    execFileSync('ssh', ['-p', '22022', '-o', 'BatchMode=yes', SERVER, 'chmod 600 /opt/weatherpower/data/youtube-oauth.json && chown 1000:1000 /opt/weatherpower/data/youtube-oauth.json 2>/dev/null; true']);
    done('&#9989; YouTube is linked to WeatherPower Live. You can close this tab.');
    console.log('Linked! Daily titles/thumbnails and chat timeouts are on.');
  } catch (error) {
    done('Something went wrong: ' + String(error.message).replace(/</g, '&lt;'));
    console.log('Failed:', error.message);
  }
  server.close();
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('Opening Google sign-in. Sign in with the WeatherPower channel account and click Allow.');
  // Not `cmd /c start`: cmd treats the & in the link as a command separator and cuts it off.
  if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' });
  else spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' });
  console.log('If no tab opened, paste this into your browser:\n' + url);
});
