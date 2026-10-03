// Real headlines for WeatherPower Live's top bar: weather news and top US news from RSS feeds
// (Google News by default; HEADLINES_WEATHER_FEEDS / HEADLINES_NEWS_FEEDS take comma-separated RSS URLs).
// Only the headline and its source are shown, never the article.
const GN = 'https://news.google.com/rss';
const DEFAULT_WEATHER = `${GN}/search?q=${encodeURIComponent('weather OR storm OR hurricane OR tornado OR flooding OR "national weather service" when:1d')}&hl=en-US&gl=US&ceid=US:en`;
const DEFAULT_NEWS = `${GN}?hl=en-US&gl=US&ceid=US:en`;
const TTL = 10 * 60 * 1000;
const HEADERS = { 'User-Agent': 'weatherpower.app warning-card-service (headlines)', Accept: 'application/rss+xml, application/xml, text/xml' };
let cache = { at: 0, body: null };

const feeds = (env, fallback) => String(process.env[env] || fallback).split(',').map((s) => s.trim()).filter(Boolean);

const decode = (s) => String(s || '')
  .replace(/^<!\[CDATA\[|\]\]>$/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => decode((xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1]);

// Google News titles end in " - Source"; the <source> tag has it too.
export const parseRss = (xml) => [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
  let title = tag(item, 'title');
  let source = tag(item, 'source');
  if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
  else if (!source) {
    const m = title.match(/^(.*\S)\s+-\s+([^-]{2,40})$/);
    if (m) [, title, source] = m;
  }
  const at = Date.parse(tag(item, 'pubDate')) || 0;
  return { title, source, at };
}).filter((h) => h.title.length >= 12 && h.title.length <= 160);

const load = async (urls, maxAgeH, limit) => {
  const seen = new Set();
  const lists = await Promise.all(urls.map((url) => fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) })
    .then((r) => (r.ok ? r.text() : ''))
    .then(parseRss)
    .catch(() => [])));
  return lists.flat()
    .filter((h) => !h.at || Date.now() - h.at < maxAgeH * 3600 * 1000)
    .sort((a, b) => b.at - a.at)
    .filter((h) => {
      const key = h.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((h) => ({ title: h.title, source: h.source, at: h.at ? new Date(h.at).toISOString() : null }));
};

export const getHeadlines = async () => {
  if (cache.body && Date.now() - cache.at < TTL) return cache.body;
  const [weather, news] = await Promise.all([
    load(feeds('HEADLINES_WEATHER_FEEDS', DEFAULT_WEATHER), 24, 14),
    load(feeds('HEADLINES_NEWS_FEEDS', DEFAULT_NEWS), 12, 14)
  ]);
  // Keep the last good set if a refresh comes back empty (feed down, network blip).
  const body = { updated: new Date().toISOString(), weather: weather.length ? weather : cache.body?.weather || [], news: news.length ? news : cache.body?.news || [] };
  cache = { at: Date.now(), body };
  return body;
};
