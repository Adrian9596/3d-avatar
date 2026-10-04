/* The outline of a new piece: turn points and curve points (spec: sketch.md §7, O1–O12).

   A pattern maker places TURN points (corners) and CURVE points (points the curve goes THROUGH) —
   what layers 2 and 3 of an AAMA file mean, and how Gerber, Lectra and Richpeace define a curve.
   Between two turn points side by side the outline is a straight line, exactly. A run of curve points
   between two turn points is one smooth curve through every one of them: a centripetal Catmull–Rom
   spline (α = 0.5 — it never loops or overshoots where the points are unevenly spaced), turned into
   one cubic Bezier per span; at the turn point that ends a run the missing neighbour is its mirror
   image, so the curve leaves the corner heading for the next curve point. A ring of curve points only
   has nothing to stop it and wraps round.

   Millimetres, y up. Pure functions on {pts, kinds}: nothing is changed in place, so undo is keeping
   a reference. Nothing here knows about pixels or zoom (§5.17). */
import {point, line, curve, length, sample, pointAt, closestPoint} from "./model.js";
import {spline, bezier} from "./spline.js";
import {chain} from "./path.js";

export const OUTLINE_KINDS = ["turn", "curve"];

const EPS = 1e-9;                   // mm — closer than this is "the same point"
const finite = v => typeof v === "number" && Number.isFinite(v);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mirror = (p, q) => [2*p[0] - q[0], 2*p[1] - q[1]];          // q reflected through p

/* ≥ 3 finite points, consecutive ones (last → first too) apart, one kind each — copied, never shared (O1) */
export function checkOutline(pts, kinds){
  if(!Array.isArray(pts) || pts.length < 3) throw new Error(`đường viền cần ít nhất 3 điểm, nhận ${Array.isArray(pts) ? pts.length : pts}`);
  if(!Array.isArray(kinds) || kinds.length !== pts.length)
    throw new Error(`loại điểm: cần ${pts.length} (một mỗi điểm), nhận ${Array.isArray(kinds) ? kinds.length : kinds}`);
  const P = pts.map((p, i) => {
    if(!Array.isArray(p) || p.length < 2 || !finite(p[0]) || !finite(p[1])) throw new Error(`điểm ${i} không hợp lệ: ${JSON.stringify(p)} — cần [x, y] là số hữu hạn (mm)`);
    return [p[0], p[1]];
  });
  kinds.forEach((k, i) => { if(!OUTLINE_KINDS.includes(k)) throw new Error(`loại điểm ${i} không hợp lệ: "${k}" — chỉ có turn · curve`); });
  for(let i = 0; i < P.length; i++){
    const j = (i + 1) % P.length;
    if(dist(P[i], P[j]) <= EPS) throw new Error(`điểm ${i} trùng điểm ${j} — hai điểm liền nhau phải khác nhau`);
  }
  return {pts: P, kinds: kinds.slice()};
}

/* the indices of the turn points, in order */
export const outlineTurns = kinds => kinds.map((k, i) => k === "turn" ? i : -1).filter(i => i >= 0);

/* One segment per pair of neighbours, closing the ring: {kind: "line", ctrl: [a, b]} between two turn
   points, else {kind: "bezier", ctrl: [a, c1, c2, b]} — the Catmull–Rom span as a cubic Bezier. The end
   points are the placed points themselves, bit for bit (O3). */
