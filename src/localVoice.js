// WeBot's free voice, made on this PC: Kokoro in a low-priority child process (localVoiceWorker.js).
// Each line is made once and shared by every screen (OBS, the TV, a browser), so nothing is billed and
// three screens don't triple the work. Used when Live Control picks "Free voice on this PC" and as the
// automatic fallback when Puter fails (out of usage, signed out).
import { fork } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEURAL_VOICES } from './live.js';

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'localVoiceWorker.js');
const MAX_CHARS = 400;
const MAX_QUEUE = 30;
const cache = new Map();
const inflight = new Map();
let child = null;
let state = 'off';
let lastError = '';
let seq = 0;
const waits = new Map();

const fail = (message, status) => Object.assign(new Error(message), { status });

const start = () => {
  if (child) return;
  state = 'loading';
  child = fork(WORKER, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  // Below normal: OBS encoding and the server always win the CPU.
  try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
  child.stderr?.on('data', () => {});
  child.on('message', (msg) => {
    if (msg.type === 'ready') { state = 'ready'; return; }
    if (msg.type === 'failed') { state = 'failed'; lastError = msg.error; return; }
    const wait = waits.get(msg.id);
    if (!wait) return;
    waits.delete(msg.id);
    if (msg.error) wait.reject(fail('Voice: ' + msg.error, 500));
    else wait.resolve(Buffer.from(msg.wav, 'base64'));
  });
  child.on('exit', () => {
    child = null;
    if (state !== 'failed') state = 'off';
    waits.forEach((w) => w.reject(fail('Voice worker stopped', 503)));
    waits.clear();
  });
};

// The stream page calls this when it boots so the model is loaded (about 10 s) before WeBot's first line.
export const warmLocalVoice = () => { if (state === 'off') start(); };

export const localVoiceStatus = () => ({ available: state !== 'failed', state, error: state === 'failed' ? lastError : '' });

export const localSpeech = async ({ text, voice, speed }) => {
  const input = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (!input) throw fail('Nothing to say', 400);
  if (state === 'failed') throw fail('Free voice unavailable: ' + lastError, 503);
  const name = NEURAL_VOICES.includes(voice) ? voice : 'af_alloy';
  const rate = Math.min(1.4, Math.max(0.7, Number(speed) || 1));
  const key = `${name}|${rate}|${input}`;
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  if (inflight.has(key)) return inflight.get(key);
  if (waits.size >= MAX_QUEUE) throw fail('Voice is busy', 429);
  start();
  const request = new Promise((resolve, reject) => {
    const id = ++seq;
    waits.set(id, { resolve, reject });
    child.send({ id, text: input, voice: name, speed: rate });
  }).then((audio) => {
    cache.set(key, audio);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return audio;
  });
  inflight.set(key, request);
  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
};
