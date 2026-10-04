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
import {cornerIndices} from "./corners.js";
import {edgeRange, isStraight} from "./deform.js";
import {pointInPoly} from "../../shared/geom.js";

const EPS = 1e-9;                    // mm — closer than this is one point
const ARC_TOL = 0.005;               // mm — how far a chord of a round join may fall inside the arc (half the export tolerance)
const BAND = 1e-6;                   // mm — a vertex of a parallel is d from the line to rounding; nearer or farther, it is in a loop
const LOOP = 1e-10;                   // mm — nearer than d by this much is inside the band: a loop to take out
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
/* The parallel of a polyline at signed distance sd (+ = left of the walk). First the RAW parallel: each segment moved d along
   its normal; where the line turns away from the side drawn on, an arc of radius d about the vertex (chords ≤ ARC_TOL inside
   it); where it turns towards it, the end of one moved segment is simply joined to the start of the next. That raw line
   crosses itself wherever the true parallel does not go — at every concave bend, and wherever a stretch of the line is
   nearer than d to another — and each crossing closes a loop. Then the walk (skipLoops): along the raw line, at each crossing
   whose loop lies inside the band (its first stretch nearer the line than d), jump to where the loop comes back. What is
   left is the set of points exactly d from the line, every vertex of it d to rounding. null: it cannot be done */
