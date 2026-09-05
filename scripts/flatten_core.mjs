/**
 * Flattening a patch of the avatar's skin to 2D — the engine behind a 2D pattern
 * draft. PATTERN_2D_DXF_PLAN.md records the numbers this design rests on.
 *
 * One objective, on purpose. A pattern piece is judged at its SEAM, not in its
 * middle: two pieces that meet must have equal seam length or they cannot be
 * sewn. So the solver holds the seam hard to its 3D length and lets only the
 * interior absorb the curvature — which is what fabric does. Measured on a
 * one-cup patch of this body it halves the seam error of a conformal (LSCM) or
 * as-rigid-as-possible layout, and neither of those needs to run first: from a
 * hinge unfolding this relaxation converges to the same minimum to 0.01mm.
 *
 * What "the seam" is. For a patch handed in as a set of faces it is the mesh
 * boundary. For a patch cut out by a drawn loop it is the LOOP: each loop sample
 * is a point inside a face (barycentric), and the chord between consecutive
 * samples is a distance constraint on that face's vertices — so the drawn line is
 * held to length without remeshing, and the ring of faces the loop passes through
 * is scaffolding the exported outline never includes. When several pieces share
 * a seam, the shared chords are additionally pulled to a common length in every
 * piece, because two pieces that disagree on their shared seam cannot be sewn.
 *
 * What it cannot do, and says so: a doubly curved patch has curvature that no
 * flattening removes (Gauss). The residual seam error is reported per piece so
 * the reason a cup is cut into panels stays visible in the evidence; it is
 * never hidden by rescaling.
 *
 * Numerics are written out longhand (no hypot, no reductions whose order the
 * runtime chooses) because scripts/flatten.py is an independent port and the
 * parity gate compares the two to a micrometre.
 *
 * Coordinates are metres. Meshes are flat arrays: positions [x,y,z,...],
 * faces [i,j,k,...]. The output `uv` is a flat [u,v,...] array in metres.
 */

export const DEFAULT_SOLVER = Object.freeze({
  interior_weight: 0.25,   // interior edges, and the scaffold boundary of a loop-cut patch
  seam_weight: 1.0,        // mesh boundary of a face-set patch; loop chords of a loop-cut patch
  couple_weight: 4.0,      // extra pull of a shared chord towards its mean length across pieces
  max_iterations: 10000,
  convergence_m: 5e-9,     // stop when no vertex moved more than this in a sweep
  // Chebyshev semi-iteration over the Jacobi sweep (Wang 2015): same fixed point,
  // 10-20x fewer sweeps. rho is the assumed spectral radius; too high diverges,
  // which the guard below catches by dropping the momentum for that sweep.
  chebyshev_rho: 0.999,
  chebyshev_gamma: 0.75,
  chebyshev_delay: 10,
  rho_fallback: [0.99, 0.9, 0],   // on divergence: restart from the unfolding with the next rho
  // a face whose flat signed area drops below this fraction of its 3D area is
  // about to fold over and is pushed back; sound faces sit far above it, so the
  // constraint is inactive on them and does not move the fixed point
  fold_min_area_fraction: 0.25,
});
export const DEFAULT_WELD_QUANTUM = 1e-6;   // 1µm: below float32 resolution here
export const DEFAULT_LOOP_SPACING = 0.002;   // barrier samples 2mm apart, < any edge

// ------------------------------------------------------------------ mesh build

/** Weld a triangle soup (9 floats per face) into an indexed mesh. Face order is
 *  preserved, so face f of the result is bytes 9f..9f+8 of the input. */
export function weld(tri, quantum = DEFAULT_WELD_QUANTUM) {
  const index = new Map();
  const positions = [];
  const faces = [];
  const inv = 1 / quantum;
  for (let t = 0; t < tri.length; t += 3) {
    const x = tri[t], y = tri[t + 1], z = tri[t + 2];
    const key = `${Math.floor(x * inv + 0.5)},${Math.floor(y * inv + 0.5)},${Math.floor(z * inv + 0.5)}`;
    let id = index.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      index.set(key, id);
      positions.push(x, y, z);
    }
    faces.push(id);
  }
  return { positions, faces };
}

