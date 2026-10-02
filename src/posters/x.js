import fs from 'node:fs/promises';
import { config } from '../config.js';
import { getXUserCredentials } from '../xAuthStore.js';
import { oauth1Header } from '../xOAuth.js';

const xFetch = async (url, options) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const detail = body?.detail || body?.title || body?.errors?.[0]?.detail || response.statusText;
    const error = new Error(`X API ${response.status}: ${detail}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
};

export const postCardToX = async ({ imagePath, text, dryRun = false }) => {
  if (dryRun) {
    return {
      skipped: true,
      dryRun: true,
      reason: 'Dry run enabled'
    };
  }

  const credentials = await getXUserCredentials();
  if (!credentials) {
    return {
      skipped: true,
      reason: 'X account authorization is missing. Use the controller X Authorization panel to connect the posting account.'
    };
  }

  if (credentials.method === 'oauth1') {
    return postCardToXWithOAuth1({
      imagePath,
      text,
      contentType: imagePath.endsWith('.gif') ? 'image/gif' : 'image/png',
      token: credentials.token,
      tokenSecret: credentials.tokenSecret
    });
  }

  return postCardToXWithOAuth2({
    imagePath,
    text,
    contentType: imagePath.endsWith('.gif') ? 'image/gif' : 'image/png',
    userAccessToken: credentials.userAccessToken
  });
};

const postCardToXWithOAuth2 = async ({ imagePath, text, userAccessToken, contentType = 'image/png' }) => {
  const image = await fs.readFile(imagePath);
  const mediaForm = new FormData();
  mediaForm.append('media', new Blob([image], { type: contentType }), `warning-card.${contentType === 'image/gif' ? 'gif' : 'png'}`);
  mediaForm.append('media_category', contentType === 'image/gif' ? 'tweet_gif' : 'tweet_image');
  mediaForm.append('media_type', contentType);

  const mediaBody = await xFetch('https://api.x.com/2/media/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userAccessToken}`
    },
    body: mediaForm
  });

  const mediaId = mediaBody?.data?.id || mediaBody?.data?.media_id_string;
  if (!mediaId) {
    throw new Error('X media upload succeeded but did not return a media id.');
  }

  const tweetBody = await xFetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      media: {
        media_ids: [String(mediaId)]
      }
    })
  });

  return {
    skipped: false,
    mediaId: String(mediaId),
    postId: tweetBody?.data?.id,
    text: tweetBody?.data?.text
  };
};

const postCardToXWithOAuth1 = async ({ imagePath, text, token, tokenSecret, contentType = 'image/png' }) => {
  const image = await fs.readFile(imagePath);
  const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json';
  const mediaForm = new FormData();
  mediaForm.append('media', new Blob([image], { type: contentType }), `warning-card.${contentType === 'image/gif' ? 'gif' : 'png'}`);

  const mediaBody = await xFetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: oauth1Header({
        method: 'POST',
        url: uploadUrl,
        token,
        tokenSecret
      })
    },
    body: mediaForm
  });

  const mediaId = mediaBody?.media_id_string || mediaBody?.media_id;
  if (!mediaId) {
    throw new Error('X media upload succeeded but did not return a media id.');
  }

  const tweetUrl = 'https://api.x.com/2/tweets';
  const tweetBody = await xFetch(tweetUrl, {
    method: 'POST',
    headers: {
      Authorization: oauth1Header({
        method: 'POST',
        url: tweetUrl,
        token,
        tokenSecret
      }),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      media: {
        media_ids: [String(mediaId)]
      }
    })
  });

  return {
    skipped: false,
    authMethod: 'oauth1',
    mediaId: String(mediaId),
    postId: tweetBody?.data?.id,
    text: tweetBody?.data?.text
  };
};
