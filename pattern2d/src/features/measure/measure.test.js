/* Measure — hai tool, hai luật chọn điểm.
   `nearestVertex` cũ bị thay bằng `definedPoints` + `nearestPoint` của kernel: requirement
   mới (point_to_point.md §2) nói "điểm trên piece" gồm cả entity POINT, không chỉ đỉnh
   polyline — grade point (layer 5) không nằm trên đường viền nên đỉnh không với tới. */
import {test, eq, deepEq, ok} from "../../../tests/harness.js";
import {definedPoints, pickPath, measureBlock, noteBlock, runMiddle, straightReadout, alongReadout, trackAlive} from "./measure.js";
import {nearestPoint, straight} from "../geometry/straight.js";
import {point, line} from "../geometry/model.js";

const piece = {name: "cup", paths: [
  {layer: "1", closed: true,  pts: [[0, 0], [100, 0], [100, 50], [0, 50]]},
  {layer: "8", closed: true,  pts: [[6, 6], [94, 6], [94, 44], [6, 44]]},
  {layer: "7", closed: false, pts: [[50, 10], [50, 40]]},
  {layer: "4", closed: false, pts: [[30, 0]]}
], points: [
  {layer: "4", x: 30, y: 0},        // notch: nằm trên đường cắt
  {layer: "5", x: 50, y: 25},       // grade point: KHÔNG nằm trên đường nào
  {layer: "3", x: 100, y: 25}       // curve point
]};
const allOn = {"1": true, "8": true, "7": true, "4": true, "5": true, "3": true};

/* ── điểm nào được coi là "điểm trên piece" ─────────────────────────────── */
test("entity POINT được tính, kể cả grade point không nằm trên đường viền", () => {
  const pts = definedPoints([piece], allOn);
  ok(pts.some(p => p[0] === 50 && p[1] === 25), "grade point (layer 5) phải bắt được");
  ok(pts.some(p => p[0] === 30 && p[1] === 0), "notch (layer 4) phải bắt được");
});

test("đỉnh polyline cũng được tính", () =>
  ok(definedPoints([piece], allOn).some(p => p[0] === 100 && p[1] === 50)));

test("layer đang tắt thì không phải mục tiêu", () => {
  const off = definedPoints([piece], {...allOn, "5": false, "8": false});
  ok(!off.some(p => p[0] === 50 && p[1] === 25), "grade point đã tắt");
  ok(!off.some(p => p[0] === 6 && p[1] === 6), "đỉnh đường may đã tắt");
});

test("entity POINT đứng trước đỉnh polyline: notch thắng khi trùng chỗ", () => {
  const pts = definedPoints([piece], allOn);
  const iNotch = pts.findIndex(p => p[0] === 30 && p[1] === 0);
  const iVert  = pts.findIndex(p => p[0] === 0 && p[1] === 0);
  ok(iNotch < iVert, "POINT phải nằm trước trong danh sách");
});

test("không có mảnh nào thì trả danh sách rỗng, không ném lỗi", () =>
  eq(definedPoints([], allOn).length, 0));

/* ── bắt điểm: luật của kernel, dữ liệu của feature ─────────────────────── */
test("bấm gần grade point thì bắt grade point", () =>
  deepEq(nearestPoint(definedPoints([piece], allOn), [52, 27], 12).point, [50, 25]));

test("bấm giữa chỗ trống thì không bắt gì — đó là điểm tự do", () =>
  eq(nearestPoint(definedPoints([piece], allOn), [70, 20], 5), null));

/* ── Along Path: chọn đúng đường để bám vào ─────────────────────────────── */
test("bấm sát đường cắt thì bám đường cắt", () =>
  eq(pickPath([piece], allOn, [2, 1]).path.layer, "1"));

test("bấm sát đường may thì bám đường may, không nhảy về đường cắt", () =>
  eq(pickPath([piece], allOn, [8, 7]).path.layer, "8"));

test("layer đang tắt thì không được chọn", () =>
  eq(pickPath([piece], {...allOn, "8": false}, [8, 7]).path.layer, "1"));

test("đường chỉ có 1 điểm không phải là đường để đo dọc", () =>
  eq(pickPath([{paths: [piece.paths[3]]}], allOn, [30, 0]), null));

test("không có mảnh nào thì trả null chứ không ném lỗi", () =>
  ok(pickPath([], allOn, [0, 0]) === null));

/* ── P8 — what the panel shows, with no piece selected (TD 2026-09-24: "đo điểm") ─────────────────── */
const mmL = (v, d = 1) => v.toFixed(d) + " mm";

test("P8 a Straight measurement with nothing selected: its block is the panel's heading — dx, dy and how each end was taken show", () => {
  const r = straightReadout(straight(point(199.387, 6), point(340.199, 6)), ["point", "free"], mmL);
  const b = measureBlock(r, "", false);
  eq(b.title, "Straight", "tiêu đề của bảng");
  deepEq(b.rows.map(x => x[0]), ["Khoảng cách", "dx", "dy", "Điểm A", "Điểm B"]);
  eq(measureBlock(r, "", true), r, "đang chọn mảnh: một khối dưới tên mảnh, như trước");
});

