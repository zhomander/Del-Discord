import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { toSnowflake, parseMessageReference } from '../src/utils/messages.js';
import { merge, removeHistoryMatch } from '../src/features/history/model.js';
import { deleteMessages } from '../src/features/messages.js';
import { apiFetch } from '../src/discord/api.js';
import { runState } from '../src/utils/run-state.js';
import { installPanelWindowControls } from '../src/utils/drag.js';
import { importPackage } from '../src/features/history/import-package.js';
import { removeReactions } from '../src/features/reactions.js';

function setGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
}

test('message references preserve IDs and date boundaries', () => {
  assert.equal(toSnowflake('123456789012345678'), '123456789012345678');
  assert.equal(toSnowflake('2015-01-01T00:00:01Z'), String(1000n << 22n));
  assert.equal(toSnowflake('invalid'), '');
  assert.deepEqual(parseMessageReference('https://discord.com/channels/@me/123456789012345678/234567890123456789'), {
    guildId: '@me', channelId: '123456789012345678', messageId: '234567890123456789',
  });
  assert.equal(parseMessageReference('invalid'), null);
});

test('DM history merges imported channels with resolved users without duplicates', () => {
  const history = {};
  merge(history, { channelId: 'channel', sources: ['package'], sentCount: 4, verifiedSent: true });
  merge(history, { channelId: 'channel', userId: 'user', name: 'Person', sources: ['open'] });
  assert.deepEqual(Object.keys(history), ['u:user']);
  assert.deepEqual(history['u:user'].sources, ['package', 'open']);
  assert.equal(history['u:user'].sentCount, 4);
  removeHistoryMatch(history, 'user', 'channel');
  assert.deepEqual(history, {});
});

test('deletion preserves filters, skipped pins, pagination, and stop behavior', async t => {
  const requests = [];
  const message = id => ({ id, channel_id: 'channel', author: { id: 'self' }, timestamp: '2026-01-01', content: 'hello https://example.com', type: 0 });
  t.mock.method(globalThis, 'setTimeout', callback => { callback(); return 0; });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    const messages = requests.length === 1 ? [[{ ...message('200'), hit: true }], [{ ...message('100'), pinned: true, hit: true }]] : [];
    return Response.json({ messages, total_results: messages.length });
  });
  setGlobal(t, 'document', { title: 'Test | Discord' });
  setGlobal(t, 'location', { pathname: '/channels/@me/123' });
  const result = await deleteMessages({ token: 'test-token', authorId: 'self', guildId: '@me', channelId: 'channel', content: 'hello', hasLink: true,
    includePinned: false, skipConfirm: true, log: () => {} });
  assert.equal(result.deleted, 1);
  assert.equal(result.done, true);
  const search = new URL(requests[0].url);
  assert.equal(search.searchParams.get('author_id'), 'self');
  assert.equal(search.searchParams.get('content'), 'hello');
  assert.equal(search.searchParams.get('has'), 'link');
  assert.equal(new URL(requests[2].url).searchParams.get('max_id'), '100');
  assert.equal(requests[1].url.endsWith('/messages/200'), true);
  runState.stopped = true;
  const before = requests.length;
  const stopped = await deleteMessages({ log: () => {} });
  assert.equal(stopped.stopped, true);
  assert.equal(requests.length, before);
  runState.stopped = false;
});

test('API retries rate limits before returning a response', async t => {
  const waits = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { waits.push(delay); callback(); return 0; });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => ++requests === 1 ? Response.json({ retry_after: 2 }, { status: 429 }) : Response.json({ ok: true }));
  assert.equal((await apiFetch('https://discord.com/api/v10/test')).ok, true);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 2250 && waits[0] <= 2750);
  assert.equal(requests, 2);
});

