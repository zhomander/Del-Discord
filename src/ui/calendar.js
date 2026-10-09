export function enhanceCalendars(panel) {
  let closeCurrent = () => {};
  const displayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
  const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });
  panel.querySelectorAll('input[type=datetime-local]').forEach(input => {
    const label = input.parentElement.querySelector('label');
    label.htmlFor = input.id; label.id = `${input.id}-label`;
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'dmd-select-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-labelledby', `${label.id} ${input.id}-display`);
    const text = document.createElement('span'); text.id = `${input.id}-display`; trigger.append(text);
    input.classList.add('dmd-native-select'); input.tabIndex = -1; input.after(trigger);
    const sync = () => { text.textContent = input.value ? displayFormat.format(new Date(input.value)) : 'Choose date & time'; trigger.disabled = input.disabled; };
    input.addEventListener('change', sync); sync();
    let picker, selected, month, heading, hours, minutes, apply, renderedMonth, selectedButton;
    const days = [], dates = [];
    const button = (name, action) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = name; node.onclick = action; return node; };
    const render = () => {
      const key = `${month.getFullYear()}-${month.getMonth()}`;
      // Selecting a day or reopening this month only changes its highlight.
      // Date labels and the 42 day controls remain stable between renders.
      if (key !== renderedMonth) {
        renderedMonth = key; heading.textContent = monthFormat.format(month);
        const offset = (month.getDay() + 6) % 7;
        for (let i = 0; i < days.length; i++) {
          const date = dates[i] = new Date(month.getFullYear(), month.getMonth(), i - offset + 1);
          const day = days[i]; day.textContent = String(date.getDate());
          day.setAttribute('aria-label', dayFormat.format(date));
          day.classList.toggle('outside', date.getMonth() !== month.getMonth());
        }
      }
      const selectedDate = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate()).getTime();
      const nextSelected = days[dates.findIndex(date => date.getTime() === selectedDate)];
      if (selectedButton !== nextSelected) {
        selectedButton?.classList.remove('selected'); nextSelected?.classList.add('selected'); selectedButton = nextSelected;
      }
    };
    const close = () => {
      picker?.remove(); trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true); panel.removeEventListener('scroll', close, true); window.removeEventListener('resize', close);
      if (closeCurrent === close) closeCurrent = () => {};
    };
    const outside = event => { if (!picker.contains(event.target) && !trigger.contains(event.target)) close(); };
    const createPicker = () => {
      picker = document.createElement('div'); picker.className = 'dmd-calendar'; picker.setAttribute('role', 'dialog');
      const header = document.createElement('div'); header.className = 'dmd-calendar-header';
      heading = document.createElement('span');
      const grid = document.createElement('div'); grid.className = 'dmd-calendar-grid';
      for (const day of ['Mo','Tu','We','Th','Fr','Sa','Su']) { const span = document.createElement('span'); span.textContent = day; grid.append(span); }
      for (let i = 0; i < 42; i++) {
        const day = button('', () => { selected = dates[i]; render(); });
        days.push(day); grid.append(day);
      }
      hours = document.createElement('input'); hours.type = 'number'; hours.min = '0'; hours.max = '23'; hours.setAttribute('aria-label', 'Hour');
      minutes = document.createElement('input'); minutes.type = 'number'; minutes.min = '0'; minutes.max = '59'; minutes.setAttribute('aria-label', 'Minute');
      const previous = button('‹', () => { month.setMonth(month.getMonth() - 1); render(); }); previous.setAttribute('aria-label', 'Previous month');
      const next = button('›', () => { month.setMonth(month.getMonth() + 1); render(); }); next.setAttribute('aria-label', 'Next month');
      header.append(previous, heading, next);
      const time = document.createElement('div'); time.className = 'dmd-calendar-time'; const timeLabel = document.createElement('span'); timeLabel.textContent = 'Time'; time.append(timeLabel, hours, document.createTextNode(':'), minutes);
      const footer = document.createElement('div'); footer.className = 'dmd-calendar-footer';
      const clear = button('Clear', () => { input.value = ''; input.dispatchEvent(new Event('change', { bubbles: true })); close(); trigger.focus(); });
      const cancel = button('Cancel', () => { close(); trigger.focus(); });
      apply = button('Apply', () => {
        if (!hours.value || !minutes.value || !hours.checkValidity() || !minutes.checkValidity()) { (!hours.checkValidity() || !hours.value ? hours : minutes).focus(); return; }
        const pad = value => String(value).padStart(2, '0');
        input.value = `${selected.getFullYear()}-${pad(selected.getMonth()+1)}-${pad(selected.getDate())}T${pad(hours.value)}:${pad(minutes.value)}`;
        input.dispatchEvent(new Event('change', { bubbles: true })); close(); trigger.focus();
      });
      footer.append(clear, cancel, apply); picker.append(header, grid, time, footer);
      picker.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); } };
    };
    trigger.onclick = () => {
      closeCurrent(); sync();
      if (input.disabled) return;
      selected = input.value ? new Date(input.value) : new Date();
      month = new Date(selected.getFullYear(), selected.getMonth(), 1);
      if (!picker) createPicker();
      picker.setAttribute('aria-label', label.textContent);
      hours.value = String(selected.getHours()); minutes.value = String(selected.getMinutes());
      render(); document.body.append(picker);
      const rect = trigger.getBoundingClientRect(); picker.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 298))}px`;
      picker.style.top = `${Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - picker.offsetHeight - 8))}px`;
      trigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside, true); panel.addEventListener('scroll', close, true); window.addEventListener('resize', close); closeCurrent = close;
      apply.focus();
    };
  });
}
