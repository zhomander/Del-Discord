import { createMessageCollection } from './message-collection.js';
import { runState } from '../utils/run-state.js';
import { currentLabel, qs } from '../utils/messages.js';
import { API } from '../config.js';
import { apiFetch, RunStoppedError } from '../discord/api.js';
import { rand, retryMs, sleep } from '../utils/timing.js';
import { invalidateAuth } from '../discord/deleter-auth.js';
import { normalizeCleanupOptions, matchesMessage, sortMessages } from './message-filters.js';
import { emptyStats, statsText, confirmMessages, applyMessageAction } from './message-actions.js';
import { runCollectedMessages } from './collected-messages.js';

export async function deleteMessages(opts) {
  const stats = emptyStats();
  const stopCheck = opts.stopCheck || (() => runState.stopped);
  const options = normalizeCleanupOptions({ ...opts, stopCheck });
  const { token, authorId, guildId, channelId, content, includeNsfw, skipConfirm = false, log, progress = () => {} } = options;
  let pageMinId = options.minId;
  let pageMaxId = options.maxId;
  let approved = skipConfirm;
  let total = null;
  let processed = 0;
  const seen = new Set();
  const collected = createMessageCollection(options.order);
  log('success', `Started ${options.action} · ${options.order === 'asc' ? 'oldest first' : 'newest first'} · ${currentLabel()} (${guildId}/${channelId})`);

  try {
    while (!stopCheck()) {
      const base = guildId === '@me' ? `${API}/channels/${channelId}/messages/search` : `${API}/guilds/${guildId}/messages/search`;
      const query = qs([
        ['author_id', authorId], ['channel_id', guildId !== '@me' ? channelId : undefined],
        ['min_id', pageMinId], ['max_id', pageMaxId], ['sort_by', 'timestamp'], ['sort_order', options.order], ['offset', 0],
        ['has', options.linkMode === 'with' ? 'link' : undefined], ['has', options.fileMode === 'with' ? 'file' : undefined],
        ['content', options.textMode === 'include' ? content : undefined], ['include_nsfw', includeNsfw ? 'true' : undefined],
      ]);
      const search = await apiFetch(`${base}?${query}`, { headers: { Authorization: token } }, log, stopCheck);
      if (stopCheck()) break;
      if (search.status === 202) {
        let body = {}; try { body = await search.json(); } catch {}
        await sleep(retryMs(body.retry_after || 2));
        continue;
      }
      if (search.status === 401) {
        invalidateAuth(); log('error', '401 Unauthorized. Press GET next to Authorization and try again.');
        return { unauthorized: true, ...stats };
      }
      if (!search.ok) {
        log('error', `Search failed with HTTP ${search.status}.`);
        return { httpStatus: search.status, forbidden: search.status === 403, ...stats };
      }
      const data = await search.json();
      const groups = Array.isArray(data.messages) ? data.messages : [];
      const hits = groups.map(group => Array.isArray(group) ? (group.find(message => message?.hit) || group[0]) : null)
        .filter(message => message && /^\d+$/.test(String(message.id || '')));
      total ??= Number(data.total_results || hits.length);
      if (!hits.length) {
        if (options.collectAll) return await runCollectedMessages(collected.finish(), options, stats);
        log('success', `Finished. ${statsText(stats)}`);
        return { done: true, ...stats };
      }
      const sorted = sortMessages(hits, options.order);
      const edge = sorted.at(-1).id;
      const cursor = options.order === 'asc' ? pageMinId : pageMaxId;
      if (cursor && (options.order === 'asc' ? BigInt(edge) <= BigInt(cursor) : BigInt(edge) >= BigInt(cursor))) {
        log('error', 'Discord returned a page that did not advance. Stopping to avoid repeating messages.');
        return { stalled: true, ...stats };
      }
      if (options.order === 'asc') pageMinId = edge;
      else pageMaxId = edge;
      const candidates = sorted.filter(message => !seen.has(message.id));
      const matching = candidates.filter(message => matchesMessage(message, options));
      for (const message of candidates) seen.add(message.id);
      stats.skipped += candidates.length - matching.length;
      processed += candidates.length - matching.length;
      if (options.collectAll) {
        collected.add(matching);
        progress(seen.size, Math.max(total, seen.size), 'Scanning');
        log('verb', `Scanned ${seen.size}; collected ${collected.length} matches. No messages changed.`);
        if (!stopCheck()) await sleep(rand(900, 1500));
        continue;
      }
      if (!approved && matching.length) {
        approved = await confirmMessages(matching, options, total);
        if (!approved) { log('warn', 'Cancelled.'); return { cancelled: true, ...stats }; }
      }
      for (const message of matching) {
        if (stopCheck()) break;
        if (!await applyMessageAction(message, options, stats)) {
          if (!stopCheck()) return { unauthorized: true, ...stats };
          break;
        }
        processed++;
        progress(processed, Math.max(total, processed), options.action);
      }
      if (!stopCheck()) await sleep(rand(900, 1500));
    }
  } catch (error) {
    if (!(error instanceof RunStoppedError)) throw error;
  }
  log('warn', `Stopped. ${statsText(stats)}`);
  return { stopped: true, ...stats };
}
