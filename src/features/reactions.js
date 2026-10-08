// Del-Discord v1 — personal source modules.
import { runState } from '../utils/run-state.js';
import { toSnowflake } from '../utils/messages.js';
import { API } from '../config.js';
import { apiFetch, RunStoppedError } from '../discord/api.js';
import { invalidateAuth } from '../discord/deleter-auth.js';
import { rand, sleep } from '../utils/timing.js';
import { askPopup } from '../ui/confirm.js';
import { parseReactionIds, matchesReaction } from './reaction-filter.js';

export function emojiParam(emoji) {
  return encodeURIComponent(emoji?.id ? `${emoji.name || '_'}:${emoji.id}` : (emoji?.name || ''));
}

export async function removeReactions(opts) {
  const { token, channelId, startId, scanLimit, skipOwn, authorId, log, progress = () => {} } = opts;
  const reactionIds = parseReactionIds(opts.reactionIds);
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

      let oldest = BigInt(batch[0].id);
      for (const message of batch) {
        const id = BigInt(message.id);
        if (id < oldest) oldest = id;
        scanned++;
        if (skipOwn && message.author?.id === authorId) continue;
        for (const reaction of message.reactions || []) {
          if ((reaction.me || reaction.me_burst) && matchesReaction(reaction.emoji, reactionIds)) {
            targets.push({ messageId: message.id, emoji: reaction.emoji, timestamp: message.timestamp });
          }
        }
        if (scanned >= scanLimit) break;
      }
      before = oldest.toString();
      progress(scanned, scanLimit, 'Scanning');
      await sleep(rand(1700, 2600));
    }

    if (runState.reactionStopped) return log('warn', 'Reaction scan stopped.');
    if (!targets.length) return log('success', `Scanned ${scanned} messages; no reactions of yours were found.`);
    const approved = await askPopup({
      title: 'Remove reactions?',
      message: `Remove ${targets.length} of your reactions found in ${scanned} scanned messages?${reactionIds.size ? `\nEmoji IDs: ${[...reactionIds].join(', ')}` : ''}`,
      yesText: 'Remove',
      noText: 'Cancel',
      danger: true
    });
    if (!approved) return log('warn', 'Cancelled.');

    let removed = 0, failed = 0;
    for (const target of targets) {
      if (runState.reactionStopped) break;
      const response = await apiFetch(`${API}/channels/${channelId}/messages/${target.messageId}/reactions/${emojiParam(target.emoji)}/@me`, {
        method: 'DELETE', headers: { Authorization: token }
      }, log, stopCheck);
      if (response.ok || response.status === 204 || response.status === 404) removed++;
      else if (response.status === 401) {
        invalidateAuth();
        log('error', '401 Unauthorized while removing reactions.');
        break;
      }
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
