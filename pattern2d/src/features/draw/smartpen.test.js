/* Bút through the REAL Vẽ controller and dock (spec: draw/smartpen.md B1–B15). A piece built by hand (tests/edit_fixtures.js
   rectPiece: a 100 × 60 cut ring, its seam 6 mm inside, a notch at (30, 0), a grade point at (20, 30), a grainline inside —
   plus a curve point (layer 3) at (70, 0)), so every number is known from the construction and no pattern data is read.
   The fixture's pick radius is 1 mm, its snap 0.5 mm; pointer positions are in mm. */
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {withController} from "../../../tests/controller_fixture.js";
import {rectPiece, poly} from "../../../tests/edit_fixtures.js";
import {summarize} from "../dxf/model.js";
import {parseDXF} from "../dxf/parse.js";
import {buildModel} from "../dxf/model.js";
import {closestPoint, point} from "../geometry/model.js";
import {entityShape} from "../geometry/entity.js";

const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const nearPt = (a, b, tol, msg) => ok(hyp(a, b) <= tol, `${msg}: [${a}] cách [${b}] ${hyp(a, b)} > ${tol}`);
const rect = () => { const p = rectPiece({grain: "inside"}); p.points.push({layer: "3", x: 70, y: 0}); return p; };
const second = () => summarize({name: "S", blockName: "S", qty: "1", category: "", texts: [],
  paths: [poly("1", [[200, 0], [300, 0], [300, 60], [200, 60]], true)], points: []});
const model = (...pieces) => ({pieces, loose: {paths: [], points: [], texts: []}, header: {}, blocks: {}, warnings: [],
  units: {unit: "mm", scale: 1, source: "AAMA", declared: "METRIC"}});
const one = () => ({model: model(rect())});
const row = (f, label) => (f.rows().find(r => r[0] === label) || [])[1];
const shapes = f => f.tool.shapes(f.ctx);
const pen = f => { f.mode("pen"); };
const setLayer = (f, v) => { const e = f.field("dlayer"); e.value = v; e.emit("change"); };

test("B1 the Bút mode: its button, key 8 inside Vẽ, Esc drops the line half drawn and goes back to Chọn", () => withController("draw", f => {
  pen(f); eq(row(f, "Chế độ"), "Bút");
  f.mode("select"); f.key("8"); eq(row(f, "Chế độ"), "Bút", "phím 8");
  f.pointer([10, 20]); f.pointer([40, 20]);
  f.key("Escape");
  eq(shapes(f).length, 0, "Esc: không tạo gì"); eq(row(f, "Chế độ"), "Chọn");
}, one()));

test("B2 · B3 click, click, Enter: a Line exactly at the presses, in the piece pressed in, one undo step, selected", () => withController("draw", f => {
  pen(f); f.pointer([10, 20]); f.pointer([40, 20]);
  eq(shapes(f).length, 0, "đặt điểm chưa đổi bản vẽ"); eq(f.tool.undoCount(), 0);
  f.key("Enter");
  const s = shapes(f);
  eq(s.length, 1); eq(s[0].entity.type, "line"); deepEq(s[0].entity.a, [10, 20]); deepEq(s[0].entity.b, [40, 20]);
  eq(s[0].pi, 0, "vào mảnh của cú bấm đầu"); eq(s[0].layer, "8");
  eq(f.tool.undoCount(), 1, "một bước ⌘Z");
}, one()));

test("B2 · B3 ⇧ press is a curve point, a double-click finishes: a Đường through the points placed", () => withController("draw", f => {
  pen(f);
  f.press([10, 10]); f.release();
  f.press([30, 25], {shiftKey: true}); f.release();
  f.press([60, 15], {timeStamp: 50000}); f.release();
  eq(shapes(f).length, 0);
  f.press([60, 15], {timeStamp: 50200}); f.release();
  const s = shapes(f);
  eq(s.length, 1, "double-click: xong"); eq(s[0].entity.type, "polyline");
  deepEq(s[0].entity.pts, [[10, 10], [30, 25], [60, 15]], "không điểm trùng ở cú thứ hai");
  deepEq(s[0].entity.kinds, ["turn", "curve", "turn"]);
}, one()));

test("B2 Backspace drops the last point; a press on the point just placed is refused", () => withController("draw", f => {
  pen(f); f.pointer([10, 10]); f.pointer([20, 10]); f.pointer([30, 10]);
  f.key("Backspace"); eq(row(f, "Đang vẽ"), "2 điểm · 0 cong");
  f.pointer([20, 10]);
  eq(row(f, "Đang vẽ"), "2 điểm · 0 cong", "điểm trùng điểm vừa đặt: không đặt");
}, one()));

