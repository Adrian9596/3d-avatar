/* Measure Engine · Units (spec: src/features/measure/measure_engine.md §4 A5–A6, §5).

   Expected values: the definition 1" = 25.4 mm, and the unit each file DECLARES — the AAMA
   `Units:` text TD's factories write. A file that declares nothing must come out as
   "unknown", never as a guess; the header variables ($INSUNITS, $MEASUREMENT) are kept as
   hints only — writers fill them with defaults (ezdxf puts $INSUNITS=6 in every file it
   makes, these fixtures included), spec A5. */
import {mcase} from "../../../tests/engine.js";
import {expected, dxfOf, modelOf, pieceOf, ALL_ON} from "../../../tests/engine_fixtures.js";
import {buildModel} from "./model.js";
import {point} from "../geometry/model.js";
import {straight} from "../geometry/straight.js";
import * as Measure from "../measure/measure.js";
/* units.js is new: until it exists these cases fail one by one instead of the whole run */
const U = await import("./units.js").catch(e => { if(e.code === "ERR_MODULE_NOT_FOUND") return {}; throw e; });
const toMM = (...a) => U.toMM(...a), fromMM = (...a) => U.fromMM(...a);
const trackAt = (...a) => Measure.trackAt(...a);

const G = "Units", E = expected.units, LIB = expected.lib;
const unitOf = m => (m.units || {}).unit;
const ringOf = (m, block, at) => trackAt([pieceOf(m, block)], ALL_ON, at).chain;

mcase({id: "UNIT-01", group: G, kind: "N", what: "1 inch → mm", expect: 25.4, tol: 0,
       source: "định nghĩa 1959: 1\" = 25.4 mm đúng tuyệt đối"}, () => toMM(1, "inch"));
mcase({id: "UNIT-02", group: G, kind: "N", what: "304.8 mm → inch", expect: 12, tol: 1e-12,
       source: "định nghĩa"}, () => fromMM(304.8, "inch"));
mcase({id: "UNIT-03", group: G, kind: "N", what: "mm → mm giữ nguyên", expect: 123.45, tol: 0,
       source: "định nghĩa"}, () => toMM(123.45, "mm"));
mcase({id: "UNIT-04", group: G, kind: "B", what: "khứ hồi mm → inch → mm, 1000 giá trị: sai số tương đối lớn nhất", expect: 0, tol: 1e-15,
       source: "định nghĩa"}, () => {
  let worst = 0;
  for(let i = 1; i <= 1000; i++){ const v = i*4.999 + 0.001; worst = Math.max(worst, Math.abs(fromMM(toMM(v, "inch"), "inch") - v)/v); }
  return worst;
});
mcase({id: "UNIT-05", group: G, kind: "I", what: "đơn vị lạ (\"cubit\") → báo lỗi, không đoán", expect: {throws: /đơn vị/},
       source: "rule: không tự đoán"}, () => toMM(1, "cubit"));
mcase({id: "UNIT-18", group: G, kind: "I", what: "không có đơn vị (undefined) → báo lỗi", expect: {throws: /đơn vị/},
       source: "rule: không tự đoán"}, () => toMM(1, undefined));

mcase({id: "UNIT-06", group: G, kind: "N", what: "Units: METRIC → [đơn vị, chu vi]", expect: ["mm", E.metric_perimeter], tol: 1e-9,
       source: "khai báo AAMA trong file"}, () => { const m = modelOf("units_metric.dxf"); return [unitOf(m), ringOf(m, "R", [50, 0]).total]; });
mcase({id: "UNIT-07", group: G, kind: "N", what: "Units: ENGLISH (hình 4\"×2\") → [đơn vị, chu vi mm, rộng mm]",
       expect: ["inch", E.english_perimeter_mm, E.english_bbox_w_mm], tol: 1e-9, source: "khai báo AAMA × 25.4"}, () => {
  const m = modelOf("units_english.dxf"), p = pieceOf(m, "R");
  return [unitOf(m), ringOf(m, "R", [50, 0]).total, p.bbox.w];
});
mcase({id: "UNIT-08", group: G, kind: "N", what: "ENGLISH: [Straight chéo góc, notch x, notch y] theo mm",
       expect: [E.english_diag_mm, ...E.english_notch_mm], tol: 1e-9, source: "√20\" × 25.4; notch 1\" × 25.4"}, () => {
  const p = pieceOf(modelOf("units_english.dxf"), "R"), cut = p.paths.find(q => q.layer === "1");
  const n = p.points.find(q => q.layer === "4");
  return [straight(point(...cut.pts[0]), point(...cut.pts[2])).distance, n.x, n.y];
});
mcase({id: "UNIT-09", group: G, kind: "B", what: "\"UNITS: METRIC\" viết hoa (kiểu 2827, BiancaBra) → mm", expect: "mm",
       source: "khai báo AAMA"}, () => unitOf(modelOf("units_upper.dxf")));
