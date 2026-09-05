#!/usr/bin/env node
/**
 * Keeps the two viewer lanes from drifting apart.
 *
 * The prototype lane (digital_bra_fit_model_360.html) and the production lane
 * (viewer/) show the same measurements. They agree today because they import the
 * same engine and read the same registry — not because someone kept two copies
 * in step. This test makes that structural claim checkable, so the cheap way to
 * make the lanes disagree (paste the maths, hardcode a material name, fork the
 * registry) fails the build instead of shipping.
 *
 * It is a static check on purpose: it needs no browser and runs in CI.
 *
 * Exit codes: 0 the lanes cannot disagree, 1 a check failed, 2 an input is missing.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(ROOT, 'contracts', 'measurement-registry.json');
const VIEWER_REGISTRY = join(ROOT, 'viewer', 'public', 'measurement-registry.json');
const PROTOTYPE = join(ROOT, 'digital_bra_fit_model_360.html');
const PRODUCTION = join(ROOT, 'viewer', 'src', 'measurements.js');
const ENGINE = join(ROOT, 'scripts', 'measure_core.mjs');
const PEN = join(ROOT, 'scripts', 'pen_tool.mjs');
const PATHS = join(ROOT, 'scripts', 'surface_path.mjs');
const REPORT_PATH = join(ROOT, 'qa', 'avatar_master', 'lane-parity.json');

const checks = [];
const record = (name, ok, detail) => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); return ok; };
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

for (const required of [REGISTRY, PROTOTYPE, PRODUCTION, ENGINE, PATHS, PEN]) {
  if (!existsSync(required)) {
    console.error(`BLOCKED: missing ${relative(ROOT, required)}`);
    process.exit(2);
  }
}

// --- the registry the production lane serves must be a copy, not a fork ------
if (!existsSync(VIEWER_REGISTRY)) {
  record('the production lane has a synced registry', false,
    'viewer/public/measurement-registry.json is missing — run `npm run sync:registry`');
} else {
  const same = sha256(REGISTRY) === sha256(VIEWER_REGISTRY);
  record('the production lane serves the same registry, byte for byte', same,
    same ? `sha256 ${sha256(REGISTRY).slice(0, 12)}…`
         : 'the copy has diverged from contracts/ — run `npm run sync:registry`');
}

const prototype = readFileSync(PROTOTYPE, 'utf8');
const production = readFileSync(PRODUCTION, 'utf8');
const engine = readFileSync(ENGINE, 'utf8');
const paths = readFileSync(PATHS, 'utf8');

// --- both lanes must use the shared engine, not their own copy of the maths --
for (const [label, source] of [['prototype', prototype], ['production', production]]) {
  record(`the ${label} lane imports the shared measurement engine`,
    /from\s+['"][^'"]*measure_core\.mjs['"]/.test(source),
    'imports scripts/measure_core.mjs');
}

// The 2D pattern draft lives in the authoring lane only, through one module
// that sits on the shared engine and the shared DXF writer.
const DRAFT = join(ROOT, 'scripts', 'pattern_draft.mjs');
const draft = existsSync(DRAFT) ? readFileSync(DRAFT, 'utf8') : '';
record('the prototype lane drafts patterns through scripts/pattern_draft.mjs',
  /from\s+['"][^'"]*pattern_draft\.mjs['"]/.test(prototype), 'imports scripts/pattern_draft.mjs');
record('pattern_draft.mjs sits on the shared flattening engine and DXF writer',
  /from\s+['"][^'"]*flatten_core\.mjs['"]/.test(draft) && /from\s+['"][^'"]*dxf_writer\.mjs['"]/.test(draft),
  'imports scripts/flatten_core.mjs and scripts/dxf_writer.mjs');
record('the production lane carries no pattern drafting',
  !/pattern_draft\.mjs|flatten_core\.mjs|dxf_writer\.mjs/.test(production), 'read-only presentation: no flatten, no DXF');

// Reimplementing any of these in a lane is how the two would start to disagree.
const ENGINE_FUNCTIONS = ['convexHull', 'sectionSegments', 'ringPerimeter', 'findLandmarks', 'computePoms',
  'hingeUnfold', 'relaxPieces', 'flattenPieces', 'extractPatch', 'loopChords'];   // scripts/flatten_core.mjs
for (const [label, source] of [['prototype', prototype], ['production', production]]) {
  const redefined = ENGINE_FUNCTIONS.filter((name) => new RegExp(`function\\s+${name}\\s*\\(`).test(source));
  record(`the ${label} lane does not reimplement the engine`, redefined.length === 0,
    redefined.length ? `redefines ${redefined.join(', ')}` : 'no engine function is redefined');
}

// --- the engine must stay asset-agnostic ------------------------------------
for (const [label, source] of [['measure_core.mjs', engine], ['surface_path.mjs', paths]]) {
  const leaked = /Mara:|avatar_master/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''));
  record(`${label} names no asset-specific material`, !leaked,
    leaked ? 'a material or asset name is hardcoded in the engine' : 'asset-agnostic');
}

// --- the production lane must not hardcode what the registry owns -----------
const productionCode = production.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
record('the production lane hardcodes no material name', !/Mara:/.test(productionCode),
  'the measurement surface comes from the registry');
record('the production lane hardcodes no scan range', !/1\.05|1\.56|0\.005/.test(productionCode),
  'the scan comes from the registry');
record('the production lane refuses to measure without the registry',
  /NO_REGISTRY/.test(production),
  'no silent default: without a registry it reports nothing');

// The prototype keeps a documented fallback so it still shows something when
// served without the registry; it is allowed, but only inside loadRegistry.
const fallbackBlock = prototype.slice(
  Math.max(0, prototype.indexOf('async function loadRegistry')),
  prototype.indexOf('async function runMeasurements'),
);
const strayMaterial = prototype
  .replace(fallbackBlock, '')
  .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  .match(/Mara:body3/g);
record('the prototype names the material only inside its documented fallback',
  !strayMaterial,
  strayMaterial ? `${strayMaterial.length} stray reference(s) outside loadRegistry()`
                : 'only in loadRegistry()');

// --- the pen is one tool, not one per lane ----------------------------------
const production_main = existsSync(join(ROOT, 'viewer', 'src', 'main.js'))
  ? readFileSync(join(ROOT, 'viewer', 'src', 'main.js'), 'utf8') : '';
for (const [label, source] of [['prototype', prototype], ['production', production_main]]) {
  record(`the ${label} lane imports the shared pen tool`,
    /from\s+['"][^'"]*pen_tool\.mjs['"]/.test(source),
    'imports scripts/pen_tool.mjs');
}
// Reimplementing the pen's geometry in a lane is how the two would start
// measuring a drafted line differently.
const PEN_FUNCTIONS = ['computeSegment', 'rebuildLine', 'initHandles', 'splitThree', 'runBetween'];
for (const [label, source] of [['prototype', prototype], ['production', production_main]]) {
  const redefined = PEN_FUNCTIONS.filter((name) => new RegExp(`function\\s+${name}\\s*\\(`).test(source));
  record(`the ${label} lane does not reimplement the pen`, redefined.length === 0,
    redefined.length ? `redefines ${redefined.join(', ')}` : 'no pen function is redefined');
}
const pen = readFileSync(PEN, 'utf8');
// One keyboard map and one view-geometry module: the keys, the grazing guard
// and the F key must mean the same thing in both lanes, so both import them
// and neither redefines what they export (AUTHORING_UX_PLAN.md §14, §15 A5).
for (const [label, source] of [['prototype', prototype], ['production', production_main]]) {
  record(`the ${label} lane dispatches keys through the shared keymap`,
    /from\s+['"][^'"]*keymap\.mjs['"]/.test(source) && /matchBinding\(/.test(source),
    'imports scripts/keymap.mjs and calls matchBinding');
  record(`the ${label} lane frames and turns the camera through the shared view geometry`,
    /from\s+['"][^'"]*view_geometry\.mjs['"]/.test(source) && /framingDistance\(/.test(source) && /turntable\(/.test(source),
    'imports scripts/view_geometry.mjs for framingDistance and turntable');
}
const INTERACTION_FUNCTIONS = ['matchBinding', 'cheatSheet', 'normalizeEvent', 'footprintMmPerPx', 'incidence', 'placement', 'poseFacing', 'turntable', 'framingDistance'];
for (const [label, source] of [['prototype', prototype], ['production', production_main]]) {
  const redefined = INTERACTION_FUNCTIONS.filter((name) => new RegExp(`function\\s+${name}\\s*\\(`).test(source));
  record(`the ${label} lane does not reimplement the keymap or view geometry`, redefined.length === 0,
    redefined.length ? `redefines ${redefined.join(', ')}` : 'no interaction function is redefined');
}
record('the pen records placement through the shared view geometry',
  /from\s+['"]\.\/view_geometry\.mjs['"]/.test(pen) && /placement\(/.test(pen) && !/function\s+placement\s*\(/.test(pen),
  'imports scripts/view_geometry.mjs; placed_with is not computed twice');
record('the pen binds no keys of its own', !/addEventListener\(\s*["']keydown["']/.test(pen),
  'keys are the hosts\' through the keymap, so both lanes read the same map');
record('the pen uses the one path model',
  /from\s+['"]\.\/surface_path\.mjs['"]/.test(pen) && !/Bezier|bezier/.test(pen.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
  'imports surface_path.mjs and reintroduces no second path model');

const failures = checks.filter((c) => c.status === 'FAIL');
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  purpose: 'Static guard that the prototype and production viewer lanes cannot disagree about a measurement.',
  registry_sha256: sha256(REGISTRY),
  checks,
  decision: failures.length ? 'FAIL' : 'LANES_CANNOT_DISAGREE',
};
mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

for (const check of checks) console.log(`${check.status} ${check.name} — ${check.detail}`);
console.log(`REPORT ${relative(ROOT, REPORT_PATH)}`);
if (failures.length) {
  console.error(`FAIL   ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('DECISION LANES_CANNOT_DISAGREE');
