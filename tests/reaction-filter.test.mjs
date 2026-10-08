import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parseReactionIds, matchesReaction } from '../src/features/reaction-filter.js';
import { removeReactions } from '../src/features/reactions.js';

const selected = '123456789012345678', other = '234567890123456789';
test('reaction filter accepts IDs and custom emoji tags and excludes Unicode when filtering IDs', () => {
  const ids = parseReactionIds(`${selected}, <:wave:${selected}>; <a:dance:${other}>`);
  assert.deepEqual([...ids], [selected, other]);
  assert.equal(matchesReaction({ id: selected }, ids), true);
  assert.equal(matchesReaction({ name: '👍', id: null }, ids), false);
  assert.equal(matchesReaction({ name: '👍' }, parseReactionIds('')), true);
  assert.throws(() => parseReactionIds('invalid'), /emoji IDs/);
});

test('reaction cleanup previews and removes only your selected custom emoji IDs', async t => {
  const dom = new JSDOM('<body></body>', { url: 'https://discord.com' });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  t.after(() => { dom.window.close(); if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document; });
  t.mock.method(globalThis, 'setTimeout', callback => { callback(); return 0; });
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method) { writes.push(url); return new Response(null, { status: 204 }); }
    return Response.json([{ id: '300', author: { id: 'other' }, reactions: [
      { me: true, emoji: { id: selected, name: 'wave' } },
      { me: false, emoji: { id: selected, name: 'wave' } },
      { me: true, emoji: { id: other, name: 'dance' } },
      { me: true, emoji: { name: '👍' } },
    ] }]);
  });
  const task = removeReactions({ token: 'test', channelId: 'channel', scanLimit: 1, reactionIds: selected, log: () => {} });
  let box;
  for (let i = 0; i < 100 && !box; i++) { box = dom.window.document.querySelector('.dmd-confirm-box'); await Promise.resolve(); }
  assert.ok(box.textContent.includes('Remove 1 of your reactions'));
  assert.ok(box.textContent.includes(selected));
  assert.equal(writes.length, 0);
  box.querySelector('.dmd-red').click();
  await task;
  assert.equal(writes.length, 1);
  assert.ok(writes[0].endsWith(`/messages/300/reactions/wave%3A${selected}/@me`));
});

test('invalid reaction filter fails before requesting Discord', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json([]); });
  await assert.rejects(removeReactions({ reactionIds: 'oops', log: () => {} }), /emoji IDs/);
  assert.equal(calls, 0);
});
