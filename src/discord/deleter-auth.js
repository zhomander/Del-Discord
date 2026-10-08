// Del-Discord v1 — personal source modules.
import { API, AUTH_CACHE_TTL } from '../config.js';
import { tokenCandidates } from './token.js';

export let authCache = null;

export async function validateToken(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${API}/users/@me`, { headers: { Authorization: token } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export function invalidateAuth() {
  authCache = null;
}

export async function resolveToken(preferred = '') {
  const now = Date.now();
  if (
    authCache &&
    now - authCache.at < AUTH_CACHE_TTL &&
    (!preferred || preferred === authCache.token)
  ) {
    return authCache.identity;
  }

  const candidates = [];
  const seen = new Set();
  const add = token => {
    if (token && !seen.has(token)) {
      seen.add(token);
      candidates.push(token);
    }
  };

  add(preferred);
  for (const token of tokenCandidates()) add(token);

  for (const token of candidates) {
    const user = await validateToken(token);
    if (user?.id) {
      const identity = { token, user };
      authCache = { at: now, token, identity };
      return identity;
    }
  }

  invalidateAuth();
  return null;
}
