// Del-Discord v1 — personal source modules.
import { runState } from '../utils/run-state.js';
import { toSnowflake } from '../utils/messages.js';
import { API } from '../config.js';
import { apiFetch, RunStoppedError } from '../discord/api.js';
import { invalidateAuth } from '../discord/deleter-auth.js';
import { rand, sleep } from '../utils/timing.js';
import { askPopup } from '../ui/confirm.js';
import { parseReactionIds, matchesReaction } from './reaction-filter.js';
import { compareMessageIds } from './message-filters.js';

export function emojiParam(emoji) {
  return encodeURIComponent(emoji?.id ? `${emoji.name || '_'}:${emoji.id}` : (emoji?.name || ''));
}

export async function removeReactions(opts) {
  const { token, channelId, startId, scanLimit, skipOwn, authorId, log, progress = () => {} } = opts;
  const reactionIds = parseReactionIds(opts.reactionIds);
  const authors = opts.reactionAuthorId?.trim() ? [...new Set(opts.reactionAuthorId.split(/[\s,;]+/).filter(Boolean))] : [authorId];
  if (authors.some(id => id !== authorId && !/^\d{15,22}$/.test(id))) throw new Error('Author(s) must contain valid user IDs.');
  const ownReactions = authors.length === 1 && authors[0] === authorId;
  runState.reactionStopped = false;
  const stopCheck = () => runState.reactionStopped;
  try {
    let before = '';
    if (startId) {
      const id = toSnowflake(startId);
      if (!id) return log('error', 'Start message/date is invalid.');
      before = (BigInt(id) + 1n).toString();
    }

    const targets = [];
    const preview = [];
    let scanned = 0;

    while (scanned < scanLimit && !runState.reactionStopped) {
      const limit = Math.min(100, scanLimit - scanned);
      const url = `${API}/channels/${channelId}/messages?limit=${limit}${before ? `&before=${before}` : ''}`;
      const response = await apiFetch(url, { headers: { Authorization: token } }, log, stopCheck);
      if (stopCheck()) break;
      if (response.status === 401) {
        invalidateAuth();
        return log('error', '401 Unauthorized. Press GET next to Authorization.');
      }
      if (!response.ok) return log('error', `History request failed with HTTP ${response.status}.`);
      const batch = await response.json();
      if (!Array.isArray(batch) || !batch.length) break;
      if (batch.some(message => !/^\d+$/.test(String(message.id || '')))) throw new Error('Discord returned invalid reaction history IDs. No reactions changed.');
      const oldest = batch.reduce((value, message) => compareMessageIds(message.id, value) < 0 ? message.id : value, batch[0].id);
      if (before && compareMessageIds(oldest, before) >= 0) throw new Error('Reaction history did not advance. No reactions changed.');
      const pageSeen = new Set();
      for (const message of batch) {
        if (pageSeen.has(message.id) || (before && compareMessageIds(message.id, before) >= 0)) continue;
        pageSeen.add(message.id);
        scanned++;
        if (skipOwn && message.author?.id === authorId) continue;
        const targetSeen = new Set();
        for (const reaction of message.reactions || []) {
          if (!matchesReaction(reaction.emoji, reactionIds)) continue;
          const encodedEmoji = emojiParam(reaction.emoji);
          for (const reactionAuthorId of authors) {
            if (stopCheck()) break;
            const targetKey = `${encodedEmoji}/${reactionAuthorId}`;
            if (targetSeen.has(targetKey)) continue;
            const ownAuthor = reactionAuthorId === authorId;
            let matchesAuthor = !!(reaction.me || reaction.me_burst);
            if (!ownAuthor) {
              const users = await apiFetch(`${API}/channels/${channelId}/messages/${message.id}/reactions/${encodedEmoji}?limit=1&after=${BigInt(reactionAuthorId) - 1n}`, { headers: { Authorization: token } }, log, stopCheck);
              if (!users.ok) throw new Error(`Could not verify reaction authors (HTTP ${users.status}).`);
              const data = await users.json();
              matchesAuthor = Array.isArray(data) && data.some(user => user.id === reactionAuthorId);
              await sleep(rand(550, 900));
              if (stopCheck()) break;
            }
            if (matchesAuthor) {
              targetSeen.add(targetKey);
              if (preview.length < 20) preview.push(`${reactionAuthorId} · ${message.id} · ${reaction.emoji.name || 'emoji'}${reaction.emoji.id ? ` (${reaction.emoji.id})` : ''}\n${(message.content || '').slice(0, 500)}`);
              targets.push({ reactionAuthorId, messageId: message.id, encodedEmoji });
            }
          }
        }
        if (scanned >= scanLimit) break;
      }
      before = oldest;
      progress(scanned, scanLimit, 'Scanning');
      await sleep(rand(1700, 2600));
    }

    if (runState.reactionStopped) return log('warn', 'Reaction scan stopped.');
    if (!targets.length) return log('success', `Scanned ${scanned} messages; no reactions from the selected author were found.`);
    const approved = await askPopup({
      title: 'Remove reactions?',
      message: `Remove ${targets.length} ${ownReactions ? 'of your reactions' : `reactions from ${authors.join(', ')}`} found in ${scanned} scanned messages?${reactionIds.size ? `\nEmoji IDs: ${[...reactionIds].join(', ')}` : ''}`,
      details: preview.join('\n\n') + (targets.length > preview.length ? `\n\nShowing the first ${preview.length} of ${targets.length} reactions.` : ''),
      yesText: 'Remove',
      noText: 'Cancel',
      danger: true
    });
    if (!approved) return log('warn', 'Cancelled.');

    let removed = 0, failed = 0;
    for (const target of targets) {
      if (runState.reactionStopped) break;
      const response = await apiFetch(`${API}/channels/${channelId}/messages/${target.messageId}/reactions/${target.encodedEmoji}/${target.reactionAuthorId === authorId ? '@me' : target.reactionAuthorId}`, {
        method: 'DELETE', headers: { Authorization: token }
      }, log, stopCheck);
      if (response.ok || response.status === 204 || response.status === 404) removed++;
      else if (response.status === 401) {
        invalidateAuth();
        log('error', '401 Unauthorized while removing reactions.');
        break;
      }
      else if (response.status === 403) { log('error', 'Discord denied reaction removal. Removing another user’s reactions requires Manage Messages in this channel.'); break; }
      else failed++;
      progress(removed + failed, targets.length, 'Removing');
      await sleep(rand(900, 1500));
    }
    log(runState.reactionStopped ? 'warn' : 'success', `Reaction run ended. Removed ${removed}; failed ${failed}.`);
  } catch (error) {
    if (!(error instanceof RunStoppedError)) throw error;
    log('warn', 'Reaction run stopped.');
  }
}
