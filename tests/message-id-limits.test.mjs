import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessageIds, importMessageIds } from '../src/features/message-ids.js';

const channel = '1440796733998370860';
const ids = Array.from({ length: 10001 }, (_, i) => (1440796733998370860n + BigInt(i)).toString());
test('message ID batches accept the boundary and reject oversized lines, tokens and JSON', () => {
  assert.equal(parseMessageIds(ids.slice(0, 10000).join('\n'), channel).length, 10000);
  for (const input of [ids.join('\n'), ids.join(','), JSON.stringify(ids), 'x'.repeat(1200001)]) {
    assert.throws(() => parseMessageIds(input, channel), /10000|too large/);
  }
});
test('oversized imports are rejected before reading or mapping their IDs', async () => {
  let read = false;
  await assert.rejects(importMessageIds([{ name: 'messages.txt', size: 1200001, text: async () => { read = true; return ''; } }], channel), /too large/);
  assert.equal(read, false);
  await assert.rejects(importMessageIds([{ name: 'messages.csv', text: async () => 'ID\n' + ids.join('\n') }], channel), /10000/);
});

test('invalid entries are skipped without discarding valid IDs', () => {
  assert.deepEqual(parseMessageIds(`${ids[0]}\ngarbage\nhttps://example.com/nope\n${ids[1]}`, channel).map(target => target.messageId), ids.slice(0, 2));
});
