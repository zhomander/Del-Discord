// Del-Discord v1 — personal source modules.

export function installPanelWindowControls({ panel, dragHandle = panel, resizeHandle, resizeHandles = resizeHandle ? [resizeHandle] : [], storage, storageKey, minWidth = 560, defaultWidth = 940, defaultRatio = 1.35 }) {
  const MIN_WIDTH = minWidth;
  const EDGE = 8;
  let ratio = null;
  let geometryReady = false;

  const frameUpdates = apply => {
    let queued = false, frame = null, point = null;
    const flush = () => {
      queued = false; frame = null;
      if (!point) return;
      const latest = point; point = null; apply(latest);
    };
    const move = event => {
      point = { clientX: event.clientX, clientY: event.clientY };
      if (typeof window.requestAnimationFrame !== 'function') { flush(); return; }
      if (!queued) { queued = true; frame = window.requestAnimationFrame(flush); }
    };
    const finish = () => {
      if (frame !== null) window.cancelAnimationFrame?.(frame);
      flush();
    };
    return { move, finish };
  };

  const readSaved = () => {
    try {
      const saved = JSON.parse(storage().getItem(storageKey) || 'null');
      if (!saved || !Number.isFinite(saved.left) || !Number.isFinite(saved.top) || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return null;
      return saved;
    } catch { return null; }
  };

  const saveGeometry = () => {
    if (!geometryReady) return;
    const r = panel.getBoundingClientRect();
    try {
      storage().setItem(storageKey, JSON.stringify({
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        ratio: ratio || (r.width / r.height)
      }));
    } catch {}
  };

  const fitSize = (wantedWidth, wantedRatio) => {
    const maxW = Math.max(260, window.innerWidth - EDGE * 2);
    const maxH = Math.max(220, window.innerHeight - EDGE * 2);
    const minW = Math.min(MIN_WIDTH, maxW);
    let w = Math.max(minW, Math.min(maxW, wantedWidth));
    let h = w / wantedRatio;
    if (h > maxH) { h = maxH; w = h * wantedRatio; }
    if (w > maxW) { w = maxW; h = w / wantedRatio; }
    return { width: w, height: h };
  };

  const clampPosition = () => {
    if (!geometryReady) return;
    const r = panel.getBoundingClientRect();
    const maxLeft = Math.max(EDGE, window.innerWidth - r.width - EDGE);
    const maxTop = Math.max(EDGE, window.innerHeight - r.height - EDGE);
    const left = Math.min(maxLeft, Math.max(EDGE, r.left));
    const top = Math.min(maxTop, Math.max(EDGE, r.top));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };

  const ensureGeometry = () => {
    if (geometryReady) return;
    const saved = readSaved();
    const current = panel.getBoundingClientRect();
    ratio = saved?.ratio && Number.isFinite(saved.ratio) && saved.ratio > 0
      ? saved.ratio
      : (current.width > 0 && current.height > 0 ? current.width / current.height : defaultRatio);
    const desiredWidth = saved?.width || current.width || Math.min(defaultWidth, window.innerWidth - 36);
    const size = fitSize(desiredWidth, ratio);
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.width = `${size.width}px`;
    panel.style.height = `${size.height}px`;
    panel.style.left = `${saved?.left ?? Math.max(EDGE, window.innerWidth - size.width - 18)}px`;
    panel.style.top = `${saved?.top ?? 62}px`;
    geometryReady = true;
    clampPosition();
  };

  dragHandle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.isPrimary === false) return;
    if (e.target.closest('button,input,textarea,select,option,label,summary,a,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="dialog"],[role="listbox"],[data-resize-corner],#dmd-log')) return;
    ensureGeometry();
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const startLeft = r.left, startTop = r.top;
    const { move, finish } = frameUpdates(ev => {
      const maxLeft = Math.max(EDGE, window.innerWidth - r.width - EDGE);
      const maxTop = Math.max(EDGE, window.innerHeight - r.height - EDGE);
      panel.style.left = `${Math.min(maxLeft, Math.max(EDGE, startLeft + ev.clientX - startX))}px`;
      panel.style.top = `${Math.min(maxTop, Math.max(EDGE, startTop + ev.clientY - startY))}px`;
    });
    const up = () => {
      finish();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      saveGeometry();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
  });

  for (const handle of resizeHandles) handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    ensureGeometry();
    e.preventDefault();
    e.stopPropagation();
    const r = panel.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const fromLeft = handle.dataset.resizeCorner === 'left';
    const startW = r.width, startH = r.height;
    const { move, finish } = frameUpdates(ev => {
      const maxWidth = fromLeft ? r.left + startW - EDGE : window.innerWidth - r.left - EDGE;
      const maxHeight = window.innerHeight - r.top - EDGE;
      const width = Math.max(Math.min(MIN_WIDTH, maxWidth), Math.min(maxWidth, startW + (ev.clientX - startX) * (fromLeft ? -1 : 1)));
      const height = Math.max(Math.min(300, maxHeight), Math.min(maxHeight, startH + ev.clientY - startY));
      panel.style.width = `${width}px`;
      panel.style.height = `${height}px`;
      ratio = width / height;
      if (fromLeft) panel.style.left = `${r.left + startW - width}px`;
    });
    const up = () => {
      finish();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      saveGeometry();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
  });

  window.addEventListener('resize', () => {
    if (!geometryReady || panel.style.display !== 'flex') return;
    const r = panel.getBoundingClientRect();
    const currentRatio = ratio || (r.width / r.height);
    const size = fitSize(r.width, currentRatio);
    panel.style.width = `${size.width}px`;
    panel.style.height = `${size.height}px`;
    clampPosition();
    saveGeometry();
  });

  return { ensureGeometry };
}
