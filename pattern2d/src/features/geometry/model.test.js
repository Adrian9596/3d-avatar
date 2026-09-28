import {test, eq, near, deepEq, ok} from "../../../tests/harness.js";
import {point, line, arc, curve, length, pointAt, tangentAt, normalAt, bbox, closestPoint,
        split, trimBetween, reverse, transform, translation, scaling, rotation, sample,
        containsAngle, sweep, EPS, isShape, angleAt, curveSteps, matrix, applyM,
        signedArea, isCCW, looseBox, boxGap} from "./model.js";
import {spline} from "./spline.js";

const L = line(point(0,0), point(100,0));
const Q = arc(point(0,0), 10, 0, Math.PI/2);                  // một phần tư, ngược KĐH
const C = curve([[0,0],[100,0],[100,100]]);                   // hai đoạn, tổng 200

test("chiều dài: đoạn thẳng, cung, polyline", () => {
  near(length(L), 100);
  near(length(Q), Math.PI*10/2, 1e-9);
  near(length(C), 200);
  near(length(curve([[0,0],[10,0],[10,10]], true)), 20 + Math.hypot(10,10), 1e-9, "curve kín tính cả đoạn khép");
});

test("t chạy theo chiều dài cung, không theo chỉ số điểm", () => {
  deepEq(pointAt(C, 0.5), point(100, 0), "giữa polyline rơi đúng đỉnh gãy");
  deepEq(pointAt(C, 0.25), point(50, 0));
  const q = pointAt(C, 1/3);
  near(q.x, 200/3, 1e-9, "một phần ba chiều dài — chỗ rập đặt notch");
});

test("điểm và tiếp tuyến trên cung", () => {
  const p0 = pointAt(Q, 0), p1 = pointAt(Q, 1);
  near(p0.x, 10); near(p0.y, 0, 1e-9);
  near(p1.x, 0, 1e-9); near(p1.y, 10);
  const t = tangentAt(Q, 0);
  near(t.x, 0, 1e-9); near(t.y, 1, 1e-9, "đi ngược chiều kim đồng hồ");
});

test("pháp tuyến trái vuông góc với tiếp tuyến", () => {
  const t = tangentAt(L, 0.5), n = normalAt(L, 0.5);
  near(t.x*n.x + t.y*n.y, 0, 1e-12);
  near(n.y, 1, 1e-12, "bên trái của hướng +x là +y");
});

test("hộp bao cung tính cả điểm cực mà cung quét qua", () => {
  const half = arc(point(0,0), 10, 0, Math.PI);               // quét qua đỉnh trên
  const b = bbox(half);
  near(b.y1, 10, 1e-9, "đỉnh cung, không phải hai đầu");
  near(b.x0, -10, 1e-9);
});

test("điểm gần nhất: trong đoạn thì chiếu, ngoài đoạn thì kẹp về đầu mút", () => {
  const a = closestPoint(L, point(30, 40));
  near(a.dist, 40); near(a.t, 0.3);
  const b = closestPoint(L, point(-50, 0));
  near(b.t, 0); near(b.dist, 50);
});

test("điểm gần nhất trên cung: ngoài góc quét thì về đầu mút gần hơn", () => {
  const r = closestPoint(Q, point(20, -20));
  near(r.t, 0, 1e-9);
  const s = closestPoint(Q, point(10, 10));
  near(s.dist, Math.hypot(10,10) - 10, 1e-9, "chiếu ra đường tròn");
});

test("cắt tại t cho hai mảnh nối lại đủ chiều dài", () => {
  const [a, b] = split(L, 0.3);
  near(length(a) + length(b), 100, 1e-9);
  near(a.b.x, 30);
  const [c, d] = split(Q, 0.5);
  near(length(c) + length(d), length(Q), 1e-9);
});

test("giữ đoạn giữa hai tham số", () => {
  near(length(trimBetween(L, 0.25, 0.75)), 50, 1e-9);
  const t = trimBetween(C, 0.25, 0.75);
  near(length(t), 100, 1e-9);
  deepEq(t.pts[0], [50, 0]);
});

test("đảo chiều giữ nguyên hình, đổi chiều đi", () => {
  const r = reverse(Q);
  near(length(r), length(Q), 1e-9);
  deepEq(pointAt(r, 0), pointAt(Q, 1));
  eq(r.ccw, false);
});

test("biến đổi affine: tịnh tiến, phóng, xoay", () => {
  deepEq(transform(point(1,2), translation(10,20)), point(11,22));
  const s = transform(L, scaling(2, 0, 0));
  near(length(s), 200);
  const r = transform(L, rotation(Math.PI/2, 0, 0));
  near(r.b.x, 0, 1e-9); near(r.b.y, 100, 1e-9);
});

