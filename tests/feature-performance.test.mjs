import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { apiFetch } from '../src/discord/api.js';
import { deleteMessages } from '../src/features/messages.js';
import { cleanupForumThread } from '../src/features/forum-threads.js';
import { compareMessageIds, sortMessages } from '../src/features/message-filters.js';
import { createMessageCollection } from '../src/features/message-collection.js';
import { runDirectMessages } from '../src/features/direct-messages.js';
import { createQueue } from '../src/features/queue.js';
import { removeReactions } from '../src/features/reactions.js';
import { runState } from '../src/utils/run-state.js';

const channel = '123456789012345678', forum = '234567890123456789', guild = '345678901234567890';
const base = { token: 'feature-test', authorId: 'self', channelId: channel, guildId: guild, skipConfirm: true, log: () => {} };
const message = (id, extra = {}) => ({ id, channel_id: channel, author: { id: 'self', username: 'Me' }, type: 0, content: 'ordinary text', pinned: false, attachments: [], ...extra });

function globalValue(t, key, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
}
function setup(t) {
  const dom = new JSDOM('<div id="dmd-multi-list"></div><span id="dmd-multi-count"></span>', { url: 'https://discord.com' });
  globalValue(t, 'document', dom.window.document); globalValue(t, 'localStorage', dom.window.localStorage);
  globalValue(t, 'location', { pathname: `/channels/${guild}/${channel}` });
  t.after(() => dom.window.close());
  t.mock.method(globalThis, 'setTimeout', callback => { callback(); return 0; });
  return dom.window.document;
}
async function popup(doc) {
  for (let index = 0; index < 200; index++) {
    const box = doc.querySelector('.dmd-confirm-box');
    if (box) return box;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Expected confirmation');
}

test('decimal snowflake sorting agrees with BigInt across lengths and preserves exact high IDs', () => {
  const ids = ['9999999999999999999999', '9', '0009', '10', '1000000000000000000', '999999999999999999', '0', '00', '1000000000000000001'];
  for (const left of ids) for (const right of ids) {
    assert.equal(compareMessageIds(left, right), BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0);
  }
  const input = ids.map(id => ({ id }));
  const expected = [...input].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
  assert.deepEqual(sortMessages(input, 'asc'), expected);
  assert.deepEqual(input.map(value => value.id), ids);
});

test('search uses exclusive cursors and page deduplication for overlapping results in both directions', async t => {
  setup(t);
  for (const order of ['asc', 'desc']) {
    const ids = order === 'asc' ? ['100', '200', '300'] : ['300', '200', '100'];
    const pages = [[ids[0], ids[1], ids[0]], [ids[0], ids[1], ids[2], ids[2]], []];
    const writes = [], scans = [];
    let index = 0;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (options.method) { writes.push(url.split('/').at(-1)); return new Response(null, { status: 204 }); }
      if (url.includes('/search')) return Response.json({ messages: pages[index++].map(id => [{ ...message(id), hit: true }]), total_results: 3 });
      return Response.json(message(url.split('/').at(-1)));
    });
    const result = await deleteMessages({ ...base, order, collectAll: true, progress: (done, total, phase) => { if (phase === 'Scanning') scans.push(done); } });
    assert.equal(result.deleted, 3); assert.equal(result.skipped, 0);
    assert.deepEqual(writes, ids); assert.deepEqual(scans, [0, 2, 3]);
  }
});

test('thread scan deduplicates overlapping pages without acting on already-scanned messages', async t => {
  setup(t);
  const writes = [], scans = [];
  const pages = [['300', '200', '300'], ['300', '200', '100', '100'], []];
  let index = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method) { writes.push(url.split('/').at(-1)); return new Response(null, { status: 204 }); }
    if (url.endsWith(`/channels/${channel}`)) return Response.json({ id: channel, type: 11, parent_id: forum });
    if (url.endsWith(`/channels/${forum}`)) return Response.json({ id: forum, type: 15, guild_id: guild });
    if (url.includes('?')) return Response.json(pages[index++].map(id => message(id)));
    return Response.json(message(url.split('/').at(-1)));
  });
  const result = await cleanupForumThread({ ...base, progress: (done, total, phase) => { if (phase === 'Scanning thread') scans.push(done); } });
  assert.equal(result.deleted, 3); assert.equal(result.skipped, 0);
  assert.deepEqual(writes, ['300', '200', '100']); assert.deepEqual(scans, [2, 3]);
});

