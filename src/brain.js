// WeBot's brain: the settings anyone can change without touching code (WeBot Studio → Brain).
// Saved in data/webot-brain.json; anything missing falls back to these defaults. The stream page
// reloads it every minute and the chat reader on every chat read, so changes go live without a restart.
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from './paths.js';

const FILE = path.join(dataDir, 'webot-brain.json');

export const DEFAULT_BRAIN = {
  identity: {
    name: 'WeBot',
    tagline: 'AI weather bot'
  },
  // How often each segment comes up on calm days (bigger = more often; 0 = never).
  calmWeights: { surface: 5, alert: 1.5, think: 1, national: 1, outlook: 0.5, reports: 0.5, forecast: 2.5, gas: 0.9 },
  // How long each segment stays up on calm days, in seconds.
  calmSeconds: { surface: 180, national: 100, alert: 75, models: 85, tropics: 80, outlook: 70, reports: 70, forecast: 75, gas: 70, think: 13 },
  gasEveryMinutes: 40,
  lines: {
    // {city} becomes the city and state, {name} the viewer's name.
    forecast: ['Let’s check the forecast for {city}.', 'Time for a daily forecast. We’re heading to {city}.', 'Let’s zoom into {city} and see what the forecast looks like.', 'Here’s your forecast for {city}.'],
    forecastRequest: '{name} asked for the forecast in {city}. Let’s take a look.',
    gas: ['Let’s check gas prices.', 'Time for a gas price check.', 'Let’s see what it costs to fill up this week.', 'Here’s your weekly gas price update.'],
    gasRequest: '{name} asked about gas prices around {city}.',
    surface: ['Here’s the national radar with the latest surface map.', 'Let’s check the national radar and the surface map.', 'Time for a look at the big picture on radar.']
  },
  chat: {
    readAloud: true,
    readEverySeconds: 75,
    sameViewerMinutes: 5,
    requestEveryMinutes: 2,
    commandCooldownMinutes: 10,
    maxRequestsPer20Minutes: 6,
    // Extra words or phrases WeBot never reads out (on top of the built-in filter).
    blockedWords: [],
    hint: 'TYPE !FORECAST OR !GAS WITH A CITY OR ZIP IN CHAT · WEBOT WILL CHECK IT ON THE STREAM',
    replies: {
      greeting: ['Hey there, thanks for hanging out!', 'Welcome in!', 'Howdy! Glad you’re here.'],
      compliment: ['Thank you, that means a lot!', 'Appreciate you!', 'Thanks! I’m having fun up here too.'],
      weatherQuestion: ['For your town’s forecast, type exclamation forecast and your city in the chat.'],
      name: ['That’s me!', 'Yep, WeBot here.']
    }
  },
  radio: {
    // Share of calm/chill songs that are country when the style is Mix (0 to 1).
    countryShare: 0.45,
    countryNames: ['Red Dirt Radar', 'Front Porch Forecast', 'Dryline Drive', 'Kiamichi Morning', 'County Road Rain', 'Heat Lightning',
      'Barometer Blues', 'Prairie Thunder', 'Gravel Road Gust Front', 'Tornado Alley Two-Step', 'Cotton Field Clouds', 'Red River Rain',
      'Thunderhead Highway', 'Pickup Truck Partly Cloudy', 'Small Town Sunrise', 'Wheat Field Wind'],
    calmNames: ['Clear Skies', 'Dew Point', 'Warm Front', 'High Pressure', 'Fair Weather', 'Morning Fog', 'Light Breeze', 'Sunday Radar'],
    chillNames: ['Night Shift', 'Overnight Radar', 'Low Clouds', 'Outflow', 'Mesoscale', 'Watch Box', 'Chaser Coffee', 'Data Feed'],
    stormNames: ['Supercell Season', 'Hook Echo', 'Wall Cloud', 'Dryline', 'Rear Flank', 'Couplet', 'Inflow', 'Bounded Weak Echo']
  }
};

// Keep only known keys, of the same type as the default, within sane limits.
const clean = (value, def) => {
  if (Array.isArray(def)) {
    if (!Array.isArray(value)) return def;
    const list = value.map((v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)).filter(Boolean).slice(0, 60);
    return list.length || !def.length ? list : def;
  }
  if (def && typeof def === 'object') {
    const out = {};
    for (const key of Object.keys(def)) out[key] = clean(value && typeof value === 'object' ? value[key] : undefined, def[key]);
    return out;
  }
  if (typeof def === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(100000, Math.max(0, n)) : def;
  }
  if (typeof def === 'boolean') return typeof value === 'boolean' ? value : def;
  if (typeof def === 'string') return value == null ? def : String(value).replace(/\s+/g, ' ').trim().slice(0, 300) || def;
  return def;
};

let cache = { at: 0, brain: null };

export const loadBrain = async () => {
  if (cache.brain && Date.now() - cache.at < 5000) return cache.brain;
  let saved = {};
  try { saved = JSON.parse(await fs.readFile(FILE, 'utf8')); } catch {}
  const brain = clean(saved, DEFAULT_BRAIN);
  brain.radio.countryShare = Math.min(1, brain.radio.countryShare);
  cache = { at: Date.now(), brain };
  return brain;
};

export const saveBrain = async (next) => {
  const brain = clean(next, DEFAULT_BRAIN);
  brain.radio.countryShare = Math.min(1, brain.radio.countryShare);
  await fs.mkdir(dataDir, { recursive: true });
  const tmp = FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(brain, null, 2));
  await fs.rename(tmp, FILE);
  cache = { at: Date.now(), brain };
  return brain;
};
