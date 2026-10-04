/* The smart pen's constructions (spec: geometry/construct.md, K1–K6): edges · parallel · compass · rulers · offset point.

   Every expected value is worked out HERE — a 3-4-5 triangle, a square inside a square, the circle through (±4, 3),
   distances by this file's own point-to-segment loop — never asked of the kernel it checks. */
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {polylineEdges, nearestEdge, parallelOf, compassPoint, TSQUARE_DIRS, squareDirs, lockTo, offsetPoint} from "./construct.js";
import {point, line, arc, curve} from "./model.js";
import {bezier} from "./spline.js";

const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const same = (a, b) => Object.is(a[0], b[0]) && Object.is(a[1], b[1]);
const nearPt = (a, b, tol, msg) => ok(hyp(a, b) <= tol, `${msg}: [${a}] cách [${b}] ${hyp(a, b)} > ${tol}`);
const throwsLike = (fn, re, msg) => {
  let err = null; try{ fn(); }catch(e){ err = e; }
  ok(err, `${msg}: phải từ chối`); ok(err && re.test(err.message), `${msg}: lời từ chối "${err && err.message}" không khớp ${re}`);
};
function distSeg(p, a, b){
  const d = [b[0] - a[0], b[1] - a[1]], dd = d[0]*d[0] + d[1]*d[1];
  const t = dd ? Math.max(0, Math.min(1, ((p[0] - a[0])*d[0] + (p[1] - a[1])*d[1])/dd)) : 0;
  return Math.hypot(p[0] - a[0] - d[0]*t, p[1] - a[1] - d[1]*t);
}
function distPoly(p, pts, closed){
  let best = Infinity;
  const n = pts.length;
  for(let i = 0; i < n - (closed ? 0 : 1); i++) best = Math.min(best, distSeg(p, pts[i], pts[(i + 1) % n]));
  return best;
}
/* an arc of radius r about c, from a0 to a1 degrees, as n + 1 points */
const arcPts = (c, r, a0, a1, n) => Array.from({length: n + 1}, (_, k) => {
  const a = (a0 + (a1 - a0)*k/n)*Math.PI/180; return [c[0] + r*Math.cos(a), c[1] + r*Math.sin(a)];
});
const RECT = [[0, 0], [100, 0], [100, 60], [0, 60]];

/* ── K1 ────────────────────────────────────────────────────────────────────────────── */
test("K1 a rectangle ring has four edges, its sides, vertex for vertex, covering the ring", () => {
  const es = polylineEdges(RECT, true);
  eq(es.length, 4);
  es.forEach((e, i) => {
    eq(e.closed, false, `cạnh ${i} không phải vòng`);
    deepEq(e.pts, [RECT[i], RECT[(i + 1) % 4]], `cạnh ${i}`);
    eq(e.a, i); eq(e.b, (i + 1) % 4);
  });
});

test("K1 an open L has two edges split at its elbow; a smooth arc is one edge; a ring with no corner is one closed edge", () => {
  const L = [[0, 0], [25, 0], [50, 0], [50, 20], [50, 40]];
  const es = polylineEdges(L, false);
  eq(es.length, 2);
  deepEq(es[0].pts, [[0, 0], [25, 0], [50, 0]]); deepEq(es[1].pts, [[50, 0], [50, 20], [50, 40]]);
  const A = arcPts([0, 0], 100, 0, 90, 90), ea = polylineEdges(A, false);
  eq(ea.length, 1, "cung trơn: một cạnh"); eq(ea[0].pts.length, 91);
  const C = arcPts([0, 0], 50, 0, 360, 120).slice(0, -1), ec = polylineEdges(C, true);
  eq(ec.length, 1, "vòng không góc: một cạnh"); eq(ec[0].closed, true); eq(ec[0].pts.length, 120);
  ok(ec[0].pts.every((p, i) => same(p, C[i])), "đúng các đỉnh, từng bit");
});

