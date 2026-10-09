import { createMessageReader } from '../discord/message-reader.js';
import { invalidateAuth } from '../discord/deleter-auth.js';
import { matchesMessage, sortMessages } from './message-filters.js';
import { confirmMessages, applyMessageAction, statsText } from './message-actions.js';

// No changes occur until the entire scan succeeds and the final preview is approved.
export async function runCollectedMessages(messages, options, stats) {
  const { token, log, stopCheck = () => false, progress = () => {} } = options;
  if (stopCheck()) return { stopped: true, ...stats };
  const ordered = sortMessages(messages, options.order);
  log('success', `Scan complete: ${ordered.length} matching messages collected. No messages changed during scanning.`);
  if (!ordered.length) {
    log('info', 'No messages matched the selected author, channels, dates and filters. Start again to scan for new messages.');
    return { done: true, ...stats };
  }
  if (!options.skipConfirm && !await confirmMessages(ordered, options, ordered.length)) return { cancelled: true, ...stats };
  const readMessage = createMessageReader(token, log, stopCheck);
  for (const [index, snapshot] of ordered.entries()) {
    if (stopCheck()) return { stopped: true, ...stats };
    const response = await readMessage(snapshot.channel_id, snapshot.id);
    if (stopCheck()) return { stopped: true, ...stats };
    if (response.status === 401) { invalidateAuth(); return { unauthorized: true, ...stats }; }
    if (response.status === 403) { stats.failed++; log('error', 'Discord denied access to message history. Stopping; no further messages will be changed.'); return { forbidden: true, ...stats }; }
    if (response.status === 404) stats.alreadyGone++;
    else if (!response.ok) { stats.failed++; log('error', `Could not recheck message ${snapshot.id} (${response.status}).`); }
    else {
      const message = await response.json();
      if (message.id !== snapshot.id || message.channel_id !== snapshot.channel_id || !matchesMessage(message, options)) stats.skipped++;
      else if (!await applyMessageAction(message, options, stats)) return { ...(stopCheck() ? { stopped: true } : { unauthorized: true }), ...stats };
    }
    progress(index + 1, ordered.length, options.action);
  }
  log(stopCheck() ? 'warn' : 'success', `${stopCheck() ? 'Stopped' : 'Finished'}. ${statsText(stats)}`);
  return { ...(stopCheck() ? { stopped: true } : { done: true }), ...stats };
}
