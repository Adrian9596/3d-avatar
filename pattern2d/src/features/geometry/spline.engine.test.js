/* Measure Engine · Curve — Spline/Bezier (spec: src/features/measure/measure_engine.md §5).

   Two independent referees, neither of them the kernel:
     · closed forms — a straight Bezier, the parabola 25(2√5 + asinh 2), NURBS circles;
     · brute force written right here — de Casteljau on 2^17 chords, then one Richardson
       step (L_N + (L_N − L_N/2)/3), which lands within ~1e-11 mm of the true length.
   "Ổn định" (stable) is read as: the same curve gives the same length whichever way it
   is drawn, cut, moved or turned. */
import {mcase} from "../../../tests/engine.js";
import {point, line, length, pointAt, reverse, split, transform, rotation, translation} from "./model.js";
import {chain, chainLength, alongPath} from "./path.js";
/* spline.js is new: a missing module must fail these cases, not the whole test run */
const {spline, bezier} = await import("./spline.js").catch(e => { if(e.code === "ERR_MODULE_NOT_FOUND") return {}; throw e; });

const G = "Curve", PI = Math.PI, P = (x, y) => point(x, y);
const H = Math.SQRT1_2;

/* ── the referee ────────────────────────────────────────────────────────────── */
function casteljau(ctrl, t){
  let q = ctrl.map(p => [p[0], p[1]]);
  while(q.length > 1) q = q.slice(1).map((p, i) => [q[i][0] + (p[0] - q[i][0])*t, q[i][1] + (p[1] - q[i][1])*t]);
  return q[0];
}
function chords(ctrl, u0, u1, n){
  let s = 0, a = casteljau(ctrl, u0);
  for(let i = 1; i <= n; i++){ const b = casteljau(ctrl, u0 + (u1 - u0)*i/n); s += Math.hypot(b[0]-a[0], b[1]-a[1]); a = b; }
  return s;
}
const brute = (ctrl, u0 = 0, u1 = 1) => { const a = chords(ctrl, u0, u1, 1 << 16), b = chords(ctrl, u0, u1, 1 << 17); return b + (b - a)/3; };
/* the point that sits a fraction f of the way along, found by walking fine chords */
function atFraction(ctrl, f, n = 1 << 17){
  const total = chords(ctrl, 0, 1, n);
  let s = 0, a = casteljau(ctrl, 0);
  for(let i = 1; i <= n; i++){
    const b = casteljau(ctrl, i/n), d = Math.hypot(b[0]-a[0], b[1]-a[1]);
    if(s + d >= f*total){ const k = (f*total - s)/d; return [a[0] + (b[0]-a[0])*k, a[1] + (b[1]-a[1])*k]; }
    s += d; a = b;
  }
  return a;
}

const B3 = [[0, 0], [30, 80], [120, 90], [150, 0]];
const QUARTER = () => spline({degree: 2, knots: [0, 0, 0, 1, 1, 1], ctrl: [[100, 0], [100, 100], [0, 100]], weights: [1, H, 1]});
const CIRCLE9 = () => spline({degree: 2, knots: [0, 0, 0, .25, .25, .5, .5, .75, .75, 1, 1, 1],
  ctrl: [[40, 0], [40, 40], [0, 40], [-40, 40], [-40, 0], [-40, -40], [0, -40], [40, -40], [40, 0]],
  weights: [1, H, 1, H, 1, H, 1, H, 1]});

mcase({id: "SPL-01", group: G, kind: "N", what: "Bezier bậc 3, 4 điểm thẳng hàng cách đều", expect: 300, tol: 1e-9,
       source: "tay: là một đoạn thẳng"}, () => length(bezier([[0, 0], [100, 0], [200, 0], [300, 0]])));
mcase({id: "SPL-02", group: G, kind: "N", what: "Bezier bậc 2 (0,0)(50,100)(100,0)", expect: 25*(2*Math.sqrt(5) + Math.asinh(2)), tol: 1e-6,
       source: "tay: parabol y = 2x − x²/50"}, () => length(bezier([[0, 0], [50, 100], [100, 0]])));
mcase({id: "SPL-03", group: G, kind: "N", what: "NURBS ¼ đường tròn r = 100: [chiều dài, lệch bán kính lớn nhất]",
       expect: [50*PI, 0], tol: 1e-6, source: "tay: 50π; mọi điểm cách tâm 100"}, () => {
  const s = QUARTER();
  let worst = 0;
  for(let i = 0; i <= 100; i++){ const q = pointAt(s, i/100); worst = Math.max(worst, Math.abs(Math.hypot(q.x, q.y) - 100)); }
  return [length(s), worst];
});
mcase({id: "SPL-04", group: G, kind: "N", what: "NURBS 9 điểm — đường tròn r = 40: [kín, chu vi, lối ngắn 350°→10°]",
       expect: [true, 80*PI, 40*20*PI/180], tol: 1e-6, source: "tay"}, () => {
  const ch = chain([CIRCLE9()]);
  const at = deg => P(40*Math.cos(deg*PI/180), 40*Math.sin(deg*PI/180));
  return [ch.closed, ch.total, alongPath(ch, at(350), at(10)).distance];
});
mcase({id: "SPL-05", group: G, kind: "N", what: "Bezier bậc 3 tổng quát", expect: brute(B3), tol: 1e-6,
       source: "de Casteljau 2¹⁷ + Richardson"}, () => length(bezier(B3)));
