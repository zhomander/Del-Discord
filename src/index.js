import { initDeleter } from './ui/deleter.js';

function init() {
  initDeleter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
