// Del-Discord v1 — personal source modules.

export let storageFrame = null;

export function siteStorage() {
  if (!storageFrame?.isConnected) {
    storageFrame = document.createElement('iframe');
    storageFrame.style.display = 'none';
    storageFrame.setAttribute('aria-hidden', 'true');
    document.body.appendChild(storageFrame);
  }
  return storageFrame.contentWindow.localStorage;
}
