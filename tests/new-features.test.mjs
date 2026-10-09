import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeCleanupOptions, matchesMessage } from '../src/features/message-filters.js';
import { preservedContent } from '../src/features/preserve-media.js';
import { emptyStats, applyMessageAction } from '../src/features/message-actions.js';
import { deleteMessages } from '../src/features/messages.js';
import { runDirectMessages } from '../src/features/direct-messages.js';
import { listForumThreads, cleanupForumThread } from '../src/features/forum-threads.js';

const guild = '123456789012345678', forum = '234567890123456789', channel = '345678901234567890';
const msg = (id, extra = {}) => ({ id, channel_id: channel, type: 0, author: { id: 'self' }, content: 'text', attachments: [], ...extra });
const base = { token: 'test', guildId: guild, channelId: channel, authorId: 'self', log: () => {} };
function globalValue(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
}
function setup(t) {
  t.mock.method(globalThis, 'setTimeout', callback => { callback(); return 0; });
  const dom = new JSDOM('<body></body>', { url: `https://discord.com/channels/${guild}/${channel}` });
  globalValue(t, 'document', dom.window.document);
  globalValue(t, 'location', dom.window.location);
  t.after(() => dom.window.close());
  return dom.window.document;
}
async function popup(doc) {
  for (let i = 0; i < 200; i++) {
    const box = doc.querySelector('.dmd-confirm-box');
    if (box) return box;
    await Promise.resolve();
  }
  throw new Error('Expected confirmation');
}
const searchPage = messages => Response.json({ messages: messages.map(message => [{ ...message, hit: true }]), total_results: 3 });

test('filename, extension and regex filters match the same asset, including encoded URL filenames', () => {
  const options = normalizeCleanupOptions({ ...base, filename: 'report', extensions: '.PDF, zip', assetRegex: '^report', textRegex: '^hello', regexFlags: 'im' });
  assert.equal(matchesMessage(msg('100', { content: 'HELLO\nhttps://example.com/report%20final.PDF?download=1' }), options), true);
  assert.equal(matchesMessage(msg('100', { content: 'hello', attachments: [{ filename: 'report.txt' }, { filename: 'other.pdf' }] }), options), false);
  assert.equal(matchesMessage(msg('100', { content: 'hello', attachments: [{ filename: 'report.PDF' }] }), options), true);
  assert.equal(matchesMessage(msg('100', { content: 'other', attachments: [{ filename: 'report.PDF' }] }), options), false);
  const inverse = normalizeCleanupOptions({ ...base, extensions: 'exe, zip', assetMode: 'exclude' });
  assert.equal(matchesMessage(msg('100', { content: 'https://example.com/a.exe?x=1' }), inverse), false);
  assert.equal(matchesMessage(msg('100'), inverse), true);
  assert.throws(() => normalizeCleanupOptions({ textRegex: '[' }), /Text regex/);
  assert.throws(() => normalizeCleanupOptions({ assetRegex: 'x', assetRegexFlags: 'g' }), /flags/);
  assert.throws(() => normalizeCleanupOptions({ extensions: '*.tar.gz' }), /extensions/);
});

test('text regex inverse is stable across consecutive messages', () => {
  const options = normalizeCleanupOptions({ ...base, textRegex: 'keep', regexMode: 'exclude' });
  assert.equal(matchesMessage(msg('100', { content: 'KEEP' }), options), false);
  assert.equal(matchesMessage(msg('101', { content: 'KEEP' }), options), false);
  assert.equal(matchesMessage(msg('102'), options), true);
});

test('preserve extracts URLs from markdown, keeps balanced URL parentheses and embedded image links', () => {
  assert.equal(preservedContent(msg('100', { content: 'caption [site](https://example.com/a_(b)) and <https://example.com/pic.png>', embeds: [{ url: 'https://example.com/pic.png' }] })), 'https://example.com/a_(b)\nhttps://example.com/pic.png');
  assert.equal(preservedContent(msg('100', { content: '**https://example.com/a.png** and "https://example.com/b.png"' })), 'https://example.com/a.png\nhttps://example.com/b.png');
  assert.equal(preservedContent(msg('100', { content: 'caption', attachments: [{ id: 'file', filename: 'a.png' }] })), '');
  assert.equal(preservedContent(msg('100')), null);
  assert.equal(preservedContent(msg('100', { embeds: [{ image: { url: 'https://example.com/pic.png' } }] })), 'https://example.com/pic.png');
  assert.equal(preservedContent(msg('100', { content: 'https://example.com/' + 'x'.repeat(2000) })), null);
});