function offsetPolyline(pts, closed, sd){
  const n = pts.length, d = Math.abs(sd), segs = closed ? n : n - 1, U = [], N = [];
  for(let i = 0; i < segs; i++){
    const a = pts[i], b = pts[(i + 1) % n], L = hyp(a, b), u = [(b[0] - a[0])/L, (b[1] - a[1])/L];
    U.push(u); N.push([-u[1], u[0]]);
  }
  const moved = (p, k) => [p[0] + sd*N[k][0], p[1] + sd*N[k][1]];
  const step = 2*Math.acos(Math.max(-1, Math.min(1, 1 - ARC_TOL/d)));
  /* the raw line, and for the segment that leaves each of its points what that segment lies on — the moved source segment
     k (a line), the round join about a vertex (a circle of radius d), or a concave connector (on nothing: inside a loop) */
  const raw = [], on = [];
  const put = (q, tag) => { raw.push(q); on.push(tag); };
  const join = (i, kp, kn) => {
    const p = pts[i], up = U[kp], un = U[kn], A = moved(p, kp), B = moved(p, kn);
    const cr = up[0]*un[1] - up[1]*un[0], dt = up[0]*un[0] + up[1]*un[1];
    if(hyp(A, B) <= EPS){ put(A, {line: kn}); return; }                 // no bend: one point
    if(Math.sign(sd)*cr > 0){ put(A, {join: true}); put(B, {line: kn}); return; }   // concave: a loop the walk takes out
    const th = Math.atan2(cr, dt), a0 = Math.atan2(A[1] - p[1], A[0] - p[0]);
    const k = Math.max(1, Math.ceil(Math.abs(th)/step)), arcTag = {circle: p};
    put(A, arcTag);
    for(let j = 1; j < k; j++){ const a = a0 + th*j/k; put([p[0] + d*Math.cos(a), p[1] + d*Math.sin(a)], arcTag); }
    put(B, {line: kn});
  };
  if(closed) for(let i = 0; i < n; i++) join(i, (i - 1 + n) % n, i);
  else {
    put(moved(pts[0], 0), {line: 0});
    for(let i = 1; i < n - 1; i++) join(i, i - 1, i);
    put(moved(pts[n - 1], segs - 1), {end: true});
  }
  /* a stretch inside the band: nearer the line than d by more than rounding — a loop at a concave bend of 0.04° is only
     1.5e-6 mm deep (seen on the library), so the test is far finer than BAND, the tolerance the finished vertices are held to */
  const inside = q => footOn(pts, closed, q).dist < d - LOOP;
  /* where a crossing really is: on a moved segment AND on a round join's circle, not on the chord the circle is drawn with —
     a chord falls inside its arc by up to ARC_TOL, and a crossing found on it would be that much nearer the line than d */
  const lineOf = k => { const a = moved(pts[k], k); return {a, u: U[k]}; };
  const refine = (at, ta, tb) => {
    const L = [ta, tb].filter(t => t && t.line !== undefined).map(t => lineOf(t.line)), C = [ta, tb].filter(t => t && t.circle).map(t => t.circle);
    let cands = null;
    if(L.length === 1 && C.length === 1) cands = lineCircle(L[0].a, L[0].u, C[0], d);
    else if(C.length === 2) cands = circleCircle(C[0], C[1], d);
    if(!cands || !cands.length) return at;
    return cands.reduce((x, y) => hyp(x, at) <= hyp(y, at) ? x : y);
  };
  /* consecutive repeats out, each point keeping the tag of the segment that leaves it */
  let line = [], tags = [];
  raw.forEach((q, i) => { if(!line.length || hyp(q, line[line.length - 1]) > EPS){ line.push(q); tags.push(on[i]); } else tags[tags.length - 1] = on[i]; });
  if(closed) while(line.length > 1 && hyp(line[0], line[line.length - 1]) <= EPS){ line.pop(); tags.pop(); }
  if(closed){
    /* a ring is walked as an open line, from a point surely on the parallel round to that same point: the middle of the
       longest raw segment that is not inside the band — on a concave side every raw VERTEX is inside a loop */
    const m = line.length;
    let k = -1, best = -1;
    for(let i = 0; i < m; i++){
      const a = line[i], b = line[(i + 1) % m], L = hyp(a, b), mid = [(a[0] + b[0])/2, (a[1] + b[1])/2];
      if(L > best && !inside(mid)){ best = L; k = i; }
    }
    if(k < 0) return null;
    const a = line[k], b = line[(k + 1) % m], mid = [(a[0] + b[0])/2, (a[1] + b[1])/2];
    line = [mid, ...line.slice(k + 1), ...line.slice(0, k + 1), mid];
    tags = [tags[k], ...tags.slice(k + 1), ...tags.slice(0, k + 1), {end: true}];
  } else if(inside(line[0]) || inside(line[line.length - 1])) return {end: true};   // an end inside a loop (K3)
  const walked = skipLoops(line, inside, (at, i, j) => refine(at, tags[i], tags[j]));
  if(!walked) return null;
  let out = clean(closed ? walked.slice(0, -1) : walked, closed);
  /* the ring's starting point is the middle of a straight raw segment: not a vertex of the parallel, when it is still between
     its two neighbours on one straight line */
  if(closed && out.length > 3){
    const a = out[out.length - 1], q = out[0], b = out[1], L = hyp(a, b);
    if(L > EPS && Math.abs((b[0] - a[0])*(q[1] - a[1]) - (b[1] - a[1])*(q[0] - a[0]))/L <= 1e-9) out = out.slice(1);
  }
  return out.every(q => Math.abs(footOn(pts, closed, q).dist - d) <= BAND) ? out : null;
}
/* the points of the line through a along unit u that are r from c */
function lineCircle(a, u, c, r){
  const f = [a[0] - c[0], a[1] - c[1]], b = f[0]*u[0] + f[1]*u[1], q = f[0]*f[0] + f[1]*f[1] - r*r, disc = b*b - q;
  if(disc < 0) return [];
  const sq = Math.sqrt(disc);
  return [-b - sq, -b + sq].map(t => [a[0] + t*u[0], a[1] + t*u[1]]);
}
/* the points r from both c1 and c2 */
function circleCircle(c1, c2, r){
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1], D = Math.hypot(dx, dy);
  if(D <= EPS || D > 2*r) return [];
  const h = Math.sqrt(Math.max(0, r*r - D*D/4)), mx = c1[0] + dx/2, my = c1[1] + dy/2;
  return [[mx - h*dy/D, my + h*dx/D], [mx + h*dy/D, my - h*dx/D]];
}
/* every crossing of a polyline with itself (segments that do not share a vertex): events[i] = [{t, j, tj, at}] — swept along x */
function crossings(P){
  const m = P.length - 1, ev = Array.from({length: m}, () => []), order = [];
  for(let i = 0; i < m; i++) order.push([Math.min(P[i][0], P[i + 1][0]), Math.max(P[i][0], P[i + 1][0]), i]);
  order.sort((x, y) => x[0] - y[0]);
  const active = [];
  for(const [x0, x1, i] of order){
    for(let a = active.length - 1; a >= 0; a--) if(active[a][1] < x0 - 1e-9) active.splice(a, 1);
    for(const [, , j] of active){
      if(Math.abs(i - j) < 2) continue;
      const p = P[i], r = [P[i + 1][0] - p[0], P[i + 1][1] - p[1]], q = P[j], s = [P[j + 1][0] - q[0], P[j + 1][1] - q[1]];
      const den = r[0]*s[1] - r[1]*s[0];
      if(Math.abs(den) <= 1e-14*Math.hypot(...r)*Math.hypot(...s)) continue;            // parallel: no crossing point
      const t = ((q[0] - p[0])*s[1] - (q[1] - p[1])*s[0])/den, u = ((q[0] - p[0])*r[1] - (q[1] - p[1])*r[0])/den;
      if(t < -1e-12 || t > 1 + 1e-12 || u < -1e-12 || u > 1 + 1e-12) continue;
      const at = [p[0] + t*r[0], p[1] + t*r[1]];
      ev[i].push({t, j, tj: u, at}); ev[j].push({t: u, j: i, tj: t, at});
    }
    active.push([x0, x1, i]);
  }
  for(const e of ev) e.sort((x, y) => x.t - y.t);
  return ev;
}
/* Walk the raw line and leave out its loops that lie inside the band: at a crossing ahead, look at the stretch just after it
   on this segment — nearer the line than d means the loop from here to where it crosses back is not the parallel, so the walk
   jumps there. null when the walk does not end (a crossing structure it cannot follow) */
