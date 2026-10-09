import test from 'node:test';
import assert from 'node:assert/strict';
import { createAsyncCache } from '../src/utils/async-cache.js';
import { createQueueIdentityResolver } from '../src/discord/queue-identity.js';
import { CACHE_LIFETIME, createExpiringStorage } from '../src/utils/expiring-storage.js';
import { JSDOM } from 'jsdom';
import { installSavedSettings } from '../src/ui/saved-settings.js';

test('metadata cache shares pending requests, expires from completion and retries failures', async t => {
  let now = 0, release, calls = 0;
  t.mock.method(Date, 'now', () => now);
  const cache = createAsyncCache({ ttl: 100 });
  const loader = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const first = cache.get('one', loader), second = cache.get('one', loader);
  assert.equal(first, second); await Promise.resolve();
  now = 500; release('data'); await first;
  assert.equal(calls, 1);
  now = 599; assert.equal(await cache.get('one', () => 'wrong'), 'data');
  now = 600; assert.equal(await cache.get('one', () => 'fresh'), 'fresh');
  await assert.rejects(cache.get('failed', () => { throw new Error('fail'); }), /fail/);
  assert.equal(await cache.get('failed', () => 'retry'), 'retry');
});
test('bounded cache evicts old entries and an old rejected request cannot remove its replacement', async () => {
  const cache = createAsyncCache({ limit: 1 });
  let reject;
  const old = cache.get('a', () => new Promise((resolve, rejectPromise) => { reject = rejectPromise; }));
  const rejected = assert.rejects(old, /old/); await Promise.resolve();
  await cache.get('b', () => 'b');
  assert.equal(cache.peek('a'), undefined);
  await cache.get('a', () => 'replacement');
  reject(new Error('old')); await rejected;
  assert.equal(await cache.get('a', () => 'wrong'), 'replacement');
});
test('server validation and multiple queue icons reuse the same metadata but isolate accounts', async t => {
  let requests = 0;
  const guild = '1440796733150986395';
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ id: guild, name: 'Server', icon: 'a_icon' }); });
  const identities = createQueueIdentityResolver();
  await identities.readGuild(guild, 'account-one');
  for (const channelId of ['1440796733998370860', '1440796733998370861']) {
    const identity = await identities.resolve({ guildId: guild, channelId, label: 'Discord | Channel' }, 'account-one');
    assert.equal(identity.label, 'Channel'); assert.ok(identity.icon.endsWith('.gif?size=64'));
  }
  assert.equal(requests, 1);
  await identities.readGuild(guild, 'account-two');
  assert.equal(requests, 2);
});

test('saved cache expires at three days and ordinary writes do not extend it', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let now = 1000;
  const cache = createExpiringStorage('queue', storage, () => now);
  cache.write('first'); now += CACHE_LIFETIME - 1; cache.write('updated');
  assert.equal(cache.read(), 'updated'); now++;
  assert.equal(cache.read(), null); assert.equal(values.size, 0);
  cache.write('new'); assert.equal(cache.read(), 'new'); cache.clear(); assert.equal(values.size, 0);
});
test('legacy saved data gets a three-day expiry on first access', () => {
  const values = new Map([['settings', 'legacy']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let now = 1000; const cache = createExpiringStorage('settings', storage, () => now);
  assert.equal(cache.read(), 'legacy'); now += CACHE_LIFETIME; assert.equal(cache.read(), null);
});

test('cache initialization and access remain safe when page storage is unavailable', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : delete globalThis.localStorage);
  const cache = createExpiringStorage('settings');
  assert.equal(cache.read(), null);
  assert.doesNotThrow(() => cache.write('value'));
  assert.doesNotThrow(() => cache.clear());
});

test('Messages settings restore values and mode, omit the token and reset defaults', t => {
  const dom = new JSDOM('<div id="panel"><div id="dmd-messages"><input id="text"><input id="token" type="password"><input id="scan" type="checkbox" checked><select id="action"><option value="delete">Delete</option><option value="overwrite">Overwrite</option></select></div></div>', { url: 'https://discord.com' });
  t.after(() => dom.window.close());
  for (const [key, value] of Object.entries({ localStorage: dom.window.localStorage, Event: dom.window.Event })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const panel = dom.window.document.querySelector('#panel');
  let mode = 'server'; const callbacks = { getMode: () => mode, setMode: value => { mode = value; } };
  const settings = installSavedSettings(panel, callbacks);
  panel.querySelector('#text').value = 'saved filter'; panel.querySelector('#token').value = 'secret';
  panel.querySelector('#action').value = 'overwrite'; panel.querySelector('#scan').checked = false;
  settings.save();
  const saved = localStorage.getItem('del_discord_v1_message_settings');
  assert.equal(saved.includes('secret'), false);
  const newPanel = panel.cloneNode(true); newPanel.querySelector('#text').value = ''; newPanel.querySelector('#action').value = 'delete'; newPanel.querySelector('#scan').checked = true;
  mode = 'dm'; const restored = installSavedSettings(newPanel, callbacks);
  assert.equal(newPanel.querySelector('#text').value, 'saved filter');
  assert.equal(newPanel.querySelector('#scan').checked, false);
  assert.equal(newPanel.querySelector('#action').value, 'overwrite'); assert.equal(mode, 'server');
  restored.clear();
  assert.equal(newPanel.querySelector('#text').value, ''); assert.equal(newPanel.querySelector('#scan').checked, true);
  assert.equal(mode, 'dm'); assert.equal(localStorage.getItem('del_discord_v1_message_settings'), null);
});