test("K1 nearestEdge: the edge nearest the pointer, its distance and foot, by this file's point-to-segment loop", () => {
  const es = polylineEdges(RECT, true);
  const n = nearestEdge(es, [97, 33]);
  eq(n.index, 1, "cạnh phải"); near(n.dist, 3, 1e-12); nearPt(n.foot, [100, 33], 1e-12, "chân vuông góc");
  const m = nearestEdge(es, [-4, -3]);
  eq(m.index, 0, "gần góc (0,0): hoà thì cạnh đứng trước"); near(m.dist, 5, 1e-12);
});

/* ── K2 ────────────────────────────────────────────────────────────────────────────── */
test("K2 a straight edge: the parallel is the chord moved d along its normal, on the pointer's side — exact", () => {
  const up = parallelOf({pts: [[0, 0], [100, 0]], closed: false}, [30, 10], null);
  ok(up.ok, up.reason); eq(up.kind, "line"); eq(up.d, 10); eq(up.side, "left");
  deepEq(up.pts, [[0, 10], [100, 10]]);
  const down = parallelOf({pts: [[0, 0], [100, 0]], closed: false}, [30, -2], 6);
  ok(down.ok); eq(down.side, "right"); deepEq(down.pts, [[0, -6], [100, -6]], "Cách 6 phía dưới");
  /* a 3-4-5 slope: the left normal of (30, 40)/50 is (−0.8, 0.6) */
  const s = parallelOf({pts: [[0, 0], [30, 40]], closed: false}, [-10, 30], 5);
  ok(s.ok); eq(s.kind, "line");
  nearPt(s.pts[0], [-4, 3], 1e-12, "đầu"); nearPt(s.pts[1], [26, 43], 1e-12, "cuối");
  /* straight to 0.01 mm with points between: still a line, from the first point's to the last point's image */
  const z = parallelOf({pts: [[0, 0], [50, 0.004], [100, 0]], closed: false}, [50, 20], 5);
  eq(z.kind, "line"); nearPt(z.pts[0], [0, 5], 1e-12, "đầu"); nearPt(z.pts[1], [100, 5], 1e-12, "cuối");
});

/* the parallel's own properties, by this file's rulers (construct.md K2): every vertex exactly d from the source, every point of
   it within [d − 0.005, d] (dense samples along each of its segments), no vertex of the source nearer to it than d − 0.005 */
function isParallel(res, src, closed, d, msg){
  res.forEach((p, i) => near(distPoly(p, src, closed), d, 1e-9, `${msg}: đỉnh ${i} cách gốc`));
  const n = res.length;
  for(let i = 0; i < n - (closed ? 0 : 1); i++){
    const a = res[i], b = res[(i + 1) % n];
    for(let k = 1; k < 8; k++){
      const q = [a[0] + (b[0] - a[0])*k/8, a[1] + (b[1] - a[1])*k/8], e = distPoly(q, src, closed);
      ok(e >= d - 0.005 - 1e-9 && e <= d + 1e-9, `${msg}: điểm giữa đoạn ${i} cách gốc ${e}, ngoài [d − 0.005, d]`);
    }
  }
  /* a chord of a round join falls inside its arc by ≤ 0.005 mm, so a convex vertex of the source may be that much nearer */
  src.forEach((p, i) => ok(distPoly(p, res, closed) >= d - 0.005 - 1e-9, `${msg}: đỉnh gốc ${i} gần đường mới hơn d − 0.005 (${distPoly(p, res, closed)})`));
}

