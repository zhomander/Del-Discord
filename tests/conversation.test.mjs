import { createConversationPreviewResolver } from '../src/discord/conversation-preview.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { resolveConversation } from '../src/discord/conversation.js';

const channelId = '123456789012345678', guildId = '234567890123456789';

test('conversation detection distinguishes supported channel types and rejects inaccessible or malformed targets', async t => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => response);
  for (const [type, mode] of [[1, 'dm'], [3, 'dm'], [0, 'channel'], [5, 'channel'], [15, 'forums'], [16, 'forums'], [10, 'thread'], [11, 'thread'], [12, 'thread']]) {
    response = Response.json({ id: channelId, type, guild_id: guildId });
    const target = await resolveConversation({ token: 'test', channelId });
    assert.equal(target.mode, mode);
    assert.equal(target.guildId, mode === 'dm' ? '@me' : guildId);
  }
  response = new Response('', { status: 403 });
  await assert.rejects(resolveConversation({ token: 'test', channelId }), /403/);
  response = Response.json({ id: channelId, type: 2, guild_id: guildId });
  await assert.rejects(resolveConversation({ token: 'test', channelId }), /does not support/);
  response = Response.json({ id: 'wrong', type: 1 });
  await assert.rejects(resolveConversation({ token: 'test', channelId }), /invalid conversation/);
});

test('empty cleanup fields detect current DM, channel, thread and forum despite the selected mode', async t => {
  for (const [type, expected] of [[1, 'dm'], [0, 'channel'], [11, 'thread'], [15, 'forums']]) {
    const guild = type === 1 ? '@me' : guildId;
    const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/${guild}/${channelId}`, runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const doc = dom.window.document, calls = [];
    dom.window.fetch = async url => {
      calls.push(url);
      if (url.endsWith('/users/@me')) return Response.json({ id: 'self' });
      if (url.endsWith(`/channels/${channelId}`)) return Response.json({ id: channelId, type, guild_id: guildId, parent_id: guildId });
      if (url.endsWith(`/channels/${guildId}`)) return Response.json({ id: guildId, type: 0, guild_id: guildId });
      if (url.includes('/threads/')) return Response.json({ threads: [], has_more: false });
      if (url.includes('/search')) return Response.json({ messages: [], total_results: 0 });
      return Response.json([]);
    };
    vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
    doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    doc.querySelector('#dmd-token').value = 'test';
    doc.querySelector('#dmd-message-modes [data-mode="channel"]').click();
    doc.querySelector('#dmd-channel').value = '';
    doc.querySelector('#dmd-guild').value = '';
    await doc.querySelector('#dmd-start').onclick();
    assert.equal(doc.querySelector('#dmd-channel').value, channelId);
    assert.equal(doc.querySelector('#dmd-guild').value, guild);
    assert.equal(doc.querySelector('#dmd-message-modes .active').dataset.mode, ['forums', 'thread'].includes(expected) ? 'forums' : expected);
    if (expected === 'forums') {
      assert.ok(calls.some(url => url.includes('/threads/active')));
      assert.equal(doc.querySelector('#dmd-forums').style.display, '');
    } else {
      assert.ok(calls.some(url => url.includes(expected === 'thread' ? `/channels/${channelId}/messages?` : '/messages/search')));
    }
    if (expected === 'thread') {
      assert.equal(doc.querySelector('#dmd-channel').previousElementSibling.textContent, 'Thread(s)');
      assert.equal(doc.querySelector('#dmd-thread-target-kind-value').textContent, 'Thread IDs');
    }
  }
});

test('reopening and route changes preserve manual conversation IDs while automatic fields follow navigation', async t => {
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/@me/${channelId}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', { get() { return this.parentElement; } });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 500, height: 40, top: 20, left: 400, right: 900 });
  dom.window.fetch = async url => url.endsWith('/users/@me') ? Response.json({ id: 'self' }) : Response.json({ id: url.split('/').at(-1), type: 1 });
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const field = doc.querySelector('#dmd-channel');
  field.value = `${guildId}, 345678901234567890`;
  field.dispatchEvent(new dom.window.Event('input'));
  doc.querySelector('#dmd-guild').value = guildId;
  doc.querySelector('#dmd-guild').dispatchEvent(new dom.window.Event('input'));
  doc.querySelector('#dmd-token').value = 'test';
  await doc.querySelector('#dmd-toolbar-btn').onclick();
  await doc.querySelector('#dmd-toolbar-btn').onclick();
  await doc.querySelector('#dmd-toolbar-btn').onclick();
  dom.window.history.pushState({}, '', `/channels/@me/456789012345678901`);
  dom.window.dispatchEvent(new dom.window.Event('popstate'));
  assert.equal(field.value, `${guildId}, 345678901234567890`);
  assert.equal(doc.querySelector('#dmd-guild').value, guildId);
  assert.equal(doc.querySelector('#dmd-rx-channel').value, '456789012345678901');
});

test('multiple manually entered threads use thread cleanup from the DMs mode and keep their IDs', async t => {
  const second = '345678901234567890';
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/@me/456789012345678901`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document, calls = [];
  dom.window.fetch = async url => {
    calls.push(url);
    if (url.endsWith('/users/@me')) return Response.json({ id: 'self' });
    if ([channelId, second].some(id => url.endsWith(`/channels/${id}`))) return Response.json({ id: url.split('/').at(-1), type: 11, guild_id: guildId, parent_id: guildId });
    if (url.endsWith(`/channels/${guildId}`)) return Response.json({ id: guildId, type: 0, guild_id: guildId });
    return Response.json([]);
  };
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  doc.querySelector('#dmd-token').value = 'test';
  const field = doc.querySelector('#dmd-channel'); field.value = `${channelId}, ${second}`;
  field.dispatchEvent(new dom.window.Event('input'));
  doc.querySelector('#dmd-guild').value = '';
  await doc.querySelector('#dmd-start').onclick();
  assert.equal(field.value, `${channelId}, ${second}`);
  assert.ok(calls.some(url => url.includes(`/channels/${channelId}/messages?`)));
  assert.ok(calls.some(url => url.includes(`/channels/${second}/messages?`)));
  assert.equal(calls.some(url => url.includes('/search')), false);
});

test('visual detection shares pending requests, expires cached results and isolates account changes', async () => {
  let clock = 0, calls = 0, complete;
  const resolver = createConversationPreviewResolver(async options => {
    calls++;
    if (calls === 1) await new Promise(resolve => { complete = resolve; });
    return { mode: 'dm', channelId: options.channelId, guildId: '@me' };
  }, () => clock);
  const options = { token: 'one', channelId };
  const first = resolver(options), second = resolver(options);
  await Promise.resolve();
  assert.equal(calls, 1);
  complete();
  assert.deepEqual(await first, await second);
  await resolver(options); assert.equal(calls, 1);
  clock = 30000;
  await resolver(options); assert.equal(calls, 2);
  await resolver({ ...options, token: 'two' }); assert.equal(calls, 3);
  await resolver({ ...options, token: 'two', channelId: guildId }); assert.equal(calls, 4);
});

test('visual detection retries failed requests rather than caching failure', async () => {
  let calls = 0;
  const resolver = createConversationPreviewResolver(async () => {
    if (++calls === 1) throw new Error('temporary failure');
    return { mode: 'dm', channelId, guildId: '@me' };
  });
  await assert.rejects(resolver({ token: 'test', channelId }), /temporary failure/);
  assert.equal((await resolver({ token: 'test', channelId })).mode, 'dm');
  assert.equal(calls, 2);
});
