// Del-Discord v1 — personal source modules.
import { siteStorage } from '../utils/storage.js';

export let tokenGettersCache = null;

export function tokenGetters(forceRefresh = false) {
  if (tokenGettersCache && !forceRefresh) return tokenGettersCache;

  const getters = [];
  const seen = new Set();

  try {
    const chunks = window.webpackChunkdiscord_app;
    if (chunks?.push) {
      const modules = [];
      chunks.push([[Math.random()], {}, req => {
        for (const k in req.c) modules.push(req.c[k]);
      }]);

      for (const mod of modules) {
        try {
          const exp = mod?.exports;
          const candidates = [exp, exp?.default];
          if (exp && typeof exp === 'object') candidates.push(...Object.values(exp));

          for (const candidate of candidates) {
            const getter = candidate?.getToken;
            if (typeof getter === 'function' && !seen.has(getter)) {
              seen.add(getter);
              getters.push(() => getter.call(candidate));
            }
          }
        } catch {}
      }
    }
  } catch {}

  tokenGettersCache = getters;
  return getters;
}

export function tokenCandidates() {
  const out = [];
  const seen = new Set();
  const add = token => {
    if (typeof token === 'string' && token.length > 20 && !seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  };

  try {
    const storage = siteStorage();
    if (storage.token) add(JSON.parse(storage.token));
  } catch {}

  let getters = tokenGetters();
  for (const getter of getters) {
    try { add(getter()); } catch {}
  }

  if (!out.length && getters.length) {
    getters = tokenGetters(true);
    for (const getter of getters) {
      try { add(getter()); } catch {}
    }
  }

  return out;
}
