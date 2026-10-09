import assert from 'node:assert/strict';
import { createMessageCollection } from '../src/features/message-collection.js';
import { performance } from 'node:perf_hooks';
import { importPackage } from '../src/features/history/import-package.js';

const scenario = process.argv[2] || 'scan';
if (!['scan', 'history', 'csv'].includes(scenario)) throw new Error('Use scan, history, or csv.');
let peakHeap = 0, peakRss = 0;
const sample = () => { const usage = process.memoryUsage(); peakHeap = Math.max(peakHeap, usage.heapUsed); peakRss = Math.max(peakRss, usage.rss); };
globalThis.gc?.();
const baseline = process.memoryUsage();
const started = performance.now();
let result;
if (scenario === 'scan') {
  const collector = createMessageCollection('asc');
  for (let page = 0; page < 1000; page++) {
    const batch = Array.from({ length: 100 }, (_, offset) => {
      const id = String(123456789012345678n + BigInt(page * 100 + offset));
      return { id, channel_id: '234567890123456789', content: `${id}: ${'content '.repeat(250)}`, author: { id: 'self', username: 'Example' }, attachments: [{ id, filename: `${id}.png`, url: `https://example.invalid/${id}` }], embeds: [{ description: 'embed '.repeat(500) }] };
    });
    collector.add(batch);
    sample();
  }
  globalThis.gc?.(); sample();
  result = { messages: collector.messages.length, retainedHeapMiB: (process.memoryUsage().heapUsed - baseline.heapUsed) / 1048576 };
} else {
  const history = {}, elements = new Map();
  const $ = id => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); };
  const storage = { setItem: (_key, value) => { JSON.parse(value); sample(); } };
  globalThis.document = { createElement: () => ({ style: {}, setAttribute() {}, contentWindow: { localStorage: storage } }), body: { appendChild(frame) { frame.isConnected = true; } } };
  globalThis.requestAnimationFrame = callback => { sample(); callback(); };
  const file = (path, data) => ({ name: path.split('/').at(-1), webkitRelativePath: path, text: async () => { const text = typeof data === 'function' ? data() : data; sample(); return text; } });
  const csv = scenario === 'csv';
  const count = csv ? 1 : 5000;
  const files = [];
  for (let i = 0; i < count; i++) {
    const id = String(123456789012345678n + BigInt(i));
    const folder = `messages/c${id}`;
    files.push(file(`${folder}/channel.json`, JSON.stringify({ id, type: 'DM', recipients: [String(234567890123456789n + BigInt(i))] })));
    if (csv) {
      const blob = new Blob(['ID,Timestamp,Contents\n', '123456789012345678,2026-01-01,"message content here"\n'.repeat(1000000)]);
      const item = file(`${folder}/messages.csv`, '');
      item.text = async () => { const text = await blob.text(); sample(); return text; };
      item.stream = () => blob.stream().pipeThrough(new TransformStream({ transform(chunk, controller) { sample(); controller.enqueue(chunk); } })); files.push(item);
      globalThis.gc?.(); sample();
    } else files.push(file(`${folder}/messages.json`, () => JSON.stringify(Array.from({ length: 20 }, (_, n) => ({ id: n, content: 'example' })))));
  }
  await importPackage(files, { $, getHistory: () => history, getIdentity: async () => null, setPackageInfo() {}, persist: sample, render: sample });
  result = { conversations: Object.keys(history).length, sentMessages: Object.values(history).reduce((sum, item) => sum + item.sentCount, 0) };
}
sample();
if (process.argv.includes('--check') && scenario === 'scan') assert.ok(result.retainedHeapMiB <= 16, `Scan retained ${result.retainedHeapMiB.toFixed(2)} MiB; limit is 16 MiB.`);
console.log(JSON.stringify({ scenario, ...result, elapsedMs: performance.now() - started, peakHeapMiB: peakHeap / 1048576, peakRssMiB: peakRss / 1048576 }, null, 2));
