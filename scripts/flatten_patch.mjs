/**
 * From a drawn loop to a patch: sampling the loop onto the mesh, flood-filling
 * its inside, turning the loop into chord constraints, cutting an outline into
 * two panels along a seam. The pen tool's input ends up here; the solver
 * (scripts/flatten_solver.mjs) never sees a loop, only chords. Port:
 * scripts/flatten_patch.py.
 */

import { edgeFaceMap } from './flatten_mesh.mjs';

export const DEFAULT_LOOP_SPACING = 0.002;   // barrier samples 2mm apart, < any edge

// ------------------------------------------------------------------ mesh build

function barycentric(P, F, face, q) {
  const i = F[face * 3] * 3, j = F[face * 3 + 1] * 3, k = F[face * 3 + 2] * 3;
  const v0x = P[j] - P[i], v0y = P[j + 1] - P[i + 1], v0z = P[j + 2] - P[i + 2];
  const v1x = P[k] - P[i], v1y = P[k + 1] - P[i + 1], v1z = P[k + 2] - P[i + 2];
  const v2x = q[0] - P[i], v2y = q[1] - P[i + 1], v2z = q[2] - P[i + 2];
  const d00 = v0x * v0x + v0y * v0y + v0z * v0z, d01 = v0x * v1x + v0y * v1y + v0z * v1z;
  const d11 = v1x * v1x + v1y * v1y + v1z * v1z, d20 = v2x * v0x + v2y * v0y + v2z * v0z;
  const d21 = v2x * v1x + v2y * v1y + v2z * v1z;
  const den = d00 * d11 - d01 * d01;
  const b1 = (d11 * d20 - d01 * d21) / den, b2 = (d00 * d21 - d01 * d20) / den;
  return [1 - b1 - b2, b1, b2];
}

/** A point's identity for matching the same loop sample across pieces: the
 *  same 3D coordinates produce the same key, so a seam two pieces share is
 *  recognised without any tolerance. */
export function pointKey(p) {
  return `${Math.floor(p[0] * 1e9 + 0.5)},${Math.floor(p[1] * 1e9 + 0.5)},${Math.floor(p[2] * 1e9 + 0.5)}`;
}

function lexLess(A, B) {
  if (A[0] !== B[0]) return A[0] < B[0];
  if (A[1] !== B[1]) return A[1] < B[1];
  return A[2] < B[2];
}

/**
 * Turn a closed loop drawn on the skin into a patch of faces.
 *
 * The loop is resampled at `spacing` (below any edge length, so consecutive
 * samples cannot skip a face), each sample snapped to the mesh, and every face a
 * sample lands on becomes a barrier. A flood fill over edge-adjacent faces from
 * the seed's face stops at the barrier; the patch is the flood plus the barrier,
 * so the loop lies entirely inside it and can be held to length by chord
 * constraints on the faces it crosses (see `loopChords`).
 *
 * Each segment is resampled in one canonical direction regardless of which way
 * the loop traverses it, so two pieces whose loops share a run of the same pen
 * line produce bit-identical samples along it — that is how a shared seam is
 * recognised.
 *
 * `closest` is a function p -> {point, normal, triangle} over the SAME soup the
 * mesh was welded from (scripts/surface_path.mjs closestOnMesh with its grid).
 * Declared limit: the ring of barrier faces is scaffolding that overshoots the
 * loop by up to one triangle; the piece's outline is the loop's image
 * (`mapLoopToFlat`), never the mesh boundary.
 */