test('a waiting API caller honors a cooldown extended by another in-flight response', async t => {
  const timers = [], calls = [];
  let releaseSlow;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { timers.push({ callback, delay }); return 0; });
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    if (url.endsWith('/slow')) return new Promise(resolve => { releaseSlow = resolve; });
    if (url.endsWith('/first')) return Response.json({}, { headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '1' } });
    return Response.json({});
  });
  const options = { headers: { Authorization: 'extended-feature-cooldown' } };
  const slow = apiFetch('https://discord.com/slow', options);
  await apiFetch('https://discord.com/first', options);
  const waiting = apiFetch('https://discord.com/waiting', options);
  releaseSlow(Response.json({}, { headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '3' } }));
  await slow;
  assert.equal(timers.length, 2);
  timers[0].callback();
  for (let index = 0; index < 20; index++) await Promise.resolve();
  assert.deepEqual(calls, ['https://discord.com/slow', 'https://discord.com/first']);
  timers[1].callback(); await waiting;
  assert.equal(calls.at(-1), 'https://discord.com/waiting');
});

test('collection supports compact action fields while keeping exactly twenty rich previews', () => {
  const collection = createMessageCollection('desc', value => ({ id: value.id, channel_id: value.channel_id, content: value.content }));
  const batch = Array.from({ length: 200 }, (_, index) => message(String(1000 + index), { embeds: [{ description: 'x'.repeat(10000) }] }));
  collection.add(batch.slice(100)); collection.add(batch.slice(0, 100));
  const collected = collection.finish();
  assert.equal(collected.filter(value => value.embeds).length, 20);
  assert.equal(collected.every(value => value.content === 'ordinary text'), true);
  assert.deepEqual(collected.filter(value => value.embeds).map(value => value.id), batch.slice(-20).map(value => value.id));
});

test('direct-ID compact snapshots preserve edits beyond the twenty-message preview without extra reads', async t => {
  const doc = setup(t), requests = [], writes = [];
  const ids = Array.from({ length: 23 }, (_, index) => (123456789012345678n + BigInt(index)).toString());
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(url);
    if (options.method) { writes.push({ id: url.split('/').at(-1), body: JSON.parse(options.body) }); return Response.json({}); }
    return Response.json(message(url.split('/').at(-1), {
      content: 'caption https://example.com/from-text.png',
      embeds: [
        { image: { url: 'https://example.com/from-embed.png' }, description: 'x'.repeat(10000) },
        { url: 'https://example.com/explicit-embed', image: { url: 'https://example.com/linked-image.png' }, description: 'x'.repeat(10000) },
      ],
      attachments: [{ id: 'file', filename: 'image.png', description: 'x'.repeat(10000) }],
    }));
  });
  const task = runDirectMessages({ ...base, skipConfirm: false, targets: ids.map(messageId => ({ channelId: channel, messageId })), action: 'preserve' });
  const box = await popup(doc);
  assert.equal(writes.length, 0); assert.match(box.textContent, /Keep: https:\/\/example.com\/from-text.png/);
  box.querySelector('.dmd-red').click();
  assert.equal((await task).overwritten, 23);
  assert.equal(requests.length, 46);
  assert.ok(writes.every(write => write.body.content === 'https://example.com/from-text.png\nhttps://example.com/from-embed.png\nhttps://example.com/explicit-embed'));
});

test('queue identity updates and reorders reuse existing rows and keep their actions correct', t => {
  const doc = setup(t);
  const queue = createQueue({ $: selector => doc.querySelector(selector), log: () => {} });
  queue.addQueueItems(Array.from({ length: 200 }, (_, index) => ({ guildId: '@me', channelId: String(1000 + index), label: `Person ${index}` })));
  const initial = [...doc.querySelectorAll('.dmd-queue-row')];
  let created = 0;
  const createElement = doc.createElement.bind(doc);
  t.mock.method(doc, 'createElement', (...args) => { created++; return createElement(...args); });
  queue.updateIdentity(queue.getItems()[0], { label: 'Updated person', icon: 'https://cdn.discordapp.com/embed/avatars/0.png', iconName: 'Updated' });
  assert.equal(created, 1); assert.deepEqual([...doc.querySelectorAll('.dmd-queue-row')], initial);
  initial[0].querySelectorAll('button')[1].click();
  assert.equal(queue.getItems()[1].channelId, '1000');
  initial[0].querySelector('.dmd-red').click();
  assert.equal(queue.getItems().some(item => item.channelId === '1000'), false);
  assert.equal(created, 1); assert.equal(doc.querySelectorAll('.dmd-queue-row').length, 199);
  assert.equal(initial.slice(1).every(row => row.isConnected), true);
  const observer = new doc.defaultView.MutationObserver(() => {});
  observer.observe(doc.querySelector('#dmd-multi-list'), { subtree: true, attributes: true, childList: true, characterData: true });
  queue.renderQueue();
  assert.equal(observer.takeRecords().length, 0); observer.disconnect();
});