test("K2 a bent edge: a concave elbow is where the two parallels meet, a convex one an arc of radius d about the vertex", () => {
  const L = [[0, 0], [50, 0], [50, 40]];
  /* left of the walk is the inside of this left turn: the elbow is concave there */
  const inn = parallelOf({pts: L, closed: false}, [40, 10], 5);
  ok(inn.ok, inn.reason); eq(inn.kind, "polyline"); eq(inn.side, "left");
  eq(inn.pts.length, 3);
  [[0, 5], [45, 5], [45, 40]].forEach((w, i) => nearPt(inn.pts[i], w, 1e-12, `trong: đỉnh ${i}`));
  isParallel(inn.pts, L, false, 5, "khuỷu lõm");
  /* right of it is the outside: an arc about (50, 0) from (50, −5) to (55, 0) */
  const out = parallelOf({pts: L, closed: false}, [20, -3], 5);
  ok(out.ok, out.reason); eq(out.side, "right");
  nearPt(out.pts[0], [0, -5], 1e-12, "đầu"); nearPt(out.pts[out.pts.length - 1], [55, 40], 1e-12, "cuối");
  ok(out.pts.some(p => hyp(p, [50, -5]) <= 1e-12) && out.pts.some(p => hyp(p, [55, 0]) <= 1e-12), "hai đầu cung");
  const onArc = out.pts.filter(p => p[0] > 50 + 1e-9 && p[1] < -1e-9);
  ok(onArc.length >= 10, `cung 90° bán kính 5, dây hụt ≤ 0.005 mm: cần ≥ 10 điểm giữa, có ${onArc.length}`);
  onArc.forEach((p, i) => near(hyp(p, [50, 0]), 5, 1e-12, `điểm cung ${i} cách đỉnh đúng 5`));
  isParallel(out.pts, L, false, 5, "khuỷu lồi");
});

test("K2 a curved edge (a 100 mm arc sampled every degree): outside and inside, every vertex exactly d, the ends moved d along the end normals", () => {
  const A = arcPts([0, 0], 100, 0, 90, 90);
  /* the end moves d along the normal of the FIRST SEGMENT (not of the circle it was sampled from): this file's own unit normal */
  const u0 = [A[1][0] - A[0][0], A[1][1] - A[0][1]], L0 = Math.hypot(u0[0], u0[1]), n0 = [u0[1]/L0, -u0[0]/L0];   // right of the walk
  for(const [w, name, k] of [[[120, 20], "ngoài", 6], [[60, 20], "trong", -6]]){
    const r = parallelOf({pts: A, closed: false}, w, 6);
    ok(r.ok, r.reason); eq(r.kind, "polyline", name);
    nearPt(r.pts[0], [A[0][0] + k*n0[0], A[0][1] + k*n0[1]], 1e-9, `${name}: đầu`);
    isParallel(r.pts, A, false, 6, name);
  }
});

test("K2 a closed ring: the parallel ring, inside or outside by where the pointer is", () => {
  const C = arcPts([0, 0], 50, 0, 360, 180).slice(0, -1);
  const out = parallelOf({pts: C, closed: true}, [70, 0], null);
  ok(out.ok, out.reason); eq(out.kind, "ring"); eq(out.side, "out");
  near(out.d, 20, 1e-9, "d = 20: con trỏ (70, 0) gần nhất đỉnh (50, 0) của vòng — hai dây cung kề đều quay đi");
  isParallel(out.pts, C, true, out.d, "ngoài");
  const inn = parallelOf({pts: C, closed: true}, [10, 0], 8);
  ok(inn.ok); eq(inn.side, "in");
  isParallel(inn.pts, C, true, 8, "trong");
  ok(inn.pts.every(p => hyp(p, [0, 0]) < 43), "phía trong: vòng nhỏ lại");
  const sq = parallelOf({pts: RECT, closed: true}, [50, 30], 6);
  ok(sq.ok); eq(sq.side, "in"); eq(sq.pts.length, 4, "chữ nhật phía trong: bốn góc lõm, bốn giao điểm");
  for(const want of [[6, 6], [94, 6], [94, 54], [6, 54]]) ok(sq.pts.some(p => hyp(p, want) <= 1e-12), `có góc ${want}`);
  const so = parallelOf({pts: RECT, closed: true}, [50, -10], 6);
  ok(so.ok); eq(so.side, "out");
  for(const want of [[-6, 0], [0, -6], [100, -6], [106, 0], [106, 60], [100, 66], [0, 66], [-6, 60]])
    ok(so.pts.some(p => hyp(p, want) <= 1e-12), `phía ngoài: góc bo cung có đầu ${want}`);
  isParallel(so.pts, RECT, true, 6, "chữ nhật ngoài");
});

