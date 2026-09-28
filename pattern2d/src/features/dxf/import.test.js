import {test, eq, ok} from "../../../tests/harness.js";
import {unitBadge} from "./import.js";

/* The badge beside the file name: the unit the FILE declared, and why (measure_engine.md A5).
   Until 2026-09-23 it read "mm" / "inch → mm"; with the in · cm · mm display switch
   (shared/units.md §1) "→ mm" read as "shown in mm", so it now names the file's unit only. */
test("unitBadge: mm khai bằng AAMA thì im lặng", () => {
  const b = unitBadge({unit: "mm", source: "AAMA", declared: "METRIC", hints: {}, warning: null, conflict: null});
  eq(b.text, "file: mm"); eq(b.warn, false); ok(/METRIC/.test(b.title));
});

test("unitBadge: file inch nói rõ là file inch", () =>
  eq(unitBadge({unit: "inch", source: "AAMA", declared: "ENGLISH", hints: {}}).text, "file: inch"));

test("unitBadge: đơn vị file chọn tay thì nói là chọn tay", () =>
  eq(unitBadge({unit: "mm", source: "chọn tay", hints: {}}).text, "file: mm (chọn tay)"));

test("unitBadge: file không khai đơn vị thì báo động, không giả làm mm", () => {
  const b = unitBadge({unit: null, source: null, hints: {}, warning: "file không khai đơn vị"});
  eq(b.text, "⚠ file: chưa khai đơn vị"); eq(b.warn, true); ok(/không khai/.test(b.title));
});

test("unitBadge: có cảnh báo import thì đếm và liệt kê", () => {
  const b = unitBadge({unit: "mm", source: "AAMA", declared: "METRIC", hints: {}}, ["SPLINE bị bỏ — fit point"]);
  ok(b.text.includes("1 cảnh báo")); ok(b.title.includes("SPLINE bị bỏ")); eq(b.warn, true);
});
