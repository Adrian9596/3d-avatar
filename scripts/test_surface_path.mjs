#!/usr/bin/env node
/**
 * Two gates on the surface-path routine the pen draws with.
 *
 * 1. ACCURACY, against an analytic answer. On a cylinder the shortest surface
 *    path between two points is a helix of length sqrt((R*theta)^2 + dy^2). No
 *    approximation, no reference implementation to trust — just the formula.
 *
 * 2. CONTINUITY, which is the property the whole design rests on. A sub-path of
 *    a shortest path is itself a shortest path, so placing control points ON the
 *    A->B run must leave the reading unchanged: A->h1->h2->B has to measure the
 *    same as A->B. If this holds, the number cannot jump when a segment gains
 *    control points, and it moves only when one is actually dragged.
 *
 * Exit codes: 0 both gates pass, 1 a gate failed, 2 an input is missing.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { trianglesByMaterial } from './glb_reader.mjs';
import {
  buildGrid, surfaceRun, pointAtFraction, closestOnMesh, DEFAULT_SCHEDULE,
} from './surface_path.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_PATH = join(ROOT, 'contracts', 'measurement-registry.json');
const REPORT_PATH = join(ROOT, 'qa', 'avatar_master', 'surface-path-test.json');

const ACCURACY_BUDGET_MM = 2.0;    // faceted cylinder vs the smooth analytic helix
// The observed floor is ~0.12mm, set by resampling the parent path at 8mm
// versus resampling each leg independently, not by convergence: tripling the
// iterations does not move it. 0.2mm is a fifth of the 1mm reporting digit, so
// a jump at this scale cannot change a displayed value.
const CONTINUITY_BUDGET_MM = 0.2;

const checks = [];
const record = (name, ok, detail) => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); return ok; };
const mm = (v) => Number((v * 1000).toFixed(4));

// ---------------------------------------------------- gate 1: analytic accuracy

function cylinder(radius, facets, height) {
  const tri = [];
  for (let i = 0; i < facets; i++) {
    const a = (2 * Math.PI * i) / facets;
    const b = (2 * Math.PI * (i + 1)) / facets;
    const x0 = radius * Math.cos(a), z0 = radius * Math.sin(a);
    const x1 = radius * Math.cos(b), z1 = radius * Math.sin(b);
    tri.push(x0, 0, z0, x1, 0, z1, x1, height, z1);
    tri.push(x0, 0, z0, x1, height, z1, x0, height, z0);
  }
  return new Float32Array(tri);
}

const R = 0.1, FACETS = 256, HEIGHT = 0.5;
const grid = buildGrid(cylinder(R, FACETS, HEIGHT), 0.02);
const cylinderCases = [
  { theta: 0.8, dy: 0.10 },
  { theta: 1.2, dy: 0.15 },
  { theta: 2.0, dy: 0.05 },
];
const accuracy = [];
for (const { theta, dy } of cylinderCases) {
  const y0 = (HEIGHT - dy) / 2;
  const A = [R, y0, 0];
  const B = [R * Math.cos(theta), y0 + dy, R * Math.sin(theta)];
  const analytic = Math.hypot(R * theta, dy);
  const run = surfaceRun(grid, A, B);
  const error = run.length - analytic;
  accuracy.push({
    theta, dy_mm: mm(dy),
    analytic_mm: mm(analytic),
    measured_mm: mm(run.length),
    error_mm: Number(mm(error).toFixed(3)),
    error_pct: Number(((error / analytic) * 100).toFixed(3)),
    on_surface: run.onSurface,
    samples: run.points.length,
  });
  record(
    `cylinder geodesic theta=${theta} matches the analytic helix`,
    Math.abs(mm(error)) <= ACCURACY_BUDGET_MM && run.onSurface,
    `analytic ${mm(analytic)}mm vs measured ${mm(run.length)}mm — Δ ${mm(error).toFixed(3)}mm (${((error / analytic) * 100).toFixed(3)}%)`,
  );
}

// ------------------------------------------------- gate 2: continuity on the avatar

if (!existsSync(REGISTRY_PATH)) { console.error('BLOCKED: missing measurement registry'); process.exit(2); }
const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
const assetPath = join(ROOT, registry.asset);
if (!existsSync(assetPath)) { console.error(`BLOCKED: missing ${registry.asset}`); process.exit(2); }

const { triangles } = trianglesByMaterial(assetPath);
const surface = [];
for (const name of registry.measurement_surface) {
  const bucket = triangles.get(name);
  if (bucket) surface.push(...bucket);
}
const bodyGrid = buildGrid(new Float32Array(surface), 0.02);

// runs across the parts of the torso a drafter actually works on
const continuityCases = [
  { name: 'across the chest', A: [-0.09, 1.36, 0.112], B: [0.09, 1.36, 0.112] },
  { name: 'apex down to the fold', A: [-0.08, 1.33, 0.139], B: [-0.08, 1.27, 0.100] },
  { name: 'shoulder to waist, front', A: [-0.07, 1.40, 0.095], B: [-0.05, 1.20, 0.100] },
  { name: 'front to side', A: [0.0, 1.30, 0.135], B: [0.16, 1.30, 0.02] },
];
const continuity = [];
for (const testCase of continuityCases) {
  const A = bodyGrid && closest(bodyGrid, testCase.A);
  const B = bodyGrid && closest(bodyGrid, testCase.B);
  const single = surfaceRun(bodyGrid, A, B);
  // park the control points ON the run, exactly as the viewer does
  const h1 = pointAtFraction(single.points, 1 / 3);
  const h2 = pointAtFraction(single.points, 2 / 3);
  const legs = [
    surfaceRun(bodyGrid, A, h1),
    surfaceRun(bodyGrid, h1, h2),
    surfaceRun(bodyGrid, h2, B),
  ];
  const piecewise = legs.reduce((sum, leg) => sum + leg.length, 0);
  const jump = piecewise - single.length;
  continuity.push({
    case: testCase.name,
    single_mm: mm(single.length),
    piecewise_mm: mm(piecewise),
    jump_mm: Number(mm(jump).toFixed(4)),
    jump_pct: Number(((jump / single.length) * 100).toFixed(4)),
    on_surface: single.onSurface && legs.every((leg) => leg.onSurface),
  });
  record(
    `adding control points does not move the reading — ${testCase.name}`,
    Math.abs(mm(jump)) <= CONTINUITY_BUDGET_MM,
    `A→B ${mm(single.length)}mm vs A→h1→h2→B ${mm(piecewise)}mm — jump ${mm(jump).toFixed(4)}mm`,
  );
}

// Snap a hand-picked probe onto the mesh. This matters: the relaxation pins the
// endpoints, so an endpoint left floating off the surface makes the run and its
// legs disagree and the continuity gate reports a jump that is the test's fault,
// not the algorithm's.
function closest(g, p) {
  const hit = closestOnMesh(g, p);
  return hit ? hit.point : p;
}

// determinism: identical input must give a bit-identical reading
const probeA = closest(bodyGrid, [-0.09, 1.36, 0.112]);
const probeB = closest(bodyGrid, [0.09, 1.36, 0.112]);
const repeatA = surfaceRun(bodyGrid, probeA, probeB).length;
const repeatB = surfaceRun(bodyGrid, probeA, probeB).length;
record('the same run measured twice is identical', repeatA === repeatB, `${mm(repeatA)}mm`);

const failures = checks.filter((c) => c.status === 'FAIL');
const worstAccuracy = accuracy.reduce((max, a) => Math.max(max, Math.abs(a.error_mm)), 0);
const worstJump = continuity.reduce((max, c) => Math.max(max, Math.abs(c.jump_mm)), 0);
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  purpose: 'Accuracy of the surface-path routine against an analytic geodesic, and the continuity property the control points depend on.',
  settings: { schedule: DEFAULT_SCHEDULE.map(([sp, it]) => ({ spacing_mm: sp * 1000, iterations: it })) },
  budgets: { accuracy_mm: ACCURACY_BUDGET_MM, continuity_mm: CONTINUITY_BUDGET_MM },
  worst_accuracy_error_mm: worstAccuracy,
  worst_continuity_jump_mm: worstJump,
  cylinder_accuracy: accuracy,
  avatar_continuity: continuity,
  checks,
  decision: failures.length ? 'FAIL' : 'SURFACE_PATH_OK',
};
mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

for (const check of checks) console.log(`${check.status} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
console.log(`WORST  accuracy Δ ${worstAccuracy.toFixed(3)}mm (budget ${ACCURACY_BUDGET_MM}mm) · continuity jump ${worstJump.toFixed(4)}mm (budget ${CONTINUITY_BUDGET_MM}mm)`);
console.log(`REPORT ${relative(ROOT, REPORT_PATH)}`);
if (failures.length) { console.error(`FAIL   ${failures.length} check(s) failed`); process.exit(1); }
console.log('DECISION SURFACE_PATH_OK');
