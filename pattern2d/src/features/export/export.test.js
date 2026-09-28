import {test, eq, deepEq} from "../../../tests/harness.js";
import {tsv, COLUMNS} from "./export.js";

const p = {blockName:"cradle_M", qty:"1", category:"power mesh", cutLen:694.4, sewLen:684.4,
           bbox:{x0:12.34, y0:-5.6, x1:222.94, y1:96.8, w:210.6, h:102.4}};
const MM_HEAD = "Piece\tQty\tMaterial\tWidth (mm)\tHeight (mm)\tCut (mm)\tSew (mm)\tX (mm)\tY (mm)";

test("the header is the factory's column order", () =>
  deepEq(COLUMNS, ["Piece","Qty","Material","Width","Height","Cut","Sew","X","Y"]));

/* Until 2026-09-23 the table was always mm with a bare header. TD's display-unit requirement
   (shared/units.md D2) makes it follow the chosen unit and name it in the header — these two
   tests say that now; the inch case is UNIT-37 of the Measure Engine table. */
test("a row reports size, lengths and position to 0.1 mm, and the header says mm", () => {
  const [head, row] = tsv([p], "mm").split("\n");
  eq(head, MM_HEAD);
  eq(row, ["cradle_M","1","power mesh","210.6","102.4","694.4","684.4","12.3","-5.6"].join("\t"));
});

test("an empty drawing still copies its header", () => eq(tsv([], "mm"), MM_HEAD));

test("a file that declared no unit copies drawing units, and says so", () =>
  eq(tsv([], null).split("\t")[3], "Width (đv?)"));
