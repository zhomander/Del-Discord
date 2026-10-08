import { sortMessages } from './message-filters.js';

// Rechecks fetch fresh content before any action. Only the 20-message preview
// needs full snapshots; retain IDs for the remaining collected messages.
export function createMessageCollection(order) {
  const messages = [];
  let preview = [];
  return {
    messages,
    get length() { return messages.length; },
    add(batch) {
      if (!batch.length) return;
      for (const message of batch) messages.push({ id: message.id, channel_id: message.channel_id });
      preview = sortMessages([...preview, ...batch], order).slice(0, 20);
    },
    finish() {
      const snapshots = new Map(preview.map(message => [message.id, message]));
      for (let index = 0; index < messages.length; index++) {
        const snapshot = snapshots.get(messages[index].id);
        if (snapshot) messages[index] = snapshot;
      }
      return messages;
    },
  };
}
