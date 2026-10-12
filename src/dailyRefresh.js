// Daily title + thumbnail refresh for the live broadcast (6 AM Central).
// Picks the day's evergreen title, renders a fresh thumbnail in the "SASSY & SOUTHERN" style over a frame of the
// stream's own radar, and puts both on the current live video. The description is never touched.
// Needs the channel's permission (YOUTUBE_OAUTH_* in .env, set by scripts/youtube-auth.mjs on the owner's PC).
//   node src/dailyRefresh.js --preview   render today's thumbnail to cards/daily-thumb.jpg (no upload)
//   node src/dailyRefresh.js --now       render and upload right now
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { config } from './config.js';
import { dataDir, projectRoot } from './paths.js';
import { liveVideoId, ytLinked, ytToken } from './youtubeChat.js';

const run = promisify(execFile);
const ASSETS = path.join(projectRoot, 'public', 'assets');
const OUT = path.join(projectRoot, 'cards', 'daily-thumb.jpg');
const STATE = path.join(dataDir, 'daily-refresh.json');
const HOUR = Number(process.env.DAILY_REFRESH_HOUR ?? 6); // Central time

const TITLES = [
  '🔴 LIVE 24/7 Severe Weather Coverage – Live Radar, Warnings & Forecasts | WeatherPower Live',
  '🔴 LIVE 24/7 Weather with WeBot – Live Radar & Every Warning (He Talks Back) | WeatherPower',
  '🔴 LIVE 24/7 Severe Weather – Sassy, Southern & Never Sleeps | Live Radar | WeatherPower Live',
  '🔴 LIVE 24/7 Tornado, Storm & Hurricane Coverage – Live Radar | WeatherPower Live with WeBot',
  '🔴 LIVE 24/7 Weather Radar – Every Warning as It Happens + Chat with WeBot | WeatherPower Live',
  '🔴 LIVE 24/7 Severe Weather – Ask WeBot for Your Forecast! Live Radar & Warnings | WeatherPower',
  '🔴 LIVE 24/7 Storm Coverage – Live Radar, Warnings & a Robot with Attitude | WeatherPower Live'
];
const HEADS = [['SASSY', '& SOUTHERN'], ['STORMS?', 'I GOT ’EM'], ['NEVER', 'SLEEPS'], ['BLESS', 'YOUR HEART'], ['RADAR', '& ATTITUDE']];
const BUBBLES = ['HONEY, IT’S<br>FIXIN’ TO STORM!', 'BLESS YOUR<br>HEART!', 'Y’ALL GET<br>INSIDE!', 'ASK ME FOR YOUR<br>FORECAST!', 'I DON’T SLEEP,<br>DARLIN’!', 'NOT A COPY,<br>SUGAR!', 'I SEE YOU,<br>STORM!'];
const STICKERS = [['!ROAST ME', '!FORECAST', 'HE TALKS BACK'], ['!FORECAST', '!GAS', 'LIVE RADAR'], ['!ROAST ME', 'EVERY WARNING', 'HE TALKS BACK'], ['!GAS', '!ROAST ME', 'NEVER SLEEPS']];
for (const t of TITLES) if ([...t].length > 100) throw new Error('title over 100 characters: ' + t);

const centralDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const centralHour = (d = new Date()) => Number(d.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }));
const dayIndex = () => Math.floor(Date.parse(centralDate() + 'T12:00:00Z') / 86400000);
const pick = (list, salt = 0) => list[(dayIndex() + salt) % list.length];
const fileUrl = (p) => 'file://' + p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:');

// The radar part of the live stream right now (between the side panels), or the stored radar picture.
const radarFrame = async () => {
  const shot = path.join(dataDir, 'daily-radar.png');
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'x11grab', '-draw_mouse', '0', '-i', process.env.DISPLAY || ':99', '-frames:v', '1',
      '-vf', 'crop=iw*0.578:ih*0.583:iw*0.281:ih*0.306,scale=1280:720', shot], { timeout: 20000 });
    return shot;
  } catch {
    return path.join(ASSETS, 'thumb-radar.png');
  }
};

