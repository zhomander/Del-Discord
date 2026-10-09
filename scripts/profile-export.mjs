import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { conversationToBlob, conversationsToCsv } from '../src/features/export.js';

// Flatten the fixture before measuring, so neither serializer pays for creating
// or flattening the input strings and both process the same message data.
const conversation = JSON.parse(JSON.stringify({
  exportedAt: '2026-10-09T12:00:00.000Z', guildId: '@me', channelId: '123456789012345678', label: 'Example',
  range: { after: null, before: null }, messageCount: 20000,
  messages: Array.from({ length: 20000 }, (_, index) => ({
    id: String(123456789012345678n + BigInt(index)), timestamp: '2026-10-09T12:00:00.000Z', type: 0,
    content: `Message ${index}: ` + 'content '.repeat(250), author: { id: 'self', username: 'Example' },
    attachments: [], embeds: [], reactions: [], mentions: [], referencedMessage: null,
  })),
}));

async function measure(format, legacy = false) {
  globalThis.gc?.();
  const baseline = process.memoryUsage().heapUsed, started = performance.now();
  const value = legacy ? (format === 'json' ? JSON.stringify(conversation, null, 2) : conversationsToCsv([conversation])) : await conversationToBlob(conversation, { format });
  const temporaryHeapMiB = (process.memoryUsage().heapUsed - baseline) / 1048576;
  const elapsedMs = performance.now() - started;
  globalThis.gc?.();
  const retainedHeapMiB = (process.memoryUsage().heapUsed - baseline) / 1048576;
  const bytes = legacy ? Buffer.byteLength(value) : value.size;
  const result = { format, serializer: legacy ? 'whole string' : 'chunked Blob', messages: conversation.messageCount, bytes, elapsedMs: +elapsedMs.toFixed(1), temporaryHeapMiB: +temporaryHeapMiB.toFixed(2), retainedHeapMiB: +retainedHeapMiB.toFixed(2) };
  if (process.argv.includes('--check')) {
    assert.ok(bytes > 40_000_000, 'Large-export fixture was not fully serialized.');
    assert.ok(retainedHeapMiB <= 2, `${format} export retains more than 2 MiB on the JavaScript heap.`);
  }
  console.log(JSON.stringify(result));
}

for (const format of ['json', 'csv']) {
  if (process.argv.includes('--compare')) await measure(format, true);
  await measure(format);
}