test('shared drag controls clamp positions and save geometry for each panel', t => {
  const dom = new JSDOM('<div id="panel"><div id="drag"></div><div id="resize"></div></div>', { url: 'https://discord.com' });
  t.after(() => dom.window.close());
  setGlobal(t, 'window', dom.window);
  const panel = dom.window.document.querySelector('#panel');
  const drag = panel.querySelector('#drag');
  panel.getBoundingClientRect = () => ({ left: parseFloat(panel.style.left) || 0, top: parseFloat(panel.style.top) || 0, width: parseFloat(panel.style.width) || 500, height: parseFloat(panel.style.height) || 400 });
  const controls = installPanelWindowControls({ panel, dragHandle: drag, resizeHandle: panel.querySelector('#resize'), storage: () => dom.window.localStorage, storageKey: 'geometry', minWidth: 430 });
  controls.ensureGeometry();
  drag.dispatchEvent(new dom.window.MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 100 }));
  dom.window.dispatchEvent(new dom.window.MouseEvent('pointermove', { clientX: -5000, clientY: -5000 }));
  dom.window.dispatchEvent(new dom.window.MouseEvent('pointerup'));
  const saved = JSON.parse(dom.window.localStorage.getItem('geometry'));
  assert.equal(saved.left, 8);
  assert.equal(saved.top, 8);
  assert.equal(saved.width / saved.height, saved.ratio);
});

