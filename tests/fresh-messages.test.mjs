import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteMessages } from '../src/features/messages.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const channelId = '123456789012345678', guildId = '234567890123456789';
const message = (id, extra = {}) => ({ id, channel_id: channelId, author: { id: 'self' }, type: 0, content: 'hello', attachments: [], pinned: false, ...extra });
const base = { token: 'test', authorId: 'self', guildId: '@me', channelId, freshHistory: true, collectAll: true, skipConfirm: true, log: () => {}, stopCheck: () => false };
function setup(t) {
  t.mock.method(globalThis, 'setTimeout', callback => { callback(); return 0; });
  for (const [key, value] of [['document', { title: 'Test' }], ['location', { pathname: `/channels/@me/${channelId}` }]]) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
}

test('each run scans fresh history and finds new messages even when search stays empty', async t => {
  setup(t);
  const requests = [], writes = [], progress = [], logs = [];
  let latest;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: new URL(url), options });
    if (options.method === 'DELETE') { writes.push(url.split('/').at(-1)); return new Response(null, { status: 204 }); }
    if (url.includes('/search')) return Response.json({ messages: [], total_results: 0 });
    if (url.includes('/messages?')) return Response.json(latest && !new URL(url).searchParams.has('before') ? [latest] : []);
    return Response.json(latest);
  });
  const options = { ...base, progress: (...values) => progress.push(values), log: (_type, text) => logs.push(text) };
  assert.equal((await deleteMessages(options)).deleted, 0);
  assert.ok(logs.some(text => text.includes('No messages matched')));
  for (const id of ['200', '300']) {
    latest = message(id);
    assert.equal((await deleteMessages(options)).deleted, 1);
  }
  assert.deepEqual(writes, ['200', '300']);
  assert.equal(requests.filter(request => request.url.pathname.endsWith('/search')).length, 3);
  assert.equal(requests.filter(request => request.url.pathname.endsWith('/messages') && !request.url.searchParams.has('before')).length, 3);
  assert.ok(requests.filter(request => request.url.pathname.endsWith('/messages') || request.url.pathname.endsWith('/search')).every(request => request.options.cache === 'no-store'));
  assert.equal(progress.filter(([done]) => done === 0).length, 3);
  assert.equal(options.minId, undefined);
  assert.equal(options.maxId, undefined);
});

test('fresh scan merges above indexed messages, preserves filters and oldest-first order without duplicate deletes', async t => {
  setup(t);
  const writes = [], searches = [];
  const messages = [message('400', { author: { id: 'other' } }), message('300', { pinned: true }), message('200'), message('100')];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method) { writes.push(url.split('/').at(-1)); return new Response(null, { status: 204 }); }
    if (url.includes('/search')) {
      searches.push(new URL(url));
      return Response.json({ messages: searches.length === 1 ? [[{ ...message('100'), hit: true }]] : [] });
    }
    if (url.includes('/messages?')) return Response.json(messages);
    return Response.json(messages.find(item => item.id === url.split('/').at(-1)));
  });
  const result = await deleteMessages({ ...base, order: 'asc', minId: '50', maxId: '500' });
  assert.equal(result.deleted, 2);
  assert.equal(result.skipped, 2);
  assert.deepEqual(writes, ['100', '200']);
  assert.equal(searches[0].searchParams.get('min_id'), '50');
  assert.equal(searches[1].searchParams.get('min_id'), '100');
});

test('server cleanup checks fresh text channel history and respects NSFW selection', async t => {
  setup(t);
  const threadId = '567890123456789012';
  const calls = [], writes = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(url);
    if (options.method) { writes.push(url); return new Response(null, { status: 204 }); }
    if (url.includes('/search')) return Response.json({ messages: [] });
    if (url.endsWith('/threads/active')) return Response.json({ threads: [{ id: threadId, parent_id: channelId, type: 11, guild_id: guildId }] });
    if (url.endsWith('/channels')) return Response.json([{ id: channelId, type: 0, guild_id: guildId }, { id: '345678901234567890', type: 0, nsfw: true }, { id: '456789012345678901', type: 2 }, { id: '678901234567890123', type: 0 }]);
    if (url.includes('678901234567890123')) return new Response(null, { status: 403 });
    if (url.includes('/messages?')) return Response.json(new URL(url).searchParams.has('before') ? [] : [message(url.includes(threadId) ? '300' : '200', { channel_id: url.includes(threadId) ? threadId : channelId })]);
    return Response.json(message(url.includes(threadId) ? '300' : '200', { channel_id: url.includes(threadId) ? threadId : channelId }));
  });
  assert.equal((await deleteMessages({ ...base, guildId, channelId: undefined })).deleted, 2);
  assert.equal(writes.length, 2);
  assert.ok(!calls.some(url => url.includes('345678901234567890') || url.includes('456789012345678901')));
});

