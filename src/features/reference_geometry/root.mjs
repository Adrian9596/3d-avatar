/* --- the breast root on the skin ----------------------------------------------------
   The wire follows the breast root: the crease where the breast leaves the
   chest wall. It is read off the mesh as a valley, the skin's most concave line
   round the breast, and found on profiles about the apex.

   Mean curvature: at each vertex of the welded surface, half the cotangent
   Laplacian (over a third of the area of the faces round it) along the vertex
   normal, the average of the face normals weighted by their area. Positive is
   convex (a dome, the apex), negative concave (a valley, the root). A vertex on
   a cut of the surface (the armholes, the neck, the waist) has none.

   A profile about the apex, at an angle from straight down (0 deg; positive
   toward the outer side, negative toward the centre front): the skin cut by the
   plane through the apex that holds the forward direction and that direction
   across the body. It is followed away from the apex until it reaches the centre
   plane (past it is the other breast) or its farthest point from the apex in the
   profile's direction (past it the cut turns round the side of the body). Both
   ends are features of the cut, not a chosen length.

   The root on a profile is the profile's most concave point: least mean
   curvature, the curvature interpolated along each mesh edge the cut crosses,
   refined by the parabola through it and its two neighbours. A profile whose
   most concave point is not concave has no root; the root is the run of
   profiles with one that holds straight down, so it ends where the crease runs
   out (on this body toward the side, where the breast merges into the chest wall).

   Each profile's root is the one mesh edge its least value lands on, so the run
   steps by about half a mesh edge from one profile to the next; it is eased
   along the run, the distance along each profile from the apex moved a quarter of
   the way toward each neighbour's, and placed back on its own profile, so every
   sample stays on the skin. What the easing moved it is reported. ------------------ */

import { weld } from '../../core/flatten/flatten_mesh.mjs';

export const ROOT_STEP_DEG = 1;               // one profile per degree about the apex
export const ROOT_SEARCH_DEG = [-120, 150];   // profiles looked at, each side of straight down
export const ROOT_EASE_PASSES = 12;           // how many times the run is eased along itself

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const surfaces = new WeakMap();   // grid -> { positions, faces, curvature }
const roots = new WeakMap();      // grid -> Map(apex key -> root)

/** The welded surface of `grid` and its mean curvature at each vertex, per metre. */
export function surfaceCurvature(grid) {
  if (surfaces.has(grid)) return surfaces.get(grid);
  const { positions, faces } = weld(grid.tri);
  const n = positions.length / 3;
  const at = (i) => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  const lap = new Float64Array(3 * n), area = new Float64Array(n), normal = new Float64Array(3 * n);
  for (let f = 0; f < faces.length; f += 3) {
    const ids = [faces[f], faces[f + 1], faces[f + 2]];
    const x = ids.map(at);
    const fn = cross(sub(x[1], x[0]), sub(x[2], x[0]));
    const twice = Math.hypot(fn[0], fn[1], fn[2]);
    if (!(twice > 0)) continue;
    for (let k = 0; k < 3; k++) {
      area[ids[k]] += twice / 6;
      for (let c = 0; c < 3; c++) normal[3 * ids[k] + c] += fn[c];
      // the angle at corner k weights the edge opposite it
      const o = x[k], a = x[(k + 1) % 3], b = x[(k + 2) % 3];
      const cot = dot(sub(a, o), sub(b, o)) / Math.hypot(...cross(sub(a, o), sub(b, o)));
      const [ia, ib] = [ids[(k + 1) % 3], ids[(k + 2) % 3]];
      for (let c = 0; c < 3; c++) {
        lap[3 * ia + c] += 0.5 * cot * (b[c] - a[c]);
        lap[3 * ib + c] += 0.5 * cot * (a[c] - b[c]);
      }
    }
  }
  // a vertex on a cut of the surface (an edge only one face uses) has no curvature to read:
  // the Laplacian there is lopsided, so it is left out (NaN is never concave)
  const uses = new Map();
  for (let f = 0; f < faces.length; f += 3) for (let k = 0; k < 3; k++) {
    const [i, j] = [faces[f + k], faces[f + ((k + 1) % 3)]], e = i < j ? `${i},${j}` : `${j},${i}`;
    uses.set(e, (uses.get(e) || 0) + 1);
  }
  const onCut = new Uint8Array(n);
  for (const [e, count] of uses) if (count === 1) for (const i of e.split(',')) onCut[+i] = 1;
  const curvature = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!(area[i] > 0) || onCut[i]) continue;
    const nv = unit([normal[3 * i], normal[3 * i + 1], normal[3 * i + 2]]);
    curvature[i] = -0.5 * (lap[3 * i] * nv[0] + lap[3 * i + 1] * nv[1] + lap[3 * i + 2] * nv[2]) / area[i];
  }
  const surface = { positions, faces, curvature };
  surfaces.set(grid, surface);
  return surface;
}

