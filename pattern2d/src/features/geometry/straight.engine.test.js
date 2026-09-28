/* Measure Engine · P2P (spec: src/features/measure/measure_engine.md §5).

   Expected values are hand geometry — every one of them written down before the engine
   runs. Invalid input must be REFUSED with an error that names the problem: a NaN that
   reaches the readout prints as "NaN" at best and as a plausible number at worst. */
import {mcase} from "../../../tests/engine.js";
import {point} from "./model.js";
import {straight, nearestPoint} from "./straight.js";

const G = "P2P", P = (x, y) => point(x, y);
const d = (a, b) => straight(a, b).distance;

mcase({id: "P2P-01", group: G, kind: "N", what: "ngang (12.5, −7) → (212.5, −7)", expect: 200, tol: 1e-9,
       source: "tay: dx = 200"}, () => d(P(12.5, -7), P(212.5, -7)));
mcase({id: "P2P-02", group: G, kind: "N", what: "dọc (40, 10) → (40, 160.25)", expect: 150.25, tol: 1e-9,
       source: "tay: dy = 150.25"}, () => d(P(40, 10), P(40, 160.25)));
mcase({id: "P2P-03", group: G, kind: "N", what: "chéo 3-4-5 (0, 0) → (300, 400)", expect: 500, tol: 1e-9,
       source: "tay"}, () => d(P(0, 0), P(300, 400)));
mcase({id: "P2P-04", group: G, kind: "N", what: "chéo 45° (−50, −50) → (50, 50)", expect: 100*Math.SQRT2, tol: 1e-9,
       source: "tay: 100√2"}, () => d(P(-50, -50), P(50, 50)));
mcase({id: "P2P-05", group: G, kind: "N", what: "chéo góc phần tư II (10, 20) → (−50, 100)", expect: 100, tol: 1e-9,
       source: "tay: 60-80-100"}, () => d(P(10, 20), P(-50, 100)));
mcase({id: "P2P-06", group: G, kind: "N", what: "đối xứng: A→B = B→A, dx đổi dấu", expect: [0, 0], tol: 1e-12,
       source: "định nghĩa"}, () => {
  const a = P(-31.4, 88.2), b = P(206.7, -14.9), f = straight(a, b), r = straight(b, a);
  return [f.distance - r.distance, f.dx + r.dx];
});

mcase({id: "P2P-07", group: G, kind: "B", what: "cùng một điểm → 0 (không NaN, không −0)", expect: true,
       source: "định nghĩa"}, () => Object.is(d(P(12.5, -3), P(12.5, -3)), 0));
mcase({id: "P2P-08", group: G, kind: "B", what: "cách nhau 1e-6 mm ở toạ độ 1000", expect: 1e-6, tol: 1e-12,
       source: "tay"}, () => d(P(1000, 1000), P(1000.000001, 1000)));
mcase({id: "P2P-09", group: G, kind: "B", what: "toạ độ xa gốc 1e6 mm", expect: 500, tol: 1e-9,
       source: "tay: 3-4-5"}, () => d(P(1e6, 1e6), P(1e6 + 300, 1e6 + 400)));
mcase({id: "P2P-10", group: G, kind: "B", what: "cả hai điểm toạ độ âm", expect: 500, tol: 1e-9,
       source: "tay: 3-4-5"}, () => d(P(-100, -200), P(-400, -600)));

mcase({id: "P2P-11", group: G, kind: "I", what: "toạ độ NaN → báo lỗi", expect: {throws: /điểm/},
       source: "rule: không trả NaN"}, () => d(P(NaN, 0), P(1, 0)));
mcase({id: "P2P-12", group: G, kind: "I", what: "toạ độ ∞ → báo lỗi", expect: {throws: /điểm/},
       source: "rule"}, () => d(P(0, 0), P(Infinity, 5)));
mcase({id: "P2P-13", group: G, kind: "I", what: "thiếu y → báo lỗi", expect: {throws: /điểm/},
       source: "rule"}, () => d({kind: "point", x: 3}, P(0, 0)));
mcase({id: "P2P-14", group: G, kind: "I", what: "điểm null → báo lỗi rõ ràng", expect: {throws: /điểm/},
       source: "rule"}, () => d(null, P(0, 0)));
mcase({id: "P2P-15", group: G, kind: "I", what: "đưa mảng [x, y] thay cho điểm → báo lỗi", expect: {throws: /điểm/},
       source: "rule"}, () => d([0, 0], [3, 4]));

/* the snap: a click next to a notch measures from the notch, not from the click */
const NOTCHES = [[30, 0], [150, 42], [0, 50]];
mcase({id: "P2P-16", group: G, kind: "N", what: "bấm lệch cạnh hai notch → đo đúng notch–notch", expect: Math.hypot(120, 42),
       tol: 1e-9, source: "tay: hypot(120, 42)"}, () => {
  const a = nearestPoint(NOTCHES, [31.5, -1.2], 4).point, b = nearestPoint(NOTCHES, [148.8, 43.1], 4).point;
  return d(P(a[0], a[1]), P(b[0], b[1]));
});
mcase({id: "P2P-17", group: G, kind: "B", what: "bán kính bắt điểm đúng bằng khoảng cách → vẫn bắt", expect: true,
       source: "point_to_point.md P6: trong bán kính"}, () => nearestPoint([[0, 0]], [3, 4], 5) !== null);
