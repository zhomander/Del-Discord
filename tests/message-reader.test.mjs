import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageReader } from '../src/discord/message-reader.js';
import { RunStoppedError } from '../src/discord/api.js';

const channel = '123456789012345678';
const id = '234567890123456789';
test('forbidden single-message lookup uses history once per run and returns only the exact message', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    return url.includes('?around=') ? Response.json([{ id: 'other', channel_id: channel }, { id, channel_id: channel, author: { id: 'self' } }]) : new Response(null, { status: 403 });
  });
  const read = createMessageReader('token', () => {});
  assert.equal((await (await read(channel, id)).json()).id, id);
  assert.equal((await read(channel, 'absent')).status, 404);
  assert.equal(calls.length, 3);
  assert.ok(calls[2].includes('?around=absent&limit=3'));
});
test('history access denial is returned without retrying or accepting malformed history', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
  assert.equal((await createMessageReader('token', () => {})(channel, id)).status, 403);
  t.mock.method(globalThis, 'fetch', async url => url.includes('?') ? Response.json({ id }) : new Response(null, { status: 403 }));
  await assert.rejects(createMessageReader('token', () => {})(channel, id), /invalid message history/);
});
test('cancellation after denied lookup prevents history fallback', async t => {
  let stopped = false;
  t.mock.method(globalThis, 'fetch', async () => { stopped = true; return new Response(null, { status: 403 }); });
  await assert.rejects(createMessageReader('token', () => {}, () => stopped)(channel, id), RunStoppedError);
});
