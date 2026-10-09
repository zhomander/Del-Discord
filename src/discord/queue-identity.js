import { createAsyncCache } from '../utils/async-cache.js';
import { API } from '../config.js';
import { apiFetch } from './api.js';
import { userIconUrl, guildIconUrl, displayName, users } from './users.js';

export const cleanQueueLabel = label => String(label || '').replace(/^Discord\s*[|—–-]\s*/i, '').replace(/\s*\|\s*Discord.*$/i, '').trim();

export function createQueueIdentityResolver() {
  const cache = createAsyncCache({ limit: 32 });
  const read = (kind, id, token, log) => cache.get(`${token}/${kind}/${id}`, async () => {
    const response = await apiFetch(`${API}/${kind}/${id}`, { headers: { Authorization: token } }, log);
    if (!response.ok) throw new Error(`Could not access ${kind === 'guilds' ? 'server' : 'conversation'} (${response.status}).`);
    const data = await response.json();
    if (data.id !== id) throw new Error('Discord returned invalid identity metadata.');
    return data;
  });
  const resolve = async (item, token, log = () => {}) => {
    const result = { ...item, label: cleanQueueLabel(item.label) };
    if (!token || item.kind === 'ids') return result;
    try {
      const server = item.guildId !== '@me';
      const data = await read(server ? 'guilds' : 'channels', server ? item.guildId : item.channelId, token, log);
      if (server) {
        result.icon = guildIconUrl(data);
        if (item.kind === 'server') result.label = data.name || result.label;
        result.iconName = data.name || result.label;
      } else {
        let recipient = data.recipients?.[0];
        if (!recipient && data.recipient_ids?.[0]) recipient = users?.getUser?.(data.recipient_ids[0]);
        if (recipient?.id) {
          result.label = displayName(recipient) || result.label;
          result.icon = userIconUrl(recipient);
          result.iconName = result.label;
        }
      }
    } catch { /* Identity decoration must not prevent adding an accessible job. */ }
    return result;
  };
  return { resolve, readGuild: (id, token, log = () => {}) => read('guilds', id, token, log) };
}