export function outlineSegments(pts, kinds){
  const o = checkOutline(pts, kinds), P = o.pts, K = o.kinds, n = P.length;
  const at = k => P[((k % n) + n) % n], kind = k => K[((k % n) + n) % n];
  const allCurve = K.every(k => k === "curve");
  const segs = [];
  for(let i = 0; i < n; i++){
    const P1 = at(i), P2 = at(i + 1);
    if(!allCurve && kind(i) === "turn" && kind(i + 1) === "turn"){ segs.push({kind: "line", from: i, to: (i + 1) % n, ctrl: [P1, P2]}); continue; }
    const P0 = allCurve || kind(i) === "curve" ? at(i - 1) : mirror(P1, P2);
    const P3 = allCurve || kind(i + 1) === "curve" ? at(i + 2) : mirror(P2, P1);
    segs.push({kind: "bezier", from: i, to: (i + 1) % n, ctrl: span(P0, P1, P2, P3)});
  }
  return segs;
}
/* The centripetal Catmull–Rom span P1 → P2 as a cubic Bezier. The knots step by √|ΔP|; the tangents at
   the two ends are those of the Barry–Goldman pyramid (Yuksel, Schaefer & Keyser 2011):
     m1 = (P1−P0)/(t1−t0) − (P2−P0)/(t2−t0) + (P2−P1)/(t2−t1)
     m2 = (P2−P1)/(t2−t1) − (P3−P1)/(t3−t1) + (P3−P2)/(t3−t2)
   and the Bezier of a cubic with those end derivatives on [t1, t2] has its inner points a third of the
   span along them. The pyramid itself is a cubic in t, so this is the same curve, not an approximation. */
function span(P0, P1, P2, P3){
  const d01 = Math.sqrt(dist(P0, P1)), d12 = Math.sqrt(dist(P1, P2)), d23 = Math.sqrt(dist(P2, P3));
  const t1 = d01, t2 = t1 + d12, t3 = t2 + d23;                  // t0 = 0
  const h = (t2 - t1)/3;
  const m1 = [0, 1].map(j => (P1[j] - P0[j])/t1 - (P2[j] - P0[j])/t2 + (P2[j] - P1[j])/(t2 - t1));
  const m2 = [0, 1].map(j => (P2[j] - P1[j])/(t2 - t1) - (P3[j] - P1[j])/(t3 - t1) + (P3[j] - P2[j])/(t3 - t2));
  return [P1, [P1[0] + m1[0]*h, P1[1] + m1[1]*h], [P2[0] - m2[0]*h, P2[1] - m2[1]*h], P2];
}

/* the exact kernel shape: turn points only → a closed polyline (like a Rectangle); otherwise one
   cubic NURBS made of the segments, a straight one written with its inner points on the chord */
export function outlineShape(pts, kinds){
  const segs = outlineSegments(pts, kinds);
  if(segs.every(s => s.kind === "line")) return curve(segs.map(s => s.ctrl[0]), true);
  const ctrl = [segs[0].ctrl[0]];
  for(const s of segs){
    if(s.kind === "bezier") ctrl.push(s.ctrl[1], s.ctrl[2], s.ctrl[3]);
    else { const [a, b] = s.ctrl; ctrl.push([a[0] + (b[0] - a[0])/3, a[1] + (b[1] - a[1])/3], [a[0] + 2*(b[0] - a[0])/3, a[1] + 2*(b[1] - a[1])/3], b); }
  }
  const n = segs.length, knots = [0, 0, 0, 0];
  for(let k = 1; k < n; k++) knots.push(k, k, k);
  knots.push(n, n, n, n);
  return spline({degree: 3, knots, ctrl});
}

const segLength = s => s.kind === "line" ? dist(s.ctrl[0], s.ctrl[1]) : length(bezier(s.ctrl));
/* The outline as a path (path.js): one Line or cubic Bezier per segment, in ring order — what a distance along
   it is measured on (a notch from a corner, O17). Its corners are the turn points. opts go to chain(): the
   segments meet bit for bit (O3), so a tolerance far under the CAD gap tells a strip 0.05 mm wide from two
   edges drawn on one another (piece.md M16) */
export const outlineChain = (pts, kinds, opts) =>
  chain(outlineSegments(pts, kinds).map(s => s.kind === "line" ? line(point(s.ctrl[0][0], s.ctrl[0][1]), point(s.ctrl[1][0], s.ctrl[1][1])) : bezier(s.ctrl)), opts);
/* the perimeter: straight segments by distance, curved ones by the kernel's converged integral (O7) */
export function outlineLength(pts, kinds){ return outlineSegments(pts, kinds).reduce((s, x) => s + segLength(x), 0); }

/* The signed area, ½∮(x dy − y dx): a straight segment by its cross product, a cubic by three-point
   Gauss–Legendre, which is exact for the degree-5 polynomial x·y' − y·x' of a cubic. Positive when
   the ring runs counter-clockwise (O7). */
