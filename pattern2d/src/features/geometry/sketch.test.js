/* The sketch: shapes that snap to one another and keep their relations
   (spec: sketch.md §3.3 Snap · §3.4 N4 · §3.5 Constraint).

   Every relation is checked with this file's own rulers — a point-to-segment distance, a cross
   product, a Bezier evaluated by de Casteljau and measured by adaptive Simpson — never with the
   kernel's own check(). The long mixed session at the end drives a small construction through
   hundreds of random drags, moves and typed numbers and re-measures every relation after each
   one; a refused operation must leave every bit as it was. */
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {createSketch, CONSTRAINT_TYPES, snapHit} from "./sketch.js";
import {createLine, createCurve, createRect, createCircle, createPolygon, createPath, createPoint, setPathKind} from "./entity.js";
import {outlineSegments} from "./outline.js";
import {point, line, arc, curve} from "./model.js";
import {bezier} from "./spline.js";

/* ── plain rulers ────────────────────────────────────────────────────────────── */
const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (u, v) => u[0]*v[0] + u[1]*v[1];
const cross = (u, v) => u[0]*v[1] - u[1]*v[0];
const angDeg = (u, v) => Math.atan2(Math.abs(cross(u, v)), dot(u, v))*180/Math.PI;   // 0 … 180
const same = (a, b, msg) => ok(Object.is(a[0], b[0]) && Object.is(a[1], b[1]), `${msg}: [${a}] ≠ [${b}] (từng bit)`);
const nearPt = (a, b, tol, msg) => ok(hyp(a, b) <= tol, `${msg}: [${a}] cách [${b}] ${hyp(a, b)} > ${tol}`);
function distSeg(p, a, b){
  const d = sub(b, a), dd = dot(d, d), t = dd ? Math.max(0, Math.min(1, dot(sub(p, a), d)/dd)) : 0;
  return Math.hypot(p[0] - a[0] - d[0]*t, p[1] - a[1] - d[1]*t);
}
function distPoly(p, pts, closed){
  let best = Infinity;
  for(let i = 0; i < pts.length - (closed ? 0 : 1); i++) best = Math.min(best, distSeg(p, pts[i], pts[(i + 1) % pts.length]));
  return best;
}
function bez(P, t){
  const l = (p, q) => [p[0] + (q[0] - p[0])*t, p[1] + (q[1] - p[1])*t];
  const a = l(P[0], P[1]), b = l(P[1], P[2]), c = l(P[2], P[3]), d = l(a, b), e = l(b, c);
  return l(d, e);
}
function bezD(P, t){
  const s = 1 - t, k = [3*s*s, 6*s*t, 3*t*t];
  return [0, 1].map(j => k[0]*(P[1][j] - P[0][j]) + k[1]*(P[2][j] - P[1][j]) + k[2]*(P[3][j] - P[2][j]));
}
/* adaptive Simpson on |B'(t)| — converged far below the 1e-9 mm the spec asks */
function bezLen(P, a = 0, b = 1){
  const f = t => Math.hypot(...bezD(P, t));
  const simp = (a, b, fa, fm, fb) => (b - a)*(fa + 4*fm + fb)/6;
  const rec = (a, b, fa, fm, fb, whole, depth) => {
    const m = (a + b)/2, lm = (a + m)/2, rm = (m + b)/2, flm = f(lm), frm = f(rm);
    const left = simp(a, m, fa, flm, fm), right = simp(m, b, fm, frm, fb);
    if(depth > 40 || Math.abs(left + right - whole) <= 1e-14*Math.max(1, Math.abs(whole))) return left + right + (left + right - whole)/15;
    return rec(a, m, fa, flm, fm, left, depth + 1) + rec(m, b, fm, frm, fb, right, depth + 1);
  };
  const fa = f(a), fb = f(b), fm = f((a + b)/2);
  return rec(a, b, fa, fm, fb, simp(a, b, fa, fm, fb), 0);
}
/* nearest point of a Bezier to p: a dense scan, then golden section (the distance is flat at its
   minimum, so its VALUE is right to second order even where the parameter is only right to √ε) */
function bezNear(P, p){
  let bu = 0, bd = Infinity;
  for(let i = 0; i <= 2000; i++){ const d = hyp(bez(P, i/2000), p); if(d < bd){ bd = d; bu = i/2000; } }
  let lo = Math.max(0, bu - 1/2000), hi = Math.min(1, bu + 1/2000);
  const g = (Math.sqrt(5) - 1)/2;
  for(let k = 0; k < 200; k++){
    const c = hi - g*(hi - lo), d = lo + g*(hi - lo);
    if(hyp(bez(P, c), p) < hyp(bez(P, d), p)) hi = d; else lo = c;
  }
  const u = (lo + hi)/2;
  return {u, dist: hyp(bez(P, u), p)};
}
const ctrl = C => [C.p0, C.c1, C.c2, C.p3];
const shot = sk => JSON.stringify(sk.snapshot());
const H = (id, handle) => ({id, handle});

/* ── the five, and the snap classifier ───────────────────────────────────────── */
test("CONSTRAINT_TYPES: the five TD named", () => {
  deepEq(CONSTRAINT_TYPES, ["horizontal", "vertical", "coincident", "tangent", "equal"]);
});

test("B1 snapHit: a point beats a line, a line beats nothing; it says point · line · curve · free", () => {
  const P = [[200, 0], [220, 60], [280, 60], [300, 0]];
  const T = {points: [[0, 0], [50, 50]],
             shapes: [line(point(0, 0), point(100, 0)), arc(point(50, 50), 20, 0, 2*Math.PI, true), bezier(P)]};
  let r = snapHit([0.3, 0.1], T, 0.5);
  eq(r.kind, "point"); same(r.point, [0, 0], "hít đúng điểm"); eq(r.index, 0);
  r = snapHit([50, 0.3], T, 0.5);
  eq(r.kind, "line"); nearPt(r.point, [50, 0], 1e-12, "chân đường vuông góc"); near(r.dist, 0.3, 1e-12);
  r = snapHit([50, 70.3], T, 0.5);
  eq(r.kind, "curve"); near(hyp(r.point, [50, 50]), 20, 1e-9, "trên đường tròn");
  const q = bez(P, 0.37), d = bezD(P, 0.37), n = Math.hypot(...d), w = [q[0] - d[1]/n*0.4, q[1] + d[0]/n*0.4];
  r = snapHit(w, T, 0.5);
  eq(r.kind, "curve"); ok(bezNear(P, r.point).dist <= 1e-9, `điểm hít nằm trên Bezier (cách ${bezNear(P, r.point).dist})`);
  r = snapHit([50, 0.6], T, 0.5);
  eq(r.kind, "free"); same(r.point, [50, 0.6], "tự do: đúng chỗ bấm");
});

test("B3 a polyline is a line on its straight edge and a curve on its curved edge (0.01 mm between corners)", () => {
  const top = [];
  const cx = 50, rr = (50*50 + 10*10)/(2*10), cy = 70 - rr;
  const a0 = Math.atan2(60 - cy, 100 - cx), a1 = Math.atan2(60 - cy, 0 - cx);
  for(let i = 0; i <= 20; i++){ const a = a0 + (a1 - a0)*i/20; top.push([cx + rr*Math.cos(a), cy + rr*Math.sin(a)]); }
  const ring = [[0, 0], [100, 0], ...top];
  const T = {points: [], shapes: [curve(ring, true)]};
  let r = snapHit([50, -0.3], T, 0.5);
  eq(r.kind, "line", "cạnh đáy thẳng"); ok(distPoly(r.point, ring, true) <= 1e-9, "trên polyline");
  r = snapHit([50, 70.2], T, 0.5);
  eq(r.kind, "curve", "mép trên cong"); ok(distPoly(r.point, ring, true) <= 1e-9, "trên polyline");
  r = snapHit([100.3, 30], T, 0.5);
  eq(r.kind, "line", "cạnh bên thẳng");
});

