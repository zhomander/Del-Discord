import { createExpiringStorage } from '../utils/expiring-storage.js';
const KEY = 'del_discord_v1_message_settings';

export function installSavedSettings(panel, { getMode, setMode, onReset = () => {}, onStorageError = () => {} }) {
  const cache = createExpiringStorage(KEY);
  const fields = [...panel.querySelectorAll('#dmd-messages input:not([type=password]):not([type=file]), #dmd-messages textarea, #dmd-messages select:not([multiple])')];
  const defaults = new Map(fields.map(field => [field.id, field.type === 'checkbox' ? field.checked : field.value]));
  let restoring = true;
  try {
    const saved = JSON.parse(cache.read() || 'null');
    if (saved && typeof saved === 'object') {
      for (const field of fields) {
        const value = saved.fields?.[field.id];
        if (field.type === 'checkbox' && typeof value === 'boolean') field.checked = value;
        else if (typeof value === 'string' && (field.tagName !== 'SELECT' || [...field.options].some(option => option.value === value))) field.value = value;
      }
      if (['dm', 'channel', 'server', 'forums', 'thread'].includes(saved.mode)) setMode(saved.mode);
    }
  } catch {}
  restoring = false;
  let storageWarning = false;
  const save = () => {
    if (restoring) return;
    const values = Object.fromEntries(fields.map(field => [field.id, field.type === 'checkbox' ? field.checked : field.value]));
    try { if (!cache.write(JSON.stringify({ mode: getMode(), fields: values }))) throw new Error('Storage unavailable'); }
    catch { if (!storageWarning) { storageWarning = true; onStorageError(); } }
  };
  let timer;
  fields.forEach(field => {
    field.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 150); });
    field.addEventListener('change', () => { clearTimeout(timer); save(); });
    field.addEventListener('blur', () => { clearTimeout(timer); save(); });
  });
  const clear = () => {
    clearTimeout(timer); restoring = true;
    for (const field of fields) {
      if (field.type === 'checkbox') field.checked = defaults.get(field.id);
      else field.value = defaults.get(field.id);
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setMode('dm'); restoring = false;
    try { cache.clear(); } catch {}
    onReset();
  };
  return { save, clear };
}
