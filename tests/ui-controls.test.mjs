import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { enhanceSelects } from '../src/ui/select.js';
import { enhanceCalendars } from '../src/ui/calendar.js';
import { createLog } from '../src/ui/log.js';
import { installIdentityPreviews } from '../src/ui/identity-preview.js';

function mount(t, html) {
  const dom = new JSDOM(html);
  for (const [key, value] of Object.entries({ document: dom.window.document, window: dom.window, Event: dom.window.Event })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  t.after(() => dom.window.close());
  const $ = selector => dom.window.document.querySelector(selector);
  return { $, dom, panel: $('#panel') };
}

test('reused select menus honor changed native options and skip disabled choices', t => {
  const { $, dom, panel } = mount(t, '<div id="panel"><label for="choice">Choice</label><select id="choice"><option value="a">A</option><option value="b" disabled>B</option><option value="c">C</option></select></div>');
  enhanceSelects(panel);
  const select = $('#choice'), trigger = select.nextElementSibling;
  trigger.click();
  const menu = $('.dmd-select-menu'), firstButton = menu.firstElementChild;
  assert.equal(dom.window.document.activeElement, firstButton);
  menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(dom.window.document.activeElement.textContent, 'C');
  dom.window.document.activeElement.click();
  assert.equal(select.value, 'c');
  assert.equal($('.dmd-select-menu'), null);
  assert.equal(trigger.textContent, 'C');
  select.options[0].textContent = 'Updated'; select.options[1].disabled = false;
  select.remove(2); select.value = 'b'; trigger.click();
  assert.equal($('.dmd-select-menu'), menu);
  assert.equal(menu.firstElementChild, firstButton);
  assert.equal(menu.children.length, 2);
  assert.equal(firstButton.textContent, 'Updated');
  assert.equal(dom.window.document.activeElement.textContent, 'B');
  menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal($('.dmd-select-menu'), null);
  assert.equal(dom.window.document.activeElement, trigger);
  select.append(new dom.window.Option('New', 'new')); trigger.click();
  menu.lastElementChild.click(); assert.equal(select.value, 'new');
  select.disabled = true; select.dispatchEvent(new Event('change')); trigger.click();
  assert.equal($('.dmd-select-menu'), null);
});

test('calendar reuses day controls, resets cancelled values, and applies changed month and time', t => {
  const { $, dom, panel } = mount(t, '<div id="panel"><div><label>Date</label><input id="date" type="datetime-local" value="2024-02-29T12:34"></div></div>');
  enhanceCalendars(panel);
  const input = $('#date'), trigger = input.nextElementSibling;
  let changes = 0; panel.addEventListener('change', () => changes++);
  trigger.click();
  const picker = $('.dmd-calendar'), days = [...picker.querySelectorAll('.dmd-calendar-grid button')];
  assert.equal(days.length, 42);
  assert.equal(picker.querySelector('.selected').textContent, '29');
  days.find(day => day.textContent === '10' && !day.classList.contains('outside')).click();
  assert.equal(picker.querySelector('.selected').textContent, '10');
  assert.equal(picker.querySelector('.dmd-calendar-grid button'), days[0]);
  picker.querySelector('[aria-label="Next month"]').click();
  const march15 = days.find(day => day.textContent === '15' && !day.classList.contains('outside')); march15.click();
  picker.querySelector('[aria-label="Hour"]').value = '23'; picker.querySelector('[aria-label="Minute"]').value = '59';
  picker.querySelector('.dmd-calendar-footer button:last-child').click();
  assert.equal(input.value, '2024-03-15T23:59'); assert.equal(changes, 1);
  assert.equal($('.dmd-calendar'), null); assert.equal(dom.window.document.activeElement, trigger);
  trigger.click(); assert.equal($('.dmd-calendar'), picker);
  assert.equal(picker.querySelector('.dmd-calendar-grid button'), days[0]);
  picker.querySelector('[aria-label="Hour"]').value = '1';
  picker.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  trigger.click(); assert.equal(picker.querySelector('[aria-label="Hour"]').value, '23');
  picker.querySelector('.dmd-calendar-footer button:first-child').click();
  assert.equal(input.value, ''); assert.equal(changes, 2);
  input.disabled = true; input.dispatchEvent(new Event('change')); trigger.click();
  assert.equal($('.dmd-calendar'), null);
});

test('log bursts retain rows synchronously and scroll once after their DOM writes', async t => {
  const { $ } = mount(t, '<pre id="log"></pre>');
  const box = $('#log'); let reads = 0;
  Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => { reads++; return box.childElementCount * 20; } });
  const { log, logEntries } = createLog(box);
  for (let i = 0; i < 100; i++) log('info', `entry ${i}`);
  assert.equal(logEntries.length, 100); assert.equal(box.childElementCount, 100); assert.equal(reads, 0);
  await Promise.resolve();
  assert.equal(reads, 1); assert.equal(box.scrollTop, 2000);
  log('info', 'next'); await Promise.resolve();
  assert.equal(reads, 2); assert.equal(box.scrollTop, 2020);
});

