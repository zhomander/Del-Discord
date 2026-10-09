// Share one observer between panels and batch page changes once per frame.
const listeners = new Set();
let observer;
let scheduled = false;
let generation = 0;

export function observeDiscordPage(listener) {
  listeners.add(listener);
  if (!observer) {
    const version = ++generation;
    observer = new MutationObserver(records => {
      // Logs, menus and progress inside our window cannot replace Discord's toolbar.
      if (records?.length && records.every(record => {
        if (record.target?.closest?.('#dmd-panel, #dmh-panel, #dmd-toolbar-btn, .dmd-select-menu, .dmd-calendar')) return true;
        const changedNodes = [...(record.addedNodes || []), ...(record.removedNodes || [])];
        return changedNodes.length > 0 && changedNodes.every(node => node.matches?.('.dmd-select-menu, .dmd-calendar'));
      })) return;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        if (version !== generation) return;
        scheduled = false;
        for (const callback of listeners) callback();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && observer) {
      observer.disconnect();
      observer = null;
      generation++;
      scheduled = false;
    }
  };
}
