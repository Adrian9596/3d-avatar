/* Measure Engine · Editing — the kernel side: doc.js / ops.js
   (spec: src/features/measure/measure_engine.md §5; the viewer side — a measurement taken
   before Arrange moves a piece — is in measure/measure.engine.test.js).

   After every edit the number read back must be the number of the geometry AFTER the edit,
   worked out by hand. Nothing may be silently lost on the way (a trim that splits a line in
   two keeps both halves). */
import {mcase} from "../../../tests/engine.js";
import {point, line, arc, curve, length, split} from "./model.js";
import {trim, extend} from "./ops.js";
import {chain, chainLength, alongPath} from "./path.js";
import {createDoc} from "./doc.js";

const G = "Editing", PI = Math.PI, P = (x, y) => point(x, y);
const RING = [[0, 0], [100, 0], [100, 60], [0, 60]];
const stadium = () => [line(P(0, 0), P(200, 0)), arc(P(200, 50), 50, -PI/2, PI/2, true),
                       line(P(200, 100), P(0, 100)), arc(P(0, 50), 50, PI/2, 3*PI/2, true)];

mcase({id: "EDIT-01", group: G, kind: "N", what: "move nút nguồn: số đo tới trung điểm cập nhật [trước, sau]",
       expect: [40, Math.hypot(30, 60)], tol: 1e-9, source: "tay: trung điểm (50,0) → (80,−20)"}, () => {
  const doc = createDoc();
  const L = doc.add(line(P(0, 0), P(100, 0))), M = doc.derive("midpoint", [L]), F = doc.add(P(50, 40));
  const before = doc.measure(M, F).distance;
  doc.move(L, 30, -20);
  return [before, doc.measure(M, F).distance];
});
mcase({id: "EDIT-02", group: G, kind: "N", what: "move ring: [chu vi, lối ngắn giữa hai mốc đã dời]", expect: [320, 20], tol: 1e-9,
       source: "tay"}, () => {
  const doc = createDoc(), R = doc.add(curve(RING, true));
  doc.move(R, 12, -7);
  const ch = chain([doc.get(R)]);
  return [ch.total, alongPath(ch, P(12, 3), P(22, -7)).distance];
});
mcase({id: "EDIT-03", group: G, kind: "N", what: "trim một đầu: [số mảnh còn lại, chiều dài dọc mảnh còn]", expect: [1, 70], tol: 1e-9,
       source: "tay: 100 − 30"}, () => {
  const r = trim(line(P(0, 0), P(100, 0)), [line(P(30, -5), P(30, 5))], P(10, 0));
  return [r.kept.length, alongPath(chain(r.kept), P(30, 0), P(100, 0)).distance];
});
mcase({id: "EDIT-04", group: G, kind: "N", what: "doc.trim giữa hai vật chặn: [số mảnh doc giữ, Σ chiều dài]", expect: [2, 60], tol: 1e-9,
       source: "tay: 100 − 40, hai mảnh 30 + 30"}, () => {
  const doc = createDoc();
  const L = doc.add(line(P(0, 0), P(100, 0)));
  const c1 = doc.add(line(P(30, -5), P(30, 5))), c2 = doc.add(line(P(70, -5), P(70, 5)));
  const r = doc.trim(L, [c1, c2], P(50, 0));
  return [r.ids.length, r.ids.reduce((s, id) => s + length(doc.get(id)), 0)];
});
mcase({id: "EDIT-05", group: G, kind: "N", what: "extend line tới vật chặn: dọc từ đầu tới đầu mới", expect: 70, tol: 1e-9,
       source: "tay"}, () => {
  const e = extend(line(P(0, 0), P(40, 0)), [line(P(70, -10), P(70, 10)), line(P(90, -10), P(90, 10))], "end");
  return alongPath(chain([e]), P(0, 0), P(70, 0)).distance;
});
mcase({id: "EDIT-06", group: G, kind: "N", what: "extend cung r = 50 từ 45° tới trục y (90°)", expect: 25*PI, tol: 1e-9,
       source: "tay: 50·π/2"}, () => length(extend(arc(P(0, 0), 50, 0, PI/4, true), [line(P(0, 0), P(0, 100))], "end")));
mcase({id: "EDIT-07", group: G, kind: "N", what: "split cung sân vận động tại t = 0.25: [chu vi, lối ngắn]", expect: [400 + 100*PI, 100 + 50*PI],
       tol: 1e-9, source: "tay: split không đổi số đo"}, () => {
  const s = stadium(), [a, b] = split(s[1], 0.25);
  const ch = chain([s[0], a, b, s[2], s[3]]);
  return [ch.total, alongPath(ch, P(50, 0), P(50, 100)).distance];
});
mcase({id: "EDIT-08", group: G, kind: "B", what: "split ring kín tại t = 0.4 rồi xâu lại: [kín, chu vi]", expect: [true, 320], tol: 1e-9,
       source: "tay"}, () => { const [a, b] = split(curve(RING, true), 0.4); const ch = chain([b, a]); return [ch.closed, ch.total]; });
mcase({id: "EDIT-09", group: G, kind: "N", what: "undo sau move + scale: [Δ chu vi đường may, Δ số đo]", expect: [0, 0], tol: 1e-12,
       source: "định nghĩa undo"}, () => {
  const doc = createDoc();
  const R = doc.add(curve(RING, true)), S = doc.derive("offset", [R], {d: 6, side: "in"}), F = doc.add(P(150, 30));
  const p0 = chainLength(chain([doc.get(S)])), m0 = doc.measure(S, F).distance, snap = doc.snapshot();
  doc.move(R, 50, 50); doc.scale(R, 2, P(0, 0)); doc.solve();
  doc.restore(snap);
  return [chainLength(chain([doc.get(S)])) - p0, doc.measure(S, F).distance - m0];
});
mcase({id: "EDIT-10", group: G, kind: "N", what: "scale ×1.5 quanh gốc: [chu vi, lối ngắn]", expect: [1.5*(400 + 100*PI), 1.5*(100 + 50*PI)],
       tol: 1e-9, source: "tay"}, () => {
  const doc = createDoc(), ids = stadium().map(s => doc.add(s));
  ids.forEach(id => doc.scale(id, 1.5, P(0, 0)));
  const ch = chain(ids.map(id => doc.get(id)));
  return [ch.total, alongPath(ch, P(75, 0), P(75, 150)).distance];
});
mcase({id: "EDIT-11", group: G, kind: "I", what: "sửa tay nút dẫn xuất → báo lỗi", expect: {throws: /dẫn xuất/},
       source: "CLAUDE.md §7"}, () => {
  const doc = createDoc(), R = doc.add(curve(RING, true)), S = doc.derive("offset", [R], {d: 6, side: "in"});
  doc.solve();
  doc.set(S, curve(RING, true));
});
mcase({id: "EDIT-12", group: G, kind: "N", what: "đường may (offset 6) theo đường cắt: [100², sau khi thành 200²]", expect: [352, 752],
       tol: 1e-9, source: "tay: 4·(cạnh − 12)"}, () => {
  const sq = k => curve([[0, 0], [k, 0], [k, k], [0, k]], true);
  const doc = createDoc(), R = doc.add(sq(100)), S = doc.derive("offset", [R], {d: 6, side: "in"});
  const a = length(doc.get(S));
  doc.set(R, sq(200));
  return [a, length(doc.get(S))];
});
