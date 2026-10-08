// Del-Discord v1 — personal source modules.

export function askPopup({ title = 'Confirm', message = '', details = '', yesText = 'Yes', noText = 'No', danger = false } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dmd-confirm-overlay';

    const box = document.createElement('div');
    box.className = 'dmd-confirm-box';

    const heading = document.createElement('div');
    heading.className = 'dmd-confirm-title';
    heading.textContent = title;

    const body = document.createElement('div');
    body.className = 'dmd-confirm-message';
    body.textContent = message;

    box.append(heading, body);

    if (details) {
      const pre = document.createElement('pre');
      pre.className = 'dmd-confirm-details';
      pre.textContent = details;
      box.appendChild(pre);
    }

    const actions = document.createElement('div');
    actions.className = 'dmd-confirm-actions';

    const no = document.createElement('button');
    no.className = 'dmd-btn';
    no.textContent = noText;

    const yes = document.createElement('button');
    yes.className = `dmd-btn ${danger ? 'dmd-red' : 'dmd-green'}`;
    yes.textContent = yesText;

    actions.append(no, yes);
    box.appendChild(actions);
    overlay.appendChild(box);
    const previousFocus = document.activeElement;
    const host = document.getElementById('dmd-panel') || document.body;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    heading.id = 'dmd-confirm-heading';
    box.setAttribute('aria-labelledby', heading.id);
    host.appendChild(overlay);

    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(value);
    };
    const onKey = e => {
      if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === yes ? no : yes).focus(); }
      if (e.key === 'Escape') finish(false);
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) finish(true);
    };

    no.onclick = () => finish(false);
    yes.onclick = () => finish(true);
    overlay.onclick = e => { if (e.target === overlay) finish(false); };
    document.addEventListener('keydown', onKey, true);
    yes.focus();
  });
}
