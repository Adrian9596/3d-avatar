/* Corners — where one edge of a piece ends and the next begins (spec: edit/edit.md §2, S5).

   Expected values come from how each shape was BUILT here: a rectangle sampled every 10 mm
   has its corners at the indices where the sampling loop turned, a circle has none, an L
   has one. The real-pattern case checks that Edit and Edges read the same corners — the
   one-time proof that moving the definition out of edges/segment.js changed nothing is the
   1182-ring comparison recorded in CLAUDE.md §12. */
import {test, eq, near, deepEq, ok} from "../../../tests/harness.js";
import {cornerIndices, fromCorner} from "./corners.js";
import {chain} from "./path.js";
import {point, line, arc, curve} from "./model.js";
import {segmentEdges} from "../edges/segment.js";
import {ringPts, names} from "../../../tests/fixture3380.js";

/* a w × h rectangle sampled every `step` mm, counter-clockwise from (0,0) */
function sampled(w, h, step){
  const pts = [];
  for(let x = 0; x < w; x += step) pts.push([x, 0]);
  for(let y = 0; y < h; y += step) pts.push([w, y]);
  for(let x = w; x > 0; x -= step) pts.push([x, h]);
  for(let y = h; y > 0; y -= step) pts.push([0, y]);
  return pts;
}
const sorted = xs => xs.slice().sort((a, b) => a - b);

test("sampled rectangle: the four indices where the sampling turned", () => {
  /* 200 × 100 every 10: 20 points along the bottom, 10 up the right, 20 back along the
     top, 10 down the left — so the turns are at 0, 20, 30, 50 */
  deepEq(sorted(cornerIndices(sampled(200, 100, 10), true)), [0, 20, 30, 50]);
});

test("a 4-vertex rectangle (fewer than 8 points): every vertex turns 90°", () => {
  deepEq(sorted(cornerIndices([[0, 0], [100, 0], [100, 50], [0, 50]], true)), [0, 1, 2, 3]);
});

test("a triangle of 3 vertices: three corners", () => {
  deepEq(sorted(cornerIndices([[0, 0], [10, 0], [10, 10]], true)), [0, 1, 2]);
});

test("a circle of 120 points turns 3° a step: no corner", () => {
  const pts = [];
  for(let i = 0; i < 120; i++) pts.push([50*Math.cos(i/120*2*Math.PI), 50*Math.sin(i/120*2*Math.PI)]);
  deepEq(cornerIndices(pts, true), []);
});

test("half-disk: corners at the two ends of the diameter only", () => {
  /* the arc from (50,0) round to (−50,0) in 60 steps, closed by the diameter */
  const pts = [];
  for(let i = 0; i <= 60; i++) pts.push([50*Math.cos(i/60*Math.PI), 50*Math.sin(i/60*Math.PI)]);
  deepEq(sorted(cornerIndices(pts, true)), [0, 60]);
});

test("open path: both ends are always corners, and the elbow of an L", () => {
  deepEq(cornerIndices([[0, 0], [50, 0], [50, 50]], false), [0, 1, 2]);
  deepEq(cornerIndices([[0, 0], [100, 0]], false), [0, 1]);
  const arcPts = [];
  for(let i = 0; i <= 30; i++) arcPts.push([100*Math.cos(i/30*Math.PI/2), 100*Math.sin(i/30*Math.PI/2)]);
  deepEq(cornerIndices(arcPts, false), [0, 30]);
});

test("open sampled L: the elbow is found through the window, not at every sample", () => {
  const pts = [];
  for(let x = 0; x < 100; x += 5) pts.push([x, 0]);      // 20 samples along x …
  for(let y = 0; y <= 100; y += 5) pts.push([100, y]);   // … then up: the elbow is index 20
  deepEq(cornerIndices(pts, false), [0, 20, 40]);
});

test("degenerate input: no points, one point, two points on one spot", () => {
  deepEq(cornerIndices([], true), []);
  deepEq(cornerIndices([[1, 2]], false), [0]);
  deepEq(cornerIndices([[0, 0], [0, 0]], true), []);
});

