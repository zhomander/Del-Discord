import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { deleteMessages } from '../src/features/messages.js';
import { runDirectMessages } from '../src/features/direct-messages.js';
import { normalizeCleanupOptions, matchesMessage } from '../src/features/message-filters.js';
import { parseMessageIds, importMessageIds } from '../src/features/message-ids.js';
import { parseIdJson } from '../src/utils/json.js';
import { apiFetch, RunStoppedError } from '../src/discord/api.js';

const channel = '123456789012345678';
const id = suffix => `234567890123456${suffix}`;
const message = (messageId, extra = {}) => ({ id: messageId, channel_id: channel, author: { id: 'self', username: 'Me' }, type: 0, content: 'ordinary text', pinned: false, attachments: [], ...extra });
const base = { token: 'test-token', authorId: 'self', guildId: '@me', channelId: channel, skipConfirm: true, log: () => {} };

function globalValue(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
}
function setup(t, withDom = false) {
  t.mock.method(globalThis, 'setTimeout', callback => { callback(); return 0; });
  if (withDom) {
    const dom = new JSDOM('<body></body>', { url: 'https://discord.com' });
    globalValue(t, 'document', dom.window.document);
    t.after(() => dom.window.close());
    return dom.window.document;
  }
  globalValue(t, 'document', { title: 'Test | Discord' });
  globalValue(t, 'location', { pathname: `/channels/@me/${channel}` });
}
async function confirmation(doc) {
  for (let i = 0; i < 100; i++) {
    const popup = doc.querySelector('.dmd-confirm-box');
    if (popup) return popup;
    await Promise.resolve();
  }
  throw new Error('Confirmation did not appear.');
}

test('oldest-first search advances min_id and keeps the upper bound', async t => {
  setup(t);
  const searches = [], writes = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method) { writes.push(url); return new Response(null, { status: 204 }); }
    searches.push(new URL(url));
    const pages = [
      [message('300', { pinned: true }), message('100'), message('200', { author: { id: 'other' } })],
      [message('400')], [],
    ];
    return Response.json({ messages: pages[searches.length - 1].map(value => [{ ...value, hit: true }]), total_results: 4 });
  });
  const result = await deleteMessages({ ...base, order: 'asc', minId: '50', maxId: '500' });
  assert.equal(result.deleted, 2);
  assert.equal(result.skipped, 2);
  assert.deepEqual(writes.map(url => url.split('/').at(-1)), ['100', '400']);
  assert.deepEqual(searches.map(url => url.searchParams.get('min_id')), ['50', '300', '400']);
  assert.ok(searches.every(url => url.searchParams.get('max_id') === '500' && url.searchParams.get('sort_order') === 'asc'));
});

test('overwrite uses PATCH, suppresses mentions, and does not repeat edited IDs', async t => {
  setup(t);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (options.method) return Response.json(message('200', { content: '@everyone replacement' }));
    return Response.json({ messages: [[{ ...message('200', { attachments: [{ id: 'file' }] }), hit: true }]], total_results: 1 });
  });
  const result = await deleteMessages({ ...base, action: 'overwrite', overwriteText: '@everyone replacement' });
  assert.equal(result.overwritten, 1);
  assert.equal(result.deleted, 0);
  assert.equal(result.stalled, true);
  const writes = requests.filter(request => request.options.method);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(writes[0].options.body), { content: '@everyone replacement', allowed_mentions: { parse: [], replied_user: false } });
});

test('inverse text/link/file filters omit positive search constraints and preserve matches', async t => {
  setup(t);
  const requests = [], writes = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method) { writes.push(url); return new Response(null, { status: 204 }); }
    requests.push(new URL(url));
    const messages = requests.length === 1 ? [message('500', { content: 'KEEP this' }), message('400', { content: 'https://example.com' }),
      message('300', { attachments: [{ id: 'file' }] }), message('200', { pinned: true }), message('100')] : [];
    return Response.json({ messages: messages.map(value => [{ ...value, hit: true }]), total_results: 5 });
  });
  const result = await deleteMessages({ ...base, content: 'keep', textMode: 'exclude', linkMode: 'without', fileMode: 'without', pinnedMode: 'without' });
  assert.equal(result.deleted, 1);
  assert.equal(result.skipped, 4);
  assert.equal(writes[0].endsWith('/100'), true);
  assert.equal(requests[0].searchParams.has('content'), false);
  assert.equal(requests[0].searchParams.has('has'), false);
});

