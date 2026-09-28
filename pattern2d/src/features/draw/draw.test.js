/* The Vẽ tool's own rules (spec: draw/draw.md §1) — what a click makes, what a ghost shows, which piece
   a shape joins, where it is drawn once Arrange has moved its piece, what the pointer picks, and what
   Xuất DXF writes.

   The shapes themselves are the kernel's (geometry/entity.js, proven in entity.test.js); what is
   checked here is that the tool hands the kernel the right numbers and puts the result in the right
   place. Expected values are hand geometry, and the export is read back with the viewer's own DXF
   reader — a file the tool writes has to open as the shapes TD drew. */
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {modelOf, pieceOf} from "../../../tests/engine_fixtures.js";
import {DRAW_MODES, DRAW_LAYERS, DRAW_NUMS, clicksNeeded, shapeFrom, ghostOf, joinTarget, pieceOffset,
        toFile, toShown, shownEntity, pickDrawn, pieceTargets, drawnRows, relationText, framedTargets, frameClash,
        junctionOf, readSides, shownSel, drawKey, zoneTargets, sameZone, placedShapes} from "./flow.js";
import {snapTo} from "../geometry/snap.js";
import {HINH_VE, withDrawings, drawnPath} from "./out.js";
import {parseAngle} from "../../shared/units.js";
import {createLine, createCurve, createRect, createCircle, createPolygon, entityHandles} from "../geometry/entity.js";
import {closestPoint, point, line as kline} from "../geometry/model.js";
import {parseDXF} from "../dxf/parse.js";
import {buildModel} from "../dxf/model.js";
import {writeDXF} from "../dxf/write.js";
import {translatePiece} from "../arrange/ops.js";
import {lengthFormatter} from "../../shared/units.js";

const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const nearPt = (a, b, tol, msg) => ok(hyp(a, b) <= tol, `${msg}: [${a}] cách [${b}] ${hyp(a, b)} > ${tol}`);
const throwsLike = (fn, re, msg) => { let e = null; try{ fn(); }catch(x){ e = x; } ok(e && re.test(e.message), `${msg}: ${e ? e.message : "không từ chối"}`); };
const IN = 25.4;
const verts = e => entityHandles(e).filter(h => /^v\d+$/.test(h.name)).map(h => h.at);
/* a drawing with no block at all — its modelspace IS the piece (write.js writes it as loose entities) */
const LOOSE_DXF = ["0", "SECTION", "2", "ENTITIES",
  "0", "LINE", "8", "1", "10", "0", "20", "0", "11", "100", "21", "0",
  "0", "LINE", "8", "1", "10", "100", "20", "0", "11", "100", "21", "50",
  "0", "TEXT", "8", "1", "10", "0", "20", "-20", "40", "5", "1", "Units: METRIC",
  "0", "ENDSEC", "0", "EOF"].join("\n");

/* ── W1 · W3 · W5 ─────────────────────────────────────────────────────────────── */
test("modes, layers and the numbers a new shape starts from (W1 · W3 · W5)", () => {
  deepEq(DRAW_MODES, ["select", "line", "curve", "rect", "circle", "polygon"]);
  deepEq(DRAW_LAYERS, ["8", "1", "7", "11"], "8 trước: mặc định");
  deepEq([DRAW_NUMS.w, DRAW_NUMS.h, DRAW_NUMS.d, DRAW_NUMS.size, DRAW_NUMS.sides, DRAW_NUMS.angle, DRAW_NUMS.len, DRAW_NUMS.lineAngle],
         [2*IN, 1*IN, 3/8*IN, 1*IN, 6, 0, 2*IN, 0], "2 × 1 in · Ø 3/8 in · Size 1 in · 6 cạnh · Length 2 in");
  deepEq(DRAW_MODES.slice(1).map(clicksNeeded), [2, 2, 1, 1, 1], "Line và Curve hai cú bấm, còn lại một");
});

test("keys inside the tool: 1–5 pick a shape, 0 and Esc go back to Chọn — not with ⌘, not while typing", () => {
  const k = (key, extra = {}) => drawKey({key, target: {matches: () => false}, ...extra});
  deepEq(["1", "2", "3", "4", "5", "0", "Escape"].map(x => k(x)), ["line", "curve", "rect", "circle", "polygon", "select", "select"]);
  eq(k("1", {metaKey: true}), null); eq(k("2", {ctrlKey: true}), null); eq(k("3", {altKey: true}), null);
  eq(drawKey({key: "1", target: {matches: s => s.includes("input")}}), null, "đang gõ trong ô");
  eq(k("9"), null); eq(k("v"), null);
});