test("B4 a press on the first point closes: on layer 1 a new piece, on layer 8 a closed line of the piece pressed in", () => withController("draw", f => {
  pen(f); setLayer(f, "1");
  for(const w of [[110, 10], [150, 10], [150, 40]]) f.pointer(w);
  f.pointer([110.3, 10.2]);
  eq(f.tool.pieces().length, 1, "mảnh mới");
  const outline = shapes(f).find(s => s.role === "outline");
  eq(outline.entity.type, "path"); deepEq(outline.entity.pts, [[110, 10], [150, 10], [150, 40]]);
  ok(shapes(f).some(s => s.role === "grain"), "có canh sợi");
  setLayer(f, "8");
  for(const w of [[10, 10], [40, 10], [40, 40]]) f.pointer(w);
  f.pointer([10.2, 10.1]);
  const ring = shapes(f).find(s => s.entity.type === "path" && !s.role);
  ok(ring, "đường kín"); eq(ring.pi, 0); eq(ring.layer, "8");
  eq(f.tool.undoCount(), 2);
}, one()));

test("B5 Length + Angle + Enter: the next point exactly that far that way", () => withController("draw", f => {
  pen(f); f.pointer([10, 10]);
  f.input("dlen", 30); f.input("dang", 90); f.enter("dlen");
  f.key("Enter");
  const s = shapes(f);
  eq(s.length, 1); deepEq(s[0].entity.a, [10, 10]); deepEq(s[0].entity.b, [10, 40]);
}, one()));

test("B6 a drag on an edge: the parallel of that edge, on the pointer's side, as far as the pointer — or Cách", () => withController("draw", f => {
  pen(f);
  f.drag([70.4, 0.3], [70, 10]);
  let s = shapes(f);
  eq(s.length, 1, "kéo trên cạnh đáy — POINT layer 3 ở (70, 0) không phải điểm để kéo");
  eq(s[0].entity.type, "line"); nearPt(s[0].entity.a, [0, 10], 1e-12, "đầu"); nearPt(s[0].entity.b, [100, 10], 1e-12, "cuối");
  eq(s[0].pi, 0, "vào mảnh của cạnh gốc"); eq(s[0].layer, "8");
  f.input("pdist", 6);
  f.drag([40, 59.7], [40, 75]);
  s = shapes(f);
  eq(s.length, 2); nearPt(s[1].entity.a, [100, 66], 1e-12, "cạnh trên, phía ngoài, cách 6"); nearPt(s[1].entity.b, [0, 66], 1e-12);
  eq(f.tool.undoCount(), 2, "mỗi song song một bước");
}, one()));

test("B6 refused, nothing drawn: the pointer brought back onto the edge", () => withController("draw", f => {
  pen(f);
  f.drag([70.4, 0.3], [85, 0]);
  eq(shapes(f).length, 0); eq(f.tool.undoCount(), 0);
  ok(f.rows().some(r => /cách 0|nằm trên/.test(String(r[1]))), "câu báo nói vì sao");
}, one()));

test("B8 compass from the notch to the right side: R from the drag, or Compa; a release elsewhere draws a Line", () => withController("draw", f => {
  pen(f);
  f.drag([30.3, 0.4], [100, 30]);
  let s = shapes(f);
  eq(s.length, 1); eq(s[0].entity.type, "line");
  deepEq(s[0].entity.a, [30, 0], "từ đúng notch"); nearPt(s[0].entity.b, [100, 30], 1e-9, "R = √5800: (100, 30)");
  f.input("prad", 74);
  f.drag([30.3, 0.4], [100, 31]);
  s = shapes(f);
  nearPt(s[1].entity.b, [100, 24], 1e-9, "Compa 74: 70² + 24² = 74²");
  f.input("prad", 10);
  f.drag([30.3, 0.4], [60, 40]);
  s = shapes(f);
  nearPt(s[2].entity.b, [36, 8], 1e-12, "thả chỗ trống: Line dài đúng 10 theo hướng (30, 40)");
  f.input("prad", "");
  f.drag([30.3, 0.4], [60, 40]);
  deepEq(shapes(f)[3].entity.b, [60, 40], "Compa trống: tới đúng chỗ thả");
}, one()));

test("B8 · V4 a compass onto a line of another piece is refused — each piece its own zone", () => withController("draw", f => {
  pen(f);
  f.drag([30.3, 0.4], [200, 30]);
  eq(shapes(f).length, 0, "không vẽ");
  ok(f.rows().some(r => /mảnh khác/.test(String(r[1]))), "câu báo: thuộc mảnh khác");
}, {model: model(rect(), second())}));

