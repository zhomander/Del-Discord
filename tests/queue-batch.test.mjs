import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createQueue } from '../src/features/queue.js';

test('adding a large approved queue batch deduplicates and persists once', t => {
  const dom = new JSDOM('<div id="dmd-multi-list"></div><span id="dmd-multi-count"></span>', { url: 'https://discord.com' });
  t.after(() => dom.window.close());
  for (const [key, value] of Object.entries({ document: dom.window.document, localStorage: dom.window.localStorage })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  let writes = 0, changes = 0;
  const original = dom.window.Storage.prototype.setItem;
  t.mock.method(dom.window.Storage.prototype, 'setItem', function (...args) { writes++; return original.apply(this, args); });
  const queue = createQueue({ $: selector => dom.window.globalThis.document.querySelector(selector), log: () => {}, onChange: () => changes++ });
  const jobs = Array.from({ length: 200 }, (_, i) => ({ guildId: '@me', channelId: String(1440796733998370860n + BigInt(i)), options: { action: 'delete' } }));
  assert.equal(queue.addQueueItems([...jobs, ...jobs]), 200);
  assert.equal(writes, 2); assert.equal(changes, 1);
  assert.equal(queue.getItems().length, 200);
  assert.equal(dom.window.globalThis.document.querySelectorAll('.dmd-queue-row').length, 200);
  assert.equal(queue.addQueueItems(jobs), 0); assert.equal(writes, 2);
});

test('storage quota failure keeps the queue usable and warns once', t => {
  const dom = new JSDOM('<div id="dmd-multi-list"></div><span id="dmd-multi-count"></span>', { url: 'https://discord.com' });
  t.after(() => dom.window.close());
  for(const [key,value] of Object.entries({document:dom.window.document,localStorage:dom.window.localStorage})){
    const previous=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    t.after(()=>previous?Object.defineProperty(globalThis,key,previous):delete globalThis[key]);
  }
  t.mock.method(dom.window.Storage.prototype,'setItem',()=>{throw new Error('Quota exceeded');});
  const warnings=[];
  const queue=createQueue({$:selector=>globalThis.document.querySelector(selector),log:(type,text)=>warnings.push({type,text})});
  queue.addQueueItem('@me','1440796733998370860'); queue.addQueueItem('@me','1440796733998370861');
  assert.equal(queue.getItems().length,2); assert.equal(globalThis.document.querySelectorAll('.dmd-queue-row').length,2);
  assert.equal(warnings.length,1); assert.equal(warnings[0].type,'warn');
});
