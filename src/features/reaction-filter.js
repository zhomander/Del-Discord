export function parseReactionIds(value = '') {
  const ids = new Set();
  for (const item of String(value).split(/[\s,;]+/).filter(Boolean)) {
    const id = item.match(/^<a?:[^:<>\s]+:(\d{15,22})>$/)?.[1] || item;
    if (!/^\d{15,22}$/.test(id)) throw new Error('Reaction filter must contain emoji IDs or custom emoji tags, separated by commas.');
    ids.add(id);
  }
  return ids;
}

export function matchesReaction(emoji, ids) {
  return !ids.size || ids.has(String(emoji?.id || ''));
}
