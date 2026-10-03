// Diagnose the cloud stream voice: docker compose cp deploy/cloud-stream/voice-check.cjs stream:/tmp/ && docker compose exec stream node /tmp/voice-check.cjs
const { chromium } = require('/app/node_modules/playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages().find((p) => p.url().includes('/live'));
  console.log('page:', page.url());
  const logs = [];
  page.on('console', (m) => { if (/puter|voice|fell back/i.test(m.text())) logs.push(m.type() + ': ' + m.text().slice(0, 200)); });
  const info = await page.evaluate(async () => {
    const out = { puterLoaded: Boolean(window.puter), signedIn: window.puter?.auth?.isSignedIn?.() };
    try { const u = await puter.auth.getUser(); out.user = u?.username; } catch (e) { out.userError = String(e?.message || e); }
    try {
      const el = await puter.ai.txt2speech('Testing one two three.', { provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'alloy' });
      out.src = String(el?.src || '').slice(0, 60);
      const r = await fetch(el.src); const b = await r.arrayBuffer(); out.bytes = b.byteLength; out.type = r.headers.get('content-type');
    } catch (e) { out.ttsError = JSON.stringify(e?.error || e?.message || String(e)).slice(0, 300); }
    try { const u = await puter.auth.getMonthlyUsage?.(); out.usage = JSON.stringify(u).slice(0, 300); } catch (e) { out.usageError = String(e?.message || e).slice(0, 120); }
    return out;
  });
  console.log(JSON.stringify(info, null, 1));
  await page.waitForTimeout(40000);
  console.log('console:', logs.length ? logs : 'nothing voice-related');
  await browser.close().catch(() => {});
})().catch((e) => { console.error('diag failed:', e.message); process.exit(1); });
