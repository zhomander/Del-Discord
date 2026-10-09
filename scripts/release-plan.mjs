import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function planRelease(version, previousVersion, ref) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version)) {
    throw new Error('Release version must use major.minor.patch with an optional prerelease suffix.');
  }
  const tag = `v${version}`;
  if (ref.startsWith('refs/tags/')) {
    if (ref !== `refs/tags/${tag}`) throw new Error(`Release tag must match package.json: expected ${tag}.`);
    return { release: true, tag, automatic: false, prerelease: version.includes('-') };
  }
  return { release: ref === 'refs/heads/main' && version !== previousVersion, tag, automatic: true, prerelease: version.includes('-') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  let previousVersion = version;
  if (process.env.GITHUB_REF === 'refs/heads/main') {
    const before = process.env.PUSH_BEFORE;
    if (!/^[0-9a-f]{40}$/.test(before || '') || /^0+$/.test(before)) throw new Error('A previous main commit is required.');
    previousVersion = JSON.parse(execFileSync('git', ['show', `${before}:package.json`], { encoding: 'utf8' })).version;
  }
  const plan = planRelease(version, previousVersion, process.env.GITHUB_REF || '');
  await appendFile(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(''));
  console.log(plan.release ? `Prepare ${plan.tag}.` : 'Version unchanged; no release needed.');
}
