/**
 * Research spike behind AUTHORING_UX_PLAN.md §4 — not a gate, writes no evidence.
 * Prints, as JSON: what a pixel is worth on the skin at the viewer's framing and
 * at grazing incidence; how exactly the body mirrors through x -> -x; what a
 * template cup draft from landmarks costs in seam error and milliseconds (the
 * three manual-only root points are SYNTHESISED here — a person places the real
 * ones); and the cost of one shortest-path leg.  `node scripts/spike_authoring_ux.mjs`
 */
import { fileURLToPath } from 'node:url';
import { loadAvatarContext } from './flatten_fixtures.mjs';
import { surfaceRun, pointAtFraction } from './surface_path.mjs';
import { draftPieces, flattenDraft, draftSummary } from './pattern_draft.mjs';
import { trianglesByMaterial } from './glb_reader.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ctx = loadAvatarContext(root);
if (ctx.error) throw new Error(ctx.error);
const { tri, mesh, grid, closest, landmarks } = ctx;
const out = {};

// ---- A. view geometry: mm per pixel and grazing-angle exposure -------------
// whole-model bbox (all materials), as the viewer frames it
const { triangles: byMat } = trianglesByMaterial(`${root}assets/export/avatar_master.glb`);
let bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const t of byMat.values()) for (let i = 0; i < t.length; i += 3) {
  for (let k = 0; k < 3; k++) { if (t[i + k] < bb[k]) bb[k] = t[i + k]; if (t[i + k] > bb[3 + k]) bb[3 + k] = t[i + k]; }
}
const size = [bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]];
const fov = 28 * Math.PI / 180;
const canvasH = 900, canvasW = 1400;                    // a typical laptop pane
const fitH = size[1] / (2 * Math.tan(fov / 2));
const fitW = Math.max(size[0], size[2]) / (2 * Math.tan(fov / 2) * (canvasW / canvasH));
const dist = Math.max(fitH, fitW) * 1.3;
const mmPerPx = 2 * dist * Math.tan(fov / 2) / canvasH * 1000;
out.view = { model_size_m: size.map(v => +v.toFixed(3)), default_distance_m: +dist.toFixed(3), mm_per_px_at_centre: +mmPerPx.toFixed(2),
  mm_per_px_zoomed_0p35m: +(2 * 0.35 * Math.tan(fov / 2) / canvasH * 1000).toFixed(2) };

// area-weighted incidence from three canonical directions (orthographic approximation)
function incidence(dir) {
  let visible = 0, over60 = 0, over75 = 0;
  for (let t = 0; t < tri.length; t += 9) {
    const ax = tri[t], ay = tri[t + 1], az = tri[t + 2];
    const e1 = [tri[t + 3] - ax, tri[t + 4] - ay, tri[t + 5] - az], e2 = [tri[t + 6] - ax, tri[t + 7] - ay, tri[t + 8] - az];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const area = Math.hypot(...n) / 2; if (!area) continue;
    // outward: against radial
    const cx = (ax + tri[t + 3] + tri[t + 6]) / 3, cz = (az + tri[t + 5] + tri[t + 8]) / 3;
    let s = (n[0] * cx + n[2] * cz) < 0 ? -1 : 1;
    const cos = s * (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]) / (2 * area);
    if (cos <= 0) continue;                    // back-facing: not clickable
    visible += area; if (cos < Math.cos(60 * Math.PI / 180)) over60 += area; if (cos < Math.cos(75 * Math.PI / 180)) over75 += area;
  }
  return { visible_area_pct_of_torso: +(100 * visible / totalArea).toFixed(1), grazing_over_60deg_pct: +(100 * over60 / visible).toFixed(1), grazing_over_75deg_pct: +(100 * over75 / visible).toFixed(1) };
}
let totalArea = 0;
for (let t = 0; t < tri.length; t += 9) {
  const e1 = [tri[t + 3] - tri[t], tri[t + 4] - tri[t + 1], tri[t + 5] - tri[t + 2]], e2 = [tri[t + 6] - tri[t], tri[t + 7] - tri[t + 1], tri[t + 8] - tri[t + 2]];
  totalArea += Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
}
out.incidence = { front: incidence([0, 0, 1]), three_quarter: incidence([Math.SQRT1_2, 0, Math.SQRT1_2]), side: incidence([1, 0, 0]) };
out.footprint_mm_per_px = { at_0deg: +mmPerPx.toFixed(2), at_60deg: +(mmPerPx / Math.cos(Math.PI / 3)).toFixed(2), at_75deg: +(mmPerPx / Math.cos(75 * Math.PI / 180)).toFixed(2), at_85deg: +(mmPerPx / Math.cos(85 * Math.PI / 180)).toFixed(2) };

