import fs from 'node:fs/promises';
import { config } from '../config.js';

const endpointFetch = async (url, options) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`Page endpoint ${response.status}: ${body?.message || body?.raw || response.statusText}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
};

export const postToPageEndpoint = async ({ warning, render, xResult, discordResult, dryRun = false }) => {
  if (dryRun) {
    return {
      skipped: true,
      dryRun: true,
      reason: 'Dry run enabled'
    };
  }

  if (!config.pageEndpoint.url) {
    return {
      skipped: true,
      reason: 'PAGE_ENDPOINT_URL is missing'
    };
  }

  const headers = {};
  if (config.pageEndpoint.token) {
    headers.Authorization = `Bearer ${config.pageEndpoint.token}`;
  }

  if (config.pageEndpoint.mode === 'multipart') {
    const image = await fs.readFile(render.filePath);
    const form = new FormData();
    form.append('warning', JSON.stringify(warning));
    form.append('xResult', JSON.stringify(xResult || null));
    form.append('discordResult', JSON.stringify(discordResult || null));
    form.append('card', new Blob([image], { type: render.contentType || 'image/png' }), render.filename);
    return endpointFetch(config.pageEndpoint.url, {
      method: 'POST',
      headers,
      body: form
    });
  }

  const imageBase64 = await fs.readFile(render.filePath, 'base64');
  return endpointFetch(config.pageEndpoint.url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      warning,
      xResult: xResult || null,
      discordResult: discordResult || null,
      card: {
        filename: render.filename,
        contentType: render.contentType || 'image/png',
        base64: imageBase64,
        url: `${config.publicBaseUrl}${render.publicPath}`
      }
    })
  });
};
