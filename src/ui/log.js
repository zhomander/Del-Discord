// Del-Discord v1 — personal source modules.
import { LOG_DOM_LIMIT, LOG_DOM_TRIM } from '../config.js';

export function createLog(logBox) {
  const logEntries = [];
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

    logBox.scrollTop = logBox.scrollHeight;
    logEntries.push({ time: when.toISOString(), type: type || 'verb', message: text });
  };

  return { log, logEntries };
}
