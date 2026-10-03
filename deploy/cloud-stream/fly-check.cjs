// Measure how smooth the map moves on the cloud stream: frames drawn per second while the camera flies.
// docker compose cp deploy/cloud-stream/fly-check.cjs stream:/tmp/ && docker compose exec stream node /tmp/fly-check.cjs
const { chromium } = require('/app/node_modules/playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages().find((p) => p.url().includes('/live'));
  const result = {};
  for (const smooth of [false, true]) result[smooth ? 'new' : 'old'] = await page.evaluate(async (smooth) => {
    const { S, FLY, nextShot } = window.WPLive;
    FLY.smooth = smooth;
    const frames = [];
    let moving = false, run = true;
    const tick = (t) => { frames.push([t, moving]); if (run) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const onStart = () => { moving = true; };
    const onEnd = () => { moving = false; };
    S.map.on('movestart', onStart);
    S.map.on('moveend', onEnd);
    const flights = [];
    for (let i = 0; i < 3; i++) {
      const from = frames.length;
      nextShot(true);
      await new Promise((r) => setTimeout(r, 9000));
      const mv = frames.slice(from).filter((f) => f[1]);
      if (mv.length > 1) {
        const gaps = mv.slice(1).map((f, k) => f[0] - mv[k][0]);
        const secs = (mv[mv.length - 1][0] - mv[0][0]) / 1000;
        flights.push({ shot: S.shot?.type, secs: +secs.toFixed(1), fps: +(mv.length / secs).toFixed(1), worstGapMs: Math.round(Math.max(...gaps)), over100ms: gaps.filter((g) => g > 100).length });
      } else flights.push({ shot: S.shot?.type, note: 'no camera move' });
      await new Promise((r) => setTimeout(r, 6000));
    }
    run = false;
    S.map.off('movestart', onStart);
    S.map.off('moveend', onEnd);
    FLY.smooth = true;
    return flights;
  }, smooth);
  console.log(JSON.stringify(result, null, 1));
  await browser.close().catch(() => {});
})().catch((e) => { console.error('fly check failed:', e.message); process.exit(1); });
