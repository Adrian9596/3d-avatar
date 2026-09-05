#!/usr/bin/env node
/**
 * Accuracy gate for the flattening engine (scripts/flatten_core.mjs).
 *
 * 1. ANALYTIC, on surfaces that unroll with no distortion at all. A cylinder
 *    patch is a rectangle of width (chord sum) x height; a cone frustum is a fan
 *    of trapezoids whose two straight sides meet at an angle that follows from
 *    the geometry alone. No reference implementation to trust — just the formula.
 *    On these every edge must come out at its 3D length to the micrometre.
 *
 * 2. REAL MESH, where exactness is impossible (a cup-sized patch of this body
 *    carries ~130° of Gaussian curvature) and what is gated is soundness: no
 *    fold-over, disc topology, convergence — plus the finding the design rests
 *    on, that cutting the one-piece cup into two panels reduces the seam error.
 *    The seam errors themselves are recorded, not budgeted: they are a property
 *    of the body, and hiding them behind a threshold is how they would stop
 *    being looked at.
 *
 * 3. PATCH EXTRACTION from a closed loop, the pen tool's shape: the flood fill
 *    must not leak past the loop into the rest of the body, every loop sample
 *    must map through the flattening, and the loop — held to length as the
 *    piece's seam — has its residual recorded. Two panels cut from one loop are
 *    solved together and each gated for soundness; their shared seam is the
 *    business of scripts/test_seam_closure.mjs.
 *
 * Exit codes: 0 all gates pass, 1 a gate failed, 2 an input is missing/stale.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flattenPatch, flattenPieces, patchStats, chordReport, mapLoopToFlat, edgeList } from './flatten_core.mjs';
import { loadAvatarContext, resolveCase } from './flatten_fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// an alternative case file may be passed as the first argument (negative tests)
const CASES_PATH = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(ROOT, 'scripts', 'flatten_cases.json');
const REPORT_PATH = join(ROOT, 'qa', 'avatar_master', 'flatten-accuracy.json');

// A developable surface unrolls exactly; the hinge-unfolding start already IS
// that unrolling, so anything above floating-point noise here is a bug.
const DEVELOPABLE_EDGE_BUDGET_M = 1e-6;
const DEVELOPABLE_ANGLE_BUDGET_RAD = 1e-8;
// The flood fill stops at the barrier the loop lays down; a leak would reach the
// far side of the torso, hundreds of mm away. Three edge lengths of slack covers
// the barrier faces themselves.
const LEAK_SLACK_EDGES = 3;

const checks = [];
const record = (name, ok, detail) => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); return ok; };
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const mm = (v) => Number((v * 1000).toFixed(4));

const cases = JSON.parse(readFileSync(CASES_PATH, 'utf8'));
const solver = cases.solver;
const ctx = loadAvatarContext(ROOT);
if (ctx.error) { console.error(`BLOCKED: ${ctx.error}`); process.exit(2); }

let meshMaxEdge = 0;
{
  const e = edgeList(ctx.mesh.faces);
  const P = ctx.mesh.positions;
  for (let i = 0; i < e.a.length; i++) {
    const a = e.a[i] * 3, b = e.b[i] * 3;
    const dx = P[a] - P[b], dy = P[a + 1] - P[b + 1], dz = P[a + 2] - P[b + 2];
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l > meshMaxEdge) meshMaxEdge = l;
  }
}

function maxEdgeError(sub, uv) {
  const e = edgeList(sub.faces);
  const P = sub.positions;
  let worst = 0;
  for (let i = 0; i < e.a.length; i++) {
    const a = e.a[i], b = e.b[i];
    const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2];
    const ex = uv[a * 2] - uv[b * 2], ey = uv[a * 2 + 1] - uv[b * 2 + 1];
    const err = Math.abs(Math.sqrt(ex * ex + ey * ey) - Math.sqrt(dx * dx + dy * dy + dz * dz));
    if (err > worst) worst = err;
  }
  return worst;
}

/** Vertices of the generated grid at one angle, bottom to top, by 3D position. */
function column(sub, angle) {
  const P = sub.positions;
  const out = [];
  for (let v = 0; v < P.length / 3; v++) {
    const th = Math.atan2(P[v * 3 + 2], P[v * 3]);
    if (Math.abs(th - angle) < 1e-9) out.push(v);
  }
  return out.sort((a, b) => P[a * 3 + 1] - P[b * 3 + 1]);
}

