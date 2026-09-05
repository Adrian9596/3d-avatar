#!/usr/bin/env node
/**
 * Parity gate: scripts/flatten_core.mjs (JavaScript, the engine a viewer lane
 * would import) against scripts/flatten.py (an independent Python port).
 *
 * Same relationship as validate:measure-parity has to the measurement engines:
 * the two were written separately so that a mistake in one is caught by the
 * other, and this gate is what makes that claim checkable. Both build the very
 * same patches from scripts/flatten_cases.json; the Python side is run here and
 * its layouts compared vertex by vertex.
 *
 * Exit codes: 0 the engines agree, 1 they drifted, 2 an input is missing/stale.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flattenPatch, patchStats } from './flatten_core.mjs';
import { loadAvatarContext, resolveCase } from './flatten_fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// an alternative case file may be passed as the first argument (negative tests)
const CASES_PATH = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(ROOT, 'scripts', 'flatten_cases.json');
const PYTHON = join(ROOT, 'scripts', 'flatten.py');
const REPORT_PATH = join(ROOT, 'qa', 'avatar_master', 'flatten-parity.json');

// The two ports run the same deterministic algorithm in double precision; the
// observed disagreement is below 1e-9 m on every case. A micrometre is a
// thousandth of the reporting digit and still a thousand times the noise, so
// this budget catches a real divergence and nothing else.
const TOLERANCE_MM = 0.001;

const checks = [];
const record = (name, ok, detail) => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); return ok; };
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const mm = (v) => Number((v * 1000).toFixed(6));

const cases = JSON.parse(readFileSync(CASES_PATH, 'utf8'));
const ctx = loadAvatarContext(ROOT);
if (ctx.error) { console.error(`BLOCKED: ${ctx.error}`); process.exit(2); }

let python;
try {
  const out = execFileSync('python3', [PYTHON, '--cases', CASES_PATH], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 });
  python = JSON.parse(out);
} catch (error) {
  console.error(`BLOCKED: scripts/flatten.py did not run — ${error.message}`);
  process.exit(2);
}
record('both engines flattened the same asset', python.asset_sha256 === ctx.assetSha,
  `js ${ctx.assetSha.slice(0, 12)}… · python ${String(python.asset_sha256).slice(0, 12)}…`);
record('both engines used the same solver settings', JSON.stringify(python.solver) === JSON.stringify(cases.solver),
  JSON.stringify(cases.solver));

const pyById = Object.fromEntries((python.results || []).map((r) => [r.id, r]));
const rows = [];
let worst = 0;
for (const spec of cases.cases) {
  const py = pyById[spec.id];
  if (!py) { record(`${spec.id}: python produced a result`, false, 'missing'); continue; }
  if (py.error) { record(`${spec.id}: python produced a result`, false, py.error); continue; }
  const built = resolveCase(spec, ctx);
  if (built.error) { record(`${spec.id}: javascript produced a result`, false, built.error); continue; }
  const run = flattenPatch(built.sub, cases.solver);
  const stats = patchStats(built.sub, run.uv);
  const sameSize = stats.vertex_count === py.stats.vertex_count && stats.face_count === py.stats.face_count;
  record(`${spec.id}: same patch on both sides`, sameSize,
    `js ${stats.vertex_count}v/${stats.face_count}f · python ${py.stats.vertex_count}v/${py.stats.face_count}f`);
  let maxDelta = Infinity;
  if (sameSize && py.uv.length === run.uv.length) {
    maxDelta = 0;
    for (let i = 0; i < run.uv.length; i++) {
      const d = Math.abs(run.uv[i] - py.uv[i]);
      if (d > maxDelta) maxDelta = d;
    }
  }
  const dSeam = Math.abs(stats.boundary_error_m - py.stats.boundary_error_m);
  const dRms = Math.abs(stats.interior_rms_error_m - py.stats.interior_rms_error_m);
  const caseWorst = Math.max(maxDelta, dSeam, dRms);
  if (caseWorst > worst) worst = caseWorst;
  record(`${spec.id}: layouts agree to ${TOLERANCE_MM}mm`, caseWorst * 1000 <= TOLERANCE_MM,
    `max vertex Δ ${mm(maxDelta)}mm · seam Δ ${mm(dSeam)}mm · interior rms Δ ${mm(dRms)}mm · iterations js ${run.iterations} / python ${py.iterations}`);
  rows.push({
    id: spec.id, vertex_count: stats.vertex_count, face_count: stats.face_count,
    iterations: { js: run.iterations, python: py.iterations },
    max_vertex_delta_mm: mm(maxDelta), boundary_error_delta_mm: mm(dSeam), interior_rms_delta_mm: mm(dRms),
    boundary_error_mm: { js: mm(stats.boundary_error_m), python: mm(py.stats.boundary_error_m) },
  });
}

const failures = checks.filter((c) => c.status === 'FAIL');
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  purpose: 'Agreement between the JavaScript flattening engine and its independent Python port on the same patches.',
  asset: { file: 'assets/export/avatar_master.glb', sha256: ctx.assetSha },
  cases: { file: relative(ROOT, CASES_PATH), sha256: sha256(CASES_PATH) },
  engines: { javascript: 'scripts/flatten_core.mjs', python: 'scripts/flatten.py' },
  tolerance_mm: TOLERANCE_MM,
  worst_delta_mm: mm(worst),
  cases_compared: rows,
  checks,
  decision: failures.length ? 'FAIL' : 'ENGINES_AGREE',
};
mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

for (const check of checks) console.log(`${check.status} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
console.log(`WORST  Δ ${mm(worst)}mm (tolerance ${TOLERANCE_MM}mm)`);
console.log(`REPORT ${relative(ROOT, REPORT_PATH)}`);
if (failures.length) { console.error(`FAIL   ${failures.length} check(s) failed`); process.exit(1); }
console.log('DECISION ENGINES_AGREE');
