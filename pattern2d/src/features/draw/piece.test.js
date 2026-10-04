/* A new pattern piece in the Vẽ tool (spec: draw/piece.md M1–M12) — the tool's own rules for it.

   The outline itself is the kernel's (geometry/outline.js, proven in outline.test.js). Checked here: the
   pen hands the kernel the right points, a closed pen makes a PIECE with what a piece must carry
   (CLAUDE.md §5.10), and the file Xuất DXF writes opens — in the viewer's own reader — as that piece:
   one closed cut line, turn and curve points, grainline, notches and the AAMA text block. Expected
   values are hand geometry, the readback of the written file, or this file's own Bezier arithmetic. */
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {modelOf, pieceOf} from "../../../tests/engine_fixtures.js";
import {createLinePolar, createRect, createCircle, createPolygon, createPath, createPoint, entityShape} from "../geometry/entity.js";
import {outlineSegments, outlineLength} from "../geometry/outline.js";
import {closestPoint, point, line as kline} from "../geometry/model.js";
import {pointInPoly} from "../../shared/geom.js";
import {parseDXF} from "../dxf/parse.js";
import {buildModel} from "../dxf/model.js";
import {writeDXF} from "../dxf/write.js";
import {drawKey, drawTarget, layerApplies, dockGroups, openKey, joinTarget, layerRefusal, deletedText, madeLayer} from "./flow.js";
import {PIECE_TEXT_LAYER, penCloses, penPress, DBL_MS, DBL_PX, penNext, penGhost, nextPieceNumber, pieceRecord, blockNameFor, defaultGrain,
        sampleSizeOf, outlineOf, notchTarget, drawnPieceRows, pieceFrom, readPieceField,
        readNotchDistance, drawnCutLine, fileCutLine, notchPlace, outlineProblem, toPieceShift, pieceFollowers} from "./piece.js";
import {withDrawings, pieceBlock} from "./out.js";

const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const same = (a, b) => Object.is(a[0], b[0]) && Object.is(a[1], b[1]);
const r6 = v => +v.toFixed(6);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0])*t, a[1] + (b[1] - a[1])*t];
const bez = (P, t) => { const a = lerp(P[0], P[1], t), b = lerp(P[1], P[2], t), c = lerp(P[2], P[3], t); return lerp(lerp(a, b, t), lerp(b, c, t), t); };
const throwsLike = (fn, re, msg) => { let e = null; try{ fn(); }catch(x){ e = x; } ok(e && re.test(e.message), `${msg}: ${e ? e.message : "không từ chối"}`); };
function distSeg(p, a, b){
  const d = [b[0] - a[0], b[1] - a[1]], dd = d[0]*d[0] + d[1]*d[1];
  const t = dd ? Math.max(0, Math.min(1, ((p[0] - a[0])*d[0] + (p[1] - a[1])*d[1])/dd)) : 0;
  return Math.hypot(p[0] - a[0] - d[0]*t, p[1] - a[1] - d[1]*t);
}
const distRing = (p, pts) => Math.min(...pts.map((q, i) => distSeg(p, q, pts[(i + 1) % pts.length])));
const T2P = [[0, -150], [180, -150], [180, -40], [90, -5], [0, -20], [-15, -85]], T2K = ["turn", "turn", "turn", "curve", "turn", "curve"];

/* ── M1 · M2 · M3 · M12 — the pen ─────────────────────────────────────────────── */
test("M12 keys: 6 is the piece pen, 7 the notch; 1–5, 0 and Esc as before", () => {
  const k = key => drawKey({key, target: null});
  deepEq(["1", "2", "3", "4", "5", "6", "7", "0", "Escape"].map(k), ["line", "curve", "rect", "circle", "polygon", "piece", "notch", "select", "select"]);
  eq(drawKey({key: "6", metaKey: true, target: null}), null, "⌘6 là của trình duyệt");
  eq(drawKey({key: "7", target: {matches: () => true}}), null, "đang gõ trong ô");
});

test("M2 the pen closes on its first point — within the pick radius, and only once there are three points", () => {
  const pts = [[0, 0], [100, 0], [100, 50]];
  ok(penCloses(pts, [0.5, -0.5], 1), "bấm trong 1 mm của điểm đầu → khép");
  ok(!penCloses(pts, [3, 0], 1), "ngoài bán kính → không");
  ok(!penCloses(pts.slice(0, 2), [0, 0], 1), "mới 2 điểm → không khép");
  ok(!penCloses([], [0, 0], 1), "chưa có điểm");
});

/* M2 (TD 2026-09-24: "cho double click để kết thúc đường vẽ" → bút Mảnh): the canvas redraws on every press, so the browser never
   fires dblclick — the pen counts it itself: a press within DBL_MS and DBL_PX (screen px) of the one before closes the piece */
test("M2 a double-click closes the pen: the first press places the point, the second closes — as Enter does", () => {
  eq(DBL_MS, 500); eq(DBL_PX, 5);
  const three = [[0, 0], [100, 0], [100, 50]], r = 1;
  const at = (t, x, y) => ({t, x, y});
  eq(penPress([[0, 0], [100, 0]], [100, 50], r, at(1000, 400, 300), null), "add", "cú bấm thường: đặt điểm");
  eq(penPress(three, [100, 50], r, at(1300, 401, 302), at(1000, 400, 300)), "close", "cú thứ hai trong 300 ms, cách 2.2 px: khép");
  eq(penPress(three, [100, 50], r, at(1500, 405, 300), at(1000, 400, 300)), "close", "đúng 500 ms, đúng 5 px: vẫn là double-click");
  eq(penPress(three, [100, 50], r, at(1501, 400, 300), at(1000, 400, 300)), "add", "chậm hơn 500 ms: hai cú bấm thường");
  eq(penPress(three, [100, 50], r, at(1200, 406, 300), at(1000, 400, 300)), "add", "xa hơn 5 px: hai cú bấm thường");
  eq(penPress([[0, 0], [100, 0]], [100, 0], r, at(1200, 400, 300), at(1000, 400, 300)), "few", "double-click khi mới 2 điểm: như Enter — báo, không khép");
  eq(penPress([], [0, 0], r, at(1200, 400, 300), {...at(1000, 400, 300), closed: true}), "ignore",
     "cú thứ nhất đã khép (bấm điểm đầu): cú thứ hai không mở mảnh mới");
  eq(penPress(three, [0.5, 0], r, at(5000, 10, 10), null), "close", "bấm trúng điểm đầu: khép như trước");
});