test('preserve edits text without deleting messages, changing attachments or sending mentions', async t => {
  setup(t);
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { writes.push(options); return Response.json({}); });
  const options = normalizeCleanupOptions({ ...base, action: 'preserve' });
  const stats = emptyStats();
  await applyMessageAction(msg('100', { content: '@everyone caption', attachments: [{ id: 'file', filename: 'a.png' }] }), options, stats);
  await applyMessageAction(msg('101'), options, stats);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PATCH');
  assert.deepEqual(JSON.parse(writes[0].body), { content: '', allowed_mentions: { parse: [], replied_user: false } });
  assert.equal(stats.deleted, 0);
  assert.equal(stats.overwritten, 1);
  assert.equal(stats.skipped, 1);
});

test('complete search scan finishes every page before confirmation and applies oldest-first', async t => {
  const doc = setup(t), calls = [];
  let page = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/search')) return searchPage([[msg('100'), msg('200')], [msg('300')], []][page++]);
    if (options.method) return new Response(null, { status: 204 });
    return Response.json(msg(url.split('/').at(-1)));
  });
  const task = deleteMessages({ ...base, collectAll: true, order: 'asc' });
  const box = await popup(doc);
  assert.equal(page, 3);
  assert.equal(calls.some(call => call.options.method), false);
  assert.ok(box.textContent.includes('3 messages'));
  box.querySelector('.dmd-red').click();
  const result = await task;
  assert.equal(result.deleted, 3);
  assert.deepEqual(calls.filter(call => call.options.method).map(call => call.url.split('/').at(-1)), ['100', '200', '300']);
});

test('scan failure, stalled cursor, or cancellation leaves collected messages untouched', async t => {
  const doc = setup(t);
  for (const mode of ['failure', 'stalled', 'cancel']) {
    let page = 0, writes = 0;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (options.method) writes++;
      if (++page === 1) return searchPage([msg('200')]);
      if (mode === 'failure') return new Response(null, { status: 503 });
      return searchPage(mode === 'stalled' ? [msg('200')] : []);
    });
    const task = deleteMessages({ ...base, collectAll: true });
    if (mode === 'cancel') (await popup(doc)).querySelector('.dmd-confirm-actions button').click();
    const result = await task;
    assert.equal(result.deleted, 0);
    assert.equal(writes, 0);
    assert.equal(mode === 'failure' ? result.httpStatus === 503 : mode === 'stalled' ? result.stalled : result.cancelled, true);
  }
});

test('stopping during collection prevents confirmation and all writes', async t => {
  const doc = setup(t);
  let stopped = false, calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; stopped = true; return searchPage([msg('200')]); });
  const result = await deleteMessages({ ...base, collectAll: true, stopCheck: () => stopped });
  assert.equal(result.stopped, true);
  assert.equal(calls, 1);
  assert.equal(doc.querySelector('.dmd-confirm-box'), null);
});

test('collection rechecks ownership and filters before modifying changed messages', async t => {
  const doc = setup(t);
  let page = 0, writes = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method) writes++;
    if (url.includes('/search')) return searchPage(page++ ? [] : [msg('200')]);
    return Response.json(msg('200', { pinned: true }));
  });
  const task = deleteMessages({ ...base, collectAll: true });
  (await popup(doc)).querySelector('.dmd-red').click();
  const result = await task;
  assert.equal(result.skipped, 1);
  assert.equal(writes, 0);
});

const thread = (id, extra = {}) => ({ id, name: id, type: 11, parent_id: forum, guild_id: guild, ...extra });
test('forum discovery filters parent IDs, paginates archived threads, and deduplicates', async t => {
  setup(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(new URL(url));
    if (url.endsWith(`/channels/${forum}`)) return Response.json({ id: forum, type: 15, guild_id: guild });
    if (url.includes('/threads/active')) return Response.json({ threads: [thread(channel), thread('456789012345678901', { parent_id: 'other' })] });
    const before = new URL(url).searchParams.get('before');
    return Response.json(before ? { threads: [thread('567890123456789012', { thread_metadata: { archive_timestamp: '2025-01-01T00:00:00Z' } })], has_more: false } :
      { threads: [thread(channel, { thread_metadata: { archive_timestamp: '2026-01-01T00:00:00Z', archived: true } })], has_more: true });
  });
  const found = await listForumThreads({ token: 'test', forumId: forum });
  assert.equal(found.length, 2);
  assert.equal(found[0].parent_id, forum);
  assert.ok(found.every(item => item.guild_id === guild));
  assert.equal(calls.at(-1).searchParams.get('before'), '2026-01-01T00:00:00Z');
});

