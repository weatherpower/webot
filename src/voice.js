// Optional server voice for WeBot through any OpenAI-compatible /audio/speech endpoint:
// OpenAI itself (paid, needs OPENAI_API_KEY) or a self-hosted server such as Kokoro-FastAPI (free).
// The free default voice does not use this: it runs Kokoro inside the stream page.
import { config } from './config.js';
import { OPENAI_VOICES } from './live.js';

const OPENAI_BASE = 'https://api.openai.com/v1';
const MAX_CHARS = 400;
const PER_MINUTE = 40;
const cache = new Map();
const inflight = new Map();
let recent = [];
let budget = { day: '', used: 0 };

const settings = () => config.openaiTts;

// OpenAI needs a key; a self-hosted OpenAI-compatible server usually does not.
export const openaiTtsAvailable = () => Boolean(settings().key) || settings().baseUrl.replace(/\/+$/, '') !== OPENAI_BASE;

export const openaiTtsStatus = () => ({
  available: openaiTtsAvailable(),
  model: settings().model,
  hosted: settings().baseUrl.replace(/\/+$/, '') === OPENAI_BASE ? 'openai' : 'custom'
});

const fail = (message, status) => Object.assign(new Error(message), { status });

export const openaiSpeech = async ({ text, voice, speed }) => {
  if (!openaiTtsAvailable()) throw fail('Set OPENAI_API_KEY (or OPENAI_TTS_BASE_URL) on the server to use this voice', 503);
  const input = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (!input) throw fail('Nothing to say', 400);
  const name = OPENAI_VOICES.includes(voice) ? voice : settings().voice;
  const rate = Math.min(1.4, Math.max(0.7, Number(speed) || 1));
  const key = `${name}|${rate}|${input}`;
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  if (inflight.has(key)) return inflight.get(key);

  // Guard the bill: a per-minute cap and a daily character budget (the endpoint is public).
  const now = Date.now();
  recent = recent.filter((at) => now - at < 60 * 1000);
  if (recent.length >= PER_MINUTE) throw fail('Too many voice requests, slow down', 429);
  const day = new Date().toISOString().slice(0, 10);
  if (budget.day !== day) budget = { day, used: 0 };
  if (budget.used + input.length > settings().dailyChars) throw fail('Daily voice budget used up', 429);
  recent.push(now);
  budget.used += input.length;

  const request = (async () => {
    const body = { model: settings().model, voice: name, input, response_format: 'mp3', speed: rate };
    if (/gpt-4o/.test(settings().model) && settings().instructions) body.instructions = settings().instructions;
    const response = await fetch(settings().baseUrl.replace(/\/+$/, '') + '/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(settings().key ? { Authorization: `Bearer ${settings().key}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw fail(`Voice server said ${response.status}`, 502);
    const audio = Buffer.from(await response.arrayBuffer());
    cache.set(key, audio);
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return audio;
  })();
  inflight.set(key, request);
  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
};