function colinearity(uv, verts) {
  const a = verts[0], b = verts[verts.length - 1];
  const dx = uv[b * 2] - uv[a * 2], dy = uv[b * 2 + 1] - uv[a * 2 + 1];
  const L = Math.sqrt(dx * dx + dy * dy);
  let worst = 0;
  for (const v of verts) {
    const px = uv[v * 2] - uv[a * 2], py = uv[v * 2 + 1] - uv[a * 2 + 1];
    const d = Math.abs(px * dy - py * dx) / L;
    if (d > worst) worst = d;
  }
  return worst;
}

const results = [];
const byId = {};
for (const spec of cases.cases) {
  const built = resolveCase(spec, ctx);
  if (built.error) {
    record(`${spec.id}: patch builds`, false, built.error);
    continue;
  }
  if (built.pieces) {
    // several pieces solved together: soundness per piece here
    const run = flattenPieces(built.pieces, solver);
    const pairs = new Set(run.shared.map((g) => g.pair));
    record(`${spec.id}: the joint relaxation converged`, run.converged && !run.diverged,
      `${run.iterations} iterations${run.restarts ? `, ${run.restarts} restart(s)` : ''}`);
    const row = { id: spec.id, type: spec.type, iterations: run.iterations, converged: run.converged, restarts: run.restarts, shared_chords: run.shared.length, pieces: [] };
    built.pieces.forEach((p, i) => {
      const stats = patchStats(p.sub, run.pieces[i].uv);
      const ch = chordReport(p.chords, p.sub, run.pieces[i].uv, pairs);
      record(`${spec.id}/${p.name}: no triangle folds over`, stats.triangle_flips === 0, `${stats.triangle_flips} flips`);
      record(`${spec.id}/${p.name}: the piece is a disc`, stats.euler_characteristic === 1 && stats.boundary_loop_count === 1,
        `χ=${stats.euler_characteristic}, ${stats.boundary_loop_count} boundary loop(s)`);
      const limit = spec.radius_m + LEAK_SLACK_EDGES * meshMaxEdge;
      record(`${spec.id}/${p.name}: the flood fill did not leak past the loop`, p.patch.flood_reach_m <= limit,
        `reached ${mm(p.patch.flood_reach_m)}mm from the seed (limit ${mm(limit)}mm)`);
      row.pieces.push({ name: p.name, ...roundStats(stats), seam: seamRow(ch) });
    });
    results.push(row);
    continue;
  }
  const { sub } = built;
  const run = flattenPatch(sub, solver, built.chords || null);
  const stats = patchStats(sub, run.uv);
  const row = { id: spec.id, type: spec.type, iterations: run.iterations, converged: run.converged, restarts: run.restarts, ...roundStats(stats) };
  byId[spec.id] = { spec, sub, run, stats, built };

  if (spec.type === 'cylinder' || spec.type === 'cone') {
    const worst = maxEdgeError(sub, run.uv);
    row.worst_edge_error_um = Number((worst * 1e6).toFixed(4));
    record(`${spec.id}: every edge keeps its 3D length`, worst <= DEVELOPABLE_EDGE_BUDGET_M,
      `worst ${(worst * 1e6).toFixed(4)}µm (budget ${DEVELOPABLE_EDGE_BUDGET_M * 1e6}µm)`);
    record(`${spec.id}: no triangle folds over`, stats.triangle_flips === 0, `${stats.triangle_flips} flips`);
    const arc = (spec.arc_deg * Math.PI) / 180;
    const c0 = column(sub, 0), c1 = column(sub, arc);
    const straight = Math.max(colinearity(run.uv, c0), colinearity(run.uv, c1));
    row.straight_side_deviation_um = Number((straight * 1e6).toFixed(4));
    record(`${spec.id}: the two straight sides stay straight`, straight <= DEVELOPABLE_EDGE_BUDGET_M,
      `worst deviation ${(straight * 1e6).toFixed(4)}µm`);
    if (spec.type === 'cylinder') {
      // rectangle: chord sum x height, once a side is turned to the vertical
      const na = spec.angular_segments, R = spec.radius_m;
      const width = na * 2 * R * Math.sin(arc / (2 * na));
      const a = c0[0], b = c0[c0.length - 1];
      const dx = run.uv[b * 2] - run.uv[a * 2], dy = run.uv[b * 2 + 1] - run.uv[a * 2 + 1];
      const L = Math.sqrt(dx * dx + dy * dy);
      const cs = dy / L, sn = dx / L;            // rotate so (dx,dy) -> (0,L)
      let minu = Infinity, maxu = -Infinity, minv = Infinity, maxv = -Infinity;
      for (let v = 0; v < run.uv.length / 2; v++) {
        const u = run.uv[v * 2] * cs - run.uv[v * 2 + 1] * sn;
        const w = run.uv[v * 2] * sn + run.uv[v * 2 + 1] * cs;
        if (u < minu) minu = u; if (u > maxu) maxu = u; if (w < minv) minv = w; if (w > maxv) maxv = w;
      }
      const dw = Math.abs((maxu - minu) - width), dh = Math.abs((maxv - minv) - spec.height_m);
      row.analytic = { width_mm: mm(width), height_mm: mm(spec.height_m), flat_width_mm: mm(maxu - minu), flat_height_mm: mm(maxv - minv) };
      record(`${spec.id}: unrolls to the analytic rectangle`, Math.max(dw, dh) <= DEVELOPABLE_EDGE_BUDGET_M,
        `${mm(maxu - minu)} x ${mm(maxv - minv)}mm vs ${mm(width)} x ${mm(spec.height_m)}mm`);
    } else {
      // fan angle: each panel extended to the cone's apex is an isosceles
      // triangle of side Lb (apex to a bottom vertex) and base cb (bottom chord)
      const { radius_bottom_m: rb, radius_top_m: rt, height_m: H, angular_segments: na } = spec;
      const yApex = (H * rb) / (rb - rt);
      const Lb = Math.sqrt(rb * rb + yApex * yApex);
      const cb = 2 * rb * Math.sin(arc / (2 * na));
      const phi = na * 2 * Math.asin(cb / (2 * Lb));
      const dir = (col) => {
        const a = col[0], b = col[col.length - 1];
        const dx = run.uv[b * 2] - run.uv[a * 2], dy = run.uv[b * 2 + 1] - run.uv[a * 2 + 1];
        const L = Math.sqrt(dx * dx + dy * dy); return [dx / L, dy / L];
      };
      const [ax, ay] = dir(c0), [bx, by] = dir(c1);
      const angle = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by)));
      row.analytic = { fan_angle_deg: Number(((phi * 180) / Math.PI).toFixed(6)), flat_angle_deg: Number(((angle * 180) / Math.PI).toFixed(6)) };
      record(`${spec.id}: the straight sides meet at the analytic fan angle`, Math.abs(angle - phi) <= DEVELOPABLE_ANGLE_BUDGET_RAD,
        `${((angle * 180) / Math.PI).toFixed(6)}° vs ${((phi * 180) / Math.PI).toFixed(6)}°`);
    }
  } else {
    record(`${spec.id}: no triangle folds over`, stats.triangle_flips === 0, `${stats.triangle_flips} flips`);
    record(`${spec.id}: the patch is a disc`, stats.euler_characteristic === 1 && stats.boundary_loop_count === 1,
      `χ=${stats.euler_characteristic}, ${stats.boundary_loop_count} boundary loop(s)`);
    record(`${spec.id}: the relaxation converged`, run.converged && !run.diverged,
      `${run.iterations} iterations${run.restarts ? `, ${run.restarts} restart(s)` : ''}`);
    if (spec.type === 'avatar_loop') {
      const { patch } = built;
      const limit = spec.radius_m + LEAK_SLACK_EDGES * meshMaxEdge;
      row.extraction = { flooded_faces: patch.flooded, barrier_faces: patch.barrier, flood_reach_mm: mm(patch.flood_reach_m), leak_limit_mm: mm(limit) };
      record(`${spec.id}: the flood fill did not leak past the loop`, patch.flood_reach_m <= limit,
        `reached ${mm(patch.flood_reach_m)}mm from the seed (limit ${mm(limit)}mm)`);
      const mapped = mapLoopToFlat(patch.samples, sub, run.uv);
      record(`${spec.id}: every loop sample maps into the flat piece`, !mapped.error, mapped.error || `${patch.samples.length} samples`);
      // the loop IS the seam of this piece; the mesh boundary is scaffolding
      row.seam = seamRow(chordReport(built.chords, sub, run.uv));
      row.scaffold_boundary_error_mm = row.boundary_error_mm;
    }
  }
  results.push(row);
}

