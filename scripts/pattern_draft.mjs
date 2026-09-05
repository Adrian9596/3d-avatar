/**
 * From pen lines to pattern pieces — the logic behind the "2D pattern draft"
 * block of the authoring lane, kept out of the HTML so it can be read, tested
 * and upgraded on its own. No DOM in here: plain arrays in, plain objects out.
 *
 * The pipeline is the one the gates run (the pen hands over each line's 3D
 * polyline through pen_tool's lineGeometry()):
 *   pen lines  ->  outline loop (+ seam)  ->  panel loops  (splitLoopBySeam)
 *              ->  patches               (extractPatch, loopChords)
 *              ->  flat pieces           (flattenPieces)
 *              ->  reports, DXF, evidence (flatten_report, dxf_pieces, dxf_writer)
 *
 * Everything this module emits says what it is: a 1:1 shell of the skin, not a
 * pattern (no ease, no seam allowance, no grading).
 */

import {
  weld, extractPatch, submesh, loopChords, flattenPieces, patchStats, chordReport,
  mapLoopToFlat, splitLoopBySeam, loopCentroidSeed, DEFAULT_SOLVER,
} from './flatten_core.mjs';
import { writeAstmDxf } from './dxf_writer.mjs';
import { dxfPiece } from './dxf_pieces.mjs';

export const SEAM_TOLERANCE_MM = 3.175;      // 1/8 in, the conventional bra-seam tolerance
export const LEAK_SLACK_M = 0.03;            // a fill reaching further than the loop + this has escaped

export const DECLARED_LIMITS = Object.freeze([
  'Shell 1:1 of the rigid mesh surface. Not a pattern: no ease, no seam allowance, no grading.',
  'Drafted by hand in the viewer; the outline is a pen loop, not a registry POM.',
  'Grain line and Quantity 1,1 in the DXF are defaults for the pattern maker to set.',
  'Seam errors against the body are curvature the body carries, reported per piece.',
]);

/** A DXF-safe piece name: uppercase [A-Z0-9_], at most 20 characters. */
export function asciiPieceName(name, fallback) {
  const clean = String(name || fallback).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (clean || fallback).slice(0, 20);
}

/** Weld the measurement surface once; the mesh is what every draft flattens. */
export function draftMesh(triangles) {
  return weld(triangles);
}

/**
 * Cut the patches for a draft.
 * @param mesh     welded measurement surface (draftMesh)
 * @param closest  p -> {point, normal, triangle} over the same soup
 * @param outline  { name, points } closed loop on the skin
 * @param seam     { name, points } open line whose ends sit on the outline, or null
 * @returns { pieces: [{ name, sub, patch, chords, seed }], split } or { error }
 */
export function draftPieces({ mesh, closest, outline, seam }) {
  let loops = [{ name: outline.name, points: outline.points }];
  let split = null;
  if (seam) {
    split = splitLoopBySeam(outline.points, seam.points);
    if (split.error) return { error: `Seam: ${split.error}` };
    loops = split.loops.map((points, i) => ({ name: `${outline.name} ${i ? 'B' : 'A'}`, points }));
  }
  const pieces = [];
  for (const loop of loops) {
    const seed = loopCentroidSeed(closest, loop.points);
    if (!seed) return { error: `${loop.name}: no surface under the loop centre.` };
    const patch = extractPatch(mesh, closest, loop.points, seed);
    if (patch.error) return { error: `${loop.name}: ${patch.error}` };
    // the fill must stay inside the loop: reaching much further than the loop
    // itself means it escaped, and the piece would be the rest of the body
    let extent = 0;
    for (const p of loop.points) {
      const d = Math.sqrt((p[0] - seed[0]) ** 2 + (p[1] - seed[1]) ** 2 + (p[2] - seed[2]) ** 2);
      if (d > extent) extent = d;
    }
    if (patch.flood_reach_m > extent + LEAK_SLACK_M) return { error: `${loop.name}: could not find the inside of this loop (the fill escaped past it).` };
    const sub = submesh(mesh, patch.faces);
    const chords = loopChords(patch.samples, sub);
    if (chords.error) return { error: `${loop.name}: ${chords.error}` };
    pieces.push({ name: loop.name, sub, patch, chords: chords.chords, seed });
  }
  return { pieces, split };
}