export function extractPatch(mesh, closest, loopPoints, seed, spacing = DEFAULT_LOOP_SPACING) {
  const P = mesh.positions, F = mesh.faces;
  const nf = F.length / 3;
  const samples = [];
  const barrier = new Set();
  const n = loopPoints.length;
  for (let s = 0; s < n; s++) {
    const A = loopPoints[s], B = loopPoints[(s + 1) % n];
    const forward = lexLess(A, B) || (A[0] === B[0] && A[1] === B[1] && A[2] === B[2]);
    const S = forward ? A : B, E = forward ? B : A;
    const dx = E[0] - S[0], dy = E[1] - S[1], dz = E[2] - S[2];
    const chord = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const steps = Math.max(1, Math.ceil(chord / spacing));
    const raw = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      raw.push(k === steps ? [E[0], E[1], E[2]] : [S[0] + dx * t, S[1] + dy * t, S[2] + dz * t]);
    }
    // the traversal keeps its start point and drops its end point
    const ordered = forward ? raw.slice(0, steps) : raw.slice(1).reverse();
    for (const q of ordered) {
      const hit = closest(q);
      if (!hit) return { error: 'loop sample found no surface' };
      const face = hit.triangle / 9;
      barrier.add(face);
      samples.push({ point: hit.point, key: pointKey(hit.point), face, bary: barycentric(P, F, face, hit.point) });
    }
  }
  const seedHit = closest(seed);
  if (!seedHit) return { error: 'seed found no surface' };
  const seedFace = seedHit.triangle / 9;
  if (barrier.has(seedFace)) return { error: 'the loop passes through the seed face' };

  const edgeFaces = edgeFaceMap(F);
  const flooded = new Set([seedFace]);
  const queue = [seedFace];
  for (let q = 0; q < queue.length; q++) {
    const f = queue[q];
    for (let k = 0; k < 3; k++) {
      const i = F[f * 3 + k], j = F[f * 3 + ((k + 1) % 3)];
      const key = (i < j ? i : j) * 16777216 + (i < j ? j : i);
      for (const g of edgeFaces.get(key)) {
        if (g === f || flooded.has(g) || barrier.has(g)) continue;
        flooded.add(g); queue.push(g);
      }
    }
  }
  const faces = [];
  for (let f = 0; f < nf; f++) if (flooded.has(f) || barrier.has(f)) faces.push(f);
  // how far the flood reached from the seed: a leak into the rest of the body
  // shows up here as a distance far beyond the loop
  let reach = 0;
  for (const f of flooded) {
    const cx = (P[F[f * 3] * 3] + P[F[f * 3 + 1] * 3] + P[F[f * 3 + 2] * 3]) / 3 - seed[0];
    const cy = (P[F[f * 3] * 3 + 1] + P[F[f * 3 + 1] * 3 + 1] + P[F[f * 3 + 2] * 3 + 1]) / 3 - seed[1];
    const cz = (P[F[f * 3] * 3 + 2] + P[F[f * 3 + 1] * 3 + 2] + P[F[f * 3 + 2] * 3 + 2]) / 3 - seed[2];
    const d = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (d > reach) reach = d;
  }
  return { faces, samples, flooded: flooded.size, barrier: barrier.size, flood_reach_m: reach };
}

/** A seed for `extractPatch`: the loop's centroid snapped to the surface. For
 *  the convex-ish loops a pattern piece is, that lands inside; if it does not,
 *  the flood fill's reach says so and the caller must refuse. */
export function loopCentroidSeed(closest, loopPoints) {
  let x = 0, y = 0, z = 0;
  for (const p of loopPoints) { x += p[0]; y += p[1]; z += p[2]; }
  const n = loopPoints.length;
  const hit = closest([x / n, y / n, z / n]);
  return hit ? hit.point : null;
}

/**
 * Cut a closed outline into two panel loops along a seam polyline whose ends lie
 * on (or within `snap_m` of) the outline. Each seam end is projected onto the
 * nearest outline segment and that projected point becomes a vertex of both
 * panels; the seam's own end points are dropped in its favour, so the barrier
 * the two loops lay down is closed exactly and the run they share consists of
 * the very same points — which is how `relaxPieces` recognises a shared seam.
 *
 * Returns { loops: [a, b], split_points, end_gaps_m } or { error }.
 */
