/* Snap in drawing units — the tools that snap (spec: src/shared/units.md §3 S3–S6).

   Measure (a click snaps to a point or a line), Arrange (a dragged piece's edges snap to
   another piece's), Geom (a dragged vertex snaps to the piece's other objects) — all with the
   drawing's tolerance, none with pixels. Expected values: TD's 0.5 mm / 0.02 in and hand
   geometry on plain rectangles. */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {mcase} from "../../../tests/engine.js";
import {modelOf, pieceOf, ALL_ON} from "../../../tests/engine_fixtures.js";
import {point} from "../geometry/model.js";
import {straight} from "../geometry/straight.js";
import {snapOffset} from "../arrange/ops.js";
import * as Measure from "./measure.js";
import * as GeometryM from "../geometry/geometry.js";
const U = await import("../../shared/units.js").catch(e => { if(e.code === "ERR_MODULE_NOT_FOUND") return {}; throw e; });
const S = await import("../geometry/snap.js").catch(e => { if(e.code === "ERR_MODULE_NOT_FOUND") return {}; throw e; });

const G = "Units";
const src = f => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), "utf8");
const box = (x0, y0, w, h) => ({x0, y0, x1: x0 + w, y1: y0 + h, w, h});

mcase({id: "UNIT-46", group: G, kind: "N", what: "snap: dung sai không đổi theo công tắc in·cm·mm — [mm, viết ở in, cm, mm, mm sau khi đổi]",
       expect: [0.508, "0.0200", "0.051", "0.51", 0.508], tol: 1e-12, source: "spec S3, S6; tay: 0.508 ÷ 25.4, ÷ 10"}, () => {
  const f = U.lengthField({...U.SNAP_FIELD, mm: U.snapDefault("inch")});
  return [f.mm, f.text("inch"), f.text("cm"), f.text("mm"), f.mm];
});
mcase({id: "UNIT-48", group: G, kind: "N", what: "Arrange: cạnh cách 0.3 mm → hít; 1 mm → không; file không khai → không — [dx] × 3",
       expect: [0.3, 0, 0], tol: 1e-9, source: "spec S5; tay"}, () => {
  const u0 = box(0, 0, 100, 50), tol = U.snapDefault("mm");
  return [snapOffset(u0, 0, 0, [box(100.3, 0, 60, 50)], tol).dx, snapOffset(u0, 0, 0, [box(101, 0, 60, 50)], tol).dx,
          snapOffset(u0, 0, 0, [box(100.3, 0, 60, 50)], null).dx];
});
mcase({id: "UNIT-49", group: G, kind: "B", what: "snap không còn tính bằng px: [Measure không hỏi px, Arrange không hỏi px, Geom kéo đỉnh dùng dung sai bản vẽ]",
       expect: [true, true, true], source: "spec S5; quét mã nguồn"}, () =>
  [!/pxPerMM/.test(src("measure/measure.js")), !/pxPerMM\(\)\)/.test(src("arrange/arrange.js").split("function onMove")[1].split("function onUp")[0]),
   /snapTol\(\)/.test(src("geometry/geometry.js").split("function onMove")[1].split("\n}")[0])]);
mcase({id: "UNIT-51", group: G, kind: "I", what: "ô Snap: gõ \"-1\", \"abc\" → từ chối; gõ 0.03 in → nhận — [ok, ok, mm, ok, mm]",
       expect: [false, false, 0.5, true, 0.762], tol: 1e-9, source: "spec S6, U6"}, () => {
  const f = U.lengthField({...U.SNAP_FIELD, mm: 0.5});
  const a = f.read("-1", "mm").ok, b = f.read("abc", "inch").ok, keep = f.mm, c = f.read("0.03", "inch").ok;
  return [a, b, keep, c, f.mm];
});
mcase({id: "UNIT-52", group: G, kind: "N", what: "Geom kéo đỉnh: hít notch · hít grainline · tự do · không hít chính đường cắt đang kéo",
       expect: ["point", 30, 0, "line", 50, 25, "free", 70, 20, "free", 80, 0.2], tol: 1e-9, source: "spec S5; tay"}, () => {
  const p = {paths: [{layer: "1", closed: true, pts: [[0, 0], [100, 0], [100, 50], [0, 50]]},
                     {layer: "7", closed: false, pts: [[50, 10], [50, 40]]}],
             points: [{layer: "4", x: 30, y: 0}]};
  const t = GeometryM.dragTargets(p, ALL_ON), tol = U.snapDefault("mm");
  return [[30.2, 0.3], [50.3, 25], [70, 20], [80, 0.2]].flatMap(w => { const r = S.snapTo(w, t, tol); return [r.kind, ...r.point]; });
});
mcase({id: "UNIT-53", group: G, kind: "N", what: "Measure Straight: A hít đường, B hít đỉnh (file mm) — [khoảng cách, Điểm A, Điểm B]",
       expect: [Math.hypot(40, 50), "bắt đường", "bắt điểm"], tol: 1e-9, source: "tay: (60,0) → (100,50)"}, () => {
  const m = modelOf("units_metric.dxf"), p = pieceOf(m, "R"), tol = U.snapDefault(m.units.unit);
  const a = Measure.snapAt([p], ALL_ON, [60, -0.3], tol), b = Measure.snapAt([p], ALL_ON, [99.8, 50.1], tol);
  const r = Measure.straightReadout(straight(point(...a.point), point(...b.point)), [a.kind, b.kind], U.lengthFormatter("mm"));
  return [straight(point(...a.point), point(...b.point)).distance, r.rows[3][1], r.rows[4][1]];
});
