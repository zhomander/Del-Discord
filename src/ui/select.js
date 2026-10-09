// Custom menus retain the native select as the source of truth for cleanup options.
export function enhanceSelects(panel) {
  let closeCurrent = () => {};
  panel.querySelectorAll('select:not([multiple])').forEach((select, index) => {
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'dmd-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    const label = panel.querySelector(`label[for="${select.id}"]`);
    if (label) { label.id ||= `dmd-select-label-${index}`; trigger.setAttribute('aria-labelledby', `${label.id} ${select.id}-value`); }
    else trigger.setAttribute('aria-label', select.getAttribute('aria-label') || 'Choose option');
    const text = document.createElement('span'); text.id = `${select.id}-value`;
    trigger.appendChild(text);
    select.classList.add('dmd-native-select'); select.tabIndex = -1;
    select.insertAdjacentElement('afterend', trigger);
    const sync = () => { text.textContent = select.selectedOptions[0]?.textContent || ''; trigger.disabled = select.disabled; };
    select.addEventListener('change', sync); sync();
    let menu, choices = [], available = [], active;
    const close = () => {
      menu?.remove(); trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', close); panel.removeEventListener('scroll', close, true);
      if (closeCurrent === close) closeCurrent = () => {};
    };
    const outside = event => { if (!menu.contains(event.target) && !trigger.contains(event.target)) close(); };
    const focus = () => choices[active]?.focus();
    const open = () => {
      closeCurrent(); sync();
      if (select.disabled) return;
      if (!menu) {
        menu = document.createElement('div'); menu.className = 'dmd-select-menu';
        menu.id = `${select.id}-menu`; menu.setAttribute('role', 'listbox');
        trigger.setAttribute('aria-controls', menu.id);
        menu.onkeydown = event => {
          if (event.key === 'Escape' || event.key === 'Tab') { close(); trigger.focus(); if (event.key === 'Escape') event.preventDefault(); return; }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !available.length) return;
          event.preventDefault();
          const at = available.indexOf(active);
          active = event.key === 'Home' ? available[0] : event.key === 'End' ? available.at(-1) : available[(at + (event.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length]; focus();
        };
      }
      menu.setAttribute('aria-label', label?.textContent || select.getAttribute('aria-label') || 'Options');
      // Reuse the menu between openings while still honoring dynamically updated
      // native options, labels and disabled states.
      while (choices.length > select.options.length) choices.pop().remove();
      while (choices.length < select.options.length) {
        const optionIndex = choices.length;
        const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'option');
        button.onclick = () => { select.value = select.options[optionIndex].value; select.dispatchEvent(new Event('change', { bubbles: true })); close(); trigger.focus(); };
        choices.push(button); menu.appendChild(button);
      }
      available = [];
      for (let i = 0; i < choices.length; i++) {
        const option = select.options[i], button = choices[i];
        if (button.textContent !== option.textContent) button.textContent = option.textContent;
        button.setAttribute('aria-selected', String(option.selected)); button.disabled = option.disabled;
        if (!button.disabled) available.push(i);
      }
      document.body.appendChild(menu);
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
      menu.style.width = `${width}px`; menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      const below = window.innerHeight - rect.bottom - 12;
      menu.style.top = ''; menu.style.bottom = '';
      if (below >= 140) { menu.style.top = `${rect.bottom + 5}px`; menu.style.maxHeight = `${Math.min(280, below)}px`; }
      else { menu.style.bottom = `${window.innerHeight - rect.top + 5}px`; menu.style.maxHeight = `${Math.max(60, Math.min(280, rect.top - 12))}px`; }
      active = available.includes(select.selectedIndex) ? select.selectedIndex : available[0];
      trigger.setAttribute('aria-expanded', 'true'); focus();
      document.addEventListener('pointerdown', outside, true); window.addEventListener('resize', close); panel.addEventListener('scroll', close, true); closeCurrent = close;
    };
    trigger.onclick = open;
    trigger.onkeydown = event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); } };
  });
}
