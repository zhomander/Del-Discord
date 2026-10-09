// Del-Discord v1 — personal source modules.
import { LOG_DOM_LIMIT, LOG_DOM_TRIM, LOG_ENTRY_LIMIT } from '../config.js';

export function createLog(logBox) {
  const logEntries = [];
  let scrollPending = false;
  const log = (type, message) => {
    const when = new Date();
    const text = String(message);
    const div = document.createElement('div');
    div.className = `log-${type || 'verb'}`;
    div.textContent = text;
    logBox.appendChild(div);

    if (logBox.childElementCount > LOG_DOM_LIMIT) {
      for (let i = 0; i < LOG_DOM_TRIM && logBox.firstChild; i++) {
        logBox.firstChild.remove();
      }
    }

    // A burst of messages needs one layout read after all DOM writes, rather
    // than forcing the browser to lay out the log after every appended row.
    if (!scrollPending) {
      scrollPending = true;
      queueMicrotask(() => { scrollPending = false; logBox.scrollTop = logBox.scrollHeight; });
    }
    logEntries.push({ time: when.toISOString(), type: type || 'verb', message: text });
    if (logEntries.length > LOG_ENTRY_LIMIT) logEntries.splice(0, LOG_DOM_TRIM);
  };

  return { log, logEntries };
}