test("M3 a typed side: Length along Angle from the last point, exact at the right angles — the same as a typed Line", () => {
  deepEq(penNext([10, 20], 50, 0), [60, 20]); deepEq(penNext([10, 20], 50, 90), [10, 70]);
  deepEq(penNext([10, 20], 50, 180), [-40, 20]); deepEq(penNext([10, 20], 50, 270), [10, -30]);
  const q = penNext([1, 2], 127, 30), L = createLinePolar([1, 2], 127, 30);
  ok(same(q, L.b), "bằng đúng đầu cuối của Line gõ Length + Angle, từng bit");
  throwsLike(() => penNext([0, 0], 0, 0), /Length/, "dài 0");
});

test("M1 the ghost is the outline the next click would close — a turn point, or a curve point with ⇧", () => {
  eq(penGhost([], [], [5, 5]), null, "chưa có điểm: không có bóng");
  const g1 = penGhost([[0, 0]], ["turn"], [50, 0]);
  eq(g1.type, "line", "một điểm: bóng là đoạn thẳng tới con trỏ");
  const g = penGhost([[0, 0], [100, 0]], ["turn", "turn"], [100, 60]);
  eq(g.type, "path"); deepEq(g.pts, [[0, 0], [100, 0], [100, 60]]); deepEq(g.kinds, ["turn", "turn", "turn"]);
  deepEq(penGhost([[0, 0], [100, 0]], ["turn", "turn"], [50, 60], true).kinds, ["turn", "turn", "curve"], "⇧: curve point");
  eq(penGhost([[0, 0], [100, 0]], ["turn", "turn"], [100, 0]), null, "con trỏ đè lên điểm cuối: không có bóng, không ném lỗi");
});

/* ── M4 · M5 — what a piece is made of ────────────────────────────────────────── */
test("M4 a piece record: Mảnh N, quantity 1, no fabric yet; N never reused", () => {
  eq(nextPieceNumber([]), 1);
  eq(nextPieceNumber([{n: 1}, {n: 4}, {n: 2}]), 5, "số sau số lớn nhất, kể cả khi đã xoá bớt");
  deepEq(pieceRecord(3), {n: 3, name: "Mảnh 3", qty: "1", category: ""});
  eq(blockNameFor(3, new Set()), "MANH_3");
  eq(blockNameFor(3, new Set(["MANH_3", "MANH_3_2"])), "MANH_3_3", "không trùng block có sẵn");
});

test("M4 a closed shape makes a piece: the next number, a block name no block of the file has, the default grainline", () => {
  const R = createRect([10, 20], 80, 50);
  const a = pieceFrom(R, [], new Set(["cup_upper_M"]));
  deepEq([a.n, a.name, a.qty, a.category, a.blockName], [1, "Mảnh 1", "1", "", "MANH_1"]);
  deepEq([a.grain.a, a.grain.b], [defaultGrain(R).a, defaultGrain(R).b], "canh sợi mặc định");
  const b = pieceFrom(R, [{n: 1, blockName: "MANH_1"}, {n: 3, blockName: "MANH_3"}], new Set(["MANH_4"]));
  deepEq([b.n, b.blockName], [4, "MANH_4_2"], "số sau số lớn nhất; tên block tránh cả block của file lẫn mảnh đã vẽ");
  throwsLike(() => pieceFrom(createLinePolar([0, 0], 10, 0), [], new Set()), /kín/, "Line không làm mảnh được");
});

test("M4 the default grainline: vertical, through the middle of the piece's box, 60 % of its height", () => {
  const G = defaultGrain(createRect([10, 20], 80, 50));
  eq(G.type, "line");
  deepEq(G.a, [50, 30]); deepEq(G.b, [50, 60]);
  /* the T2 outline's box, from this file's own evaluation of its segments */
  const pts = [];
  for(const s of outlineSegments(T2P, T2K)) for(let k = 0; k <= 400; k++) pts.push(s.kind === "line" ? lerp(s.ctrl[0], s.ctrl[1], k/400) : bez(s.ctrl, k/400));
  const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
  const T = defaultGrain(createPath(T2P, T2K));
  near(T.a[0], (x0 + x1)/2, 1e-3, "giữa khung theo x"); eq(T.a[0], T.b[0], "dọc tuyệt đối");
  near(T.b[1] - T.a[1], 0.6*(y1 - y0), 1e-3, "60 % chiều cao"); near((T.a[1] + T.b[1])/2, (y0 + y1)/2, 1e-3, "giữa khung theo y");
});

test("M10 what a closed shape is written as: every vertex, and which are turn points", () => {
  const r = outlineOf(createRect([0, 0], 20, 10));
  deepEq(r.pts, [[0, 0], [20, 0], [20, 10], [0, 10]]); deepEq(r.turn, [true, true, true, true]);
  const c = outlineOf(createCircle([5, 5], 20));
  ok(c.turn.every(t => !t), "đường tròn: không có turn point");
  for(const p of c.pts) near(hyp(p, [5, 5]), 10, 1e-9, "đỉnh trên đường tròn");
  ok(!same(c.pts[0], c.pts[c.pts.length - 1]), "không lặp đỉnh đầu ở cuối");
  const t = outlineOf(createPath(T2P, T2K));
  eq(t.turn.filter(Boolean).length, 4, "T2: 4 turn point");
  throwsLike(() => outlineOf(createLinePolar([0, 0], 10, 0)), /kín/, "Line không phải hình kín");
});

