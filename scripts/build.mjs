import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const project = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const header = `// ==UserScript==
// @name         Del-Discord v1
// @namespace    local.del-discord
// @version      ${project.version}
// @author       Del-Discord contributors
// @homepageURL  https://github.com/zhomander/del-discord
// @supportURL   https://github.com/zhomander/del-discord/issues
// @license      MIT
// @description  Personal message deletion, reaction removal, queues, exports, and DM history.
// @match        https://discord.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// Local build. No remote updates or hosted dependencies.

`;
const license = await readFile(new URL('LICENSE', root), 'utf8');
await mkdir(new URL('dist/', root), { recursive: true });
const result = await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ['src/index.js'],
  outfile: 'dist/Del-Discord-v1.user.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  loader: { '.html': 'text', '.css': 'text' },
  banner: { js: header + '/*\n' + license + '*/' },
  metafile: true,
  write: false,
});
for (const output of result.outputFiles) await writeFile(output.path, output.contents);
await writeFile(new URL('dist/build-manifest.json', root), JSON.stringify(result.metafile, null, 2) + '\n');
console.log(`Built Del-Discord v${project.version} from separate ES modules, HTML, and CSS.`);
