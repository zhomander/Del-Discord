// For display metadata only. Cleanup ownership and permissions are rechecked
// separately; they must not rely on a cached result.
export function createAsyncCache({ ttl = 60_000, limit = 16 } = {}) {
  const entries = new Map();
  const peek = key => {
    const entry = entries.get(key);
    if (entry && !entry.pending && Date.now() - entry.time >= ttl) { entries.delete(key); return; }
    return entry;
  };
  const get = (key, loader) => {
    const existing = peek(key);
    if (existing) { entries.delete(key); entries.set(key, existing); return existing.promise; }
    const entry = { pending: true, time: Date.now() };
    entry.promise = Promise.resolve().then(loader).then(value => {
      entry.pending = false; entry.time = Date.now(); return value;
    }, error => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entries.set(key, entry);
    while (entries.size > limit) entries.delete(entries.keys().next().value);
    return entry.promise;
  };
  return { get, peek };
}
