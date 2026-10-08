export function parseIdList(value, label = 'IDs', { required = false } = {}) {
  const ids = [...new Set(String(value || '').split(',').map(id => id.trim()).filter(Boolean))];
  if (required && !ids.length) throw new Error(`Enter at least one ${label}.`);
  if (ids.some(id => !/^\d{15,22}$/.test(id))) throw new Error(`${label} must be Discord IDs separated by commas.`);
  return ids;
}
