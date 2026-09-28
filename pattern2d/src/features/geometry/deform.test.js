/* The deform rule and the precise-edit targets (spec: edit/edit.md §3 D1–D3, §4 P1–P2).

   Every expected value is hand geometry: where a rectangle's corner lands, that a scaled
   half-circle is still a circle of the scaled radius, that a line rotated 90° about its
   start ends straight up. Lengths are summed with a plain loop here, not with the kernel. */
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {similarity, deformPath, isStraight, lengthMove, angleMove, polar, chordAngle, edgeRange} from "./deform.js";
import {applyM} from "./model.js";

const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function plainLength(pts, closed = false){
  let s = 0;
  for(let i = 1; i < pts.length; i++) s += hyp(pts[i - 1], pts[i]);
  return closed ? s + hyp(pts[pts.length - 1], pts[0]) : s;
}
const same = (a, b, msg) => { ok(Object.is(a[0], b[0]) && Object.is(a[1], b[1]), `${msg}: [${a}] ≠ [${b}]`); };
const RECT = [[0, 0], [100, 0], [100, 50], [0, 50]];

/* a half-disk: arc (50,0) → (−50,0) through (0,50) in 60 steps, the diameter closes it */
function halfDisk(){
  const pts = [];
  for(let i = 0; i <= 60; i++) pts.push([50*Math.cos(i/60*Math.PI), 50*Math.sin(i/60*Math.PI)]);
  return pts;
}

test("similarity maps both ends where asked, and scales every distance by one factor", () => {
  const m = similarity([0, 0], [10, 0], [5, 5], [5, 25]);      // turn 90°, scale ×2, move (5,5)
  const p = applyM(m, 0, 0), q = applyM(m, 10, 0), r = applyM(m, 3, 4);
  near(p.x, 5, 1e-12); near(p.y, 5, 1e-12); near(q.x, 5, 1e-12); near(q.y, 25, 1e-12);
  near(Math.hypot(r.x - p.x, r.y - p.y), 10, 1e-12, "|(3,4)| = 5 → 10");
});

test("similarity of a zero-length edge: a move is fine, a stretch is refused", () => {
  const m = similarity([1, 1], [1, 1], [4, 5], [4, 5]);
  const p = applyM(m, 1, 1); near(p.x, 4, 1e-12); near(p.y, 5, 1e-12);
  let err = null; try{ similarity([1, 1], [1, 1], [4, 5], [6, 5]); }catch(e){ err = e; }
  ok(err && /trùng/.test(err.message), "two ends on one spot cannot be pulled apart");
});

test("D1/D3 rectangle: drag corner 2 by (10, 5) — both sides stay straight, the rest untouched", () => {
  const out = deformPath(RECT, true, [0, 1, 2, 3], new Map([[2, [10, 5]]]));
  deepEq(out, [[0, 0], [100, 0], [110, 55], [0, 50]]);
  same(out[0], RECT[0], "vertex 0"); same(out[1], RECT[1], "vertex 1"); same(out[3], RECT[3], "vertex 3");
});

test("D2 sampled rectangle: an edge with no corner moved keeps every bit", () => {
  const pts = [];
  for(let x = 0; x < 200; x += 10) pts.push([x, 0]);
  for(let y = 0; y < 100; y += 10) pts.push([200, y]);
  for(let x = 200; x > 0; x -= 10) pts.push([x, 100]);
  for(let y = 100; y > 0; y -= 10) pts.push([0, y]);
  const out = deformPath(pts, true, [0, 20, 30, 50], new Map([[30, [0, 20]]]));   // top-right corner up 20
  for(let i = 0; i <= 20; i++) same(out[i], pts[i], `bottom edge vertex ${i}`);
  for(let i = 50; i < 60; i++) same(out[i], pts[i], `left edge vertex ${i}`);
  /* the right side now runs (200,0) → (200,120): every sample on that line, same fractions */
  for(let i = 20; i <= 30; i++){ near(out[i][0], 200, 1e-9); near(out[i][1], (i - 20)*12, 1e-9, `right side ${i}`); }
  /* the top runs (200,120) → (0,100): straight, samples at the same fractions */
  for(let i = 30; i <= 50; i++){
    const f = (i - 30)/20;
    near(out[i][0], 200 - 200*f, 1e-9); near(out[i][1], 120 - 20*f, 1e-9, `top ${i}`);
  }
});

