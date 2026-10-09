// Del-Discord v1 — personal source modules.
import { siteStorage } from '../../utils/storage.js';
import { HISTORY_KEY, STATE_KEY } from './config.js';

export function loadHistory() {
  try {
    const parsed = JSON.parse(siteStorage().getItem(HISTORY_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export function saveHistory(history) {
  try {
    siteStorage().setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (e) { console.warn('[DM History] Save failed', e); }
}

export function loadState() {
  try {
    const parsed = JSON.parse(siteStorage().getItem(STATE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export function saveState(state) {
  try {
    const storage = siteStorage();
    const serialized = JSON.stringify(state);
    if (storage.getItem(STATE_KEY) !== serialized) storage.setItem(STATE_KEY, serialized);
  } catch (e) { console.warn('[DM History] State save failed', e); }
}
