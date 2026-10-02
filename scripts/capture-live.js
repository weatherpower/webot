// Dev helper: screenshots the live stream page through its shots, driven by the control API.
// Usage: CONTROLLER_TOKEN=... node scripts/capture-live.js <baseUrl> <outDir>
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:8898/warningcenter', outDir = 'data/live-shots'] = process.argv.slice(2);
const token = process.env.CONTROLLER_TOKEN || '';
await fs.mkdir(outDir, { recursive: true });

const control = async (body) => {
  const response = await fetch(`${base}/api/v3/live/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Controller-Token': token }, body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`control ${body.action}: ${response.status}`);
};

const browser = await chromium.launch({
  channel: process.env.RENDER_BROWSER_CHANNEL || 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text()}`); });
  const shot = async (name, wait) => {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
    console.log(`saved ${name}`);
  };
  await control({ action: 'mode', mode: 'auto' });
  await page.goto(`${base}/live`, { waitUntil: 'domcontentloaded' });
  await shot('1-first-shot', 14000);
  await control({ action: 'say', text: 'Testing the WeatherPower bot. Stay safe out there, everyone!' });
  await shot('2-bot-talking', 7500);
  await control({ action: 'mode', mode: 'national' });
  await shot('3-national', 12000);
  await control({ action: 'mode', mode: 'reports' });
  await shot('4-reports', 12000);
  await control({ action: 'mode', mode: 'outlook' });
  await shot('5-outlook', 12000);
  await control({ action: 'mode', mode: 'auto' });
  await control({ action: 'banner', text: 'Live coverage tonight at 7 PM', minutes: 15 });
  await control({ action: 'test-breaking' });
  await shot('6-breaking', 8000);
  await shot('7-after-breaking', 9000);
  await control({ action: 'banner', text: '' });
  const state = await page.evaluate(() => ({
    title: document.getElementById('now-t')?.textContent,
    radar: document.getElementById('rp-site')?.textContent,
    headline: document.querySelector('#hl-slot .txt:last-child')?.textContent
  }));
  console.log(JSON.stringify(state));
  if (errors.length) console.log(`Page messages:\n${[...new Set(errors)].slice(0, 15).join('\n')}`);
} finally {
  await browser.close();
}