/** Unique edges in first-appearance order, with how many faces use each. */
export function edgeList(faces) {
  const seen = new Map();
  const a = [], b = [], count = [];
  for (let f = 0; f < faces.length; f += 3) {
    for (let k = 0; k < 3; k++) {
      const i = faces[f + k], j = faces[f + ((k + 1) % 3)];
      if (i === j) continue;                       // degenerate: no edge
      const lo = i < j ? i : j, hi = i < j ? j : i;
      const key = lo * 16777216 + hi;
      const at = seen.get(key);
      if (at === undefined) { seen.set(key, a.length); a.push(lo); b.push(hi); count.push(1); }
      else count[at]++;
    }
  }
  return { a, b, count };
}

function edgeLengths(positions, edges) {
  const out = new Array(edges.a.length);
  for (let e = 0; e < edges.a.length; e++) {
    const i = edges.a[e] * 3, j = edges.b[e] * 3;
    const dx = positions[i] - positions[j], dy = positions[i + 1] - positions[j + 1], dz = positions[i + 2] - positions[j + 2];
    out[e] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return out;
}

function edgeFaceMap(F) {
  const edgeFaces = new Map();
  for (let f = 0; f < F.length / 3; f++) {
    for (let k = 0; k < 3; k++) {
      const i = F[f * 3 + k], j = F[f * 3 + ((k + 1) % 3)];
      const key = (i < j ? i : j) * 16777216 + (i < j ? j : i);
      let list = edgeFaces.get(key);
      if (!list) { list = []; edgeFaces.set(key, list); }
      list.push(f);
    }
  }
  return edgeFaces;
}

// ------------------------------------------------------------- patch selection

class MinHeap {
  constructor() { this.items = []; }
  push(d, v) {
    const items = this.items; items.push([d, v]);
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (items[p][0] <= items[i][0]) break;
      [items[p], items[i]] = [items[i], items[p]]; i = p;
    }
  }
  pop() {
    const items = this.items; const top = items[0]; const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < items.length && items[l][0] < items[m][0]) m = l;
        if (r < items.length && items[r][0] < items[m][0]) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]]; i = m;
      }
    }
    return top;
  }
  get size() { return this.items.length; }
}

/** Shortest distance along mesh edges from one vertex to every other. An upper
 *  bound on the true surface geodesic; it only decides which faces are in a
 *  test disc, so the bound is fine. */
export function edgeGeodesic(mesh, source) {
  const n = mesh.positions.length / 3;
  const edges = edgeList(mesh.faces);
  const len = edgeLengths(mesh.positions, edges);
  const adj = Array.from({ length: n }, () => []);
  for (let e = 0; e < edges.a.length; e++) {
    adj[edges.a[e]].push([edges.b[e], len[e]]);
    adj[edges.b[e]].push([edges.a[e], len[e]]);
  }
  const dist = new Array(n).fill(Infinity);
  dist[source] = 0;
  const heap = new MinHeap(); heap.push(0, source);
  while (heap.size) {
    const [d, v] = heap.pop();
    if (d > dist[v]) continue;
    for (const [w, l] of adj[v]) {
      const nd = d + l;
      if (nd < dist[w]) { dist[w] = nd; heap.push(nd, w); }
    }
  }
  return dist;
}

/** Index of the vertex nearest a point (lowest index on a tie). */
export function nearestVertex(mesh, p) {
  const P = mesh.positions;
  let best = -1, bestSq = Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const dx = P[i] - p[0], dy = P[i + 1] - p[1], dz = P[i + 2] - p[2];
    const sq = dx * dx + dy * dy + dz * dz;
    if (sq < bestSq) { bestSq = sq; best = i / 3; }
  }
  return best;
}

/** Faces whose three vertices all lie within an edge-geodesic radius of the
 *  vertex nearest `seed`. `half` keeps only faces whose centroid is above or
 *  below the seed's height — the two-panel cup of the plan's §5. */
export function geodesicDisc(mesh, seed, radius, half = null) {
  const dist = edgeGeodesic(mesh, nearestVertex(mesh, seed));
  const F = mesh.faces, P = mesh.positions;
  const out = [];
  for (let f = 0; f < F.length; f += 3) {
    if (dist[F[f]] > radius || dist[F[f + 1]] > radius || dist[F[f + 2]] > radius) continue;
    if (half) {
      const cy = (P[F[f] * 3 + 1] + P[F[f + 1] * 3 + 1] + P[F[f + 2] * 3 + 1]) / 3;
      if (half === 'above_seed' && cy < seed[1]) continue;
      if (half === 'below_seed' && cy >= seed[1]) continue;
    }
    out.push(f / 3);
  }
  return out;
}

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