/* The profile about the apex at `deg`: the cut's crossings of mesh edges, from
   the apex outward, each with its point, the mean curvature there and the
   distance walked from the apex. Null if the cut does not pass the apex. */
function profile(surface, apex, sgn, deg) {
  const { positions, faces, curvature } = surface;
  const th = (deg * Math.PI) / 180;
  const across = unit([sgn * Math.sin(th), -Math.cos(th), 0]);
  const plane = unit(cross([0, 0, 1], across));
  const side = (i) => (positions[3 * i] - apex[0]) * plane[0] + (positions[3 * i + 1] - apex[1]) * plane[1] + (positions[3 * i + 2] - apex[2]) * plane[2];
  // each crossed edge is a node; each face the cut passes through joins two of them
  const nodes = new Map();
  const node = (i, j, di, dj) => {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (!nodes.has(key)) {
      const s = di / (di - dj);
      const p = [0, 1, 2].map((c) => positions[3 * i + c] + (positions[3 * j + c] - positions[3 * i + c]) * s);
      nodes.set(key, { key, p, h: curvature[i] + (curvature[j] - curvature[i]) * s, next: [] });
    }
    return nodes.get(key);
  };
  for (let f = 0; f < faces.length; f += 3) {
    const ids = [faces[f], faces[f + 1], faces[f + 2]], d = ids.map(side);
    if ((d[0] > 0 && d[1] > 0 && d[2] > 0) || (d[0] <= 0 && d[1] <= 0 && d[2] <= 0)) continue;
    const hits = [];
    for (let k = 0; k < 3; k++) {
      const [a, b] = [k, (k + 1) % 3];
      if ((d[a] > 0) !== (d[b] > 0)) hits.push(node(ids[a], ids[b], d[a], d[b]));
    }
    if (hits.length === 2) { hits[0].next.push(hits[1]); hits[1].next.push(hits[0]); }
  }
  let start = null, near = Infinity;
  for (const nd of nodes.values()) {
    const g = Math.hypot(...sub(nd.p, apex));
    if (g < near) { near = g; start = nd; }
  }
  if (!start) return null;
  // away from the apex: first toward the profile's direction, then along the cut
  const reach = (p) => dot(sub(p, apex), across);
  const walk = [start];
  const seen = new Set([start.key]);
  let cur = start.next.filter((nd) => !seen.has(nd.key)).sort((a, b) => reach(b.p) - reach(a.p))[0];
  while (cur) {
    seen.add(cur.key);
    if (cur.p[0] * sgn <= 0) {
      // the centre plane: end on it
      const prev = walk[walk.length - 1], f = prev.p[0] / (prev.p[0] - cur.p[0]);
      walk.push({ p: [0, prev.p[1] + (cur.p[1] - prev.p[1]) * f, prev.p[2] + (cur.p[2] - prev.p[2]) * f], h: prev.h + (cur.h - prev.h) * f, centre: true });
      break;
    }
    walk.push(cur);
    cur = cur.next.find((nd) => !seen.has(nd.key));
  }
  // up to its farthest point from the apex in its direction
  let far = 0;
  for (let i = 1; i < walk.length; i++) if (reach(walk[i].p) > reach(walk[far].p)) far = i;
  const pts = walk.slice(0, far + 1);
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(...sub(pts[i].p, pts[i - 1].p)));
  return { deg, pts, s, centre: !!pts[pts.length - 1].centre };
}

