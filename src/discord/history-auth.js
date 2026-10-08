// Del-Discord v1 — personal source modules.
import { API, AUTH_CACHE_TTL } from '../config.js';
import { tokenCandidates } from './token.js';
import { apiFetch } from './history-api.js';

export let authCache = null;

export function invalidateAuth() {
  authCache = null;
}

export async function identity() {
  const now = Date.now();
  if (authCache && now - authCache.at < AUTH_CACHE_TTL) return authCache.identity;

  for (const token of tokenCandidates()) {
    try {
      const r = await apiFetch(`${API}/users/@me`, { headers: { Authorization: token } });
      if (r.ok) {
        const identity = { token, user: await r.json() };
        authCache = { at: now, identity };
        return identity;
      }
    } catch {}
  }

  invalidateAuth();
  return null;
}