test("B2 at the tolerance it snaps, a hair beyond it does not; no tolerance means no snap", () => {
  const T = {points: [[0, 0]], shapes: []};
  eq(snapHit([0.5, 0], T, 0.5).kind, "point", "đúng bằng dung sai");
  eq(snapHit([0.5 + 1e-9, 0], T, 0.5).kind, "free", "quá một chút");
  eq(snapHit([0, 0], T, null).kind, "free", "không dung sai → không snap, kể cả trúng đích");
  let err = null; try{ snapHit([NaN, 0], T, 0.5); }catch(e){ err = e; }
  ok(err, "điểm bấm NaN bị từ chối");
});

/* ── snapping while dragging ────────────────────────────────────────────────── */
test("B4 a handle never snaps to its own shape, but does snap to another", () => {
  const sk = createSketch();
  const L = sk.add(createLine([0, 0], [100, 0])), M = sk.add(createLine([200, 0.2], [250, 40]));
  let r = sk.drag(H(L, "b"), [0.2, 0.3], {tol: 0.5});
  ok(r.ok, r.reason); eq(r.snap.kind, "free", "không hít vào Start của chính nó");
  same(sk.get(L).b, [0.2, 0.3], "đúng chỗ bấm");
  r = sk.drag(H(L, "b"), [200.1, 0.1], {tol: 0.5});
  eq(r.snap.kind, "point"); deepEq(r.snap.ref, {id: M, handle: "a"}); same(sk.get(L).b, [200, 0.2], "hít vào đầu của đường kia");
});

test("B3 a dragged end lands ON the curve it snapped to", () => {
  const sk = createSketch(), O = arc(point(100, 0), 30, 0, 2*Math.PI, true);
  const L = sk.add(createLine([0, 0], [50, 50]));
  const r = sk.drag(H(L, "b"), [100 + 30.3*Math.cos(1), 30.3*Math.sin(1)], {targets: {points: [], shapes: [O]}, tol: 0.5});
  ok(r.ok, r.reason); eq(r.snap.kind, "curve");
  near(hyp(sk.get(L).b, [100, 0]), 30, 1e-9, "đầu line nằm trên đường tròn");
  eq(r.snap.ref.shape, O, "ref chỉ đúng hình DXF");
});

test("B5 dragging a position: whichever corner comes within tolerance lands exactly on the target", () => {
  const sk = createSketch(), R = sk.add(createRect([0, 0], 40, 20));
  const P = [100.3, 50.2];
  const r = sk.drag(H(R, "body"), [80.2, 40.1], {from: [20, 10], targets: {points: [P], shapes: []}, tol: 0.5});
  ok(r.ok, r.reason); eq(r.snap.kind, "point");
  const e = sk.get(R);
  nearPt([e.x + e.w, e.y + e.h], P, 1e-9, "góc v2 trùng khít điểm");
  ok(Object.is(e.w, 40) && Object.is(e.h, 20), "W, H từng bit");
});

test("B6 a snap only places — no relation is made — and the ref it returns can make one", () => {
  const sk = createSketch();
  const L = sk.add(createLine([0, 0], [50, 0])), M = sk.add(createLine([60, 0], [90, 30]));
  const r = sk.drag(H(L, "b"), [60.2, 0.1], {tol: 0.5});
  same(sk.get(L).b, [60, 0], "hít vào đầu M"); eq(sk.constraints().length, 0, "không tự tạo quan hệ");
  sk.move(M, 5, 5);
  same(sk.get(L).b, [60, 0], "M dời, L đứng yên — chưa có quan hệ");
  const c = sk.constrain("coincident", r.snap.ref, H(L, "b"));
  ok(c.ok, c.reason); same(sk.get(L).b, [65, 5], "khai xong: đầu L lên đầu M");
  sk.move(M, -10, 2);
  same(sk.get(L).b, [55, 7], "từ nay đi theo");
});

test("targets(): every other shape's points and paths, with refs; never the one being dragged", () => {
  const sk = createSketch();
  const L = sk.add(createLine([0, 0], [10, 0])), O = sk.add(createCircle([5, 5], 4));
  const t = sk.targets(L);
  deepEq(t.points, [[5, 5]]); deepEq(t.refs.points, [{id: O, handle: "c"}]);
  eq(t.shapes.length, 1); eq(t.shapes[0].kind, "arc"); deepEq(t.refs.shapes, [{id: O}]);
  eq(sk.targets().points.length, 3, "không loại gì: 2 đầu line + tâm");
});

/* ── R — relations ───────────────────────────────────────────────────────────── */
test("R1/R2 Horizontal on a slanted line: turns about Start, keeps its length, dy = 0 exactly", () => {
  const sk = createSketch(), L = sk.add(createLine([10, 10], [70, 90]));   // 100 long
  const c = sk.constrain("horizontal", {id: L});
  ok(c.ok, c.reason);
  same(sk.get(L).a, [10, 10], "Start đứng yên"); same(sk.get(L).b, [110, 10], "xoay về ngang, dài 100");
  const V = sk.add(createLine([0, 0], [30, -40]));                        // 50 long, pointing down
  ok(sk.constrain("vertical", {id: V}).ok);
  same(sk.get(V).b, [0, -50], "xoay về dọc phía gần nhất (xuống)");
});

test("R5 Horizontal: drag either end — it slides along the horizontal, the other end stays", () => {
  const sk = createSketch(), L = sk.add(createLine([10, 10], [70, 90]));
  sk.constrain("horizontal", {id: L});
  let r = sk.drag(H(L, "b"), [150, 37]);
  ok(r.ok, r.reason); same(sk.get(L).b, [150, 10], "End trượt ngang"); same(sk.get(L).a, [10, 10], "Start đứng yên");
  r = sk.drag(H(L, "a"), [-20, 99]);
  ok(r.ok, r.reason); same(sk.get(L).a, [-20, 10], "Start trượt ngang (G9)"); same(sk.get(L).b, [150, 10], "End đứng yên");
  r = sk.drag(H(L, "b"), [-100, 5]);
  ok(r.ok, r.reason); same(sk.get(L).b, [-100, 10], "kéo qua bên kia: vẫn ngang");
  r = sk.drag(H(L, "body"), [0, 30], {from: [0, 10]});
  ok(r.ok, r.reason); same(sk.get(L).a, [-20, 30], "kéo thân: dời cả đường"); ok(Object.is(sk.get(L).a[1], sk.get(L).b[1]), "vẫn ngang");
});

test("R5 Horizontal on a Curve handle: the tangent at that end stays horizontal", () => {
  const sk = createSketch(), C = sk.add(createCurve([0, 0], [100, 0], [20, 30], [80, 30]));
  ok(sk.constrain("horizontal", H(C, "c1")).ok);
  near(sk.get(C).c1[0], Math.hypot(20, 30), 1e-12, "xoay tay nắm về ngang, giữ độ dài"); ok(Object.is(sk.get(C).c1[1], 0), "dy = 0");
  sk.drag(H(C, "c1"), [50, 40]);
  same(sk.get(C).c1, [50, 0], "tay nắm chỉ trượt ngang");
  sk.drag(H(C, "p0"), [0, 10]);
  same(sk.get(C).c1, [50, 10], "Start dời: tay nắm đi theo, vẫn ngang");
  const d = bezD(ctrl(sk.get(C)), 0);
  near(Math.atan2(d[1], d[0]), 0, 1e-15, "tiếp tuyến tại Start nằm ngang");
});

