#!/usr/bin/env node
/**
 * Keeps the 2D pattern workspace (pattern2d/) what the 2D tab needs it to be.
 * Its own suite (npm run validate:pattern2d) tests what the code does; this
 * gate checks what the suite cannot see:
 *
 *   data      the repo is public and carries code, never a pattern: no DXF
 *             under pattern2d/ except the synthetic engine fixtures (written by
 *             ezdxf from hand-made shapes), and none anywhere in what git holds
 *             or would take but those and the 3D export flatten-draft.dxf; no
 *             fixture of factory data, no `lib` half in their expected.json,
 *             every fixture's bytes the ones its sha256 pins, no file bigger
 *             than any source ever was.
 *   modules   plain ES modules node runs as they are (the suite and the local
 *             real-DXF checkers import them): relative imports that resolve
 *             inside pattern2d/, no package, no .mjs, no CSS imported from JS,
 *             no import.meta.env, every app module loading in node with no DOM,
 *             features never importing app/, no cycle; and the 3D app (src/)
 *             never importing pattern2d/.
 *   rules     two rules of pattern2d/CLAUDE.md that were enforced by a script
 *             of the 2D workspace: §5.13 every export of the geometry kernel is
 *             named in its tests; §5.17 the kernel imports only itself and
 *             shared/, never the Canvas. Also: every feature carries a test,
 *             and src/README.md lists exactly the features there are.
 *   page      pattern2d/index.html links every stylesheet once and starts
 *             src/app/main.js; it inlines no sample.
 *   bridge    the host (src/ui/tabs.mjs) and the workspace
 *             (features/dxf/import.js) name the same three messages; the page
 *             has the tabs in the order 2D · 3D with 3D selected, the 2D pane
 *             and Open in 2D; and what the 3D pattern block exports
 *             (qa/avatar_master/flatten-draft.dxf, written by
 *             validate:dxf-roundtrip) opens in the workspace's own reader — in
 *             mm, from its AAMA text, with no warning.
 *
 * It writes no evidence file: qa/avatar_master/ is the avatar's record, and
 * nothing here is measured on the avatar.
 *
 * Exit codes: 0 holds, 1 a check failed, 2 an input is missing.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGate, sha256File } from './gate_report.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P2D = join(ROOT, 'pattern2d');
const gate = createGate();
for (const need of ['pattern2d/src', 'pattern2d/tests', 'pattern2d/index.html', 'src/ui/tabs.mjs', 'digital_bra_fit_model_360.html'])
  if (!existsSync(join(ROOT, need))) gate.blocked(`${need} is missing`);

const rel = (abs) => relative(ROOT, abs).split('\\').join('/');
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const all = walk(P2D).map(rel).filter((f) => !f.endsWith('.DS_Store')).sort();
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const list = (xs, n = 6) => xs.slice(0, n).join(', ') + (xs.length > n ? ` … (+${xs.length - n})` : '');

// ---- data --------------------------------------------------------------------
const FIXTURES = 'pattern2d/tests/fixtures/engine/';
const dxfs = all.filter((f) => /\.dxf$/i.test(f));
const strayDxf = dxfs.filter((f) => !(f.startsWith(FIXTURES) && !f.slice(FIXTURES.length).includes('/')));
gate.record('data: no DXF but the synthetic engine fixtures', strayDxf.length === 0, strayDxf.length ? list(strayDxf) : `${dxfs.length} fixture(s)`);
const strayFixtures = all.filter((f) => f.startsWith('pattern2d/tests/fixtures/') && !f.startsWith(FIXTURES));
gate.record('data: no fixture outside tests/fixtures/engine/ (3380, the corpus list stay in the private workspace)', strayFixtures.length === 0, list(strayFixtures));
const outputs = all.filter((f) => /^pattern2d\/(output|DXF file|input|spec)\//.test(f));
gate.record('data: no output/, DXF file/, input/ or spec/ of the 2D workspace', outputs.length === 0, list(outputs));
let meta = null;
try { meta = JSON.parse(read(`${FIXTURES}expected.json`)); } catch (e) { gate.record('data: engine expected.json reads', false, e.message); }
if (meta) {
  const libFiles = Object.keys(meta.files || {}).filter((k) => k.startsWith('lib:'));
  gate.record('data: expected.json has no library half (no lib: file, no expected.lib)', libFiles.length === 0 && !('lib' in (meta.expected || {})), list(libFiles));
  const pins = Object.entries(meta.files || {});
  const bad = pins.filter(([, f]) => !f.path.startsWith('tests/fixtures/engine/') || !existsSync(join(P2D, f.path)) || sha256File(join(P2D, f.path)) !== f.sha256).map(([k]) => k);
  const unpinned = dxfs.filter((f) => !pins.some(([, p]) => `pattern2d/${p.path}` === f));
  gate.record('data: every fixture is the file its sha256 pins, and every fixture is pinned', bad.length === 0 && unpinned.length === 0, bad.length || unpinned.length ? `${list(bad)} ${list(unpinned)}` : `${pins.length} pinned`);
}
// The whole repo, not only pattern2d/: every DXF git holds or would take (tracked, or untracked and not
// ignored) must be the 3D export the dxf-roundtrip gate writes or a synthetic engine fixture.
// Outside a git checkout (an exported copy) every file is one git would take, so the tree itself is listed.
let gitDxf = null;
try { gitDxf = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] })
  .split('\0').filter((f) => /\.dxf$/i.test(f)); } catch {
  const SKIP = new Set(['.git', 'node_modules', 'dist', '.claude', 'backups']);
  const tree = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => SKIP.has(e.name) ? []
    : e.isDirectory() ? tree(join(dir, e.name)) : [rel(join(dir, e.name))]);
  gitDxf = tree(ROOT).filter((f) => /\.dxf$/i.test(f));
}
{
  const allowed = (f) => f === 'qa/avatar_master/flatten-draft.dxf' || (f.startsWith(FIXTURES) && !f.slice(FIXTURES.length).includes('/'));
  const extra = gitDxf.filter((f) => !allowed(f));
  gate.record('data: the only DXFs git holds or would take are flatten-draft.dxf and the engine fixtures', extra.length === 0, extra.length ? list(extra) : `${gitDxf.length} DXF(s)`);
}
const LIMIT = 128 * 1024;
const big = all.filter((f) => statSync(join(ROOT, f)).size > LIMIT);
gate.record(`data: no file over ${LIMIT / 1024} KB`, big.length === 0, list(big.map((f) => `${f} ${Math.round(statSync(join(ROOT, f)).size / 1024)} KB`)));

// ---- modules -----------------------------------------------------------------
const js = all.filter((f) => f.endsWith('.js'));
const isTest = (f) => f.endsWith('.test.js') || f.startsWith('pattern2d/tests/');
const specifiers = (text) => {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const out = [];
  for (const re of [/\bimport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g]) for (const m of code.matchAll(re)) out.push(m[1]);
  return [...new Set(out)];
};
const other = all.filter((f) => /\.(mjs|cjs|ts|jsx|tsx)$/.test(f));
gate.record('modules: .js only (no .mjs, which a static host may not serve as JavaScript)', other.length === 0, list(other));
const graph = new Map(); const problems = { unresolved: [], outside: [], bare: [], app: [], tests: [] };
for (const f of js) {
  const deps = [];
  for (const s of specifiers(read(f))) {
    if (!s.startsWith('.')) { if (!(isTest(f) && s.startsWith('node:'))) problems.bare.push(`${f} -> ${s}`); continue; }
    const target = posix.normalize(posix.join(posix.dirname(f), s));
    if (!target.startsWith('pattern2d/')) { problems.outside.push(`${f} -> ${target}`); continue; }
    if (!existsSync(join(ROOT, target))) { problems.unresolved.push(`${f} -> ${s}`); continue; }
    if (f.startsWith('pattern2d/src/features/') && target.startsWith('pattern2d/src/app/')) problems.app.push(`${f} -> ${target}`);
    if (!isTest(f) && target.startsWith('pattern2d/tests/')) problems.tests.push(`${f} -> ${target}`);
    deps.push(target);
  }
  graph.set(f, deps);
}
gate.record('modules: every relative import resolves', problems.unresolved.length === 0, list(problems.unresolved));
gate.record('modules: nothing in pattern2d/ imports outside it (the 3D, scripts/, node_modules)', problems.outside.length === 0, list(problems.outside));
gate.record('modules: no package import (tests may use node: built-ins)', problems.bare.length === 0, list(problems.bare));
gate.record('modules: features never import app/', problems.app.length === 0, list(problems.app));
gate.record('modules: the app never imports tests/', problems.tests.length === 0, list(problems.tests));
const bundlerOnly = js.flatMap((f) => [
  ...specifiers(read(f)).filter((s) => /\.css$/i.test(s)).map((s) => `${f} imports ${s}`),
  ...(/\bimport\.meta\.env\b/.test(read(f)) ? [`${f} reads import.meta.env`] : [])]);
gate.record('modules: nothing only a bundler understands (no CSS imported from JS, no import.meta.env)', bundlerOnly.length === 0, list(bundlerOnly));
// the suite and the private checkers import these in node: none may touch the DOM just by loading
// (but app/main.js, the page's entry, whose one job is to start the app)
const loadable = js.filter((f) => f.startsWith('pattern2d/src/') && !isTest(f) && f !== 'pattern2d/src/app/main.js');
const loadFailures = [];
for (const f of loadable) {
  try { await import(pathToFileURL(join(ROOT, f)).href); } catch (e) { loadFailures.push(`${f}: ${e.message.split('\n')[0]}`); }
}
gate.record('modules: every app module loads in node with no DOM', loadFailures.length === 0, loadFailures.length ? list(loadFailures, 3) : `${loadable.length} modules`);
const cycles = [];
{ const state = new Map(); const stack = [];
  const visit = (f) => { state.set(f, 1); stack.push(f);
    for (const d of graph.get(f) || []) { if (!graph.has(d)) continue;
      if (state.get(d) === 1) cycles.push([...stack.slice(stack.indexOf(d)), d].join(' -> ')); else if (!state.get(d)) visit(d); }
    stack.pop(); state.set(f, 2); };
  for (const f of [...graph.keys()].filter((f) => !isTest(f))) if (!state.get(f)) visit(f); }
gate.record('modules: no import cycle', cycles.length === 0, list(cycles, 2));
const hostImports = walk(join(ROOT, 'src')).map(rel).filter((f) => f.endsWith('.mjs'))
  .flatMap((f) => specifiers(read(f)).filter((s) => s.includes('pattern2d')).map((s) => `${f} -> ${s}`));
gate.record('modules: the 3D app (src/) never imports pattern2d/ — the tabs carry messages, not code', hostImports.length === 0, list(hostImports));

// ---- rules -------------------------------------------------------------------
const GEO = 'pattern2d/src/features/geometry/';
const geoFiles = js.filter((f) => f.startsWith(GEO) && !f.slice(GEO.length).includes('/'));
const geoTests = geoFiles.filter((f) => f.endsWith('.test.js')).map(read).join('\n');
const untested = [];
for (const f of geoFiles.filter((f) => !f.endsWith('.test.js') && !f.endsWith('/geometry.js')))
  for (const m of read(f).matchAll(/^export\s+(?:const|let|var|function|class|async function)\s+([A-Za-z0-9_$]+)/gm))
    if (!new RegExp(`(?<![.\\w$])${m[1].replace(/\$/g, '\\$')}(?![\\w$])`).test(geoTests)) untested.push(`${f.slice(GEO.length)}: ${m[1]}`);
gate.record('rules: §5.13 every export of the geometry kernel is named in its tests', untested.length === 0, list(untested));
const unworldly = [];
for (const f of geoFiles.filter((f) => !f.endsWith('.test.js') && !f.endsWith('/geometry.js'))) {
  const text = read(f);
  for (const s of specifiers(text)) if (!(s.startsWith('./') || s.startsWith('../../shared/'))) unworldly.push(`${f.slice(GEO.length)} imports ${s}`);
  if (/\bpxPerMM\b|\bCanvas\./.test(text)) unworldly.push(`${f.slice(GEO.length)} touches the Canvas`);
}
gate.record('rules: §5.17 the geometry kernel imports only itself and shared/, never the Canvas', unworldly.length === 0, list(unworldly));
const features = readdirSync(join(P2D, 'src/features')).filter((d) => statSync(join(P2D, 'src/features', d)).isDirectory()).sort();
const untestedFeatures = features.filter((d) => !readdirSync(join(P2D, 'src/features', d)).some((n) => n.endsWith('.test.js')));
gate.record('rules: every feature carries a *.test.js', untestedFeatures.length === 0, list(untestedFeatures));
const listed = new Set([...read('pattern2d/src/README.md').matchAll(/^\s*(?:├──|└──)\s+([a-z]+)\//gm)].map((m) => m[1]));
const missing = features.filter((d) => !listed.has(d)), ghosts = [...listed].filter((d) => !features.includes(d) && !['app', 'shared', 'features'].includes(d));
gate.record('rules: src/README.md lists exactly the features there are', missing.length === 0 && ghosts.length === 0, `${missing.length ? `unlisted ${list(missing)} ` : ''}${ghosts.length ? `gone ${list(ghosts)}` : ''}`.trim() || `${features.length} features`);

// ---- page --------------------------------------------------------------------
const page = read('pattern2d/index.html');
const linked = [...page.matchAll(/<link\s+rel="stylesheet"\s+href="\.\/([^"]+)"/g)].map((m) => `pattern2d/${m[1]}`);
const css = all.filter((f) => f.endsWith('.css'));
const cssProblems = [...css.filter((f) => !linked.includes(f)).map((f) => `unlinked ${f}`),
  ...linked.filter((f, i) => linked.indexOf(f) !== i).map((f) => `twice ${f}`), ...linked.filter((f) => !existsSync(join(ROOT, f))).map((f) => `missing ${f}`)];
gate.record('page: every stylesheet linked once', cssProblems.length === 0, cssProblems.length ? list(cssProblems) : `${linked.length} stylesheets`);
gate.record('page: starts src/app/main.js as a module', /<script\s+type="module"\s+src="\.\/src\/app\/main\.js"><\/script>/.test(page) && existsSync(join(P2D, 'src/app/main.js')));
gate.record('page: inlines no sample (the workspace opens empty)', !/sample-dxf|SECTION|__SAMPLE/.test(page));

// ---- bridge ------------------------------------------------------------------
const imp = await import(pathToFileURL(join(P2D, 'src/features/dxf/import.js')).href);
const tabs = read('src/ui/tabs.mjs');
const hostNames = Object.fromEntries([...tabs.matchAll(/\b(OPEN_DXF|READY|OPENED)='([^']+)'/g)].map((m) => [m[1], m[2]]));
const same = ['OPEN_DXF', 'READY', 'OPENED'].every((k) => hostNames[k] && hostNames[k] === imp[k]);
gate.record('bridge: host and workspace name the same three messages', same, JSON.stringify(hostNames));
const url = /WORKSPACE_URL='([^']+)'/.exec(tabs)?.[1];
gate.record('bridge: the 2D tab frames the workspace page', url === 'pattern2d/index.html' && existsSync(join(ROOT, url)), url);
const host = read('digital_bra_fit_model_360.html');
const ids = ['workspaceTabs', 'tab2d', 'tab3d', 'pane2d', 'patternOpen2d'].filter((id) => !host.includes(`id="${id}"`));
gate.record('bridge: the page has the tabs, the 2D pane and Open in 2D', ids.length === 0, list(ids));
const t2 = host.indexOf('id="tab2d"'), t3 = host.indexOf('id="tab3d"');
const tab3 = /<button[^>]*id="tab3d"[^>]*>/.exec(host)?.[0] || '', tab2 = /<button[^>]*id="tab2d"[^>]*>/.exec(host)?.[0] || '';
gate.record('bridge: tabs read 2D · 3D, and 3D is the one selected', t2 > 0 && t2 < t3 && /aria-selected="true"/.test(tab3) && /aria-selected="false"/.test(tab2));
const DRAFT = 'qa/avatar_master/flatten-draft.dxf';
if (!existsSync(join(ROOT, DRAFT))) gate.blocked(`${DRAFT} is missing — run npm run validate:dxf-roundtrip`);
const { decode } = await import(pathToFileURL(join(P2D, 'src/features/dxf/decode.js')).href);
const { parseDXF } = await import(pathToFileURL(join(P2D, 'src/features/dxf/parse.js')).href);
const { buildModel } = await import(pathToFileURL(join(P2D, 'src/features/dxf/model.js')).href);
const model = buildModel(parseDXF(decode(new Uint8Array(readFileSync(join(ROOT, DRAFT))))));
const opened = { pieces: model.pieces.length, unit: model.units.unit, source: model.units.source, warnings: model.warnings.length };
gate.record('bridge: the 3D pattern export opens in the workspace — pieces, mm from its AAMA text, no warning',
  opened.pieces >= 1 && opened.unit === 'mm' && opened.source === 'AAMA' && opened.warnings === 0, `${DRAFT}: ${JSON.stringify(opened)}`);

gate.finish({ okDecision: 'PATTERN2D_OK', lines: [`${all.length} file(s) under pattern2d/, ${js.length} module(s), ${features.length} feature(s)`] });
