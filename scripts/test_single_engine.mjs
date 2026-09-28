#!/usr/bin/env node
/**
 * Keeps the app from growing a second copy of the maths.
 *
 * There used to be two viewer lanes and this gate proved they could not
 * disagree. They have been merged into one, so the checks that compared them
 * are gone — what is left is the half that still bites: the app must reach the
 * measurement, the pen, the path, the flattening, the keymap and the view
 * geometry through the SHARED modules, and must reimplement none of them. That
 * is the cheap way a number starts to differ from the number the gates check,
 * whether or not there is a second page to differ from.
 *
 * Merging removed one class of bug outright rather than gating it: there is no
 * second served registry to fork, because the app reads contracts/ directly and
 * the build copies those files verbatim.
 *
 * It is a static check on purpose: it needs no browser and runs in CI.
 *
 * Exit codes: 0 there is one engine, 1 a check failed, 2 an input is missing.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(ROOT, 'contracts', 'measurement-registry.json');
// The app is the page and the viewer's modules (src/ui/viewer): everything that
// is the host rather than a shared module.
const APP = join(ROOT, 'digital_bra_fit_model_360.html');
const VIEWER = join(ROOT, 'src', 'ui', 'viewer');
const ENGINE = join(ROOT, 'src', 'core', 'measure_core.mjs');
const PEN = join(ROOT, 'src', 'features', 'pen', 'pen_tool.mjs');
const PATHS = join(ROOT, 'src', 'core', 'surface_path.mjs');
const REPORT_PATH = join(ROOT, 'qa', 'avatar_master', 'single-engine.json');

const checks = [];
const record = (name, ok, detail) => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); return ok; };
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

for (const required of [REGISTRY, APP, VIEWER, ENGINE, PATHS, PEN]) {
  if (!existsSync(required)) {
    console.error(`BLOCKED: missing ${relative(ROOT, required)}`);
    process.exit(2);
  }
}

// The app fetches contracts/measurement-registry.json itself and the build
// copies that file verbatim, so there is no second copy to fork. What is worth
// checking is that it asks for the contract rather than carrying one.
const modulesIn = (dir) => readdirSync(dir).sort().flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? modulesIn(path) : name.endsWith('.mjs') ? [path] : [];
});
const app = [APP, ...modulesIn(VIEWER)].map((path) => readFileSync(path, 'utf8')).join('\n');
const engine = readFileSync(ENGINE, 'utf8');
const paths = readFileSync(PATHS, 'utf8');
record('the app reads the registry from contracts/, not a copy of its own',
  /contracts\/measurement-registry\.json/.test(app) && !/viewer\/public/.test(app),
  `sha256 ${sha256(REGISTRY).slice(0, 12)}… — fetched at runtime, copied verbatim into dist/`);

// --- the app must use the shared engine, not its own copy of the maths ------
record('the app imports the shared measurement engine',
  /from\s+['"][^'"]*measure_core\.mjs['"]/.test(app), 'imports src/core/measure_core.mjs');

// The 2D pattern draft goes through one module that sits on the shared engine
// and the shared DXF writer.
const DRAFT = join(ROOT, 'src', 'features', 'pattern', 'pattern_draft.mjs');
const draft = existsSync(DRAFT) ? readFileSync(DRAFT, 'utf8') : '';
record('the app drafts patterns through src/features/pattern/pattern_draft.mjs',
  /from\s+['"][^'"]*pattern_draft\.mjs['"]/.test(app), 'imports src/features/pattern/pattern_draft.mjs');
record('pattern_draft.mjs sits on the shared flattening engine and DXF writer',
  /from\s+['"][^'"]*flatten_core\.mjs['"]/.test(draft) && /from\s+['"][^'"]*dxf_writer\.mjs['"]/.test(draft),
  'imports src/core/flatten/flatten_core.mjs and src/features/pattern/dxf_writer.mjs');

// Reimplementing any of these in the host is how a shown number would start to
// differ from the number the gates check.
const ENGINE_FUNCTIONS = ['convexHull', 'sectionSegments', 'ringPerimeter', 'findLandmarks', 'computePoms',
  'hingeUnfold', 'relaxPieces', 'flattenPieces', 'extractPatch', 'loopChords'];   // src/core/flatten/flatten_core.mjs
{
  const redefined = ENGINE_FUNCTIONS.filter((name) => new RegExp(`function\\s+${name}\\s*\\(`).test(app));
  record('the app does not reimplement the engine', redefined.length === 0,
    redefined.length ? `redefines ${redefined.join(', ')}` : 'no engine function is redefined');
}

// --- the engine must stay asset-agnostic ------------------------------------
for (const [label, source] of [['measure_core.mjs', engine], ['surface_path.mjs', paths]]) {
  const leaked = /Mara:|avatar_master/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''));
  record(`${label} names no asset-specific material`, !leaked,
    leaked ? 'a material or asset name is hardcoded in the engine' : 'asset-agnostic');
}

// --- the app must not hardcode what the registry owns -----------------------
// It keeps a documented fallback so it still shows something when served
// without the registry; that is allowed, but only inside loadRegistry.
const fallbackBlock = app.slice(
  Math.max(0, app.indexOf('async function loadRegistry')),
  app.indexOf('async function runMeasurements'),
);
const strayMaterial = app
  .replace(fallbackBlock, '')
  .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  .match(/Mara:body3/g);
record('the app names the material only inside its documented fallback',
  !strayMaterial,
  strayMaterial ? `${strayMaterial.length} stray reference(s) outside loadRegistry()`
                : 'only in loadRegistry()');

// --- the pen is one tool ----------------------------------------------------
record('the app imports the shared pen tool',
  /from\s+['"][^'"]*pen_tool\.mjs['"]/.test(app), 'imports src/features/pen/pen_tool.mjs');
// Reimplementing the pen's geometry in the host is how a drafted line would
// start being measured differently from the way the gates measure it.
const PEN_FUNCTIONS = ['computeSegment', 'rebuildLine', 'initHandles', 'splitThree', 'runBetween'];
{
  const redefined = PEN_FUNCTIONS.filter((name) => new RegExp(`function\\s+${name}\\s*\\(`).test(app));
  record('the app does not reimplement the pen', redefined.length === 0,
    redefined.length ? `redefines ${redefined.join(', ')}` : 'no pen function is redefined');
}
const pen = readFileSync(PEN, 'utf8');
// One keyboard map and one view-geometry module: the keys, the grazing guard
// and the F key are the map's, not the host's, and the `?` sheet is generated
// from it (AUTHORING_UX_PLAN.md §14, §15 A5).
record('the app dispatches keys through the shared keymap',
  /from\s+['"][^'"]*keymap\.mjs['"]/.test(app) && /matchBinding\(/.test(app),
  'imports src/ui/keymap.mjs and calls matchBinding');
record('the app frames and turns the camera through the shared view geometry',
  /from\s+['"][^'"]*view_geometry\.mjs['"]/.test(app) && /framingDistance\(/.test(app) && /turntable\(/.test(app),
  'imports src/core/view_geometry.mjs for framingDistance and turntable');
const INTERACTION_FUNCTIONS = ['matchBinding', 'cheatSheet', 'normalizeEvent', 'footprintMmPerPx', 'incidence', 'placement', 'poseFacing', 'turntable', 'framingDistance'];
{
  const redefined = INTERACTION_FUNCTIONS.filter((name) => new RegExp(`function\\s+${name}\\s*\\(`).test(app));
  record('the app does not reimplement the keymap or view geometry', redefined.length === 0,
    redefined.length ? `redefines ${redefined.join(', ')}` : 'no interaction function is redefined');
}
record('the pen records placement through the shared view geometry',
  /from\s+['"][^'"]*\/core\/view_geometry\.mjs['"]/.test(pen) && /placement\(/.test(pen) && !/function\s+placement\s*\(/.test(pen),
  'imports src/core/view_geometry.mjs; placed_with is not computed twice');
record('the pen snaps through src/core/pen_snap.mjs and reimplements none of it',
  /from\s+['"][^'"]*\/core\/pen_snap\.mjs['"]/.test(pen) && !/function\s+(resolveSnap|levelCandidate|mirrorCandidate|nearestOnPolyline)\s*\(/.test(pen),
  'imports pen_snap.mjs; snap resolution is not computed twice');
record('the app does not reimplement snapping',
  !/function\s+(resolveSnap|levelCandidate|mirrorCandidate|nearestOnPolyline|mirrorPoints)\s*\(/.test(app)
    && !/from\s+['"][^'"]*pen_snap\.mjs['"]/.test(app), 'snapping is reached only through the shared pen');
record('the app drafts templates through src/features/pattern/pattern_templates.mjs',
  /from\s+['"][^'"]*pattern_templates\.mjs['"]/.test(app),
  'templates are proposals, drafted through the same pen and flattened by the same engine');
// Reference levels are the how-to-measure stack: a protocol declared in
// contracts/measurement-levels.json, resolved through the shared section engine
// so a level and a POM can never disagree about the same slice of this body.
// The feature is a folder, one module per kind; it is checked as a whole.
const LEVELS = join(ROOT, 'src', 'features', 'reference_geometry');
const levels = existsSync(LEVELS) ? modulesIn(LEVELS).map((path) => readFileSync(path, 'utf8')).join('\n') : '';
record('the app draws reference levels through src/features/reference_geometry',
  /from\s+['"][^'"]*features\/reference_geometry\/index\.mjs['"]/.test(app), 'imports src/features/reference_geometry/index.mjs');
record('the reference geometry measures a level with the shared section engine',
  /from\s+['"][^'"]*\/core\/measure_core\.mjs['"]/.test(levels) && /measureSection\(/.test(levels)
    && !/function\s+(measureSection|sectionSegments|convexHull|ringPerimeter)\s*\(/.test(levels),
  'imports src/core/measure_core.mjs; a level girth is not measured a second way');

// The body grid is the vertical half of the same frame. It samples through the
// shared section routine and the shared boundary walk, so a curve cannot be
// somewhere the measurements are not.
const GRID = join(ROOT, 'src', 'features', 'body_grid', 'body_grid.mjs');
const grid = existsSync(GRID) ? readFileSync(GRID, 'utf8') : '';
record('the app draws the body grid through src/features/body_grid/body_grid.mjs',
  /from\s+['"][^'"]*body_grid\.mjs['"]/.test(app), 'imports src/features/body_grid/body_grid.mjs');
record('body_grid.mjs samples through the shared section routine and boundary walk',
  /from\s+['"][^'"]*\/core\/measure_core\.mjs['"]/.test(grid) && /from\s+['"][^'"]*\/core\/flatten\/flatten_mesh\.mjs['"]/.test(grid)
    && !/function\s+(sectionSegments|segmentPoints|boundaryLoops|weld|edgeList)\s*\(/.test(grid),
  'imports src/core/measure_core.mjs and src/core/flatten/flatten_mesh.mjs; no intersection or edge maths of its own');
record('the body grid reports no length',
  !/length|girth|perimeter/i.test(grid.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').replace(/\.length/g, '')),
  'a curve is drawn, never measured, so it can carry no tolerance');
record('the app places landmarks through src/features/landmarks/landmark_placement.mjs',
  /from\s+['"][^'"]*landmark_placement\.mjs['"]/.test(app),
  'hand placement has one home and one record: qa/avatar_master/landmarks.manual.json');
record('the pen binds no keys of its own', !/addEventListener\(\s*["']keydown["']/.test(pen),
  'keys are the host\'s through the keymap, so the tool cannot claim one behind it');
record('the pen uses the one path model',
  /from\s+['"][^'"]*\/core\/surface_path\.mjs['"]/.test(pen) && !/Bezier|bezier/.test(pen.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
  'imports src/core/surface_path.mjs and reintroduces no second path model');

const failures = checks.filter((c) => c.status === 'FAIL');
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  purpose: 'Static guard that the one app reaches every measurement through the shared engine and reimplements none of it.',
  registry_sha256: sha256(REGISTRY),
  checks,
  decision: failures.length ? 'FAIL' : 'ONE_ENGINE_ONE_CONTRACT',
};
mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

for (const check of checks) console.log(`${check.status} ${check.name} — ${check.detail}`);
console.log(`REPORT ${relative(ROOT, REPORT_PATH)}`);
if (failures.length) {
  console.error(`FAIL   ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('DECISION ONE_ENGINE_ONE_CONTRACT');
