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

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flattenPatch, flattenPieces, patchStats } from './flatten_core.mjs';
import { loadAvatarContext, resolveCase } from './flatten_fixtures.mjs';
import { createGate, sha256File as sha256, mm as mmOf } from './gate_report.mjs';

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

const { checks, record, finish, blocked } = createGate();
const mm = (v) => mmOf(v, 6);

const cases = JSON.parse(readFileSync(CASES_PATH, 'utf8'));
const ctx = loadAvatarContext(ROOT);
if (ctx.error) blocked(ctx.error);

let python;
try {
  const out = execFileSync('python3', [PYTHON, '--cases', CASES_PATH], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 });
  python = JSON.parse(out);
} catch (error) {
  blocked(`scripts/flatten.py did not run — ${error.message}`);
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
  if (built.pieces) {
    const run = flattenPieces(built.pieces, cases.solver);
    let caseWorst = 0;
    const detail = [];
    built.pieces.forEach((p, i) => {
      const pyPiece = (py.pieces || [])[i];
      const uv = run.pieces[i].uv;
      let maxDelta = Infinity;
      if (pyPiece && pyPiece.uv.length === uv.length) { maxDelta = 0; for (let k = 0; k < uv.length; k++) { const d = Math.abs(uv[k] - pyPiece.uv[k]); if (d > maxDelta) maxDelta = d; } }
      if (maxDelta > caseWorst) caseWorst = maxDelta;
      detail.push(`${p.name} Δ ${mm(maxDelta)}mm`);
    });
    if (caseWorst > worst) worst = caseWorst;
    record(`${spec.id}: layouts agree to ${TOLERANCE_MM}mm`, caseWorst * 1000 <= TOLERANCE_MM && run.iterations === py.iterations && run.restarts === py.restarts,
      `${detail.join(' · ')} · iterations js ${run.iterations} / python ${py.iterations} · restarts js ${run.restarts} / python ${py.restarts}`);
    rows.push({ id: spec.id, pieces: built.pieces.map((p) => p.name), iterations: { js: run.iterations, python: py.iterations }, max_vertex_delta_mm: mm(caseWorst) });
    continue;
  }
  const run = flattenPatch(built.sub, cases.solver, built.chords || null);
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

finish({ reportPath: REPORT_PATH, relativeTo: ROOT, okDecision: 'ENGINES_AGREE', lines: [`WORST  Δ ${mm(worst)}mm (tolerance ${TOLERANCE_MM}mm)`], body: {
  purpose: 'Agreement between the JavaScript flattening engine and its independent Python port on the same patches.',
  asset: { file: 'assets/export/avatar_master.glb', sha256: ctx.assetSha },
  cases: { file: relative(ROOT, CASES_PATH), sha256: sha256(CASES_PATH) },
  engines: { javascript: 'scripts/flatten_core.mjs', python: 'scripts/flatten.py' },
  tolerance_mm: TOLERANCE_MM,
  worst_delta_mm: mm(worst),
  cases_compared: rows,
} });
