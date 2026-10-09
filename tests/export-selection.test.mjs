import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { askExportSelection } from '../src/ui/export-selection.js';
import { conversationsToCsv } from '../src/features/export.js';
import { parseCsv } from '../src/utils/csv.js';

test('export dialog requires selection, supports select all and CSV, and cancels cleanly', async t => {
  const dom = new JSDOM('<div id="dmd-panel"></div>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  t.after(() => { if (previous) globalThis.document = previous; else delete globalThis.document; dom.window.close(); });
  const items = [{ channelId: '1', label: 'Alice' }, { channelId: '2', label: 'Bob' }];
  const result = askExportSelection(items); const doc = dom.window.document;
  const exportButton = doc.querySelector('.dmd-confirm-actions button:last-child');
  assert.equal(exportButton.disabled, true);
  doc.querySelector('.dmd-export-list input').click();
  assert.equal(exportButton.disabled, false);
  doc.querySelector('.dmd-confirm-box > button').click();
  doc.querySelector('.dmd-export-list input').click();
  doc.querySelector('input[value="csv"]').click(); exportButton.click();
  assert.deepEqual(await result, { conversations: [items[1]], format: 'csv' });
  const cancelled = askExportSelection(items);
  doc.querySelector('.dmd-confirm-actions button:first-child').click();
  assert.equal(await cancelled, false);
  assert.equal(doc.querySelector('.dmd-confirm-overlay'), null);
});

test('CSV export preserves conversation identifiers, nested data and quoted multiline text', () => {
  const csv = conversationsToCsv([{ guildId: '@me', channelId: '123456789123456789', label: 'Alice', messages: [{ id: '987654321987654321', content: 'hello, "Alice"\nnext line', attachments: [{ url: 'https://example.com/a' }] }] }]);
  const [header, row] = parseCsv(csv);
  assert.equal(row[header.indexOf('content')], 'hello, "Alice"\nnext line');
  assert.equal(row[header.indexOf('id')], '987654321987654321');
  assert.deepEqual(JSON.parse(row[header.indexOf('attachments')]), [{ url: 'https://example.com/a' }]);
});

test('export select-all cannot enable an empty conversation export', async t => {
  const dom = new JSDOM('<div id="dmd-panel"></div>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  t.after(() => { if (previous) globalThis.document = previous; else delete globalThis.document; dom.window.close(); });
  const result = askExportSelection([]), doc = dom.window.document;
  const all = doc.querySelector('.dmd-confirm-box > button'), exportButton = doc.querySelector('.dmd-confirm-actions button:last-child');
  assert.equal(all.disabled, true); all.click(); assert.equal(exportButton.disabled, true);
  doc.querySelector('.dmd-confirm-actions button:first-child').click(); assert.equal(await result, false);
});
