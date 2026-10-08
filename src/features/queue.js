// Del-Discord v1 — personal source modules.
import { QUEUE_KEY } from '../config.js';

export function createQueue({ $, log }) {
  let queue = [];
  try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); if (!Array.isArray(queue)) queue = []; } catch { queue = []; }
  const saveQueue = () => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch {} };
  const renderQueue = () => {
    const box = $('#dmd-multi-list');
    box.textContent = '';
    $('#dmd-multi-count').textContent = `${queue.length} queued`;

    if (!queue.length) {
      const empty = document.createElement('div');
      empty.className = 'dmd-muted';
      empty.style.padding = '14px';
      empty.textContent = 'Queue is empty.';
      box.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    queue.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'dmd-queue-row';

      const num = document.createElement('span');
      num.className = 'dmd-queue-index';
      num.textContent = `${index + 1}.`;

      const info = document.createElement('div');
      info.className = 'dmd-queue-info';

      const title = document.createElement('div');
      title.className = 'dmd-queue-title';
      title.textContent = item.label || item.channelId;

      const ids = document.createElement('div');
      ids.className = 'dmd-queue-ids';
      ids.textContent = item.kind === 'ids' ? `${item.targets.length} individual messages` : `${item.guildId} / ${item.channelId}`;

      info.append(title, ids);

      const up = document.createElement('button');
      up.className = 'dmd-btn';
      up.textContent = '↑';
      up.disabled = index === 0;
      up.onclick = () => {
        if (index === 0) return;
        [queue[index - 1], queue[index]] = [queue[index], queue[index - 1]];
        saveQueue();
        renderQueue();
      };

      const down = document.createElement('button');
      down.className = 'dmd-btn';
      down.textContent = '↓';
      down.disabled = index === queue.length - 1;
      down.onclick = () => {
        if (index >= queue.length - 1) return;
        [queue[index], queue[index + 1]] = [queue[index + 1], queue[index]];
        saveQueue();
        renderQueue();
      };

      const remove = document.createElement('button');
      remove.className = 'dmd-btn dmd-red';
      remove.textContent = 'Remove';
      remove.onclick = () => {
        queue.splice(index, 1);
        saveQueue();
        renderQueue();
      };

      row.append(num, info, up, down, remove);
      fragment.appendChild(row);
    });

    box.appendChild(fragment);
  };

  const addQueueItem = (guildId, channelId, label = '', thread = false, settings = {}) => {
    guildId = String(guildId || '').trim(); channelId = String(channelId || '').trim();
    if (!guildId || !channelId) return log('error', 'Guild/DM ID and Channel ID are required.');
    if (queue.some(x => x.guildId === guildId && x.channelId === channelId)) return log('warn', 'That DM/channel is already queued.');
    queue.push({ ...settings, guildId, channelId, thread: thread === true, label: label || (guildId === '@me' ? `DM ${channelId}` : `Channel ${channelId}`) }); saveQueue(); renderQueue();
  };
  const addIdJob = (targets, options) => {
    if (!targets.length) return log('warn', 'Enter at least one message ID.');
    const channelId = `ids:${targets.map(target => `${target.channelId}/${target.messageId}`).sort().join(',')}`;
    addQueueItem('@ids', channelId, `${targets.length} message IDs`, false, { kind: 'ids', targets, options });
  };
  const completeItem = item => {
    const index = queue.findIndex(entry => entry.guildId === item.guildId && entry.channelId === item.channelId);
    if (index < 0) return;
    queue.splice(index, 1);
    saveQueue();
    renderQueue();
  };
  renderQueue();

  return { renderQueue, addQueueItem, addIdJob, completeItem, getItems: () => queue, clear: () => { queue = []; saveQueue(); renderQueue(); } };
}