test('ID queues store a short job key and deduplicate exact targets across order changes and reloads', t => {
  const doc = setup(t), warnings = [];
  const queue = createQueue({ $: selector => doc.querySelector(selector), log: (type, text) => warnings.push({ type, text }) });
  const targets = Array.from({ length: 10000 }, (_, index) => ({ channelId: channel, messageId: (123456789012345678n + BigInt(index)).toString() }));
  queue.addIdJob(targets, { action: 'delete' });
  assert.equal(queue.getItems().length, 1); assert.ok(queue.getItems()[0].channelId.length < 64);
  queue.addIdJob([...targets].reverse(), { action: 'overwrite', overwriteText: 'different action' });
  assert.equal(queue.getItems().length, 1); assert.equal(warnings.at(-1).type, 'warn');
  const stored = JSON.parse(globalThis.localStorage.getItem('del_discord_v1_queue'));
  assert.equal(stored[0].targets.length, 10000);
  const legacyKey = `ids:${targets.map(target => `${target.channelId}/${target.messageId}`).sort().join(',')}`;
  assert.ok(legacyKey.length - stored[0].channelId.length > 379000);
  // Legacy keys remain runnable and duplicate detection uses their targets.
  stored[0].channelId = legacyKey;
  globalThis.localStorage.setItem('del_discord_v1_queue', JSON.stringify(stored));
  const reloaded = createQueue({ $: selector => doc.querySelector(selector), log: () => {} });
  reloaded.addIdJob([...targets].reverse(), {});
  assert.equal(reloaded.getItems().length, 1);
  const distinct = [...targets]; distinct[0] = { ...distinct[0], channelId: forum };
  reloaded.addIdJob(distinct, {});
  assert.equal(reloaded.getItems().length, 2);
  assert.equal(doc.querySelectorAll('.dmd-queue-row').length, 2);
  assert.ok(reloaded.getItems()[1].channelId.length < 64);
  reloaded.completeItem({ ...reloaded.getItems()[0] });
  assert.equal(reloaded.getItems().length, 1);
  assert.deepEqual(reloaded.getItems()[0].targets, distinct);
});

test('reaction previews are bounded while every approved unique reaction is removed', async t => {
  const doc = setup(t), writes = [];
  t.after(() => { runState.reactionStopped = false; });
  const reactions = Array.from({ length: 25 }, (_, index) => ({ me: true, emoji: { id: String(123456789012345678n + BigInt(index)), name: `emoji${index}` } }));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method) { writes.push(url); return new Response(null, { status: 204 }); }
    return Response.json([message('300', { reactions: [...reactions, reactions[0]], content: 'Preview me' })]);
  });
  const task = removeReactions({ token: 'feature-reactions', channelId: channel, authorId: 'self', scanLimit: 1, log: () => {} });
  const box = await popup(doc);
  assert.match(box.textContent, /Remove 25 of your reactions/);
  assert.match(box.querySelector('.dmd-confirm-details').textContent, /Showing the first 20 of 25 reactions/);
  assert.equal(box.querySelector('.dmd-confirm-details').textContent.includes('emoji24'), false);
  box.querySelector('.dmd-red').click(); await task;
  assert.equal(writes.length, 25); assert.equal(new Set(writes).size, 25);
});

test('a stalled reaction page stops before confirmation or removal', async t => {
  const doc = setup(t), writes = [];
  t.after(() => { runState.reactionStopped = false; });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method) writes.push(url);
    return Response.json([message('300', { reactions: [{ me: true, emoji: { name: '👍' } }] })]);
  });
  await assert.rejects(removeReactions({ token: 'feature-stall', channelId: channel, authorId: 'self', scanLimit: 2, log: () => {} }), /did not advance/);
  assert.equal(writes.length, 0); assert.equal(doc.querySelector('.dmd-confirm-box'), null);
});
