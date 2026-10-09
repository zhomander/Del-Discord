import { API } from '../config.js';
import { apiFetch, RunStoppedError } from '../discord/api.js';
import { invalidateAuth } from '../discord/deleter-auth.js';
import { compareMessageIds, matchesMessage } from './message-filters.js';
import { rand, sleep } from '../utils/timing.js';

// Search indexing can lag behind messages sent since the previous cleanup.
// Read history above each channel's newest search hit with fresh run-local cursors.
export async function collectFreshMessages(options, newest, collected, stats, scanned = 0) {
  const { token, guildId, channelId, log, stopCheck, progress = () => {} } = options;
  const inaccessible = Symbol('inaccessible');
  const read = async (url, skipForbidden = false) => {
    const response = await apiFetch(url, { headers: { Authorization: token }, cache: 'no-store' }, log, stopCheck);
    if (stopCheck()) throw new RunStoppedError();
    if (response.status === 403 && skipForbidden) {
      log('warn', 'Skipping a server channel whose message history Discord denied access to.');
      return inaccessible;
    }
    if (response.status === 401) invalidateAuth();
    if (!response.ok) throw new Error(`Fresh message scan failed (${response.status}). Check your access and try again.`);
    return response.json();
  };
  let channels = [{ id: channelId }];
  if (channelId && guildId !== '@me') {
    const channel = await read(`${API}/channels/${channelId}`);
    if (channel.id !== channelId || channel.guild_id !== guildId) throw new Error('Discord returned a channel outside the selected server.');
    if (channel.nsfw && !options.includeNsfw) {
      log('info', 'Fresh history skipped for this NSFW channel. Enable Include NSFW to scan it.');
      return;
    }
  }
  if (!channelId) {
    const list = await read(`${API}/guilds/${guildId}/channels`);
    if (!Array.isArray(list)) throw new Error('Discord returned an invalid channel list.');
    if (list.some(channel => channel.guild_id && channel.guild_id !== guildId)) throw new Error('Discord returned channels for another server.');
    channels = list.filter(channel => [0, 5].includes(channel.type) && (options.includeNsfw || !channel.nsfw));
    const active = await read(`${API}/guilds/${guildId}/threads/active`);
    if (!Array.isArray(active.threads)) throw new Error('Discord returned an invalid active thread list.');
    const parents = new Map(list.map(channel => [channel.id, channel]));
    channels.push(...active.threads.filter(thread => {
      const parent = parents.get(thread.parent_id);
      return parent && [10, 11, 12].includes(thread.type) && (!thread.guild_id || thread.guild_id === guildId) && (options.includeNsfw || !parent.nsfw);
    }));
  }
  log('info', 'Checking fresh channel history for messages that Discord search may not have indexed yet…');
  for (const channel of channels) {
    if (!/^\d{15,22}$/.test(String(channel.id || ''))) throw new Error('Discord returned an invalid channel ID.');
    const indexed = newest.get(channel.id);
    const lower = indexed && (!options.minId || compareMessageIds(indexed, options.minId) > 0) ? indexed : options.minId;
    let before = options.maxId;
    while (!stopCheck()) {
      if (before && lower && compareMessageIds(before, lower) <= 0) break;
      const query = new URLSearchParams({ limit: '100' });
      if (before) query.set('before', before);
      const batch = await read(`${API}/channels/${channel.id}/messages?${query}`, !channelId);
      if (batch === inaccessible) break;
      if (!Array.isArray(batch)) throw new Error('Discord returned invalid message history. No further messages changed.');
      if (!batch.length) break;
      if (batch.some(message => !/^\d+$/.test(String(message?.id || '')) || message.channel_id !== channel.id)) {
        throw new Error('Discord returned invalid history messages. No further messages changed.');
      }
      const oldest = batch.reduce((id, message) => compareMessageIds(message.id, id) < 0 ? message.id : id, batch[0].id);
      if (before && compareMessageIds(oldest, before) >= 0) throw new Error('Fresh message history did not advance. Try again.');
      const seen = new Set(), matching = [];
      for (const message of batch) {
        if (seen.has(message.id) || (before && compareMessageIds(message.id, before) >= 0) || (lower && compareMessageIds(message.id, lower) <= 0)) continue;
        seen.add(message.id);
        scanned++;
        if (matchesMessage(message, options)) matching.push(message);
        else stats.skipped++;
      }
      collected.add(matching);
      progress(scanned, scanned, 'Scanning');
      log('verb', `Scanned ${scanned}; collected ${collected.length} fresh and indexed matches.`);
      if (lower && compareMessageIds(oldest, lower) <= 0) break;
      before = oldest;
      if (!stopCheck()) await sleep(rand(900, 1500));
    }
    if (stopCheck()) throw new RunStoppedError();
  }
}
