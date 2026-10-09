import { API } from '../config.js';
import { apiFetch } from '../discord/api.js';
import { users, userIconUrl, guildIconUrl, displayName } from '../discord/users.js';

// Each preview instance shares completed metadata already; share in-flight
// requests too, without retaining a panel's cache after it is discarded.
const pendingByCache = new WeakMap();

export function installIdentityPreviews($, { author = '#dmd-author', guild = '#dmd-guild', userBadge = '#dmd-user-avatar', guildBadge = '#dmd-guild-avatar', cache = new Map() } = {}) {
  const pending = pendingByCache.get(cache) || new Map(); pendingByCache.set(cache, pending);
  const remember = (key, value) => { cache.delete(key); cache.set(key, value); while (cache.size > 128) cache.delete(cache.keys().next().value); };
  const inputs = { user: author ? $(author) : null, guild: guild ? $(guild) : null };
  const badges = { user: userBadge ? $(userBadge) : null, guild: guildBadge ? $(guildBadge) : null };
  const tokenInput = $('#dmd-token');
  const badgeFor = kind => badges[kind];
  const versions = { user: 0, guild: 0 };
  const timers = {};
  const show = (kind, value, data) => {
    const badge = badgeFor(kind);
    badge.textContent = ''; badge.hidden = false;
    const name = kind === 'user' ? displayName(data) : data.name;
    const url = kind === 'user' ? userIconUrl(data) : guildIconUrl(data);
    badge.title = name || value;
    badge.setAttribute('aria-label', name || value);
    badge.textContent = (name || '?').slice(0, 1).toUpperCase();
    if (url) {
      const image = document.createElement('img'); image.src = url; image.alt = name || (kind === 'user' ? 'User avatar' : 'Server icon');
      image.onerror = () => image.remove(); badge.appendChild(image);
    }
  };
  const refresh = async kind => {
    const input = inputs[kind];
    if (!input) return;
    const value = input.value.split(',')[0].trim(), version = ++versions[kind];
    const badge = badgeFor(kind); badge.hidden = true; badge.textContent = '';
    if (kind === 'guild' && value === '@me') { badge.hidden = false; badge.textContent = '@'; badge.title = 'Direct messages'; badge.setAttribute('aria-label', 'Direct messages'); return; }
    if (!/^\d{15,22}$/.test(value)) return;
    let data = cache.get(`${kind}:${value}`);
    if (!data && kind === 'user') { try { data = users?.getUser?.(value); } catch {} }
    if (!data) {
      const token = tokenInput.value.trim();
      if (!token) return;
      const key = `${token}/${kind}:${value}`;
      const isCurrent = () => versions[kind] === version && input.value.split(',')[0].trim() === value && tokenInput.value.trim() === token;
      let request = pending.get(key);
      if (!request) {
        request = { readers: new Set() };
        request.promise = Promise.resolve().then(async () => {
          const stopped = () => { for (const reader of request.readers) if (reader()) return false; return true; };
          const response = await apiFetch(`${API}/${kind === 'user' ? 'users' : 'guilds'}/${value}`, { headers: { Authorization: token } }, () => {}, stopped);
          return response.ok ? response.json() : null;
        }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
        pending.set(key, request);
      }
      request.readers.add(isCurrent);
      try {
        data = await request.promise;
      } catch { return; }
      finally { request.readers.delete(isCurrent); }
    }
    if (data?.id !== value || versions[kind] !== version || input.value.split(',')[0].trim() !== value) return;
    remember(`${kind}:${value}`, data); show(kind, value, data);
  };
  for (const kind of ['user', 'guild']) {
    const input = inputs[kind];
    if (!input) continue;
    input.addEventListener('input', () => { ++versions[kind]; badgeFor(kind).hidden = true; clearTimeout(timers[kind]); timers[kind] = setTimeout(() => void refresh(kind), 400); });
    input.addEventListener('change', () => { clearTimeout(timers[kind]); void refresh(kind); });
  }
  tokenInput.addEventListener('change', () => { void refresh('user'); void refresh('guild'); });
  return { refresh, seedGuild: server => { if (server?.id) remember(`guild:${server.id}`, server); }, seedUser: user => { if (user?.id) remember(`user:${user.id}`, user); } };
}