test("R2/R4 Coincident point ← point: the driven end jumps onto the master; the master never moves", () => {
  const sk = createSketch();
  const L1 = sk.add(createLine([0, 0], [50, 0])), L2 = sk.add(createLine([60, 5], [90, 40]));
  const c = sk.constrain("coincident", H(L1, "b"), H(L2, "a"));
  ok(c.ok, c.reason);
  same(sk.get(L2).a, [50, 0], "đầu bám lên đầu chủ"); same(sk.get(L2).b, [90, 40], "đầu tự do đứng yên");
  deepEq(sk.get(L1), {type: "line", a: [0, 0], b: [50, 0]}, "chủ không đổi");
  sk.drag(H(L1, "b"), [55, 20]);
  same(sk.get(L2).a, [55, 20], "chủ dời, điểm bám theo"); same(sk.get(L2).b, [90, 40], "đầu tự do vẫn đứng yên");
  const before = shot(sk), r = sk.drag(H(L2, "a"), [0, 99]);
  ok(!r.ok && /bám|trùng/.test(r.reason), `điểm trùng điểm không kéo được, phải nói lý do: ${r.reason}`);
  eq(shot(sk), before, "không gì đổi");
});

test("R2/R5 Coincident point ← line: foot of the perpendicular, then it slides along the line", () => {
  const sk = createSketch(), S = line(point(0, 0), point(100, 0));
  const L = sk.add(createLine([30, 12], [40, 60]));
  ok(sk.constrain("coincident", {shape: S}, H(L, "a")).ok);
  nearPt(sk.get(L).a, [30, 0], 1e-9, "chân đường vuông góc"); same(sk.get(L).b, [40, 60], "đầu kia đứng yên");
  sk.drag(H(L, "a"), [70, -5]);
  nearPt(sk.get(L).a, [70, 0], 1e-9, "kéo: trượt dọc đường");
  ok(Object.is(sk.get(L).a[1], 0), "vẫn nằm trên đường y = 0");
});

test("R2/G14 Coincident point ← circle: on it, and at the same place round it when the circle moves or grows", () => {
  const sk = createSketch(), O = sk.add(createCircle([0, 0], 40));
  const L = sk.add(createLine([25, 5], [60, 50]));
  ok(sk.constrain("coincident", {id: O}, H(L, "a")).ok);
  const a0 = sk.get(L).a;
  near(hyp(a0, [0, 0]), 20, 1e-9, "trên đường tròn");
  near(Math.atan2(a0[1], a0[0]), Math.atan2(5, 25), 1e-12, "tại góc của điểm cũ");
  sk.move(O, 10, 5);
  nearPt(sk.get(L).a, [a0[0] + 10, a0[1] + 5], 1e-9, "tròn dời, điểm dời theo");
  sk.setDim(O, "d", 60);
  const a2 = sk.get(L).a;
  near(hyp(a2, [10, 5]), 30, 1e-9, "tròn to ra, điểm vẫn trên nó");
  near(Math.atan2(a2[1] - 5, a2[0] - 10), Math.atan2(5, 25), 1e-12, "cùng góc");
  sk.drag(H(L, "a"), [10, 90]);
  nearPt(sk.get(L).a, [10, 35], 1e-9, "kéo: trượt quanh đường tròn");
});

test("R2/G14 Coincident point ← curve: on it, and at the same share of its length when it is reshaped", () => {
  const sk = createSketch(), C = sk.add(createCurve([0, 0], [100, 0], [20, 60], [80, 60]));
  const L = sk.add(createLine([30, 50], [30, 90]));
  ok(sk.constrain("coincident", {id: C}, H(L, "a")).ok);
  let P = ctrl(sk.get(C)), f = bezNear(P, sk.get(L).a);
  ok(f.dist <= 1e-9, `trên curve (cách ${f.dist})`);
  const share = bezLen(P, 0, f.u)/bezLen(P);
  sk.drag(H(C, "c2"), [90, 110]);
  P = ctrl(sk.get(C)); f = bezNear(P, sk.get(L).a);
  ok(f.dist <= 1e-9, `curve đổi dáng, điểm vẫn trên nó (cách ${f.dist})`);
  near(bezLen(P, 0, f.u)/bezLen(P), share, 1e-7, "cùng tỉ lệ chiều dài t");
  sk.drag(H(L, "a"), [95, 20]);
  ok(bezNear(ctrl(sk.get(C)), sk.get(L).a).dist <= 1e-9, "kéo: trượt dọc curve");
});

test("R2/R5 Coincident moves a rigid shape: a corner onto a point (then locked), a centre onto a line (then sliding)", () => {
  const sk = createSketch();
  const R = sk.add(createRect([0, 0], 30, 20)), L = sk.add(createLine([0, 0], [100, 50]));
  ok(sk.constrain("coincident", H(L, "b"), H(R, "v2")).ok);
  const e = sk.get(R);
  deepEq([e.x, e.y, e.w, e.h], [70, 30, 30, 20], "góc v2 lên đầu line, W H giữ");
  ok(!sk.drag(H(R, "body"), [0, 0], {from: [80, 40]}).ok, "rect trùng điểm: không kéo được");
  sk.drag(H(L, "b"), [120, 60]);
  deepEq([sk.get(R).x, sk.get(R).y], [90, 40], "đầu line dời, rect dời theo");
  const S = line(point(0, 0), point(200, 0)), O = sk.add(createCircle([40, 7], 10));
  ok(sk.constrain("coincident", {shape: S}, H(O, "c")).ok);
  nearPt(sk.get(O).c, [40, 0], 1e-9, "tâm lên đường");
  sk.drag(H(O, "c"), [60, 30]);
  nearPt(sk.get(O).c, [60, 0], 1e-9, "kéo tâm: trượt dọc đường");
  sk.drag(H(O, "body"), [80, 9], {from: [60, 0]});
  nearPt(sk.get(O).c, [80, 0], 1e-9, "kéo thân: cũng trượt");
  ok(Object.is(sk.get(O).d, 10), "D từng bit");
});

test("R2/R5 Equal: a line takes the master's length along its own direction, and turns about its start when dragged", () => {
  const sk = createSketch();
  const L1 = sk.add(createLine([0, 0], [80, 0])), L2 = sk.add(createLine([0, 10], [30, 50]));   // 50 long
  ok(sk.constrain("equal", {id: L1}, {id: L2}).ok);
  same(sk.get(L2).a, [0, 10], "Start đứng yên"); nearPt(sk.get(L2).b, [48, 74], 1e-9, "dài 80 dọc hướng cũ (3-4-5)");
  sk.drag(H(L1, "b"), [100, 0]);
  nearPt(sk.get(L2).b, [60, 90], 1e-9, "chủ dài 100 → bám dài 100");
  ok(!sk.setDim(L2, "length", 5).ok, "gõ Length cho line đang bằng line khác: từ chối");
  sk.drag(H(L2, "b"), [0, 200]);
  nearPt(sk.get(L2).b, [0, 110], 1e-9, "kéo End: quay quanh Start, dài giữ 100");
  sk.drag(H(L2, "a"), [50, 110]);
  nearPt(sk.get(L2).a, [100, 110], 1e-9, "kéo Start: quay quanh End (G9)"); same(sk.get(L2).b, [0, 110], "End đứng yên");
});