/* ── M6 · M7 · M11 ────────────────────────────────────────────────────────────── */
test("M6 a shape on the cut layer never joins a piece of the file; other layers still do (V11)", () => {
  const pieces = [{bbox: {x0: 0, y0: 0, x1: 100, y1: 100}}];
  eq(drawTarget("1", pieces, -1, [50, 50]), -1, "layer 1 trong khung mảnh DXF → không vào mảnh đó");
  eq(drawTarget("1", pieces, 0, [500, 500]), -1, "layer 1, đang chọn mảnh DXF → vẫn không");
  eq(drawTarget("8", pieces, -1, [50, 50]), 0, "layer 8 trong khung → vào mảnh (V11)");
  eq(drawTarget("7", pieces, 0, [500, 500]), 0, "layer 7, đang chọn mảnh → vào mảnh đang chọn");
});

test("M11 the Layer list: in a drawing mode it is the next shape's layer; in Chọn it re-layers the selection", () => {
  eq(layerApplies("curve", ["Curve4"]), "next", "vừa vẽ xong một curve (đang được chọn) → chỉ hình sau");
  eq(layerApplies("piece", []), "next");
  eq(layerApplies("select", ["Line1"]), "selection");
  eq(layerApplies("select", []), "next", "Chọn mà không chọn gì → hình sau");
});

test("M7 a notch lands exactly on the nearest cut line within the pick radius — a drawn outline or a piece's layer 1", () => {
  const E = createPath(T2P, T2K);
  const cands = [{ref: {drawn: "M1"}, shape: entityShape(E)}, {ref: {pi: 0}, shape: entityShape(createRect([300, 0], 50, 50))}];
  const h = notchTarget(cands, [60, -148], 3);
  deepEq(h.ref, {drawn: "M1"}); near(h.point[1], -150, 1e-9, "chân vuông góc trên cạnh đáy"); near(h.point[0], 60, 1e-9);
  const top = outlineSegments(T2P, T2K)[2], q = bez(top.ctrl, 0.4), h2 = notchTarget(cands, [q[0] + 1, q[1] + 1], 3);
  ok(closestPoint(entityShape(E), point(h2.point[0], h2.point[1])).dist <= 1e-9, "trên đường cong trên");
  deepEq(notchTarget(cands, [325, -1], 3).ref, {pi: 0}, "mép mảnh DXF");
  eq(notchTarget(cands, [60, -140], 3), null, "xa hơn bán kính: không có notch");
});

/* ── M8 — the readout of a piece ──────────────────────────────────────────────── */
test("M8 a piece's rows: name, quantity, fabric, perimeter, points, notches, every edge — in the display unit", () => {
  const E = createPath(T2P, T2K), L = (v, d = 1) => (v/25.4).toFixed(d + 2) + " in";
  const rows = drawnPieceRows({name: "Mảnh 1", qty: "1,1", category: ""}, E, 2, L);
  const get = k => (rows.find(r => r[0] === k) || [])[1];
  eq(get("Mảnh"), "Mảnh 1"); eq(get("SL"), "1,1"); eq(get("Vải"), "—"); eq(get("Notch"), "2");
  eq(get("Chu vi"), L(outlineLength(T2P, T2K))); eq(get("Điểm"), "4 góc · 2 cong");
  const edges = get("Cạnh").split(" · ");
  eq(edges.length, 4, "bốn cạnh: đáy · phải · trên · trái"); eq(edges[0], L(180)); eq(edges[1], L(110));
});

/* ── M10 — the file ───────────────────────────────────────────────────────────── */
test("M8 Tên · SL · Vải as typed: the quantities the library writes, R,L as ASTM; anything else refused", () => {
  /* every QUANTITY value in the 46 files of DXF file/ (1 ×257 · 2 ×104 · 1,0 ×70 · 4 ×4 · 1,1 ×3) must be taken as is */
  for(const q of ["1", "2", "1,0", "4", "1,1"]) deepEq(readPieceField("qty", q), {ok: true, value: q}, `SL ${q}`);
  deepEq(readPieceField("qty", " 1 , 1 "), {ok: true, value: "1,1"}, "cách quanh dấu phẩy bỏ đi");
  deepEq(readPieceField("qty", "0,2"), {ok: true, value: "0,2"}, "chỉ mảnh trái");
  for(const q of ["", "0", "0,0", "-1", "1.5", "abc", "1,1,1", "2 cái", ",1", "1,"])
    ok(readPieceField("qty", q).ok === false && readPieceField("qty", q).error, `SL "${q}" bị từ chối`);
  deepEq(readPieceField("name", "  Nẹp thử "), {ok: true, value: "Nẹp thử"}, "Tên bỏ cách hai đầu");
  ok(readPieceField("name", "   ").ok === false, "Tên trống bị từ chối");
  deepEq(readPieceField("category", ""), {ok: true, value: ""}, "Vải được để trống");
  deepEq(readPieceField("category", " lưới "), {ok: true, value: "lưới"}, "Vải bỏ cách hai đầu");
});

