import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const { outputFiles } = await build({ entryPoints: ['src/ui/history.js'], bundle: true, format: 'iife', globalName: 'HistoryUI', write: false, loader: { '.html': 'text', '.css': 'text' } });
const self = '123456789012345678';
const userId = '234567890123456789';
const channel = '345678901234567890';
function mount(t, history) {
  const dom = new JSDOM('<div id="container"><div id="dmd-progress-dock"></div></div>', { url: 'https://discord.com', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.localStorage.setItem('del_discord_v1_history', JSON.stringify(history));
  dom.window.localStorage.setItem('token', JSON.stringify('token-for-history-test-at-least-20-chars'));
  dom.window.Headers = Headers;
  dom.window.fetch = async () => { throw new Error('Unexpected Discord request.'); };
  dom.window.setTimeout = callback => { callback(); return 0; };
  dom.window.eval(outputFiles[0].text);
  const ui = dom.window.HistoryUI.initHistory(dom.window.document.querySelector('#container'));
  return { dom, ui, $: selector => dom.window.document.querySelector(selector) };
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('cached names without custom avatars render and page without identity or user requests', async t => {
  const history = {};
  for (let i = 0; i < 25; i++) history[`u:${i}`] = { userId: String(i), channelId: String(i + 100), name: `Person ${String(i).padStart(2, '0')}`, username: `@person${i}`, avatar: '', verifiedSent: true, sentCount: 1 };
  const { dom, ui, $ } = mount(t, history);
  let requests = 0;
  dom.window.fetch = async () => { requests++; return Response.json({ id: self }); };
  ui.activate();
  $('#dmh-next').click();
  await settle();
  assert.equal(requests, 0);
  assert.equal($('#dmh-page').textContent, 'Page 2 of 3');
  assert.equal($('#dmh-list .dmh-name').textContent, 'Person 10');
  $('#dmh-search').value = 'PERSON 24';
  $('#dmh-search').dispatchEvent(new dom.window.Event('input'));
  assert.equal($('#dmh-page').textContent, 'Page 1 of 1');
  assert.equal($('#dmh-list .dmh-name').textContent, 'Person 24');
});

test('missing users do not repeat failed name requests on every activation', async t => {
  const { dom, ui } = mount(t, { [`u:${userId}`]: { userId, channelId: channel, verifiedSent: true, sentCount: 3 } });
  const requests = [];
  dom.window.fetch = async url => {
    requests.push(url);
    return url.endsWith('/users/@me') ? Response.json({ id: self }) : new Response(null, { status: 404 });
  };
  ui.activate(); await settle();
  ui.activate(); await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests.filter(url => url.endsWith(`/users/${userId}`)).length, 1);
});

test('a page change during a name request resolves the newly visible page', async t => {
  const history = {};
  for (let i = 0; i < 11; i++) history[`u:${i}`] = { userId: String(i), channelId: String(i + 100), dmRank: i, name: i === 0 || i === 10 ? '' : `Person ${i}`, username: i === 0 || i === 10 ? '' : `@person${i}`, verifiedSent: true, sentCount: 1 };
  const { dom, ui, $ } = mount(t, history);
  let release;
  const requests = [];
  dom.window.fetch = async url => {
    requests.push(url);
    if (url.endsWith('/users/@me')) return Response.json({ id: self });
    if (url.endsWith('/users/0')) return new Promise(resolve => { release = () => resolve(Response.json({ id: '0', username: 'zero' })); });
    return Response.json({ id: '10', username: 'ten' });
  };
  ui.activate(); await settle();
  assert.equal(typeof release, 'function');
  $('#dmh-next').click();
  release(); await settle();
  assert.equal($('#dmh-list .dmh-name').textContent, 'ten');
  assert.equal(requests.filter(url => url.endsWith('/users/10')).length, 1);
});

test('partial user profiles retain their retry delay when merging replaces the history entry', async t => {
  const { dom, ui, $ } = mount(t, { [`u:${userId}`]: { userId, channelId: channel, verifiedSent: true, sentCount: 3 } });
  const requests = [];
  dom.window.fetch = async url => {
    requests.push(url);
    return url.endsWith('/users/@me') ? Response.json({ id: self }) : Response.json({ id: userId, global_name: 'Partial profile' });
  };
  ui.activate(); await settle();
  assert.equal($('#dmh-list .dmh-name').textContent, 'Partial profile');
  ui.activate(); await settle();
  assert.equal(requests.length, 2);
});

test('clearing history during name resolution cannot restore the cleared entries', async t => {
  const { dom, ui, $ } = mount(t, { [`u:${userId}`]: { userId, channelId: channel, verifiedSent: true, sentCount: 3 } });
  let release;
  dom.window.fetch = async url => {
    if (url.endsWith('/users/@me')) return Response.json({ id: self });
    return new Promise(resolve => { release = () => resolve(Response.json({ id: userId, username: 'late result' })); });
  };
  ui.activate(); await settle();
  assert.equal(typeof release, 'function');
  $('#dmh-clear').click();
  $('.dmd-confirm-actions .dmd-red').click(); await settle();
  release(); await settle();
  assert.equal($('#dmh-list').querySelectorAll('.dmh-row').length, 0);
  assert.equal(dom.window.localStorage.getItem('del_discord_v1_history'), '{}');
});