const GL3 = [[-Math.sqrt(3/5), 5/9], [0, 8/9], [Math.sqrt(3/5), 5/9]];
export function outlineArea(pts, kinds){
  let a = 0;
  for(const s of outlineSegments(pts, kinds)){
    if(s.kind === "line"){ const [p, q] = s.ctrl; a += p[0]*q[1] - q[0]*p[1]; continue; }
    const P = s.ctrl;
    for(const [x, w] of GL3){
      const t = (x + 1)/2, u = 1 - t;
      const b = [u*u*u, 3*u*u*t, 3*u*t*t, t*t*t], d = [3*u*u, 6*u*t, 3*t*t];
      const X = b[0]*P[0][0] + b[1]*P[1][0] + b[2]*P[2][0] + b[3]*P[3][0], Y = b[0]*P[0][1] + b[1]*P[1][1] + b[2]*P[2][1] + b[3]*P[3][1];
      const dX = d[0]*(P[1][0] - P[0][0]) + d[1]*(P[2][0] - P[1][0]) + d[2]*(P[3][0] - P[2][0]);
      const dY = d[0]*(P[1][1] - P[0][1]) + d[1]*(P[2][1] - P[1][1]) + d[2]*(P[3][1] - P[2][1]);
      a += w/2*(X*dY - Y*dX);                                     // dt = dx/2 on [−1, 1] → [0, 1]
    }
  }
  return a/2;
}

/* The edges a seam is measured along: the runs between two turn points in a row — or the whole ring
   when there is no turn point — with their lengths (O12, CLAUDE.md §5.9). */
export function outlineEdges(pts, kinds){
  const segs = outlineSegments(pts, kinds), n = segs.length, turns = outlineTurns(kinds);
  if(!turns.length) return [{from: 0, to: 0, segments: segs.map((_, i) => i), length: segs.reduce((s, x) => s + segLength(x), 0)}];
  return turns.map((from, k) => {
    const to = turns[(k + 1) % turns.length], idx = [];
    for(let i = from; idx.length < n; i = (i + 1) % n){ idx.push(i); if((i + 1) % n === to) break; }
    return {from, to, segments: idx, length: idx.reduce((s, i) => s + segLength(segs[i]), 0)};
  });
}

/* The polyline Xuất DXF writes (O11): every placed point is a vertex, bit for bit; a straight segment
   adds nothing between its ends; a curved one adds the samples that keep it within `tol` (a spline is
   sampled against its midpoints, so twice as fine — as dxf/write.js does). `turn[k]` says which
   vertices are turn points (layer 2 of the file); every other vertex is a curve point (layer 3). */
export function outlineSample(pts, kinds, tol = 0.01){
  const segs = outlineSegments(pts, kinds), out = [], turn = [];
  const allCurve = kinds.every(k => k === "curve");
  for(const s of segs){
    const a = s.ctrl[0], b = s.ctrl[s.ctrl.length - 1];
    out.push(a); turn.push(!allCurve && kinds[s.from] === "turn");
    if(s.kind === "line") continue;
    for(const q of sample(bezier(s.ctrl), tol/2).slice(1, -1)){
      const last = out[out.length - 1];
      if(dist(q, last) > EPS && dist(q, b) > EPS){ out.push([q[0], q[1]]); turn.push(false); }
    }
  }
  return {pts: out, turn};
}

/* point k to target: only point k moves (O9); refused when it would sit on a neighbour */
export function dragOutline(o, k, target){
  if(!Number.isInteger(k) || k < 0 || k >= o.pts.length) throw new Error(`không có điểm ${k} — đường viền có ${o.pts.length} điểm`);
  const pts = o.pts.map((p, i) => i === k ? target : p);
  return checkOutline(pts, o.kinds);
}
export function moveOutline(o, dx, dy){
  if(!finite(dx) || !finite(dy)) throw new Error(`độ dời không hợp lệ: ${dx}, ${dy}`);
  return checkOutline(o.pts.map(p => [p[0] + dx, p[1] + dy]), o.kinds);
}

/* ── a point on an edge (O16) ─────────────────────────────────────────────────────
   A notch marks a place on ONE edge — the run between two turn points a seam is measured along — so it
   is kept as that edge (from → to) and its share of the edge's length: reshaping another edge cannot move
   it, reshaping its own edge keeps it at the same share. The share is along the arc, like every t here. */
