import { API } from '../config.js';
import { apiFetch } from '../discord/api.js';
import { users, avatarUrl, displayName } from '../discord/users.js';

export function installIdentityPreviews($) {
  const cache = new Map();
  const versions = { user: 0, guild: 0 };
  const timers = {};
  const show = (kind, value, data) => {
    const badge = $(`#dmd-${kind}-avatar`);
    badge.textContent = ''; badge.hidden = false;
    const name = kind === 'user' ? displayName(data) : data.name;
    const hash = kind === 'user' ? data.avatar : data.icon;
    const url = kind === 'user' ? avatarUrl(data) || `https://cdn.discordapp.com/embed/avatars/${data.discriminator && data.discriminator !== '0' ? Number(data.discriminator) % 5 : Number((BigInt(value) >> 22n) % 6n)}.png` : hash ? `https://cdn.discordapp.com/icons/${value}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=64` : '';
    badge.title = name || value;
    badge.setAttribute('aria-label', name || value);
    badge.textContent = (name || '?').slice(0, 1).toUpperCase();
    if (url) {
      const image = document.createElement('img'); image.src = url; image.alt = name || (kind === 'user' ? 'User avatar' : 'Server icon');
      image.onerror = () => image.remove(); badge.appendChild(image);
    }
  };
  const refresh = async kind => {
    const input = $(kind === 'user' ? '#dmd-author' : '#dmd-guild');
    const value = input.value.split(',')[0].trim(), version = ++versions[kind];
    const badge = $(`#dmd-${kind}-avatar`); badge.hidden = true; badge.textContent = '';
    if (kind === 'guild' && value === '@me') { badge.hidden = false; badge.textContent = '@'; badge.title = 'Direct messages'; badge.setAttribute('aria-label', 'Direct messages'); return; }
    if (!/^\d{15,22}$/.test(value)) return;
    let data = cache.get(`${kind}:${value}`);
    if (!data && kind === 'user') { try { data = users?.getUser?.(value); } catch {} }
    if (!data) {
      const token = $('#dmd-token').value.trim();
      if (!token) return;
      try {
        const response = await apiFetch(`${API}/${kind === 'user' ? 'users' : 'guilds'}/${value}`, { headers: { Authorization: token } }, () => {}, () => versions[kind] !== version);
        if (!response.ok) return;
        data = await response.json();
      } catch { return; }
    }
    if (data?.id !== value || versions[kind] !== version || input.value.split(',')[0].trim() !== value) return;
    cache.set(`${kind}:${value}`, data); show(kind, value, data);
  };
  for (const kind of ['user', 'guild']) {
    const input = $(kind === 'user' ? '#dmd-author' : '#dmd-guild');
    input.addEventListener('input', () => { ++versions[kind]; $(`#dmd-${kind}-avatar`).hidden = true; clearTimeout(timers[kind]); timers[kind] = setTimeout(() => void refresh(kind), 400); });
    input.addEventListener('change', () => { clearTimeout(timers[kind]); void refresh(kind); });
  }
  $('#dmd-token').addEventListener('change', () => { void refresh('user'); void refresh('guild'); });
  return { refresh, seedUser: user => { if (user?.id) cache.set(`user:${user.id}`, user); } };
}
