/* BỘ 1 — Geometry Model trên rập thật 3380.
   Dựng Point/Line/Curve từ toạ độ nhà máy rồi kiểm toạ độ và topology.
   Expected value lấy từ: (a) chính file DXF đọc bằng parser riêng, (b) bảng layer
   trong INTENT §4.3, (c) số đo trong input/reference_shapes.md. */
import {test, eq, near, deepEq, ok} from "../../../tests/harness.js";
import {source, names, block, ringPts, pointsOn, lineOn, measured,
        hypot, rawPerimeter, rawBBox} from "../../../tests/fixture3380.js";
import {point, line, curve, length, pointAt, bbox, closestPoint, sample, signedArea, isCCW,
        arc, containsAngle} from "./model.js";

const WING = "后比_L1", CUP = "杯面_L2", CRADLE = "前下摆_L3", BINDING = "杯口_L4";

test("fixture khai đúng nguồn gốc và còn nguyên vẹn", () => {
  eq(source.file, "DXF Pattern/3380泳布-7.8.dxf");
  eq(source.encoding, "gbk", "tên mảnh tiếng Trung — đọc sai encoding là hỏng ngay");
  eq(source.sha256.length, 64);
});

test("đủ 4 mảnh đúng tên nhà máy đặt", () =>
  deepEq(names, [WING, CUP, CRADLE, BINDING]));

test("số điểm mốc từng layer khớp bảng INTENT §4.3", () => {
  const count = l => names.reduce((s, n) => s + pointsOn(n, l).length, 0);
  eq(count("2"), 86, "turn point");
  eq(count("3"), 849, "curve point");
  eq(count("4"), 8, "notch");
});

test("Point dựng từ toạ độ nhà máy giữ nguyên số, không làm tròn", () => {
  const n = pointsOn(CRADLE, "4")[0];
  const p = point(n.x, n.y);
  eq(p.x, n.x); eq(p.y, n.y);
  eq(p.x, -44.04, "toạ độ thật của notch, đơn vị mm");
});

test("Curve từ đường cắt: khép kín, đỉnh lặp của nhà máy bị chuẩn hoá bỏ", () => {
  let normalised = 0;
  for(const n of names){
    const pts = ringPts(n, "1");
    const c = curve(pts, true);
    eq(c.closed, true, n);
    const dup = hypot(pts[0], pts[pts.length-1]) <= 1e-9;     // nhà máy lặp đỉnh đầu ở cuối
    eq(c.pts.length, pts.length - (dup ? 1 : 0), n);
    if(dup) normalised++;
    ok(hypot(c.pts[0], c.pts[c.pts.length-1]) > 1e-9, `${n}: sau chuẩn hoá không còn đỉnh lặp`);
  }
  ok(normalised >= 1, "ít nhất một mảnh của rập 3380 có đỉnh lặp — đó là lý do phải chuẩn hoá");
});

test("sau chuẩn hoá, không đoạn nào dài 0 — bất biến mà offset dựa vào", () => {
  for(const n of names){
    const c = curve(ringPts(n, "1"), true);
    const ring = c.pts.concat([c.pts[0]]);
    for(let i = 1; i < ring.length; i++)
      ok(hypot(ring[i-1], ring[i]) > 1e-9, `${n} đoạn ${i} dài 0`);
  }
});

test("không có đoạn dài 0 trong đường cắt — topology sạch", () => {
  for(const n of names){
    const pts = ringPts(n, "1");
    for(let i = 1; i < pts.length; i++)
      ok(hypot(pts[i-1], pts[i]) > 1e-9, `${n} đỉnh ${i} trùng đỉnh trước`);
  }
});

test("chiều dài Curve khớp chu vi đo bằng vòng lặp trần", () => {
  for(const n of names){
    const pts = ringPts(n, "1");
    near(length(curve(pts, true)), rawPerimeter(pts), 1e-9, n);
    near(length(curve(pts, true)), measured(n).cut_perimeter, 1e-3, n + " (số của make_fixture.py)");
  }
});

test("chu vi 4 đường may kín = 2981.1 mm như reference_shapes.md đã đo", () => {
  const total = names.reduce((s, n) => s + length(curve(ringPts(n, "8"), true)), 0);
  near(total, 2981.1, 0.05);
});

test("bbox khớp min/max tính tay", () => {
  const pts = ringPts(CRADLE, "1");
  const b = bbox(curve(pts, true)), r = rawBBox(pts);
  near(b.x0, r.x0, 1e-9); near(b.y0, r.y0, 1e-9);
  near(b.x1, r.x1, 1e-9); near(b.y1, r.y1, 1e-9);
  near(b.w, 447.40, 0.01, "bề ngang mảnh cradle, mm");
});

