// Dev helper: node scripts/screenshot-page.js <url> <out.png> [width] [height] [waitMs] [clickSelector]
import { chromium } from 'playwright';

const [url, out, width = '1440', height = '900', wait = '8000', click = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: process.env.RENDER_BROWSER_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(Number(wait));
  if (click) {
    await page.click(click);
    await page.waitForTimeout(3500);
  }
  await page.screenshot({ path: out });
  if (errors.length) console.log(`Page errors:\n${errors.slice(0, 10).join('\n')}`);
} finally {
  await browser.close();
}
