// Del-Discord v1 — personal source modules.
import { siteStorage } from '../utils/storage.js';

export function affinityEntries() {
  try {
    const raw = siteStorage().getItem('UserAffinitiesStoreV2');
    const arr = JSON.parse(raw || '{}')?._state?.userAffinities;
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch { return []; }
}

export function getUserStore() {
  try {
    let found = null;
    window.webpackChunkdiscord_app?.push?.([[Math.random()], {}, req => {
      for (const key in req.c) {
        try {
          const exp = req.c[key]?.exports;
          const cands = [exp, exp?.default];
          if (exp && typeof exp === 'object') cands.push(...Object.values(exp));
          for (const c of cands) {
            if (c && typeof c.getUser === 'function' && typeof c.getUsers === 'function') { found = c; return; }
          }
        } catch {}
      }
    }]);
    return found;
  } catch { return null; }
}

export const users = getUserStore();

export const avatarUrl = u => u?.id && u?.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${String(u.avatar).startsWith('a_') ? 'gif' : 'png'}?size=64` : '';

export const userIconUrl = user => avatarUrl(user) || (/^\d+$/.test(user?.id || '') ? `https://cdn.discordapp.com/embed/avatars/${user.discriminator && user.discriminator !== '0' ? Number(user.discriminator) % 5 : Number((BigInt(user.id) >> 22n) % 6n)}.png` : '');
export const guildIconUrl = guild => guild?.id && guild?.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${String(guild.icon).startsWith('a_') ? 'gif' : 'png'}?size=64` : '';

export const displayName = u => u?.global_name || u?.globalName || u?.username || '';

export const usernameOf = u => !u?.username ? '' : (u.discriminator && u.discriminator !== '0' ? `${u.username}#${u.discriminator}` : `@${u.username}`);