/* ── V2 — what a click makes ──────────────────────────────────────────────────── */
test("V2 Line: Start → End is exactly the two points; one click alone makes nothing yet", () => {
  deepEq(shapeFrom("line", [[1, 2], [31, 42]], DRAW_NUMS), {type: "line", a: [1, 2], b: [31, 42]});
  eq(shapeFrom("line", [[1, 2]], DRAW_NUMS), null);
});

test("V2 Line: Start + typed Length and Angle", () => {
  const L = shapeFrom("line", [[0, 0]], {...DRAW_NUMS, len: 127, lineAngle: 30}, {typed: true});
  nearPt(L.b, [127*Math.cos(Math.PI/6), 127*Math.sin(Math.PI/6)], 1e-9, "127 mm ở 30°");
  deepEq(shapeFrom("line", [[5, 5]], {...DRAW_NUMS, len: 10, lineAngle: 90}, {typed: true}).b, [5, 15], "90° đúng tuyệt đối");
});

test("V2 Curve: Start → End gives a straight Bezier whose control points wait at 1/3 and 2/3 (G1)", () => {
  deepEq(shapeFrom("curve", [[0, 0], [30, 60]], DRAW_NUMS), {type: "curve", p0: [0, 0], c1: [10, 20], c2: [20, 40], p3: [30, 60]});
});

test("V2 Rect · Circle · Polygon: one click places what was typed (G3 corner, G4 flat bottom)", () => {
  const n = {...DRAW_NUMS, w: 40, h: 20, d: 12.7, size: 30, sides: 6, angle: 0};
  deepEq(verts(shapeFrom("rect", [[5, 7]], n)), [[5, 7], [45, 7], [45, 27], [5, 27]], "góc dưới-trái tại chỗ bấm");
  deepEq(shapeFrom("circle", [[3, 4]], n), {type: "circle", c: [3, 4], d: 12.7});
  const G = shapeFrom("polygon", [[0, 0]], n), v = verts(G);
  eq(v.length, 6);
  for(const p of v) near(hyp(p, [0, 0]), 15, 1e-9, "đỉnh cách tâm Size/2");
  const ys = v.map(p => p[1]).sort((a, b) => a - b);
  near(ys[0], ys[1], 1e-9, "Angle 0: đáy nằm ngang");
});

test("V2 numbers that are not a shape are refused, with the reason", () => {
  throwsLike(() => shapeFrom("rect", [[0, 0]], {...DRAW_NUMS, w: 0}), /không hợp lệ/, "W = 0");
  throwsLike(() => shapeFrom("polygon", [[0, 0]], {...DRAW_NUMS, sides: 2}), /cạnh/, "2 cạnh");
  throwsLike(() => shapeFrom("line", [[1, 1], [1, 1]], DRAW_NUMS), /dài 0/, "End trùng Start");
  throwsLike(() => shapeFrom("select", [[0, 0]], DRAW_NUMS), /không vẽ/, "Chọn không vẽ gì");
});

/* ── V3 — the ghost ───────────────────────────────────────────────────────────── */
test("V3 the ghost is exactly the shape a click at the pointer would make, and never throws", () => {
  const n = {...DRAW_NUMS, w: 40, h: 20};
  deepEq(ghostOf("rect", [], [10, 10], n), shapeFrom("rect", [[10, 10]], n));
  deepEq(ghostOf("line", [[0, 0]], [3, 4], n), createLine([0, 0], [3, 4]));
  deepEq(ghostOf("curve", [[0, 0]], [9, 0], n), createCurve([0, 0], [9, 0]));
  eq(ghostOf("line", [], [3, 4], n), null, "chưa có Start: chưa có gì để xem trước");
  eq(ghostOf("line", [[0, 0]], [0, 0], n), null, "End đè Start: không có bóng, không ném lỗi");
  eq(ghostOf("rect", [], [0, 0], {...n, w: -1}), null);
});

/* ── V11 · V12 — which piece, which frame ─────────────────────────────────────── */
/* V11 (TD 2026-09-24 — "chỗ bấm quyết định"): the piece whose ZONE holds the first click — inside its closed cut line, not its box —
   even with another piece selected. Hand geometry: A is an L (its box is empty in the corner), B a U whose box straddles A's arm. */