test("real 3380 rings: Edit's corners are the starts of Edges' segments, same order", () => {
  for(const n of names) for(const layer of ["1", "8"]){
    const ring = ringPts(n, layer);
    const segs = segmentEdges(ring.slice());
    const cs = cornerIndices(ring, true);
    ok(cs.length >= 3, `${n} layer ${layer}: ${cs.length} corners`);
    eq(cs.length, segs.length, `${n} layer ${layer}: one corner per edge`);
    cs.forEach((c, j) => deepEq(ring[c], segs[j].pts[0], `${n} layer ${layer}: edge ${j}`));
  }
});

/* ── O17: a point d along the path from the nearer corner of the edge clicked (sketch.md §7, piece.md M15) ──
   Expected values are hand geometry — a rectangle's sides, a half-disk's arc by r·θ — and, on the real 3380
   rings, this file's own walk along the vertices. Never the kernel's own lengths. */
const near2 = (a, b, tol, msg) => ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol, `${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
const refused = (fn, re, msg) => { let e = null; try{ fn(); }catch(x){ e = x; } ok(e && re.test(e.message), `${msg}: ${e ? e.message : "không từ chối"}`); return e; };
const RECT = [[0, 0], [100, 0], [100, 50], [0, 50]];

test("O17 a rectangle: d from the nearer corner, along the side clicked — from either end of it", () => {
  const ch = chain([curve(RECT, true)]);
  near2(fromCorner(ch, RECT, [10, 0.3], 12.7).point, [12.7, 0], 1e-9, "đáy, gần (0,0)");
  near2(fromCorner(ch, RECT, [90, -0.2], 12.7).point, [87.3, 0], 1e-9, "đáy, gần (100,0)");
  near2(fromCorner(ch, RECT, [99.8, 45], 5).point, [100, 45], 1e-9, "cạnh phải, gần (100,50)");
  near2(fromCorner(ch, RECT, [3, 49.9], 0).point, [0, 50], 1e-9, "d = 0: đúng góc");
  const r = fromCorner(ch, RECT, [60, 50.4], 100);
  near2(r.point, [0, 50], 1e-9, "d = cả cạnh: tới góc kia");
  near2(r.corner, [100, 50], 1e-9, "đo từ góc gần chỗ bấm hơn (40 < 60)"); near(r.length, 100, 1e-9, "cạnh trên dài 100");
  near2(fromCorner(ch, RECT, [50, 0.1], 20).corner, [0, 0], 1e-9, "giữa cạnh: góc đầu cạnh (P12)");
});

test("O17 a ring that starts mid-edge: the edge across its start is one edge", () => {
  const ch = chain([curve([[50, 0], [100, 0], [100, 50], [0, 50], [0, 0]], true)]);
  near2(fromCorner(ch, RECT, [5, 0.2], 20).point, [20, 0], 1e-9, "gần (0,0)");
  near2(fromCorner(ch, RECT, [95, 0.1], 20).point, [80, 0], 1e-9, "gần (100,0), qua đầu vòng");
  const r = fromCorner(ch, RECT, [40, 0.1], 30);
  near2(r.point, [30, 0], 1e-9, "đo từ (0,0) qua đầu vòng"); near(r.length, 100, 1e-9, "cạnh đáy vẫn dài 100");
  near2(fromCorner(chain([curve(RECT, true)]), [[0, 0]], [50, 50.2], 20).point, [0, 20], 1e-9, "một góc duy nhất: cả vòng là cạnh, lối ngắn hơn về góc");
});

test("O17 a curved edge: along the half-disk's arc by r·θ, not across", () => {
  const r = 50, ch = chain([arc(point(0, 0), r, 0, Math.PI), line(point(-50, 0), point(50, 0))]), C = [[50, 0], [-50, 0]];
  const at = t => [r*Math.cos(t), r*Math.sin(t)];
  const a = fromCorner(ch, C, at(0.3), 20).point;
  near2(a, at(20/r), 1e-9, "gần (50,0): góc 20/r");
  near2(fromCorner(ch, C, at(2.9), 20).point, at(Math.PI - 20/r), 1e-9, "gần (−50,0): đo ngược lại");
  ok(Math.hypot(a[0] - 50, a[1]) < 20 - 0.05, "dọc cung dài hơn đường chim bay");
  near2(fromCorner(ch, C, at(0.3), Math.PI*r).point, [-50, 0], 1e-9, "d = πr: tới góc kia");
  const e = refused(() => fromCorner(ch, C, at(0.3), Math.PI*r + 0.01), /157[.,]08/, "dài hơn cạnh: nói cạnh dài bao nhiêu");
  near(e.edgeLength, Math.PI*r, 1e-9, "độ dài cạnh đi kèm lỗi (mm), để tool viết theo đơn vị hiển thị");
  near2(fromCorner(ch, C, [-30, -0.3], 10).point, [-40, 0], 1e-9, "cạnh thẳng của nửa đĩa, gần (−50,0): 20 < 80");
  near2(fromCorner(ch, C, [10, -0.3], 10).point, [40, 0], 1e-9, "…và gần (50,0): 40 < 60");
});

test("O17 an open path: its two ends are corners, listed or not", () => {
  const ch = chain([curve([[0, 0], [100, 0], [100, 50]], false)]);
  near2(fromCorner(ch, [[0, 0], [100, 0], [100, 50]], [10, 0.2], 10).point, [10, 0], 1e-9, "gần đầu");
  near2(fromCorner(ch, [[100, 0]], [10, 0.2], 10).point, [10, 0], 1e-9, "đầu path là góc dù không có trong danh sách");
  near2(fromCorner(ch, [[100, 0]], [100.2, 45], 10).point, [100, 40], 1e-9, "cuối path cũng vậy");
  near2(fromCorner(ch, [], [60, 0.1], 10).point, [10, 0], 1e-9, "không góc nào khác: cả path (150) là một cạnh, 60 < 90 → từ đầu");
  near2(fromCorner(ch, [], [100.2, 40], 10).point, [100, 40], 1e-9, "…và 140 > 10 → từ cuối");
});

test("O17 refused, nothing guessed: no corner, d negative or not a number, d longer than the edge", () => {
  refused(() => fromCorner(chain([arc(point(0, 0), 20, 0, 2*Math.PI)]), [], [20.1, 0], 5), /góc/, "hình tròn không có góc");
  const ch = chain([curve(RECT, true)]);
  refused(() => fromCorner(ch, RECT, [10, 0], -1), /không hợp lệ/, "d âm");
  refused(() => fromCorner(ch, RECT, [10, 0], NaN), /không hợp lệ/, "d NaN");
  refused(() => fromCorner(ch, RECT, [10, 0], "5"), /không hợp lệ/, "d là chữ");
  near(refused(() => fromCorner(ch, RECT, [99.8, 25], 50.01), /50/, "cạnh phải chỉ dài 50").edgeLength, 50, 1e-9);
});

test("O17 real 3380 rings: d from a corner as this file walks the vertices, on every edge, from both ends", () => {
  /* the ruler: walk the ring's vertices from vertex i, forward or back, until d is used up — plain arithmetic */
  const walk = (ring, i, d, dir) => {
    const n = ring.length;
    for(let k = 0, left = d; k < n; k++){
      const a = ring[((i + dir*k) % n + n) % n], b = ring[((i + dir*(k + 1)) % n + n) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if(left <= L || k === n - 1) return L > 0 ? [a[0] + (b[0] - a[0])*left/L, a[1] + (b[1] - a[1])*left/L] : a;
      left -= L;
    }
  };
  const edgeLen = (ring, i, j) => { let s = 0; for(let k = i; k !== j; k = (k + 1) % ring.length){ const a = ring[k], b = ring[(k + 1) % ring.length]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };
  let edges = 0;
  for(const n of names){
    const ring = ringPts(n, "1"), cs = cornerIndices(ring, true), corners = cs.map(i => ring[i]);
    const ch = chain([curve(ring, true)]);
    cs.forEach((c, j) => {
      const c2 = cs[(j + 1) % cs.length], L = edgeLen(ring, c, c2);
      if(L < 1) return;
      const nearStart = walk(ring, c, 0.3*L, 1), nearEnd = walk(ring, c2, 0.2*L, -1), d = 0.15*L;
      near2(fromCorner(ch, corners, nearStart, d).point, walk(ring, c, d, 1), 1e-9, `${n} cạnh ${j}, từ góc đầu`);
      near2(fromCorner(ch, corners, nearEnd, d).point, walk(ring, c2, d, -1), 1e-9, `${n} cạnh ${j}, từ góc cuối`);
      near(fromCorner(ch, corners, nearStart, d).length, L, 1e-9, `${n} cạnh ${j}: dài ${L.toFixed(3)} mm`);
      edges++;
    });
  }
  ok(edges >= 16, `${edges} cạnh thật đã đo`);
});
