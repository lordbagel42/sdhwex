import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const snapshot = JSON.parse(await read('data/snapshot.json'));
const designSnapshot = JSON.parse(await read('data/design-snapshot.json'));
const css = await read('src/card.css');
const source = await read('src/content.js');
const bundle = `(() => {\n'use strict';\n${source}\ninstallTriage(${JSON.stringify(snapshot)}, ${JSON.stringify(css)}, ${JSON.stringify(designSnapshot)});\n})();\n`;
const manifest = {
  manifest_version: 3,
  name: 'sdhwex',
  version: '1.2.0',
  description: 'Adds design and build queue triage snapshots to hardware review pages. Offline, read-only findings; no live checking.',
  content_scripts: [{
    matches: ['https://stardance.hackclub.com/*'],
    js: ['content.js'],
    run_at: 'document_idle'
  }]
};
// Match the whole origin so Turbo navigation from the queue also works. The
// script itself inserts a card only on /admin/certification/hardware/<ID>.
await mkdir(new URL('dist/chrome/', root), { recursive: true });
await writeFile(new URL('dist/chrome/manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(new URL('dist/chrome/content.js', root), bundle);
const metadata = `// ==UserScript==
// @name         sdhwex
// @namespace    local.stardance.build-queue-triage
// @version      1.2.0
// @description  Shows design and build triage snapshots on hardware review pages. No live checks or automatic reviews.
// @match        https://stardance.hackclub.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==
\n`;
await writeFile(new URL('dist/stardance-triage.user.js', root), metadata + bundle);
console.log(`Built Chrome extension and userscript: ${snapshot.projects.length} build projects (${snapshot.checkedAt}), ${designSnapshot.projects.length} design projects (${designSnapshot.checkedAt}).`);