test('installed bundle mounts a shared window with history, supports queue editing, and avoids duplicates', async t => {
  const errors = [];
  const dom = new JSDOM('<header><div role="toolbar"><button>Discord</button></div></header>', {
    url: 'https://discord.com/channels/@me/123456789012345678', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  dom.window.addEventListener('error', event => errors.push(event.error));
  dom.window.fetch = () => { throw new Error('Installation must not request deletion'); };
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', { get() { return this.parentElement; } });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 500, height: 40, top: 20, left: 400, right: 900 });
  const bundle = await readFile('dist/Del-Discord-v1.user.js', 'utf8');
  vm.runInContext(bundle, dom.getInternalVMContext());
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('#dmd-panel').length, 1);
  assert.equal(doc.querySelectorAll('#dmh-panel').length, 1);
  assert.deepEqual([...doc.querySelector('[role="toolbar"]').children].map(el => el.id).filter(Boolean), ['dmd-toolbar-btn']);
  assert.equal(doc.querySelector('#dmh-panel').parentElement.id, 'dmd-panel');
  assert.equal(doc.querySelector('[data-view="forums"]'), null);
  assert.equal(doc.querySelector('#dmd-message-modes [data-mode="forums"]').textContent, 'Forum/Thread');
  assert.equal(doc.querySelector('[data-view="history"]').textContent, 'DM History');
  assert.equal(doc.querySelector('#dmd-message-modes [data-mode="thread"]'), null);
  doc.querySelector('#dmd-message-modes [data-mode="forums"]').click();
  assert.equal(doc.querySelector('#dmd-thread-target').hidden, false);
  assert.equal(doc.querySelector('#dmd-forums').style.display, '');
  const threadTarget = doc.querySelector('#dmd-thread-target-kind');
  threadTarget.value = 'thread'; threadTarget.dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.querySelector('#dmd-forums').style.display, 'none');
  assert.equal(doc.querySelector('#dmd-messages > .dmd-actions').hidden, false);
  assert.equal(doc.querySelector('#dmd-message-modes [data-mode="forums"]').classList.contains('active'), true);
  threadTarget.value = 'forums'; threadTarget.dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.querySelector('#dmd-forums').style.display, '');
  doc.querySelector('#dmd-message-modes [data-mode="dm"]').click();
  assert.equal(doc.querySelector('#dmd-thread-target').hidden, true);

  assert.equal(doc.querySelector('#dmd-log').getAttribute('role'), 'log');
  assert.equal(doc.querySelector('#dmd-clear').closest('#dmd-log-area') !== null, true);
  assert.equal(doc.querySelector('#dmd-export-log').textContent, 'Export');
  assert.equal(doc.querySelector('#dmd-clear').textContent, 'Clear');
  for (const id of ['dmd-regex-flags', 'dmd-asset-regex-flags']) {
    const tooltip = doc.getElementById(doc.getElementById(id).getAttribute('aria-describedby'));
    assert.match(tooltip.textContent, /ignore case.*multiline.*newlines.*Unicode/s);
    assert.equal(tooltip.getAttribute('role'), 'tooltip');
  }
  doc.querySelector('[data-view="history"]').click();
  assert.equal(doc.querySelector('#dmh-panel').style.display, 'flex');
  assert.equal(doc.querySelector('#dmd-messages').style.display, 'none');
  doc.querySelector('[data-view="multi"]').click();
  assert.equal(doc.querySelector('#dmh-panel').style.display, 'none');
  assert.equal(doc.querySelector('#dmd-multi-count').closest('.dmd-progress-area')?.querySelector('progress').id, 'dmd-multi-progress');
  assert.equal(doc.querySelector('#dmd-content').closest('details').open, false);
  doc.querySelector('#dmd-message-modes [data-mode="server"]').click();
  assert.equal(doc.querySelector('#dmd-channel').closest('.dmd-field').hidden, true);
  doc.querySelector('#dmd-message-modes [data-mode="channel"]').click();
  assert.equal(doc.querySelector('#dmd-channel').closest('.dmd-field').hidden, false);
  assert.equal(doc.querySelector('#dmd-forum-archived').closest('.dmd-scan-option') !== null, true);
  for (const side of ['after', 'before']) {
    const kind = doc.querySelector(`#dmd-${side}-kind`);
    kind.value = 'id'; kind.dispatchEvent(new dom.window.Event('change'));
    assert.equal(doc.querySelector(`#dmd-${side}-date-field`).hidden, true);
    assert.equal(doc.querySelector(`#dmd-${side}-id-field`).hidden, false);
    kind.value = 'date'; kind.dispatchEvent(new dom.window.Event('change'));
  }
  assert.equal(doc.querySelector('#dmd-rx-author').previousElementSibling.textContent.trim(), 'Author(s)');
  assert.ok(doc.querySelector('#dmd-rx-user-avatar'));
  assert.ok(doc.querySelector('#dmd-rx-guild-avatar'));
  const startKind = doc.querySelector('#dmd-rx-start-kind');
  startKind.value = 'date'; startKind.dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.querySelector('#dmd-rx-start-id-field').hidden, true);
  assert.equal(doc.querySelector('#dmd-rx-start-date-field').hidden, false);
  assert.equal(doc.querySelector('#dmd-rx-start-date-field .dmd-select-trigger').textContent, 'Choose date & time');
  startKind.value = 'id'; startKind.dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.querySelector('#dmd-rx-start-date-field').hidden, true);
  assert.equal(doc.querySelector('#dmd-start').nextElementSibling.id, 'dmd-add-queue');
  assert.equal(doc.querySelector('#dmd-add-queue').classList.contains('dmd-orange'), true);
  assert.equal(doc.querySelector('#dmd-queue-conversation-inputs'), null);
  assert.equal(doc.querySelector('#dmd-multi-add-current'), null);
  assert.equal(doc.querySelector('#dmd-multi-add-manual'), null);
  assert.equal(doc.querySelector('#dmd-id-input').placeholder, 'Paste message IDs or Discord message links (one per line)');
  const add = doc.querySelector('#dmd-add-queue').onclick();
  assert.equal(doc.querySelectorAll('.dmd-queue-row').length, 0);
  doc.querySelector('.dmd-confirm-actions button:last-child').click();
  await add;
  const duplicate = doc.querySelector('#dmd-add-queue').onclick();
  doc.querySelector('.dmd-confirm-actions button:last-child').click();
  await duplicate;
  assert.equal(doc.querySelectorAll('.dmd-queue-row').length, 1);
  assert.equal(JSON.parse(dom.window.localStorage.getItem('del_discord_v1_queue')).length, 1);
  doc.querySelector('.dmd-queue-row .dmd-red').click();
  assert.equal(doc.querySelectorAll('.dmd-queue-row').length, 0);
  const idsInput = doc.querySelector('#dmd-id-input');
  const firstLink = 'https://discord.com/channels/@me/1440796733998370860/1440796733998370861';
  idsInput.value = firstLink + '\ninvalid line';
  const importedLink = 'https://discord.com/channels/@me/1440796733998370860/1440796733998370862';
  await doc.querySelector('#dmd-id-files').onchange({ target: { files: [{ name: 'messages.txt', text: async () => importedLink }] } });
  assert.equal(idsInput.value, firstLink + '\ninvalid line\n' + importedLink);
  assert.equal(doc.querySelector('#dmd-id-count').textContent, '2 IDs');
  await doc.querySelector('#dmd-id-files').onchange({ target: { files: [{ name: 'messages.txt', text: async () => importedLink }] } });
  assert.equal(doc.querySelector('#dmd-id-count').textContent, '2 IDs');
  doc.querySelector('#dmd-id-clear').click();
  assert.equal(idsInput.value, '');
  assert.equal(doc.querySelector('#dmd-id-count').textContent, '0 IDs');
  vm.runInContext(bundle, dom.getInternalVMContext());
  doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  assert.equal(doc.querySelectorAll('#dmd-panel').length, 1);
  assert.equal(doc.querySelectorAll('#dmh-panel').length, 1);
  dom.window.history.pushState({}, '', '/channels/@me/234567890123456789');
  const replacement = doc.createElement('div');
  replacement.setAttribute('role', 'toolbar');
  doc.querySelector('[role="toolbar"]').replaceWith(replacement);
  await new Promise(resolve => dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(resolve)));
  assert.deepEqual([...replacement.children].map(el => el.id), ['dmd-toolbar-btn']);
  assert.equal(doc.querySelector('#dmd-channel').value, '234567890123456789');
  assert.deepEqual(errors, []);
});