test("phóng cung thì bán kính phóng theo", () => {
  const s = transform(Q, scaling(3, 0, 0));
  near(s.r, 30, 1e-9);
  near(length(s), length(Q)*3, 1e-9);
});

test("băm cung ra điểm vẽ: sai số dưới dung sai", () => {
  const pts = sample(Q, 0.05);
  ok(pts.length > 4, "cung nhỏ vẫn phải đủ điểm");
  for(const [x, y] of pts) near(Math.hypot(x, y), 10, 1e-9, "mọi điểm nằm trên đường tròn");
});

test("góc nằm trong cung hay không", () => {
  ok(containsAngle(Q, Math.PI/4));
  ok(!containsAngle(Q, -Math.PI/4));
  near(sweep(Q), Math.PI/2, 1e-12);
});

test("EPS đủ nhỏ để không nuốt sai số thật của rập (0.01 mm)", () => {
  ok(EPS < 1e-6, "EPS = " + EPS);
  ok(0.01 > EPS*1000, "sai số rập 0.01 mm vẫn là khác 0 với EPS này");
});

test("isShape nhận đúng bốn kiểu, từ chối thứ khác", () => {
  for(const s of [point(0,0), L, Q, C]) ok(isShape(s));
  ok(!isShape({kind: "ellipse"})); ok(!isShape(null)); ok(!isShape({x: 1, y: 2}));
});

test("angleAt nội suy góc trong cung", () => {
  near(angleAt(Q, 0), 0, 1e-12);
  near(angleAt(Q, 0.5), Math.PI/4, 1e-12);
  near(angleAt(Q, 1), Math.PI/2, 1e-12);
});

test("curveSteps trả mốc chiều dài dồn, ring kín thì cộng cả đoạn khép", () => {
  const s = curveSteps(C);
  deepEq(s.cum, [0, 100, 200]);
  near(s.total, 200);
  const ring = curveSteps(curve([[0,0],[30,0],[30,40]], true));
  near(ring.total, 30 + 40 + 50, 1e-9, "tam giác 3-4-5 nhân 10");
  eq(ring.pts.length, 4, "điểm đầu được nối lại ở cuối để đi hết vòng");
});

test("matrix và applyM: ma trận affine áp đúng công thức", () => {
  const m = matrix(2, 0, 0, 3, 10, -5);          // x' = 2x + 10 · y' = 3y − 5
  deepEq(applyM(m, 4, 6), point(18, 13));
  deepEq(applyM(translation(1, 2), 0, 0), point(1, 2));
});

test("signedArea: dấu cho biết chiều quay, trị tuyệt đối là diện tích", () => {
  const ccw = curve([[0,0],[10,0],[10,10],[0,10]], true);
  near(signedArea(ccw), 100);
  ok(isCCW(ccw));
  near(signedArea(reverse(ccw)), -100);
  ok(!isCCW(reverse(ccw)));
});

/* 2026-09-24 — a box that surely holds a shape, cheap to get: what snap, Along and the notch pick ask first, so a
   click near one spline of 10 000 does not measure the other 9 999 (hover in Vẽ took 0.2 s a move on 2938#齐码) */
test("looseBox holds every kind whole — a spline by its control polygon (the convex hull property) — and is kept per shape", () => {
  const within = (b, pts) => pts.every(([x, y]) => x >= b.x0 - 1e-9 && x <= b.x1 + 1e-9 && y >= b.y0 - 1e-9 && y <= b.y1 + 1e-9);
  for(const s of [L, Q, C, arc(point(5, 5), 20, 0.3, 5.9, true), arc(point(0, 0), 10, 2, 1, false), point(3, 4)])
    ok(within(looseBox(s), s.kind === "point" ? [[s.x, s.y]] : sample(s, 0.01)), `${s.kind} nằm trọn trong hộp`);
  const S = spline({degree: 3, knots: [0, 0, 0, 0, 1, 2, 2, 2, 2], ctrl: [[0, 0], [10, 40], [30, -20], [50, 30], [60, 0]]});
  const b = looseBox(S);
  deepEq([b.x0, b.y0, b.x1, b.y1], [0, -20, 60, 40], "hộp của đa giác điều khiển");
  ok(within(b, sample(S, 0.001)), "spline nằm trọn trong hộp");
  ok(looseBox(S) === b, "hỏi lại cùng một hình: cùng một hộp, không tính lại");
  const B = {x0: 0, y0: 0, x1: 10, y1: 5};
  eq(boxGap(B, [4, 2]), 0, "trong hộp: 0"); eq(boxGap(B, [13, 9]), 5, "ngoài góc: 3-4-5"); eq(boxGap(B, [-2, 3]), 2, "ngoài cạnh trái");
});