test("R2 Equal between circles (D), rectangles (W and H), polygons (Size — sides and Angle their own)", () => {
  const sk = createSketch();
  const O1 = sk.add(createCircle([0, 0], 30)), O2 = sk.add(createCircle([50, 5], 10));
  ok(sk.constrain("equal", {id: O1}, {id: O2}).ok);
  ok(Object.is(sk.get(O2).d, 30), "D chép từng bit"); same(sk.get(O2).c, [50, 5], "tâm đứng yên");
  sk.setDim(O1, "d", 44);
  eq(sk.get(O2).d, 44); ok(!sk.setDim(O2, "d", 1).ok, "D của bên bám không gõ được");
  const R1 = sk.add(createRect([0, 0], 40, 20)), R2 = sk.add(createRect([100, 100], 10, 10));
  ok(sk.constrain("equal", {id: R1}, {id: R2}).ok);
  deepEq([sk.get(R2).x, sk.get(R2).y, sk.get(R2).w, sk.get(R2).h], [100, 100, 40, 20]);
  const G1 = sk.add(createPolygon([0, 0], 30, 6)), G2 = sk.add(createPolygon([80, 0], 10, 5, 20));
  ok(sk.constrain("equal", {id: G1}, {id: G2}).ok);
  deepEq([sk.get(G2).size, sk.get(G2).sides, sk.get(G2).angle], [30, 5, 20]);
});

test("R2/G12 Equal to a curve: a straight seam as long as the curved one", () => {
  const sk = createSketch(), C = sk.add(createCurve([0, 0], [100, 0], [20, 60], [80, 60]));
  const L = sk.add(createLine([0, -20], [50, -20]));
  ok(sk.constrain("equal", {id: C}, {id: L}).ok);
  near(hyp(sk.get(L).a, sk.get(L).b), bezLen(ctrl(sk.get(C))), 1e-9, "dài bằng curve");
  sk.drag(H(C, "c2"), [80, 90]);
  near(hyp(sk.get(L).a, sk.get(L).b), bezLen(ctrl(sk.get(C))), 1e-9, "curve đổi, line theo");
  ok(!sk.constrain("equal", {id: L}, {id: C}).ok, "curve không làm bên bám của Equal (G12) — và đây còn là vòng lặp");
});

test("R1/R2 Tangent: a curve leaving a line at their junction continues its direction", () => {
  const sk = createSketch();
  const L = sk.add(createLine([0, 0], [50, 0])), C = sk.add(createCurve([50, 0], [100, 40], [70, 30], [90, 40]));
  ok(sk.constrain("coincident", H(L, "b"), H(C, "p0")).ok);
  const t = sk.constrain("tangent", {id: L}, {id: C});
  ok(t.ok, t.reason);
  const h = Math.hypot(20, 30);
  near(sk.get(C).c1[0], 50 + h, 1e-12, "tay nắm xoay về hướng của line, giữ độ dài"); ok(Object.is(sk.get(C).c1[1], 0), "dy = 0");
  near(angDeg(bezD(ctrl(sk.get(C)), 0), [1, 0]), 0, 1e-9, "tiếp tuyến tại chỗ nối = hướng line");
  sk.drag(H(L, "b"), [60, 10]);
  const e = sk.get(C);
  same(e.p0, [60, 10], "chỗ nối đi theo đầu line");
  near(angDeg(sub(e.c1, e.p0), [60, 10]), 0, 1e-9, "vẫn tiếp tuyến"); near(hyp(e.c1, e.p0), h, 1e-9, "độ dài tay nắm giữ");
  sk.drag(H(C, "c1"), [100, 100]);
  const u = [60/Math.hypot(60, 10), 10/Math.hypot(60, 10)], k = dot(sub([100, 100], [60, 10]), u);
  nearPt(sk.get(C).c1, [60 + k*u[0], 10 + k*u[1]], 1e-9, "kéo tay nắm: chỉ trượt dọc tiếp tuyến");
  const before = shot(sk), r = sk.drag(H(C, "c1"), [60 - 20*u[0], 10 - 20*u[1]]);
  ok(!r.ok && r.reason, "kéo lùi qua chỗ nối: từ chối cả thao tác (R9)"); eq(shot(sk), before, "không gì đổi");
});

test("Tangent: a curve after a curve (G1 at the shared end), a line on a circle at the point it touches", () => {
  const sk = createSketch();
  const C1 = sk.add(createCurve([0, 0], [100, 0], [30, 40], [70, 40])), C2 = sk.add(createCurve([100, 0], [180, 30], [120, -20], [160, 30]));
  ok(sk.constrain("coincident", H(C1, "p3"), H(C2, "p0")).ok);
  ok(sk.constrain("tangent", {id: C1}, {id: C2}).ok);
  const a = sk.get(C1), b = sk.get(C2), m = sub(a.p3, a.c2), d = sub(b.c1, b.p0);
  near(angDeg(d, m), 0, 1e-9, "curve sau rời chỗ nối đúng hướng curve trước tới"); near(hyp(b.c1, b.p0), Math.hypot(20, 20), 1e-9, "tay nắm giữ dài");
  sk.drag(H(C1, "c2"), [50, 30]);
  near(angDeg(sub(sk.get(C2).c1, sk.get(C2).p0), sub(sk.get(C1).p3, sk.get(C1).c2)), 0, 1e-9, "curve trước đổi dáng: vẫn G1");
  const O = sk.add(createCircle([0, 0], 100)), L = sk.add(createLine([48, 14], [60, 80]));
  ok(sk.constrain("coincident", {id: O}, H(L, "a")).ok);
  ok(sk.constrain("tangent", {id: O}, {id: L}).ok);
  const perp = () => { const e = sk.get(L), c = sk.get(O).c; return dot(sub(e.b, e.a), sub(e.a, c))/(hyp(e.b, e.a)*hyp(e.a, c)); };
  near(perp(), 0, 1e-12, "line ⟂ bán kính tại chỗ chạm");
  near(hyp(sk.get(L).a, sk.get(L).b), Math.hypot(12, 66), 1e-9, "giữ chiều dài");
  sk.move(O, 10, -5); near(perp(), 0, 1e-12, "tròn dời: vẫn tiếp tuyến");
  sk.drag(H(L, "b"), [0, 150]); near(perp(), 0, 1e-12, "kéo đầu kia: trượt dọc tiếp tuyến");
});

test("R7 conflicting declarations are refused and change nothing", () => {
  const sk = createSketch();
  const A = sk.add(createLine([0, 0], [50, 0])), B = sk.add(createLine([50, 0], [60, 40])), D = sk.add(createLine([0, 10], [40, 30]));
  const O = sk.add(createCircle([0, 0], 10)), R = sk.add(createRect([0, 0], 5, 5)), C = sk.add(createCurve([0, 0], [10, 0]));
  const Z = sk.add(createCurve([0, 0], [10, 0], [0, 0], [5, 5]));
  sk.constrain("horizontal", {id: A});
  sk.constrain("coincident", H(A, "b"), H(B, "a"));
  sk.constrain("equal", {id: A}, {id: D});
  const refuse = (why, ...args) => {
    const before = shot(sk), r = sk.constrain(...args);
    ok(!r.ok, `${why}: phải từ chối`); ok(r.reason && r.reason.length > 5, `${why}: phải nói lý do`);
    eq(shot(sk), before, `${why}: không gì đổi`);
  };
  refuse("H rồi V trên một line", "vertical", {id: A});
  refuse("H hai lần", "horizontal", {id: A});
  ok(sk.constrain("horizontal", {id: B}).ok, "B: đầu a bám, khoá hướng được");
  refuse("B đã khoá hướng, thêm Tangent", "tangent", {id: A}, {id: B});
  refuse("hai Equal vào một line", "equal", {id: B}, {id: D});
  refuse("điểm đã bám rồi", "coincident", H(D, "a"), H(B, "a"));
  refuse("bám cả hai đầu mà còn khoá hướng", "coincident", H(D, "b"), H(B, "b"));
  refuse("điểm lên chính hình của nó", "coincident", H(D, "a"), H(D, "b"));
  refuse("điểm lên chính đường của nó", "coincident", {id: D}, H(D, "a"));
  refuse("Equal Circle với Line", "equal", {id: O}, {id: D});
  refuse("Equal lên chính nó", "equal", {id: O}, {id: O});
  refuse("Tangent không có chỗ nối", "tangent", {id: O}, {id: C});
  refuse("Horizontal cho Circle", "horizontal", {id: O});
  refuse("Tangent với Rectangle", "tangent", {id: R}, {id: C});
  refuse("control point không phải điểm để bám", "coincident", H(A, "a"), H(C, "c1"));
  refuse("tay nắm dài 0 không có hướng", "horizontal", H(Z, "c1"));
  refuse("quan hệ chưa có (G15)", "parallel", {id: A}, {id: D});
  refuse("hình không có", "horizontal", {id: "không-có"});
  refuse("tay nắm không có", "coincident", H(A, "q"), H(C, "p0"));
});