test('rebuilt userscript scans again after an empty run and previews an unindexed new message', async t => {
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/@me/${channelId}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  dom.window.setTimeout = callback => { callback(); return 0; };
  let latest, searches = 0, historyStarts = 0;
  const writes = [];
  dom.window.fetch = async (url, options) => {
    if (options?.method === 'DELETE') { writes.push(url); return new Response(null, { status: 204 }); }
    if (url.endsWith('/users/@me')) return Response.json({ id: 'self' });
    if (url.endsWith(`/channels/${channelId}`)) return Response.json({ id: channelId, type: 1 });
    if (url.includes('/search')) { searches++; return Response.json({ messages: [], total_results: 0 }); }
    if (url.includes('/messages?')) {
      const firstPage = !new URL(url).searchParams.has('before');
      if (firstPage) historyStarts++;
      return Response.json(latest && firstPage ? [latest] : []);
    }
    return Response.json(latest);
  };
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  const doc = dom.window.document;
  doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  doc.querySelector('#dmd-token').value = 'test';
  await doc.querySelector('#dmd-start').onclick();
  assert.match(doc.querySelector('#dmd-log').textContent, /No messages matched/);
  latest = message('200', { content: 'new message since loading the script' });
  const run = doc.querySelector('#dmd-start').onclick();
  for (let count = 0; count < 200 && !doc.querySelector('.dmd-confirm-box'); count++) await Promise.resolve();
  const popup = doc.querySelector('.dmd-confirm-box');
  assert.ok(popup);
  assert.match(popup.textContent, /new message since loading the script/);
  assert.equal(writes.length, 0);
  popup.querySelector('.dmd-red').click();
  await run;
  assert.equal(searches, 2);
  assert.equal(historyStarts, 2);
  assert.equal(writes.length, 1);
});

test('fresh scan failure or stop prevents changes to collected search matches', async t => {
  setup(t);
  for (const mode of ['failure', 'stop', 'malformed', 'stalled']) {
    let searches = 0, stopped = false, writes = 0;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (options.method) writes++;
      if (url.includes('/search')) return Response.json({ messages: searches++ ? [] : [[{ ...message('100'), hit: true }]] });
      if (mode === 'stop') stopped = true;
      if (mode === 'failure') return new Response(null, { status: 403 });
      if (mode === 'malformed') return Response.json({ messages: [] });
      return Response.json([message('200')]);
    });
    const run = deleteMessages({ ...base, stopCheck: () => stopped });
    if (mode === 'stop') assert.equal((await run).stopped, true);
    else await assert.rejects(run, /Fresh message scan failed|invalid message history|did not advance/);
    assert.equal(writes, 0);
  }
});

test('fresh channel history respects NSFW filtering and rejects a mismatched server', async t => {
  setup(t);
  let actualGuild = guildId, historyReads = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('/search')) return Response.json({ messages: [] });
    if (url.endsWith(`/channels/${channelId}`)) return Response.json({ id: channelId, guild_id: actualGuild, type: 0, nsfw: true });
    historyReads++;
    return Response.json([]);
  });
  assert.equal((await deleteMessages({ ...base, guildId })).deleted, 0);
  assert.equal(historyReads, 0);
  await deleteMessages({ ...base, guildId, includeNsfw: true });
  assert.equal(historyReads, 1);
  actualGuild = '345678901234567890';
  await assert.rejects(deleteMessages({ ...base, guildId, includeNsfw: true }), /outside the selected server/);
  assert.equal(historyReads, 1);
});
