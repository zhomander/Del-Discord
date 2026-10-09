import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parseIdJson } from '../src/utils/json.js';
import { observeDiscordPage } from '../src/discord/page-observer.js';
import { installPanelWindowControls } from '../src/utils/drag.js';

function globalValue(t, key, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
}

test('ID JSON parsing copies only large integer tokens and preserves strings, escapes and other numbers', () => {
  const content = 'quoted "123456789012345678"\\ and 😀\n' + 'text '.repeat(100000);
  const input = '\uFEFF{"id":123456789012345678,"text":' + JSON.stringify(content) + ',"numbers":[1,-2,1.5,1e20,-123456789012345678,0]}';
  const parsed = parseIdJson(input);
  assert.equal(parsed.id, '123456789012345678');
  assert.equal(parsed.text, content);
  assert.deepEqual(parsed.numbers, JSON.parse('[1,-2,1.5,1e20,-123456789012345678,0]'));
  assert.deepEqual(parseIdJson(JSON.stringify({ text: content })), { text: content });
  for (const invalid of ['{"id":01}', '{"id":1e}', '"unclosed', '{"id":123456789012345678,}']) assert.throws(() => parseIdJson(invalid), SyntaxError);
});

test('page observer ignores its own UI mutations and discards frames from disconnected observers', t => {
  const dom = new JSDOM('<div id="dmd-panel"><pre></pre></div><main></main>');
  t.after(() => dom.window.close());
  const frames = [], notifications = [];
  globalValue(t, 'document', dom.window.document);
  globalValue(t, 'MutationObserver', class {
    constructor(callback) { notifications.push(callback); }
    observe() {}
    disconnect() {}
  });
  globalValue(t, 'requestAnimationFrame', callback => frames.push(callback));
  let first = 0, second = 0;
  const removeFirst = observeDiscordPage(() => first++);
  notifications[0]([{ target: dom.window.document.querySelector('pre') }]);
  const menu = dom.window.document.createElement('div'); menu.className = 'dmd-select-menu';
  notifications[0]([{ target: dom.window.document.body, addedNodes: [menu], removedNodes: [] }]);
  assert.equal(frames.length, 0);
  notifications[0]([{ target: dom.window.document.querySelector('main') }]);
  assert.equal(frames.length, 1);
  removeFirst();
  const removeSecond = observeDiscordPage(() => second++);
  t.after(removeSecond);
  notifications[1]([{ target: dom.window.document.querySelector('main') }]);
  frames.shift()();
  assert.equal(first, 0);
  assert.equal(second, 0);
  frames.shift()();
  assert.equal(second, 1);
});

test('drag pointer bursts update once per frame and flush the final position before saving', t => {
  const dom = new JSDOM('<div id="panel"><div>Move</div></div>', { url: 'https://discord.com' });
  t.after(() => dom.window.close());
  globalValue(t, 'window', dom.window);
  const frames = new Map(); let nextFrame = 0;
  dom.window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  dom.window.cancelAnimationFrame = id => frames.delete(id);
  const panel = dom.window.document.querySelector('#panel');
  panel.getBoundingClientRect = () => ({ left: parseFloat(panel.style.left) || 0, top: parseFloat(panel.style.top) || 0, width: 560, height: 400 });
  installPanelWindowControls({ panel, storage: () => dom.window.localStorage, storageKey: 'frame-geometry' }).ensureGeometry();
  const initial = parseFloat(panel.style.left);
  const pointer = (name, x) => new dom.window.MouseEvent(name, { bubbles: true, button: 0, clientX: x, clientY: 100 });
  panel.firstChild.dispatchEvent(pointer('pointerdown', 100));
  for (let x = 101; x <= 110; x++) dom.window.dispatchEvent(pointer('pointermove', x));
  assert.equal(frames.size, 1);
  assert.equal(parseFloat(panel.style.left), initial);
  dom.window.dispatchEvent(pointer('pointerup', 110));
  assert.equal(parseFloat(panel.style.left), initial + 10);
  assert.equal(frames.size, 0);
  assert.equal(JSON.parse(dom.window.localStorage.getItem('frame-geometry')).left, initial + 10);
});