test("R8 a dependency loop is refused at declaration — a closed chain is fine until every side is locked", () => {
  const sk = createSketch();
  const A = sk.add(createLine([0, 0], [50, 0])), B = sk.add(createLine([50, 0], [25, 40]));
  ok(sk.constrain("coincident", H(A, "b"), H(B, "a")).ok);
  ok(sk.constrain("coincident", H(B, "b"), H(A, "a")).ok, "hai line khép kín bằng Coincident: không phải vòng lặp");
  const r = sk.constrain("equal", {id: B}, {id: A});
  ok(!r.ok && /vòng/.test(r.reason), `Equal làm vòng lặp: ${r.reason}`);
  const O1 = sk.add(createCircle([0, 0], 5)), O2 = sk.add(createCircle([9, 9], 7));
  ok(sk.constrain("equal", {id: O1}, {id: O2}).ok);
  ok(!sk.constrain("equal", {id: O2}, {id: O1}).ok, "Equal hai chiều");
  const t = createSketch();
  const L = [0, 1, 2].map(i => t.add(createLine([i*10, 0], [i*10 + 10, 5])));
  for(let i = 0; i < 3; i++) ok(t.constrain("coincident", H(L[i], "b"), H(L[(i + 1) % 3], "a")).ok);
  ok(t.constrain("horizontal", {id: L[0]}).ok); ok(t.constrain("horizontal", {id: L[1]}).ok);
  ok(!t.constrain("horizontal", {id: L[2]}).ok, "khép kín mà cạnh nào cũng khoá: vòng lặp (G13)");
});

test("R9 an operation a dependent cannot survive is refused whole — the master does not move either", () => {
  const sk = createSketch();
  const L1 = sk.add(createLine([0, 0], [50, 0])), L2 = sk.add(createLine([50, 0], [80, 30]));
  sk.constrain("coincident", H(L1, "b"), H(L2, "a"));
  const before = shot(sk), r = sk.drag(H(L1, "b"), [80, 30]);
  ok(!r.ok && /dài 0/.test(r.reason), `L2 sẽ dài 0: ${r.reason}`); eq(shot(sk), before, "L1 cũng không dời");
  const E = sk.add(createLine([0, 100], [40, 100]));
  sk.constrain("equal", {id: L1}, {id: E});
  const b2 = shot(sk), r2 = sk.drag(H(E, "b"), [0, 100]);
  ok(!r2.ok, "đầu line dài cố định kéo đè lên gốc: không có hướng"); eq(shot(sk), b2);
});

test("R10 removing a relation leaves everything where it is; from then on it is free", () => {
  const sk = createSketch();
  const L1 = sk.add(createLine([0, 0], [50, 0])), L2 = sk.add(createLine([60, 5], [90, 40]));
  const {cid} = sk.constrain("coincident", H(L1, "b"), H(L2, "a"));
  sk.drag(H(L1, "b"), [55, 20]);
  const before = JSON.stringify([sk.get(L1), sk.get(L2)]);
  ok(sk.unconstrain(cid).ok);
  eq(JSON.stringify([sk.get(L1), sk.get(L2)]), before, "gỡ xong: không nhảy");
  ok(sk.drag(H(L2, "a"), [0, 99]).ok, "từ nay kéo được"); same(sk.get(L1).b, [55, 20], "L1 không theo nữa");
  ok(!sk.unconstrain(cid).ok, "gỡ lần hai: không có");
});

test("R10 removing the Coincident a Tangent stands on takes the Tangent too; the shapes stay put", () => {
  const sk = createSketch();
  const L = sk.add(createLine([0, 0], [50, 0])), C = sk.add(createCurve([50, 0], [100, 40], [70, 30], [90, 40]));
  const {cid} = sk.constrain("coincident", H(L, "b"), H(C, "p0"));
  const t = sk.constrain("tangent", {id: L}, {id: C});
  const at = JSON.stringify(sk.get(C)), r = sk.unconstrain(cid);
  ok(r.ok); deepEq(r.removed.sort(), [cid, t.cid].sort(), "Tangent mất chỗ nối thì đi theo");
  eq(sk.constraints().length, 0); eq(JSON.stringify(sk.get(C)), at, "curve đứng yên");
});

test("G9 when turning about the other end would make a loop, the line turns about Start as always", () => {
  const sk = createSketch();
  const L = sk.add(createLine([0, 0], [50, 0])), M = sk.add(createLine([0, 20], [30, 60]));
  ok(sk.constrain("coincident", H(L, "a"), H(M, "a")).ok);                // M.a follows L.a
  ok(sk.constrain("equal", {id: M}, {id: L}).ok);                          // L as long as M
  const r = sk.drag(H(L, "a"), [10, 5]);
  ok(r.ok, r.reason);
  same(sk.get(L).a, [10, 5], "Start tới đích (không quay quanh End được: End phụ thuộc M, M phụ thuộc Start)");
  same(sk.get(M).a, [10, 5], "M.a theo L.a");
  near(hyp(sk.get(L).a, sk.get(L).b), hyp(sk.get(M).a, sk.get(M).b), 1e-9, "vẫn bằng nhau");
});

test("remove(): a shape takes its relations with it; what depended on it stays where it is", () => {
  const sk = createSketch();
  const L1 = sk.add(createLine([0, 0], [50, 0])), L2 = sk.add(createLine([60, 5], [90, 40]));
  sk.constrain("coincident", H(L1, "b"), H(L2, "a"));
  const at = sk.get(L2);
  const r = sk.remove(L1);
  ok(r.ok); eq(r.removed.length, 1, "mang theo 1 quan hệ"); eq(sk.constraints().length, 0);
  deepEq(sk.get(L2), at, "L2 đứng yên"); ok(sk.drag(H(L2, "a"), [1, 1]).ok, "và tự do");
  deepEq(sk.ids(), [L2]);
});

test("snapshot / restore gives back every shape and every relation", () => {
  const sk = createSketch();
  const L = sk.add(createLine([0, 0], [50, 10])), O = sk.add(createCircle([0, 0], 10));
  sk.constrain("horizontal", {id: L}); sk.constrain("coincident", H(L, "b"), H(O, "c"));
  const snap = sk.snapshot(), before = JSON.stringify(snap);
  sk.drag(H(L, "b"), [90, 0]); sk.setDim(O, "d", 77); sk.add(createRect([0, 0], 1, 1));
  sk.restore(snap);
  eq(shot(sk), before, "về đúng như cũ"); eq(JSON.stringify(snap), before, "bản chụp không bị sửa");
  sk.drag(H(L, "b"), [70, 5]);
  same(sk.get(O).c, [70, 0], "quan hệ còn sống sau restore");
});