function skipLoops(P, inside, refine = at => at){
  const ev = crossings(P), m = P.length - 1, out = [P[0]];
  let i = 0, t0 = 0, guard = 0;
  while(i < m){
    if(++guard > 4*(m + 1) + 16) return null;
    const ahead = ev[i].filter(e => e.t > t0 + 1e-12 && e.j > i);
    let jumped = false;
    for(let k = 0; k < ahead.length && !jumped; k++){
      const e = ahead[k], next = k + 1 < ahead.length ? ahead[k + 1].t : 1, tm = (e.t + Math.min(next, 1))/2;
      const a = P[i], b = P[i + 1], q = [a[0] + (b[0] - a[0])*tm, a[1] + (b[1] - a[1])*tm];
      if(tm > e.t + 1e-12 ? inside(q) : false){ out.push(refine(e.at, i, e.j)); i = e.j; t0 = e.tj; jumped = true; }
    }
    if(!jumped){ out.push(P[i + 1]); i++; t0 = 0; }
  }
  return out;
}
/* a parallel that cannot be: a loop left, a ring turned inside out or shrunk to nothing — or a span between two vertices
   leaving [d − ARC_TOL, d] (construct.md K2), measured at a quarter, a half and three quarters of every span: the guard of
   that promise, not a way to keep it (on the library no accepted parallel comes near it) */
function folded(res, pts, closed, d){
  if(!res || res.length < (closed ? 3 : 2)) return true;
  if(closed){ const a0 = ringArea(pts), a1 = ringArea(res); if(Math.abs(a1) <= 1e-6 || Math.sign(a1) !== Math.sign(a0)) return true; }
  const n = res.length;
  for(let i = 0; i < n - (closed ? 0 : 1); i++){
    const a = res[i], b = res[(i + 1) % n];
    for(const k of [0.25, 0.5, 0.75]){
      const e = footOn(pts, closed, [a[0] + (b[0] - a[0])*k, a[1] + (b[1] - a[1])*k]).dist - d;
      if(e < -ARC_TOL - BAND || e > BAND) return true;
    }
  }
  return false;
}
const SHRINK = "đường song song co mất hay tự cắt — phía này cạnh cong gắt hơn khoảng cách (hay hẹp hơn hai lần khoảng cách); chọn khoảng ngắn hơn";
const END = "đường song song không bắt đầu được ở đầu cạnh — gần đầu, cạnh cong lấn vào dải cách d; chọn khoảng ngắn hơn";

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
  if(res && res.end) return refuse(END);
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
