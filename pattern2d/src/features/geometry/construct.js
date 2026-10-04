/* The smart pen's constructions (spec: construct.md, K1–K6) — the edges of a line, the parallel of an edge, the compass,
   the two rulers and the offset point. What the Bút tool (features/draw/smartpen.md) draws with; nothing here knows a
   pixel, a zoom or the Canvas (§5.17), and nothing handed in is changed.

   Millimetres, y up, angles counter-clockwise from +X. A parallel here is the SET of points d from the line (its Minkowski
   boundary): an arc of radius d about a vertex where the line bends away from the side drawn on, the meeting of the two
   parallels where it bends towards it — so every vertex of it is exactly d from the line. The "miter" offset of ops.js
   (the Geom tool's seam line) stands d / cos(θ/2) off at a convex bend; that is not a parallel a pattern maker can type a
   number for, so it is not used here. */
import {point, arc, curve, closestPoint, sample} from "./model.js";
import {intersect as meet} from "./intersect.js";
import {prune} from "./ops.js";
import {cornerIndices} from "./corners.js";
import {edgeRange, isStraight} from "./deform.js";
import {pointInPoly} from "../../shared/geom.js";

const EPS = 1e-9;                    // mm — closer than this is one point
const ARC_TOL = 0.005;               // mm — how far a chord of a round join may fall inside the arc (half the export tolerance)
const KEEP = 0.01;                   // mm — a vertex this much nearer than d is a parallel that has folded over itself
const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const finite = v => typeof v === "number" && Number.isFinite(v);
const refuse = reason => ({ok: false, reason});

/* ── K1 the edges of a polyline ────────────────────────────────────────────────────
   Split at the corners Edges and Edit split at (corners.js); an open line's ends are corners; a ring with fewer than two
   corners is one edge all the way round */
export function polylineEdges(pts, closed){
  const n = pts.length;
  if(n < 2) return [];
  const cs = cornerIndices(pts, closed).slice().sort((x, y) => x - y);
  if(closed && cs.length < 2){
    const a = cs.length ? cs[0] : 0;
    return [{a, b: a, closed: true, pts: Array.from({length: n}, (_, i) => pts[(a + i) % n])}];
  }
  const pairs = closed ? cs.map((a, j) => [a, cs[(j + 1) % cs.length]]) : cs.slice(0, -1).map((a, j) => [a, cs[j + 1]]);
  return pairs.map(([a, b]) => ({a, b, closed: false, pts: edgeRange(n, closed, a, b).map(i => pts[i])}));
}
/* the foot of w on a polyline, with the segment it falls on — a plain loop */
function footOn(pts, closed, w){
  let best = null;
  const n = pts.length;
  for(let i = 0; i < n - (closed ? 0 : 1); i++){
    const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], dd = dx*dx + dy*dy;
    const t = dd ? Math.max(0, Math.min(1, ((w[0] - a[0])*dx + (w[1] - a[1])*dy)/dd)) : 0;
    const f = [a[0] + dx*t, a[1] + dy*t], dist = hyp(w, f);
    if(!best || dist < best.dist) best = {dist, foot: f, seg: i};
  }
  return best;
}
/* the edge nearest w: {index, edge, dist, foot}; a tie goes to the edge listed first */
export function nearestEdge(edges, w){
  let best = null;
  edges.forEach((edge, index) => {
    const f = footOn(edge.pts, !!edge.closed, w);
    if(f && (!best || f.dist < best.dist)) best = {index, edge, dist: f.dist, foot: f.foot};
  });
  return best;
}

/* ── K2 · K3 the parallel ─────────────────────────────────────────────────────────── */
const ringArea = pts => pts.reduce((s, q, i) => { const r = pts[(i + 1) % pts.length]; return s + q[0]*r[1] - r[0]*q[1]; }, 0)/2;
/* consecutive repeats out — and, on a ring, a last vertex back on the first */
function clean(pts, closed){
  const out = [];
  for(const p of pts) if(!out.length || hyp(p, out[out.length - 1]) > EPS) out.push([p[0], p[1]]);
  while(closed && out.length > 1 && hyp(out[0], out[out.length - 1]) <= EPS) out.pop();
  return out;
}
/* The parallel of a polyline at signed distance sd (+ = left of the walk): each segment moved along its normal, joined at
   every vertex — where the line turns towards the side drawn on, at the meeting of the two moved segments; where it turns
   away, by an arc of radius d about the vertex, cut into chords that fall at most ARC_TOL inside it. Loops a tight concave
   bend makes are taken out by prune (ops.js): their vertices are nearer the line than d */