test('filter validation rejects empty overwrite text and invalid ranges', () => {
  assert.throws(() => normalizeCleanupOptions({ action: 'overwrite', overwriteText: ' ' }), /Replacement text/);
  assert.throws(() => normalizeCleanupOptions({ action: 'overwrite', overwriteText: 'x'.repeat(2001) }), /Replacement text/);
  assert.throws(() => normalizeCleanupOptions({ minId: '200', maxId: '100' }), /After/);
  const options = normalizeCleanupOptions({ ...base, pinnedMode: 'with', fileMode: 'with' });
  assert.equal(matchesMessage(message('200', { pinned: true, attachments: [{ id: 'file' }] }), options), true);
  assert.equal(matchesMessage(message('200', { pinned: true }), options), false);
});

test('ID input deduplicates links and preserves numeric JSON snowflakes exactly', () => {
  const link = `https://discord.com/channels/@me/${channel}/${id('789')}`;
  assert.deepEqual(parseMessageIds(`${id('789')}\n${link}`, channel), [{ channelId: channel, messageId: id('789') }]);
  assert.deepEqual(parseMessageIds(`{"channelId":${channel},"messages":[{"ID":${id('789')}}]}`), [{ channelId: channel, messageId: id('789') }]);
  assert.equal(parseIdJson('{"content":"escaped \\" 123456789012345678","id":234567890123456789}').id, '234567890123456789');
  assert.deepEqual(parseMessageIds('garbage', channel), []);
  assert.throws(() => parseMessageIds(id('789')), /Channel ID/);
});

test('package ID import reads quoted multiline CSV, JSON, and channel folders without rounding', async () => {
  const file = (webkitRelativePath, content) => ({ webkitRelativePath, name: webkitRelativePath.split('/').at(-1), text: async () => content });
  const targets = await importMessageIds([
    file(`package/messages/c${channel}/channel.json`, `{"id":${channel}}`),
    file(`package/messages/c${channel}/messages.csv`, `ID,Timestamp,Contents\r\n${id('789')},2026,"hello,\nworld"\r\n${id('790')},2026,"another"`),
    file(`package/messages/c${channel}/messages.json`, `[{"ID":${id('789')}}]`),
    file('package/account/user.json', '{"id":"irrelevant"}'),
  ]);
  assert.deepEqual(targets.map(target => target.messageId), [id('789'), id('790')]);
  assert.ok(targets.every(target => target.channelId === channel));
});

test('direct-ID deletion verifies ownership and pins, confirms, and never searches', async t => {
  const doc = setup(t, true);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    const messageId = url.split('/').at(-1);
    if (messageId === id('786')) return new Response(null, { status: 404 });
    return Response.json(message(messageId, messageId === id('788') ? { author: { id: 'other' } } : messageId === id('787') ? { pinned: true } : {}));
  });
  const task = runDirectMessages({ ...base, skipConfirm: false, targets: ['789', '788', '787', '786'].map(suffix => ({ channelId: channel, messageId: id(suffix) })) });
  const popup = await confirmation(doc);
  assert.equal(requests.some(request => request.options.method), false);
  assert.ok(popup.textContent.includes('1 messages'));
  popup.querySelector('.dmd-red').click();
  const result = await task;
  assert.equal(result.deleted, 1);
  assert.equal(result.skipped, 2);
  assert.equal(result.alreadyGone, 1);
  assert.equal(requests.filter(request => request.options.method === 'DELETE').length, 1);
  assert.equal(requests.some(request => request.url.includes('/search')), false);
});