const cut = (pts, extra = {}) => { const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return {cut: pts, cutClosed: true, bbox: {x0, y0, x1, y1, w: x1 - x0, h: y1 - y0}, paths: [], points: [], ...extra}; };
const A_L = [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]];
const B_U = [[-10, 60], [-5, 60], [-5, 105], [25, 105], [25, 60], [30, 60], [30, 110], [-10, 110]];
test("V11 the piece whose cut line holds the click takes the shape — not the smallest box around it (library: 3.4 % went wrong)", () => {
  const pieces = [cut(A_L), cut(B_U)];
  deepEq(joinTarget("8", pieces, -1, [10, 80]), {pi: 0, pid: null}, "trong chân L của A, trong khung (nhỏ hơn) của B, ngoài B → A (luật khung bao: B)");
  deepEq(joinTarget("8", pieces, -1, [27, 80]), {pi: 1, pid: null}, "trong chân U của B → B");
  deepEq(joinTarget("8", pieces, 1, [10, 80]), {pi: 0, pid: null}, "đang chọn B, bấm trong A → A: chỗ bấm quyết định (trước: mảnh đang chọn thắng)");
  deepEq(joinTarget("8", pieces, 0, [27, 80]), {pi: 1, pid: null}, "đang chọn A, bấm trong B → B");
  deepEq(joinTarget("1", pieces, -1, [10, 80]), {pi: -1, pid: null}, "layer 1 không vào mảnh nào (M6)");
});
test("V11 outside every zone: a cut line within the pick radius, else the piece selected, else a shape of its own", () => {
  const pieces = [cut(A_L), cut(B_U)];
  deepEq(joinTarget("8", pieces, -1, [10, -0.5], [], 1), {pi: 0, pid: null}, "0.5 mm dưới mép A, bán kính nhặt 1 mm → A (bấm lên notch ở mép)");
  deepEq(joinTarget("8", pieces, -1, [10, -0.5], [], 0.2), {pi: -1, pid: null}, "ngoài bán kính: không mảnh nào");
  deepEq(joinTarget("8", pieces, 1, [200, 200]), {pi: 1, pid: null}, "xa mọi mảnh, đang chọn B → B");
  deepEq(joinTarget("8", pieces, -1, [200, 200]), {pi: -1, pid: null}, "xa mọi mảnh, không chọn gì → hình riêng");
  deepEq(joinTarget("8", pieces, 7, [200, 200]), {pi: -1, pid: null}, "chỉ số chọn không còn: như không chọn");
  const drawn = [{pid: "P1", bbox: {x0: 200, y0: 0, x1: 300, y1: 80}, ring: [[200, 0], [300, 0], [200, 80]], selected: true}];
  deepEq(joinTarget("8", pieces, -1, [500, 500], drawn), {pi: -1, pid: "P1"}, "xa mọi mảnh, mảnh vẽ đang chọn → mảnh vẽ đó");
});
test("V11 zones that overlap (a nest of sizes): the piece selected among them, else the smallest; no closed cut line: its box", () => {
  const S = cut([[0, 0], [10, 0], [10, 10], [0, 10]]), M = cut([[-5, -5], [15, -5], [15, 15], [-5, 15]]);
  deepEq(joinTarget("8", [M, S], -1, [5, 5]), {pi: 1, pid: null}, "trong cả hai: vùng nhỏ nhất (S)");
  deepEq(joinTarget("8", [M, S], 0, [5, 5]), {pi: 0, pid: null}, "trong cả hai, đang chọn M → M");
  deepEq(joinTarget("8", [M, S], -1, [12, 12]), {pi: 0, pid: null}, "chỉ trong M → M");
  const box = (x0, y0, x1, y1) => ({bbox: {x0, y0, x1, y1, w: x1 - x0, h: y1 - y0}});
  deepEq(joinTarget("8", [box(0, 0, 100, 100), box(10, 10, 30, 30)], -1, [20, 20]), {pi: 1, pid: null}, "không đường cắt kín: khung bao, khung nhỏ");
  const drawn = [{pid: "P1", bbox: {x0: 200, y0: 0, x1: 300, y1: 80}, ring: [[200, 0], [300, 0], [200, 80]], selected: false}];
  deepEq(joinTarget("8", [], -1, [210, 10], drawn), {pi: -1, pid: "P1"}, "trong đường viền mảnh vẽ → mảnh vẽ");
  deepEq(joinTarget("8", [], -1, [290, 70], drawn), {pi: -1, pid: null}, "trong khung nhưng ngoài đường viền tam giác → không");
});

/* V4 (TD 2026-09-24 — "không hít vào mảnh khác … mỗi piece phải có vùng riêng"): a shape of piece A snaps to A's POINTs, vertices,
   lines and A's drawn shapes — never to B's, even where B's notch is the nearest thing; a shape of its own snaps to shapes of its own */
