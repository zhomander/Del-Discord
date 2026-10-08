// Del-Discord v1 — personal source modules.
import { rand, retryMs, sleep } from '../utils/timing.js';

export class RunStoppedError extends Error {
  constructor() { super('Stopped.'); this.name = 'RunStoppedError'; }
}

// A conservative shared cooldown keeps other panels from continuing to request
// with the same account while Discord asks us to wait. Nothing is persisted.
const cooldowns = new Map();
function pauseAccount(key, milliseconds) {
  const previous = cooldowns.get(key);
  const pause = Promise.all([previous, sleep(milliseconds + rand(250, 750))]).finally(() => {
    if (cooldowns.get(key) === pause) cooldowns.delete(key);
  });
  cooldowns.set(key, pause);
  return pause;
}

export async function apiFetch(url, options = {}, log = () => {}, stopCheck = () => false) {
  const account = new Headers(options.headers).get('Authorization') || '';
  while (true) {
    if (stopCheck()) throw new RunStoppedError();
    const cooldown = cooldowns.get(account);
    if (cooldown) await cooldown;
    if (stopCheck()) throw new RunStoppedError();
    const response = await fetch(url, options);
    if (response.status !== 429) {
      const reset = response.headers.get('X-RateLimit-Reset-After');
      if (response.headers.get('X-RateLimit-Remaining') === '0' && reset !== null && Number.isFinite(Number(reset)) && Number(reset) >= 0) {
        pauseAccount(account, retryMs(reset));
      }
      return response;
    }
    let body = {};
    try { body = await response.json(); } catch {}
    const wait = Math.max(retryMs(body.retry_after ?? response.headers.get('Retry-After')), response.headers.has('Retry-After') ? retryMs(response.headers.get('Retry-After')) : 0);
    log('warn', `Rate limited. Waiting ${(wait / 1000).toFixed(1)}s...`);
    await pauseAccount(account, wait);
  }
}