test('forum discovery rejects non-forums and nonadvancing archive cursors', async t => {
  setup(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ id: forum, type: 0, guild_id: guild }));
  await assert.rejects(listForumThreads({ token: 'test', forumId: forum }), /forum or media/);
  t.mock.method(globalThis, 'fetch', async url => url.endsWith(`/channels/${forum}`) ? Response.json({ id: forum, type: 15, guild_id: guild }) :
    Response.json({ threads: [thread(channel, { thread_metadata: { archive_timestamp: '2026-01-01' } })], has_more: true }));
  await assert.rejects(listForumThreads({ token: 'test', forumId: forum }), /did not advance/);
});

test('selected forum thread scans history without search and only deletes your matching messages', async t => {
  const doc = setup(t), calls = [];
  let page = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith(`/channels/${channel}`)) return Response.json(thread(channel));
    if (url.endsWith(`/channels/${forum}`)) return Response.json({ id: forum, type: 15, guild_id: guild });
    if (url.includes('?')) return Response.json(page++ ? [] : [msg('300'), msg('200', { author: { id: 'other' } }), msg('100', { pinned: true })]);
    if (options.method) return new Response(null, { status: 204 });
    return Response.json(msg('300'));
  });
  const task = cleanupForumThread(base);
  const box = await popup(doc);
  assert.equal(page, 2);
  assert.equal(calls.some(call => call.options.method), false);
  box.querySelector('.dmd-red').click();
  const result = await task;
  assert.equal(result.deleted, 1);
  assert.equal(result.skipped, 2);
  assert.equal(calls.some(call => call.url.includes('/search')), false);
  assert.ok(calls.filter(call => call.options.method).every(call => call.url.endsWith(`/channels/${channel}/messages/300`)));
});

test('forum thread failure or cancellation never modifies collected messages', async t => {
  setup(t);
  let writes = 0, page = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method) writes++;
    if (url.endsWith(`/channels/${channel}`)) return Response.json(thread(channel));
    if (url.endsWith(`/channels/${forum}`)) return Response.json({ id: forum, type: 15, guild_id: guild });
    return Response.json(page++ ? [msg('200')] : [msg('200')]);
  });
  await assert.rejects(cleanupForumThread(base), /did not advance/);
  assert.equal(writes, 0);
});

test('direct IDs apply new filters and preview the preserve action', async t => {
  const doc = setup(t), writes = [];
  const id = '678901234567890123';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method) writes.push(options);
    return Response.json(msg(id, { content: 'caption https://example.com/a.png' }));
  });
  const task = runDirectMessages({ ...base, targets: [{ channelId: channel, messageId: id }], action: 'preserve', extensions: 'png' });
  const box = await popup(doc);
  assert.ok(box.textContent.includes('Keep: https://example.com/a.png'));
  box.querySelector('.dmd-red').click();
  assert.equal((await task).overwritten, 1);
  assert.equal(JSON.parse(writes[0].body).content, 'https://example.com/a.png');
});

test('bundled UI loads and queues selected forum threads with thread metadata', async t => {
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/${guild}/${forum}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', { get() { return this.parentElement; } });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 500, height: 40, top: 20, left: 400, right: 900 });
  dom.window.fetch = async url => {
    if (url.endsWith('/users/@me')) return Response.json({ id: 'self' });
    if (url.endsWith(`/channels/${forum}`)) return Response.json({ id: forum, type: 15, guild_id: guild });
    return Response.json({ threads: [thread(channel)], has_more: false });
  };
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  doc.querySelector('#dmd-token').value = 'test';
  assert.equal(doc.querySelector('#dmd-collect-all').checked, true);
  doc.querySelector('#dmd-action').value = 'preserve';
  doc.querySelector('#dmd-action').dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.querySelector('#dmd-preserve-note'), null);
  await doc.querySelector('#dmd-forum-load').onclick();
  assert.equal(doc.querySelector('#dmd-forum-list').options.length, 1);
  doc.querySelector('#dmd-forum-list').options[0].selected = true;
  const queueRun = doc.querySelector('#dmd-forum-queue').onclick();
  const queuePopup = await popup(doc);
  queuePopup.querySelectorAll('.dmd-confirm-actions button')[1].click();
  await queueRun;
  const queued = JSON.parse(dom.window.localStorage.getItem('del_discord_v1_queue'));
  assert.equal(queued[0].channelId, channel);
  assert.equal(queued[0].thread, true);
});

