#!/usr/bin/env node
/**
 * Checks that `dist/` is the site we mean to publish.
 *
 * The important rule is the first one: NO `.mjs` may be served. Static hosts
 * do not agree on its MIME type (nginx returns application/octet-stream,
 * Apache returns none) and a browser refuses to execute a module that is not
 * labelled JavaScript. The prototype imports four `.mjs` modules when served
 * locally, so a deploy that copies it verbatim instead of bundling it would
 * publish a blank page -- and the failure would only appear after merge.
 *
 * The layout rules exist because the prototype is the landing page: getting
 * `/` and `/viewer/` the wrong way round is silent, not an error.
 *
 * Run by both the PR gates and the deploy workflow, so the build that gets
 * published is the build that was checked.
 *
 * Usage:  node scripts/check_pages_layout.mjs [dist-dir]
 * Exit:   0 publishable, 1 not.
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = process.argv[2] || 'dist';
const problems = [];

if (!existsSync(DIST) || !statSync(DIST).isDirectory()) {
  console.error(`FAIL   ${DIST}/ does not exist — run \`npm run build:pages\` first.`);
  process.exit(1);
}

/** Every file under dir, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(DIST);

const mjs = files.filter((f) => f.endsWith('.mjs'));
if (mjs.length) {
  problems.push(
    `${mjs.length} .mjs file(s) would be served: ${mjs.map((f) => relative(DIST, f)).join(', ')}\n` +
    '       A host that mislabels their MIME type leaves a blank page. Bundle them.',
  );
}

// One app, served at the root. There was a second lane under /viewer/ until it
// was merged into this one; nothing should publish there any more.
const required = [
  ['index.html', 'the app is the landing page'],
  ['assets/export/avatar_master.glb', 'the GLB (a runtime string the bundler cannot see)'],
  ['contracts/measurement-registry.json', 'the registry (also fetched at runtime)'],
  ['contracts/pattern-templates.json', 'the template drafts (fetched at runtime)'],
  ['contracts/measurement-levels.json', 'the reference levels (fetched at runtime)'],
  ['contracts/body-grid.json', 'the body grid (fetched at runtime)'],
];
for (const [path, why] of required) {
  if (!existsSync(join(DIST, path))) problems.push(`missing ${path} — ${why}`);
}

// A leftover /viewer/ would be a second, stale copy of the app on the live
// site -- exactly the split the merge removed.
if (existsSync(join(DIST, 'viewer'))) {
  problems.push('dist/viewer/ exists — the second lane was merged away; delete dist/ and rebuild');
}

console.log(`checked ${files.length} file(s) in ${DIST}/`);
if (problems.length) {
  for (const problem of problems) console.error(`FAIL   ${problem}`);
  process.exit(1);
}
console.log('DECISION PAGES_LAYOUT_OK');