function offsetPolyline(pts, closed, sd){
  const n = pts.length, d = Math.abs(sd), segs = closed ? n : n - 1, U = [], N = [];
  for(let i = 0; i < segs; i++){
    const a = pts[i], b = pts[(i + 1) % n], L = hyp(a, b), u = [(b[0] - a[0])/L, (b[1] - a[1])/L];
    U.push(u); N.push([-u[1], u[0]]);
  }
  const moved = (p, k) => [p[0] + sd*N[k][0], p[1] + sd*N[k][1]];
  const step = 2*Math.acos(Math.max(-1, Math.min(1, 1 - ARC_TOL/d)));
  const out = [];
  const join = (i, kp, kn) => {
    const p = pts[i], up = U[kp], un = U[kn], A = moved(p, kp), B = moved(p, kn);
    const cr = up[0]*un[1] - up[1]*un[0], dt = up[0]*un[0] + up[1]*un[1];
    if(hyp(A, B) <= EPS){ out.push(A); return; }                        // no bend: one point
    if(Math.sign(sd)*cr > 0){                                             // bends towards the side: the two parallels meet
      const t = ((B[0] - A[0])*un[1] - (B[1] - A[1])*un[0])/cr;
      out.push([A[0] + t*up[0], A[1] + t*up[1]]);
      return;
    }
    const th = Math.atan2(cr, dt), a0 = Math.atan2(A[1] - p[1], A[0] - p[0]);
    const k = Math.max(1, Math.ceil(Math.abs(th)/step));
    out.push(A);
    for(let j = 1; j < k; j++){ const a = a0 + th*j/k; out.push([p[0] + d*Math.cos(a), p[1] + d*Math.sin(a)]); }
    out.push(B);
  };
  if(closed) for(let i = 0; i < n; i++) join(i, (i - 1 + n) % n, i);
  else {
    out.push(moved(pts[0], 0));
    for(let i = 1; i < n - 1; i++) join(i, i - 1, i);
    out.push(moved(pts[n - 1], segs - 1));
  }
  const raw = clean(out, closed);
  return clean(prune(raw, curve(pts, closed), d, {tol: 1e-6, min: closed ? 3 : 2}), closed);
}
/* a cut through a parallel that has folded over: a vertex nearer the line than d, or a ring turned inside out */
function folded(res, pts, closed, d){
  if(res.length < (closed ? 3 : 2)) return true;
  if(res.some(p => footOn(pts, closed, p).dist < d - KEEP)) return true;
  if(closed){ const a0 = ringArea(pts), a1 = ringArea(res); return Math.abs(a1) <= 1e-6 || Math.sign(a1) !== Math.sign(a0); }
  return false;
}
const SHRINK = "đường song song co mất — phía trong hẹp hơn hai lần khoảng cách (hay bán kính nhỏ hơn); chọn khoảng ngắn hơn";

/* src: {pts, closed} · {arc: {c, r, a0, a1, ccw}} · {circle: {c, r}} — c as [x, y]. w: the pointer (its side, and the
   distance when d is null). → {ok, kind: "line" | "polyline" | "ring" | "arc" | "circle", pts | arc | circle, d, side} or
   {ok: false, reason} */
export function parallelOf(src, w, d = null){
  if(src && (src.circle || src.arc)) return roundParallel(src, w, d);
  const pts = clean((src && src.pts) || [], !!(src && src.closed));
  if(pts.length < 2) return refuse("đường song song cần một đường có ít nhất 2 điểm");
  const closed = !!src.closed && pts.length >= 3;
  const f = footOn(pts, closed, w);
  const dd = d === null || d === undefined ? f.dist : d;
  if(!(finite(dd) && dd > EPS)) return refuse("đường song song cách 0 — kéo con trỏ ra xa cạnh, hay gõ Cách");
  if(f.dist <= EPS) return refuse("con trỏ nằm trên cạnh — không biết song song về phía nào; kéo ra phía cần song song");
  let s, side;
  if(closed){
    const inside = pointInPoly(pts, w), ccw = ringArea(pts) > 0;
    s = inside === ccw ? 1 : -1; side = inside ? "in" : "out";
  } else {
    const a = pts[f.seg], b = pts[f.seg + 1];
    const cr = (b[0] - a[0])*(w[1] - f.foot[1]) - (b[1] - a[1])*(w[0] - f.foot[0]);
    s = cr > 0 ? 1 : -1; side = cr > 0 ? "left" : "right";
  }
  if(!closed && isStraight(pts, 0.01)){
    const a = pts[0], b = pts[pts.length - 1], L = hyp(a, b), nx = -(b[1] - a[1])/L, ny = (b[0] - a[0])/L, k = s*dd;
    return {ok: true, kind: "line", pts: [[a[0] + k*nx, a[1] + k*ny], [b[0] + k*nx, b[1] + k*ny]], d: dd, side};
  }
  const res = offsetPolyline(pts, closed, s*dd);
  if(folded(res, pts, closed, dd)) return refuse(SHRINK);
  return {ok: true, kind: closed ? "ring" : "polyline", pts: res, d: dd, side};
}
function roundParallel(src, w, d){
  const g = src.circle || src.arc, c = g.c, r = g.r;
  const shape = src.circle ? arc(point(c[0], c[1]), r, 0, 2*Math.PI, true) : arc(point(c[0], c[1]), r, g.a0, g.a1, g.ccw);
  const gap = closestPoint(shape, point(w[0], w[1])).dist, inside = hyp(w, c) < r;
  const dd = d === null || d === undefined ? gap : d;
  if(!(finite(dd) && dd > EPS)) return refuse("đường song song cách 0 — kéo con trỏ ra xa cạnh, hay gõ Cách");
  if(gap <= EPS) return refuse("con trỏ nằm trên cạnh — không biết song song về phía nào; kéo ra phía cần song song");
  const r2 = inside ? r - dd : r + dd;
  if(!(r2 > EPS)) return refuse(`${SHRINK} (bán kính ${r.toFixed(2)} mm)`);
  const side = inside ? "in" : "out";
  return src.circle ? {ok: true, kind: "circle", circle: {c: [c[0], c[1]], r: r2}, d: dd, side}
                    : {ok: true, kind: "arc", arc: {c: [c[0], c[1]], r: r2, a0: g.a0, a1: g.a1, ccw: g.ccw}, d: dd, side};
}