test('bundled Messages controls forward regex, asset filters and preserve action through full scan', async t => {
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/${guild}/${channel}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document, writes = [];
  let page = 0;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', { get() { return this.parentElement; } });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 500, height: 40, top: 20, left: 400, right: 900 });
  dom.window.setTimeout = callback => { callback(); return 0; };
  const target = msg('200', { content: 'hello caption https://example.com/report.png' });
  dom.window.fetch = async (url, options) => {
    if (url.includes('/messages?')) return Response.json([]);
    if (url.endsWith('/users/@me')) return Response.json({ id: 'self' });
    if (url.endsWith(`/channels/${channel}`)) return Response.json({ id: channel, type: 0, guild_id: guild });
    if (url.includes('/search')) return searchPage(page++ ? [] : [target, msg('100', { content: 'no match' })]);
    if (options.method) { writes.push(options); return Response.json({}); }
    return Response.json(target);
  };
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  doc.querySelector('#dmd-token').value = 'test';
  doc.querySelector('#dmd-action').value = 'preserve';
  doc.querySelector('#dmd-filename').value = 'report';
  doc.querySelector('#dmd-extensions').value = '.png';
  doc.querySelector('#dmd-text-regex').value = '^hello';
  doc.querySelector('#dmd-asset-regex').value = 'report\\.png';
  const task = doc.querySelector('#dmd-start').onclick();
  const box = await popup(doc);
  assert.equal(page, 2);
  assert.equal(writes.length, 0);
  assert.ok(box.textContent.includes('up to 1 messages'));
  box.querySelector('.dmd-red').click();
  await task;
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PATCH');
  assert.equal(JSON.parse(writes[0].body).content, 'https://example.com/report.png');
  assert.equal(doc.querySelector('#dmd-start').disabled, false);
});

test('forum cleanup honors message boundaries and requested order', async t => {
  const doc = setup(t), writes = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith(`/channels/${channel}`)) return Response.json(thread(channel));
    if (url.endsWith(`/channels/${forum}`)) return Response.json({ id: forum, type: 15, guild_id: guild });
    if (url.includes('?')) {
      assert.equal(new URL(url).searchParams.get('before'), '400');
      return Response.json([msg('300'), msg('200'), msg('100')]);
    }
    if (options.method) { writes.push(url.split('/').at(-1)); return new Response(null, { status: 204 }); }
    return Response.json(msg(url.split('/').at(-1)));
  });
  const task = cleanupForumThread({ ...base, minId: '100', maxId: '400', order: 'asc' });
  (await popup(doc)).querySelector('.dmd-red').click();
  const result = await task;
  assert.equal(result.deleted, 2);
  assert.deepEqual(writes, ['200', '300']);
});

test('forum confirmation cancellation and mid-scan stop prevent mutations', async t => {
  const doc = setup(t);
  let stopped = false, writes = 0, page = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method) writes++;
    if (url.endsWith(`/channels/${channel}`)) return Response.json(thread(channel));
    if (url.endsWith(`/channels/${forum}`)) return Response.json({ id: forum, type: 15, guild_id: guild });
    return Response.json(page++ ? [] : [msg('200')]);
  });
  const task = cleanupForumThread(base);
  (await popup(doc)).querySelector('.dmd-confirm-actions button').click();
  assert.equal((await task).cancelled, true);
  assert.equal(writes, 0);
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith(`/channels/${channel}`)) return Response.json(thread(channel));
    if (url.endsWith(`/channels/${forum}`)) return Response.json({ id: forum, type: 15, guild_id: guild });
    stopped = true;
    return Response.json([msg('200')]);
  });
  assert.equal((await cleanupForumThread({ ...base, stopCheck: () => stopped })).stopped, true);
  assert.equal(doc.querySelector('.dmd-confirm-box'), null);
});

test('Thread mode accepts text-channel threads while forum cleanup stays restricted', async t => {
  setup(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    if (url.endsWith(`/channels/${channel}`)) return Response.json({ id: channel, parent_id: forum, type: 11 });
    if (url.endsWith(`/channels/${forum}`)) return Response.json({ id: forum, type: 0, guild_id: guild });
    return Response.json([]);
  });
  const result = await cleanupForumThread({ ...base, allowAnyThread: true });
  assert.equal(result.done, true);
  assert.equal(calls.some(url => url.includes('/search')), false);
  await assert.rejects(cleanupForumThread(base), /does not belong/);
});