test("V4 a shape snaps only inside its own piece: A's notch, not B's right beside it; a shape of its own, only shapes of its own", () => {
  const A = cut([[0, 0], [50, 0], [50, 50], [0, 50]], {points: [{layer: "4", x: 50, y: 25}]});
  const B = cut([[50, 0], [100, 0], [100, 50], [50, 50]], {points: [{layer: "4", x: 50.3, y: 30}]});
  A.paths = [{layer: "1", closed: true, pts: A.cut, shapes: [kline(point(0, 0), point(50, 0))], snap: A.cut}];
  B.paths = [{layer: "1", closed: true, pts: B.cut, shapes: [kline(point(50, 0), point(100, 0))], snap: B.cut}];
  const on = {"1": true, "4": true, "8": true};
  const drawn = [{id: "LA", shown: createLine([10, 10], [20, 10]), pi: 0, pid: null},
                 {id: "LB", shown: createLine([60, 10], [70, 10]), pi: 1, pid: null},
                 {id: "LX", shown: createLine([200, 10], [210, 10]), pi: -1, pid: null},
                 {id: "LP", shown: createLine([300, 10], [310, 10]), pi: -1, pid: "P1"}];
  const tA = zoneTargets(drawn, [A, B], on, {pi: 0, pid: null});
  eq(snapTo([50.2, 30], tA, 0.5).kind, "free", "notch của B (50.3, 30) cách 0.1 mm — không phải đích của A: tự do");
  deepEq(snapTo([50.1, 25.1], tA, 0.5).point, [50, 25], "notch của A thì hít");
  deepEq(snapTo([20.2, 10.1], tA, 0.5).point, [20, 10], "đầu line vẽ trong A thì hít");
  eq(snapTo([60.1, 10.1], tA, 0.5).kind, "free", "line vẽ trong B: không");
  const tX = zoneTargets(drawn, [A, B], on, {pi: -1, pid: null});
  deepEq(snapTo([210.1, 10], tX, 0.5).point, [210, 10], "hình riêng hít hình riêng");
  eq(snapTo([50.1, 25.1], tX, 0.5).kind, "free", "hình riêng không hít mảnh nào");
  eq(snapTo([300.1, 10], tX, 0.5).kind, "free", "…cũng không hít hình của mảnh vẽ");
  const tP = zoneTargets(drawn, [A, B], on, {pi: -1, pid: "P1"});
  deepEq(snapTo([310.1, 10], tP, 0.5).point, [310, 10], "hình của mảnh vẽ P1 hít hình của P1");
  eq(snapTo([210.1, 10], tP, 0.5).kind, "free");
  const all = zoneTargets(drawn, [A, B], on, null);
  deepEq(snapTo([50.35, 30], all, 0.5).point, [50.3, 30], "không vùng (bút Mảnh mới — M1): mọi thứ đang hiện");
  eq(zoneTargets(drawn, [A, B], on, {pi: 0, pid: null}, "LA").refs.points.some(r => r.id === "LA"), false, "except: bỏ chính hình đang kéo");
  ok(tA.refs.points.some(r => r.point) && tA.refs.points.some(r => r.id === "LA"), "đích mang tham chiếu: điểm DXF · hình vẽ");
});
test("V7 one zone or two: a relation holds only inside one piece (or between two shapes of their own)", () => {
  ok(sameZone({pi: 2, pid: null}, {pi: 2, pid: null}), "cùng mảnh DXF");
  ok(!sameZone({pi: 2, pid: null}, {pi: 3, pid: null}), "hai mảnh DXF");
  ok(sameZone({pi: -1, pid: "P1"}, {pi: -1, pid: "P1"}), "cùng mảnh vẽ");
  ok(!sameZone({pi: -1, pid: "P1"}, {pi: -1, pid: null}), "mảnh vẽ ↔ hình riêng");
  ok(sameZone({pi: -1, pid: null}, {pi: -1, pid: null}), "hai hình riêng");
  ok(!sameZone({pi: 0, pid: null}, {pi: -1, pid: null}), "mảnh DXF ↔ hình riêng");
});
/* pieces/remove.md R4 · R5: a drawn shape holds its piece itself — delete a piece and its shapes are gone from what is shown and
   written; the others keep their piece where it now is in the list; ⌘Z (the piece back) brings its shapes back */
test("R4 R5 drawn shapes of a deleted piece are not placed; the rest find their piece where it is now", () => {
  const A = {n: "A"}, B = {n: "B"}, C = {n: "C"};
  const meta = new Map([["s1", {pc: B, layer: "8"}], ["s2", {pc: null, layer: "8"}], ["s3", {pc: C, layer: "7"}], ["s4", {pc: null, piece: "P1", layer: "8"}]]);
  deepEq(placedShapes(meta, [A, B, C]).map(d => [d.id, d.pi, d.pid]), [["s1", 1, null], ["s2", -1, null], ["s3", 2, null], ["s4", -1, "P1"]]);
  deepEq(placedShapes(meta, [A, C]).map(d => [d.id, d.pi, d.pid]), [["s2", -1, null], ["s3", 1, null], ["s4", -1, "P1"]],
         "B xoá: s1 không còn; s3 theo C tới chỗ 1");
  deepEq(placedShapes(meta, [A, B, C]).map(d => d.id), ["s1", "s2", "s3", "s4"], "B về (⌘Z): s1 về theo");
});