mcase({id: "UNIT-10", group: G, kind: "B", what: "không khai đơn vị → [đơn vị, chu vi thô]", expect: [null, E.raw_perimeter], tol: 1e-9,
       source: "rule: không tự đoán"}, () => { const m = modelOf("units_none.dxf"); return [unitOf(m), ringOf(m, "R", [2, 0]).total]; });
mcase({id: "UNIT-19", group: G, kind: "B", what: "không khai đơn vị → có cảnh báo cho TD", expect: true,
       source: "rule: không tự đoán"}, () => /không khai/.test(modelOf("units_none.dxf").units.warning || ""));
mcase({id: "UNIT-11", group: G, kind: "B", what: "chỉ có $INSUNITS=6 (mét — mặc định ezdxf ghi) → [đơn vị, gợi ý]", expect: [null, 6],
       source: "spec A5: $INSUNITS không áp"}, () => { const m = modelOf("units_insunits6.dxf"); return [unitOf(m), m.units.hints.$INSUNITS]; });
mcase({id: "UNIT-12", group: G, kind: "B", what: "METRIC mâu thuẫn $INSUNITS=1 → [theo AAMA, có ghi mâu thuẫn]", expect: ["mm", true],
       source: "spec A6"}, () => { const m = modelOf("units_conflict.dxf"); return [unitOf(m), /\$INSUNITS/.test(m.units.conflict || "")]; });
mcase({id: "UNIT-13", group: G, kind: "I", what: "Units: FURLONG → không nhận, không đoán", expect: null,
       source: "rule: không tự đoán"}, () => unitOf(modelOf("units_bogus.dxf")));
mcase({id: "UNIT-14", group: G, kind: "N", what: "file không khai, TD chọn tay inch → [đơn vị, chu vi mm, nguồn]",
       expect: ["inch", E.english_perimeter_mm, "chọn tay"], tol: 1e-9, source: "khai báo của TD"}, () => {
  const m = buildModel(dxfOf("units_none.dxf"), {unit: "inch"});
  return [unitOf(m), ringOf(m, "R", [50, 0]).total, m.units.source];
});
mcase({id: "UNIT-15", group: G, kind: "N", what: "file thật DM1195 (ENGLISH): [đơn vị, chu vi wing mm]", expect: () => ["inch", LIB.DM1195.perimeter_mm],
       tol: 1e-6, source: "ezdxf × 25.4"}, () => {
  const m = modelOf("lib:DM1195--STRIKE COST-VER C.dxf"), p = pieceOf(m, LIB.DM1195.block);
  const ring = p.paths.filter(q => q.layer === "1" && q.closed).sort((a, b) => b.pts.length - a.pts.length)[0];
  return [unitOf(m), trackAt([p], ALL_ON, ring.pts[0]).chain.total];
});
/* UNIT-16 first expected a $INSUNITS conflict here; the file has no header variable at all —
   the 6 came from ezdxf filling in its default (CLAUDE.md §12, 2026-09-23) */
mcase({id: "UNIT-16", group: G, kind: "B", what: "file thật 2875 LiftyChic: ENGLISH, không có biến header → [đơn vị, không ghi mâu thuẫn]",
       expect: ["inch", false], source: "byte thô của file: không có $INSUNITS"}, () => {
  const m = modelOf("lib:2875_ LiftyChic_Crossian.dxf");
  return [unitOf(m), !!m.units.conflict || Object.keys(expected.lib.LIFTY.header_vars).length > 0];
});
mcase({id: "UNIT-17", group: G, kind: "B", what: "file thật 2938常规L: không khai AAMA → [đơn vị, $INSUNITS, $MEASUREMENT]",
       expect: () => [null, LIB.S2938.insunits, LIB.S2938.measurement], source: "spec A5"}, () => {
  const m = modelOf("lib:2938常规L.dxf");
  return [unitOf(m), m.units.hints.$INSUNITS, m.units.hints.$MEASUREMENT];
});
