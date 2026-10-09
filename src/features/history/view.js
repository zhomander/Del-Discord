import { historyRevision } from './model.js';

// Page navigation reuses the sorted history until an import or verification
// changes it. Keep one search result and discard it when the query changes.
export function createHistoryView() {
  let previousMap, previousRevision = -1, sorted = [], filtered = [];
  let previousQuery = null;
  const searchText = new WeakMap();
  return (history, query = '') => {
    const revision = historyRevision(history);
    if (history !== previousMap || revision !== previousRevision) {
      sorted = [];
      for (const key of Object.keys(history)) {
        const entry = history[key];
        if (entry?.verifiedSent === true && Number(entry.sentCount || 0) > 0) sorted.push(entry);
      }
      sorted.sort((a, b) => {
        const ar = Number.isFinite(a.dmRank) ? a.dmRank : 1e12;
        const br = Number.isFinite(b.dmRank) ? b.dmRank : 1e12;
        return ar - br || (a.name || a.username || a.userId || a.channelId).localeCompare(b.name || b.username || b.userId || b.channelId);
      });
      previousMap = history;
      previousRevision = revision;
      previousQuery = null;
    }
    const normalized = query.trim().toLowerCase();
    if (normalized !== previousQuery) {
      filtered = normalized ? sorted.filter(entry => {
        let text = searchText.get(entry);
        if (text === undefined) {
          text = [entry.name, entry.username, entry.userId, entry.channelId].join(' ').toLowerCase();
          searchText.set(entry, text);
        }
        return text.includes(normalized);
      }) : sorted;
      previousQuery = normalized;
    }
    return filtered;
  };
}
