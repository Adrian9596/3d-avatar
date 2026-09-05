/**
 * Mesh topology for the flattening engine: welding a triangle soup, edges,
 * face adjacency, edge-graph geodesics, sub-meshes and boundary structure.
 * Nothing here knows about seams or solvers. Port: scripts/flatten_mesh.py.
 *
 * Meshes are flat arrays: positions [x,y,z,...], faces [i,j,k,...], metres.
 */

export const DEFAULT_WELD_QUANTUM = 1e-6;   // 1µm: below float32 resolution here

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

export function edgeLengths(positions, edges) {
  const out = new Array(edges.a.length);
  for (let e = 0; e < edges.a.length; e++) {
    const i = edges.a[e] * 3, j = edges.b[e] * 3;
    const dx = positions[i] - positions[j], dy = positions[i + 1] - positions[j + 1], dz = positions[i + 2] - positions[j + 2];
    out[e] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return out;
}

export function edgeFaceMap(F) {
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