test('direct overwrite previews replacement and cancellation prevents changes', async t => {
  const doc = setup(t, true);
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method) writes.push(options);
    return Response.json(message(id('789')));
  });
  const options = { ...base, targets: [{ channelId: channel, messageId: id('789') }], action: 'overwrite', overwriteText: '[removed]' };
  const cancelledTask = runDirectMessages({ ...options, skipConfirm: false });
  let popup = await confirmation(doc);
  assert.ok(popup.textContent.includes('[removed]'));
  popup.querySelector('.dmd-confirm-actions button').click();
  assert.equal((await cancelledTask).cancelled, true);
  assert.equal(writes.length, 0);
  const approvedTask = runDirectMessages({ ...options, skipConfirm: false });
  popup = await confirmation(doc);
  popup.querySelector('.dmd-red').click();
  assert.equal((await approvedTask).overwritten, 1);
  assert.equal(writes[0].method, 'PATCH');
});

test('stopping during confirmation or rate limiting prevents later requests', async t => {
  const doc = setup(t, true);
  let stopped = false;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { requests.push(options); return Response.json(message(id('789'))); });
  const task = runDirectMessages({ ...base, skipConfirm: false, targets: [{ channelId: channel, messageId: id('789') }], stopCheck: () => stopped });
  const popup = await confirmation(doc);
  stopped = true; popup.querySelector('.dmd-red').click();
  assert.equal((await task).stopped, true);
  assert.equal(requests.length, 1);
  stopped = false;
  t.mock.method(globalThis, 'fetch', async () => { stopped = true; return Response.json({ retry_after: 1 }, { status: 429 }); });
  await assert.rejects(apiFetch('https://discord.com/api/v10/test', {}, () => {}, () => stopped), RunStoppedError);
});

test('bundled UI passes oldest-first overwrite and inverse options to search', async t => {
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/@me/${channel}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document, requests = [], errors = [];
  dom.window.addEventListener('error', event => errors.push(event.error));
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', { get() { return this.parentElement; } });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 500, height: 40, top: 20, left: 400, right: 900 });
  dom.window.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith(`/channels/${channel}`)) return Response.json({ id: channel, type: 1 });
    if (url.includes('/messages?')) return Response.json([]);
    return url.endsWith('/users/@me') ? Response.json({ id: 'self' }) : Response.json({ messages: [], total_results: 0 });
  };
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  doc.querySelector('#dmd-token').value = 'test-token';
  doc.querySelector('#dmd-action').value = 'overwrite';
  doc.querySelector('#dmd-action').dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.querySelector('#dmd-overwrite-field').hidden, false);
  doc.querySelector('#dmd-overwrite-text').value = '[removed]';
  doc.querySelector('#dmd-order').value = 'asc';
  doc.querySelector('#dmd-content').value = 'keep';
  doc.querySelector('#dmd-text-mode').value = 'exclude';
  await doc.querySelector('#dmd-start').onclick();
  const search = requests.find(request => request.url.includes('/search'));
  assert.equal(new URL(search.url).searchParams.get('sort_order'), 'asc');
  assert.equal(new URL(search.url).searchParams.has('content'), false);
  assert.equal(doc.querySelector('#dmd-start').disabled, false);
  assert.equal(doc.querySelector('#dmd-rx-limit').max, '5000');
  assert.deepEqual(errors, []);
});