test("P8 why a click could not start a measurement: said in full (up to 160 characters), with or without a piece selected", () => {
  const why = "hình trùng nhau: hình 3 và 5 vẽ đè cùng một đường — xoá bớt một cái rồi đo";
  const b = measureBlock(null, why, false);
  eq(b.title, "Along Path"); eq(b.rows[0][1], why, "không cắt còn 60 ký tự");
  eq(measureBlock(null, why, true).section, "Along Path");
  eq(noteBlock(""), null); eq(measureBlock(null, "", false), null);
});

test("P8 the Along label sits at half the measured length — on a straight run too, not at its end B", () => {
  deepEq(runMiddle([line(point(0, 0), point(100, 0))]), [50, 0], "một đoạn thẳng: giữa đoạn");
  deepEq(runMiddle([line(point(0, 0), point(30, 0)), line(point(30, 0), point(30, 40))]), [30, 5], "30 + 40: 35 mm dọc đường");
  eq(runMiddle([]), null);
});

/* 2026-09-24 — the library sweep of Along (every piece, the tool's own functions) lost ONE piece: BiancaBra 11_52_M draws two
   layer-8 lines over the bottom edge of its cut line, 0.0002 mm off it; a click on the edge took the layer-8 line (a hair
   nearer) and then refused it ("hình trùng nhau"). Lines within 0.01 mm of each other are in one place: the cut line first,
   then the sewing line (8, 14), then the rest; a line clearly nearer is still the one followed */
test("Along: lines drawn on one another (≤ 0.01 mm) — the cut line is followed, then a sewing line; a nearer line still wins", () => {
  const on = {"1": true, "7": true, "8": true, "14": true};
  const ring = {layer: "1", closed: true, pts: [[0, 0], [100, 0], [100, 50], [0, 50]]};
  const over = {paths: [{layer: "8", closed: false, pts: [[0, 0.0002], [60, 0.0002]]}, ring], points: []};
  eq(pickPath([over], on, [30, 0.15]).path.layer, "1", "vẽ đè cách 0.0002 mm: cùng một chỗ — đường cắt (dù đường đè đứng trước trong file)");
  eq(pickPath([over], on, [30, -0.3]).path.layer, "1");
  const inside = {paths: [{layer: "8", closed: false, pts: [[0, 5], [60, 5]]}, ring], points: []};
  eq(pickPath([inside], on, [30, 4]).path.layer, "8", "đường trong cách đường cắt 5 mm, bấm sát nó: đường trong");
  const seam = {paths: [{layer: "7", closed: false, pts: [[0, 10], [90, 10]]}, {layer: "14", closed: true, pts: [[5, 10], [95, 10], [95, 45], [5, 45]]}], points: []};
  eq(pickPath([seam], on, [40, 10.1]).path.layer, "14", "đường may đè canh sợi: đường may");
});

/* 2026-09-24 — the library check of Along found clicks that follow an internal line (BiancaBra 11_52_M: a layer-8 line starting
   at a cut corner) or a copy of the cut line on another layer (SONASHAPE: layer 84, 0.016 mm off it): the number is then of
   THAT line, and the panel never said which. It says now */
test("P8 the Along panel names the line it follows — layer and what that layer is", () => {
  const r = {distance: 10, direct: 8, closed: false, total: 30, parts: [1], offPath: 0, crossings: [], ambiguous: false, shapes: []};
  deepEq(alongReadout(r, mmL, "1").rows[0], ["Bám", "1 · Cut line", true], "đường cắt");
  deepEq(alongReadout(r, mmL, "14").rows[0], ["Bám", "14 · Sewing line (ASTM D6673)", true], "đường may layer 14");
  deepEq(alongReadout(r, mmL, "84").rows[0], ["Bám", "84 · Layer 84", true], "layer khác: số của nó");
  eq(alongReadout(r, mmL).rows[0][0], "Dọc đường", "không nói layer: như trước");
});

/* edit.md Z6 · pieces/remove.md R4: an Along measurement follows paths of one piece — a path deleted in Edit, or the piece deleted,
   and it is not measured any more (it would measure a line that is not there) */
test("Z6 R4 an Along measurement is alive only while its piece and every path it follows are still there", () => {
  const a = {layer: "1"}, b = {layer: "1"}, c = {layer: "8"};
  const P = {paths: [a, b, c]}, Q = {paths: []};
  const track = {piece: P, paths: [a, b]};
  ok(trackAlive(track, [Q, P]), "còn đủ");
  ok(!trackAlive(track, [Q]), "mảnh đã xoá");
  P.paths = [a, c];
  ok(!trackAlive(track, [Q, P]), "một đường nó bám đã xoá");
  ok(!trackAlive(null, [P]), "không có phép đo");
});