// The point `d` along a profile from the apex.
function alongProfile(pr, d) {
  const { pts, s } = pr;
  if (d <= 0) return pts[0].p.slice();
  for (let i = 1; i < pts.length; i++) {
    if (s[i] >= d) {
      const f = (d - s[i - 1]) / (s[i] - s[i - 1] || 1);
      return pts[i - 1].p.map((v, c) => v + (pts[i].p[c] - v) * f);
    }
  }
  return pts[pts.length - 1].p.slice();
}

/* A profile's most concave point: the least curvature, refined by the parabola
   through it and its neighbours (in distance along the profile). Null if it is
   not concave. */
function concavest(pr) {
  const { pts, s } = pr;
  // the first concave stretch out from the apex, and its least point
  let k = 1;
  while (k < pts.length && !(pts[k].h < 0)) k++;
  if (k >= pts.length) return null;
  let i = k;
  for (; k < pts.length && pts[k].h < 0; k++) if (pts[k].h < pts[i].h) i = k;
  let d = s[i], h = pts[i].h;
  if (i > 0 && i < pts.length - 1) {
    const [x0, x1, x2] = [s[i - 1], s[i], s[i + 1]], [y0, y1, y2] = [pts[i - 1].h, pts[i].h, pts[i + 1].h];
    const den = (x0 - x1) * (x0 - x2) * (x1 - x2);
    const A = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / den;
    const B = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / den;
    if (A > 0) {
      d = Math.max(x0, Math.min(x2, -B / (2 * A)));
      h = y1 + (A * (d - x1) * (d - x1)) + (2 * A * x1 + B) * (d - x1);
    }
  }
  return { d, h };
}

/** The breast root about `apex` on the side `side` ('L' is x < 0): its samples
 *  in order of angle about the apex, from the centre-front end to the outer end,
 *  each { deg, point, curvature, along_m (from the apex, eased), raw_point,
 *  moved_m (how far the easing moved it along its profile) }, or { blocked } when
 *  the profile straight below the apex has no concave point. */
export function breastRoot(grid, apex, side) {
  if (!roots.has(grid)) roots.set(grid, new Map());
  const key = `${side}:${apex.join(',')}`;
  const memo = roots.get(grid);
  if (memo.has(key)) return memo.get(key);
  const surface = surfaceCurvature(grid);
  const sgn = side === 'L' ? -1 : 1;
  const found = [];
  for (let deg = ROOT_SEARCH_DEG[0]; deg <= ROOT_SEARCH_DEG[1]; deg += ROOT_STEP_DEG) {
    const pr = profile(surface, apex, sgn, deg);
    const low = pr && concavest(pr);
    found.push(low ? { deg, pr, ...low } : { deg, pr: null });
  }
  // the run of profiles with a root that holds straight down
  const zero = found.findIndex((f) => f.deg === 0);
  let lo = zero, hi = zero;
  if (!found[zero].pr) {
    const out = { blocked: `no concave crease below BUST_APEX_${side}` };
    memo.set(key, out);
    return out;
  }
  while (lo > 0 && found[lo - 1].pr) lo--;
  while (hi < found.length - 1 && found[hi + 1].pr) hi++;
  const run = found.slice(lo, hi + 1);
  // eased along the run: the distance from the apex on each profile
  let d = run.map((r) => r.d);
  for (let pass = 0; pass < ROOT_EASE_PASSES; pass++) {
    const was = d;
    d = was.map((v, i) => (i === 0 || i === was.length - 1 ? v : (was[i - 1] + 2 * v + was[i + 1]) / 4));
  }
  const samples = run.map((r, i) => ({
    deg: r.deg, point: alongProfile(r.pr, d[i]), curvature: r.h, along_m: d[i],
    raw_point: alongProfile(r.pr, r.d), moved_m: Math.abs(d[i] - r.d), at_centre: r.pr.centre && d[i] >= r.pr.s[r.pr.s.length - 1] - 1e-9,
  }));
  const out = { blocked: null, side, apex: apex.slice(), samples, span_deg: [run[0].deg, run[run.length - 1].deg] };
  memo.set(key, out);
  return out;
}