test('identity previews share pending requests and keep each preview version independent', async t => {
  const id = '1440796733150986395', other = '2440796733150986395';
  const { $ } = mount(t, `<input id="dmd-token" value="token"><input id="first" value="${id}"><span id="first-badge"></span><input id="second" value="${id}"><span id="second-badge"></span>`);
  const cache = new Map(); let requests = 0, release;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Promise(resolve => { release = () => resolve(Response.json({ id, name: 'Shared guild' })); }); });
  const one = installIdentityPreviews($, { author: null, guild: '#first', userBadge: null, guildBadge: '#first-badge', cache });
  const two = installIdentityPreviews($, { author: null, guild: '#second', userBadge: null, guildBadge: '#second-badge', cache });
  const loading = Promise.all([one.refresh('guild'), two.refresh('guild'), two.refresh('guild')]);
  $('#first').value = other;
  await Promise.resolve(); assert.equal(requests, 1);
  release(); await loading;
  assert.equal($('#first-badge').hidden, true); assert.equal($('#second-badge').title, 'Shared guild');
  await two.refresh('guild'); assert.equal(requests, 1);
  assert.equal(cache.get(`guild:${id}`).name, 'Shared guild');
});

test('failed shared identity loads can retry', async t => {
  const id = '1440796733150986395';
  const { $ } = mount(t, `<input id="dmd-token" value="token"><input id="guild" value="${id}"><span id="badge"></span>`);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => ++requests === 1 ? new Response(null, { status: 403 }) : Response.json({ id, name: 'Retried guild' }));
  const preview = installIdentityPreviews($, { author: null, guild: '#guild', userBadge: null, guildBadge: '#badge' });
  await preview.refresh('guild'); assert.equal($('#badge').hidden, true);
  await preview.refresh('guild'); assert.equal(requests, 2); assert.equal($('#badge').title, 'Retried guild');
});

test('pending identity requests use the token of each preview account', async t => {
  const id = '1440796733150986395';
  const { $ } = mount(t, `<input id="dmd-token" value="token-a"><input id="second-token" value="token-b"><input id="guild" value="${id}"><span id="first-badge"></span><span id="second-badge"></span>`);
  const tokens = [], releases = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const token = options.headers.Authorization; tokens.push(token);
    return new Promise(resolve => releases.push(() => resolve(Response.json({ id, name: token }))));
  });
  const cache = new Map();
  const one = installIdentityPreviews($, { author: null, guild: '#guild', userBadge: null, guildBadge: '#first-badge', cache });
  const otherAccount = selector => selector === '#dmd-token' ? $('#second-token') : $(selector);
  const two = installIdentityPreviews(otherAccount, { author: null, guild: '#guild', userBadge: null, guildBadge: '#second-badge', cache });
  const loading = Promise.all([one.refresh('guild'), two.refresh('guild')]);
  await Promise.resolve(); assert.deepEqual(tokens, ['token-a', 'token-b']);
  releases.forEach(release => release()); await loading;
  assert.equal($('#first-badge').title, 'token-a'); assert.equal($('#second-badge').title, 'token-b');
});