/** Restrict a mesh to a face list. Vertices are renumbered in first-appearance
 *  order; `vertexMap` (global -> local) and `faceIds` (local -> global) let a
 *  loop sample or a shared seam be found again. */
export function submesh(mesh, faceIds) {
  const vertexMap = new Map();
  const positions = [], faces = [];
  let degenerate = 0;
  const kept = [];
  for (const f of faceIds) {
    const ids = [mesh.faces[f * 3], mesh.faces[f * 3 + 1], mesh.faces[f * 3 + 2]];
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) { degenerate++; continue; }
    for (const g of ids) {
      let local = vertexMap.get(g);
      if (local === undefined) {
        local = positions.length / 3; vertexMap.set(g, local);
        positions.push(mesh.positions[g * 3], mesh.positions[g * 3 + 1], mesh.positions[g * 3 + 2]);
      }
      faces.push(local);
    }
    kept.push(f);
  }
  return { positions, faces, vertexMap, faceIds: kept, degenerate };
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

/**
 * Starting layout by hinge unfolding. The face nearest the patch centroid is laid
 * flat; every other face is hinged out rigidly across the edge it shares with an
 * already-placed face, breadth-first; a vertex reached along several paths takes
 * the mean of its copies. On a developable surface the copies coincide, so this
 * IS the exact unrolling and the relaxation has nothing left to do; on a dome the
 * copies disagree by the curvature between neighbouring paths, which is small,
 * so nothing starts folded over — a plane projection of a 150° cone did.
 *
 * Every face is placed with positive orientation from its own winding, so with a
 * consistently wound mesh neighbours land on opposite sides of a shared edge and
 * no triangle is ever placed inverted.
 */