const hatSvg = async () => {
  const live = await fs.readFile(path.join(projectRoot, 'public', 'live.html'), 'utf8');
  return (live.match(/cowboy: '(.*?)',\n/) || [])[1] || '';
};

const thumbHtml = async (radar) => {
  const [big, small] = pick(HEADS);
  const [s1, s2, s3] = pick(STICKERS, 3);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Oswald; src: url('${fileUrl(path.join(ASSETS, 'fonts', 'oswald-latin.woff2'))}') format('woff2'); font-weight: 200 700; }
* { margin: 0; box-sizing: border-box; }
html, body { width: 1280px; height: 720px; overflow: hidden; background: #0a0d12; font-family: Oswald, sans-serif; }
.bg { position: absolute; inset: 0; background: url('${fileUrl(radar)}') center / cover; filter: saturate(1.45) contrast(1.12); }
.shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(8,10,14,.96) 0%, rgba(8,10,14,.86) 34%, rgba(8,10,14,.25) 60%, rgba(8,10,14,.05) 100%), linear-gradient(0deg, rgba(8,10,14,.9) 0%, rgba(8,10,14,0) 26%); }
.h1 { position: absolute; left: 50px; top: 34px; color: #fff; font-weight: 700; font-size: ${big.length > 6 ? 138 : 168}px; line-height: .9; letter-spacing: -2px; text-shadow: 0 10px 40px rgba(0,0,0,.7); }
.h2 { position: absolute; left: 58px; top: 196px; color: #ffcf4a; font-weight: 700; font-size: 54px; letter-spacing: 3px; text-shadow: 0 6px 24px rgba(0,0,0,.7); }
.big { position: absolute; left: 54px; top: 300px; color: #ffcf4a; font-weight: 700; font-size: 150px; line-height: .9; text-shadow: 0 8px 36px rgba(0,0,0,.7); }
.big small { display: block; color: #fff; font-size: 52px; letter-spacing: 3px; margin-top: 8px; }
.bot { position: absolute; left: 610px; top: 150px; width: 430px; height: 440px; filter: drop-shadow(0 18px 40px rgba(0,0,0,.7)); }
.bot img, .bot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.bubble { position: absolute; left: 352px; top: 318px; background: #fff; color: #2a1446; font-weight: 700; font-size: 38px; line-height: 1.05; padding: 16px 22px; border-radius: 26px; transform: rotate(-4deg); box-shadow: 0 10px 30px rgba(0,0,0,.45); }
.bubble::after { content: ''; position: absolute; right: -24px; top: 34px; border: 14px solid transparent; border-left: 28px solid #fff; }
.sticker { position: absolute; font-weight: 700; letter-spacing: 1px; padding: 10px 20px; border-radius: 14px; box-shadow: 0 8px 22px rgba(0,0,0,.45); }
.s1 { right: 38px; top: 40px; background: #ffcf4a; color: #1b1206; font-size: 46px; transform: rotate(4deg); }
.s2 { right: 52px; top: 150px; background: #33d4ff; color: #04202b; font-size: 36px; transform: rotate(-3deg); }
.s3 { right: 40px; top: 238px; background: #ff4d6d; color: #fff; font-size: 34px; transform: rotate(3deg); }
.bar { position: absolute; left: 0; right: 0; bottom: 0; height: 76px; background: #0b0e13; border-top: 4px solid #ffcf4a; display: flex; align-items: center; gap: 18px; padding: 0 28px; }
.live { display: flex; align-items: center; gap: 12px; background: #e3122b; color: #fff; font-weight: 700; font-size: 40px; padding: 4px 18px 4px 14px; border-radius: 8px; }
.live i { width: 20px; height: 20px; border-radius: 50%; background: #fff; }
.what { color: #fff; font-weight: 700; font-size: 40px; letter-spacing: 2px; }
.brand { margin-left: auto; display: flex; align-items: center; gap: 12px; color: #fff; font-weight: 700; font-size: 36px; letter-spacing: 1px; }
.brand img { width: 50px; height: 50px; border-radius: 9px; }
</style></head><body>
<div class="bg"></div><div class="shade"></div>
<div class="h1">${big}</div><div class="h2">${small}</div>
<div class="big">24/7<small>LIVE WEATHER</small></div>
<div class="bot"><img src="${fileUrl(path.join(ASSETS, 'webot.png'))}" alt=""><svg viewBox="0 0 384 393">${await hatSvg()}</svg></div>
<div class="bubble">${pick(BUBBLES, 1)}</div>
<div class="sticker s1">${s1}</div><div class="sticker s2">${s2}</div><div class="sticker s3">${s3}</div>
<div class="bar"><div class="live"><i></i>LIVE</div><div class="what">24/7 · STORMS · RADAR · CHAT</div>
<div class="brand"><img src="${fileUrl(path.join(ASSETS, 'wp-logo.png'))}" alt="">WEATHERPOWER LIVE</div></div>
</body></html>`;
};

export const renderThumbnail = async () => {
  const html = path.join(dataDir, 'daily-thumb.html');
  await fs.writeFile(html, await thumbHtml(await radarFrame()));
  const browser = await chromium.launch({ headless: true, ...(config.renderer.browserChannel ? { channel: config.renderer.browserChannel } : {}), args: ['--no-sandbox', '--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(fileUrl(html));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await fs.mkdir(path.dirname(OUT), { recursive: true });
    await page.screenshot({ path: OUT, type: 'jpeg', quality: 88 });
  } finally {
    await browser.close();
  }
  return OUT;
};

// The live broadcast: the chat reader's video, or the channel's /live page.
const findVideo = async () => {
  if (liveVideoId()) return liveVideoId();
  const ch = process.env.YOUTUBE_CHANNEL_ID || '';
  const html = await fetch(`https://www.youtube.com/channel/${ch}/live`, { headers: { 'User-Agent': 'Mozilla/5.0 (WeatherPower Live)', 'Accept-Language': 'en-US' } }).then((r) => r.text()).catch(() => '');
  return (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/) || [])[1] || '';
};

export const refreshNow = async () => {
  const token = await ytToken();
  if (!token) throw new Error('YouTube is not linked (run scripts/youtube-auth.mjs on your PC)');
  const id = await findVideo();
  if (!id) throw new Error('No live broadcast found');
  const auth = { Authorization: 'Bearer ' + token };
  // Title: the API replaces the whole snippet, so send back everything else unchanged.
  const cur = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${id}`, { headers: auth }).then((r) => r.json());
  const sn = cur.items?.[0]?.snippet;
  if (!sn) throw new Error('Could not read the video: ' + JSON.stringify(cur.error || cur).slice(0, 160));
  const title = pick(TITLES);
  const snippet = { title, description: sn.description, categoryId: sn.categoryId, tags: sn.tags, defaultLanguage: sn.defaultLanguage, defaultAudioLanguage: sn.defaultAudioLanguage };
  const up = await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, snippet }) });
  if (!up.ok) throw new Error('Title update ' + up.status + ' ' + (await up.text()).slice(0, 200));
  const jpg = await fs.readFile(await renderThumbnail());
  const th = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${id}&uploadType=media`, { method: 'POST', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: jpg });
  if (!th.ok) throw new Error('Thumbnail upload ' + th.status + ' ' + (await th.text()).slice(0, 200));
  const result = { date: centralDate(), at: new Date().toISOString(), videoId: id, title };
  await fs.writeFile(STATE, JSON.stringify(result));
  console.log('[daily] new title + thumbnail:', title);
  return result;
};

export const startDailyRefresh = () => {
  if (process.env.DAILY_REFRESH === 'false') return;
  const tick = async () => {
    try {
      if (!ytLinked() || centralHour() < HOUR) return;
      const last = existsSync(STATE) ? JSON.parse(await fs.readFile(STATE, 'utf8')) : {};
      if (last.date === centralDate()) return;
      await refreshNow();
    } catch (error) {
      console.warn('[daily]', error.message);
    }
  };
  setTimeout(tick, 60000);
  setInterval(tick, 15 * 60000);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const job = process.argv.includes('--now') ? refreshNow() : renderThumbnail().then((p) => console.log('thumbnail:', p));
  job.then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
}