test('extracted package importer keeps DM counts and skips server channels', async t => {
  const dom = new JSDOM('<button id="dmh-import"></button><div id="dmh-summary"></div><input id="dmh-folder">', { url: 'https://discord.com' });
  t.after(() => dom.window.close());
  setGlobal(t, 'document', dom.window.document);
  const history = {};
  let info, saved = 0, rendered = 0;
  const channel = '123456789012345678';
  const person = '234567890123456789';
  const file = (webkitRelativePath, data) => ({ webkitRelativePath, text: async () => JSON.stringify(data) });
  await importPackage([
    file('package/messages/index.json', { [channel]: 'Direct Message with Person' }),
    file(`package/messages/c${channel}/channel.json`, { id: channel, type: 'DM', recipients: [person] }),
    file(`package/messages/c${channel}/messages.json`, [{ ID: '1' }, { ID: '2' }]),
    file('package/messages/c345678901234567890/channel.json', { id: '345678901234567890', type: 'GUILD_TEXT' }),
  ], {
    $: selector => dom.window.document.querySelector(selector), getHistory: () => history,
    getIdentity: async () => null, setPackageInfo: value => { info = value; }, persist: () => saved++, render: () => rendered++,
  });
  assert.equal(info.importedCount, 1);
  assert.equal(history[`u:${person}`].sentCount, 2);
  assert.equal(history[`u:${person}`].name, 'Person');
  assert.equal(saved, 1);
  assert.equal(rendered, 1);
  assert.equal(dom.window.document.querySelector('#dmh-import').disabled, false);
});

test('reaction scan removes only own reactions after confirmation', async t => {
  const dom = new JSDOM('<body></body>', { url: 'https://discord.com' });
  t.after(() => dom.window.close());
  setGlobal(t, 'document', dom.window.document);
  const requests = [];
  t.mock.method(globalThis, 'setTimeout', callback => { callback(); return 0; });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return options.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json([
      { id: '200', author: { id: 'other' }, reactions: [{ me: true, emoji: { id: '999', name: 'wave' } }, { me: false, emoji: { name: '👍' } }] },
      { id: '100', author: { id: 'self' }, reactions: [{ me: true, emoji: { name: '👍' } }] },
    ]);
  });
  const task = removeReactions({ token: 'test-token', channelId: 'channel', scanLimit: 2, skipOwn: true, authorId: 'self', log: () => {} });
  for (let i = 0; i < 20 && !dom.window.document.querySelector('.dmd-confirm-box'); i++) await Promise.resolve();
  assert.equal(requests.length, 1);
  assert.ok(dom.window.document.querySelector('.dmd-confirm-box'));
  dom.window.document.querySelector('.dmd-confirm-box .dmd-red').click();
  await task;
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url.endsWith('/messages/200/reactions/wave%3A999/@me'), true);
});

