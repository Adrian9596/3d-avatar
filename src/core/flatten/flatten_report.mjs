/**
 * What the evidence says about a flattened piece: mesh-level statistics, the
 * seam (chord) report, and the drawn loop's flat image. Pure functions of a
 * sub-mesh and its uv. Port: scripts/flatten_report.py.
 */

import { edgeList, edgeLengths, boundaryComponents } from './flatten_mesh.mjs';

/** Everything the evidence file says about one flattened piece's MESH, in
 *  metres. For a loop-cut piece the mesh boundary is scaffolding; the seam
 *  figures that matter are `chordReport`'s. */
export function patchStats(sub, uv) {
  const P = sub.positions, F = sub.faces;
  const edges = edgeList(F);
  const rest = edgeLengths(P, edges);
  let b3 = 0, b2 = 0, worstB = 0, sumSqI = 0, sumSqPctI = 0, maxPctI = 0, nI = 0;
  for (let e = 0; e < edges.a.length; e++) {
    const i = edges.a[e], j = edges.b[e];
    const dx = uv[i * 2] - uv[j * 2], dy = uv[i * 2 + 1] - uv[j * 2 + 1];
    const flat = Math.sqrt(dx * dx + dy * dy);
    const err = flat - rest[e];
    if (edges.count[e] === 1) {
      b3 += rest[e]; b2 += flat;
      if (Math.abs(err) > worstB) worstB = Math.abs(err);
    } else {
      nI++; sumSqI += err * err;
      const pct = err / rest[e];
      sumSqPctI += pct * pct;
      if (Math.abs(pct) > maxPctI) maxPctI = Math.abs(pct);
    }
  }
  let area3 = 0, area2 = 0, flips = 0;
  for (let f = 0; f < F.length; f += 3) {
    const i = F[f], j = F[f + 1], k = F[f + 2];
    const ax = P[j * 3] - P[i * 3], ay = P[j * 3 + 1] - P[i * 3 + 1], az = P[j * 3 + 2] - P[i * 3 + 2];
    const bx = P[k * 3] - P[i * 3], by = P[k * 3 + 1] - P[i * 3 + 1], bz = P[k * 3 + 2] - P[i * 3 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    area3 += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    const s = (uv[j * 2] - uv[i * 2]) * (uv[k * 2 + 1] - uv[i * 2 + 1]) - (uv[k * 2] - uv[i * 2]) * (uv[j * 2 + 1] - uv[i * 2 + 1]);
    area2 += 0.5 * Math.abs(s);
    if (s < 0) flips++;
  }
  const nv = P.length / 3, ne = edges.a.length, nfc = F.length / 3;
  return {
    vertex_count: nv, face_count: nfc, edge_count: ne,
    euler_characteristic: nv - ne + nfc,
    boundary_loop_count: boundaryComponents(sub),
    boundary_length_3d_m: b3, boundary_length_flat_m: b2, boundary_error_m: b2 - b3,
    worst_boundary_edge_error_m: worstB,
    interior_rms_error_m: nI ? Math.sqrt(sumSqI / nI) : 0,
    interior_rms_pct: nI ? 100 * Math.sqrt(sumSqPctI / nI) : 0,
    interior_max_pct: 100 * maxPctI,
    area_3d_m2: area3, area_flat_m2: area2, area_error_pct: area3 ? 100 * (area2 - area3) / area3 : 0,
    triangle_flips: flips,
  };
}

/** The seam of a loop-cut piece: total 3D and flat length of its chords, the
 *  worst single chord, and — for chords shared with other pieces (`pairs`, a
 *  Set of pair keys) — the same figures for the shared run alone. */
export function chordReport(chords, sub, uv, pairs = null) {
  const F = sub.faces;
  const flatLen = (c) => {
    const i = F[c.fa * 3], j = F[c.fa * 3 + 1], k = F[c.fa * 3 + 2];
    const l = F[c.fb * 3], m = F[c.fb * 3 + 1], n = F[c.fb * 3 + 2];
    const ax = c.ba[0] * uv[i * 2] + c.ba[1] * uv[j * 2] + c.ba[2] * uv[k * 2];
    const ay = c.ba[0] * uv[i * 2 + 1] + c.ba[1] * uv[j * 2 + 1] + c.ba[2] * uv[k * 2 + 1];
    const bx = c.bb[0] * uv[l * 2] + c.bb[1] * uv[m * 2] + c.bb[2] * uv[n * 2];
    const by = c.bb[0] * uv[l * 2 + 1] + c.bb[1] * uv[m * 2 + 1] + c.bb[2] * uv[n * 2 + 1];
    const dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  };
  let l3 = 0, l2 = 0, worst = 0, s3 = 0, s2 = 0, sn = 0;
  for (const c of chords) {
    const f = flatLen(c);
    l3 += c.rest; l2 += f;
    if (Math.abs(f - c.rest) > worst) worst = Math.abs(f - c.rest);
    if (pairs && pairs.has(c.pair)) { s3 += c.rest; s2 += f; sn++; }
  }
  const out = { chord_count: chords.length, seam_length_3d_m: l3, seam_length_flat_m: l2, seam_error_m: l2 - l3, worst_chord_error_m: worst };
  if (pairs) Object.assign(out, { shared_chord_count: sn, shared_length_3d_m: s3, shared_length_flat_m: s2 });
  return out;
}

/** Where the drawn loop lands in the flat piece: each sample through the
 *  barycentric coordinates of the face it sat on. This, not the jagged mesh
 *  boundary, is the piece's outline. */
export function mapLoopToFlat(samples, sub, uv) {
  const localFace = new Map();
  sub.faceIds.forEach((g, i) => localFace.set(g, i));
  const flat = [];
  let len3 = 0, len2 = 0;
  for (let s = 0; s < samples.length; s++) {
    const smp = samples[s];
    const lf = localFace.get(smp.face);
    if (lf === undefined) return { error: `loop sample ${s} lies outside the patch` };
    const i = sub.faces[lf * 3], j = sub.faces[lf * 3 + 1], k = sub.faces[lf * 3 + 2];
    const [b0, b1, b2] = smp.bary;
    flat.push([b0 * uv[i * 2] + b1 * uv[j * 2] + b2 * uv[k * 2],
      b0 * uv[i * 2 + 1] + b1 * uv[j * 2 + 1] + b2 * uv[k * 2 + 1]]);
  }
  for (let s = 0; s < samples.length; s++) {
    const a = samples[s].point, b = samples[(s + 1) % samples.length].point;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    len3 += Math.sqrt(dx * dx + dy * dy + dz * dz);
    const p = flat[s], q = flat[(s + 1) % flat.length];
    const ex = q[0] - p[0], ey = q[1] - p[1];
    len2 += Math.sqrt(ex * ex + ey * ey);
  }
  return { points: flat, loop_length_3d_m: len3, loop_length_flat_m: len2 };
}