test("D3 curve edge keeps its shape: the half-circle scaled about the far corner is a circle of r 55", () => {
  const pts = halfDisk();
  const out = deformPath(pts, true, [0, 60], new Map([[0, [10, 0]]]));     // (50,0) → (60,0)
  /* similarity about (−50,0) taking (50,0) to (60,0): ×1.1, no turn → centre (5,0), radius 55 */
  for(let i = 0; i <= 60; i++) near(Math.hypot(out[i][0] - 5, out[i][1]), 55, 1e-9, `arc sample ${i}`);
  same(out[60], pts[60], "the fixed corner");
  near(plainLength(out.slice(0, 61)), 1.1*plainLength(pts.slice(0, 61)), 1e-9, "length ratio = chord ratio");
});

test("D3 moving both ends of an edge by one vector translates it: every length kept", () => {
  const out = deformPath(RECT, true, [0, 1, 2, 3], new Map([[1, [0, -7]], [2, [0, -7]]]));
  deepEq(out, [[0, 0], [100, -7], [100, 43], [0, 50]]);
  near(hyp(out[1], out[2]), 50, 1e-12, "the moved side is still 50");
});

test("open path: moving the end of a 2-point line turns and stretches it about its start", () => {
  const out = deformPath([[0, 0], [100, 0]], false, [0, 1], new Map([[1, [-100, 100]]]));
  deepEq(out, [[0, 0], [0, 100]]);
});

test("a grip in the middle of a curve moves alone", () => {
  const pts = halfDisk();
  const out = deformPath(pts, true, [0, 60], new Map([[30, [0, 5]]]));
  for(let i = 0; i <= 60; i++) if(i !== 30) same(out[i], pts[i], `sample ${i}`);
  near(out[30][1], pts[30][1] + 5, 1e-12);
});

test("edgeRange walks forward and wraps on a ring", () => {
  deepEq(edgeRange(6, true, 4, 1), [4, 5, 0, 1]);
  deepEq(edgeRange(6, false, 1, 4), [1, 2, 3, 4]);
});

test("isStraight: collinear samples yes; 0.02 mm off no; exactly the tolerance yes", () => {
  ok(isStraight([[0, 0], [30, 0], [70, 0], [100, 0]]));
  ok(!isStraight([[0, 0], [50, 0.02], [100, 0]]));
  ok(isStraight([[0, 0], [50, 0.01], [100, 0]], 0.01));
});

test("P1 length: a straight edge slides its moving end along itself", () => {
  const m = lengthMove([[0, 0], [60, 80]], 150);          // 100 long → 150
  near(m[0], 90, 1e-12); near(m[1], 120, 1e-12);
});

test("P1 length: a curve edge is scaled about its fixed end — the arc comes out exactly L long", () => {
  const edge = halfDisk().reverse();                     // fixed (−50,0) → moving (50,0), 50π long
  const L = 200, m = lengthMove(edge, L);
  const moved = deformPath(edge, false, [0, 60], new Map([[60, [m[0] - 50, m[1]]]]));
  near(plainLength(moved), L, 1e-9);
});

test("P2 angle: the chord turns about the fixed end, its length unchanged", () => {
  const m = angleMove([[10, 10], [110, 10]], 90);
  near(m[0], 10, 1e-12); near(m[1], 110, 1e-12);
  near(chordAngle([[10, 10], m]), 90, 1e-9);
  near(chordAngle([[0, 0], [-1, -1]]), 225, 1e-9, "angles read 0–360, counter-clockwise from +X");
});

test("polar: distance along a direction", () => {
  const d = polar(10, 30);
  near(d[0], 10*Math.cos(Math.PI/6), 1e-12); near(d[1], 5, 1e-12);
});

test("P6 invalid targets are refused, not bent", () => {
  const bad = f => { try{ f(); }catch(e){ return true; } return false; };
  ok(bad(() => lengthMove([[0, 0], [10, 0]], 0)), "length 0");
  ok(bad(() => lengthMove([[0, 0], [10, 0]], -5)), "negative length");
  ok(bad(() => lengthMove([[0, 0], [10, 0]], NaN)), "NaN length");
  ok(bad(() => lengthMove([[3, 3], [3, 3]], 10)), "an edge of no length");
  ok(bad(() => angleMove([[3, 3], [3, 3]], 10)), "an edge with no direction");
  ok(bad(() => angleMove([[0, 0], [10, 0]], Infinity)), "angle ∞");
  ok(bad(() => deformPath(RECT, true, [0, 1, 2, 3], new Map([[1, [NaN, 0]]]))), "NaN move");
});
