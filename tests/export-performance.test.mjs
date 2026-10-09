import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationToBlob, conversationsToCsv } from '../src/features/export.js';
import { RunStoppedError } from '../src/discord/api.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { parseCsv } from '../src/utils/csv.js';

const conversation = count => ({
  exportedAt: '2026-10-09T12:00:00.000Z', guildId: '@me', channelId: '123456789012345678',
  label: 'A "quoted" conversation', range: { after: null, before: null }, messageCount: count,
  messages: Array.from({ length: count }, (_, index) => ({
    id: String(123456789012345678n + BigInt(index)), content: `row ${index}: 😀 "line"\n` + 'contents '.repeat(200),
    attachments: [{ filename: 'image.png', url: 'https://example.invalid/image.png' }],
    embeds: [], reactions: [], mentions: [], referencedMessage: null
  }))
});

test('chunked JSON export preserves complete metadata, message bodies and empty conversations', async () => {
  for (const count of [0, 120]) {
    const data = conversation(count);
    const blob = await conversationToBlob(data);
    assert.equal(blob.type, 'application/json;charset=utf-8');
    assert.deepEqual(JSON.parse(await blob.text()), data);
  }
});

test('chunked CSV exports combine with one header and preserve quoted multiline UTF-8 data', async () => {
  const data = [conversation(120), conversation(0), conversation(2)];
  const blobs = await Promise.all(data.map((item, index) => conversationToBlob(item, { format: 'csv', includeCsvHeader: index === 0 })));
  assert.equal(blobs[1].size, 0);
  const combined = new Blob([blobs[0], '\r\n', blobs[2]]);
  assert.equal(await combined.text(), conversationsToCsv(data));
});

test('large serialization yields to the event loop and cancellation discards the artifact', async t => {
  let stopped = false, turns = 0, clock = 0;
  t.mock.method(performance, 'now', () => clock += 10);
  t.mock.method(globalThis, 'setTimeout', callback => { turns++; stopped = true; callback(); return 0; });
  await assert.rejects(conversationToBlob(conversation(120), { stopCheck: () => stopped }), RunStoppedError);
  assert.equal(turns, 1);
  await assert.rejects(conversationToBlob(conversation(0), { stopCheck: () => true }), RunStoppedError);
});

test('bundled queue CSV export combines empty and nonempty conversations with a single header', async t => {
  const emptyChannel = '234567890123456789', dataChannel = '345678901234567890';
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/@me/${dataChannel}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document, downloads = [], methods = [];
  dom.window.Blob = Blob;
  dom.window.URL.createObjectURL = blob => { downloads.push(blob); return 'blob:test'; };
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  dom.window.setTimeout = callback => { callback(); return 0; };
  dom.window.localStorage.setItem('del_discord_v1_queue', JSON.stringify([
    { guildId: '@me', channelId: emptyChannel, label: 'Empty' },
    { guildId: '@me', channelId: dataChannel, label: 'With text' },
  ]));
  dom.window.fetch = async (url, options) => {
    methods.push(options?.method || 'GET');
    if (url.endsWith('/users/@me')) return Response.json({ id: 'self' });
    const request = new URL(url);
    if (request.pathname.includes(dataChannel) && !request.searchParams.has('before')) return Response.json([{
      id: '456789012345678901', type: 0, content: '😀, "quote"\nnext line', author: { id: 'self' },
    }]);
    return Response.json([]);
  };
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  doc.querySelector('#dmd-token').value = 'export-test';
  const task = doc.querySelector('#dmd-multi-export').onclick();
  for (let attempt = 0; attempt < 100 && !doc.querySelector('.dmd-export-list'); attempt++) await new Promise(resolve => setImmediate(resolve));
  const popup = doc.querySelector('.dmd-confirm-box');
  assert.ok(popup);
  popup.querySelector('.dmd-export-list').previousElementSibling.click();
  popup.querySelector('input[value="csv"]').click();
  popup.querySelectorAll('.dmd-confirm-actions button')[1].click();
  await task;
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].type, 'text/csv;charset=utf-8');
  const rows = parseCsv(await downloads[0].text());
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], dataChannel);
  assert.equal(rows[1][2], 'With text');
  assert.equal(rows[1][8], '😀, "quote"\nnext line');
  assert.equal(JSON.parse(dom.window.localStorage.getItem('del_discord_v1_queue')).length, 2);
  assert.ok(methods.every(method => method === 'GET'));
});