test('queue runs without confirmation, removes finished conversations and retains failed or stopped ones', async t => {
  for (const outcome of ['success', 'failure', 'cancel']) {
    const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/@me/${channel}`, runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const doc = dom.window.document;
    dom.window.localStorage.setItem('del_discord_v1_queue', JSON.stringify([{ guildId: '@me', channelId: channel, label: 'First' }, { guildId: '@me', channelId: '345678901234567890', label: 'Next' }]));
    dom.window.fetch = async url => url.endsWith('/users/@me') ? Response.json({ id: 'self' }) : outcome === 'failure' ? new Response('', { status: 403 }) : Response.json(url.includes('/messages?') ? [] : { messages: [], total_results: 0 });
    // Pause between conversations to verify the first is removed before the next starts.
    dom.window.setTimeout = () => 0;
    vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
    doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    doc.querySelector('#dmd-token').value = 'test-token';
    doc.querySelector('[data-view="multi"]').click();
    assert.equal(doc.querySelector('#dmd-progress-dock').nextElementSibling.id, 'dmd-log-area');
    assert.equal(doc.querySelector('[data-progress-view="multi"]').hidden, false);
    const run = doc.querySelector('#dmd-multi-start').onclick();
    assert.equal(doc.querySelector('.dmd-confirm-overlay'), null);
    if (outcome === 'cancel') doc.querySelector('#dmd-multi-stop').click();
    if (outcome === 'success') {
      for (let i = 0; i < 200 && JSON.parse(dom.window.localStorage.getItem('del_discord_v1_queue')).length === 2; i++) await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(JSON.parse(dom.window.localStorage.getItem('del_discord_v1_queue')).length, 1);
      assert.equal(doc.querySelector('#dmd-multi-count').textContent, '1 queued');
      assert.equal(doc.querySelector('.dmd-queue-title').textContent, 'Next');
    } else {
      await run;
      assert.equal(JSON.parse(dom.window.localStorage.getItem('del_discord_v1_queue')).length, 2);
    }
  }
});

test('custom dropdowns preserve cleanup values and identity previews resolve entered IDs', async t => {
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/@me/${channel}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document, calls = [];
  const userId = '123456789012345678', guildId = '234567890123456789';
  dom.window.fetch = async url => {
    calls.push(url);
    return Response.json(url.includes('/guilds/') ? { id: guildId, name: 'My server', icon: 'serverhash' } : { id: userId, username: 'Person', avatar: 'avatarhash' });
  };
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  assert.equal(calls.length, 0);
  const action = doc.querySelector('#dmd-action'), trigger = action.nextElementSibling;
  trigger.click();
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  const menu = doc.querySelector('.dmd-select-menu');
  menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(doc.activeElement.textContent, 'Overwrite message text');
  doc.activeElement.click();
  assert.equal(action.value, 'overwrite');
  assert.equal(doc.querySelector('#dmd-overwrite-field').hidden, false);
  assert.equal(doc.querySelector('.dmd-select-menu'), null);
  doc.querySelector('#dmd-token').value = 'test-token';
  for (const [id, value] of [['dmd-author', userId], ['dmd-guild', guildId]]) {
    doc.getElementById(id).value = value;
    doc.getElementById(id).dispatchEvent(new dom.window.Event('change'));
  }
  for (let i = 0; i < 30 && !doc.querySelector('#dmd-guild-avatar img'); i++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(doc.querySelector('#dmd-user-avatar img').src, /avatars\/123456789012345678\/avatarhash/);
  assert.match(doc.querySelector('#dmd-guild-avatar img').src, /icons\/234567890123456789\/serverhash/);
  doc.querySelector('#dmd-author').value = 'invalid';
  doc.querySelector('#dmd-author').dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.querySelector('#dmd-user-avatar').hidden, true);
});

test('queue and selected forum exports share panel confirmations and keep queued items', async t => {
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/@me/${channel}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document, downloads = [], requests = [];
  const forum = '456789012345678901', guild = '567890123456789012';
  dom.window.Blob = Blob;
  dom.window.URL.createObjectURL = blob => { downloads.push(blob.text().then(JSON.parse)); return 'blob:test'; };
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  dom.window.localStorage.setItem('del_discord_v1_queue', JSON.stringify([{ guildId: '@me', channelId: channel }, { guildId: '@me', channelId: '345678901234567890' }]));
  dom.window.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/users/@me')) return Response.json({ id: 'self' });
    if (url.endsWith(`/channels/${forum}`)) return Response.json({ id: forum, type: 15, guild_id: guild });
    if (url.includes('/threads/')) return Response.json({ threads: [{ id: channel, parent_id: forum, type: 11, name: 'Selected post' }], has_more: false });
    return Response.json([]);
  };
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  doc.querySelector('#dmd-token').value = 'test-token';
  const run = doc.querySelector('#dmd-multi-export').onclick();
  let popup = await confirmation(doc);
  assert.equal(popup.parentElement.parentElement.id, 'dmd-panel');
  assert.equal(popup.getAttribute('role'), 'dialog');
  popup.querySelector('.dmd-export-list').previousElementSibling.click();
  popup.querySelectorAll('.dmd-confirm-actions button')[1].click();
  await run;
  assert.equal((await downloads[0]).conversationCount, 2);
  assert.equal(JSON.parse(dom.window.localStorage.getItem('del_discord_v1_queue')).length, 2);
  assert.equal(doc.querySelector('#dmd-multi-pct').textContent, '100%');
  doc.querySelector('#dmd-forum-id').value = forum;
  await doc.querySelector('#dmd-forum-load').onclick();
  doc.querySelector('#dmd-forum-list').options[0].selected = true;
  const forumRun = doc.querySelector('#dmd-forum-export').onclick();
  popup = await confirmation(doc);
  popup.querySelectorAll('.dmd-confirm-actions button')[1].click();
  await forumRun;
  assert.equal((await downloads[1]).channelId, channel);
  assert.equal((await downloads[1]).label, 'Selected post');
  assert.equal(doc.querySelector('#dmd-pct').textContent, '100%');
  const cancelled = doc.querySelector('#dmd-multi-export').onclick();
  popup = await confirmation(doc);
  popup.querySelectorAll('.dmd-confirm-actions button')[0].click();
  await cancelled;
  assert.equal(downloads.length, 2);
  assert.equal(requests.some(request => request.options?.method && request.options.method !== 'GET'), false);
});

test('Messages and Queue modes consolidate tabs and custom calendar preserves date values', async t => {
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/@me/${channel}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const doc = dom.window.document;
  assert.deepEqual([...doc.querySelectorAll('.dmd-tab')].map(tab => tab.dataset.view), ['messages', 'reactions', 'multi', 'history']);
  doc.querySelector('#dmd-message-modes [data-mode="forums"]').click();
  assert.equal(doc.querySelector('#dmd-forums').parentElement.id, 'dmd-messages');
  assert.equal(doc.querySelector('#dmd-forums').style.display, '');
  assert.equal(doc.querySelector('#dmd-messages>.dmd-actions').hidden, true);
  assert.equal(doc.querySelector('[data-progress-view="messages"]').hidden, false);
  doc.querySelector('[data-view="multi"]').click();
  doc.querySelector('#dmd-queue-modes [data-mode="ids"]').click();
  assert.equal(doc.querySelector('#dmd-ids').parentElement.id, 'dmd-multi');
  assert.equal(doc.querySelector('#dmd-queue-conversations').hidden, true);
  assert.equal(doc.querySelector('[data-progress-view="ids"]').hidden, false);
  const after = doc.querySelector('#dmd-after'); after.value = '2026-10-07T12:30';
  after.dispatchEvent(new dom.window.Event('change'));
  after.nextElementSibling.click();
  const picker = doc.querySelector('.dmd-calendar');
  assert.equal(picker.getAttribute('role'), 'dialog');
  picker.querySelector('input[aria-label="Hour"]').value = '14';
  picker.querySelector('input[aria-label="Minute"]').value = '45';
  [...picker.querySelectorAll('button')].find(button => button.textContent === 'Apply').click();
  assert.equal(after.value, '2026-10-07T14:45');
  assert.equal(doc.querySelector('.dmd-calendar'), null);
});

test('comma-separated channels scan separately and author filters preserve ownership', async t => {
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/@me/${channel}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document, searches = [];
  const me = '456789012345678901', second = '345678901234567890';
  dom.window.fetch = async url => {
    if (url.endsWith('/users/@me')) return Response.json({ id: me });
    if (/\/channels\/\d+$/.test(url)) return Response.json({ id: url.split('/').at(-1), type: 1 });
    if (url.includes('/messages?')) return Response.json([]);
    searches.push(url); return Response.json({ messages: [], total_results: 0 });
  };
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  doc.querySelector('#dmd-token').value = 'test-token';
  doc.querySelector('#dmd-author').value = `${me}, 567890123456789012`;
  doc.querySelector('#dmd-channel').value = `${channel}, ${second}, ${channel}`;
  await doc.querySelector('#dmd-start').onclick();
  assert.equal(searches.length, 2);
  assert.ok(searches.some(url => url.includes(`/channels/${second}/messages/search`)));
  assert.equal(matchesMessage(message(id('111'), { author: { id: 'other' } }), normalizeCleanupOptions({ authorId: me, authorIds: [me, 'other'] })), false);
});

test('DM history multi-selection confirms deletion and cancellation prevents any message requests', async t => {
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/@me/${channel}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document, requests = [];
  dom.window.localStorage.setItem('del_discord_v1_history', JSON.stringify({ first: { channelId: channel, name: 'First', verifiedSent: true, sentCount: 2 }, second: { channelId: '345678901234567890', name: 'Second', verifiedSent: true, sentCount: 3 } }));
  dom.window.fetch = async url => { requests.push(url); return url.endsWith('/users/@me') ? Response.json({ id: 'self' }) : Response.json(url.includes('/messages?') ? [] : { messages: [], total_results: 0 }); };
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  doc.querySelector('#dmd-token').value = 'test-token';
  doc.querySelector('[data-view="history"]').click();
  assert.equal(doc.querySelector('#dmh-delete-all').hidden, true);
  doc.querySelectorAll('.dmh-select').forEach(select => select.click());
  assert.equal(doc.querySelector('#dmh-delete-all').textContent, 'Delete All (2)');
  const cancelled = doc.querySelector('#dmh-delete-all').onclick();
  let dialog = await confirmation(doc);
  assert.match(dialog.textContent, /Are you sure/);
  dialog.querySelectorAll('.dmd-confirm-actions button')[0].click(); await cancelled;
  assert.equal(requests.some(url => url.includes('/messages')), false);
  const run = doc.querySelector('#dmh-delete-all').onclick();
  dialog = await confirmation(doc);
  dialog.querySelectorAll('.dmd-confirm-actions button')[1].click(); await run;
  assert.equal(requests.filter(url => url.includes('/messages/search')).length, 2);
  assert.equal(doc.querySelector('#dmh-delete-all').hidden, true);
  assert.equal(doc.querySelector('#dmh-pct').textContent, '100%');
});

test('a second cleanup during a run prompts to queue without starting overlapping requests', async t => {
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/@me/${channel}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  let finishSearch, requests = 0;
  dom.window.fetch = async url => {
    if (url.includes('/messages?')) return Response.json([]);
    if (url.endsWith('/users/@me')) return Response.json({ id: 'self' });
    if (/\/channels\/\d+$/.test(url)) return Response.json({ id: url.split('/').at(-1), type: 1 });
    requests++;
    return new Promise(resolve => { finishSearch = () => resolve(Response.json({ messages: [], total_results: 0 })); });
  };
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  doc.querySelector('#dmd-token').value = 'test-token';
  const activeRun = doc.querySelector('#dmd-start').onclick();
  for (let i = 0; i < 50 && !finishSearch; i++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(doc.querySelector('#dmd-start').disabled, false);
  await doc.querySelector('#dmd-rx-go').onclick();
  assert.equal(requests, 1, 'Reaction cleanup must not start requests during message cleanup');
  doc.querySelector('#dmd-channel').value = '345678901234567890';
  doc.querySelector('#dmd-action').value = 'overwrite';
  doc.querySelector('#dmd-overwrite-text').value = 'saved replacement';
  let offered = doc.querySelector('#dmd-start').onclick();
  let dialog = await confirmation(doc);
  assert.match(dialog.textContent, /Add to Queue/);
  dialog.querySelectorAll('.dmd-confirm-actions button')[0].click(); await offered;
  assert.equal(doc.querySelectorAll('.dmd-queue-row').length, 0);
  offered = doc.querySelector('#dmd-start').onclick(); dialog = await confirmation(doc);
  dialog.querySelectorAll('.dmd-confirm-actions button')[1].click(); await offered;
  const queued = JSON.parse(dom.window.localStorage.getItem('del_discord_v1_queue'));
  assert.equal(queued[0].channelId, '345678901234567890');
  assert.equal(queued[0].options.action, 'overwrite');
  assert.equal(queued[0].options.overwriteText, 'saved replacement');
  assert.equal(requests, 1);
  finishSearch(); await activeRun;
  assert.equal(doc.querySelectorAll('.dmd-queue-row').length, 1);
});
