import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { dataDir, ensureRuntimeDirs } from './paths.js';

const authPath = path.join(dataDir, 'x-oauth.json');
const tempPath = path.join(dataDir, 'x-oauth-temp.json');

const readJson = async (filePath, fallback) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
};

const writeJson = async (filePath, data) => {
  await ensureRuntimeDirs();
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

export const loadXOAuth = async () => readJson(authPath, {});

export const saveXOAuth1Access = async (access) => {
  const existing = await loadXOAuth();
  const next = {
    ...existing,
    oauth1: {
      token: access.oauth_token,
      tokenSecret: access.oauth_token_secret,
      userId: access.user_id,
      screenName: access.screen_name,
      savedAt: new Date().toISOString()
    }
  };
  await writeJson(authPath, next);
  return next.oauth1;
};

export const saveRequestTokenSecret = async ({ token, tokenSecret }) => {
  const existing = await readJson(tempPath, {});
  existing[token] = {
    tokenSecret,
    createdAt: Date.now()
  };
  await writeJson(tempPath, existing);
};

export const takeRequestTokenSecret = async (token) => {
  const existing = await readJson(tempPath, {});
  const value = existing[token];
  if (!value) return null;
  delete existing[token];
  await writeJson(tempPath, existing);
  return value.tokenSecret;
};

export const getXUserCredentials = async () => {
  if (config.x.userAccessToken) {
    return {
      method: 'oauth2',
      userAccessToken: config.x.userAccessToken
    };
  }

  if (config.x.oauth1AccessToken && config.x.oauth1AccessTokenSecret) {
    return {
      method: 'oauth1',
      token: config.x.oauth1AccessToken,
      tokenSecret: config.x.oauth1AccessTokenSecret,
      source: 'env'
    };
  }

  const stored = await loadXOAuth();
  if (stored.oauth1?.token && stored.oauth1?.tokenSecret) {
    return {
      method: 'oauth1',
      token: stored.oauth1.token,
      tokenSecret: stored.oauth1.tokenSecret,
      source: 'local-store',
      userId: stored.oauth1.userId,
      screenName: stored.oauth1.screenName
    };
  }

  return null;
};

export const getXAuthStatus = async () => {
  const credentials = await getXUserCredentials();
  const stored = await loadXOAuth();
  return {
    appCredentialsPresent: Boolean(config.x.apiKey && config.x.apiSecret),
    oauth2UserTokenPresent: Boolean(config.x.userAccessToken),
    oauth1UserTokenPresent: Boolean(credentials?.method === 'oauth1'),
    userTokenPresent: Boolean(credentials),
    readyToPost: Boolean(credentials),
    authMethod: credentials?.method || null,
    savedScreenName: stored.oauth1?.screenName || null
  };
};
