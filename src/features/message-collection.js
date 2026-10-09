import { compareMessageIds, sortMessages } from './message-filters.js';

// Only the 20-message preview needs full snapshots. Rechecked scans retain IDs;
// direct-ID scans can supply the compact fields needed for their chosen action.
export function createMessageCollection(order, retain = message => ({ id: message.id, channel_id: message.channel_id })) {
  const messages = [];
  let preview = [];
  const direction = order === 'asc' ? 1 : -1;
  return {
    messages,
    get length() { return messages.length; },
    add(batch) {
      if (!batch.length) return;
      for (const message of batch) messages.push(retain(message));
      const sorted = sortMessages(batch, order), next = [];
      if (preview.length === 20 && direction * compareMessageIds(sorted[0].id, preview.at(-1).id) >= 0) return;
      let oldIndex = 0, batchIndex = 0;
      while (next.length < 20 && (oldIndex < preview.length || batchIndex < sorted.length)) {
        if (batchIndex >= sorted.length || (oldIndex < preview.length && direction * compareMessageIds(preview[oldIndex].id, sorted[batchIndex].id) <= 0)) next.push(preview[oldIndex++]);
        else next.push(sorted[batchIndex++]);
      }
      preview = next;
    },
    finish() {
      const snapshots = new Map(preview.map(message => [message.id, message]));
      for (let index = 0; index < messages.length; index++) {
        const snapshot = snapshots.get(messages[index].id);
        if (snapshot) messages[index] = snapshot;
      }
      preview = [];
      return messages;
    },
  };
}