/* ── K4 the compass ────────────────────────────────────────────────────────────────
   Where the circle of radius R about c meets the shapes — the meeting nearest `near`. A spline meets as a polyline sampled
   to 0.001 mm, as Edit's trim / extend does (edit.md D15). Refused with the nearest and farthest the shapes come to c */
export function compassPoint(c, R, shapes, near){
  if(!(finite(R) && R > 0)) return {ok: false, reason: `bán kính compa không hợp lệ: ${R} — cần một độ dài > 0`};
  const circle = arc(point(c[0], c[1]), R, 0, 2*Math.PI, true), at = point(c[0], c[1]), hits = [];
  let nearest = Infinity, farthest = 0;
  for(const s0 of shapes){
    const s = s0.kind === "spline" ? curve(sample(s0, 0.001), false) : s0;
    for(const h of meet(circle, s)) hits.push([h.x, h.y]);
    nearest = Math.min(nearest, closestPoint(s0, at).dist);
    for(const q of sample(s, 0.001)) farthest = Math.max(farthest, hyp(q, c));
  }
  if(!hits.length) return {ok: false, nearest, farthest,
    reason: `compa bán kính ${R.toFixed(2)} mm không tới đường — đường cách điểm từ ${nearest.toFixed(2)} tới ${farthest.toFixed(2)} mm`};
  let best = hits[0];
  for(const h of hits) if(hyp(h, near) < hyp(best, near)) best = h;
  return {ok: true, point: best, hits};
}

/* ── K5 the rulers ───────────────────────────────────────────────────────────────── */
const S = Math.SQRT1_2;
/* the T-square: level, plumb and 45°, counter-clockwise from +X — the axes exactly 0 and ±1 */
export const TSQUARE_DIRS = Object.freeze([[1, 0], [S, S], [0, 1], [-S, S], [-1, 0], [-S, -S], [0, -1], [S, -S]].map(Object.freeze));
/* the set square on A → B: along it, against it, and the two at right angles (AB turned +90°, then −90°) */
export function squareDirs(a, b){
  const L = hyp(a, b);
  if(!(L > EPS)) throw new Error("thước tam giác: A trùng B — kéo từ A tới một điểm B khác");
  const u = [(b[0] - a[0])/L, (b[1] - a[1])/L];
  return [u, [-u[0], -u[1]], [-u[1], u[0]], [u[1], -u[0]]];
}
/* the direction of `dirs` nearest the way from prev to cursor (a tie: the one listed first), and the point that far along
   it — the cursor's projection, or `len`. null when that is no length */
export function lockTo(prev, cursor, dirs, len = null){
  const v = [cursor[0] - prev[0], cursor[1] - prev[1]];
  let index = -1, best = -Infinity;
  dirs.forEach((u, i) => { const t = v[0]*u[0] + v[1]*u[1]; if(t > best){ best = t; index = i; } });
  const L = len === null || len === undefined ? best : len;
  if(!(L > EPS)) return null;
  const u = dirs[index];
  return {index, dir: u, point: [prev[0] + L*u[0], prev[1] + L*u[1]]};
}

/* ── K6 the offset point ─────────────────────────────────────────────────────────── */
export function offsetPoint(p, dx, dy){
  if(!finite(dx) || !finite(dy)) throw new Error(`độ lệch không hợp lệ: ${dx}, ${dy} — cần hai số (mm)`);
  return [p[0] + dx, p[1] + dy];
}
