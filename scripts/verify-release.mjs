import { readFile } from 'node:fs/promises';

const project = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const expected = `v${project.version}`;
if (process.env.RELEASE_TAG !== expected) {
  throw new Error(`Release tag must match package.json: expected ${expected}.`);
}
console.log(`Release tag matches ${expected}.`);
