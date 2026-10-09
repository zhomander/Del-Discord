import { rand } from '../src/utils/timing.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageCollection } from '../src/features/message-collection.js';
import { countCsvMessages } from '../src/features/history/count-csv.js';
import { apiFetch } from '../src/discord/api.js';
import { JSDOM } from 'jsdom';
import { createLog } from '../src/ui/log.js';
import { LOG_ENTRY_LIMIT, LOG_DOM_LIMIT } from '../src/config.js';

const channel = '234567890123456789';

test('compact scans retain full confirmation previews in either order while releasing other message bodies', () => {
  for (const order of ['asc', 'desc']) {
    const collector = createMessageCollection(order);
    const batches = Array.from({ length: 3 }, (_, page) => Array.from({ length: 25 }, (_, offset) => ({ id: String(123456789012345678n + BigInt(page * 25 + offset)), channel_id: channel, content: `message ${page * 25 + offset}`, attachments: [{ filename: 'image.png' }] })));
    batches.reverse().forEach(batch => collector.add(batch));
    const messages = collector.finish();
    assert.equal(messages.length, 75);
    const full = messages.filter(message => message.content !== undefined);
    assert.equal(full.length, 20);
    assert.equal(full.every(message => message.attachments[0].filename === 'image.png'), true);
    const expected = order === 'asc' ? batches.flat().sort((a, b) => a.id.localeCompare(b.id)).slice(0, 20) : batches.flat().sort((a, b) => b.id.localeCompare(a.id)).slice(0, 20);
    assert.deepEqual(new Set(full.map(message => message.id)), new Set(expected.map(message => message.id)));
    assert.equal(messages.every(message => message.channel_id === channel), true);
    assert.equal(messages.filter(message => message.content === undefined).every(message => !message.attachments), true);
  }
});

test('streamed CSV counts quoted multiline messages, UTF-8 and escaped quotes across chunk boundaries', async () => {
  const text = 'ID,Contents\r\n1,"hello\r\nworld"\r\n2,"emoji 😀 and ""quoted"" text"\r\n\r\n3,plain';
  const bytes = new TextEncoder().encode(text);
  const file = { stream: () => new ReadableStream({ start(controller) { for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3)); controller.close(); } }), text: () => { throw new Error('The streaming path must not read the whole file.'); } };
  assert.equal(await countCsvMessages(file), 3);
  assert.equal(await countCsvMessages({ text: async () => text }), 3);
  assert.equal(await countCsvMessages(new Blob(['ID,Contents\n'])), 0);
});

test('rate-limit header cooldown blocks the same account but does not block another account', async t => {
  let release, delay;
  const calls = [];
  t.mock.method(globalThis, 'setTimeout', (callback, wait) => { release = callback; delay = wait; return 0; });
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    return url.endsWith('/first') ? Response.json({}, { headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '1.250' } }) : Response.json({});
  });
  const options = { headers: { Authorization: 'account-a' } };
  await apiFetch('https://discord.com/first', options);
  assert.ok(delay >= 1500 && delay <= 2000);
  const second = apiFetch('https://discord.com/second', options);
  await apiFetch('https://discord.com/other', { headers: { Authorization: 'account-b' } });
  assert.deepEqual(calls, ['https://discord.com/first', 'https://discord.com/other']);
  release(); await second;
  assert.equal(calls.at(-1), 'https://discord.com/second');
});

test('429 backoff respects the longer server header and shares its pause with concurrent callers', async t => {
  let release, delay, requests = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, wait) => { release = callback; delay = wait; return 0; });
  t.mock.method(globalThis, 'fetch', async () => ++requests === 1 ? Response.json({ retry_after: 0.25 }, { status: 429, headers: { 'Retry-After': '2.750' } }) : Response.json({}));
  const options = { headers: { Authorization: 'backoff-account' } };
  const first = apiFetch('https://discord.com/first', options);
  for (let index = 0; index < 20 && !release; index++) await Promise.resolve();
  assert.ok(delay >= 3000 && delay <= 3500);
  const second = apiFetch('https://discord.com/second', options);
  await Promise.resolve(); assert.equal(requests, 1);
  release(); await Promise.all([first, second]);
  assert.equal(requests, 3);
});

test('millisecond jitter includes both bounds and rejects biased random values', t => {
  const sequence = [0, 900, 0xffffffff, 123];
  t.mock.method(globalThis.crypto, 'getRandomValues', values => { values[0] = sequence.shift(); return values; });
  assert.equal(rand(700, 1600), 700);
  assert.equal(rand(700, 1600), 1600);
  assert.equal(rand(700, 1600), 823);
  assert.equal(sequence.length, 0);
});

test('long runs bound exported log entries and visible rows while preserving newest entries', t => {
  const dom = new JSDOM('<pre id="log"></pre>'); const previous = globalThis.document;
  globalThis.document = dom.window.document;
  t.after(() => { if(previous) globalThis.document = previous; else delete globalThis.document; dom.window.close(); });
  const box = globalThis.document.querySelector('#log'); const { log, logEntries } = createLog(box);
  for(let i=0;i<LOG_ENTRY_LIMIT+500;i++) log('info', `entry ${i}`);
  assert.ok(logEntries.length <= LOG_ENTRY_LIMIT); assert.ok(box.childElementCount <= LOG_DOM_LIMIT);
  assert.equal(logEntries.at(-1).message, `entry ${LOG_ENTRY_LIMIT+499}`);
  assert.equal(box.lastChild.textContent, logEntries.at(-1).message);
});