test("pointAt(0) là đỉnh đầu, pointAt(1) quay về đỉnh đầu vì ring kín", () => {
  const pts = ringPts(WING, "1");
  const c = curve(pts, true);
  deepEq(pointAt(c, 0), point(pts[0][0], pts[0][1]));
  const end = pointAt(c, 1);
  near(end.x, pts[0][0], 1e-9); near(end.y, pts[0][1], 1e-9);
});

test("t đúng là phần trăm chiều dài, đo ngược lại bằng tay", () => {
  const pts = ringPts(WING, "1");
  const c = curve(pts, true), total = rawPerimeter(pts);
  for(const t of [0.25, 0.5, 0.75]){
    const q = pointAt(c, t);
    /* đi bộ dọc ring tới khi đủ t·total rồi so — hoàn toàn không dùng kernel */
    const ring = pts.concat([pts[0]]);
    let acc = 0, got = null;
    for(let i = 1; i < ring.length && got === null; i++){
      const d = hypot(ring[i-1], ring[i]);
      if(acc + d >= t*total - 1e-9){
        const u = (t*total - acc)/d;
        got = [ring[i-1][0] + (ring[i][0]-ring[i-1][0])*u, ring[i-1][1] + (ring[i][1]-ring[i-1][1])*u];
      }
      acc += d;
    }
    near(q.x, got[0], 1e-6, `t=${t}`); near(q.y, got[1], 1e-6, `t=${t}`);
  }
});

test("closestPoint tại một đỉnh thật cho khoảng cách 0", () => {
  const pts = ringPts(CUP, "1");
  const c = curve(pts, true);
  const k = 40;
  const r = closestPoint(c, point(pts[k][0], pts[k][1]));
  near(r.dist, 0, 1e-9);
  near(pointAt(c, r.t).x, pts[k][0], 1e-6);
});

test("Line từ grainline thật: chiều dài khớp hypot của hai đầu", () => {
  const g = lineOn(WING, "7");
  const l = line(point(g.a[0], g.a[1]), point(g.b[0], g.b[1]));
  near(length(l), hypot(g.a, g.b), 1e-12);
  near(length(l), 116.69, 0.01);
  near(g.a[0], g.b[0], 1e-9, "grainline của rập này thẳng đứng");
});

test("ring của nhà máy quay CÙNG chiều kim đồng hồ — chiều quay không được đoán", () => {
  for(const n of names){
    const c = curve(ringPts(n, "1"), true);
    eq(isCCW(c), false, n);
    ok(signedArea(c) < 0, n);
  }
});

test("Arc dựng qua 3 điểm thật của đường cắt đi đúng qua cả ba", () => {
  const pts = ringPts(CRADLE, "1");
  const [A, B, C] = [pts[10], pts[25], pts[40]];
  /* tâm đường tròn ngoại tiếp — công thức riêng trong test, không mượn kernel */
  const d = 2*(A[0]*(B[1]-C[1]) + B[0]*(C[1]-A[1]) + C[0]*(A[1]-B[1]));
  const ux = ((A[0]**2 + A[1]**2)*(B[1]-C[1]) + (B[0]**2 + B[1]**2)*(C[1]-A[1]) + (C[0]**2 + C[1]**2)*(A[1]-B[1]))/d;
  const uy = ((A[0]**2 + A[1]**2)*(C[0]-B[0]) + (B[0]**2 + B[1]**2)*(A[0]-C[0]) + (C[0]**2 + C[1]**2)*(B[0]-A[0]))/d;
  const r = Math.hypot(A[0]-ux, A[1]-uy);
  const ang = p => Math.atan2(p[1]-uy, p[0]-ux);
  const a = arc(point(ux, uy), r, ang(A), ang(C), ang(B) > ang(A));
  for(const p of [A, B, C]) near(closestPoint(a, point(p[0], p[1])).dist, 0, 1e-6);
  ok(containsAngle(a, ang(B)), "điểm giữa nằm trong góc quét");
});

test("sample() của ring kín trả về đỉnh cuối trùng đỉnh đầu để vẽ liền nét", () => {
  const c = curve(ringPts(BINDING, "1"), true);
  const s = sample(c);
  eq(s.length, c.pts.length + 1);   // chuẩn hoá rồi mới đóng vòng
  deepEq(s[s.length-1], s[0]);
});