const segShape = s => s.kind === "line" ? line(point(s.ctrl[0][0], s.ctrl[0][1]), point(s.ctrl[1][0], s.ctrl[1][1])) : bezier(s.ctrl);
/* where p sits: the nearest point of the outline, its edge and its share of that edge */
export function outlineLocate(pts, kinds, p){
  const segs = outlineSegments(pts, kinds), edges = outlineEdges(pts, kinds);
  let best = null;
  segs.forEach((s, i) => {
    const q = closestPoint(segShape(s), point(p[0], p[1]));
    if(!best || q.dist < best.dist) best = {i, t: q.t, dist: q.dist, point: [q.point.x, q.point.y]};
  });
  const e = edges.find(x => x.segments.includes(best.i));
  let share;
  if(e.segments.length === 1) share = best.t;                     // one segment: its own share, no rounding added
  else {
    let before = 0;
    for(const k of e.segments){ if(k === best.i) break; before += segLength(segs[k]); }
    share = (before + best.t*segLength(segs[best.i]))/e.length;
  }
  return {from: e.from, to: e.to, share, dist: best.dist, point: best.point};
}
/* the point at `share` of the length of the edge from → to; refused when the outline has no such edge */
export function outlineAt(pts, kinds, from, to, share){
  if(!(share >= 0 && share <= 1)) throw new Error(`tỉ lệ trên cạnh không hợp lệ: ${share} — cần 0 … 1`);
  const segs = outlineSegments(pts, kinds), e = outlineEdges(pts, kinds).find(x => x.from === from && x.to === to);
  if(!e) throw new Error(`không có cạnh ${from} → ${to} trên đường viền`);
  const on = (s, u) => { if(s.kind === "line"){ const [a, b] = s.ctrl; return [a[0] + (b[0] - a[0])*u, a[1] + (b[1] - a[1])*u]; }
                         const q = pointAt(bezier(s.ctrl), u); return [q.x, q.y]; };
  if(e.segments.length === 1) return on(segs[e.segments[0]], share);
  let want = share*e.length;
  for(let j = 0; j < e.segments.length; j++){
    const s = segs[e.segments[j]], L = segLength(s);
    if(want <= L || j === e.segments.length - 1) return on(s, L > 0 ? Math.min(1, Math.max(0, want/L)) : 0);
    want -= L;
  }
}

/* ── the smart pen's open line (sketch.md §8, L1–L6) ─────────────────────────────────
   The outline's rule exactly — straight between two turn points, a centripetal Catmull–Rom curve through curve points, the
   missing neighbour at a turn point its mirror image — with no closing span, and its two ends always corners: the end of an
   open line has no second side to be smooth with. Nothing above is changed by these: they only reuse span() and mirror(). */

/* ≥ 2 finite points, consecutive ones apart (last → first is not a span), one kind each; the two ends become turn points
   whatever they were placed as — copied, never shared (L1) */
export function checkOpenLine(pts, kinds){
  if(!Array.isArray(pts) || pts.length < 2) throw new Error(`đường cần ít nhất 2 điểm, nhận ${Array.isArray(pts) ? pts.length : pts}`);
  if(!Array.isArray(kinds) || kinds.length !== pts.length)
    throw new Error(`loại điểm: cần ${pts.length} (một mỗi điểm), nhận ${Array.isArray(kinds) ? kinds.length : kinds}`);
  const P = pts.map((p, i) => {
    if(!Array.isArray(p) || p.length < 2 || !finite(p[0]) || !finite(p[1])) throw new Error(`điểm ${i} không hợp lệ: ${JSON.stringify(p)} — cần [x, y] là số hữu hạn (mm)`);
    return [p[0], p[1]];
  });
  kinds.forEach((k, i) => { if(!OUTLINE_KINDS.includes(k)) throw new Error(`loại điểm ${i} không hợp lệ: "${k}" — chỉ có turn · curve`); });
  for(let i = 0; i + 1 < P.length; i++)
    if(dist(P[i], P[i + 1]) <= EPS) throw new Error(`điểm ${i} trùng điểm ${i + 1} — hai điểm liền nhau phải khác nhau`);
  const K = kinds.slice();
  K[0] = "turn"; K[K.length - 1] = "turn";
  return {pts: P, kinds: K};
}
/* one segment per pair of neighbours, n − 1 of them: a line between two turn points, else the Catmull–Rom span as a cubic
   Bezier; the end points are the placed points themselves, bit for bit (L2, L3) */