test("N4 typing a handle's coordinates = dragging it there; many frames end where one frame does", () => {
  const build = () => {
    const sk = createSketch();
    const L = sk.add(createLine([0, 0], [50, 10])), C = sk.add(createCurve([50, 0], [120, 40], [70, 30], [100, 40]));
    const O = sk.add(createCircle([200, 0], 10));
    sk.constrain("horizontal", {id: L}); sk.constrain("coincident", H(L, "b"), H(C, "p0")); sk.constrain("tangent", {id: L}, {id: C});
    return {sk, L, C, O};
  };
  const cases = [["L", "b", [140, 33]], ["C", "c1", [95, -40]], ["C", "c2", [10, 90]], ["O", "c", [-30, 7]]];
  for(const [who, h, T] of cases){
    const typed = build(), mouse = build();
    ok(typed.sk.drag(H(typed[who], h), T).ok, `${who}.${h}: gõ toạ độ`);
    ok(mouse.sk.drag(H(mouse[who], h), T, {targets: {points: [[1e6, 1e6]], shapes: []}, tol: 0.5}).ok, `${who}.${h}: kéo`);
    eq(shot(mouse.sk), shot(typed.sk), `${who}.${h}: kéo tới đúng toạ độ = gõ toạ độ, từng bit`);
    const frames = build();
    let s = 7;
    for(let k = 0; k < 40; k++){
      s = (s*16807) % 2147483647;
      frames.sk.drag(H(frames[who], h), [T[0] + (s % 200) - 100, T[1] + (s % 97) - 48]);
    }
    frames.sk.drag(H(frames[who], h), T);
    const a = frames.sk.snapshot(), b = typed.sk.snapshot();
    const flat = x => JSON.stringify(x).match(/-?\d+(\.\d+)?(e-?\d+)?/g).map(Number);
    const fa = flat(a), fb = flat(b);
    eq(fa.length, fb.length);
    fa.forEach((v, i) => near(v, fb[i], 1e-9, `${who}.${h}: 40 khung rồi tới đích = một khung (số thứ ${i})`));
  }
});

test("results say what happened: ok · reason · snap · changed", () => {
  const sk = createSketch();
  const L = sk.add(createLine([0, 0], [10, 0])), O = sk.add(createCircle([50, 50], 4)), M = sk.add(createLine([10, 0], [10, 30]));
  sk.constrain("coincident", H(L, "b"), H(M, "a"));
  let r = sk.drag(H(L, "b"), [20, 5]);
  ok(r.ok); eq(r.snap, null, "không dung sai → không có snap"); deepEq(r.changed.sort(), [L, M].sort(), "đổi: L và M bám theo");
  r = sk.move(O, 1, 1); deepEq(r.changed, [O]);
  r = sk.setDim(O, "d", -1); ok(!r.ok && /không hợp lệ/.test(r.reason), r.reason);
  r = sk.drag(H("không-có", "a"), [0, 0]); ok(!r.ok && r.reason);
});

/* ── R3 · R4 · R6 — one construction, hundreds of random operations ─────────── */
test("R3/R4/R6 a long mixed session: after every accepted operation every relation holds, measured here", () => {
  const sk = createSketch();
  const P0 = [0, 0], S = line(point(-50, -30), point(250, -30));
  const L1 = sk.add(createLine([0.3, 0.4], [80, 5])), L2 = sk.add(createLine([85, 3], [90, 60]));
  const C = sk.add(createCurve([95, 65], [160, 100], [100, 80], [140, 100]));
  const O = sk.add(createCircle([170, 95], 20)), O2 = sk.add(createCircle([220, 40], 5));
  const L3 = sk.add(createLine([200, -10], [230, 20])), R = sk.add(createRect([100, -60], 30, 15));
  const G = sk.add(createPolygon([40, 60], 20, 6)), U = sk.add(createCircle([500, 500], 10)), V = sk.add(createLine([600, 0], [650, 10]));
  const decl = [
    ["coincident", {point: P0}, H(L1, "a")], ["horizontal", {id: L1}],
    ["coincident", H(L1, "b"), H(L2, "a")], ["vertical", {id: L2}],
    ["coincident", H(L2, "b"), H(C, "p0")], ["tangent", {id: L2}, {id: C}],
    ["coincident", H(C, "p3"), H(O, "c")], ["equal", {id: O}, {id: O2}],
    ["coincident", {shape: S}, H(L3, "a")], ["equal", {id: C}, {id: L3}],
    ["coincident", {shape: S}, H(R, "v3")], ["coincident", {id: L2}, H(G, "c")]];
  for(const d of decl){ const r = sk.constrain(...d); ok(r.ok, `khai ${d[0]}: ${r.reason}`); }
  const e = id => sk.get(id);
  const s0 = Math.sign(dot(sub(e(C).c1, e(C).p0), sub(e(L2).b, e(L2).a)));
  const Uat = JSON.stringify(e(U)), Vat = JSON.stringify(e(V));

  function verify(tag){
    same(e(L1).a, P0, `${tag}: L1 bám điểm notch`);
    ok(Object.is(e(L1).a[1], e(L1).b[1]), `${tag}: L1 ngang`);
    same(e(L2).a, e(L1).b, `${tag}: L2 nối L1`);
    ok(Object.is(e(L2).a[0], e(L2).b[0]), `${tag}: L2 dọc`);
    same(e(C).p0, e(L2).b, `${tag}: curve nối L2`);
    const d = sub(e(C).c1, e(C).p0), m = sub(e(L2).b, e(L2).a);
    ok(Object.is(e(C).c1[0], e(C).p0[0]) && Math.sign(dot(d, m)) === s0, `${tag}: curve tiếp tuyến L2, cùng chiều như lúc khai`);
    same(e(O).c, e(C).p3, `${tag}: tâm tròn ở cuối curve`);
    ok(Object.is(e(O2).d, e(O).d), `${tag}: hai tròn bằng nhau`);
    ok(Object.is(e(L3).a[1], -30) && e(L3).a[0] >= -50 && e(L3).a[0] <= 250, `${tag}: L3 bám đường DXF`);
    near(hyp(e(L3).a, e(L3).b), bezLen(ctrl(e(C))), 1e-9, `${tag}: L3 dài bằng curve`);
    near(e(R).y + e(R).h, -30, 1e-12, `${tag}: góc rect bám đường DXF`);
    ok(e(R).x >= -50 - 1e-9 && e(R).x <= 250 + 1e-9, `${tag}: góc rect trong đoạn DXF`);
    const lo = Math.min(e(L2).a[1], e(L2).b[1]), hi = Math.max(e(L2).a[1], e(L2).b[1]);
    ok(Object.is(e(G).c[0], e(L2).a[0]) && e(G).c[1] >= lo - 1e-9 && e(G).c[1] <= hi + 1e-9, `${tag}: tâm lục giác trên L2`);
    eq(JSON.stringify(e(U)), Uat, `${tag}: hình không dính quan hệ không đổi (R6)`); eq(JSON.stringify(e(V)), Vat, `${tag}: R6`);
  }
  verify("sau khai báo");

  const down = {[L1]: [L2, C, O, O2, L3, G], [L2]: [C, O, O2, L3, G], [C]: [O, O2, L3], [O]: [O2],
                [O2]: [], [L3]: [], [R]: [], [G]: []};
  const OPS = [[L1, "b"], [L1, "a"], [L1, "body"], [L2, "b"], [C, "c1"], [C, "c2"], [C, "p3"], [C, "p0"], [O, "c"],
               [O2, "c"], [L3, "a"], [L3, "b"], [R, "body"], [R, "v1"], [G, "c"], [G, "v2"],
               [L1, "length"], [L1, "angle"], [O, "d"], [O2, "d"], [R, "w"], [R, "h"], [G, "size"]];
  let seed = 20260923, okN = 0, noN = 0;
  const rnd = () => { seed = (seed*1103515245 + 12345) % 2147483648; return seed/2147483648; };
  for(let k = 0; k < 600; k++){
    const [id, what] = OPS[Math.floor(rnd()*OPS.length)];
    const before = sk.snapshot(), beforeText = JSON.stringify(before);
    const T = [-100 + rnd()*400, -100 + rnd()*300];
    let r;
    if(["length", "angle", "d", "w", "h", "size"].includes(what)) r = sk.setDim(id, what, what === "angle" ? rnd()*360 : 1 + rnd()*120);
    else r = sk.drag(H(id, what), T, {from: what === "body" ? sk.get(id).a || [sk.get(id).x, sk.get(id).y] : undefined});
    if(!r.ok){ noN++; eq(JSON.stringify(sk.snapshot()), beforeText, `thao tác ${k} bị từ chối (${r.reason}) mà hình đổi`); continue; }
    okN++;
    verify(`thao tác ${k} (${what} của ${id})`);
    const may = new Set([id, ...down[id]]);
    for(const [oid, ent] of before.entities)
      if(!may.has(oid)) eq(JSON.stringify(sk.get(oid)), JSON.stringify(ent), `thao tác ${k}: ${oid} không phụ thuộc ${id} mà đổi (R4/R6)`);
  }
  ok(okN >= 300, `đủ thao tác được nhận để có nghĩa (${okN})`); ok(noN >= 30, `có thao tác bị từ chối (${noN})`);
  ok(sk.check().every(c => c.ok), "check() của kernel cũng đồng ý");
});

