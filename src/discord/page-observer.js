// Share one observer between panels and batch page changes once per frame.
const listeners = new Set();
let observer;
let scheduled = false;

export function observeDiscordPage(listener) {
  listeners.add(listener);
  if (!observer) {
    observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
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
    }
  };
}