// ---- B. mirror symmetry: does x -> -x land on the surface? -----------------
{
  const d = [];
  const step = Math.max(1, Math.floor(mesh.positions.length / 3 / 3000));
  for (let i = 0; i < mesh.positions.length; i += 3 * step) {
    const x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
    if (x > -0.02 || y < 1.05 || y > 1.5) continue;
    const hit = closest([-x, y, z]); if (!hit) continue;
    d.push(Math.hypot(hit.point[0] + x, hit.point[1] - y, hit.point[2] - z) * 1000);
  }
  d.sort((a, b) => a - b);
  out.mirror = { samples: d.length, mean_mm: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(3), p95_mm: +d[Math.floor(d.length * 0.95)].toFixed(3), max_mm: +d[d.length - 1].toFixed(3) };
}

// ---- C. a template draft from landmarks: cup outline + vertical seam -------
const apex = landmarks.BUST_APEX_L, fold = landmarks.CF_UNDERBUST[1];
const snap = (p) => closest(p).point;
// synthetic stand-ins for the manual-only root points (the real ones are a person's call)
const rootTop = snap([apex[0], apex[1] + 0.065, apex[2] - 0.02]);
const rootBottom = snap([apex[0], fold, apex[2]]);
const rootInner = snap([apex[0] * 0.3, apex[1] - 0.005, apex[2] - 0.01]);
const rootOuter = snap([apex[0] * 1.75, apex[1] - 0.005, apex[2] - 0.045]);
function penLikeLoop(anchors, closed) {
  // as the pen builds a line: shortest path per leg, control points parked at 1/3, 2/3
  const pts = []; let length = 0; const t0 = performance.now(); let legs = 0;
  const pairs = anchors.map((a, i) => [a, anchors[(i + 1) % anchors.length]]).slice(0, closed ? anchors.length : anchors.length - 1);
  for (const [A, B] of pairs) {
    const run = surfaceRun(grid, A, B); const h1 = pointAtFraction(run.points, 1 / 3), h2 = pointAtFraction(run.points, 2 / 3);
    for (const [S, E] of [[A, h1], [h1, h2], [h2, B]]) { const r = surfaceRun(grid, snap(S), snap(E)); legs++; length += r.length; for (const p of r.points) if (!pts.length || Math.hypot(pts.at(-1)[0] - p[0], pts.at(-1)[1] - p[1], pts.at(-1)[2] - p[2]) > 1e-9) pts.push(p); }
  }
  if (closed && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1], pts[0][2] - pts.at(-1)[2]) < 1e-9) pts.pop();
  return { points: pts, length_mm: +(length * 1000).toFixed(1), legs, ms: +(performance.now() - t0).toFixed(0) };
}
const outline = penLikeLoop([rootTop, rootOuter, rootBottom, rootInner], true);
const seamV = penLikeLoop([rootTop, apex, rootBottom], false);
const seamH = penLikeLoop([rootInner, apex, rootOuter], false);
function draft(name, seam) {
  const t0 = performance.now();
  const pieces = draftPieces({ mesh, closest, outline: { name: 'CUP_L', points: outline.points }, seam: seam ? { name, points: seam.points } : null });
  if (pieces.error) return { error: pieces.error };
  const result = flattenDraft(pieces.pieces);
  const s = draftSummary(pieces.pieces, result);
  return { ms: +(performance.now() - t0).toFixed(0), sound: result.sound, iterations: s.iterations, restarts: s.restarts,
    pieces: s.pieces.map(p => ({ name: p.name, seam_error_mm: p.seam_error_mm, seam_3d_mm: p.seam_length_3d_mm, flips: p.triangle_flips, interior_rms_pct: p.interior_rms_pct })),
    shared_mismatch_mm: s.shared_seam?.mismatch_mm ?? null };
}
out.template = {
  inputs: { BUST_APEX_L: apex, ROOT_TOP_L: rootTop.map(v => +v.toFixed(4)), ROOT_BOTTOM_L: rootBottom.map(v => +v.toFixed(4)), ROOT_INNER_L: rootInner.map(v => +v.toFixed(4)), ROOT_OUTER_L: rootOuter.map(v => +v.toFixed(4)) },
  outline: { length_mm: outline.length_mm, legs: outline.legs, build_ms: outline.ms, samples: outline.points.length },
  one_piece: draft('none', null),
  vertical_seam: draft('SEAM_V', seamV),
  horizontal_seam: draft('SEAM_H', seamH),
};

// ---- D. cost of one pen leg (what a live snap preview would re-run) --------
{
  const t0 = performance.now(); let n = 0;
  for (let k = 0; k < 20; k++) { surfaceRun(grid, rootTop, apex); n++; }
  out.leg_ms = +((performance.now() - t0) / n).toFixed(1);
}
console.log(JSON.stringify(out, null, 1));
