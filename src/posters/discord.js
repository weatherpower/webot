import fs from 'node:fs/promises';
import { config } from '../config.js';

const clip = (value = '', max = 1900) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
};

const asDiscordColor = (value) => {
  const hex = String(value || '').replace('#', '').trim();
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return Number.parseInt(hex.split('').map((char) => `${char}${char}`).join(''), 16);
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return Number.parseInt(hex, 16);
  }
  return 0x00d5ff;
};

const isPrivateHostname = (hostname = '') => {
  const host = String(hostname).trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (['localhost', '0.0.0.0', '::1'].includes(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.internal')) return true;
  if (/^(?:fc|fd|fe80):/i.test(host)) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [first, second] = ipv4.slice(1).map(Number);
  return first === 10
    || first === 127
    || first === 0
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
};

export const isSafeDiscordPublicUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !isPrivateHostname(url.hostname);
  } catch {
    return false;
  }
};

const redactPrivateAddresses = (value = '') => String(value || '')
  .replace(/https?:\/\/[^\s<]+/gi, (url) => (isSafeDiscordPublicUrl(url) ? url : '[private link removed]'))
  .replace(/\b(?:localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})\b/gi, '[private address removed]');

const webhookUrlWithWait = () => {
  const url = new URL(config.discord.webhookUrl);
  url.searchParams.set('wait', 'true');
  return url.toString();
};

const discordFetch = async (url, options) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const detail = body?.message || body?.raw || response.statusText;
    const error = new Error(`Discord webhook ${response.status}: ${detail}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
};

const detailUrl = (warning) => {
  const key = warning.key || warning.nwsId || '';
  if (!isSafeDiscordPublicUrl(config.publicBaseUrl)) return '';
  return key ? `${config.publicBaseUrl}/warningdetail?key=${encodeURIComponent(key)}` : `${config.publicBaseUrl}/warningcenter`;
};

const field = (name, value, inline = true) => (
  value ? { name, value: clip(redactPrivateAddresses(value), 1024), inline } : null
);

export const payloadForDiscord = ({ warning, render, text }) => {
  const title = clip(redactPrivateAddresses(warning.title || warning.event || 'WeatherPower Warning'), 256);
  const cardFilename = render.filename || 'warning-card.png';
  const link = detailUrl(warning);
  const fields = [
    field('Event', warning.event),
    field('Area', warning.areaDesc || warning.state),
    field('Expires', warning.expiresAt ? new Date(warning.expiresAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''),
    field('Radar', warning.radar?.mode ? `${warning.radar.mode}${warning.radar.site ? ` · ${warning.radar.site}` : ''}` : '')
  ].filter(Boolean);

  const embed = {
    title,
    description: clip(redactPrivateAddresses(warning.whatToDo || warning.sourceText || 'WeatherPower warning card rendered.'), 900),
    color: asDiscordColor(warning.theme?.accent || warning.theme?.primary || warning.theme?.polygon),
    fields,
    image: {
      url: `attachment://${cardFilename}`
    },
    footer: {
      text: 'WeatherPower Warning Center'
    },
    timestamp: new Date(warning.issuedAt || warning.renderedAt || Date.now()).toISOString()
  };
  if (link) embed.url = link;

  return {
    username: config.discord.username || 'WeatherPower',
    ...(isSafeDiscordPublicUrl(config.discord.avatarUrl) ? { avatar_url: config.discord.avatarUrl } : {}),
    content: clip([redactPrivateAddresses(text || warning.postText || title), link].filter(Boolean).join('\n'), 1900),
    allowed_mentions: { parse: [] },
    embeds: [embed]
  };
};

export const postCardToDiscord = async ({ warning, render, text, dryRun = false, context = 'manual' }) => {
  if (dryRun) {
    return {
      skipped: true,
      dryRun: true,
      reason: 'Dry run enabled'
    };
  }

  if (!config.discord.enabled || !config.discord.webhookUrl) {
    return {
      skipped: true,
      reason: 'DISCORD_WEBHOOK_URL is missing or Discord posting is disabled'
    };
  }

  const image = await fs.readFile(render.filePath);
  const contentType = render.contentType || (render.filePath.endsWith('.gif') ? 'image/gif' : 'image/png');
  const form = new FormData();
  const payload = payloadForDiscord({ warning, render, text });
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', new Blob([image], { type: contentType }), render.filename || `warning-card.${contentType === 'image/gif' ? 'gif' : 'png'}`);

  const body = await discordFetch(webhookUrlWithWait(), {
    method: 'POST',
    body: form
  });

  return {
    skipped: false,
    context,
    messageId: body?.id,
    channelId: body?.channel_id,
    webhookId: body?.webhook_id,
    publicLinkIncluded: Boolean(payload.embeds?.[0]?.url)
  };
};