/** Flatten the pieces together and report on each. */
export function flattenDraft(pieces, solver = DEFAULT_SOLVER) {
  const run = flattenPieces(pieces, solver);
  const pairs = new Set(run.shared.map((g) => g.pair));
  const reports = pieces.map((p, i) => ({
    stats: patchStats(p.sub, run.pieces[i].uv),
    chords: chordReport(p.chords, p.sub, run.pieces[i].uv, pairs),
    flat: mapLoopToFlat(p.patch.samples, p.sub, run.pieces[i].uv),
  }));
  const shared = run.shared.length && reports.length > 1 ? {
    chord_count: run.shared.length,
    length_3d_mm: round2(reports[0].chords.shared_length_3d_m * 1000),
    flat_mm: reports.map((r) => round2(r.chords.shared_length_flat_m * 1000)),
    mismatch_mm: round2(Math.abs(reports[0].chords.shared_length_flat_m - reports[1].chords.shared_length_flat_m) * 1000),
    tolerance_mm: SEAM_TOLERANCE_MM,
  } : null;
  const sound = run.converged && !run.diverged && reports.every((r) => r.stats.triangle_flips === 0);
  return { run, reports, shared, sound };
}

const round2 = (v) => Number(v.toFixed(2));

/** The plain summary diagnostics and evidence carry. */
export function draftSummary(pieces, result) {
  const { run, reports, shared } = result;
  return {
    iterations: run.iterations, converged: run.converged, diverged: run.diverged, restarts: run.restarts,
    pieces: pieces.map((p, i) => ({
      name: p.name,
      vertices: reports[i].stats.vertex_count,
      seam_length_3d_mm: round2(reports[i].chords.seam_length_3d_m * 1000),
      seam_length_flat_mm: round2(reports[i].chords.seam_length_flat_m * 1000),
      seam_error_mm: round2(reports[i].chords.seam_error_m * 1000),
      interior_rms_pct: round2(reports[i].stats.interior_rms_pct),
      triangle_flips: reports[i].stats.triangle_flips,
    })),
    shared_seam: shared,
    declared_limits: DECLARED_LIMITS,
  };
}

/** A pen line as the evidence records it: the pen's own `lineGeometry(index)`
 *  already carries name, closed, length, anchors and control points. */
export function lineRecord(line) {
  const r3 = (p) => p.map((v) => Number(v.toFixed(5)));
  return {
    name: line.name || null, closed: line.closed, length_mm: Number((line.length * 1000).toFixed(1)),
    anchors: (line.anchors || []).map(r3),
    control_points: (line.control_points || []).map(r3),
  };
}

/**
 * The DXF and its evidence record for a flattened draft.
 * @param asset  { file, sha256 }   @param registrySha  digest of the registry that drove the session
 */
export function draftExport({ pieces, result, outline, seam, asset, registrySha, release, solver = DEFAULT_SOLVER, now = new Date() }) {
  const { run, reports, shared } = result;
  const names = pieces.map((p, i) => asciiPieceName(p.name, `PIECE_${i + 1}`));
  const records = pieces.map((p, i) => dxfPiece(
    { name: names[i], sub: p.sub, uv: run.pieces[i].uv, samples: p.patch.samples },
    {
      assetSha: asset.sha256, seamErrorMm: reports[i].chords.seam_error_m * 1000,
      sharedSeam: shared && pieces.length === 2 ? { with: names[1 - i], mismatchMm: shared.mismatch_mm } : null,
    },
  ));
  const written = writeAstmDxf({
    style: {
      name: 'AVATAR_MASTER_DRAFT', author: 'Crossian', application: 'bra-fit-viewer', release: String(release).slice(0, 20),
      sampleSize: 'UNGRADED', gradeRuleTable: 'NONE', curveToleranceMm: 0.01, created: now,
    },
    pieces: records,
  });
  const summary = draftSummary(pieces, result);
  const evidence = {
    schema_version: 1,
    asset: { ...asset, unit: 'meter' },
    registry_sha256: registrySha,
    recorded_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    engine: 'scripts/flatten_core.mjs', solver,
    target_cad: 'Gerber AccuMark', import_verified: false,
    declared_limits: DECLARED_LIMITS,
    outline: lineRecord(outline), seam: seam ? lineRecord(seam) : null,
    pieces: summary.pieces.map((p, i) => ({ ...p, dxf_name: names[i], turn_points: records[i].turn_point_indices.length, outline_points: records[i].outline_mm.length })),
    shared_seam: shared,
    solve: { iterations: run.iterations, converged: run.converged, restarts: run.restarts },
    dxf: { layout: written.layout, style_system_text: written.style_system_text, bytes: written.text.length },
  };
  return { dxf: written.text, evidence: `${JSON.stringify(evidence, null, 2)}\n`, names };
}