test("M10 Xuất DXF: a drawn piece is ONE block — one closed cut line, turn/curve points, grainline, notches, AAMA texts — and reads back as that piece", () => {
  const model = modelOf("units_metric.dxf"), before = JSON.stringify(model);
  const E = createPath(T2P, T2K), G = defaultGrain(E);
  const segs = outlineSegments(T2P, T2K), nq = bez(segs[2].ctrl, 0.5);
  const N1 = createPoint([60, -150]), N2 = createPoint(nq);
  const piece = {...pieceRecord(1), name: "Nẹp thử", qty: "1,1", category: "lưới", blockName: "MANH_1",
                 outline: E, grain: G, notches: [N1, N2], shapes: []};
  const out = withDrawings(model, [], [piece]);
  eq(JSON.stringify(model), before, "model đang mở không đổi một byte (V14)");
  const text = writeDXF(out, {source: "t", date: new Date(Date.UTC(2026, 8, 23))}).text;
  const back = buildModel(parseDXF(text)), P = pieceOf(back, "MANH_1");
  ok(P, "có block MANH_1");
  eq(back.pieces.length, model.pieces.length + 1, "thêm đúng một mảnh");
  deepEq([P.name, P.qty, P.category, P.sample], ["Nẹp thử", "1,1", "lưới", sampleSizeOf(model)], "khối text đọc lại");
  const cut = P.paths.filter(q => q.layer === "1");
  eq(cut.length, 1, "MỘT đường cắt"); ok(cut[0].closed, "kín");
  near(P.cutLen, outlineLength(T2P, T2K), 0.01, "chu vi đường cắt ≤ 0.01 mm");
  const turns = P.points.filter(q => q.layer === "2").map(q => [r6(q.x), r6(q.y)]);
  deepEq(turns, [0, 1, 2, 4].map(i => T2P[i].map(r6)), "turn point đúng bốn góc");
  const curves = P.points.filter(q => q.layer === "3");
  eq(curves.length, cut[0].pts.length - 4, "curve point ở mọi đỉnh còn lại");
  for(const i of [3, 5]) ok(curves.some(q => hyp([q.x, q.y], T2P[i]) <= 1e-6), `curve point người vẽ đặt (${T2P[i]}) có trong file`);
  const notches = P.points.filter(q => q.layer === "4");
  eq(notches.length, 2, "hai notch");
  for(const q of notches) ok(distRing([q.x, q.y], cut[0].pts) <= 0.01, `notch (${r6(q.x)}, ${r6(q.y)}) nằm trên đường cắt`);
  const gr = P.paths.filter(q => q.layer === "7");
  eq(gr.length, 1, "một canh sợi"); ok(hyp([gr[0].shapes[0].a.x, gr[0].shapes[0].a.y], G.a) <= 1e-6 && hyp([gr[0].shapes[0].b.x, gr[0].shapes[0].b.y], G.b) <= 1e-6, "đúng hai đầu");
  const texts = P.texts.map(t => [t.layer, t.text]);
  eq(sampleSizeOf(model), "", "file mẫu này không khai sample size");
  deepEq(texts, [[PIECE_TEXT_LAYER, "Piece Name: Nẹp thử"], [PIECE_TEXT_LAYER, "SAMPLE SIZE:"], [PIECE_TEXT_LAYER, "ANNOTATION:"],
                 [PIECE_TEXT_LAYER, "CATEGORY: lưới"], [PIECE_TEXT_LAYER, "QUANTITY: 1,1"]], "đúng dạng khối text của BLOCK_36C — ô trống là \"KEY:\" như ANNOTATION:");
  deepEq(pieceBlock({...piece}, "M").texts.map(t => t.text).slice(0, 2), ["Piece Name: Nẹp thử", "SAMPLE SIZE: M"], "có sample size thì ghi");
});

test("M10 a Rect drawn on the cut layer is written as a four-corner piece; two pieces are two blocks", () => {
  const model = modelOf("units_metric.dxf");
  const R = createRect([0, -100], 50.8, 25.4), C = createCircle([200, -100], 40);
  const pieces = [{...pieceRecord(1), blockName: "MANH_1", outline: R, grain: defaultGrain(R), notches: [], shapes: []},
                  {...pieceRecord(2), blockName: "MANH_2", outline: C, grain: defaultGrain(C), notches: [], shapes: []}];
  const back = buildModel(parseDXF(writeDXF(withDrawings(model, [], pieces), {source: "t"}).text));
  const A = pieceOf(back, "MANH_1"), B = pieceOf(back, "MANH_2");
  ok(A && B, "hai block");
  deepEq(A.paths.find(q => q.layer === "1").pts.map(p => p.map(r6)), [[0, -100], [50.8, -100], [50.8, -74.6], [0, -74.6]], "bốn góc");
  eq(A.points.filter(q => q.layer === "2").length, 4); eq(A.points.filter(q => q.layer === "3").length, 0);
  /* a ring of n equal chords, each within 0.01 mm of the circle: its length is n·D·sin(π/n) — a hair short
     of πD (0.02 mm at Ø40), the price of any polyline within 0.01 mm of a curve (edit.md X5) */
  const ring = B.paths.find(q => q.layer === "1").pts, n = ring.length;
  for(const p of ring) near(hyp(p, [200, -100]), 20, 1e-6, "đỉnh nằm trên đường tròn");
  ok(20*(1 - Math.cos(Math.PI/n)) <= 0.01 + 1e-12, `dây cung lệch cung ≤ 0.01 mm (n = ${n})`);
  near(B.cutLen, n*40*Math.sin(Math.PI/n), 1e-6, "chu vi = n dây cung");
  eq(B.points.filter(q => q.layer === "2").length, 0, "vòng tròn không có góc");
  deepEq([A.name, B.name, A.qty], ["Mảnh 1", "Mảnh 2", "1"]);
});

