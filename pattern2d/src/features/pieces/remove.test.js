/* Deleting a piece of the open file, for good (spec: pieces/remove.md) — and putting it back with ⌘Z.

   The expected file is built without the code under test: the DXF text itself, with the piece's BLOCK and its INSERT
   cut out by hand, read by the viewer and written again. Deleting the piece from the model must write exactly that. */
import {test, eq, ok, deepEq} from "../../../tests/harness.js";
import {hasData, missing, block36Text, BLOCK_36C} from "../../../tests/data.js";
import {parseDXF} from "../dxf/parse.js";
import {buildModel} from "../dxf/model.js";
import {writeDXF} from "../dxf/write.js";
import {countEntities} from "../layers/layers.js";
import {removePieces, restorePieces, removedText} from "./remove.js";

const DATE = new Date(2026, 8, 24, 10, 0);
const out = m => writeDXF(m, {source: "BLOCK_36C.dxf", date: DATE}).text;
const BLOCK36 = hasData ? block36Text() : missing(BLOCK_36C);
const model36 = () => buildModel(parseDXF(BLOCK36));

/* the DXF text with one BLOCK (by name) and every INSERT of it cut out — by walking the group-code pairs, not by the model */
function withoutBlock(text, name){
  const lines = text.split(/\r?\n/), pairs = [];
  for(let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i], lines[i + 1]]);
  const keep = [];
  for(let k = 0; k < pairs.length; k++){
    const [c, v] = pairs[k];
    if(c.trim() === "0" && (v.trim() === "BLOCK" || v.trim() === "INSERT")){
      let j = k + 1, nm = null;
      while(j < pairs.length && pairs[j][0].trim() !== "0"){ if(pairs[j][0].trim() === "2") nm = pairs[j][1].trim(); j++; }
      if(nm === name){
        if(v.trim() === "BLOCK"){ while(!(pairs[j][0].trim() === "0" && pairs[j][1].trim() === "ENDBLK")) j++; j++;
                                   while(j < pairs.length && pairs[j][0].trim() !== "0") j++; }
        k = j - 1; continue;
      }
    }
    keep.push(c, v);
  }
  return keep.join("\n") + "\n";
}

test("R1 R2 a piece deleted is gone from the model and from the file — the other blocks exactly as the DXF without it", () => {
  const m = model36(), names = m.pieces.map(p => p.blockName), k = names.indexOf("wing_M");
  ok(k >= 0, "BLOCK_36C có wing_M");
  const others = m.pieces.filter((p, i) => i !== k);
  const rec = removePieces(m, [k]);
  eq(m.pieces.length, names.length - 1, "một mảnh ít hơn");
  ok(others.every((p, i) => m.pieces[i] === p), "mảnh còn lại: chính các object đó, đúng thứ tự");
  ok(!m.pieces.some(p => p.blockName === "wing_M"), "wing_M không còn");
  eq(out(m), out(buildModel(parseDXF(withoutBlock(BLOCK36, "wing_M")))), "file xuất = chính file DXF bỏ block wing_M bằng tay");
  deepEq(rec.removed.map(r => r.index), [k]);
});

test("R3 ⌘Z puts it back where it was in the list — the file written again is the one before the delete", () => {
  const m = model36(), before = out(m), list = m.pieces.slice();
  const rec = removePieces(m, [3, 1, 3, 99, -1]);                // unsorted, twice, out of range: pieces 1 and 3 go
  eq(m.pieces.length, list.length - 2);
  deepEq(rec.removed.map(r => r.index), [1, 3], "xoá mảnh 1 và 3, một lần mỗi mảnh; chỉ số hỏng bỏ qua");
  restorePieces(m, rec);
  ok(m.pieces.length === list.length && list.every((p, i) => m.pieces[i] === p), "đúng các object, đúng chỗ cũ");
  eq(out(m), before, "file xuất như trước khi xoá");
});

test("R3 two deletes undone in turn — the second one first", () => {
  const m = model36(), list = m.pieces.slice();
  const a = removePieces(m, [0]), b = removePieces(m, [2]);       // the second delete counts in the list AFTER the first
  eq(b.removed[0].piece, list[3], "chỉ số 2 của danh sách mới là mảnh 3 cũ");
  restorePieces(m, b); restorePieces(m, a);
  ok(list.every((p, i) => m.pieces[i] === p), "về đủ và đúng thứ tự");
});

/* a drawing without blocks: its modelspace IS the piece, and write.js writes it as loose entities (2938常规L) */
const LOOSE = ["0", "SECTION", "2", "ENTITIES",
  "0", "LINE", "8", "1", "10", "0", "20", "0", "11", "100", "21", "0",
  "0", "LINE", "8", "1", "10", "100", "20", "0", "11", "100", "21", "50",
  "0", "POINT", "8", "4", "10", "50", "20", "0",
  "0", "TEXT", "8", "1", "10", "0", "20", "-20", "40", "5", "1", "Units: METRIC",
  "0", "ENDSEC", "0", "EOF"].join("\n");
test("R6 the one piece of a drawing without blocks: deleted, the file keeps only its header lines; ⌘Z brings it back", () => {
  const m = buildModel(parseDXF(LOOSE)), before = out(m);
  eq(m.pieces.length, 1, "cả bản vẽ là một mảnh");
  const rec = removePieces(m, [0]);
  const text = out(m);
  ok(!/\nLINE\n/.test(text) && !/\nPOINT\n/.test(text), "không còn LINE, POINT nào");
  ok(/Units: METRIC/.test(text), "dòng header còn");
  restorePieces(m, rec);
  eq(out(m), before, "⌘Z: như trước");
});

test("R7 what the delete says, and the layer counts of what is left", () => {
  const m = model36(), k = m.pieces.findIndex(p => p.blockName === "wing_M");
  const rec = removePieces(m, [k]);
  ok(/đã xoá 1 mảnh: wing_M/.test(removedText(rec)) && /⌘Z/.test(removedText(rec)), removedText(rec));
  deepEq(countEntities(m), countEntities(buildModel(parseDXF(withoutBlock(BLOCK36, "wing_M")))), "đếm layer = của file bỏ block bằng tay");
  eq(removedText({removed: []}), "không có mảnh nào để xoá");
});
