#!/usr/bin/env node
/**
 * Cross-implementation parity gate.
 *
 * The viewer measures in JavaScript (scripts/measure_core.mjs); the authority
 * pass measures in Python (scripts/measure_avatar.py). Two independent
 * implementations are only an asset if their agreement is enforced, so this
 * test runs the JS engine over the same GLB and fails the build when any POM or
 * landmark disagrees with the recorded evidence by more than the registry's
 * tolerance.
 *
 * It also refuses to compare evidence that was produced from a different asset:
 * a stale measurements.json is a failure, not a pass.
 *
 * Exit codes: 0 parity holds, 1 a check failed, 2 an input is missing.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { trianglesByMaterial } from './glb_reader.mjs';
import { buildGrid } from './surface_path.mjs';
import {
  DEFAULT_SCAN,
  scanSurface,
  findLandmarks,
  computePoms,
  computeSurfacePoms,
  findArmholes,
  findFoldLandmarks,
  applyLandmarkOverrides,
} from './measure_core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_PATH = join(ROOT, 'contracts', 'measurement-registry.json');
const EVIDENCE_PATH = join(ROOT, 'qa', 'avatar_master', 'measurements.json');
const OVERRIDE_PATH = join(ROOT, 'qa', 'avatar_master', 'landmarks.manual.json');
const REPORT_PATH = join(ROOT, 'qa', 'avatar_master', 'measurement-parity.json');

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const mm = (metres) => Number((metres * 1000).toFixed(4));

function blocked(message) {
  console.error(`BLOCKED: ${message}`);
  process.exit(2);
}

if (!existsSync(REGISTRY_PATH)) blocked('missing contracts/measurement-registry.json');
if (!existsSync(EVIDENCE_PATH)) {
  blocked('missing qa/avatar_master/measurements.json — run `npm run measure:avatar` first');
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
const evidence = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
const assetPath = join(ROOT, registry.asset);
if (!existsSync(assetPath)) blocked(`missing ${registry.asset}`);

const tolerance = registry.parity.tolerance_mm;
const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail });
  return ok;
};

// --- the evidence must describe the asset that is actually on disk -----------
const assetSha = sha256(assetPath);
record(
  'evidence matches the asset on disk',
  evidence.asset?.sha256 === assetSha,
  evidence.asset?.sha256 === assetSha
    ? `sha256 ${assetSha.slice(0, 12)}…`
    : `evidence sha ${String(evidence.asset?.sha256).slice(0, 12)}… vs asset ${assetSha.slice(0, 12)}… — rerun measure:avatar`,
);
const registrySha = sha256(REGISTRY_PATH);
record(
  'evidence matches the registry on disk',
  evidence.registry?.sha256 === registrySha,
  evidence.registry?.sha256 === registrySha
    ? `sha256 ${registrySha.slice(0, 12)}…`
    : 'the registry changed after the evidence was written — rerun measure:avatar',
);

// --- the engine defaults must not drift away from the registry ---------------
const scanMatches = DEFAULT_SCAN.from_m === registry.scan.from_m
  && DEFAULT_SCAN.to_m === registry.scan.to_m
  && DEFAULT_SCAN.step_m === registry.scan.step_m;
record(
  'engine scan defaults match the registry',
  scanMatches,
  scanMatches ? JSON.stringify(registry.scan_summary ?? DEFAULT_SCAN) : 'measure_core.mjs DEFAULT_SCAN has drifted from the registry',
);

// --- run the JavaScript engine over the same triangles ----------------------
const { triangles } = trianglesByMaterial(assetPath);
for (const [role, name] of Object.entries(registry.expected_materials)) {
  record(`asset still carries the ${role} material`, triangles.has(name), `'${name}'`);
}

const surface = [];
for (const name of registry.measurement_surface) {
  const bucket = triangles.get(name);
  if (bucket) surface.push(...bucket);
}
const tri = new Float32Array(surface);
if (!tri.length) blocked(`measurement surface ${registry.measurement_surface} produced no geometry`);

const foldRule = (registry.landmarks || []).find((l) => l.id === 'UNDERBUST_FOLD') || {};
const scan = scanSurface(tri, registry.scan);
const autoMarks = findLandmarks(scan, foldRule);
if (!autoMarks) blocked('the JavaScript engine found no bust apex');

// Hand-placed landmarks are an input to BOTH implementations. If only one side
// read them the gate would fail for the wrong reason, and worse, it would stop
// checking what it is meant to check.
const overrides = existsSync(OVERRIDE_PATH)
  ? JSON.parse(readFileSync(OVERRIDE_PATH, 'utf8'))
  : null;
const marks = applyLandmarkOverrides(autoMarks, overrides);
const poms = computePoms(tri, scan, marks);

// surface-path POMs: the same shortest-path routine, ported independently to
// Python. Comparing these is the only thing that can catch a mistake in the port.
// HPS is manual-only: no automatic fallback, so an unplaced HPS yields no value
// on either side and the POM stays blocked.
const hps = {};
for (const [key, id] of [['hpsL', 'HPS_L'], ['hpsR', 'HPS_R']]) {
  const given = overrides?.landmarks?.[id];
  if (given && Array.isArray(given.xyz_m)) {
    const [x, y, z] = given.xyz_m;
    hps[key] = { x, y, z };
  }
}
// every hand-placed point, keyed by landmark id, so root arcs resolve too
const manualPoints = {};
for (const [id, spec] of Object.entries(overrides?.landmarks || {})) {
  if (Array.isArray(spec?.xyz_m) && spec.xyz_m.length === 3) {
    manualPoints[id] = { x: spec.xyz_m[0], y: spec.xyz_m[1], z: spec.xyz_m[2] };
  }
}
const foldLandmarks = marks?.fold ? findFoldLandmarks(tri, marks.fold.y) : {};
const armholes = findArmholes(tri);
record('the torso surface has the four boundary loops the underarm rule needs',
  armholes.loops === 4, `${armholes.loops} loop(s): neck, waist, two armholes`);
Object.assign(poms, computeSurfacePoms(buildGrid(tri), tri, marks,
  { hps, manualPoints, foldLandmarks, armholes }));
record(
  'both sides applied the same landmark overrides',
  Boolean(evidence.landmark_overrides?.applied) === Boolean(overrides),
  overrides
    ? `override file present, python applied=${evidence.landmark_overrides?.applied}`
    : 'no override file on either side',
);
if (overrides && evidence.landmark_overrides?.applied) {
  const mine = sha256(OVERRIDE_PATH);
  record(
    'the evidence used the override file that is on disk',
    evidence.landmark_overrides.sha256 === mine,
    evidence.landmark_overrides.sha256 === mine ? `sha256 ${mine.slice(0, 12)}…` : 'the override file changed after the evidence was written',
  );
}

// --- POM by POM -------------------------------------------------------------
const comparisons = [];
for (const spec of registry.poms) {
  const row = evidence.poms.find((p) => p.id === spec.id);
  const mine = poms[spec.id];
  if (!row) {
    record(`${spec.id} present in evidence`, false, 'the registry declares it but the evidence has no row');
    continue;
  }
  if ((row.value_mm === null || row.value_mm === undefined) && row.value_ml === undefined) {
    // blocked, planned and not-yet-placed POMs must stay valueless on both sides
    const ok = mine === undefined;
    record(
      `${spec.id} stays unmeasured (${row.status})`,
      ok,
      ok ? String(row.blocked_reason || row.planned_phase || 'no value, as declared').slice(0, 70)
         : 'the JS engine produced a value for a POM that must not report one',
    );
    continue;
  }
  if (spec.parity === 'analytic_only') {
    // Declared out of scope for cross-implementation parity, with a reason on
    // the POM. Skipping by declaration is auditable; skipping by accident is not.
    record(`${spec.id} is validated analytically, not by parity`, true,
      String(spec.parity_reason || '').slice(0, 90));
    continue;
  }
  if (mine === undefined) {
    record(`${spec.id} computed by the JS engine`, false, 'evidence has a value but the JS engine produced none');
    continue;
  }
  const delta = Math.abs(mm(mine.value) - row.value_mm);
  comparisons.push({
    id: spec.id,
    python_mm: row.value_mm,
    javascript_mm: mm(mine.value),
    delta_mm: Number(delta.toFixed(4)),
    tolerance_mm: tolerance,
  });
  record(
    `${spec.id} parity`,
    delta <= tolerance,
    `python ${row.value_mm}mm vs js ${mm(mine.value)}mm — Δ ${delta.toFixed(3)}mm`,
  );
}

// --- landmarks --------------------------------------------------------------
const landmarkChecks = [
  ['BUST_APEX_L', evidence.landmarks?.BUST_APEX_L?.xyz_m, [marks.apexL.x, marks.apexL.y, marks.apexL.z]],
  ['BUST_APEX_R', evidence.landmarks?.BUST_APEX_R?.xyz_m, [marks.apexR.x, marks.apexR.y, marks.apexR.z]],
];
for (const [id, recorded, mine] of landmarkChecks) {
  if (!recorded) { record(`${id} present in evidence`, false, 'no landmark recorded'); continue; }
  const delta = Math.max(...recorded.map((v, i) => Math.abs(mm(mine[i]) - v * 1000)));
  record(`${id} parity`, delta <= tolerance, `worst axis Δ ${delta.toFixed(3)}mm`);
}
const levels = [
  ['BUST_LEVEL', evidence.landmarks?.BUST_LEVEL?.y_m, marks.bustLevel],
  ['UNDERBUST_FOLD', evidence.landmarks?.UNDERBUST_FOLD?.y_m, marks.fold?.y],
  ['WAIST_LEVEL', evidence.landmarks?.WAIST_LEVEL?.y_m, marks.waist?.y],
];
for (const [id, recorded, mine] of levels) {
  if (recorded === undefined || recorded === null || mine === undefined || mine === null) {
    record(`${id} present on both sides`, false, 'missing on one side');
    continue;
  }
  const delta = Math.abs(mm(mine) - recorded * 1000);
  record(`${id} height parity`, delta <= tolerance, `Δ ${delta.toFixed(3)}mm`);
}

// --- calibration recorded by the authority pass -----------------------------
const calibrationError = Math.abs(evidence.calibration?.error_mm ?? Infinity);
record(
  'recorded calibration inside its budget',
  calibrationError <= registry.calibration.max_error_mm,
  `${evidence.calibration?.error_mm}mm vs ${registry.calibration.max_error_mm}mm budget`,
);

// --- the authority pass itself must not have failed -------------------------
record(
  'authority pass reported no failures',
  Array.isArray(evidence.failures) && evidence.failures.length === 0,
  (evidence.failures || []).join('; ') || 'none',
);

const failures = checks.filter((c) => c.status === 'FAIL');
const worst = comparisons.reduce((max, c) => Math.max(max, c.delta_mm), 0);
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  purpose: 'Asserts the Python authority pass and the JavaScript engine the viewer uses agree.',
  asset: { file: registry.asset, sha256: assetSha },
  registry: { file: relative(ROOT, REGISTRY_PATH), sha256: registrySha },
  tolerance_mm: tolerance,
  worst_delta_mm: Number(worst.toFixed(4)),
  comparisons,
  checks,
  decision: failures.length ? 'FAIL' : 'PARITY_HOLDS',
};
mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

for (const check of checks) {
  console.log(`${check.status} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
}
console.log(`WORST  Δ ${worst.toFixed(3)}mm against a ${tolerance}mm tolerance`);
console.log(`REPORT ${relative(ROOT, REPORT_PATH)}`);
if (failures.length) {
  console.error(`FAIL   ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('DECISION PARITY_HOLDS');
