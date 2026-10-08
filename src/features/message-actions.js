import { API } from '../config.js';
import { apiFetch } from '../discord/api.js';
import { invalidateAuth } from '../discord/deleter-auth.js';
import { rand, sleep } from '../utils/timing.js';
import { askPopup } from '../ui/confirm.js';
import { preservedContent } from './preserve-media.js';

export const emptyStats = () => ({ deleted: 0, overwritten: 0, failed: 0, alreadyGone: 0, skipped: 0 });
export const statsText = stats => `Deleted ${stats.deleted}; overwritten ${stats.overwritten}; ${stats.alreadyGone} already gone; ${stats.skipped} skipped; ${stats.failed} failed.`;

export function confirmMessages(messages, options, total = messages.length) {
  const overwrite = options.action === 'overwrite';
  const preserve = options.action === 'preserve';
  const details = messages.slice(0, 20).map(message => `${message.id} · ${message.author?.username || 'you'}: ${String(message.content || '[NO TEXT]').slice(0, 180)}${preserve ? `\nKeep: ${preservedContent(message) ?? '[UNCHANGED: no media or links, or preserved text exceeds 2,000 characters]'}` : ''}`).join('\n');
  return askPopup({
    title: preserve ? 'Remove text and keep URLs/images?' : overwrite ? 'Overwrite message text?' : 'Delete messages?',
    message: preserve ? `Remove surrounding text from up to ${total} messages, keeping HTTP/HTTPS URLs and all attached files (including images)? Text-only messages are left unchanged. No messages are deleted.` : overwrite
      ? `Replace the text of up to ${total} messages with the text below. Messages and attached files remain.\n\nReplacement:\n${options.overwriteText}`
      : `Delete up to ${total} messages matching your filters?`,
    details, yesText: preserve ? 'Keep URLs/images' : overwrite ? 'Overwrite' : 'Delete', noText: 'Cancel', danger: true,
  });
}

export async function applyMessageAction(message, options, stats) {
  const { token, action, overwriteText, log, stopCheck = () => false } = options;
  if (stopCheck()) return false;
  const edit = action !== 'delete';
  const content = action === 'preserve' ? preservedContent(message) : overwriteText;
  if (edit && (content === null || String(message.content || '') === content)) {
    stats.skipped++;
    return true;
  }
  const overwrite = edit;
  const response = await apiFetch(`${API}/channels/${message.channel_id}/messages/${message.id}`, {
    method: overwrite ? 'PATCH' : 'DELETE',
    headers: { Authorization: token, ...(overwrite ? { 'Content-Type': 'application/json' } : {}) },
    ...(overwrite ? { body: JSON.stringify({ content, allowed_mentions: { parse: [], replied_user: false } }) } : {}),
  }, log, stopCheck);
  if (response.ok) {
    stats[overwrite ? 'overwritten' : 'deleted']++;
    log('verb', `${overwrite ? 'Overwrote' : 'Deleted'} message ${message.id}.`);
  } else if (response.status === 404) {
    stats.alreadyGone++;
  } else if (response.status === 401) {
    invalidateAuth();
    log('error', '401 Unauthorized. Stopping.');
    return false;
  } else {
    stats.failed++;
    log('error', `${overwrite ? 'Overwrite' : 'Delete'} failed (${response.status}) for ${message.id}.`);
  }
  // Millisecond increments give deletion delays three decimal places in seconds.
  if (!stopCheck()) await sleep(rand(overwrite ? 1600 : 700, overwrite ? 2400 : 1600));
  return true;
}