test("K2 an arc and a circle: concentric, radius r ± d, the same angles", () => {
  const a = {arc: {c: [0, 0], r: 50, a0: 0, a1: Math.PI/2, ccw: true}};
  const i = parallelOf(a, [10, 10], 5);
  ok(i.ok); eq(i.kind, "arc"); eq(i.side, "in"); eq(i.arc.r, 45); eq(i.arc.a0, 0); eq(i.arc.a1, Math.PI/2); deepEq(i.arc.c, [0, 0]);
  const o = parallelOf(a, [60, 60], null);
  ok(o.ok); eq(o.side, "out"); near(o.arc.r, Math.hypot(60, 60), 1e-12); near(o.d, Math.hypot(60, 60) - 50, 1e-12);
  const c = {circle: {c: [10, 10], r: 20}};
  const co = parallelOf(c, [10, 40], null);
  ok(co.ok); eq(co.kind, "circle"); eq(co.circle.r, 30); eq(co.d, 10); deepEq(co.circle.c, [10, 10]);
  const ci = parallelOf(c, [10, 15], null);
  ok(ci.ok); eq(ci.side, "in"); eq(ci.circle.r, 5);
});

/* ── K3 ────────────────────────────────────────────────────────────────────────────── */
test("K3 refused, with why: a distance of 0, a pointer on the edge, a parallel that shrinks to nothing", () => {
  const no = (r, re, msg) => { ok(!r.ok, `${msg}: phải từ chối`); ok(re.test(r.reason), `${msg}: "${r.reason}"`); };
  no(parallelOf({pts: [[0, 0], [100, 0]], closed: false}, [30, 0], null), /cách 0|nằm trên/, "con trỏ trên cạnh, không gõ Cách");
  no(parallelOf({pts: [[0, 0], [100, 0]], closed: false}, [30, 0], 5), /nằm trên|phía/, "con trỏ trên cạnh: không biết phía");
  no(parallelOf({pts: [[0, 0], [100, 0]], closed: false}, [30, 4], 0), /cách 0/, "Cách 0");
  no(parallelOf({circle: {c: [0, 0], r: 20}}, [0, 5], 20), /co mất|bán kính/, "tròn: d = bán kính");
  no(parallelOf({arc: {c: [0, 0], r: 50, a0: 0, a1: 1, ccw: true}}, [5, 5], 60), /co mất|bán kính/, "cung: d > bán kính");
  no(parallelOf({pts: RECT, closed: true}, [50, 30], 30), /co mất/, "chữ nhật cao 60, d = 30 phía trong");
  no(parallelOf({pts: RECT, closed: true}, [50, 30], 35), /co mất/, "d = 35 phía trong");
  const semi = arcPts([0, 0], 10, 0, 180, 60);
  no(parallelOf({pts: semi, closed: false}, [0, 3], 15), /co mất/, "nửa vòng r 10, phía trong 15");
  no(parallelOf({pts: [[0, 0]], closed: false}, [5, 5], 3), /ít nhất 2/, "một điểm");
});

/* ── K4 ────────────────────────────────────────────────────────────────────────────── */
test("K4 compass: the circle of radius R about c meets the shapes — the meeting nearest the release, exactly R from c", () => {
  const L = [line(point(-10, 3), point(10, 3))];
  const r = compassPoint([0, 0], 5, L, [4.2, 3.1]);
  ok(r.ok, r.reason); nearPt(r.point, [4, 3], 1e-12, "(4, 3)"); near(hyp(r.point, [0, 0]), 5, 1e-12);
  nearPt(compassPoint([0, 0], 5, L, [-3, 2]).point, [-4, 3], 1e-12, "thả bên trái: (−4, 3)");
  const A = [arc(point(6, 0), 5, 0, 2*Math.PI, true)];
  nearPt(compassPoint([0, 0], 5, A, [3, 5]).point, [3, 4], 1e-9, "tròn tâm (6, 0) r 5: (3, 4)");
  nearPt(compassPoint([0, 0], 5, [curve([[-10, 3], [0, 3], [10, 3]], false)], [5, 3]).point, [4, 3], 1e-12, "polyline");
  const S = [bezier([[-10, 3], [-3, 3], [3, 3], [10, 3]])];
  const s = compassPoint([0, 0], 5, S, [4, 3]);
  ok(s.ok, s.reason); nearPt(s.point, [4, 3], 1e-3, "spline: ≤ 0.001 mm"); near(hyp(s.point, [0, 0]), 5, 1e-3);
});

