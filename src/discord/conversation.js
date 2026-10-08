import { API } from '../config.js';
import { apiFetch, RunStoppedError } from './api.js';

// Resolve the actual channel type before choosing a cleanup method.
export async function resolveConversation({ token, channelId, log, stopCheck = () => false }) {
  if (!/^\d{15,22}$/.test(channelId)) throw new Error('Enter a valid conversation ID.');
  const response = await apiFetch(`${API}/channels/${channelId}`, { headers: { Authorization: token } }, log, stopCheck);
  if (stopCheck()) throw new RunStoppedError();
  if (!response.ok) throw new Error(`Could not detect conversation type (${response.status}). Check your access.`);
  const channel = await response.json();
  if (channel.id !== channelId) throw new Error('Discord returned an invalid conversation.');
  const mode = [1, 3].includes(channel.type) ? 'dm' : [0, 5].includes(channel.type) ? 'channel' : [15, 16].includes(channel.type) ? 'forums' : [10, 11, 12].includes(channel.type) ? 'thread' : null;
  if (!mode) throw new Error('This conversation type does not support message cleanup.');
  let guildId = mode === 'dm' ? '@me' : channel.guild_id;
  if (!guildId && mode === 'thread' && channel.parent_id) {
    const parent = await apiFetch(`${API}/channels/${channel.parent_id}`, { headers: { Authorization: token } }, log, stopCheck);
    if (stopCheck()) throw new RunStoppedError();
    if (!parent.ok) throw new Error(`Could not resolve thread server (${parent.status}).`);
    const data = await parent.json();
    if (data.id !== channel.parent_id) throw new Error('Discord returned an invalid thread parent.');
    guildId = data.guild_id;
  }
  if (mode !== 'dm' && !/^\d{15,22}$/.test(guildId || '')) throw new Error('Discord did not provide a valid server ID.');
  return { mode, guildId, channelId, name: channel.name || channelId };
}
