export const CACHE_LIFETIME = 3 * 24 * 60 * 60 * 1000;

export function createExpiringStorage(key, storage, now = () => Date.now()) {
  const getStorage = () => { try { return storage || globalThis.localStorage; } catch { return null; } };
  const stampKey = `${key}_created_at`;
  const read = () => {
    const storage = getStorage();
    if (!storage) return null;
    const value = storage.getItem(key);
    if (value === null) return null;
    const stamp = Number(storage.getItem(stampKey));
    if (!stamp) { storage.setItem(stampKey, String(now())); return value; }
    if (now() - stamp >= CACHE_LIFETIME || stamp > now()) { clear(); return null; }
    return value;
  };
  const clear = () => { const storage = getStorage(); if (!storage) return; storage.removeItem(key); storage.removeItem(stampKey); };
  const write = value => {
    const storage = getStorage();
    if (!storage) return false;
    const stamp = Number(storage.getItem(stampKey));
    if (!stamp || now() - stamp >= CACHE_LIFETIME || stamp > now()) storage.setItem(stampKey, String(now()));
    storage.setItem(key, value);
    return true;
  };
  return { read, write, clear };
}