export function openSegments(pts, kinds){
  const o = checkOpenLine(pts, kinds), P = o.pts, K = o.kinds, segs = [];
  for(let i = 0; i + 1 < P.length; i++){
    const P1 = P[i], P2 = P[i + 1];
    if(K[i] === "turn" && K[i + 1] === "turn"){ segs.push({kind: "line", from: i, to: i + 1, ctrl: [P1, P2]}); continue; }
    /* the ends are turn points, so a curve point always has both neighbours */
    const P0 = K[i] === "curve" ? P[i - 1] : mirror(P1, P2);
    const P3 = K[i + 1] === "curve" ? P[i + 2] : mirror(P2, P1);
    segs.push({kind: "bezier", from: i, to: i + 1, ctrl: span(P0, P1, P2, P3)});
  }
  return segs;
}
/* the exact kernel shape: turn points only → an open polyline; otherwise one cubic NURBS of the segments */
export function openShape(pts, kinds){
  const segs = openSegments(pts, kinds);
  if(segs.every(s => s.kind === "line")) return curve([...segs.map(s => s.ctrl[0]), segs[segs.length - 1].ctrl[1]], false);
  const ctrl = [segs[0].ctrl[0]];
  for(const s of segs){
    if(s.kind === "bezier") ctrl.push(s.ctrl[1], s.ctrl[2], s.ctrl[3]);
    else { const [a, b] = s.ctrl; ctrl.push([a[0] + (b[0] - a[0])/3, a[1] + (b[1] - a[1])/3], [a[0] + 2*(b[0] - a[0])/3, a[1] + 2*(b[1] - a[1])/3], b); }
  }
  const n = segs.length, knots = [0, 0, 0, 0];
  for(let k = 1; k < n; k++) knots.push(k, k, k);
  knots.push(n, n, n, n);
  return spline({degree: 3, knots, ctrl});
}
/* the length: straight segments by distance, curved ones by the kernel's converged integral (L4) */
export function openLength(pts, kinds){ return openSegments(pts, kinds).reduce((s, x) => s + segLength(x), 0); }
/* The polyline Xuất DXF writes (L5): every placed point a vertex, bit for bit; a straight segment adds nothing between its
   ends; a curved one the samples that keep it within `tol` (sampled against midpoints: twice as fine, as dxf/write.js does).
   `turn[k]`: vertex k is a turn point — the two ends always are */
export function openSample(pts, kinds, tol = 0.01){
  const o = checkOpenLine(pts, kinds), segs = openSegments(o.pts, o.kinds), out = [o.pts[0]], turn = [true];
  for(const s of segs){
    const b = s.ctrl[s.ctrl.length - 1];
    if(s.kind === "bezier"){
      for(const q of sample(bezier(s.ctrl), tol/2).slice(1, -1)){
        const last = out[out.length - 1];
        if(dist(q, last) > EPS && dist(q, b) > EPS){ out.push([q[0], q[1]]); turn.push(false); }
      }
    }
    out.push(b); turn.push(o.kinds[s.to] === "turn");
  }
  return {pts: out, turn};
}
/* point k to target: only point k moves; refused when it would sit on a neighbour (L6) */
export function dragOpenLine(o, k, target){
  if(!Number.isInteger(k) || k < 0 || k >= o.pts.length) throw new Error(`không có điểm ${k} — đường có ${o.pts.length} điểm`);
  return checkOpenLine(o.pts.map((p, i) => i === k ? target : p), o.kinds);
}
export function moveOpenLine(o, dx, dy){
  if(!finite(dx) || !finite(dy)) throw new Error(`độ dời không hợp lệ: ${dx}, ${dy}`);
  return checkOpenLine(o.pts.map(p => [p[0] + dx, p[1] + dy]), o.kinds);
}