/* ── §7 — a new piece in the sketch: notches ride on its outline (O14), shapes snap to it (O15) ── */
const T2P = [[0, -150], [180, -150], [180, -40], [90, -5], [0, -20], [-15, -85]], T2K = ["turn", "turn", "turn", "curve", "turn", "curve"];
/* where p sits on an outline, by this file's rulers: the nearest span (bezNear / distSeg) and the share of
   the whole length before it (Simpson on each span) */
function onOutline(E, p){
  const segs = outlineSegments(E.pts, E.kinds), lens = segs.map(sg => sg.kind === "line" ? hyp(sg.ctrl[0], sg.ctrl[1]) : bezLen(sg.ctrl));
  const total = lens.reduce((a, b) => a + b, 0);
  let best = null, before = 0;
  segs.forEach((sg, i) => {
    let d, part;
    if(sg.kind === "line"){ d = distSeg(p, sg.ctrl[0], sg.ctrl[1]); part = Math.min(hyp(sg.ctrl[0], p), lens[i]); }
    else { const f = bezNear(sg.ctrl, p); d = f.dist; part = bezLen(sg.ctrl, 0, f.u); }
    if(!best || d < best.dist) best = {dist: d, share: (before + part)/total, span: i};
    before += lens[i];
  });
  return best;
}

/* the share of p along the edge from → to (segments from..to−1), by this file's Simpson */
function edgeShare(E, p, from, to){
  const segs = outlineSegments(E.pts, E.kinds), idx = [];
  for(let i = from; ; i = (i + 1) % segs.length){ idx.push(i); if((i + 1) % segs.length === to) break; }
  const lens = idx.map(i => segs[i].kind === "line" ? hyp(segs[i].ctrl[0], segs[i].ctrl[1]) : bezLen(segs[i].ctrl));
  let best = null, before = 0;
  idx.forEach((i, j) => {
    const sg = segs[i];
    let d, part;
    if(sg.kind === "line"){ d = distSeg(p, sg.ctrl[0], sg.ctrl[1]); part = Math.min(hyp(sg.ctrl[0], p), lens[j]); }
    else { const f = bezNear(sg.ctrl, p); d = f.dist; part = bezLen(sg.ctrl, 0, f.u); }
    if(!best || d < best.d) best = {d, at: before + part};
    before += lens[j];
  });
  return best.at/before;
}

test("O14 a notch rides on its edge: on it, and at the same share of that edge when a point of the edge is dragged", () => {
  const sk = createSketch(), E = sk.add(createPath(T2P, T2K)), N = sk.add(createPoint([120, -12]));
  ok(sk.constrain("coincident", {id: E}, H(N, "p")).ok, "notch bám đường viền");
  let at = onOutline(sk.get(E), sk.get(N).p);
  ok(at.dist <= 1e-9, `nằm trên đường viền (cách ${at.dist})`); eq(at.span, 2, "trên khúc cong đầu của cạnh trên");
  const share = edgeShare(sk.get(E), sk.get(N).p, 2, 4);
  ok(sk.drag(H(E, "v3"), [95, 12]).ok, "kéo curve point của cạnh trên");
  at = onOutline(sk.get(E), sk.get(N).p);
  ok(at.dist <= 1e-9, `đường viền đổi dáng, notch vẫn trên nó (cách ${at.dist})`);
  near(edgeShare(sk.get(E), sk.get(N).p, 2, 4), share, 1e-7, "cùng tỉ lệ trên cạnh của nó (v2 → v4)");
  const before = sk.get(N).p;
  ok(sk.drag(H(E, "body"), [20, 10], {from: [0, 0]}).ok, "kéo thân đường viền");
  nearPt(sk.get(N).p, [before[0] + 20, before[1] + 10], 1e-9, "cả mảnh dời, notch dời theo");
  ok(sk.drag(H(N, "p"), [200, -100]).ok, "kéo notch");
  ok(onOutline(sk.get(E), sk.get(N).p).dist <= 1e-9, "kéo notch: trượt dọc đường viền, không rời nó");
  ok(sk.check().every(c => c.ok), "check() cũng đồng ý");
});

test("O14 a line's end on a point of the outline follows that point exactly", () => {
  const sk = createSketch(), E = sk.add(createPath(T2P, T2K)), L = sk.add(createLine([170, -30], [150, 20]));
  ok(sk.constrain("coincident", H(E, "v2"), H(L, "a")).ok);
  same(sk.get(L).a, T2P[2], "đầu line trùng góc v2");
  ok(sk.drag(H(E, "v2"), [190, -35]).ok);
  same(sk.get(L).a, [190, -35], "góc dời, đầu line đi theo, từng bit");
  same(sk.get(L).b, [150, 20], "đầu kia đứng yên");
});

test("O14 what an outline or a notch cannot be in a relation is refused, with the reason", () => {
  const sk = createSketch(), E = sk.add(createPath(T2P, T2K)), N = sk.add(createPoint([0, 0])), M = sk.add(createPoint([5, 5]));
  const L = sk.add(createLine([0, 10], [50, 10])), before = shot(sk);
  const no = (r, re, msg) => { ok(!r.ok, `${msg}: phải từ chối`); ok(re.test(r.reason), `${msg}: "${r.reason}"`); };
  no(sk.constrain("coincident", {point: [0, 0]}, H(E, "v0")), /đường viền|không phải điểm để bám|bên bám/, "đỉnh đường viền làm bên bám");
  no(sk.constrain("coincident", {id: L}, H(E, "body")), /không phải điểm để bám|bên bám/, "thân đường viền làm bên bám");
  no(sk.constrain("equal", {id: M}, {id: N}), /Equal/, "Equal hai notch");
  no(sk.constrain("equal", {id: L}, {id: E}), /Equal/, "Equal lên đường viền");
  no(sk.constrain("horizontal", {id: E}), /chỉ áp cho/, "Ngang cho đường viền");
  no(sk.constrain("vertical", {id: N}), /chỉ áp cho/, "Dọc cho notch");
  ok(sk.constrain("coincident", {id: E}, H(L, "a")).ok, "đầu line bám đường viền (được)");
  no(sk.constrain("tangent", {id: E}, {id: L, handle: "a"}), /Tangent/, "Tiếp tuyến với đường viền");
  ok(sk.constrain("coincident", H(E, "v1"), H(N, "p")).ok, "notch trùng một góc (được)");
  eq(sk.check().every(c => c.ok), true);
  ok(before !== shot(sk), "hai quan hệ hợp lệ đã vào");
});