test("V12 a shape keeps the file's coordinates; it is shown where Arrange has put its piece", () => {
  deepEq(pieceOffset({ox: 3, oy: 4}), [3, 4]); deepEq(pieceOffset({}), [0, 0]); deepEq(pieceOffset(null), [0, 0]);
  deepEq(toFile([10, 20], [3, 4]), [7, 16]); deepEq(toShown([7, 16], [3, 4]), [10, 20]);
  const L = createLine([0, 0], [10, 0]);
  deepEq(shownEntity(L, [3, 4]), {type: "line", a: [3, 4], b: [13, 4]});
  ok(shownEntity(L, [0, 0]) === L, "không dời thì chính hình đó");
});

/* ── V5 — what the pointer picks ──────────────────────────────────────────────── */
test("V10 a shape on a layer turned off leaves the selection — Delete never removes what cannot be seen", () => {
  const meta = new Map([["Line1", {pi: 3, layer: "1"}], ["Rect2", {pi: -1, layer: "8"}], ["Poly3", {pi: 0, layer: "11"}]]);
  deepEq(shownSel(["Line1", "Rect2", "Poly3"], meta, {"1": false, "8": true, "11": true}), ["Rect2", "Poly3"], "layer 1 tắt");
  deepEq(shownSel(["Line1", "Rect2", "Poly3"], meta, {"1": true, "8": true}), ["Line1", "Rect2", "Poly3"], "layer 11 file không có: vẫn bật");
  deepEq(shownSel(["Rect2", "Line1"], meta, {"8": false}), ["Line1"], "giữ thứ tự chọn");
  deepEq(shownSel(["Gone", "Rect2"], meta, {}), ["Rect2"], "hình đã xoá không còn trong lựa chọn");
  deepEq(shownSel([], meta, {"1": false}), []);
});

test("V5 pick: the selected shape's handles first (control points too), then any shape's points, then bodies", () => {
  const C = {id: "C", entity: createCurve([0, 0], [40, 0], [10, 10], [30, 10]), off: [0, 0]};
  const L = {id: "L", entity: createLine([10.5, 10], [60, 10]), off: [0, 0]};
  const h1 = pickDrawn([C, L], [10.2, 10], 1, ["C"]);
  deepEq([h1.id, h1.handle], ["C", "c1"], "curve đang chọn: control point của nó"); near(h1.dist, 0.2, 1e-12);
  eq(pickDrawn([C, L], [10.2, 10], 1, []).id, "L", "curve không chọn: control point không nhặt được");
  eq(pickDrawn([C, L], [10.2, 10], 1, []).handle, "a");
  const h2 = pickDrawn([C, L], [35, 10.4], 1, []);
  deepEq([h2.id, h2.handle], ["L", "body"], "giữa line: thân"); near(h2.dist, 0.4, 1e-12);
  eq(pickDrawn([C, L], [100, 100], 1, []), null, "chỗ trống");
  const far = {id: "F", entity: createCircle([0, 0], 10), off: [100, 0]};
  eq(pickDrawn([far], [100.2, 0], 1, []).handle, "c", "hình của mảnh đã bày ra chỗ khác: nhặt tại chỗ nó hiện");
});

/* ── V4 — what a click may snap to ────────────────────────────────────────────── */
test("V4 snap targets from the pieces: visible layers only, each piece in its own file frame", () => {
  const A = {ox: 0, oy: 0, points: [{layer: "4", x: 1, y: 1}], paths: [{layer: "1", closed: false, pts: [[0, 0], [100, 0]],
             shapes: [kline(point(0, 0), point(100, 0))], snap: [[0, 0], [100, 0]]}]};
  const B = {ox: 50, oy: 0, points: [{layer: "4", x: 60, y: 0}, {layer: "5", x: 70, y: 5}],
             paths: [{layer: "8", closed: false, pts: [[50, 20], [80, 20]], shapes: [kline(point(50, 20), point(80, 20))], snap: [[50, 20], [80, 20]]}]};
  const t = pieceTargets([A, B], {"1": true, "4": true, "5": false, "8": false});
  deepEq(t.points, [[1, 1], [0, 0], [100, 0], [10, 0]], "POINT và đỉnh đang hiện; mảnh B trừ độ dời 50");
  deepEq(t.refs.points, t.points.map(p => ({point: p})));
  eq(t.shapes.length, 1, "đường layer 8 đang tắt thì không bắt");
  ok(t.shapes[0] === A.paths[0].shapes[0], "mảnh không dời: chính hình đó (giữ được danh tính cho Tangent)");
  deepEq(t.refs.shapes, [{shape: t.shapes[0]}]);
  const B2 = {...B, paths: [{...B.paths[0], layer: "1"}]};
  const t2 = pieceTargets([B2], {"1": true, "4": true});
  near(closestPoint(t2.shapes[0], point(0, 20)).dist, 0, 1e-12, "đường của mảnh B về khung file: bắt đầu tại x = 0");
});