export function hingeUnfold(sub) {
  const P = sub.positions, F = sub.faces;
  const nf = F.length / 3, nv = P.length / 3;
  const d3 = (i, j) => {
    const dx = P[i * 3] - P[j * 3], dy = P[i * 3 + 1] - P[j * 3 + 1], dz = P[i * 3 + 2] - P[j * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  // seed: face whose centroid is nearest the patch centroid (lowest index on a tie)
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < P.length; i += 3) { cx += P[i]; cy += P[i + 1]; cz += P[i + 2]; }
  cx /= nv; cy /= nv; cz /= nv;
  let seed = 0, seedSq = Infinity;
  for (let f = 0; f < nf; f++) {
    const i = F[f * 3] * 3, j = F[f * 3 + 1] * 3, k = F[f * 3 + 2] * 3;
    const gx = (P[i] + P[j] + P[k]) / 3 - cx, gy = (P[i + 1] + P[j + 1] + P[k + 1]) / 3 - cy, gz = (P[i + 2] + P[j + 2] + P[k + 2]) / 3 - cz;
    const sq = gx * gx + gy * gy + gz * gz;
    if (sq < seedSq) { seedSq = sq; seed = f; }
  }
  const edgeFaces = edgeFaceMap(F);
  // per-face 2D corners, in the face's own vertex order
  const corner = new Array(nf * 6).fill(NaN);
  const placed = new Uint8Array(nf);
  // third corner C to the left of A->B, at 3D distances |AC|, |BC|
  const third = (ax, ay, bx, by, a, b) => {
    const ex = bx - ax, ey = by - ay;
    const c = Math.sqrt(ex * ex + ey * ey);
    const ux = ex / c, uy = ey / c;
    const x = (a * a - b * b + c * c) / (2 * c);
    const y = Math.sqrt(Math.max(0, a * a - x * x));
    return [ax + x * ux - y * uy, ay + x * uy + y * ux];
  };
  {
    const i = F[seed * 3], j = F[seed * 3 + 1], k = F[seed * 3 + 2];
    const c = d3(i, j);
    const [tx, ty] = third(0, 0, c, 0, d3(i, k), d3(j, k));
    corner[seed * 6] = 0; corner[seed * 6 + 1] = 0; corner[seed * 6 + 2] = c; corner[seed * 6 + 3] = 0;
    corner[seed * 6 + 4] = tx; corner[seed * 6 + 5] = ty;
    placed[seed] = 1;
  }
  const queue = [seed];
  for (let q = 0; q < queue.length; q++) {
    const f = queue[q];
    for (let k = 0; k < 3; k++) {
      const i = F[f * 3 + k], j = F[f * 3 + ((k + 1) % 3)];
      const key = (i < j ? i : j) * 16777216 + (i < j ? j : i);
      for (const g of edgeFaces.get(key)) {
        if (g === f || placed[g]) continue;
        // rotate g's winding so its shared edge comes first, as (B, A) since a
        // consistently wound neighbour traverses the edge the other way
        let r = 0;
        while (r < 3 && !(F[g * 3 + r] === j && F[g * 3 + ((r + 1) % 3)] === i)) r++;
        if (r === 3) { r = 0; while (r < 3 && !(F[g * 3 + r] === i && F[g * 3 + ((r + 1) % 3)] === j)) r++; }
        if (r === 3) continue;
        const A = F[g * 3 + r], B = F[g * 3 + ((r + 1) % 3)], C = F[g * 3 + ((r + 2) % 3)];
        const slotA = A === i ? k : (k + 1) % 3, slotB = B === i ? k : (k + 1) % 3;
        const ax = corner[f * 6 + slotA * 2], ay = corner[f * 6 + slotA * 2 + 1];
        const bx = corner[f * 6 + slotB * 2], by = corner[f * 6 + slotB * 2 + 1];
        const [tx, ty] = third(ax, ay, bx, by, d3(A, C), d3(B, C));
        corner[g * 6 + r * 2] = ax; corner[g * 6 + r * 2 + 1] = ay;
        corner[g * 6 + ((r + 1) % 3) * 2] = bx; corner[g * 6 + ((r + 1) % 3) * 2 + 1] = by;
        corner[g * 6 + ((r + 2) % 3) * 2] = tx; corner[g * 6 + ((r + 2) % 3) * 2 + 1] = ty;
        placed[g] = 1; queue.push(g);
      }
    }
  }
  const uv = new Array(nv * 2).fill(0), count = new Array(nv).fill(0);
  for (let f = 0; f < nf; f++) {
    if (!placed[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = F[f * 3 + k];
      uv[v * 2] += corner[f * 6 + k * 2]; uv[v * 2 + 1] += corner[f * 6 + k * 2 + 1]; count[v]++;
    }
  }
  for (let v = 0; v < nv; v++) if (count[v]) { uv[v * 2] /= count[v]; uv[v * 2 + 1] /= count[v]; }
  return uv;
}

/**
 * Seam-exact relaxation of one or more pieces at once.
 *
 * Every mesh edge is a distance constraint to its 3D length: the boundary at
 * `seam_weight` when the piece is a face set, or at `interior_weight` when the
 * piece was cut by a loop (its mesh boundary is then scaffolding); interior
 * edges at `interior_weight`. Every loop chord is a distance constraint between
 * two barycentric points at `seam_weight`, spread over the vertices of the two
 * faces by their barycentric weights. A chord that appears in more than one
 * piece is additionally pulled, with `couple_weight`, towards the mean of its
 * current lengths across those pieces.
 *
 * Three things keep the iteration honest:
 * - Corrections are accumulated over a whole sweep and applied together
 *   (Jacobi, not Gauss-Seidel), so the result does not depend on constraint
 *   order and the Python port can match it.
 * - A mirrored triangle has exactly the edge lengths of the right one, so
 *   distance constraints cannot see a fold-over. A one-sided signed-area
 *   constraint catches it: only a face whose flat area falls below a fraction of
 *   its 3D area is touched, and its gradient is linear in the positions — a
 *   reflection-based push was impulsive and made the acceleration diverge.
 * - No constraint can see a rigid motion of a piece, and per-vertex weighting
 *   does not conserve momentum, so the mean translation and rotation of each
 *   sweep are removed — otherwise a piece whose shape has settled keeps drifting
 *   and the convergence test never fires.
 * The sweep is then Chebyshev-accelerated (see DEFAULT_SOLVER). A sweep that
 * blows up (non-finite or metre-scale moves) restarts every piece from its
 * unfolding with the next rho of `rho_fallback`, so a fixed rho can never turn
 * a sound patch into garbage; the result says how many restarts it took.
 *
 * Returns per-piece uv plus the shared-chord groups.
 */
export function relaxPieces(pieces, solver = DEFAULT_SOLVER) {
  const states = pieces.map(({ sub, uv, chords }) => {
    const edges = edgeList(sub.faces);
    const rest = edgeLengths(sub.positions, edges);
    const hasLoop = chords && chords.length > 0;
    const w = edges.count.map((c) => (c === 1 && !hasLoop ? solver.seam_weight : solver.interior_weight));
    const n = uv.length / 2;
    const P = sub.positions, F = sub.faces, area3 = [];
    for (let f = 0; f < F.length; f += 3) {
      const i = F[f] * 3, j = F[f + 1] * 3, k = F[f + 2] * 3;
      const ax = P[j] - P[i], ay = P[j + 1] - P[i + 1], az = P[j + 2] - P[i + 2];
      const bx = P[k] - P[i], by = P[k + 1] - P[i + 1], bz = P[k + 2] - P[i + 2];
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      area3.push(0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz));
    }
    return { sub, start: uv, U: uv.slice(), prev: uv.slice(), edges, rest, w, chords: chords || [], n, omega: 1, lastMove: Infinity, area3, diverged: false };
  });
  // shared chords: same pair key in different pieces
  const groups = new Map();
  states.forEach((st, p) => st.chords.forEach((c, ci) => {
    let g = groups.get(c.pair);
    if (!g) { g = []; groups.set(c.pair, g); }
    g.push([p, ci]);
  }));
  const shared = [...groups.entries()].filter(([, members]) => new Set(members.map((m) => m[0])).size > 1);
  const chordLen = states.map((st) => new Array(st.chords.length).fill(0));
  const chordTarget = states.map((st) => st.chords.map((c) => c.rest));
  const chordWeight = states.map((st) => new Array(st.chords.length).fill(solver.seam_weight));
  for (const [, members] of shared) for (const [p, ci] of members) chordWeight[p][ci] = solver.seam_weight + solver.couple_weight;

  let rho = solver.chebyshev_rho ?? 0;
  const gamma = solver.chebyshev_gamma ?? 1, delay = solver.chebyshev_delay ?? 0;
  const ladder = (solver.rho_fallback ?? []).filter((r) => r < rho);
  const foldFraction = solver.fold_min_area_fraction ?? 0;
  let restarts = 0, sweepBase = 0;
  const point = (st, f, b, out) => {
    const F = st.sub.faces, U = st.U;
    const i = F[f * 3], j = F[f * 3 + 1], k = F[f * 3 + 2];
    out[0] = b[0] * U[i * 2] + b[1] * U[j * 2] + b[2] * U[k * 2];
    out[1] = b[0] * U[i * 2 + 1] + b[1] * U[j * 2 + 1] + b[2] * U[k * 2 + 1];
  };
  const pa = [0, 0], pb = [0, 0];
  let iterations = 0, converged = false;
  while (iterations < solver.max_iterations) {
    // current chord lengths first, so coupled chords can see each other
    for (let p = 0; p < states.length; p++) {
      const st = states[p];
      for (let ci = 0; ci < st.chords.length; ci++) {
        const c = st.chords[ci];
        point(st, c.fa, c.ba, pa); point(st, c.fb, c.bb, pb);
        const dx = pa[0] - pb[0], dy = pa[1] - pb[1];
        chordLen[p][ci] = Math.sqrt(dx * dx + dy * dy);
      }
    }
    for (const [, members] of shared) {
      let mean = 0;
      for (const [p, ci] of members) mean += chordLen[p][ci];
      mean /= members.length;
      for (const [p, ci] of members) {
        // one constraint towards rest at seam_weight and one towards the mean at
        // couple_weight add up to a single constraint towards their blend
        chordTarget[p][ci] = (solver.seam_weight * states[p].chords[ci].rest + solver.couple_weight * mean)
          / (solver.seam_weight + solver.couple_weight);
      }
    }
    let maxMove = 0;
    for (let p = 0; p < states.length; p++) {
      const st = states[p];
      const { U, edges, rest, w, n } = st;
      const F = st.sub.faces;
      const acc = new Array(n * 2).fill(0), cw = new Array(n).fill(0);
      for (let e = 0; e < edges.a.length; e++) {
        const i = edges.a[e], j = edges.b[e];
        const dx = U[i * 2] - U[j * 2], dy = U[i * 2 + 1] - U[j * 2 + 1];
        let len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-12) len = 1e-12;
        const s = w[e] * (len - rest[e]) / len * 0.5;
        const cx = s * dx, cy = s * dy;
        acc[i * 2] -= cx; acc[i * 2 + 1] -= cy;
        acc[j * 2] += cx; acc[j * 2 + 1] += cy;
        cw[i] += w[e]; cw[j] += w[e];
      }
      for (let ci = 0; ci < st.chords.length; ci++) {
        const c = st.chords[ci];
        point(st, c.fa, c.ba, pa); point(st, c.fb, c.bb, pb);
        const dx = pa[0] - pb[0], dy = pa[1] - pb[1];
        let len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-12) len = 1e-12;
        const gap = len - chordTarget[p][ci];
        const denom = c.ba[0] * c.ba[0] + c.ba[1] * c.ba[1] + c.ba[2] * c.ba[2]
          + c.bb[0] * c.bb[0] + c.bb[1] * c.bb[1] + c.bb[2] * c.bb[2];
        const s = gap / denom / len;
        const wc = chordWeight[p][ci];
        for (let k = 0; k < 3; k++) {
          const v = F[c.fa * 3 + k], b = c.ba[k];
          acc[v * 2] -= wc * b * b * s * dx; acc[v * 2 + 1] -= wc * b * b * s * dy; cw[v] += wc * b;
        }
        for (let k = 0; k < 3; k++) {
          const v = F[c.fb * 3 + k], b = c.bb[k];
          acc[v * 2] += wc * b * b * s * dx; acc[v * 2 + 1] += wc * b * b * s * dy; cw[v] += wc * b;
        }
      }
      // orientation: a face whose flat signed area has fallen below a fraction of
      // its 3D area is folding; push it back along the (linear) area gradient
      for (let f = 0; f < F.length; f += 3) {
        const a = F[f], b = F[f + 1], c = F[f + 2];
        const ax = U[a * 2], ay = U[a * 2 + 1], bx = U[b * 2], by = U[b * 2 + 1], cx = U[c * 2], cy = U[c * 2 + 1];
        const area2 = 0.5 * ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
        const floor = foldFraction * st.area3[f / 3];
        if (area2 >= floor) continue;
        const gap = area2 - floor;
        const gax = 0.5 * (by - cy), gay = 0.5 * (cx - bx);
        const gbx = 0.5 * (cy - ay), gby = 0.5 * (ax - cx);
        const gcx = 0.5 * (ay - by), gcy = 0.5 * (bx - ax);
        const gg = gax * gax + gay * gay + gbx * gbx + gby * gby + gcx * gcx + gcy * gcy;
        if (gg < 1e-30) continue;
        const lam = gap / gg, wa = solver.seam_weight;
        acc[a * 2] -= wa * lam * gax; acc[a * 2 + 1] -= wa * lam * gay; cw[a] += wa;
        acc[b * 2] -= wa * lam * gbx; acc[b * 2 + 1] -= wa * lam * gby; cw[b] += wa;
        acc[c * 2] -= wa * lam * gcx; acc[c * 2 + 1] -= wa * lam * gcy; cw[c] += wa;
      }
      const move = new Array(n * 2).fill(0);
      for (let i = 0; i < n; i++) {
        if (cw[i] <= 0) continue;
        move[i * 2] = acc[i * 2] / cw[i]; move[i * 2 + 1] = acc[i * 2 + 1] / cw[i];
      }
      // remove the rigid part of the sweep: mean translation, mean rotation about the centroid
      let mx = 0, my = 0, gx = 0, gy = 0;
      for (let i = 0; i < n; i++) { mx += move[i * 2]; my += move[i * 2 + 1]; gx += U[i * 2]; gy += U[i * 2 + 1]; }
      mx /= n; my /= n; gx /= n; gy /= n;
      let cross = 0, rr = 0;
      for (let i = 0; i < n; i++) {
        const rx = U[i * 2] - gx, ry = U[i * 2 + 1] - gy;
        cross += rx * (move[i * 2 + 1] - my) - ry * (move[i * 2] - mx);
        rr += rx * rx + ry * ry;
      }
      const omegaRot = rr > 0 ? cross / rr : 0;
      for (let i = 0; i < n; i++) {
        const rx = U[i * 2] - gx, ry = U[i * 2 + 1] - gy;
        move[i * 2] -= mx - omegaRot * ry; move[i * 2 + 1] -= my + omegaRot * rx;
      }
      // Chebyshev step: x_new = omega * (gamma * (xhat - x) + x - x_prev) + x_prev
      let omega;
      if (rho <= 0 || iterations - sweepBase < delay) omega = 1;
      else if (iterations - sweepBase === delay) omega = 2 / (2 - rho * rho);
      else omega = 4 / (4 - rho * rho * st.omega);
      let pieceMove = 0;
      const prev = st.prev;
      for (let i = 0; i < n * 2; i++) {
        const xk = U[i];
        const xnew = omega * (gamma * move[i] + xk - prev[i]) + prev[i];
        prev[i] = xk; U[i] = xnew;
      }
      for (let i = 0; i < n; i++) {
        const dx = U[i * 2] - prev[i * 2], dy = U[i * 2 + 1] - prev[i * 2 + 1];
        const mv = Math.sqrt(dx * dx + dy * dy);
        if (mv > pieceMove) pieceMove = mv;
      }
      st.omega = omega;
      st.lastMove = pieceMove;
      if (!Number.isFinite(pieceMove) || pieceMove > 0.05) st.diverged = true;
      if (pieceMove > maxMove) maxMove = pieceMove;
    }
    iterations++;
    if (states.some((st) => st.diverged)) {
      if (!ladder.length) break;
      rho = ladder.shift(); restarts++; sweepBase = iterations;
      for (const st of states) { st.U = st.start.slice(); st.prev = st.start.slice(); st.omega = 1; st.lastMove = Infinity; st.diverged = false; }
      continue;
    }
    if (maxMove < solver.convergence_m) { converged = true; break; }
  }
  return {
    diverged: states.some((st) => st.diverged), restarts, rho_used: rho,
    pieces: states.map((st) => ({ uv: st.U })),
    shared: shared.map(([pair, members]) => ({ pair, members })),
    iterations, converged,
  };
}

