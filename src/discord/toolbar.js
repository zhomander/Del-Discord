// Del-Discord v1 — personal source modules.

export function findDiscordToolbar() {
  let best = null, bestScore = -Infinity;
  for (const el of document.querySelectorAll('[role="toolbar"], [class*="toolbar"]')) {
    const r = el.getBoundingClientRect();
    if (r.width <= 80 || r.height <= 20 || r.top < 0 || r.top >= 140 || el.offsetParent === null) continue;
    let score = 0;
    if (r.top < 80) score += 20;
    if (r.right > innerWidth * 0.55) score += 20;
    score += Math.min(10, el.querySelectorAll('button,[role="button"]').length);
    if (el.closest('header')) score += 15;
    if (score > bestScore) { best = el; bestScore = score; }
  }
  return best;
}
