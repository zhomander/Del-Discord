import assert from 'node:assert/strict';
import test from 'node:test';
import { planRelease } from '../scripts/release-plan.mjs';

test('main publishes a changed version but skips ordinary merges', () => {
  assert.equal(planRelease('2.0.1', '2.0.0', 'refs/heads/main').release, true);
  assert.equal(planRelease('2.0.0', '2.0.0', 'refs/heads/main').release, false);
  assert.equal(planRelease('2.0.1', '2.0.0', 'refs/heads/feature').release, false);
  assert.equal(planRelease('2.0.1', '2.0.0', 'refs/heads/main').tag, 'v2.0.1');
});

test('manual tags retain draft behavior and must match the package version', () => {
  assert.equal(planRelease('2.0.1', '', 'refs/tags/v2.0.1').automatic, false);
  assert.throws(() => planRelease('2.0.1', '', 'refs/tags/v2.0.2'), /must match/);
});

test('prereleases are identified and malformed versions rejected', () => {
  assert.equal(planRelease('2.1.0-beta.1', '2.0.0', 'refs/heads/main').prerelease, true);
  for (const version of ['2.0', 'v2.0.1', '02.0.1', '2.0.1\nextra']) {
    assert.throws(() => planRelease(version, '2.0.0', 'refs/heads/main'));
  }
});
