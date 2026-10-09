import { readdir, readFile } from 'node:fs/promises';
import { parse } from 'acorn';
import { parseDocument } from 'yaml';

async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await checkDirectory(file);
    else if (/\.(?:js|mjs)$/.test(file)) parse(await readFile(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  }
}

await checkDirectory('src');
await checkDirectory('scripts');
await checkDirectory('tests');
for (const file of ['.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/ISSUE_TEMPLATE/bugreport.yml']) {
  const document = parseDocument(await readFile(file, 'utf8'), { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${file}: ${document.errors.map(error => error.message).join('\n')}`);
  const configuration = document.toJS();
  if (file.includes('/workflows/') && (!configuration.on || !configuration.jobs)) throw new Error(`${file}: missing workflow triggers or jobs`);
  if (file.includes('/ISSUE_TEMPLATE/')) {
    const fields = configuration.body.filter(field => field.type !== 'markdown');
    if (fields.some(field => !field.id) || new Set(fields.map(field => field.id)).size !== fields.length) throw new Error(`${file}: missing or duplicate field IDs`);
  }
}
for (const file of ['dist/Del-Discord-v1.user.js', 'dist/Del-Discord.greasyfork.user.js']) {
  const bundle = await readFile(file, 'utf8');
  parse(bundle, { ecmaVersion: 'latest', sourceType: 'script' });
  if (!bundle.startsWith('// ==UserScript==')) throw new Error('Missing userscript header');
  if ((bundle.match(/\/\/ ==UserScript==/g) || []).length !== 1) throw new Error('Duplicate userscript headers');
}
console.log('All modules, the standalone userscript, and GitHub configuration parse successfully.');
