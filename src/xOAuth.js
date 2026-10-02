import crypto from 'node:crypto';
import { config } from './config.js';
import { saveRequestTokenSecret, saveXOAuth1Access, takeRequestTokenSecret } from './xAuthStore.js';

const REQUEST_TOKEN_URL = 'https://api.x.com/oauth/request_token';
const AUTHORIZE_URL = 'https://api.x.com/oauth/authorize';
const ACCESS_TOKEN_URL = 'https://api.x.com/oauth/access_token';

export const percentEncode = (value) => encodeURIComponent(String(value))
  .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const parseForm = (text) => Object.fromEntries(new URLSearchParams(text));

const normalizedParams = (params) => params
  .map(([key, value]) => [percentEncode(key), percentEncode(value)])
  .sort(([aKey, aValue], [bKey, bValue]) => aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey))
  .map(([key, value]) => `${key}=${value}`)
  .join('&');

export const oauth1Header = ({ method, url, token, tokenSecret = '', oauthParams = {}, requestParams = {} }) => {
  if (!config.x.apiKey || !config.x.apiSecret) {
    throw new Error('X_API_KEY and X_API_SECRET are required for OAuth 1.0a.');
  }

  const parsedUrl = new URL(url);
  const baseUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
  const baseOAuthParams = {
    oauth_consumer_key: config.x.apiKey,
    oauth_nonce: crypto.randomBytes(18).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000),
    oauth_version: '1.0',
    ...oauthParams
  };

  if (token) {
    baseOAuthParams.oauth_token = token;
  }

  const params = [
    ...Object.entries(baseOAuthParams),
    ...Object.entries(requestParams)
  ];
  for (const [key, value] of parsedUrl.searchParams.entries()) {
    params.push([key, value]);
  }

  const signatureBase = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(normalizedParams(params))
  ].join('&');
  const signingKey = `${percentEncode(config.x.apiSecret)}&${percentEncode(tokenSecret)}`;
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(signatureBase)
    .digest('base64');

  const headerParams = {
    ...baseOAuthParams,
    oauth_signature: signature
  };

  return `OAuth ${Object.entries(headerParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
    .join(', ')}`;
};

const oauthFetchForm = async ({ url, oauthParams = {}, token, tokenSecret }) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: oauth1Header({
        method: 'POST',
        url,
        token,
        tokenSecret,
        oauthParams
      })
    }
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`X OAuth ${response.status}: ${text || response.statusText}`);
    error.status = response.status;
    error.body = { raw: text };
    throw error;
  }
  return parseForm(text);
};

export const startXOAuth1 = async ({ callbackUrl }) => {
  const requestToken = await oauthFetchForm({
    url: REQUEST_TOKEN_URL,
    oauthParams: {
      oauth_callback: callbackUrl
    }
  });

  if (!requestToken.oauth_token || !requestToken.oauth_token_secret) {
    throw new Error('X did not return a request token.');
  }

  await saveRequestTokenSecret({
    token: requestToken.oauth_token,
    tokenSecret: requestToken.oauth_token_secret
  });

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set('oauth_token', requestToken.oauth_token);
  return authorizeUrl.toString();
};

export const finishXOAuth1 = async ({ oauthToken, oauthVerifier }) => {
  const requestTokenSecret = await takeRequestTokenSecret(oauthToken);
  if (!requestTokenSecret) {
    throw new Error('No matching X request token was found. Start authorization again from the controller.');
  }

  const access = await oauthFetchForm({
    url: ACCESS_TOKEN_URL,
    token: oauthToken,
    tokenSecret: requestTokenSecret,
    oauthParams: {
      oauth_verifier: oauthVerifier
    }
  });

  if (!access.oauth_token || !access.oauth_token_secret) {
    throw new Error('X did not return a user access token.');
  }

  return saveXOAuth1Access(access);
};
