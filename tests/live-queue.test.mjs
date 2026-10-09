import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const first = '123456789012345678', second = '234567890123456789', guild = '345678901234567890';
const person = '456789012345678901';
async function waitFor(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 0)); }
  throw new Error('Expected UI state did not appear.');
}
async function mount(t, fetch, initial = []) {
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: `https://discord.com/channels/${guild}/${first}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  dom.window.fetch = (url, options) => url.endsWith('/threads/active') ? Promise.resolve(Response.json({ threads: [] })) : url.includes('/messages?') || url.endsWith(`/guilds/${guild}/channels`) ? Promise.resolve(Response.json([])) : fetch(url, options);
  dom.window.setTimeout = callback => { callback(); return 0; };
  dom.window.localStorage.setItem('del_discord_v1_queue', JSON.stringify(initial));
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', { get() { return this.parentElement; } });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 500, height: 40, top: 20, left: 400, right: 900 });
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const doc = dom.window.document;
  doc.querySelector('#dmd-token').value = 'test-token';
  doc.querySelector('[data-view="multi"]').click();
  return { dom, doc };
}
test('live queue accepts an approved job mid-run, expands progress and drains it without restarting', async t => {
  let releaseFirst, started = false;
  const searches = [];
  const { dom, doc } = await mount(t, async url => {
    if (url.endsWith('/users/@me')) return Response.json({ id: person });
    if (url.includes('/messages/search')) {
      searches.push(url);
      if (url.includes(first)) { started = true; await new Promise(resolve => { releaseFirst = resolve; }); }
      return Response.json({ messages: [], total_results: 0 });
    }
    if (url.endsWith(`/channels/${second}`)) return Response.json({ id: second, type: 1, recipients: [{ id: person, username: 'Friend', avatar: 'abc' }] });
    throw new Error(`Unexpected request: ${url}`);
  }, [{ guildId: '@me', channelId: first, label: 'Discord | First' }]);
  const run = doc.querySelector('#dmd-multi-start').onclick();
  await waitFor(() => started);
  doc.querySelector('#dmd-guild').value = '@me';
  doc.querySelector('#dmd-channel').value = second;
  const add = doc.querySelector('#dmd-add-queue').onclick();
  assert.equal(JSON.parse(dom.window.localStorage.getItem('del_discord_v1_queue')).length, 1);
  doc.querySelector('.dmd-confirm-actions button:last-child').click();
  await add;
  assert.equal(doc.querySelector('#dmd-multi-count').textContent, '2 queued');
  assert.equal(doc.querySelector('#dmd-multi-progress').max, 2);
  assert.ok(doc.querySelectorAll('.dmd-queue-avatar img')[0].src.includes(`/avatars/${person}/abc`));
  assert.equal(doc.querySelector('.dmd-queue-title').textContent, 'First');
  releaseFirst(); await run;
  assert.equal(searches.length, 2);
  assert.equal(doc.querySelector('#dmd-multi-count').textContent, '0 queued');
  assert.equal(doc.querySelector('#dmd-multi-pct').textContent, '100%');
  assert.equal(doc.querySelector('.dmd-confirm-box'), null);
});
test('server additions require approval, show a server icon and scan without a channel filter', async t => {
  const searches = [];
  const { dom, doc } = await mount(t, async url => {
    if (url.endsWith('/users/@me')) return Response.json({ id: person });
    if (url.endsWith(`/guilds/${guild}`)) return Response.json({ id: guild, name: 'Our Server', icon: 'abc' });
    if (url.includes('/messages/search')) { searches.push(url); return Response.json({ messages: [], total_results: 0 }); }
    throw new Error(`Unexpected request: ${url}`);
  });
  doc.querySelector('#dmd-queue-modes [data-mode="server"]').click();
  assert.equal(doc.querySelector('#dmd-queue-server-inputs').hidden, false);
  assert.equal(doc.querySelector('[data-progress-view="multi"]').hidden, false);
  const cancelled = doc.querySelector('#dmd-server-current').onclick();
  await waitFor(() => doc.querySelector('.dmd-confirm-box'));
  doc.querySelector('.dmd-confirm-actions button:first-child').click(); await cancelled;
  assert.equal(JSON.parse(dom.window.localStorage.getItem('del_discord_v1_queue')).length, 0);
  doc.querySelector('#dmd-server-id').value = guild;
  const add = doc.querySelector('#dmd-server-add').onclick();
  await waitFor(() => doc.querySelector('.dmd-confirm-box'));
  doc.querySelector('.dmd-confirm-actions button:last-child').click(); await add;
  assert.equal(doc.querySelector('.dmd-queue-title').textContent, 'Our Server');
  assert.ok(doc.querySelector('.dmd-queue-avatar img').src.includes(`/icons/${guild}/abc`));
  await doc.querySelector('#dmd-multi-start').onclick();
  assert.equal(searches.length, 1);
  assert.ok(searches[0].includes(`/guilds/${guild}/messages/search`));
  assert.equal(new URL(searches[0]).searchParams.has('channel_id'), false);
});

test('queue waits for an open add confirmation when the last running job finishes', async t => {
  let release, started = false;
  const searches = [];
  const { doc } = await mount(t, async url => {
    if (url.endsWith('/users/@me')) return Response.json({ id: person });
    if (url.includes('/messages/search')) {
      searches.push(url);
      if (url.includes(first)) { started = true; await new Promise(resolve => { release = resolve; }); }
      return Response.json({ messages: [], total_results: 0 });
    }
    return Response.json({ id: second, type: 1 });
  }, [{ guildId: '@me', channelId: first }]);
  const run = doc.querySelector('#dmd-multi-start').onclick();
  await waitFor(() => started);
  doc.querySelector('#dmd-guild').value = '@me';
  doc.querySelector('#dmd-channel').value = second;
  const add = doc.querySelector('#dmd-add-queue').onclick();
  release();
  await waitFor(() => doc.querySelector('#dmd-multi-count').textContent === '0 queued');
  assert.equal(doc.querySelector('#dmd-multi-stop').disabled, false);
  doc.querySelector('.dmd-confirm-actions button:last-child').click();
  await add; await run;
  assert.equal(searches.length, 2);
});

test('Messages Server mode scans the guild without a channel restriction', async t => {
  const searches = [];
  const { doc } = await mount(t, async url => {
    if (url.endsWith('/users/@me')) return Response.json({ id: person });
    if (url.includes('/messages/search')) { searches.push(url); return Response.json({ messages: [], total_results: 0 }); }
    throw new Error(`Unexpected request: ${url}`);
  });
  doc.querySelector('[data-view="messages"]').click();
  doc.querySelector('#dmd-message-modes [data-mode="server"]').click();
  await doc.querySelector('#dmd-start').onclick();
  assert.equal(searches.length, 1);
  assert.match(searches[0], new RegExp(`/guilds/${guild}/messages/search`));
  assert.equal(new URL(searches[0]).searchParams.has('channel_id'), false);
  assert.equal(doc.querySelector('#dmd-channel').closest('.dmd-field').hidden, true);
});

test('reopening saved queue asks to continue or explicitly clear; dismissal keeps it', async t => {
  const { dom, doc } = await mount(t, async () => Response.json([]), [{ guildId: '@me', channelId: first, label: 'Saved person' }]);
  const opened = doc.querySelector('#dmd-toolbar-btn').onclick();
  await waitFor(() => doc.querySelector('.dmd-confirm-box'));
  assert.match(doc.querySelector('.dmd-confirm-message').textContent, /1 queued/);
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })); await opened;
  assert.equal(JSON.parse(dom.window.localStorage.getItem('del_discord_v1_queue')).length, 1);
  await doc.querySelector('#dmd-toolbar-btn').onclick();
  const reopened = doc.querySelector('#dmd-toolbar-btn').onclick();
  await waitFor(() => doc.querySelector('.dmd-confirm-box'));
  doc.querySelector('.dmd-confirm-actions button:first-child').click(); await reopened;
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('del_discord_v1_queue')), []);
});
