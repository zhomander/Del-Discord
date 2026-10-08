// Del-Discord v1 — personal source modules.

export function toSnowflake(value) {
  if (!value) return '';
  if (/^\d+$/.test(value)) return value;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return '';
  return (BigInt(ms - 1420070400000) << 22n).toString();
}

export function parseMessageReference(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d{15,22}$/.test(text)) return { messageId: text, guildId: '', channelId: '' };

  const match = text.match(/(?:https?:\/\/)?(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/([^/\s]+)\/(\d+)\/(\d+)/i);
  if (match) return { guildId: match[1], channelId: match[2], messageId: match[3] };

  return null;
}

export function currentContext() {
  const m = location.pathname.match(/^\/channels\/([\w@]+)\/(\d+)/);
  return m ? { guildId: m[1], channelId: m[2] } : null;
}

export function currentLabel() {
  const title = String(document.title || '')
    .replace(/\s*\|\s*Discord.*$/i, '')
    .trim();
  const ctx = currentContext();
  if (!title || /^discord$/i.test(title)) {
    return ctx ? (ctx.guildId === '@me' ? `DM ${ctx.channelId}` : `Channel ${ctx.channelId}`) : 'Unknown';
  }
  return title;
}

export function qs(entries) {
  return entries
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}
