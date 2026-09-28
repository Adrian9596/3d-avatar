/* spline.js, function by function (CLAUDE.md §5.13: every export named in a test).

   Expected values are closed forms: a quadratic Bezier worked by hand, and the NURBS quarter
   circle r = 100 — whose every point, length, tangent and bounding box are known exactly. */
import {test, near, ok, eq} from "../../../tests/harness.js";
import {spline, bezier, splineEval, splineLength, splinePointAt, splineTangentAt, splineSample,
        splineBBox, splineClosest, splineTrim, splineReverse, splineTransform} from "./spline.js";

const H = Math.SQRT1_2, R = 100, PI = Math.PI;
const quarter = () => spline({degree: 2, knots: [0, 0, 0, 1, 1, 1], ctrl: [[R, 0], [R, R], [0, R]], weights: [1, H, 1]});

test("splineEval: Bezier bậc 2 tại u = 0.5 — điểm (50, 50), đạo hàm (100, 0)", () => {
  const r = splineEval(bezier([[0, 0], [50, 100], [100, 0]]), 0.5);   // ¼P0 + ½P1 + ¼P2 · 2[(P1−P0)/2 + (P2−P1)/2]
  near(r.pt[0], 50, 1e-12); near(r.pt[1], 50, 1e-12);
  near(r.d[0], 100, 1e-12); near(r.d[1], 0, 1e-12);
});

test("splineLength: Bezier thẳng = 300, ¼ đường tròn NURBS = 50π", () => {
  near(splineLength(bezier([[0, 0], [100, 0], [200, 0], [300, 0]])), 300, 1e-9);
  near(splineLength(quarter()), 50*PI, 1e-9);
});

test("splinePointAt: t theo chiều dài cung — giữa ¼ đường tròn là điểm 45°", () => {
  const q = splinePointAt(quarter(), 0.5);
  near(q[0], R*H, 1e-9); near(q[1], R*H, 1e-9);
});

test("splineTangentAt: đầu cung đi lên (0, 1), cuối cung đi sang trái (−1, 0)", () => {
  const a = splineTangentAt(quarter(), 0), b = splineTangentAt(quarter(), 1);
  near(a[0], 0, 1e-9); near(a[1], 1, 1e-9);
  near(b[0], -1, 1e-9); near(b[1], 0, 1e-9);
});

test("splineSample: mọi điểm nằm trên đường tròn, hai đầu đúng, dây cung lệch ≤ dung sai", () => {
  const pts = splineSample(quarter(), 0.01);
  for(const [x, y] of pts) near(Math.hypot(x, y), R, 1e-9);
  near(pts[0][0], R, 1e-12); near(pts[pts.length - 1][1], R, 1e-12);
  for(let i = 1; i < pts.length; i++){
    const c = Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]);
    ok(R - Math.sqrt(R*R - c*c/4) <= 0.01 + 1e-12, `đoạn ${i}: độ võng vượt 0.01 mm`);   // sagitta of that chord
  }
});

test("splineBBox: ¼ đường tròn nằm gọn trong [0, 100] × [0, 100]", () => {
  const b = splineBBox(quarter());
  near(b.x0, 0, 1e-3); near(b.y0, 0, 1e-3); near(b.x1, R, 1e-9); near(b.y1, R, 1e-9);
});

test("splineClosest: từ (200, 200) — điểm 45°, cách 200√2 − 100, t = 0.5", () => {
  const r = splineClosest(quarter(), [200, 200]);
  near(r.point[0], R*H, 1e-7); near(r.point[1], R*H, 1e-7);
  near(r.dist, 200*Math.SQRT2 - R, 1e-9);
  near(r.t, 0.5, 1e-9);
});

test("splineTrim: giữ t 0.25 → 0.75 = nửa cung, hai đầu ở 22.5° và 67.5°", () => {
  const s = splineTrim(quarter(), 0.25, 0.75);
  near(splineLength(s), 25*PI, 1e-9);
  const a = splinePointAt(s, 0), b = splinePointAt(s, 1);
  near(Math.atan2(a[1], a[0]), PI/8, 1e-9); near(Math.atan2(b[1], b[0]), 3*PI/8, 1e-9);
});

