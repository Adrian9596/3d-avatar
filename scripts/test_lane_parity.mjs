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
const PATHS = join(ROOT, 'scripts', 'surface_path.mjs');
const REPORT_PATH = join(ROOT, 'qa', 'avatar_master', 'lane-parity.json');

const checks = [];
const record = (name, ok, detail) => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); return ok; };
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

for (const required of [REGISTRY, PROTOTYPE, PRODUCTION, ENGINE, PATHS]) {
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