export function splitLoopBySeam(loopPoints, seamPoints, snap_m = 0.015) {
  const n = loopPoints.length;
  if (n < 3) return { error: 'outline needs at least 3 points' };
  if (!seamPoints || seamPoints.length < 2) return { error: 'seam needs at least 2 points' };
  const project = (q) => {
    let best = null;
    for (let i = 0; i < n; i++) {
      const A = loopPoints[i], B = loopPoints[(i + 1) % n];
      const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
      const ll = dx * dx + dy * dy + dz * dz;
      let t = ll > 0 ? ((q[0] - A[0]) * dx + (q[1] - A[1]) * dy + (q[2] - A[2]) * dz) / ll : 0;
      if (t < 0) t = 0; if (t > 1) t = 1;
      const px = t === 0 ? A[0] : t === 1 ? B[0] : A[0] + dx * t;
      const py = t === 0 ? A[1] : t === 1 ? B[1] : A[1] + dy * t;
      const pz = t === 0 ? A[2] : t === 1 ? B[2] : A[2] + dz * t;
      const ex = q[0] - px, ey = q[1] - py, ez = q[2] - pz;
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (!best || d < best.d) best = { d, i, t, point: [px, py, pz] };
    }
    if (best.t === 1) { best.i = (best.i + 1) % n; best.t = 0; }   // one name for a shared corner
    return best;
  };
  const p1 = project(seamPoints[0]), p2 = project(seamPoints[seamPoints.length - 1]);
  if (p1.d > snap_m || p2.d > snap_m) return { error: `seam end is ${(Math.max(p1.d, p2.d) * 1000).toFixed(1)}mm from the outline (limit ${snap_m * 1000}mm)` };
  const pos = (p) => p.i + p.t;
  if (Math.abs(pos(p1) - pos(p2)) < 1e-12) return { error: 'both seam ends land on the same outline point' };
  // outline vertices strictly between two split positions, walking forward
  const forward = (x, from) => (((x - from) % n) + n) % n;
  const between = (from, to) => {
    const out = [];
    const span = forward(pos(to), pos(from));
    for (let k = 1; k < n; k++) {
      const idx = (Math.floor(pos(from)) + k) % n;
      const d = forward(idx, pos(from));
      if (d >= span - 1e-12) break;
      if (d > 1e-12) out.push(loopPoints[idx]);
    }
    return out;
  };
  const interior = seamPoints.slice(1, -1);
  const arcAB = between(p1, p2), arcBA = between(p2, p1);
  const loopA = [p1.point, ...arcAB, p2.point, ...interior.slice().reverse()];
  const loopB = [p2.point, ...arcBA, p1.point, ...interior];
  return { loops: [loopA, loopB], split_points: [p1.point, p2.point], end_gaps_m: [p1.d, p2.d] };
}

/**
 * The chords of a drawn loop as constraints on a piece: consecutive samples,
 * each a barycentric point in a local face, held to their 3D chord length.
 * `pair` names the chord by its two sample keys, orientation-free, so the same
 * chord in another piece is recognised as shared.
 */
export function loopChords(samples, sub) {
  const localFace = new Map();
  sub.faceIds.forEach((g, i) => localFace.set(g, i));
  const chords = [];
  const n = samples.length;
  for (let s = 0; s < n; s++) {
    const a = samples[s], b = samples[(s + 1) % n];
    const fa = localFace.get(a.face), fb = localFace.get(b.face);
    if (fa === undefined || fb === undefined) return { error: `loop sample ${fa === undefined ? s : (s + 1) % n} lies outside the patch` };
    const dx = b.point[0] - a.point[0], dy = b.point[1] - a.point[1], dz = b.point[2] - a.point[2];
    chords.push({
      fa, ba: a.bary, fb, bb: b.bary,
      rest: Math.sqrt(dx * dx + dy * dy + dz * dz),
      pair: a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`,
    });
  }
  return { chords };
}

// --------------------------------------------------------------------- flatten
