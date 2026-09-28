/* Point-to-Point (Straight) — bộ test tổng hợp (spec: point_to_point.md).

   Expected value tính tay: 3-4-5, cạnh hình chữ nhật, đường chéo √2. */
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {point} from "./model.js";
import {straight, nearestPoint} from "./straight.js";

const P = (x, y) => point(x, y);
const TOL = 1e-9;

/* ── P1 · công thức đóng ────────────────────────────────────────────────── */
test("P1 tam giác 3-4-5 → 500 mm", () => {
  const r = straight(P(0, 0), P(300, 400));
  near(r.distance, 500, TOL);
  near(r.dx, 300, TOL); near(r.dy, 400, TOL);
});

test("P1 đo ngang và đo dọc", () => {
  near(straight(P(10, 7), P(110, 7)).distance, 100, TOL);
  near(straight(P(10, 7), P(10, 57)).distance, 50, TOL);
});

test("P1 đường chéo hình vuông cạnh 100 = 100·√2", () =>
  near(straight(P(0, 0), P(100, 100)).distance, 100*Math.SQRT2, TOL));

/* ── P2 · đối xứng ──────────────────────────────────────────────────────── */
test("P2 đo A→B bằng đo B→A", () => {
  const a = P(-31.4, 88.2), b = P(206.7, -14.9);
  near(straight(a, b).distance, straight(b, a).distance, TOL);
  near(straight(a, b).dx, -straight(b, a).dx, TOL, "dx đổi dấu");
});

/* ── P3 · hai điểm trùng nhau ───────────────────────────────────────────── */
test("P3 hai điểm trùng nhau → 0, không NaN", () => {
  const r = straight(P(12.5, -3), P(12.5, -3));
  eq(r.distance, 0);
  ok(Number.isFinite(r.distance), "không được ra NaN");
});

/* ── P4 · không đi theo đường ───────────────────────────────────────────── */
test("P4 hai điểm không liên quan đường nào vẫn đo được", () => {
  /* Along Path sẽ ném lỗi vì không có path liên tục; Straight thì không quan tâm */
  near(straight(P(0, 0), P(0, 250)).distance, 250, TOL);
});

/* ── P6 · bắt điểm đã định nghĩa ────────────────────────────────────────── */
const PTS = [[0, 0], [100, 0], [100, 50], [0, 50], [37, 25]];

test("P6 bấm gần một điểm thì bắt đúng điểm đó", () => {
  const r = nearestPoint(PTS, [98, 3], 12);
  deepEq(r.point, [100, 0]);
  near(r.dist, Math.hypot(2, 3), TOL);
  eq(r.index, 1);
});

test("P6 điểm gần nhất thắng, không phải điểm đầu danh sách", () =>
  deepEq(nearestPoint(PTS, [40, 22], 12).point, [37, 25]));

test("P6 ngoài bán kính thì không bắt gì cả", () =>
  eq(nearestPoint(PTS, [50, 25], 5), null));

test("P6 danh sách rỗng trả null chứ không ném lỗi", () =>
  eq(nearestPoint([], [0, 0], 12), null));

test("P6 bán kính tính đúng theo khoảng cách, không theo ô vuông bao quanh", () => {
  /* [7,7] cách [0,0] đúng 9.899 — nằm trong bán kính 10 dù dx và dy đều < 10 */
  ok(nearestPoint([[0, 0]], [7, 7], 10) !== null, "9.899 < 10 thì phải bắt");
  eq(nearestPoint([[0, 0]], [7.5, 7.5], 10), null, "10.607 > 10 thì không");
});

/* ── P7 · số đo là mm world, không phụ thuộc zoom ───────────────────────── */
test("P7 đổi bán kính bắt điểm không làm đổi con số đo được", () => {
  const a = nearestPoint(PTS, [98, 3], 12).point, b = nearestPoint(PTS, [2, 48], 12).point;
  near(straight(P(a[0], a[1]), P(b[0], b[1])).distance,
       straight(P(100, 0), P(0, 50)).distance, TOL);
});