test('panel background drags while controls, labels, logs and dialogs preserve their interaction', t => {
  const dom = new JSDOM('<div id="panel"><div id="blank">Background</div><button>Action</button><input><label>Label</label><summary>Filters</summary><div id="dmd-log">Selectable log</div><div role="dialog">Dialog</div></div>', { url: 'https://discord.com' });
  t.after(() => dom.window.close()); setGlobal(t, 'window', dom.window);
  const panel = dom.window.document.querySelector('#panel');
  panel.getBoundingClientRect = () => ({ left: parseFloat(panel.style.left) || 100, top: parseFloat(panel.style.top) || 100, width: parseFloat(panel.style.width) || 560, height: parseFloat(panel.style.height) || 400 });
  const controls = installPanelWindowControls({ panel, storage: () => dom.window.localStorage, storageKey: 'drag-test' });
  controls.ensureGeometry();
  const event = (name, x = 100, y = 100) => new dom.window.MouseEvent(name, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  for (const selector of ['button', 'input', 'label', 'summary', '#dmd-log', '[role="dialog"]']) {
    const before = panel.style.left;
    const down = event('pointerdown'); panel.querySelector(selector).dispatchEvent(down);
    dom.window.dispatchEvent(event('pointermove', 150, 150)); dom.window.dispatchEvent(event('pointerup'));
    assert.equal(panel.style.left, before);
    assert.equal(down.defaultPrevented, false);
  }
  const before = parseFloat(panel.style.left);
  panel.querySelector('#blank').dispatchEvent(event('pointerdown'));
  dom.window.dispatchEvent(event('pointermove', 80, 100)); dom.window.dispatchEvent(event('pointercancel'));
  assert.equal(parseFloat(panel.style.left), before - 20);
  const after = panel.style.left;
  dom.window.dispatchEvent(event('pointermove', 20, 100));
  assert.equal(panel.style.left, after, 'Cancelled drags must detach their listeners');
});

test('both bottom corners resize with the opposite horizontal edge anchored and save geometry', t => {
  const dom = new JSDOM('<div id="panel"><div data-resize-corner="left"></div><div data-resize-corner="right"></div></div>', { url: 'https://discord.com' });
  t.after(() => dom.window.close()); setGlobal(t, 'window', dom.window);
  Object.defineProperty(dom.window, 'innerWidth', { value: 1600 });
  Object.defineProperty(dom.window, 'innerHeight', { value: 1000 });
  dom.window.localStorage.setItem('resize-test', JSON.stringify({ left: 400, top: 100, width: 600, height: 450, ratio: 600 / 450 }));
  const panel = dom.window.document.querySelector('#panel');
  panel.getBoundingClientRect = () => ({ left: parseFloat(panel.style.left), top: parseFloat(panel.style.top), width: parseFloat(panel.style.width), height: parseFloat(panel.style.height) });
  const controls = installPanelWindowControls({ panel, resizeHandles: [...panel.children], storage: () => dom.window.localStorage, storageKey: 'resize-test' });
  controls.ensureGeometry();
  const event = (name, x) => new dom.window.MouseEvent(name, { bubbles: true, button: 0, clientX: x, clientY: 400 });
  const rightEdge = parseFloat(panel.style.left) + parseFloat(panel.style.width);
  panel.querySelector('[data-resize-corner="left"]').dispatchEvent(event('pointerdown', 400));
  dom.window.dispatchEvent(event('pointermove', 320)); dom.window.dispatchEvent(event('pointerup', 320));
  assert.equal(parseFloat(panel.style.width), 680);
  assert.equal(parseFloat(panel.style.left) + parseFloat(panel.style.width), rightEdge);
  const leftEdge = parseFloat(panel.style.left);
  panel.querySelector('[data-resize-corner="right"]').dispatchEvent(event('pointerdown', 1000));
  dom.window.dispatchEvent(event('pointermove', 1080)); dom.window.dispatchEvent(event('pointerup', 1080));
  assert.equal(parseFloat(panel.style.left), leftEdge);
  assert.equal(parseFloat(panel.style.width), 760);
  const saved = JSON.parse(dom.window.localStorage.getItem('resize-test'));
  assert.equal(saved.width, 760);
  assert.equal(saved.height, 450);
  assert.equal(saved.ratio, saved.width / saved.height);
});

test('bundled UI loads even when Discord hides local storage', async t => {
  const dom = new JSDOM('<header><div role="toolbar"></div></header>', { url: 'https://discord.com/channels/@me/123456789012345678', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  Object.defineProperty(dom.window, 'localStorage', { configurable: true, get() { throw new Error('Storage unavailable'); } });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', { get() { return this.parentElement; } });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 500, height: 40, top: 20, left: 400, right: 900 });
  const errors = []; dom.window.addEventListener('error', event => { errors.push(event.message); event.preventDefault(); });
  vm.runInContext(await readFile('dist/Del-Discord-v1.user.js', 'utf8'), dom.getInternalVMContext());
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  assert.ok(dom.window.document.querySelector('#dmd-toolbar-btn'));
  assert.ok(dom.window.document.querySelector('#dmd-clear-filters'));
  assert.deepEqual(errors, []);
});