test("K4 compass refused, with the nearest and farthest distance; R must be a length > 0", () => {
  const L = [line(point(-10, 3), point(10, 3))];
  const r = compassPoint([0, 0], 2, L, [0, 3]);
  ok(!r.ok); near(r.nearest, 3, 1e-12, "gần nhất 3"); near(r.farthest, Math.hypot(10, 3), 1e-12, "xa nhất √109");
  ok(/3|tới/.test(r.reason), r.reason);
  ok(!compassPoint([0, 0], 20, L, [0, 3]).ok, "R dài hơn mọi điểm");
  for(const R of [0, -1, NaN, Infinity]) ok(!compassPoint([0, 0], R, L, [0, 3]).ok, `R = ${R}`);
});

/* ── K5 ────────────────────────────────────────────────────────────────────────────── */
test("K5 the T-square: eight directions, exact on the axes; the set square: ±AB and ±⊥AB", () => {
  const S = Math.SQRT1_2;
  deepEq(TSQUARE_DIRS, [[1, 0], [S, S], [0, 1], [-S, S], [-1, 0], [-S, -S], [0, -1], [S, -S]]);
  const q = squareDirs([1, 1], [4, 5]);
  nearPt(q[0], [0.6, 0.8], 1e-15, "AB"); nearPt(q[1], [-0.6, -0.8], 1e-15, "−AB");
  nearPt(q[2], [-0.8, 0.6], 1e-15, "⊥AB (AB quay +90°)"); nearPt(q[3], [0.8, -0.6], 1e-15, "−⊥AB");
  throwsLike(() => squareDirs([2, 2], [2, 2]), /trùng|dài 0/, "A trùng B");
});

test("K5 lockTo: the direction nearest the pointer, at the pointer's projection — or at the typed length", () => {
  const a = lockTo([10, 10], [20, 11], TSQUARE_DIRS);
  eq(a.index, 0); ok(same(a.point, [20, 10]), "ngang: [20, 10] đúng tuyệt đối");
  const b = lockTo([10, 10], [10.5, 3], TSQUARE_DIRS);
  eq(b.index, 6); ok(same(b.point, [10, 3]), "dọc xuống: [10, 3], dx đúng 0");
  const c = lockTo([10, 10], [13, 13.5], TSQUARE_DIRS);
  eq(c.index, 1, "gần 45° nhất"); near(c.point[0], 13.25, 1e-12); near(c.point[1], 13.25, 1e-12);
  ok(same(lockTo([10, 10], [20, 11], TSQUARE_DIRS, 5).point, [15, 10]), "Length 5");
  eq(lockTo([10, 10], [10, 10], TSQUARE_DIRS), null, "con trỏ trên điểm trước, không Length");
  const q = squareDirs([0, 0], [3, 4]);
  const d = lockTo([10, 10], [6, 13], q);
  eq(d.index, 2, "vuông góc"); nearPt(d.point, [6, 13], 1e-12, "đúng (6, 13)");
  const e = lockTo([10, 10], [16, 18.1], q);
  eq(e.index, 0, "song song"); nearPt(e.point, [10 + 0.6*10.08, 10 + 0.8*10.08], 1e-12, "hình chiếu 0.6·6 + 0.8·8.1 = 10.08");
});

/* ── K6 ────────────────────────────────────────────────────────────────────────────── */
test("K6 offsetPoint: one addition per axis; not a finite number → refused", () => {
  deepEq(offsetPoint([1.5, 2], -0.25, 3), [1.25, 5]);
  deepEq(offsetPoint([0.1, 0.2], 0.2, 0.1), [0.1 + 0.2, 0.2 + 0.1]);
  throwsLike(() => offsetPoint([0, 0], NaN, 1), /không hợp lệ/, "NaN");
  throwsLike(() => offsetPoint([0, 0], 1, Infinity), /không hợp lệ/, "vô cực");
});