test("splineReverse: bắt đầu ở (0, 100), cùng chiều dài", () => {
  const s = splineReverse(quarter()), a = splinePointAt(s, 0);
  near(a[0], 0, 1e-12); near(a[1], R, 1e-12);
  near(splineLength(s), 50*PI, 1e-9);
});

test("splineTransform: xoay 90° quanh gốc — đầu cung sang (0, 100), chiều dài giữ nguyên", () => {
  const s = splineTransform(quarter(), {a: 0, b: 1, c: -1, d: 0, e: 0, f: 0});
  const a = splinePointAt(s, 0);
  near(a[0], 0, 1e-12); near(a[1], R, 1e-12);
  near(splineLength(s), 50*PI, 1e-9);
});

test("splineTransform: dời giữ chiều dài tới bit cuối; xoay + phóng đều ×1.5 nhân đúng chiều dài — điểm theo t vẫn đúng", () => {
  /* Dời cả mảnh (edit.md C5) không được đổi một số đo ở chữ số cuối. Phép đồng dạng nhân chiều dài
     cung đúng k lần, nên bảng chiều dài đi theo nó thay vì tính lại — đối chiếu với dạng đóng của
     ¼ đường tròn r = 100 (chiều dài 50π·k, điểm giữa ở 45°), và với một spline dựng mới từ cùng lưới
     điểm điều khiển, tự tính bảng từ đầu */
  const s = spline({degree: 3, knots: [0, 0, 0, 0, 0.3, 0.7, 1, 1, 1, 1],
                    ctrl: [[1000.1, -2000.3], [1030.7, -1990.2], [1060.3, -2030.9], [1090.4, -1980.1], [1120.9, -2010.5], [1150.2, -2000.7]]});
  const L = splineLength(s);
  const moved = splineTransform(s, {a: 1, b: 0, c: 0, d: 1, e: 12.34, f: -5.678});
  ok(splineLength(moved) === L, `dời: chiều dài lệch ${splineLength(moved) - L}`);
  const c = Math.cos(0.7), sn = Math.sin(0.7), k = 1.5;
  const turned = splineTransform(quarter(), {a: k*c, b: k*sn, c: -k*sn, d: k*c, e: 3, f: 4});
  near(splineLength(turned), k*50*PI, 1e-9);
  const m = splinePointAt(turned, 0.5), x = k*R*H, y = k*R*H;
  near(m[0], c*x - sn*y + 3, 1e-9); near(m[1], sn*x + c*y + 4, 1e-9, "điểm giữa cung vẫn là điểm 45° đã xoay");
  const fresh = spline({...turned});
  for(const t of [0.1, 0.37, 0.9]){ const a = splinePointAt(turned, t), b = splinePointAt(fresh, t); near(a[0], b[0], 1e-9); near(a[1], b[1], 1e-9, `t = ${t}`); }
  /* lệch trục không phải đồng dạng: bảng tính lại từ đầu, và vẫn đúng */
  const skew = splineTransform(s, {a: 1, b: 0, c: 0.5, d: 1, e: 0, f: 0});
  near(splineLength(skew), splineLength(spline({...skew})), 1e-9);
});

test("spline từ chối knot sai, bezier cần ít nhất 2 điểm", () => {
  let msg = "";
  try{ spline({degree: 2, knots: [0, 0, 1, 1], ctrl: [[0, 0], [1, 1], [2, 0]]}); }catch(e){ msg = e.message; }
  ok(/không hợp lệ/.test(msg), msg);
  msg = "";
  try{ bezier([[0, 0]]); }catch(e){ msg = e.message; }
  ok(/không hợp lệ/.test(msg), msg);
  eq(bezier([[0, 0], [1, 1]]).degree, 1);
});
