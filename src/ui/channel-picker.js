import { createAsyncCache } from '../utils/async-cache.js';
import { API } from '../config.js';
import { apiFetch } from '../discord/api.js';

// Keep the ID input as the source of truth, so every existing cleanup path uses
// the same selected IDs. A shared cache avoids duplicate requests for both tabs.
export function installChannelPickers($, allowMessages = () => true) {
  const cache = createAsyncCache();
  const tokenInput = $('#dmd-token');
  const controllers = [['#dmd-guild', '#dmd-channel', allowMessages], ['#dmd-multi-guild', '#dmd-multi-channel', () => true], ['#dmd-rx-guild', '#dmd-rx-channel', () => true]].filter(([guildId, channelId]) => $(guildId) && $(channelId)).map(([guildId, channelId, allowed]) => {
    const guild = $(guildId), input = $(channelId);
    const wrapper = document.createElement('div'); wrapper.className = 'dmd-channel-picker'; wrapper.hidden = true;
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'dmd-select-trigger';
    trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-label', 'Choose channels');
    const menu = document.createElement('div'); menu.className = 'dmd-channel-menu'; menu.id = `${input.id}-channel-menu`; menu.hidden = true; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', 'Channels'); trigger.setAttribute('aria-controls', menu.id);
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Find a channel'; search.maxLength = 100; search.setAttribute('aria-label', 'Find a channel');
    const choices = document.createElement('div'); choices.className = 'dmd-channel-choices';
    const manual = document.createElement('button'); manual.type = 'button'; manual.className = 'dmd-btn'; manual.textContent = 'Enter IDs instead';
    menu.append(search, choices, manual); wrapper.append(trigger); input.after(wrapper); document.body.appendChild(menu);
    let channels = [], channelNames = new Map(), rows = [], choicesReady = false, version = 0, timer, manualGuild = '', lastKey = '', loadedKey = '';
    const panel = input.closest('#dmd-panel');
    const close = () => {
      menu.hidden = true; trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', close); panel?.removeEventListener('scroll', close, true);
    };
    const outside = event => { if (!wrapper.contains(event.target) && !menu.contains(event.target)) close(); };
    const selected = () => input.value.split(',').map(id => id.trim()).filter(Boolean);
    const empty = document.createElement('div'); empty.className = 'dmd-muted';
    choices.onchange = event => {
      const checkbox = event.target;
      if (checkbox.type !== 'checkbox') return;
      const values = new Set(selected()); checkbox.checked ? values.add(checkbox.value) : values.delete(checkbox.value);
      input.value = [...values].join(', '); input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const sync = () => {
      const ids = selected();
      trigger.textContent = ids.length === 1 ? (channelNames.has(ids[0]) ? `#${channelNames.get(ids[0])}` : ids[0]) : ids.length ? `${ids.length} channels selected` : 'Select channels';
      if (menu.hidden) return;
      const selectedIds = new Set(ids), term = search.value.trim().toLowerCase();
      let visible = 0;
      for (const row of rows) {
        row.checkbox.checked = selectedIds.has(row.id);
        row.label.hidden = !row.searchName.includes(term);
        if (!row.label.hidden) visible++;
      }
      empty.hidden = visible > 0;
      empty.textContent = channels.length ? 'No matching channels.' : 'No message channels available.';
    };
    const buildChoices = () => {
      const fragment = document.createDocumentFragment(); rows = [];
      for (const channel of channels) {
        const label = document.createElement('label'); label.className = 'dmd-channel-option';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = channel.id;
        const name = document.createElement('span'); name.textContent = `${[15, 16].includes(channel.type) ? 'Forum: ' : '#'}${channel.name}`;
        rows.push({ id: channel.id, searchName: channel.name.toLowerCase(), label, checkbox });
        label.append(checkbox, name); fragment.appendChild(label);
      }
      fragment.appendChild(empty); choices.replaceChildren(fragment); choicesReady = true;
    };
    trigger.onclick = () => {
      if (!menu.hidden) { close(); return; }
      menu.hidden = false; trigger.setAttribute('aria-expanded', 'true');
      if (!choicesReady) buildChoices();
      sync();
      const rect = trigger.getBoundingClientRect(), width = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
      menu.style.width = `${width}px`; menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      const below = window.innerHeight - rect.bottom - 12;
      menu.style.top = below >= 180 ? `${rect.bottom + 5}px` : 'auto';
      menu.style.bottom = below >= 180 ? 'auto' : `${window.innerHeight - rect.top + 5}px`;
      menu.style.maxHeight = `${Math.max(120, Math.min(320, below >= 180 ? below : rect.top - 12))}px`;
      document.addEventListener('pointerdown', outside, true); window.addEventListener('resize', close); panel?.addEventListener('scroll', close, true);
      search.focus();
    };
    search.oninput = sync;
    menu.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); trigger.focus(); } });
    manual.onclick = () => { manualGuild = guild.value.trim(); wrapper.hidden = true; input.hidden = false; close(); input.focus(); };
    input.addEventListener('change', sync); input.addEventListener('input', sync);
    const refresh = async () => {
      const id = guild.value.trim(), token = tokenInput.value.trim();
      const valid = /^\d{15,22}$/.test(id) && allowed() && token;
      if (!valid || manualGuild === id) { ++version; wrapper.hidden = true; input.hidden = false; close(); lastKey = ''; return; }
      const key = `${token}/${id}`;
      const existing = cache.peek(key);
      if (loadedKey === key && lastKey === key && existing && !existing.pending) { sync(); return; }
      lastKey = key; const requestVersion = ++version;
      wrapper.hidden = false; input.hidden = true; trigger.disabled = true; trigger.textContent = 'Loading channels…'; close();
      try {
        const loaded = await cache.get(key, async () => {
          const response = await apiFetch(`${API}/guilds/${id}/channels`, { headers: { Authorization: token } });
          if (!response.ok) throw new Error(`Could not load channels (${response.status}).`);
          const data = await response.json();
          if (!Array.isArray(data)) throw new Error('Invalid channel list.');
          return data.filter(channel => (!channel.guild_id || channel.guild_id === id) && [0, 5, 15, 16].includes(channel.type) && /^\d{15,22}$/.test(channel.id))
            .map(channel => ({ id: channel.id, name: String(channel.name || channel.id), type: channel.type, position: Number(channel.position) || 0 }))
            .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
        });
        if (requestVersion !== version || guild.value.trim() !== id || !allowed()) return;
        if (channels !== loaded) {
          channels = loaded; channelNames = new Map(channels.map(channel => [channel.id, channel.name]));
          rows = []; choices.replaceChildren(); choicesReady = false;
        }
        loadedKey = key; trigger.disabled = false; sync();
      } catch {
        if (requestVersion !== version) return;
        lastKey = ''; wrapper.hidden = true; input.hidden = false; trigger.disabled = false;
        input.title = 'Channel list unavailable. Enter channel IDs to continue.';
      }
    };
    input.addEventListener('blur', () => { if (!input.value.trim()) { manualGuild = ''; lastKey = ''; void refresh(); } });
    guild.addEventListener('input', () => { ++version; clearTimeout(timer); close(); timer = setTimeout(() => void refresh(), 400); });
    guild.addEventListener('change', () => { clearTimeout(timer); void refresh(); });
    return { refresh };
  });
  const refresh = () => Promise.all(controllers.map(controller => controller.refresh()));
  tokenInput.addEventListener('change', () => void refresh());
  return { refresh };
}
