/* Snap in drawing units — the kernel (spec: src/shared/units.md §3, TD 2026-09-23).

   TD's own examples, run on real DXF files of the suite: units_english.dxf (a 4" × 2" piece,
   Units: ENGLISH) and units_metric.dxf (100 × 50 mm, Units: METRIC). The snap targets are
   built HERE from the piece data — every POINT and vertex, every path — not borrowed from the
   tool, so the kernel is checked against a list the test made itself. Expected values are
   TD's numbers and hand geometry (the foot of a perpendicular on a horizontal edge). */
import {mcase} from "../../../tests/engine.js";
import {modelOf, pieceOf} from "../../../tests/engine_fixtures.js";
const S = await import("./snap.js").catch(e => { if(e.code === "ERR_MODULE_NOT_FOUND") return {}; throw e; });
const U = await import("../../shared/units.js").catch(e => { if(e.code === "ERR_MODULE_NOT_FOUND") return {}; throw e; });
const snapTo = (...a) => S.snapTo(...a);

const G = "Units", IN = 25.4;
function targets(file){
  const m = modelOf(file), p = pieceOf(m, "R");
  return {m, t: {points: p.points.map(q => [q.x, q.y]).concat(p.paths.flatMap(q => q.snap || q.pts)),
                 shapes: p.paths.flatMap(q => q.shapes)}};
}
const tolOf = m => U.snapDefault(m.units.unit);
const at = (file, x, y) => { const {m, t} = targets(file), r = snapTo([x, y], t, tolOf(m)); return [r.kind, r.point[0], r.point[1]]; };

mcase({id: "UNIT-41", group: G, kind: "N", what: "snap: dung sai mặc định theo đơn vị file — [file inch (in), file mm (mm), file inch (mm)]",
       expect: [0.02, 0.5, 0.508], tol: 1e-12, source: "TD 2026-09-23: 0.02 in · 0.5 mm"}, () =>
  [U.toUnit(tolOf(targets("units_english.dxf").m), "inch"), tolOf(targets("units_metric.dxf").m), tolOf(targets("units_english.dxf").m)]);
mcase({id: "UNIT-42", group: G, kind: "N", what: "snap file inch: A cách đường B 0.01 in → hít vào B (chân đường vuông góc)",
       expect: ["line", 2.5*IN, 0], tol: 1e-9, source: "ví dụ của TD"}, () => at("units_english.dxf", 2.5*IN, -0.01*IN));
mcase({id: "UNIT-43", group: G, kind: "N", what: "snap file inch: cách 0.05 in → không hít, giữ đúng chỗ bấm",
       expect: ["free", 2.5*IN, -0.05*IN], tol: 1e-9, source: "ví dụ của TD"}, () => at("units_english.dxf", 2.5*IN, -0.05*IN));
mcase({id: "UNIT-44", group: G, kind: "N", what: "snap file mm: cách 0.3 mm → hít; cách 1 mm → không — [kiểu, y] × 2",
       expect: ["line", 0, "free", -1], tol: 1e-9, source: "ví dụ của TD"}, () => {
  const a = at("units_metric.dxf", 60, -0.3), b = at("units_metric.dxf", 60, -1);
  return [a[0], a[2], b[0], b[2]];
});
mcase({id: "UNIT-45", group: G, kind: "B", what: "snap biên: đúng 0.02 in / 0.5 mm → hít; 0.0201 in / 0.5001 mm → không",
       expect: ["line", "free", "line", "free"], source: "spec S2: ≤ dung sai"}, () =>
  [at("units_english.dxf", 2.5*IN, -0.02*IN)[0], at("units_english.dxf", 2.5*IN, -0.0201*IN)[0],
   at("units_metric.dxf", 60, -0.5)[0], at("units_metric.dxf", 60, -0.5001)[0]]);
mcase({id: "UNIT-47", group: G, kind: "B", what: "snap: điểm (notch) thắng đường khi cả hai trong dung sai",
       expect: ["point", 1, 0], tol: 1e-12, source: "spec S4; tay: notch cách 0.283 mm, đường cách 0.2 mm"}, () =>
  at("units_metric.dxf", 1.2, -0.2));
mcase({id: "UNIT-50", group: G, kind: "I", what: "snap file không khai đơn vị: không có dung sai → không hít — [dung sai, kiểu]",
       expect: [null, "free"], source: "spec S7: không tự đoán"}, () => {
  const {m, t} = targets("units_none.dxf");
  return [tolOf(m), snapTo([2, -0.3], t, tolOf(m)).kind];
});
mcase({id: "UNIT-54", group: G, kind: "I", what: "snap: dung sai âm / NaN → báo lỗi, không đoán", expect: {throws: /không hợp lệ/},
       source: "spec A7"}, () => snapTo([0, 0], {points: [[0, 0]]}, -1));