test("B9 ⇧ drag A → B is the set square: the next points go along or across AB, for that line only", () => withController("draw", f => {
  pen(f);
  f.press([0, 70], {shiftKey: true}); f.move([30, 110]); f.release();
  eq(row(f, "Hướng"), "thước tam giác");
  eq(shapes(f).length, 0, "đặt thước không vẽ gì"); eq(f.tool.undoCount(), 0);
  f.pointer([150, 10]); f.pointer([142.2, 16.3]);
  f.key("Enter");
  /* the pointer moved (−7.8, 6.3): onto ⊥AB = (−0.8, 0.6) that is 6.24 + 3.78 = 10.02 — the nearest of the four ways */
  nearPt(shapes(f)[0].entity.b, [150 - 0.8*10.02, 10 + 0.6*10.02], 1e-9, "⊥ AB, hình chiếu 10.02");
  eq(row(f, "Hướng"), "tự do", "xong đường: thước thôi");
}, one()));

test("B10 H is the T-square: level, plumb or 45° from the point before, exact on the axes; H again lets go", () => withController("draw", f => {
  pen(f); f.key("h"); eq(row(f, "Hướng"), "thước ngang");
  f.pointer([150, 10]); f.pointer([171, 12]); f.pointer([173, 40]);
  f.key("Enter");
  const e = shapes(f)[0].entity;
  deepEq(e.pts, [[150, 10], [171, 10], [171, 40]], "ngang rồi dọc, đúng tuyệt đối");
  f.key("h"); eq(row(f, "Hướng"), "tự do");
}, one()));

test("B11 dx · dy offset the first point of a line from where it snapped; a bad number places nothing", () => withController("draw", f => {
  pen(f); f.input("pdx", 5); f.input("pdy", -2);
  f.pointer([10, 10]); f.pointer([40, 8]); f.key("Enter");
  deepEq(shapes(f)[0].entity.a, [15, 8]); deepEq(shapes(f)[0].entity.b, [40, 8], "điểm sau không lệch");
  f.input("pdx", "abc");
  f.pointer([60, 20]);
  eq(row(f, "Đang vẽ"), "0 điểm", "ô hỏng: không đặt");
  ok(f.rows().some(r => /hợp lệ/.test(String(r[1]))), "câu báo");
}, one()));

test("B12 the label says what a press or a drag will do — before it is done", () => withController("draw", f => {
  pen(f);
  /* within the pick radius (1 mm) of the bottom edge, outside the snap (0.5 mm): a free point — a drag there is a parallel */
  f.hover([75, 0.7]); eq(row(f, "Sắp làm"), "điểm đầu · kéo: song song");
  /* 0.3 mm from the curve point (70, 0): the press snaps onto it, and the label says so — a drag is still a parallel (B7) */
  f.hover([70, 0.3]); eq(row(f, "Sắp làm"), "điểm đầu · hít điểm · kéo: song song");
  f.hover([30.6, 0.6]); eq(row(f, "Sắp làm"), "điểm đầu · kéo: compa", "0.85 mm from the notch");
  f.press([70.4, 0.3]); f.move([70, 10]);
  eq(row(f, "Sắp làm"), "song song · 10.0 mm");
  const g = f.paint();
  ok(g.querySelectorAll("*").some(e => e.tagName === "TEXT" && /song song/.test(e.textContent || "")), "nhãn trên canvas");
  f.release();
}, one()));

test("B13 · B15 one undo step per action, ⌘Z gives back exactly what was; the open file is never changed", () => withController("draw", f => {
  const file = JSON.stringify(f.ctx.model.pieces[0].paths);
  pen(f);
  f.drag([70.4, 0.3], [70, 10]);
  f.drag([30.3, 0.4], [100, 30]);
  eq(f.tool.undoCount(), 2);
  f.key("z", {metaKey: true}); eq(shapes(f).length, 1);
  f.key("z", {metaKey: true}); eq(shapes(f).length, 0);
  eq(JSON.stringify(f.ctx.model.pieces[0].paths), file, "mảnh của file y nguyên");
}, one()));

test("B14 Xuất DXF: the Đường is a POLYLINE of the piece, the points placed among its vertices, every vertex on the line", () => withController("draw", f => {
  pen(f);
  f.pointer([10, 10]); f.press([30, 25], {shiftKey: true}); f.release(); f.pointer([60, 15]); f.key("Enter");
  const e = shapes(f)[0].entity, sh = entityShape(e);
  const back = buildModel(parseDXF(f.tool.exportText(f.ctx).text));
  const extra = back.pieces[0].paths.filter(p => p.layer === "8" && !p.closed);
  eq(extra.length, 1, "một đường hở layer 8 thêm vào block của mảnh");
  for(const q of e.pts) ok(extra[0].pts.some(v => hyp(v, q) <= 1e-6), `điểm đã đặt [${q}] là một đỉnh`);
  for(const v of extra[0].pts) ok(closestPoint(sh, point(v[0], v[1])).dist <= 0.01 + 1e-6, `đỉnh [${v}] nằm trên Đường`);
}, one()));