mcase({id: "SPL-06", group: G, kind: "N", what: "lật chiều control point: [chiều dài, dọc A→B]",
       expect: [brute(B3), brute(B3, 0.2, 0.7)], tol: 1e-6, source: "brute force"}, () => {
  const r = bezier(B3.slice().reverse()), A = casteljau(B3, 0.2), B = casteljau(B3, 0.7);
  return [length(r), alongPath(chain([r]), P(...A), P(...B)).distance];
});
mcase({id: "SPL-07", group: G, kind: "N", what: "cắt tại t = 0.37: [Σ hai mảnh − toàn bộ, lệch điểm cắt (mm)]",
       expect: [0, 0], tol: 1e-5, source: "brute force: đi dây cung tới 37 %"}, () => {
  const s = bezier(B3), [a, b] = split(s, 0.37), q = pointAt(s, 0.37), want = atFraction(B3, 0.37);
  return [length(a) + length(b) - length(s), Math.hypot(q.x - want[0], q.y - want[1])];
});
mcase({id: "SPL-08", group: G, kind: "N", what: "Along Path giữa u = 0.2 và u = 0.7", expect: brute(B3, 0.2, 0.7), tol: 1e-6,
       source: "brute force"}, () => alongPath(chain([bezier(B3)]), P(...casteljau(B3, 0.2)), P(...casteljau(B3, 0.7))).distance);
mcase({id: "SPL-09", group: G, kind: "N", what: "chuỗi Bezier (knot bội p+1, kiểu thư viện 2938)",
       expect: brute([[0, 0], [40, 60], [80, 60], [120, 0]]) + brute([[120, 0], [160, -60], [200, -60], [240, 0]]), tol: 1e-6,
       source: "brute force từng khúc"}, () => length(spline({degree: 3, knots: [0, 0, 0, 0, .5, .5, .5, .5, 1, 1, 1, 1],
         ctrl: [[0, 0], [40, 60], [80, 60], [120, 0], [120, 0], [160, -60], [200, -60], [240, 0]]})));
mcase({id: "SPL-10", group: G, kind: "B", what: "spline bậc 1 = polyline", expect: 150, tol: 1e-9,
       source: "tay: 100 + 50"}, () => length(spline({degree: 1, knots: [0, 0, 1, 2, 2], ctrl: [[0, 0], [100, 0], [100, 50]]})));
mcase({id: "SPL-11", group: G, kind: "B", what: "xoay 0.7 rad + tịnh tiến: chiều dài không đổi", expect: brute(B3), tol: 1e-6,
       source: "brute force"}, () => length(transform(transform(bezier(B3), rotation(0.7, 30, -20)), translation(512, -77))));
mcase({id: "SPL-12", group: G, kind: "B", what: "Bezier có điểm lùi (P0 = P1, tốc độ 0 ở đầu)",
       expect: brute([[0, 0], [0, 0], [100, 100], [200, 0]]), tol: 1e-6, source: "brute force"}, () =>
  length(bezier([[0, 0], [0, 0], [100, 100], [200, 0]])));
mcase({id: "SPL-13", group: G, kind: "I", what: "số knot sai (thiếu 2) → báo lỗi", expect: {throws: /không hợp lệ/},
       source: "spec A7"}, () => length(spline({degree: 3, knots: [0, 0, 0, 1, 1, 1], ctrl: B3})));
mcase({id: "SPL-14", group: G, kind: "I", what: "knot giảm dần → báo lỗi", expect: {throws: /không hợp lệ/},
       source: "spec A7"}, () => length(spline({degree: 3, knots: [0, 0, 0, 0, 1, 0.5, 1, 1, 1], ctrl: [...B3, [200, 50]]})));
mcase({id: "SPL-15", group: G, kind: "I", what: "control point NaN → báo lỗi", expect: {throws: /không hợp lệ/},
       source: "spec A7"}, () => length(bezier([[0, 0], [30, NaN], [120, 90], [150, 0]])));
mcase({id: "SPL-16", group: G, kind: "I", what: "weight = 0 → báo lỗi", expect: {throws: /không hợp lệ/},
       source: "spec A7"}, () => length(spline({degree: 2, knots: [0, 0, 0, 1, 1, 1], ctrl: [[100, 0], [100, 100], [0, 100]], weights: [1, 0, 1]})));

/* Mixed Path with a spline in it — kept here, next to the referee it needs */
const BZ = [[100, 0], [130, 0], [170, 40], [170, 80]];
mcase({id: "MIX-05", group: "Mixed Path", kind: "N", what: "line + Bezier + line: tổng", expect: 100 + brute(BZ) + 70, tol: 1e-6,
       source: "tay + brute force"}, () => chainLength(chain([line(P(170, 80), P(170, 150)), line(P(0, 0), P(100, 0)), reverse(bezier(BZ))])));
