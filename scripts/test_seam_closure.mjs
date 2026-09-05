#!/usr/bin/env node
/**
 * Seam-closure gate: two pattern pieces that share a seam must agree on its
 * length, or they cannot be sewn.
 *
 * The one-cup loop is cut through the apex into two panels (scripts/
 * flatten_cases.json, case apex_panels_80mm) and the two are flattened TOGETHER
 * (scripts/flatten_core.mjs flattenPieces), with every chord of the shared seam
 * pulled towards a common length in both pieces. This gate then measures the
 * shared seam in each flat piece and budgets the difference against the
 * conventional bra-seam tolerance of 1/8 in.
 *
 * It also records what flattening the two panels INDEPENDENTLY would have
 * given, and requires the joint solve to beat it — so the reason the coupling
 * exists stays checkable rather than remembered.
 *
 * Exit codes: 0 the panels close, 1 they do not, 2 an input is missing/stale.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flattenPieces, patchStats, chordReport } from './flatten_core.mjs';
import { loadAvatarContext, resolveCase } from './flatten_fixtures.mjs';
import { createGate, sha256File as sha256, mm } from './gate_report.mjs';
// 1/8 in, the tolerance a bra seam is conventionally held to — one definition,
// shared with the viewer's pattern block; a factory reference pending TD confirmation.
import { SEAM_TOLERANCE_MM } from './pattern_draft.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASES_PATH = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(ROOT, 'scripts', 'flatten_cases.json');
const REPORT_PATH = join(ROOT, 'qa', 'avatar_master', 'seam-closure.json');


const { checks, record, finish, blocked } = createGate();

const cases = JSON.parse(readFileSync(CASES_PATH, 'utf8'));
const specs = cases.cases.filter((c) => c.type === 'avatar_panels');
if (!specs.length) blocked('no avatar_panels case in the case list');
const ctx = loadAvatarContext(ROOT);
if (ctx.error) blocked(ctx.error);

const results = [];
for (const spec of specs) {
  const built = resolveCase(spec, ctx);
  if (built.error) { record(`${spec.id}: panels build`, false, built.error); continue; }

  const solve = (solver) => {
    const run = flattenPieces(built.pieces, solver);
    const pairs = new Set(run.shared.map((g) => g.pair));
    const pieces = built.pieces.map((p, i) => ({
      name: p.name,
      stats: patchStats(p.sub, run.pieces[i].uv),
      chords: chordReport(p.chords, p.sub, run.pieces[i].uv, pairs),
    }));
    return { run, pieces };
  };
  const coupled = solve(cases.solver);
  const independent = solve({ ...cases.solver, couple_weight: 0 });

  const sharedFlat = (r) => r.pieces.map((p) => p.chords.shared_length_flat_m);
  const mismatch = (r) => Math.abs(sharedFlat(r)[0] - sharedFlat(r)[1]);
  const c = coupled, u = independent;

  record(`${spec.id}: the two panels see the same shared seam`,
    c.run.shared.length > 0 && c.pieces[0].chords.shared_chord_count === c.pieces[1].chords.shared_chord_count
      && Math.abs(c.pieces[0].chords.shared_length_3d_m - c.pieces[1].chords.shared_length_3d_m) < 1e-9,
    `${c.run.shared.length} shared chords, ${mm(c.pieces[0].chords.shared_length_3d_m)}mm on the body in both`);
  record(`${spec.id}: the joint solve converged`, c.run.converged && !c.run.diverged,
    `${c.run.iterations} sweeps${c.run.restarts ? `, ${c.run.restarts} restart(s)` : ''}`);
  for (const p of c.pieces) {
    record(`${spec.id}/${p.name}: no triangle folds over`, p.stats.triangle_flips === 0, `${p.stats.triangle_flips} flips`);
    record(`${spec.id}/${p.name}: the piece is a disc`, p.stats.euler_characteristic === 1 && p.stats.boundary_loop_count === 1,
      `χ=${p.stats.euler_characteristic}, ${p.stats.boundary_loop_count} boundary loop(s)`);
  }
  record(`${spec.id}: the shared seam agrees between the pieces to 1/8in`, mismatch(c) * 1000 <= SEAM_TOLERANCE_MM,
    `${mm(sharedFlat(c)[0])}mm vs ${mm(sharedFlat(c)[1])}mm — mismatch ${mm(mismatch(c))}mm (tolerance ${SEAM_TOLERANCE_MM}mm)`);
  record(`${spec.id}: solving the panels together beats solving them apart`, mismatch(c) < mismatch(u),
    `together ${mm(mismatch(c))}mm · apart ${mm(mismatch(u))}mm`);

  results.push({
    id: spec.id,
    shared_seam: {
      chord_count: c.run.shared.length,
      length_3d_mm: mm(c.pieces[0].chords.shared_length_3d_m),
      coupled: { [c.pieces[0].name]: mm(sharedFlat(c)[0]), [c.pieces[1].name]: mm(sharedFlat(c)[1]), mismatch_mm: mm(mismatch(c)), iterations: c.run.iterations, restarts: c.run.restarts },
      independent: { [u.pieces[0].name]: mm(sharedFlat(u)[0]), [u.pieces[1].name]: mm(sharedFlat(u)[1]), mismatch_mm: mm(mismatch(u)), iterations: u.run.iterations },
    },
    pieces: c.pieces.map((p) => ({
      name: p.name,
      vertex_count: p.stats.vertex_count, face_count: p.stats.face_count, triangle_flips: p.stats.triangle_flips,
      seam_length_3d_mm: mm(p.chords.seam_length_3d_m), seam_length_flat_mm: mm(p.chords.seam_length_flat_m),
      seam_error_mm: mm(p.chords.seam_error_m), worst_chord_error_mm: mm(p.chords.worst_chord_error_m),
      interior_rms_pct: Number(p.stats.interior_rms_pct.toFixed(3)),
    })),
  });
}

finish({ reportPath: REPORT_PATH, relativeTo: ROOT, okDecision: 'SEAMS_CLOSE', body: {
  purpose: 'Two pattern pieces flattened together must agree on the length of the seam they share.',
  asset: { file: 'assets/export/avatar_master.glb', sha256: ctx.assetSha },
  cases: { file: relative(ROOT, CASES_PATH), sha256: sha256(CASES_PATH) },
  engine: 'scripts/flatten_core.mjs',
  solver: cases.solver,
  tolerance_mm: SEAM_TOLERANCE_MM,
  tolerance_basis: '1/8 in, the conventional bra-seam tolerance; a factory reference pending TD confirmation',
  declared_limits: [
    'Each piece\'s own seam error against the body is curvature the body carries; it is recorded per piece, not budgeted here.',
    'Agreement is to solver tolerance, not by construction: the shared chords are pulled to a common length, not welded.',
    'A flattened piece is the rigid mesh surface at 1:1. Not a pattern: no ease, no seam allowance, no grading.',
  ],
  results,
} });
