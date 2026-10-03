// Print a JPEG of what the stream is showing right now (base64), for WeBot Studio's Snapshot button.
// Read-only: it only looks at the page Chrome is already showing.
const { chromium } = require('/app/node_modules/playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages().find((p) => p.url().includes('/live'));
  if (!page) throw new Error('The stream page is not open');
  const jpg = await page.screenshot({ type: 'jpeg', quality: 78 });
  process.stdout.write(jpg.toString('base64'));
  await browser.close().catch(() => {});
})().catch((e) => { console.error(e.message); process.exit(1); });