test("V4 · M1 snap targets as shown: the piece pen and the notch aim at what is on screen, wherever Arrange put it", () => {
  const B = {ox: 50, oy: 0, points: [{layer: "4", x: 60, y: 0}], paths: [{layer: "1", closed: false, pts: [[50, 20], [80, 20]],
             shapes: [kline(point(50, 20), point(80, 20))], snap: [[50, 20], [80, 20]]}]};
  const t = pieceTargets([B], {"1": true, "4": true}, {shown: true});
  deepEq(t.points, [[60, 0], [50, 20], [80, 20]], "đúng chỗ đang hiện — không trừ độ dời");
  ok(t.shapes[0] === B.paths[0].shapes[0], "chính hình đang hiện");
});

/* ── V13 · V12 · V10 · V14 — Xuất DXF ─────────────────────────────────────────── */
test("V13 export: each shape inside its piece's block on its layer, loose ones in HINH_VE; the open model is untouched", () => {
  const model = modelOf("units_metric.dxf"), before = JSON.stringify(model);
  const R = pieceOf(model, "R"), pi = model.pieces.indexOf(R);
  const drawn = [{entity: createLine([10, 10], [60, 10]), pi, layer: "8"},
                 {entity: createRect([20, 20], 30, 10), pi, layer: "1"},
                 {entity: createCircle([300, 300], 9.525), pi: -1, layer: "11"}];
  const text = writeDXF(withDrawings(model, drawn), {source: "t", date: new Date(Date.UTC(2026, 8, 23))}).text;
  eq(JSON.stringify(model), before, "model đang mở không đổi một byte (V14)");
  const back = buildModel(parseDXF(text)), R2 = pieceOf(back, "R");
  const ln = R2.paths.find(q => q.layer === "8" && q.shapes[0].kind === "line" && hyp([q.shapes[0].a.x, q.shapes[0].a.y], [10, 10]) < 1e-6);
  ok(ln, "line vẽ nằm trong block R, layer 8");
  nearPt([ln.shapes[0].a.x, ln.shapes[0].a.y], [10, 10], 1e-6, "đầu line"); nearPt([ln.shapes[0].b.x, ln.shapes[0].b.y], [60, 10], 1e-6, "cuối line");
  const rc = R2.paths.find(q => q.layer === "1" && q.closed && q.pts.length === 4 && hyp(q.pts[0], [20, 20]) < 1e-6);
  ok(rc, "rect vẽ nằm trong block R, layer 1 (bên cạnh đường cắt 100 × 50 của chính mảnh)");
  eq(R2.paths.length, R.paths.length + 2, "mảnh R: đường cũ + 2 hình vẽ");
  deepEq(rc.pts.map(p => p.map(v => +v.toFixed(6))), [[20, 20], [50, 20], [50, 30], [20, 30]]);
  const H = back.pieces.find(p => p.blockName === HINH_VE);
  ok(H, "hình vẽ riêng vào block HINH_VE");
  const ci = H.paths.find(q => q.layer === "11");
  ok(ci && ci.closed, "circle: polyline kín, layer 11");
  for(const p of ci.pts) near(hyp(p, [300, 300]), 9.525/2, 1e-6, "đỉnh circle cách tâm D/2");
  eq(back.pieces.length, model.pieces.length + 1, "thêm đúng một block");
});

test("V12/V13 a piece moved by Arrange: the drawn shape moves with it on screen, and is written at the file's coordinates", () => {
  const model = modelOf("units_metric.dxf"), R = pieceOf(model, "R"), pi = model.pieces.indexOf(R);
  translatePiece(R, 30, 5);
  const text = writeDXF(withDrawings(model, [{entity: createLine([10, 10], [60, 10]), pi, layer: "8"}]), {source: "t"}).text;
  const ln = pieceOf(buildModel(parseDXF(text)), "R").paths.find(q => q.layer === "8" && q.shapes[0].kind === "line");
  nearPt([ln.shapes[0].a.x, ln.shapes[0].a.y], [10, 10], 1e-6, "toạ độ của file, không phải chỗ Arrange bày");
  const p = drawnPath(createLine([10, 10], [60, 10]), "8", pieceOffset(R));
  deepEq(p.pts, [[40, 15], [90, 15]], "trên canvas: theo mảnh");
});