/** Hinge unfolding followed by seam-exact relaxation: the one flattening of a
 *  single piece. `chords` (from `loopChords`) makes a drawn loop the seam. */
export function flattenPatch(sub, solver = DEFAULT_SOLVER, chords = null) {
  const out = relaxPieces([{ sub, uv: hingeUnfold(sub), chords }], solver);
  return { uv: out.pieces[0].uv, iterations: out.iterations, converged: out.converged, diverged: out.diverged, restarts: out.restarts };
}

/** Several pieces solved together so the chords they share agree in length. */
export function flattenPieces(pieces, solver = DEFAULT_SOLVER) {
  return relaxPieces(pieces.map(({ sub, chords }) => ({ sub, uv: hingeUnfold(sub), chords })), solver);
}

// ----------------------------------------------------------------- reporting

/** Ordered boundary loops (local vertex indices). A disc has exactly one. */
export function boundaryLoops(sub) {
  const edges = edgeList(sub.faces);
  const next = new Map();
  for (let e = 0; e < edges.a.length; e++) {
    if (edges.count[e] !== 1) continue;
    const a = edges.a[e], b = edges.b[e];
    if (!next.has(a)) next.set(a, []); if (!next.has(b)) next.set(b, []);
    next.get(a).push(b); next.get(b).push(a);
  }
  const used = new Set();
  const loops = [];
  const starts = [...next.keys()].sort((x, y) => x - y);
  for (const start of starts) {
    if (used.has(start)) continue;
    const loop = [start]; used.add(start);
    let prev = -1, cur = start;
    for (;;) {
      const options = next.get(cur).filter((v) => v !== prev);
      if (!options.length) break;
      const nx = options[0];
      if (nx === start) break;
      if (used.has(nx)) break;              // a pinch: stop rather than spin
      loop.push(nx); used.add(nx); prev = cur; cur = nx;
    }
    loops.push(loop);
  }
  return loops;
}

/** Number of connected components of the boundary edge graph. Unlike walking
 *  the boundary, this is not fooled by a pinch (a face attached to the piece
 *  by one vertex), which splits a walk but not the boundary. */
export function boundaryComponents(sub) {
  const edges = edgeList(sub.faces);
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (let e = 0; e < edges.a.length; e++) {
    if (edges.count[e] !== 1) continue;
    const a = edges.a[e], b = edges.b[e];
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const roots = new Set();
  for (const v of parent.keys()) roots.add(find(v));
  return roots.size;
}

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
