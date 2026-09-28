/* Display unit — the pure part (spec: src/shared/units.md §2, group "Units" of the
   Measure Engine table).

   Expected values: the definitions 1 in = 25.4 mm and 1 cm = 10 mm, and the precision the
   spec fixes (mm 0.1 · cm 0.01 · in 0.001), worked by hand and checked once in Python.
   shared/units.js is new: it is imported dynamically so that, until it exists, each case
   fails on its own instead of taking the whole run down. */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {mcase} from "../../tests/engine.js";
const U = await import("./units.js").catch(e => { if(e.code === "ERR_MODULE_NOT_FOUND") return {}; throw e; });

const G = "Units";
const fl = (...a) => U.formatLength(...a), pl = (...a) => U.parseLength(...a);
const throws = fn => { try{ fn(); return false; }catch(e){ return true; } };
const appSrc = readFileSync(fileURLToPath(new URL("../app/app.js", import.meta.url)), "utf8");

mcase({id: "UNIT-20", group: G, kind: "N", what: "hiển thị: mặc định inch, công tắc inch · cm · mm, không nhớ sang lần mở sau",
       expect: ["inch", "inch,cm,mm", true, false], source: "requirement 1, 2; spec D3"}, () =>
  [U.DEFAULT_UNIT, (U.DISPLAY_UNITS || []).join(","), /unit:\s*DEFAULT_UNIT/.test(appSrc), /localStorage[^\n]*unit/i.test(appSrc)]);
mcase({id: "UNIT-21", group: G, kind: "N", what: "hiển thị: quy đổi 25.4 mm → in · 10 mm → cm · 7 mm → mm · 1 in → mm · 1 cm → mm",
       expect: [1, 1, 7, 25.4, 10], tol: 0, source: "định nghĩa 1 in = 25.4 mm, 1 cm = 10 mm"}, () =>
  [U.toUnit(25.4, "inch"), U.toUnit(10, "cm"), U.toUnit(7, "mm"), U.fromUnit(1, "inch"), U.fromUnit(1, "cm")]);
mcase({id: "UNIT-22", group: G, kind: "N", what: "hiển thị: 289.499 mm viết ra theo từng đơn vị",
       expect: ["11.398 in", "28.95 cm", "289.5 mm"], source: "tay: ÷25.4 → 0.001 · ÷10 → 0.01 · 0.1"}, () =>
  [fl(289.499, "inch"), fl(289.499, "cm"), fl(289.499, "mm")]);
mcase({id: "UNIT-23", group: G, kind: "B", what: "hiển thị: số rất nhỏ · không in −0 · số nhỏ thêm chữ số · phân nghìn · dạng trơn cho ô nhập",
       expect: ["0.0 mm", "0.000 in", "0.0 mm", "0.0051 in", "1,316.7 mm", "1316.7"], source: "spec U5"}, () =>
  [fl(0.004, "mm"), fl(0.004, "inch"), fl(-0.001, "mm"), fl(0.13, "inch", {d: 2}), fl(1316.743, "mm"),
   fl(1316.743, "mm", {label: false, plain: true})]);
mcase({id: "UNIT-24", group: G, kind: "B", what: "hiển thị: đổi đơn vị 100 lần không trôi; 3/8\" hiện lại đúng ở mm và in",
       expect: [6, "9.5", "0.375"], tol: 0, source: "spec U7"}, () => {
  const f = U.lengthField({mm: 6, d: 1});
  for(let i = 0; i < 100; i++) f.text(U.DISPLAY_UNITS[i % 3]);
  const g = U.lengthField({mm: 10, d: 1});
  g.read("3/8", "inch");
  return [f.mm, g.text("mm"), g.text("inch")];
});
mcase({id: "UNIT-25", group: G, kind: "N", what: "nhập số: 3/8 · 1 1/4 · 0,25 (in) · 0.25in, 1-1/2\" (đang mm) · 6mm, 2cm (đang in)",
       expect: [9.525, 31.75, 6.35, 6.35, 38.1, 6, 20], tol: 1e-9, source: "tay: × 25.4, × 10"}, () =>
  [pl("3/8", "inch"), pl("1 1/4", "inch"), pl("0,25", "inch"), pl("0.25in", "mm"), pl("1-1/2\"", "mm"),
   pl("6mm", "inch"), pl("2cm", "inch")]);
mcase({id: "UNIT-26", group: G, kind: "I", what: "nhập số: chữ \"abc\" → từ chối", expect: {throws: /không hợp lệ/},
       source: "spec U6"}, () => pl("abc", "inch"));
mcase({id: "UNIT-38", group: G, kind: "I", what: "nhập số: rỗng · 1/0 · --1 · 1.2.3 → đều từ chối", expect: [true, true, true, true],
       source: "spec U6"}, () => ["", "1/0", "--1", "1.2.3"].map(t => throws(() => pl(t, "mm"))));
mcase({id: "UNIT-27", group: G, kind: "I", what: "hiển thị: đơn vị lạ \"ft\" → từ chối, không rơi về mm", expect: {throws: /đơn vị/},
       source: "spec U3"}, () => fl(1, "ft"));
mcase({id: "UNIT-28", group: G, kind: "B", what: "file không khai đơn vị: [viết ra, đọc \"6\"] — không quy đổi", expect: ["123.4 đv?", 6],
       tol: 0, source: "spec U9"}, () => [fl(123.4, null), pl("6", null)]);
mcase({id: "UNIT-39", group: G, kind: "I", what: "file không khai đơn vị + gõ \"6mm\" → từ chối (không biết đổi sang đơn vị bản vẽ)",
       expect: {throws: /chưa khai/}, source: "spec U9"}, () => pl("6mm", null));
mcase({id: "UNIT-29", group: G, kind: "N", what: "thước tỉ lệ ở 2.43 px/mm: in · cm · mm; và 1/8 in ở 20 px/mm",
       expect: ["1 in", "5 cm", "50 mm", "1/8 in"], source: "tay: mốc tròn đầu tiên dài quá 60 px"}, () =>
  [U.niceScale(2.43, "inch").label, U.niceScale(2.43, "cm").label, U.niceScale(2.43, "mm").label, U.niceScale(20, "inch").label]);
mcase({id: "UNIT-40", group: G, kind: "N", what: "tỉ lệ phóng ở 2.43 px/mm viết theo đơn vị: in · cm · mm · file không khai",
       expect: ["61.72 px/in", "24.30 px/cm", "2.43 px/mm", "2.43 px/đv?"], source: "tay: 2.43 × 25.4 = 61.722"}, () =>
  [U.pxPer(2.43, "inch"), U.pxPer(2.43, "cm"), U.pxPer(2.43, "mm"), U.pxPer(2.43, null)]);
