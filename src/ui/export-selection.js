import { askPopup } from './confirm.js';

export function askExportSelection(conversations) {
  const selected = new Set();
  let format = 'json';
  return askPopup({
    title: 'Export Conversations', message: 'Choose conversations and a file format. The selected Before/After range applies.',
    yesText: 'Export', noText: 'Cancel',
    getResult: () => ({ conversations: conversations.filter((_, index) => selected.has(index)), format }),
    render: ({ box, yes }) => {
      yes.disabled = true;
      const all = document.createElement('button'); all.type = 'button'; all.className = 'dmd-btn'; all.textContent = 'Select all';
      all.disabled = !conversations.length;
      const list = document.createElement('div'); list.className = 'dmd-export-list';
      list.onchange = event => {
        const input = event.target, index = Number(input.value);
        if (input.checked) selected.add(index); else selected.delete(index);
        yes.disabled = !selected.size;
      };
      conversations.forEach((item, index) => {
        const label = document.createElement('label'); label.className = 'dmd-check';
        const input = document.createElement('input'); input.type = 'checkbox'; input.value = String(index);
        label.append(input, document.createTextNode(item.label || item.channelId)); list.append(label);
      });
      all.onclick = () => { list.querySelectorAll('input').forEach(input => { input.checked = true; selected.add(Number(input.value)); }); yes.disabled = !selected.size; };
      const formats = document.createElement('fieldset'); formats.className = 'dmd-export-formats';
      const legend = document.createElement('legend'); legend.textContent = 'File format'; formats.append(legend);
      for (const value of ['json', 'csv']) {
        const label = document.createElement('label'); label.className = 'dmd-check';
        const input = document.createElement('input'); input.type = 'radio'; input.name = 'dmd-export-format'; input.value = value; input.checked = value === format;
        input.onchange = () => { if (input.checked) format = value; };
        label.append(input, document.createTextNode(value.toUpperCase())); formats.append(label);
      }
      box.append(all, list, formats);
    },
  });
}