// the finding the panel split rests on, kept checkable
if (byId.apex_disc_80mm && byId.apex_disc_80mm_upper && byId.apex_disc_80mm_lower) {
  const one = byId.apex_disc_80mm.stats.boundary_error_m;
  const up = byId.apex_disc_80mm_upper.stats.boundary_error_m;
  const lo = byId.apex_disc_80mm_lower.stats.boundary_error_m;
  record('cutting the cup into two panels reduces the seam error', Math.max(Math.abs(up), Math.abs(lo)) < Math.abs(one),
    `one piece ${mm(one)}mm; panels ${mm(up)}mm / ${mm(lo)}mm`);
}

function seamRow(ch) {
  return {
    chord_count: ch.chord_count, length_3d_mm: mm(ch.seam_length_3d_m), length_flat_mm: mm(ch.seam_length_flat_m),
    error_mm: mm(ch.seam_error_m), worst_chord_error_mm: mm(ch.worst_chord_error_m),
  };
}

function roundStats(s) {
  return {
    vertex_count: s.vertex_count, face_count: s.face_count,
    euler_characteristic: s.euler_characteristic, boundary_loop_count: s.boundary_loop_count,
    boundary_length_3d_mm: mm(s.boundary_length_3d_m), boundary_length_flat_mm: mm(s.boundary_length_flat_m),
    boundary_error_mm: mm(s.boundary_error_m), worst_boundary_edge_error_mm: mm(s.worst_boundary_edge_error_m),
    interior_rms_error_mm: mm(s.interior_rms_error_m), interior_rms_pct: Number(s.interior_rms_pct.toFixed(3)),
    interior_max_pct: Number(s.interior_max_pct.toFixed(3)),
    area_3d_cm2: Number((s.area_3d_m2 * 1e4).toFixed(2)), area_error_pct: Number(s.area_error_pct.toFixed(4)),
    triangle_flips: s.triangle_flips,
  };
}

