/* The five shapes TD listed — Line · Curve · Rectangle · Circle · Polygon — one at a time
   (spec: sketch.md §3.1 Create · §3.2 Drag · §3.4 Numerical input).

   Every expected value is worked out HERE, not asked of the kernel: the side of a hexagon is
   its radius, a rectangle's sides are summed with a plain loop, a Bezier is evaluated by this
   file's own de Casteljau and measured by its own Simpson rule (the kernel integrates with
   Gauss–Legendre), lengths typed in inches are 25.4 × the number on paper. */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {createLine, createLinePolar, createCurve, createRect, createCircle, createPolygon, ENTITY_TYPES,
        entityHandles, entityShape, entitySnap, entityDims, dragEntity, moveEntity, setEntityDim,
        PIECE_ENTITY_TYPES, createPath, createPoint, setPathKind} from "./entity.js";
import {length, sample} from "./model.js";
import {polar} from "./deform.js";
import {parseLength} from "../../shared/units.js";

/* ── plain helpers: the rulers of this file ─────────────────────────────────── */
const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const RAD = Math.PI/180;
const dirDeg = (a, b) => { const d = Math.atan2(b[1] - a[1], b[0] - a[0])/RAD; return d < 0 ? d + 360 : d; };
const same = (a, b, msg) => ok(Object.is(a[0], b[0]) && Object.is(a[1], b[1]), `${msg}: [${a}] ≠ [${b}] (từng bit)`);
const nearPt = (a, b, tol, msg) => ok(hyp(a, b) <= tol, `${msg}: [${a}] cách [${b}] ${hyp(a, b)} > ${tol}`);
const throwsLike = (fn, re, msg) => {
  let err = null; try{ fn(); }catch(e){ err = e; }
  ok(err, `${msg}: phải từ chối`); ok(re.test(err.message), `${msg}: lời từ chối "${err.message}" không khớp ${re}`);
};
function shoelace(pts){ let a = 0; for(let i = 0; i < pts.length; i++){ const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0]*q[1] - q[0]*p[1]; } return a/2; }
function sides(pts){ return pts.map((p, i) => hyp(p, pts[(i + 1) % pts.length])); }
/* interior angle at each vertex of a counter-clockwise ring, by acos of the two edge vectors */
function interior(pts){
  return pts.map((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length], c = pts[(i + 1) % pts.length];
    const u = [a[0] - p[0], a[1] - p[1]], v = [c[0] - p[0], c[1] - p[1]];
    return Math.acos((u[0]*v[0] + u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)))/RAD;
  });
}
/* cubic Bezier by de Casteljau, its derivative, and its length by composite Simpson */
function bez(P, t){
  const l = (p, q) => [p[0] + (q[0] - p[0])*t, p[1] + (q[1] - p[1])*t];
  const a = l(P[0], P[1]), b = l(P[1], P[2]), c = l(P[2], P[3]), d = l(a, b), e = l(b, c);
  return l(d, e);
}
function bezD(P, t){
  const s = 1 - t, k = [3*s*s, 6*s*t, 3*t*t];
  return [0, 1].map(j => k[0]*(P[1][j] - P[0][j]) + k[1]*(P[2][j] - P[1][j]) + k[2]*(P[3][j] - P[2][j]));
}
function bezLen(P, n = 4096){
  const f = t => Math.hypot(...bezD(P, t));
  let s = f(0) + f(1);
  for(let i = 1; i < n; i++) s += (i % 2 ? 4 : 2)*f(i/n);
  return s/(3*n);
}
const verts = e => entityHandles(e).filter(h => /^v\d+$/.test(h.name)).map(h => h.at);
const handle = (e, name) => entityHandles(e).find(h => h.name === name).at;
/* a frozen entity: editing it in place would throw (ES modules are strict) */
function deepFreeze(o){ if(o && typeof o === "object"){ Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; }

/* ── T — Rule 1: create with real dimensions ─────────────────────────────────── */
test("ENTITY_TYPES: the five shapes of TD's table, in its order", () => {
  deepEq(ENTITY_TYPES, ["line", "curve", "rect", "circle", "polygon"]);
});

test("T1 Line Start → End: the two ends are exactly the two points", () => {
  const A = [10.1, 20.7], B = [110.5, 60.25], L = createLine(A, B);
  eq(L.type, "line");
  same(L.a, A, "Start"); same(L.b, B, "End");
  const s = entityShape(L);
  eq(s.kind, "line"); same([s.a.x, s.a.y], A, "hình kernel: Start"); same([s.b.x, s.b.y], B, "hình kernel: End");
  near(entityDims(L).length, Math.hypot(100.4, 39.55), 1e-12, "Length đo bằng hypot trong test");
});

test("T1 Line Length + Angle: |AB| = L and A→B points at Angle (counter-clockwise from +X)", () => {
  const A = [3.5, -7.25];
  for(const [Lmm, deg] of [[127, 30], [50, 0], [50, 90], [50, 180], [50, 270], [33.3, 123.4], [10, -45], [80, 405]]){
    const L = createLinePolar(A, Lmm, deg);
    same(L.a, A, `Start (${Lmm}, ${deg}°)`);
    near(hyp(L.a, L.b), Lmm, 1e-9, `|AB| (${Lmm}, ${deg}°)`);
    const want = ((deg % 360) + 360) % 360;
    near(dirDeg(L.a, L.b), want, 1e-9, `hướng (${Lmm}, ${deg}°)`);
    near(entityDims(L).angle, want, 1e-9, `Angle đọc lại (${deg}°)`);
  }
});

test("T1 a multiple of 90° is exactly horizontal or vertical — dy or dx is 0, not 6e-15", () => {
  const A = [12.3, 45.6];
  ok(Object.is(createLinePolar(A, 50, 0).b[1], A[1]), "0°: dy = 0");
  ok(Object.is(createLinePolar(A, 50, 180).b[1], A[1]), "180°: dy = 0");
  ok(Object.is(createLinePolar(A, 50, 90).b[0], A[0]), "90°: dx = 0");
  ok(Object.is(createLinePolar(A, 50, 270).b[0], A[0]), "270°: dx = 0");
  ok(Object.is(createLinePolar(A, 50, -90).b[0], A[0]), "−90°: dx = 0");
});

test("T2 Curve Start → End: through both ends, straight until a control point is pulled", () => {
  const p0 = [0, 0], p3 = [90, 30], C = createCurve(p0, p3);
  eq(C.type, "curve");
  same(C.p0, p0, "Start"); same(C.p3, p3, "End");
  same(C.c1, [0 + 90/3, 0 + 30/3], "control point 1 ở 1/3 dây cung");
  same(C.c2, [0 + 2*90/3, 0 + 2*30/3], "control point 2 ở 2/3 dây cung");
  const P = [C.p0, C.c1, C.c2, C.p3];
  for(let t = 0.1; t < 1; t += 0.1){
    const q = bez(P, t);
    near((q[0] - p0[0])*30 - (q[1] - p0[1])*90, 0, 1e-9, `điểm t=${t.toFixed(1)} nằm trên dây cung`);
  }
  near(entityDims(C).length, Math.hypot(90, 30), 1e-9, "dài = dây cung");
  const s = entityShape(C);
  eq(s.kind, "spline"); eq(s.degree, 3); deepEq(s.ctrl, P);
});

test("T2 Curve with its control points: length = this file's Simpson integral", () => {
  const P = [[0, 0], [20, 60], [80, 60], [100, 0]];
  const C = createCurve(P[0], P[3], P[1], P[2]);
  deepEq([C.p0, C.c1, C.c2, C.p3], P);
  near(entityDims(C).length, bezLen(P), 1e-9, "chiều dài Bezier");
  near(entityDims(C).chord, 100, 1e-12, "dây cung");
  near(entityDims(C).startAngle, dirDeg(P[0], P[1]), 1e-9, "hướng rời Start = hướng control point 1");
  near(entityDims(C).endAngle, dirDeg(P[2], P[3]), 1e-9, "hướng tới End = từ control point 2");
  near(length(entityShape(C)), bezLen(P), 1e-9, "hình kernel đo cùng số");
});

test("T3 Rectangle W × H: sides W H W H, four right angles, perimeter, area, anchored at the placing point", () => {
  const R = createRect([5, 7], 120, 45), v = verts(R);
  eq(R.type, "rect");
  deepEq(v, [[5, 7], [125, 7], [125, 52], [5, 52]]);
  deepEq(sides(v), [120, 45, 120, 45]);
  for(const a of interior(v)) near(a, 90, 1e-12, "góc vuông");
  near(sides(v).reduce((s, x) => s + x, 0), 330, 1e-12, "chu vi 2(W+H)");
  near(shoelace(v), 5400, 1e-9, "diện tích W·H, ngược chiều kim đồng hồ");
  const d = entityDims(R);
  deepEq([d.w, d.h, d.perimeter, d.area], [120, 45, 330, 5400]);
  const s = entityShape(R);
  eq(s.kind, "curve"); eq(s.closed, true); deepEq(s.pts, v);
});

test("T4 Circle Diameter: every point is D/2 from the centre, the circumference is πD", () => {
  const c = [40, -10], D = 25.4, O = createCircle(c, D);
  eq(O.type, "circle");
  const s = entityShape(O);
  eq(s.kind, "arc"); ok(Object.is(s.r, D/2), "bán kính = D/2 từng bit"); same([s.c.x, s.c.y], c, "tâm");
  const pts = sample(s, 0.001);
  ok(pts.length > 100, "đủ điểm để đo");
  for(const p of pts) near(hyp(p, c), 12.7, 1e-12, "cách tâm D/2");
  near(length(s), Math.PI*25.4, 1e-12, "chu vi πD");
  const d = entityDims(O);
  near(d.d, 25.4, 0); near(d.r, 12.7, 0); near(d.circumference, Math.PI*25.4, 1e-12); near(d.area, Math.PI*12.7*12.7, 1e-9);
});

test("T5 Polygon Size + sides: vertices on the circumscribed circle, equal sides, (n−2)·180/n inside, flat bottom", () => {
  const c = [0, 0], S = 60, R = 30;
  for(const n of [3, 4, 5, 6, 8, 12]){
    const G = createPolygon(c, S, n), v = verts(G);
    eq(G.type, "polygon"); eq(v.length, n, `${n} đỉnh`);
    for(const p of v) near(hyp(p, c), R, 1e-9, `n=${n}: đỉnh cách tâm Size/2`);
    const side = 2*R*Math.sin(Math.PI/n);                     // chord of the angle 2π/n
    for(const L of sides(v)) near(L, side, 1e-9, `n=${n}: cạnh`);
    for(const a of interior(v)) near(a, (n - 2)*180/n, 1e-9, `n=${n}: góc trong`);
    const ys = v.map(p => p[1]).sort((a, b) => a - b);
    near(ys[0], ys[1], 1e-9, `n=${n}: cạnh đáy nằm ngang`);
    near(ys[0], -R*Math.cos(Math.PI/n), 1e-9, `n=${n}: đáy cách tâm đúng bán kính nội tiếp`);
    ok(shoelace(v) > 0, `n=${n}: ngược chiều kim đồng hồ`);
    near(entityDims(G).area, shoelace(v), 1e-9, `n=${n}: diện tích = công thức shoelace`);
    near(entityDims(G).side, side, 1e-9); near(entityDims(G).perimeter, n*side, 1e-9);
  }
  near(sides(verts(createPolygon(c, S, 6)))[0], R, 1e-9, "lục giác: cạnh = bán kính");
});

test("T5 Polygon Angle turns it about the centre, counter-clockwise; the angle is kept in [0, 360)", () => {
  const c = [10, 10], base = verts(createPolygon(c, 40, 4)), turned = verts(createPolygon(c, 40, 4, 30));
  const rot = ([x, y]) => [c[0] + (x - c[0])*Math.cos(30*RAD) - (y - c[1])*Math.sin(30*RAD),
                           c[1] + (x - c[0])*Math.sin(30*RAD) + (y - c[1])*Math.cos(30*RAD)];
  base.forEach((p, i) => nearPt(turned[i], rot(p), 1e-9, `đỉnh ${i} xoay 30°`));
  near(entityDims(createPolygon(c, 40, 4, 390)).angle, 30, 1e-12, "390° → 30°");
  near(entityDims(createPolygon(c, 40, 4, -330)).angle, 30, 1e-12, "−330° → 30°");
});

test("T6 real size, not pixels: the same millimetres give the same shape bit for bit, typed in any unit", () => {
  const Ls = [parseLength("5", "inch"), parseLength("127", "mm"), parseLength("12.7", "cm"), parseLength("5 in", "mm")];
  for(const L of Ls) deepEq(createLinePolar([0, 0], L, 0), createLinePolar([0, 0], 127, 0), `127 mm gõ kiểu khác`);
  deepEq(createRect([0, 0], parseLength("10 cm", "inch"), parseLength("50mm", "inch")), createRect([0, 0], 100, 50));
  /* the kernel has no pixel, zoom or window in it to depend on (§5.17): scan its code */
  for(const f of ["entity.js", "sketch.js"]){
    const code = readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    ok(!/\bpx\b|zoom|\bppm\b|pxPerMM|Canvas|devicePixelRatio|clientX/.test(code), `${f} không được biết px/zoom/canvas`);
  }
});

test("T7 what is not a shape is refused, and nothing is made", () => {
  throwsLike(() => createLine([1, 2], [1, 2]), /dài 0/, "Start trùng End");
  for(const L of [0, -5, NaN, Infinity, "10"]) throwsLike(() => createLinePolar([0, 0], L, 0), /không hợp lệ/, `Length ${L}`);
  throwsLike(() => createLinePolar([0, 0], 10, NaN), /không hợp lệ/, "Angle NaN");
  throwsLike(() => createCurve([5, 5], [5, 5]), /trùng/, "Curve Start trùng End");
  throwsLike(() => createCurve([0, 0], [9, 9], [NaN, 1]), /không hợp lệ/, "control point NaN");
  for(const [w, h] of [[0, 10], [10, -1], [NaN, 5], [5, Infinity]]) throwsLike(() => createRect([0, 0], w, h), /không hợp lệ/, `W×H ${w}×${h}`);
  for(const D of [0, -3, NaN, Infinity]) throwsLike(() => createCircle([0, 0], D), /không hợp lệ/, `D ${D}`);
  for(const n of [2, 3.5, "6", 1001, NaN]) throwsLike(() => createPolygon([0, 0], 10, n), /cạnh/, `số cạnh ${n}`);
  throwsLike(() => createPolygon([0, 0], 0, 6), /không hợp lệ/, "Size 0");
  for(const p of [[NaN, 0], [1], null, {x: 1, y: 2}]) throwsLike(() => createCircle(p, 10), /không hợp lệ/, `điểm ${JSON.stringify(p)}`);
});

/* ── handles and snap points ─────────────────────────────────────────────────── */
test("handles: what each shape offers to grab, and whether grabbing it changes shape or position", () => {
  const names = e => entityHandles(e).map(h => `${h.name}:${h.role}`);
  deepEq(names(createLine([0, 0], [10, 0])), ["a:shape", "b:shape", "body:position"]);
  deepEq(names(createCurve([0, 0], [9, 0])), ["p0:shape", "c1:shape", "c2:shape", "p3:shape", "body:position"]);
  deepEq(names(createRect([0, 0], 4, 2)), ["v0:position", "v1:position", "v2:position", "v3:position", "body:position"]);
  deepEq(names(createCircle([0, 0], 4)), ["c:position", "body:position"]);
  deepEq(names(createPolygon([0, 0], 4, 3)), ["c:position", "v0:position", "v1:position", "v2:position", "body:position"]);
  deepEq(handle(createCurve([0, 0], [9, 0], [1, 5], [7, 5]), "c2"), [7, 5]);
  deepEq(handle(createCircle([3, 4], 4), "c"), [3, 4]);
});

test("G8 snap points of a new shape: ends, corners, vertices, centres — never a control point", () => {
  const C = createCurve([0, 0], [100, 0], [20, 60], [80, 60]);
  deepEq(entitySnap(C).points, [[0, 0], [100, 0]], "Curve: hai đầu mút, không có control point");
  eq(entitySnap(C).shapes[0].kind, "spline");
  deepEq(entitySnap(createLine([1, 2], [3, 4])).points, [[1, 2], [3, 4]]);
  deepEq(entitySnap(createRect([0, 0], 4, 2)).points, [[0, 0], [4, 0], [4, 2], [0, 2]]);
  deepEq(entitySnap(createRect([0, 0], 4, 2)).shapes.map(s => s.kind), ["line", "line", "line", "line"], "cạnh rect là line");
  deepEq(entitySnap(createCircle([3, 4], 4)).points, [[3, 4]]);
  eq(entitySnap(createCircle([3, 4], 4)).shapes[0].kind, "arc");
  const G = createPolygon([0, 0], 10, 5);
  deepEq(entitySnap(G).points, [[0, 0], ...verts(G)], "Polygon: tâm + 5 đỉnh");
  eq(entitySnap(G).shapes.length, 5);
});

/* ── K — Rule 2: drag changes position or shape, by the point grabbed ─────────── */
test("K1 Line: drag an end — that end lands on the target, the other keeps every bit", () => {
  const L = createLine([0.1, 0.2], [100.3, 50.7]);
  const b = dragEntity(L, "b", [80, -20]);
  same(b.b, [80, -20], "End tới đích"); same(b.a, L.a, "Start đứng yên");
  const a = dragEntity(L, "a", [-3.3, 9.9]);
  same(a.a, [-3.3, 9.9], "Start tới đích"); same(a.b, L.b, "End đứng yên");
});

test("K1 Line: drag the body — it moves, its length and angle stay", () => {
  const L = createLine([0.1, 0.2], [100.3, 50.7]), from = [50, 25], to = [83.3, 12.9];
  const m = dragEntity(L, "body", to, from);
  nearPt(m.a, [0.1 + 33.3, 0.2 - 12.1], 1e-12, "Start dời đúng vector"); nearPt(m.b, [100.3 + 33.3, 50.7 - 12.1], 1e-12, "End dời đúng vector");
  near(hyp(m.a, m.b), hyp(L.a, L.b), 1e-9, "dài giữ"); near(dirDeg(m.a, m.b), dirDeg(L.a, L.b), 1e-9, "góc giữ");
});

test("K2 Curve: drag an end — its control point comes along, the far half keeps every bit", () => {
  const C = createCurve([0, 0], [100, 0], [20, 60], [80, 60]);
  const s = dragEntity(C, "p0", [10, -5]);
  same(s.p0, [10, -5], "Start tới đích"); same(s.c1, [30, 55], "control point 1 dời cùng vector");
  same(s.c2, C.c2, "control point 2 đứng yên"); same(s.p3, C.p3, "End đứng yên");
  const e = dragEntity(C, "p3", [120, 10]);
  same(e.p3, [120, 10], "End tới đích"); same(e.c2, [100, 70], "control point 2 dời cùng vector");
  same(e.p0, C.p0, "Start đứng yên"); same(e.c1, C.c1, "control point 1 đứng yên");
});

test("K2 Curve: drag a control point — only that point changes; drag the body — it moves", () => {
  const C = createCurve([0, 0], [100, 0], [20, 60], [80, 60]);
  const k = dragEntity(C, "c1", [0, 90]);
  same(k.c1, [0, 90], "control point 1 tới đích");
  same(k.p0, C.p0, "Start"); same(k.c2, C.c2, "control point 2"); same(k.p3, C.p3, "End");
  const m = dragEntity(C, "body", [15, 5], [0, 0]);
  deepEq([m.p0, m.c1, m.c2, m.p3], [[15, 5], [35, 65], [95, 65], [115, 5]], "cả bốn điểm dời (15, 5)");
});

test("K3 Rectangle · Circle · Polygon: dragging anywhere only moves them — W H D Size Angle sides keep every bit", () => {
  const R = createRect([0.3, 0.7], 33.3, 12.1), r = dragEntity(R, "v2", [200, 300]);
  nearPt(handle(r, "v2"), [200, 300], 1e-9, "góc đang nắm tới đích");
  ok(Object.is(r.w, R.w) && Object.is(r.h, R.h), "W, H từng bit");
  const r2 = dragEntity(R, "body", [11, 12], [1, 2]);
  nearPt([r2.x, r2.y], [10.3, 10.7], 1e-12, "góc neo dời (10, 10)"); ok(Object.is(r2.w, R.w) && Object.is(r2.h, R.h), "W, H từng bit");
  const O = createCircle([5, 5], 9.525), o = dragEntity(O, "c", [-7.7, 3.3]);
  same(o.c, [-7.7, 3.3], "tâm tới đích"); ok(Object.is(o.d, O.d), "D từng bit");
  const G = createPolygon([0, 0], 31.75, 6, 15), g = dragEntity(G, "v3", [50, 50]);
  nearPt(handle(g, "v3"), [50, 50], 1e-9, "đỉnh đang nắm tới đích");
  ok(Object.is(g.size, G.size) && Object.is(g.angle, G.angle) && g.sides === 6, "Size, Angle, số cạnh từng bit");
  const g2 = dragEntity(G, "c", [1, 1]);
  same(g2.c, [1, 1], "tâm tới đích"); ok(Object.is(g2.size, G.size), "Size từng bit");
});

test("K4 a drag that would collapse a shape is refused", () => {
  const L = createLine([0, 0], [10, 0]);
  throwsLike(() => dragEntity(L, "b", [0, 0]), /dài 0/, "End đè lên Start");
  const C = createCurve([0, 0], [10, 0]);
  throwsLike(() => dragEntity(C, "p3", [0, 0]), /trùng/, "End đè lên Start");
  throwsLike(() => dragEntity(L, "c1", [1, 1]), /tay nắm/, "Line không có control point");
  throwsLike(() => dragEntity(L, "b", [NaN, 1]), /không hợp lệ/, "đích NaN");
  throwsLike(() => dragEntity(L, "body", [1, 1]), /nắm/, "kéo thân cần chỗ nắm");
});

test("K5 nothing is edited in place: every operation returns a new shape and leaves the old one as it was", () => {
  const all = [createLine([0, 0], [10, 5]), createCurve([0, 0], [10, 0], [2, 4], [8, 4]), createRect([0, 0], 5, 3),
               createCircle([1, 1], 4), createPolygon([0, 0], 8, 5)].map(deepFreeze);
  for(const e of all){
    const before = JSON.stringify(e);
    const h = entityHandles(e)[0];
    const moved = dragEntity(e, h.name, [h.at[0] + 1, h.at[1] + 2], [0, 0]);
    ok(moved !== e, `${e.type}: hình mới`);
    ok(moveEntity(e, 1, 1) !== e, `${e.type}: dời ra hình mới`);
    eq(JSON.stringify(e), before, `${e.type}: hình cũ không đổi`);
  }
});

/* ── N — Rule 4: numbers when precision matters ─────────────────────────────────── */
test("N1 every dimension can be typed in the display unit: 3 1/2 in, 12,7 cm, 3/8, 1 1/4", () => {
  const R = createRect([0, 0], parseLength("3 1/2", "inch"), parseLength("12,7 cm", "inch"));
  near(R.w, 3.5*25.4, 1e-12, "W = 3.5 × 25.4"); near(R.h, 127, 1e-12, "H: hậu tố cm thắng inch");
  eq(createCircle([0, 0], parseLength("3/8", "inch")).d, 0.375*25.4, "D = 3/8 in");
  eq(createPolygon([0, 0], parseLength("1 1/4", "inch"), 6).size, 1.25*25.4, "Size = 1 1/4 in");
  near(hyp([0, 0], createLinePolar([0, 0], parseLength("5", "inch"), 30).b), 127, 1e-9, "Length 5 in");
  let err = null; try{ createCircle([0, 0], parseLength("abc", "inch")); }catch(e){ err = e; }
  ok(err && /không hợp lệ/.test(err.message), "chữ hỏng → không tạo gì");
});

test("N2 Line Length keeps Start and the angle; Angle turns about Start and keeps the length", () => {
  const L = createLine([10, 10], [70, 90]);                        // 100 long, 3-4-5
  const l = setEntityDim(L, "length", 150);
  same(l.a, L.a, "Start từng bit"); nearPt(l.b, [100, 130], 1e-9, "End dọc hướng cũ");
  near(dirDeg(l.a, l.b), dirDeg(L.a, L.b), 1e-9, "góc giữ");
  const g = setEntityDim(L, "angle", 90);
  same(g.a, L.a, "Start từng bit"); same(g.b, [10, 110], "90° → thẳng đứng, đúng tuyệt đối");
  const k = setEntityDim(L, "length", 50, {keep: "b"});
  same(k.b, L.b, "giữ End"); nearPt(k.a, [40, 50], 1e-9, "Start dời dọc hướng");
  const k2 = setEntityDim(L, "angle", 0, {keep: "b"});
  same(k2.b, L.b, "giữ End"); nearPt(k2.a, [-30, 90], 1e-9, "hướng A→B = 0° quanh End");
});

test("N2 Rectangle W/H keep the anchor corner; Circle D keeps the centre; Polygon Size/Angle keep the centre", () => {
  const R = createRect([2, 3], 40, 20), r = setEntityDim(setEntityDim(R, "w", 200), "h", 7.5);
  ok(Object.is(r.x, 2) && Object.is(r.y, 3), "góc neo từng bit"); deepEq([r.w, r.h], [200, 7.5]);
  const O = createCircle([4, 5], 10), o = setEntityDim(O, "d", 50);
  same(o.c, O.c, "tâm từng bit"); eq(o.d, 50);
  const G = createPolygon([1, 2], 30, 6), s = setEntityDim(G, "size", 80);
  same(s.c, G.c, "tâm từng bit");
  for(const p of verts(s)) near(hyp(p, [1, 2]), 40, 1e-9, "đỉnh trên vòng Size/2 mới");
  const t = setEntityDim(G, "angle", 45);
  same(t.c, G.c, "tâm từng bit"); near(entityDims(t).angle, 45, 0);
});

test("N2 move by a typed distance and direction", () => {
  const O = moveEntity(createCircle([4, 5], 10), ...polar(10, 90));
  nearPt(O.c, [4, 15], 1e-12, "10 mm lên trên");
  const L = moveEntity(createLine([0, 0], [3, 4]), 2.5, -1);
  deepEq([L.a, L.b], [[2.5, -1], [5.5, 3]]);
  const R = moveEntity(createRect([1, 1], 2, 2), 1, 1);
  deepEq([R.x, R.y, R.w, R.h], [2, 2, 2, 2]);
});

test("N3 a bad number is refused and the shape is left exactly as it was", () => {
  const R = deepFreeze(createRect([0, 0], 10, 5)), L = deepFreeze(createLine([0, 0], [10, 0]));
  const G = deepFreeze(createPolygon([0, 0], 10, 6)), O = deepFreeze(createCircle([0, 0], 10));
  for(const v of [0, -1, NaN, Infinity, "12"]) throwsLike(() => setEntityDim(R, "w", v), /không hợp lệ/, `W ${v}`);
  for(const v of [0, -2, NaN]) throwsLike(() => setEntityDim(L, "length", v), /không hợp lệ/, `Length ${v}`);
  throwsLike(() => setEntityDim(L, "angle", NaN), /không hợp lệ/, "Angle NaN");
  throwsLike(() => setEntityDim(G, "sides", 7), /không sửa/, "số cạnh không sửa sau khi tạo (G4)");
  throwsLike(() => setEntityDim(O, "radius", 5), /không có/, "Circle không có kích thước tên radius");
  throwsLike(() => setEntityDim(L, "w", 5), /không có/, "Line không có W");
  deepEq(R, {type: "rect", x: 0, y: 0, w: 10, h: 5}, "hình còn nguyên");
});

/* ── §7 — the two shapes of a new piece: Path (its outline) · Point (a notch) ────────────── */
const SQ = [[0, 0], [100, 0], [100, 100], [0, 100]], SQK = ["turn", "turn", "turn", "turn"];
const T2P = [[0, -150], [180, -150], [180, -40], [90, -5], [0, -20], [-15, -85]], T2K = ["turn", "turn", "turn", "curve", "turn", "curve"];

test("§7 the table's five shapes stay as they are; a piece adds Path and Point", () => {
  deepEq(ENTITY_TYPES, ["line", "curve", "rect", "circle", "polygon"], "bảng năm hình không đổi");
  deepEq(PIECE_ENTITY_TYPES, ["path", "point"]);
});

test("O13 Point: made exactly where it is put, moved and dragged by position only, no dimension", () => {
  const P = createPoint([12.5, -3.25]);
  eq(P.type, "point"); same(P.p, [12.5, -3.25], "đúng từng bit");
  throwsLike(() => createPoint([NaN, 0]), /không hợp lệ/, "NaN");
  deepEq(entityHandles(P).map(h => [h.name, h.role]), [["p", "position"], ["body", "position"]]);
  const s = entityShape(P); eq(s.kind, "point"); eq(s.x, 12.5); eq(s.y, -3.25);
  const sn = entitySnap(P); deepEq(sn.points, [[12.5, -3.25]]); deepEq(sn.handles, ["p"]); eq(sn.shapes.length, 0);
  same(dragEntity(P, "p", [1, 2]).p, [1, 2], "kéo p tới đích");
  same(dragEntity(P, "body", [11, 12], [10, 10]).p, [13.5, -1.25], "kéo thân = dời");
  same(moveEntity(P, 1, 1).p, [13.5, -2.25], "dời");
  deepEq(entityDims(P), {x: 12.5, y: -3.25});
  throwsLike(() => setEntityDim(P, "d", 3), /không có kích thước/, "Point không có kích thước");
  same(P.p, [12.5, -3.25], "hình cũ không bị sửa (K5)");
});

test("§7 Path: turn and curve points kept as placed; handles v0…; its shape and snap targets", () => {
  const src = T2P.map(p => p.slice()), E = createPath(src, T2K);
  eq(E.type, "path"); ok(E.pts !== src && E.pts[0] !== src[0], "không giữ mảng của người gọi");
  E.pts.forEach((p, i) => same(p, T2P[i], `điểm ${i}`)); deepEq(E.kinds, T2K);
  throwsLike(() => createPath([[0, 0], [1, 0]], ["turn", "turn"]), /ít nhất 3/, "2 điểm");
  deepEq(entityHandles(E).map(h => h.name), ["v0", "v1", "v2", "v3", "v4", "v5", "body"]);
  ok(entityHandles(E).slice(0, 6).every(h => h.role === "shape"), "đỉnh là tay nắm dáng");
  eq(entityShape(createPath(SQ, SQK)).kind, "curve", "toàn turn: polyline kín");
  eq(entityShape(E).kind, "spline", "có curve point: một NURBS");
  const sn = entitySnap(E);
  sn.points.forEach((p, i) => same(p, T2P[i], `điểm bắt ${i}`));
  deepEq(sn.handles, ["v0", "v1", "v2", "v3", "v4", "v5"]);
  eq(sn.shapes.length, 6, "một hình mỗi đoạn");
  deepEq(sn.shapes.map(x => x.kind), ["line", "line", "spline", "spline", "spline", "spline"], "cạnh thẳng là line, đoạn cong là curve");
});

test("§7 Path: dragging a point reshapes (only that point), the body moves it, dimensions are read not set", () => {
  const E = createPath(T2P, T2K), D = dragEntity(E, "v2", [185, -45]);
  same(D.pts[2], [185, -45], "v2 tới đích");
  D.pts.forEach((p, i) => { if(i !== 2) same(p, T2P[i], `điểm ${i} đứng yên, từng bit`); });
  const B = dragEntity(E, "body", [10, 10], [0, 0]);
  B.pts.forEach((p, i) => same(p, [T2P[i][0] + 10, T2P[i][1] + 10], `thân: điểm ${i} dời 10, 10`));
  const M = moveEntity(E, -5, 2.5);
  M.pts.forEach((p, i) => same(p, [T2P[i][0] - 5, T2P[i][1] + 2.5], `dời: điểm ${i}`));
  throwsLike(() => dragEntity(E, "v2", T2P[1]), /trùng/, "kéo đè lên điểm kề");
  throwsLike(() => dragEntity(E, "v9", [0, 0]), /không có/, "tay nắm không có");
  const sq = entityDims(createPath(SQ, SQK));
  eq(sq.perimeter, 400); eq(sq.area, 10000); deepEq([sq.points, sq.turns, sq.curves], [4, 4, 0]);
  deepEq(sq.edges, [100, 100, 100, 100], "bốn cạnh");
  const d = entityDims(E);
  deepEq([d.points, d.turns, d.curves], [6, 4, 2]);
  eq(d.edges.length, 4, "đáy · phải · trên · trái"); eq(d.edges[0], 180); eq(d.edges[1], 110);
  throwsLike(() => setEntityDim(E, "length", 10), /không có kích thước/, "Path không có kích thước để đặt");
});

test("§7 Path: a point turns from corner to curve and back — nothing else changes", () => {
  const E = createPath(T2P, T2K), C = setPathKind(E, 1, "curve");
  eq(C.kinds[1], "curve"); C.kinds.forEach((k, i) => { if(i !== 1) eq(k, T2K[i], `loại ${i}`); });
  C.pts.forEach((p, i) => same(p, T2P[i], `điểm ${i}`));
  eq(setPathKind(C, 1, "turn").kinds[1], "turn");
  throwsLike(() => setPathKind(E, 6, "curve"), /không có điểm/, "điểm không có");
  throwsLike(() => setPathKind(E, 1, "round"), /turn.*curve/, "loại lạ");
  eq(E.kinds[1], "turn", "hình cũ không bị sửa");
});