test("O15 shapes snap to an outline: its points, its straight edges as lines, its curved spans as curves", () => {
  const sk = createSketch(), E = sk.add(createPath(T2P, T2K)), t = sk.targets(null);
  const r1 = snapHit([180.2, -150.1], t, 0.5); eq(r1.kind, "point"); same(r1.point, [180, -150], "hít góc v1");
  const r2 = snapHit([60, -150.3], t, 0.5); eq(r2.kind, "line"); nearPt(r2.point, [60, -150], 1e-9, "hít cạnh đáy");
  const top = outlineSegments(T2P, T2K)[2], q = bez(top.ctrl, 0.5);
  const r3 = snapHit([q[0], q[1] + 0.3], t, 0.5); eq(r3.kind, "curve", "cạnh trên là curve");
  ok(bezNear(top.ctrl, r3.point).dist <= 1e-9, "điểm hít nằm trên đường cong");
  const L = sk.add(createLine([10, 10], [20, 20]));
  const d = sk.drag(H(L, "a"), [0.2, -19.8], {targets: {points: [], shapes: []}, tol: 0.5});
  ok(d.ok && d.snap.kind === "point", "kéo đầu line tới gần góc v4 → hít");
  same(sk.get(L).a, [0, -20], "đúng góc v4, từng bit");
});

test("O15 an outline's point dragged near another shape snaps like the end of a line", () => {
  const sk = createSketch(), L = sk.add(createLine([300, 0], [300, 100])), E = sk.add(createPath(T2P, T2K));
  const r = sk.drag(H(E, "v2"), [299.7, 50], {targets: {points: [], shapes: []}, tol: 0.5});
  ok(r.ok, r.reason); eq(r.snap.kind, "line");
  same(sk.get(E).pts[2], [300, 50], "đỉnh v2 hít lên line x = 300");
  sk.remove(L);
  eq(sk.get(E).pts[2][0], 300, "xoá line: đường viền đứng yên");
});

test("O14 reshape: an outline replaced by another of its points' kinds — what rides on it follows, a wrong shape is refused", () => {
  const sk = createSketch(), E = sk.add(createPath(T2P, T2K)), N = sk.add(createPoint([120, -12]));
  ok(sk.constrain("coincident", {id: E}, H(N, "p")).ok);
  const was = sk.get(N).p;
  const r = sk.reshape(E, setPathKind(sk.get(E), 3, "turn"));
  ok(r.ok, r.reason); eq(sk.get(E).kinds[3], "turn", "v3 thành góc");
  const at = onOutline(sk.get(E), sk.get(N).p);
  ok(at.dist <= 1e-9, `notch vẫn trên đường viền mới (cách ${at.dist})`);
  /* its edge v2 → v4 is gone (split at the new corner): it stays at the point of the new outline nearest to
     where it was — no nearer point exists, by this file's own ruler */
  near(hyp(sk.get(N).p, was), onOutline(sk.get(E), was).dist, 1e-7, "chỗ gần chỗ cũ nhất");
  const before = shot(sk);
  const no = sk.reshape(E, createLine([0, 0], [1, 1]));
  ok(!no.ok && /đường viền/.test(no.reason), `thay bằng hình khác loại → từ chối: ${no.reason}`);
  ok(!sk.reshape(N, createPoint([0, 0])).ok, "chỉ đường viền mới reshape");
  eq(shot(sk), before, "bị từ chối thì không gì đổi");
});

test("O14 a notch on one edge does not move a single bit when another edge is reshaped; on its own edge it keeps its share", () => {
  const sk = createSketch(), E = sk.add(createPath(T2P, T2K));
  const B = sk.add(createPoint([60, -151])), T = sk.add(createPoint([120, -12]));
  ok(sk.constrain("coincident", {id: E}, H(B, "p")).ok && sk.constrain("coincident", {id: E}, H(T, "p")).ok);
  const b0 = sk.get(B).p;
  ok(sk.drag(H(E, "v3"), [95, 12]).ok, "kéo curve point của cạnh trên");
  same(sk.get(B).p, b0, "notch cạnh đáy đứng yên, từng bit");
  ok(sk.drag(H(E, "v4"), [-5, -10]).ok, "kéo góc v4 (cạnh trên và cạnh trái)");
  same(sk.get(B).p, b0, "vẫn đứng yên");
  ok(sk.drag(H(E, "v1"), [200, -150]).ok, "kéo góc v1: cạnh đáy dài ra 180 → 200 mm");
  nearPt(sk.get(B).p, [200/3, -150], 1e-9, "giữ tỉ lệ trên cạnh đáy: 60/180 của 200 mm");
  ok(sk.check().every(c => c.ok));
});

test("O14 a line's end held on an outline's edge rides on that edge too: another edge reshaped, it stays bit for bit", () => {
  const sk = createSketch(), E = sk.add(createPath(T2P, T2K)), L = sk.add(createLine([60, -140], [60, -100]));
  ok(sk.constrain("coincident", {id: E}, H(L, "a")).ok, "đầu line bám cạnh đáy");
  const a0 = sk.get(L).a;
  nearPt(a0, [60, -150], 1e-9, "chân vuông góc trên cạnh đáy");
  ok(sk.drag(H(E, "v3"), [95, 12]).ok);
  same(sk.get(L).a, a0, "kéo điểm cong cạnh trên: đầu line đứng yên, từng bit");
  ok(sk.drag(H(E, "v1"), [200, -150]).ok);
  nearPt(sk.get(L).a, [200/3, -150], 1e-9, "cạnh đáy dài ra 200 mm: giữ tỉ lệ 60/180");
  same(sk.get(L).b, [60, -100], "đầu kia đứng yên");
});

/* 2026-09-24 — the Vẽ tool now hands drag() EVERY target, the other drawn shapes too, as they are shown and brought into the
   frame of the shape dragged (a shape of another piece laid out apart is not where its coordinates say): {own: false} keeps
   the sketch from adding its own, which are in each shape's own frame */
test("B7 drag with {own: false}: only the targets handed in — the sketch's other shapes are not added", () => {
  const sk = createSketch();
  const L = sk.add(createLine([0, 0], [100, 0])), M = sk.add(createLine([200, 0.2], [250, 40]));
  let r = sk.drag(H(L, "b"), [200.1, 0.1], {tol: 0.5, own: false});
  ok(r.ok, r.reason); eq(r.snap.kind, "free", "đầu của M không phải đích khi own: false");
  same(sk.get(L).b, [200.1, 0.1], "đúng chỗ bấm");
  r = sk.drag(H(L, "b"), [230.1, 0.1], {tol: 0.5, own: false, targets: {points: [[230, 0]], shapes: []}});
  eq(r.snap.kind, "point"); same(sk.get(L).b, [230, 0], "đích được đưa vào: hít");
  r = sk.drag(H(L, "b"), [200.1, 0.1], {tol: 0.5});
  eq(r.snap.kind, "point", "mặc định: như trước, hình khác của sketch là đích"); same(sk.get(L).b, [200, 0.2], "hít đầu M");
});