test("M10 shapes drawn into a drawn piece go into its block; pieceBlock never touches what it is given", () => {
  const E = createPath(T2P, T2K), inner = createLinePolar([20, -120], 100, 0), given = JSON.stringify(E);
  const b = pieceBlock({...pieceRecord(1), blockName: "MANH_1", outline: E, grain: defaultGrain(E), notches: [],
                        shapes: [{entity: inner, layer: "8"}]}, "M");
  eq(JSON.stringify(E), given, "đường viền không bị sửa");
  eq(b.blockName, "MANH_1");
  ok(b.paths.some(q => q.layer === "8" && q.shapes[0].kind === "line"), "đường trong nằm trong block, layer 8");
  deepEq([b.ox, b.oy], [0, 0], "mảnh vẽ không có độ dời Arrange");
});

/* ── M13 · M14 · M15 — the three proposals of §6.2 (TD 2026-09-23: "đồng ý 3 đề xuất bớt thao tác, test trước rồi apply") ── */
const groups = v => [...dockGroups({mode: "select", kind: "none", type: null, count: 0, closed: false, piece: false, role: null, ...v})].sort();

test("M14 Thành mảnh shows for one closed shape not yet a piece — in every mode, right after drawing it too", () => {
  /* just drawn in its own mode, so it is the one selected: the button is there without going back to Chọn */
  deepEq(groups({mode: "rect", kind: "create", type: "rect", count: 1, closed: true}), ["layer", "rect", "topiece"], "Rect vừa vẽ xong");
  deepEq(groups({mode: "circle", kind: "create", type: "circle", count: 1, closed: true}), ["circle", "layer", "topiece"], "Circle vừa vẽ xong");
  deepEq(groups({mode: "polygon", kind: "create", type: "polygon", count: 1, closed: true}), ["layer", "polygon", "topiece"], "Polygon vừa vẽ xong");
  deepEq(groups({mode: "line", kind: "create", type: "line", count: 1, closed: true}), ["layer", "line", "topiece"], "đổi sang Line, hình kín vẫn đang chọn");
  deepEq(groups({mode: "piece", kind: "create", type: "piece", count: 1, closed: true}), ["line", "topiece"], "sang bút Mảnh, hình kín vẫn đang chọn");
  ok(groups({mode: "notch", kind: "create", type: "notch", count: 1, closed: true}).includes("topiece"), "sang Notch: thành mảnh trước rồi mới notch được lên nó");
  deepEq(groups({mode: "select", kind: "edit", type: "rect", count: 1, closed: true}), ["layer", "move", "rect", "rel", "topiece"], "ở Chọn: như trước");
  /* not for: an open shape, a shape already a piece's, nothing or two selected */
  deepEq(groups({mode: "line", kind: "create", type: "line", count: 1, closed: false}), ["layer", "line"], "Line vừa vẽ: hở");
  deepEq(groups({mode: "rect", kind: "create", type: "rect", count: 1, closed: true, piece: true, role: "outline"}), ["layer", "piece", "rect"], "đã là mảnh");
  deepEq(groups({mode: "rect", kind: "create", type: "rect", count: 0}), ["layer", "rect"], "chưa chọn gì");
  deepEq(groups({mode: "select", kind: "none", count: 2, closed: true}), ["layer", "move"], "chọn hai hình");
});

test("M14 every other box of the dock as before (M11): only what the moment needs", () => {
  deepEq(groups({mode: "select"}), ["layer"], "Chọn, chưa chọn gì");
  deepEq(groups({mode: "select", kind: "edit", type: "line", count: 1}), ["layer", "line", "move", "rel"], "một Line");
  /* a piece's cut line keeps layer 1 and takes no relation; its grainline is a line like any other (bấm thật 2026-09-23) */
  deepEq(groups({mode: "select", kind: "edit", type: "path", count: 1, closed: true, piece: true, role: "outline"}), ["move", "piece"], "đường cắt của mảnh vẽ");
  deepEq(groups({mode: "select", kind: "edit", type: "line", count: 1, piece: true, role: "grain"}), ["layer", "line", "move", "piece", "rel"], "canh sợi của mảnh vẽ");
  deepEq(groups({mode: "select", kind: "edit", type: "point", count: 1, piece: true, role: "notch"}), ["move", "piece"], "notch của mảnh vẽ");
  deepEq(groups({mode: "piece", kind: "create", type: "piece"}), ["line"], "bút Mảnh: Length · Angle");
  deepEq(groups({mode: "curve", kind: "create", type: "curve"}), ["layer"], "Curve");
});

test("M13 6 / 7 open Vẽ straight in Mảnh / Notch from any other tool — the modes they pick inside it; 1–5 and 0 stay inside", () => {
  eq(openKey({key: "6", target: null}), "piece"); eq(openKey({key: "7", target: null}), "notch");
  for(const k of ["6", "7"]) eq(openKey({key: k, target: null}), drawKey({key: k, target: null}), `${k}: cùng chế độ trong và ngoài Vẽ`);
  /* 8 joined 6 / 7 on 2026-10-04 (smartpen.md B1: Bút opens straight from anywhere) — the rest still stay inside Vẽ */
  for(const k of ["1", "2", "3", "4", "5", "0", "Escape", "9", "v", "d", ""]) eq(openKey({key: k, target: null}), null, `"${k}" vẫn chỉ trong Vẽ`);
  const box = {matches: sel => /input/.test(sel)};
  for(const extra of [{metaKey: true}, {ctrlKey: true}, {altKey: true}, {target: box}])
    for(const k of ["6", "7"]) eq(openKey({key: k, target: null, ...extra}), null, `${k} với ${Object.keys(extra)[0]}: không phải của Vẽ`);
});

/* M15 — a notch at an exact distance from a corner. Expected points are hand geometry: the sides of T2's straight edges,
   of a rectangle, of lines.dxf (a 120 × 80 rectangle drawn as four separate LINEs, two of them backwards) */
