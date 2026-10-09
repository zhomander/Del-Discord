import { RunStoppedError } from '../discord/api.js';
import { createMessageReader } from '../discord/message-reader.js';
import { invalidateAuth } from '../discord/deleter-auth.js';
import { rand, sleep } from '../utils/timing.js';
import { normalizeCleanupOptions, matchesMessage, sortMessages } from './message-filters.js';
import { uniqueTargets } from './message-ids.js';
import { emptyStats, statsText, confirmMessages, applyMessageAction } from './message-actions.js';
import { createMessageCollection } from './message-collection.js';

function actionSnapshot(message, action) {
  const snapshot = { id: message.id, channel_id: message.channel_id };
  if (action !== 'delete') snapshot.content = message.content;
  if (action === 'preserve') {
    // Preservation only reads attachment presence and embed URLs; release
    // thumbnails, metadata and the other nested response objects after checks.
    if (message.attachments?.length) snapshot.attachments = [{}];
    snapshot.embeds = (message.embeds || []).map(embed => ({ url: embed.url, ...(embed.image?.url ? { image: { url: embed.image.url } } : {}) }));
  }
  return snapshot;
}

export async function runDirectMessages(opts) {
  const options = normalizeCleanupOptions(opts);
  const { token, authorId, log, progress = () => {}, stopCheck = () => false } = options;
  const targets = uniqueTargets(opts.targets || []);
  if (!targets.length) throw new Error('Paste or import at least one message ID.');
  const stats = emptyStats();
  const collected = createMessageCollection(options.order, message => actionSnapshot(message, options.action));
  const readMessage = createMessageReader(token, log, stopCheck);
  const ordered = sortMessages(targets.map(target => ({ ...target, id: target.messageId })), options.order);
  try {
    for (const [index, target] of ordered.entries()) {
      if (stopCheck()) break;
      const response = await readMessage(target.channelId, target.messageId);
      if (stopCheck()) break;
      if (response.status === 401) {
        invalidateAuth(); log('error', '401 Unauthorized while checking IDs.');
        return { unauthorized: true, ...stats };
      }
      if (response.status === 404) stats.alreadyGone++;
      else if (response.status === 403) { stats.failed++; log('error', 'Discord denied access to message history. Stopping before changes.'); return { forbidden: true, ...stats }; }
      else if (!response.ok) { stats.failed++; log('error', `Could not check message ${target.messageId} (${response.status}).`); }
      else {
        const message = await response.json();
        if (message.id === target.messageId && message.channel_id === target.channelId &&
            matchesMessage(message, { ...options, authorId, channelId: target.channelId })) collected.add([message]);
        else stats.skipped++;
      }
      progress(index + 1, targets.length, 'Checking IDs');
      if (!stopCheck() && index < ordered.length - 1) await sleep(rand(350, 600));
    }
    if (stopCheck()) { log('warn', `Stopped. ${statsText(stats)}`); return { stopped: true, ...stats }; }
    const matching = collected.finish();
    if (!matching.length) { log('success', `No matching messages of yours. ${statsText(stats)}`); return { done: true, ...stats }; }
    if (!options.skipConfirm && !await confirmMessages(matching, options)) return { cancelled: true, ...stats };
    for (const [index, message] of matching.entries()) {
      if (stopCheck()) break;
      if (!await applyMessageAction(message, { ...options, stopCheck }, stats)) {
        if (!stopCheck()) return { unauthorized: true, ...stats };
        break;
      }
      progress(index + 1, matching.length, options.action === 'delete' ? 'Deleting' : 'Editing text');
    }
  } catch (error) {
    if (!(error instanceof RunStoppedError)) throw error;
  }
  log(stopCheck() ? 'warn' : 'success', `${stopCheck() ? 'Stopped' : 'Finished'}. ${statsText(stats)}`);
  return { ...(stopCheck() ? { stopped: true } : { done: true }), ...stats };
}
