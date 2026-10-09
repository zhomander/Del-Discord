// Del-Discord v1 — personal source modules.
import { createExpiringStorage } from '../utils/expiring-storage.js';
import { QUEUE_KEY } from '../config.js';
import { cleanQueueLabel } from '../discord/queue-identity.js';

export function createQueue({ $, log, onChange = () => {} }) {
  const cache = createExpiringStorage(QUEUE_KEY);
  let queue = [];
  let idJobSequence = 0;
  try { queue = JSON.parse(cache.read() || '[]'); if (!Array.isArray(queue)) queue = []; } catch { queue = []; }
  let storageWarning = false;
  const saveQueue = () => {
    try { if (!cache.write(JSON.stringify(queue))) throw new Error('Storage unavailable'); }
    catch { if (!storageWarning) { storageWarning = true; log('warn', 'Queue could not be saved locally. Keep this page open; refreshing may lose these jobs.'); } }
    onChange();
  };
  const rows = new Map();
  let emptyRow;
  let rendered = false;
  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
  const createRow = item => {
    const row = document.createElement('div'); row.className = 'dmd-queue-row';
    const num = document.createElement('span'); num.className = 'dmd-queue-index';
    const avatar = document.createElement('span'); avatar.className = 'dmd-queue-avatar';
    const letter = document.createTextNode(''); avatar.appendChild(letter);
    const info = document.createElement('div'); info.className = 'dmd-queue-info';
    const title = document.createElement('div'); title.className = 'dmd-queue-title';
    const ids = document.createElement('div'); ids.className = 'dmd-queue-ids';
    info.append(title, ids);
    const up = document.createElement('button'); up.className = 'dmd-btn'; up.textContent = '↑';
    const down = document.createElement('button'); down.className = 'dmd-btn'; down.textContent = '↓';
    const remove = document.createElement('button'); remove.className = 'dmd-btn dmd-red'; remove.textContent = 'Remove';
    // Rows survive reorders and removals; resolve the item's current position
    // when clicked instead of retaining a stale render-time array index.
    up.onclick = () => {
      const index = queue.indexOf(item);
      if (index <= 0) return;
      [queue[index - 1], queue[index]] = [queue[index], queue[index - 1]];
      saveQueue(); renderQueue();
    };
    down.onclick = () => {
      const index = queue.indexOf(item);
      if (index < 0 || index >= queue.length - 1) return;
      [queue[index], queue[index + 1]] = [queue[index + 1], queue[index]];
      saveQueue(); renderQueue();
    };
    remove.onclick = () => {
      const index = queue.indexOf(item);
      if (index < 0) return;
      queue.splice(index, 1); saveQueue(); renderQueue();
    };
    row.append(num, avatar, info, up, down, remove);
    return { row, num, avatar, letter, title, ids, up, down, icon: '', image: null };
  };
  const renderQueue = () => {
    const box = $('#dmd-multi-list');
    if (!rendered) { box.textContent = ''; rendered = true; }
    setText($('#dmd-multi-count'), `${queue.length} queued`);
    const currentItems = new Set(queue);
    for (const [item, record] of rows) {
      if (!currentItems.has(item)) { record.row.remove(); rows.delete(item); }
    }
    if (!queue.length) {
      if (!emptyRow) {
        emptyRow = document.createElement('div'); emptyRow.className = 'dmd-muted';
        emptyRow.style.padding = '14px'; emptyRow.textContent = 'Queue is empty.';
      }
      if (emptyRow.parentNode !== box) box.appendChild(emptyRow);
      return;
    }
    emptyRow?.remove();
    const fragment = document.createDocumentFragment();
    let nextRow = box.firstElementChild;
    queue.forEach((item, index) => {
      let record = rows.get(item);
      if (!record) { record = createRow(item); rows.set(item, record); }
      const label = cleanQueueLabel(item.label);
      setText(record.num, `${index + 1}.`);
      setText(record.letter, (item.iconName || label || '?').slice(0, 1).toUpperCase());
      setText(record.title, label || item.channelId);
      setText(record.ids, item.kind === 'ids' ? `${item.targets.length} individual messages` : item.kind === 'server' ? `Server ${item.guildId}` : `${item.guildId} / ${item.channelId}`);
      if (record.up.disabled !== (index === 0)) record.up.disabled = index === 0;
      if (record.down.disabled !== (index === queue.length - 1)) record.down.disabled = index === queue.length - 1;
      const icon = /^https:\/\/cdn\.discordapp\.com\/(?:avatars|icons|embed\/avatars)\//.test(item.icon || '') ? item.icon : '';
      if (record.icon !== icon) {
        record.image?.remove(); record.image = null; record.icon = icon;
        if (icon) {
          const image = document.createElement('img'); image.src = icon;
          image.onerror = () => image.remove(); record.avatar.appendChild(image); record.image = image;
        }
      }
      if (record.image && record.image.alt !== (item.iconName || label || 'Queue icon')) record.image.alt = item.iconName || label || 'Queue icon';
      if (nextRow === record.row) nextRow = nextRow.nextElementSibling;
      else if (nextRow) box.insertBefore(record.row, nextRow);
      else fragment.appendChild(record.row);
    });
    if (fragment.childNodes.length) box.appendChild(fragment);
  };

  const addQueueItems = items => {
    const keys = new Set(queue.map(item => `${item.guildId}/${item.channelId}`));
    let added = 0;
    for (const item of items) {
      const guildId = String(item.guildId || '').trim(), channelId = String(item.channelId || '').trim();
      if (!guildId || !channelId) { log('error', 'Server/DM ID and Channel ID are required.'); continue; }
      const key = `${guildId}/${channelId}`;
      if (keys.has(key)) { log('warn', 'That DM/channel is already queued.'); continue; }
      keys.add(key);
      queue.push({ ...item, guildId, channelId, thread: item.thread === true, label: item.label || (guildId === '@me' ? `DM ${channelId}` : `Channel ${channelId}`) }); added++;
    }
    if (added) { saveQueue(); renderQueue(); }
    return added;
  };
  const addQueueItem = (guildId, channelId, label = '', thread = false, settings = {}) => addQueueItems([{ ...settings, guildId, channelId, label, thread }]);
  const addIdJob = (targets, options) => {
    if (!targets.length) return log('warn', 'Enter at least one message ID.');
    const pairs = values => values.map(target => `${target.channelId}/${target.messageId}`).sort();
    const keys = pairs(targets);
    // Compare the exact target multiset, including loaded legacy ID jobs. A
    // compact job key avoids saving every target pair a second time in storage.
    if (queue.some(item => item.guildId === '@ids' && Array.isArray(item.targets) && item.targets.length === targets.length && pairs(item.targets).every((key, index) => key === keys[index]))) {
      return log('warn', 'That message ID batch is already queued.');
    }
    let channelId;
    do { channelId = `ids:${Date.now().toString(36)}:${(idJobSequence++).toString(36)}`; }
    while (queue.some(item => item.guildId === '@ids' && item.channelId === channelId));
    addQueueItem('@ids', channelId, `${targets.length} message IDs`, false, { kind: 'ids', targets, options });
  };
  const completeItem = item => {
    const index = queue.findIndex(entry => entry.guildId === item.guildId && entry.channelId === item.channelId);
    if (index < 0) return;
    queue.splice(index, 1);
    saveQueue();
    renderQueue();
  };
  const updateIdentity = (item, identity) => {
    const entry = queue.find(value => value.guildId === item.guildId && value.channelId === item.channelId);
    if (!entry) return;
    Object.assign(entry, { label: identity.label, icon: identity.icon, iconName: identity.iconName });
    saveQueue(); renderQueue();
  };
  renderQueue();

  return { renderQueue, addQueueItem, addQueueItems, addIdJob, completeItem, updateIdentity, getItems: () => queue, clear: () => { queue = []; saveQueue(); renderQueue(); } };
}