test("V13 a drawing with no block: a shape on it is written with the modelspace", () => {
  const model = buildModel(parseDXF(LOOSE_DXF)), W = model.pieces[0];
  eq(W.blockName, "", "cả bản vẽ là một mảnh");
  const text = writeDXF(withDrawings(model, [{entity: createCircle([50, 25], 10), pi: 0, layer: "11"}]), {source: "t"}).text;
  const back = buildModel(parseDXF(text));
  const ci = back.pieces[0].paths.find(q => q.layer === "11");
  ok(ci, "circle có trong modelspace của file xuất");
  for(const p of ci.pts) near(hyp(p, [50, 25]), 5, 1e-6, "đúng chỗ, đúng cỡ");
  eq(model.loose.paths.length, 2, "model đang mở không có thêm đường nào");
});

test("V13 drawnPath: Line → a LINE, closed shapes → closed polylines, curves and circles → exact shapes to be sampled", () => {
  const p1 = drawnPath(createLine([0, 0], [5, 0]), "8", [0, 0]);
  deepEq([p1.layer, p1.closed, p1.shapes[0].kind, p1.pts], ["8", false, "line", [[0, 0], [5, 0]]]);
  const p2 = drawnPath(createPolygon([0, 0], 10, 5), "1", [0, 0]);
  deepEq([p2.closed, p2.shapes[0].kind, p2.pts.length], [true, "curve", 5]);
  const p3 = drawnPath(createCircle([0, 0], 10), "11", [0, 0]);
  deepEq([p3.closed, p3.shapes[0].kind], [true, "arc"]);
  const p4 = drawnPath(createCurve([0, 0], [9, 0], [3, 3], [6, 3]), "8", [1, 1]);
  deepEq([p4.closed, p4.shapes[0].kind, p4.shapes[0].ctrl[0]], [false, "spline", [1, 1]], "dời theo mảnh");
});

/* ── readout · relations · typed numbers ──────────────────────────────────────── */
test("readout rows in the display unit (N1): 127 mm reads 5.000 in, 12.70 cm, 127.0 mm", () => {
  const L = createLine([0, 0], [127, 0]);
  eq(drawnRows(L, lengthFormatter("inch")).find(r => r[0] === "Dài")[1], "5.000 in");
  eq(drawnRows(L, lengthFormatter("cm")).find(r => r[0] === "Dài")[1], "12.70 cm");
  eq(drawnRows(L, lengthFormatter("mm")).find(r => r[0] === "Góc")[1], "0.00°");
  eq(drawnRows(createCircle([0, 0], 9.525), lengthFormatter("inch")).find(r => r[0] === "D")[1], "0.375 in");
  deepEq(drawnRows(createRect([0, 0], 50.8, 25.4), lengthFormatter("inch")).map(r => r[1]), ["Rectangle", "2.000 in", "1.000 in"]);
  deepEq(drawnRows(createPolygon([0, 0], 25.4, 6, 15), lengthFormatter("inch")).map(r => r[1]), ["Polygon", "1.000 in", "6", "15.00°"]);
  eq(drawnRows(createCurve([0, 0], [30, 40]), lengthFormatter("mm"))[1][1], "50.0 mm", "curve thẳng: dài = dây cung");
});

test("relation texts say who follows whom", () => {
  eq(relationText({type: "horizontal", on: {id: "Line1"}}), "Ngang");
  eq(relationText({type: "vertical", on: {id: "Curve2", handle: "c1"}}), "Dọc (tay nắm c1)");
  eq(relationText({type: "coincident", master: {id: "Line1", handle: "b"}, driven: {id: "Line3", handle: "a"}}), "a trùng Line1.b");
  eq(relationText({type: "coincident", master: {point: [1, 2]}, driven: {id: "Line3", handle: "a"}}), "a trùng điểm DXF");
  eq(relationText({type: "coincident", master: {id: "Circle4"}, driven: {id: "Line3", handle: "b"}}), "b nằm trên Circle4");
  eq(relationText({type: "coincident", master: {shape: {}}, driven: {id: "Rect5", handle: "v3"}}), "v3 nằm trên đường DXF");
  eq(relationText({type: "tangent", master: {id: "Line1"}, driven: {id: "Curve2"}, end: "p0"}), "Tiếp tuyến Line1 tại p0");
  eq(relationText({type: "equal", master: {shape: {}}, driven: {id: "Line6"}}), "Bằng đường DXF");
  eq(relationText({type: "equal", master: {id: "Circle4"}, driven: {id: "Circle7"}}), "Bằng Circle4");
});