const failures = checks.filter((c) => c.status === 'FAIL');
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  purpose: 'Accuracy of the flattening engine against analytic developable surfaces, and soundness on patches of the avatar.',
  asset: { file: 'assets/export/avatar_master.glb', sha256: ctx.assetSha },
  cases: { file: relative(ROOT, CASES_PATH), sha256: sha256(CASES_PATH) },
  engine: 'scripts/flatten_core.mjs',
  solver,
  budgets: { developable_edge_um: DEVELOPABLE_EDGE_BUDGET_M * 1e6, developable_angle_rad: DEVELOPABLE_ANGLE_BUDGET_RAD, leak_slack_edges: LEAK_SLACK_EDGES },
  mesh: { vertices: ctx.mesh.positions.length / 3, faces: ctx.mesh.faces.length / 3, max_edge_mm: mm(meshMaxEdge), materials: ctx.materials },
  declared_limits: [
    'A flattened patch is the rigid mesh surface at 1:1. It is not a pattern: no ease, no seam allowance, no grading.',
    'Boundary errors on the avatar are curvature the body carries, reported per piece and never rescaled away.',
    'A loop-cut piece keeps a ring of scaffold faces the loop passes through; its outline is the loop, held to length as the seam, and the scaffold boundary is reported separately.',
  ],
  results,
  checks,
  decision: failures.length ? 'FAIL' : 'FLATTEN_OK',
};
mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

for (const check of checks) console.log(`${check.status} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
for (const r of results) {
  if (r.pieces) { for (const p of r.pieces) console.log(`CASE   ${(r.id + '/' + p.name).padEnd(30)} seam Δ ${String(p.seam.error_mm).padStart(8)}mm of ${p.seam.length_3d_mm}mm · interior rms ${p.interior_rms_error_mm}mm · ${r.iterations} it`); continue; }
  const seam = r.seam ? `loop seam Δ ${String(r.seam.error_mm).padStart(8)}mm of ${r.seam.length_3d_mm}mm` : `seam Δ ${String(r.boundary_error_mm).padStart(8)}mm of ${r.boundary_length_3d_mm}mm`;
  console.log(`CASE   ${r.id.padEnd(30)} ${seam} · interior rms ${r.interior_rms_error_mm}mm · ${r.iterations} it`);
}
console.log(`REPORT ${relative(ROOT, REPORT_PATH)}`);
if (failures.length) { console.error(`FAIL   ${failures.length} check(s) failed`); process.exit(1); }
console.log('DECISION FLATTEN_OK');
