import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUiPerformance } from '../scripts/performance-limits.mjs';

test('performance gates reject excessive retained heap, UI remnants and unbounded logs', () => {
  assert.doesNotThrow(() => checkUiPerformance({ name:'500 cycles', retainedHeapMiB:1, openMenus:0 }));
  for(const result of [
    {name:'500 cycles',retainedHeapMiB:1.51,openMenus:0},
    {name:'500 cycles',retainedHeapMiB:0,openMenus:1},
    {name:'log',retainedHeapMiB:0,retainedEntries:10001},
    {name:'log',retainedHeapMiB:0,visibleRows:601},
    {name:'queue',retainedHeapMiB:0,storageBytes:100001},
  ]) assert.throws(()=>checkUiPerformance(result), assert.AssertionError);
});
