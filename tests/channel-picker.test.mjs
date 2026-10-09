import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installChannelPickers } from '../src/ui/channel-picker.js';

const guild = '1440796733150986395', otherGuild = '2440796733150986395';
const first = '1440796733998370860', second = '1440796733998370861';
function mount(t) {
  const dom = new JSDOM(`<input id="dmd-token" value="token"><div><input id="dmd-guild" value="${guild}"><input id="dmd-channel" value="${first}"></div><div><input id="dmd-multi-guild" value="${guild}"><input id="dmd-multi-channel"></div>`);
  t.after(() => dom.window.close());
  for (const [key, value] of Object.entries({ document: dom.window.document, window: dom.window, Event: dom.window.Event })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  const $ = selector => dom.window.document.querySelector(selector);
  return { $, doc: dom.window.document };
}
test('channel pickers share one guild request, select multiple channel names and preserve ID entry', async t => {
  const { $, doc } = mount(t); let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return Response.json([{ id: second, guild_id: guild, name: 'general', type: 0, position: 2 }, { id: first, name: 'announcements', type: 5, position: 1 }, { id: '1440796733998370862', name: 'Voice', type: 2 }, { id: '1440796733998370863', guild_id: otherGuild, name: 'Wrong server', type: 0 }]);
  });
  const pickers = installChannelPickers($);
  await pickers.refresh();
  assert.equal(requests, 1);
  const picker = $('#dmd-channel').nextElementSibling;
  assert.equal($('#dmd-channel').hidden, true);
  assert.equal(picker.querySelector('button').textContent, '#announcements');
  assert.equal(doc.querySelectorAll('.dmd-channel-option').length, 0);
  picker.querySelector('button').click();
  const choices = doc.querySelector('#dmd-channel-channel-menu').querySelectorAll('input[type="checkbox"]');
  assert.equal(choices.length, 2);
  assert.equal(choices[0].checked, true);
  const existingRow = choices[1].parentElement;
  choices[1].click();
  assert.equal(choices[1].parentElement, existingRow);
  assert.equal(existingRow.isConnected, true);
  assert.equal($('#dmd-channel').value, `${first}, ${second}`);
  assert.equal(picker.querySelector('button').textContent, '2 channels selected');
  assert.equal(doc.querySelectorAll('.dmd-channel-option').length, 2);
  doc.querySelector('#dmd-channel-channel-menu .dmd-btn').click();
  await pickers.refresh();
  assert.equal($('#dmd-channel').hidden, false);
  assert.equal($('#dmd-channel').value, `${first}, ${second}`);
  $('#dmd-channel').value = ''; $('#dmd-channel').dispatchEvent(new Event('blur'));
  await pickers.refresh();
  assert.equal($('#dmd-channel').hidden, true);
  assert.equal(picker.hidden, false);
  picker.querySelector('button').click();
  assert.equal($('#dmd-channel-channel-menu').querySelectorAll('input[type="checkbox"]')[1], choices[1]);
  $('#dmd-guild').value = '@me'; await pickers.refresh();
  assert.equal(picker.hidden, true);
});
test('stale guild responses cannot replace the current channel list or manual selections', async t => {
  const { $ } = mount(t); let release;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes(guild)) return new Promise(resolve => { release = () => resolve(Response.json([{ id: first, name: 'Old', type: 0 }])); });
    return Response.json([{ id: second, guild_id: otherGuild, name: 'New', type: 0 }]);
  });
  $('#dmd-multi-guild').value = '@me';
  const pickers = installChannelPickers($);
  const old = pickers.refresh(); await Promise.resolve();
  $('#dmd-guild').value = otherGuild; await pickers.refresh(); release(); await old;
  $('#dmd-channel').nextElementSibling.querySelector('button').click();
  assert.equal($('#dmd-channel-channel-menu').querySelector('.dmd-channel-option span').textContent, '#New');
  assert.equal($('#dmd-channel').value, first);
});
test('failed channel listing retains a usable manual ID field and can retry', async t => {
  const { $ } = mount(t);
  $('#dmd-multi-guild').value = '@me';
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => ++attempts === 1 ? new Response(null, { status: 403 }) : Response.json([]));
  const pickers = installChannelPickers($);
  await pickers.refresh();
  assert.equal($('#dmd-channel').hidden, false);
  assert.equal($('#dmd-channel').value, first);
  await pickers.refresh();
  assert.equal($('#dmd-channel').hidden, true);
});

test('large channel lists build rows only for opened menus and retain search and selection', async t => {
  const { $, doc } = mount(t); let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return Response.json(Array.from({ length: 500 }, (_, index) => ({ id: String(BigInt(first) + BigInt(index)), name: `channel-${index}`, type: 0, position: index })));
  });
  const pickers = installChannelPickers($);
  await pickers.refresh();
  assert.equal(requests, 1); assert.equal(doc.querySelectorAll('.dmd-channel-option').length, 0);
  $('#dmd-channel').nextElementSibling.querySelector('button').click();
  const menu = $('#dmd-channel-channel-menu'), originalRows = [...menu.querySelectorAll('.dmd-channel-option')];
  assert.equal(originalRows.length, 500); assert.equal(doc.querySelectorAll('.dmd-channel-option').length, 500);
  const search = menu.querySelector('input[type="search"]'); search.value = 'channel-499'; search.dispatchEvent(new Event('input'));
  assert.equal(originalRows.filter(row => !row.hidden).length, 1);
  originalRows[499].querySelector('input').click();
  assert.equal($('#dmd-channel').value, `${first}, ${BigInt(first) + 499n}`);
  await pickers.refresh();
  doc.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); assert.equal(menu.hidden, true);
  $('#dmd-channel').nextElementSibling.querySelector('button').click();
  assert.equal(menu.querySelector('.dmd-channel-option'), originalRows[0]); assert.equal(requests, 1);
  doc.defaultView.dispatchEvent(new Event('resize')); assert.equal(menu.hidden, true);
});