const near2 = (a, b, tol, msg) => ok(a && Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol, `${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

test("M15 Cách góc as typed: empty is at the click; a length as every length box reads it; negative or not a length refused", () => {
  deepEq(readNotchDistance("", "inch"), {ok: true, mm: null}, "trống"); deepEq(readNotchDistance("   ", "mm"), {ok: true, mm: null}, "chỉ có dấu cách");
  near(readNotchDistance("1/2", "inch").mm, 12.7, 1e-12, "1/2 in"); near(readNotchDistance("3mm", "inch").mm, 3, 1e-12, "3mm khi đang hiện inch");
  near(readNotchDistance("12,7", "mm").mm, 12.7, 1e-12, "dấu phẩy thập phân"); near(readNotchDistance("1.5", "cm").mm, 15, 1e-12, "cm");
  eq(readNotchDistance("0", "inch").mm, 0, "0 = đúng góc");
  eq(readNotchDistance("5", null).mm, 5, "file không khai đơn vị: số của bản vẽ");
  for(const t of ["-1", "abc", "1/0", "2 in 3"]){ const r = readNotchDistance(t, "inch"); ok(r.ok === false && r.error, `"${t}" bị từ chối`); }
});

test("M15 a drawn piece's cut line, cornered: a Path at its turn points, a Rect or Polygon at its vertices, a Circle nowhere", () => {
  const P = drawnCutLine(createPath(T2P, T2K));
  deepEq(P.corners, [T2P[0], T2P[1], T2P[2], T2P[4]], "turn point của T2"); ok(P.ch.closed, "vòng kín");
  const R = drawnCutLine(createRect([300, 0], 100, 50)), key = q => q.join(",");
  deepEq(R.corners.map(key).sort(), ["300,0", "300,50", "400,0", "400,50"], "bốn góc của Rect"); near(R.ch.total, 300, 1e-9, "chu vi Rect");
  eq(drawnCutLine(createPolygon([0, 0], 50, 6, 0)).corners.length, 6, "Polygon 6 cạnh: 6 góc");
  deepEq(drawnCutLine(createCircle([0, 0], 40)).corners, [], "Circle: không góc");
});

/* M7 + V11: two cut lines in one place (two pieces touching edge to edge) — the notch goes to the piece whose ZONE holds the click,
   not to whichever line is nearer by a hair (before: the first one listed, B here) */
test("M7 two cut lines in one place: the notch goes to the piece the click is in", () => {
  const sq = (x0, x1) => { const pts = [[x0, 0], [x1, 0], [x1, 10], [x0, 10]]; return pts; };
  const edge = x => kline(point(x, 0), point(x, 10));
  const cands = [{ref: {pi: 1}, shape: edge(10)}, {ref: {pi: 0}, shape: edge(10)}];         // B listed first
  const zones = {0: sq(0, 10), 1: sq(10, 20)};
  const inZone = (ref, w) => pointInPoly(zones[ref.pi], w);
  deepEq(notchTarget(cands, [9.99, 5], 1, inZone).ref, {pi: 0}, "bấm trong A (x 9.99): notch của A");
  deepEq(notchTarget(cands, [10.01, 5], 1, inZone).ref, {pi: 1}, "bấm trong B (x 10.01): notch của B");
  deepEq(notchPlace(cands.map(c => ({...c, cut: () => null})), [9.99, 5], 1, null, inZone).ref, {pi: 0}, "notchPlace hỏi cùng luật");
  const apart = [{ref: {pi: 1}, shape: edge(10.5)}, {ref: {pi: 0}, shape: edge(10)}];
  deepEq(notchTarget(apart, [10.4, 5], 1, inZone).ref, {pi: 1}, "hai đường không cùng chỗ (cách 0.5 mm): đường gần nhất, như M7");
});

test("M15 where the notch goes: at the foot with no distance (M7, as before); with d, d along the cut line from the nearer corner", () => {
  const E = createPath(T2P, T2K), Q = createRect([300, 0], 100, 50), O = createCircle([600, 0], 40);
  const lines = [{ref: {pid: "P1"}, shape: entityShape(E), cut: () => drawnCutLine(E)},
                 {ref: {pid: "P2"}, shape: entityShape(Q), cut: () => drawnCutLine(Q)},
                 {ref: {pid: "P3"}, shape: entityShape(O), cut: () => drawnCutLine(O)}];
  const t = notchTarget(lines, [60, -148], 3), a = notchPlace(lines, [60, -148], 3, null);
  deepEq([a.ref, a.point], [t.ref, t.point], "không có khoảng cách: đúng như M7");
  near2(notchPlace(lines, [20, -148.5], 3, 12.7).point, [12.7, -150], 1e-9, "cạnh đáy T2, gần v0");
  near2(notchPlace(lines, [170, -151], 3, 12.7).point, [167.3, -150], 1e-9, "cạnh đáy T2, gần v1");
  near2(notchPlace(lines, [179, -60], 3, 30).point, [180, -70], 1e-9, "cạnh phải T2, gần v2 (180,−40)");
  near2(notchPlace(lines, [395, 1], 3, 12).point, [388, 0], 1e-9, "Rect, gần góc (400,0)");
  const far = notchPlace(lines, [20, -148.5], 3, 200);
  ok(far.error && far.point === undefined, "d dài hơn cạnh: không có điểm"); near(far.edgeLength, 180, 1e-9, "…và nói cạnh dài 180");
  ok(/góc/.test(notchPlace(lines, [620.5, 0], 3, 5).error), "Circle: không có góc để đo");
  eq(notchPlace(lines, [60, -140], 3, 12.7), null, "xa mọi đường cắt: không có notch");
});

test("M15 a file piece's cut line is the whole run of its layer-1 paths that holds the click, cornered as Edges corners it", () => {
  /* lines.dxf: RECT is 120 × 80 from (10,20) to (130,100), drawn as four LINEs, two of them backwards */
  const pc = pieceOf(modelOf("lines.dxf"), "RECT"), k = pc.paths.findIndex(q => q.layer === "1" && q.pts[0][1] === 100 && q.pts[1][1] === 20);
  ok(k >= 0, "cạnh phải vẽ ngược (130,100) → (130,20)");
  const L = fileCutLine(pc, k);
  near(L.ch.total, 400, 1e-9, "cả bốn LINE, không phải một"); ok(L.ch.closed, "vòng kín");
  deepEq([...new Set(L.corners.map(q => q.join(",")))].sort(), ["10,100", "10,20", "130,100", "130,20"], "bốn góc — định nghĩa của Edges");
  const lines = pc.paths.flatMap((q, i) => q.layer === "1" ? q.shapes.map(sh => ({ref: {pi: 0}, shape: sh, cut: () => fileCutLine(pc, i)})) : []);
  near2(notchPlace(lines, [129.8, 95], 3, 10).point, [130, 90], 1e-9, "cạnh phải, gần góc (130,100)");
  near2(notchPlace(lines, [15, 20.2], 3, 25.4).point, [35.4, 20], 1e-9, "cạnh đáy, gần góc (10,20)");
  near(notchPlace(lines, [15, 20.2], 3, 130).edgeLength, 120, 1e-9, "cạnh đáy chỉ dài 120");
  /* arcs.dxf: TRACK is two lines and two half-circles, smooth all round — no corner; HOLE is a circle */
  const arcs = modelOf("arcs.dxf"), tr = pieceOf(arcs, "TRACK"), tl = tr.paths.flatMap((q, i) => q.layer === "1" ? q.shapes.map(sh => ({ref: {pi: 0}, shape: sh, cut: () => fileCutLine(tr, i)})) : []);
  ok(/góc/.test(notchPlace(tl, [100, 0.2], 3, 10).error), "đường chạy trơn: không có góc");
});

test("M15 Notch mode shows the Cách góc box — and no other box is added anywhere", () => {
  deepEq(groups({mode: "notch", kind: "create", type: "notch"}), ["notch"], "chế độ Notch");
  ok(!groups({mode: "select"}).includes("notch") && !groups({mode: "piece", kind: "create", type: "piece"}).includes("notch"), "chỉ ở chế độ Notch");
});


/* ── 2026-09-24 — TD: "test và fix bug cho phần: vẽ pattern · thêm và bớt pieces · xoá và thêm đường". Each case below was
   seen first on the build (bấm thật / macro), written here, run red, and only then fixed ─────────────────────────── */
const TURN4 = ["turn", "turn", "turn", "turn"], TURN3 = ["turn", "turn", "turn"];

test("M16 a piece must have an inside: no area (points in a line, a spike) or an outline crossing itself is refused — saying why", () => {
  eq(outlineProblem(createRect([0, 0], 50, 20)), null, "Rect"); eq(outlineProblem(createCircle([0, 0], 30)), null, "Circle");
  eq(outlineProblem(createPath(T2P, T2K)), null, "T2: 4 góc, 2 điểm cong");
  /* seen on the build: three points in a vertical line made "Mảnh 3" — a piece with no inside; in a horizontal line the
     refusal spoke of a zero-length Start/End (the grainline of a piece 0 mm tall) */
  ok(/mỏng/.test(outlineProblem(createPath([[600, -300], [600, -250], [600, -200]], TURN3))), "ba điểm thẳng hàng dọc");
  ok(/mỏng/.test(outlineProblem(createPath([[400, -200], [450, -200], [500, -200]], TURN3))), "ba điểm thẳng hàng ngang");
  ok(/mỏng/.test(outlineProblem(createPath([[700, -300], [760, -300], [730, -300.0000001]], TURN3))), "gai: quay lại trên chính cạnh vừa vẽ");
  ok(/tự cắt/.test(outlineProblem(createPath([[400, -300], [500, -250], [500, -300], [400, -250]], TURN4))), "nơ bướm");
  ok(/tự cắt/.test(outlineProblem(createPath([[0, 0], [100, 0], [100, 60], [40, -20]], TURN4))), "nơ bướm lệch — diện tích khác 0");
  eq(outlineProblem(createPath([[0, 0], [100, 0], [100, 0.05], [0, 0.05]], TURN4)), null, "dải rộng 0.05 mm vẫn là mảnh");
  throwsLike(() => pieceFrom(createPath([[600, -300], [600, -250], [600, -200]], TURN3), [], new Set()), /mỏng/, "pieceFrom từ chối, cùng lý do");
  throwsLike(() => pieceFrom(createPath([[400, -300], [500, -250], [500, -300], [400, -250]], TURN4), [], new Set()), /tự cắt/, "…và nơ bướm");
});

test("M17 a shape joins a DRAWN piece: the one selected, else the smallest box — drawn or of the file — around the first click", () => {
  const pieces = [{bbox: {x0: 0, y0: 0, x1: 100, y1: 100}}];
  const drawn = [{pid: "P1", bbox: {x0: 200, y0: 0, x1: 300, y1: 80}, selected: false},
                 {pid: "P2", bbox: {x0: 20, y0: 20, x1: 40, y1: 40}, selected: false}];
  deepEq(joinTarget("8", pieces, -1, [250, 40], drawn), {pi: -1, pid: "P1"}, "trong khung mảnh vẽ P1 → vào P1 (bấm thật: 'hình vẽ riêng')");
  deepEq(joinTarget("8", pieces, -1, [30, 30], drawn), {pi: -1, pid: "P2"}, "mảnh vẽ nằm trong khung mảnh DXF, nhỏ hơn: vào mảnh vẽ");
  deepEq(joinTarget("8", pieces, -1, [60, 60], drawn), {pi: 0, pid: null}, "chỉ trong khung mảnh DXF: như trước (V11)");
  deepEq(joinTarget("8", pieces, -1, [500, 500], drawn), {pi: -1, pid: null}, "ngoài mọi mảnh: hình riêng");
  deepEq(joinTarget("7", pieces, -1, [500, 500], [{...drawn[0], selected: true}]), {pi: -1, pid: "P1"}, "mảnh vẽ đang chọn thắng");
  deepEq(joinTarget("8", pieces, 0, [250, 40], [{...drawn[0], selected: true}]), {pi: -1, pid: "P1"},
         "bấm trong mảnh vẽ P1 khi mảnh của file đang chọn → P1: chỗ bấm quyết định (TD 2026-09-24, V11 — trước: mảnh của file đi trước, W2)");
  deepEq(joinTarget("1", pieces, -1, [250, 40], drawn), {pi: -1, pid: null}, "layer 1 không vào mảnh nào — vẽ hay DXF (M6)");
  deepEq(joinTarget("1", pieces, -1, [500, 500], [{...drawn[0], selected: true}]), {pi: -1, pid: null}, "…kể cả mảnh vẽ đang chọn");
  for(const w of [[60, 60], [250, 40], [500, 500]]) eq(drawTarget("8", pieces, -1, w), joinTarget("8", pieces, -1, w).pi, "drawTarget = pi của joinTarget khi không có mảnh vẽ");
});

test("M6 a shape of a piece — of the file or drawn — cannot go to layer 1: that piece has its cut line (seen: two cut lines in cup_upper_M)", () => {
  ok(/layer 1/.test(layerRefusal({pi: 0, layer: "8"}, "1")), "hình trong mảnh DXF");
  ok(/layer 1/.test(layerRefusal({pi: -1, layer: "8", piece: "P1"}, "1")), "hình trong mảnh vẽ");
  eq(layerRefusal({pi: -1, layer: "8"}, "1"), null, "hình riêng: được (đường cắt hở, hay Thành mảnh)");
  eq(layerRefusal({pi: 0, layer: "8"}, "7"), null, "sang layer khác: được");
  eq(layerRefusal({pi: 0, layer: "1"}, "1"), null, "đã ở layer 1: không đổi gì");
});

test("M18 Thành mảnh keeps the shape where it is shown: a shape of a file piece Arrange moved comes into the canvas frame by that move", () => {
  const pieces = [{}, {ox: 50, oy: -7}];
  deepEq(toPieceShift({pi: 1}, pieces, false), {d: [50, -7]}, "mảnh DXF đã dời +50, −7: hình dời theo đúng chừng đó (bấm thật: nhảy lệch 50 mm)");
  deepEq(toPieceShift({pi: 0}, pieces, true), {d: [0, 0]}, "mảnh chưa dời: đứng yên, quan hệ không sao");
  deepEq(toPieceShift({pi: -1}, pieces, false), {d: [0, 0]}, "hình riêng: khung canvas sẵn rồi");
  ok(/quan hệ/.test(toPieceShift({pi: 1}, pieces, true).error), "hình có quan hệ trên mảnh đã dời: từ chối — kéo theo hình ở khung khác");
});

test("L1 Delete says what went: the pieces deleted whole, a grainline lost, the shapes that stopped hanging on what was deleted", () => {
  eq(deletedText({count: 1}), "đã xoá 1 hình");
  eq(deletedText({count: 3, pieces: ["Mảnh 1"]}), "đã xoá 3 hình — cả Mảnh 1");
  ok(/Mảnh 2 không còn canh sợi/.test(deletedText({count: 1, lost: ["Mảnh 2"]})), "mất canh sợi (§5.10)");
  ok(/Line2 thôi bám/.test(deletedText({count: 1, freed: ["Line2"]})), "hình bám vào hình vừa xoá: nói rõ, nó đứng yên (V9)");
});

/* bấm thật 2026-09-24: ⇧→ on the cut line of a drawn piece moved the cut line 10 mm and left its grainline and the line drawn
   into it where they were — a drag of the same line moves the whole piece (M9). One rule for both */
test("M9 what goes with a drawn piece's cut line — dragged, nudged or Dời: its shapes no relation holds, not those moving by their own selection", () => {
  const members = ["Vien1", "Grain2", "Point3", "Line4"], driven = new Set(["Point3"]);
  deepEq(pieceFollowers("Vien1", members, id => driven.has(id)), ["Grain2", "Line4"], "canh sợi + đường trong; notch đi theo bằng quan hệ của nó");
  deepEq(pieceFollowers("Vien1", members, id => driven.has(id), ["Line4"]), ["Grain2"], "Line4 cũng đang được chọn: tự nó dời, không dời hai lần");
  deepEq(pieceFollowers("Vien1", ["Vien1"], () => false), [], "mảnh chỉ có đường cắt");
});

/* fuzz 2026-09-24 (SONASHAPE, seed 21, step 120): a Line started on layer 8 inside SONASHAPE-MESH_L — so it joined that piece —
   then layer 1 chosen before its End: the Line was made on layer 1 IN the piece, and the file wrote that block with a second
   cut line (M6). While a shape is being made, the Layer list is the NEXT shape's (V10, M11): the one in hand keeps the layer
   it was started on — the layer that chose its piece */
test("M11 · M6 a shape being made keeps the layer of its first click — a layer chosen before its last click is the next shape's", () => {
  eq(madeLayer({clicks: 1, first: "8", now: "1"}), "8", "Line: Start ở layer 8 (vào mảnh DXF), đổi sang 1 trước End → vẫn 8");
  eq(madeLayer({clicks: 1, first: "1", now: "8"}), "1", "Start ở layer 1 (không vào mảnh nào), đổi sang 8 → vẫn 1: đứng riêng");
  eq(madeLayer({clicks: 0, first: "8", now: "1"}), "1", "hình một cú bấm (Rect · Circle · Polygon), hay chưa bấm gì: layer lúc bấm");
});
