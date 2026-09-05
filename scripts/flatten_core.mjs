/**
 * Flattening a patch of the avatar's skin to 2D — the engine behind a 2D pattern
 * draft. PATTERN_2D_DXF_PLAN.md records the numbers this design rests on.
 *
 * One objective, on purpose. A pattern piece is judged at its SEAM, not in its
 * middle: two pieces that meet must have equal seam length or they cannot be
 * sewn. So the solver holds boundary edges hard to their 3D length and lets only
 * the interior absorb the curvature — which is what fabric does. Measured on a
 * one-cup patch of this body it halves the seam error of a conformal (LSCM) or
 * as-rigid-as-possible layout, and neither of those needs to run first: from a
 * hinge unfolding this relaxation converges to the same minimum to 0.01mm.
 *
 * What it cannot do, and says so: a doubly curved patch has curvature that no
 * flattening removes (Gauss). The residual boundary error is reported per piece
 * so the reason a cup is cut into panels stays visible in the evidence; it is
 * never hidden by rescaling.
 *
 * Numerics are written out longhand (no hypot, no reductions whose order the
 * runtime chooses) because scripts/flatten.py is an independent port and the
 * parity gate compares the two to a fraction of a millimetre.
 *
 * Coordinates are metres. Meshes are flat arrays: positions [x,y,z,...],
 * faces [i,j,k,...]. The output `uv` is a flat [u,v,...] array in metres.
 */

export const DEFAULT_SOLVER = Object.freeze({
  interior_weight: 0.25,   // boundary edges weigh 1.0; the interior yields first
  max_iterations: 10000,
  convergence_m: 5e-9,     // stop when no vertex moved more than this in a sweep
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

/**
 * Turn a closed loop drawn on the skin into a patch of faces.
 *
 * The loop is resampled at `spacing` (below any edge length, so consecutive
 * samples cannot skip a face), each sample snapped to the mesh, and every face a
 * sample lands on becomes a barrier. A flood fill over edge-adjacent faces from
 * the seed's face stops at the barrier; the patch is the flood plus the barrier,
 * so the loop lies entirely inside it and can be mapped through the flattening.
 *
 * `closest` is a function p -> {point, normal, triangle} over the SAME soup the
 * mesh was welded from (scripts/surface_path.mjs closestOnMesh with its grid).
 * Declared limit: the patch boundary is the outer edge of the barrier faces, so
 * it overshoots the loop by up to one triangle (~10mm on this mesh); the exact
 * loop outline is what `mapLoopToFlat` returns.
 */
export function extractPatch(mesh, closest, loopPoints, seed, spacing = DEFAULT_LOOP_SPACING) {
  const P = mesh.positions, F = mesh.faces;
  const nf = F.length / 3;
  const samples = [];
  const barrier = new Set();
  const n = loopPoints.length;
  for (let s = 0; s < n; s++) {
    const A = loopPoints[s], B = loopPoints[(s + 1) % n];
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
    const chord = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const steps = Math.max(1, Math.ceil(chord / spacing));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const hit = closest([A[0] + dx * t, A[1] + dy * t, A[2] + dz * t]);
      if (!hit) return { error: 'loop sample found no surface' };
      const face = hit.triangle / 9;
      barrier.add(face);
      samples.push({ point: hit.point, face, bary: barycentric(P, F, face, hit.point) });
    }
  }
  const seedHit = closest(seed);
  if (!seedHit) return { error: 'seed found no surface' };
  const seedFace = seedHit.triangle / 9;
  if (barrier.has(seedFace)) return { error: 'the loop passes through the seed face' };

  // face adjacency across shared edges
  const edgeFaces = new Map();
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const i = F[f * 3 + k], j = F[f * 3 + ((k + 1) % 3)];
      const key = (i < j ? i : j) * 16777216 + (i < j ? j : i);
      let list = edgeFaces.get(key);
      if (!list) { list = []; edgeFaces.set(key, list); }
      list.push(f);
    }
  }
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
  const edgeFaces = new Map();
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const i = F[f * 3 + k], j = F[f * 3 + ((k + 1) % 3)];
      const key = (i < j ? i : j) * 16777216 + (i < j ? j : i);
      let list = edgeFaces.get(key);
      if (!list) { list = []; edgeFaces.set(key, list); }
      list.push(f);
    }
  }
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
 * Seam-exact relaxation. Every edge is a distance constraint to its 3D length;
 * boundary edges weigh 1.0 and interior edges `interior_weight`. Corrections are
 * accumulated over a whole sweep and applied together (Jacobi, not Gauss-Seidel),
 * so the result does not depend on edge order and the Python port can match it.
 */
export function relaxSeamExact(sub, uv, solver = DEFAULT_SOLVER) {
  const edges = edgeList(sub.faces);
  const rest = edgeLengths(sub.positions, edges);
  const m = edges.a.length;
  const w = new Array(m);
  for (let e = 0; e < m; e++) w[e] = edges.count[e] === 1 ? 1.0 : solver.interior_weight;
  const n = uv.length / 2;
  const U = uv.slice();
  const acc = new Array(n * 2), cw = new Array(n);
  let iterations = 0, converged = false;
  while (iterations < solver.max_iterations) {
    acc.fill(0); cw.fill(0);
    for (let e = 0; e < m; e++) {
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
    let maxMove = 0;
    for (let i = 0; i < n; i++) {
      if (cw[i] <= 0) continue;
      const mx = acc[i * 2] / cw[i], my = acc[i * 2 + 1] / cw[i];
      U[i * 2] += mx; U[i * 2 + 1] += my;
      const mv = Math.sqrt(mx * mx + my * my);
      if (mv > maxMove) maxMove = mv;
    }
    iterations++;
    if (maxMove < solver.convergence_m) { converged = true; break; }
  }
  return { uv: U, iterations, converged };
}

/** Hinge unfolding followed by seam-exact relaxation: the one flattening. */
export function flattenPatch(sub, solver = DEFAULT_SOLVER) {
  return relaxSeamExact(sub, hingeUnfold(sub), solver);
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

/** Everything the evidence file says about one flattened piece, in metres. */
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
  const loops = boundaryLoops(sub);
  const nv = P.length / 3, ne = edges.a.length, nfc = F.length / 3;
  return {
    vertex_count: nv, face_count: nfc, edge_count: ne,
    euler_characteristic: nv - ne + nfc,
    boundary_loop_count: loops.length,
    boundary_length_3d_m: b3, boundary_length_flat_m: b2, boundary_error_m: b2 - b3,
    worst_boundary_edge_error_m: worstB,
    interior_rms_error_m: nI ? Math.sqrt(sumSqI / nI) : 0,
    interior_rms_pct: nI ? 100 * Math.sqrt(sumSqPctI / nI) : 0,
    interior_max_pct: 100 * maxPctI,
    area_3d_m2: area3, area_flat_m2: area2, area_error_pct: area3 ? 100 * (area2 - area3) / area3 : 0,
    triangle_flips: flips,
  };
}

/** Where the drawn loop lands in the flat piece: each sample through the
 *  barycentric coordinates of the face it sat on. Also both lengths of the
 *  loop polyline, on the body and flat, since that — not the jagged mesh
 *  boundary — is the pen's measured seam. */
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