test("W7 Tangent's master is what the follower's end is held on", () => {
  const cons = [{type: "coincident", master: {id: "Line1", handle: "b"}, driven: {id: "Curve2", handle: "p0"}},
                {type: "coincident", master: {shape: "S"}, driven: {id: "Curve2", handle: "p3"}},
                {type: "horizontal", on: {id: "Curve2", handle: "c1"}},
                {type: "coincident", master: {id: "Line1", handle: "a"}, driven: {id: "Rect3", handle: "v0"}}];
  deepEq(junctionOf(cons, "Curve2"), [{master: {id: "Line1", handle: "b"}, end: "p0"}, {master: {shape: "S"}, end: "p3"}]);
  deepEq(junctionOf(cons, "Curve2", "p3"), [{master: {shape: "S"}, end: "p3"}]);
  deepEq(junctionOf(cons, "Rect3"), [], "góc hình chữ nhật không phải đầu nối");
});

test("typed angles and side counts: what is refused stays refused", () => {
  deepEq(["30", "30°", "-45", "12,5", " 90 "].map(parseAngle), [30, 30, -45, 12.5, 90]);
  for(const bad of ["", "abc", "30 độ", "1/2"]) throwsLike(() => parseAngle(bad), /góc không hợp lệ/, `góc "${bad}"`);
  eq(readSides("6"), 6); eq(readSides(" 12 "), 12);
  for(const bad of ["2", "6.5", "x", "1001", ""]) throwsLike(() => readSides(bad), /số cạnh không hợp lệ/, `số cạnh "${bad}"`);
});

/* 2026-09-24 — bấm thật: after Arrange moved cup_upper_M 50 mm down, a loose line clicked 0.2 mm from its notch AS SHOWN did not
   snap, and a click on the empty spot where the notch HAD BEEN snapped to (199.387, 6) exactly — the targets were each piece's
   file coordinates, the click the canvas's. A click snaps to what is on screen, brought into the frame of the shape drawn (V4) */
test("V4 snap to what is shown: the targets as on screen, brought into the frame of the shape — the same objects when that frame is the canvas", () => {
  const X = kline(point(50, 20), point(80, 20)), Y = kline(point(0, 0), point(10, 0));
  const shown = {points: [[60, 0], [5, 5]], shapes: [X, Y],
                 refs: {points: [{point: [60, 0]}, {id: "Line1", handle: "a"}], shapes: [{shape: X}, {id: "Line1"}]}};
  ok(framedTargets(shown, [0, 0]) === shown, "khung canvas (hình riêng, mảnh vẽ, mảnh chưa dời): chính các đích đó");
  const f = framedTargets(shown, [50, -10]);
  deepEq(f.points, [[10, 10], [-45, 15]], "điểm: chỗ đang hiện − độ dời của mảnh nhận hình");
  near(closestPoint(f.shapes[0], point(0, 30)).dist, 0, 1e-12, "đường cũng vậy: (50, 20) hiện → (0, 30) trong khung mảnh");
  deepEq(f.refs.points[0], {point: [10, 10]}, "ref điểm DXF theo cùng khung");
  ok(f.refs.shapes[0].shape === f.shapes[0], "ref đường DXF là chính hình đã đưa về khung");
  deepEq([f.refs.points[1], f.refs.shapes[1]], [{id: "Line1", handle: "a"}, {id: "Line1"}], "hình vẽ: ref giữ nguyên (id)");
  deepEq(shown.points[0], [60, 0], "đích gốc không bị sửa");
});

/* bấm thật: "Trùng" between a line of cup_upper_M and one of cup_lower_inner_M laid out 30 mm apart said "đã khai Trùng" — and
   the two points stood 30 mm apart on screen (they coincide in the FILE). A live relation between drawn shapes whose pieces are
   laid out apart is refused; a snapshot of a DXF point or line is taken where it is shown (W9) */
test("V7 a live relation between two drawn shapes of pieces Arrange laid out apart is refused — they would coincide in the file, not on screen", () => {
  const pieces = [{ox: 0, oy: 0}, {ox: 30, oy: 0}, {ox: 30, oy: 0}];
  ok(frameClash({pi: 1}, {pi: 0}, pieces), "mảnh 1 dời 30 mm, mảnh 0 đứng yên");
  eq(frameClash({pi: 1}, {pi: 2}, pieces), false, "hai mảnh dời cùng một độ: trên màn hình cũng trùng");
  eq(frameClash({pi: 0}, {pi: -1}, pieces), false, "mảnh chưa dời và hình riêng: cùng khung");
  ok(frameClash({pi: -1, piece: "P1"}, {pi: 1}, pieces), "mảnh vẽ (khung canvas) và mảnh đã dời");
  eq(frameClash({pi: 1}, null, pieces), false, "chủ là điểm / đường DXF (bản chụp): không có khung để lệch");
});
