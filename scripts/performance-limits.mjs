import assert from 'node:assert/strict';

// Retained heap is measured after an event-loop turn and explicit garbage collection.
// These limits allow runtime overhead while catching significant retained growth.
export function checkUiPerformance(result) {
  const heapLimit = result.name.includes('cycles') ? 1.5 : result.name.includes('queue') ? 12 : result.name.includes('log') ? 8 : 2;
  assert.ok(result.retainedHeapMiB <= heapLimit, `${result.name}: retained ${result.retainedHeapMiB} MiB exceeds ${heapLimit} MiB.`);
  if (result.openMenus !== undefined) assert.equal(result.openMenus, 0, 'Detached UI cycle left menus open.');
  if (result.retainedEntries !== undefined) assert.ok(result.retainedEntries <= 10000, 'Export log retention exceeds 10,000 entries.');
  if (result.visibleRows !== undefined) assert.ok(result.visibleRows <= 600, 'Visible log retention exceeds 600 rows.');
  if (result.storageBytes !== undefined) assert.ok(result.storageBytes <= 100000, '200-job queue storage exceeds 100 KB.');
}
