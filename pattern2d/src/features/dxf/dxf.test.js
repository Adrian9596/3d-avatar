import {test, eq, near, ok} from "../../../tests/harness.js";
import {parseDXF} from "./parse.js";
import {buildModel} from "./model.js";
import {layerMeta} from "./aama.js";
import {modelOf, pieceOf} from "../../../tests/engine_fixtures.js";

/* one block, one closed outline on the cut layer, two text fields, one insert */
const dxf = [
  0,"SECTION", 2,"BLOCKS",
  0,"BLOCK", 2,"TESTPIECE",
  0,"LWPOLYLINE", 8,"1", 70,1, 10,0, 20,0, 10,100, 20,0, 10,100, 20,50, 10,0, 20,50,
  0,"TEXT", 8,"8", 10,5, 20,5, 40,3, 1,"Piece Name:Test",
  0,"TEXT", 8,"8", 10,5, 20,10, 40,3, 1,"QUANTITY:2",
  0,"ENDBLK",
  0,"ENDSEC",
  0,"SECTION", 2,"ENTITIES",
  0,"INSERT", 2,"TESTPIECE", 10,10, 20,20,
  0,"ENDSEC", 0,"EOF"
].join("\n");

test("parse finds the block and its entities", () => {
  const d = parseDXF(dxf);
  ok(d.blocks.TESTPIECE, "block is named by group code 2");
  eq(d.blocks.TESTPIECE.pieceName, "Test");
  eq(d.blocks.TESTPIECE.qty, "2");
  eq(d.entities.filter(e => e.type === "INSERT").length, 1);
});

test("LWPOLYLINE vertices pair up and the 70 flag closes the ring", () => {
  const poly = parseDXF(dxf).blocks.TESTPIECE.ents.find(e => e.type === "POLYLINE");
  eq(poly.pts.length, 4);
  eq(poly.closed, true);
  near(poly.pts[2][0], 100); near(poly.pts[2][1], 50);
});

test("the model places a piece at its insert point", () => {
  const m = buildModel(parseDXF(dxf));
  eq(m.pieces.length, 1);
  const p = m.pieces[0];
  eq(p.name, "Test");
  eq(p.qty, "2");
  near(p.bbox.x0, 10); near(p.bbox.y0, 20);       // block origin + INSERT 10,20
  near(p.bbox.w, 100); near(p.bbox.h, 50);
  near(p.cutLen, 300, 1e-6, "closed perimeter, not the open path");
  eq(p.sew, null);
});

test("unknown layers still get a label", () => {
  eq(layerMeta("1").short, "Cut");
  eq(layerMeta("99").short, "L99");
});

/* ── the sewing line of a piece (spec: edges/edges.md §2, G2) — a closed run on layer 8 or 14 that goes round the
   piece: within 30 mm of the cut line all along, at least half as long. Expected lengths are the rings' sides, by hand */
const lw = (layer, pts, closed = true) => [0, "LWPOLYLINE", 8, layer, 70, closed ? 1 : 0, ...pts.flatMap(([x, y]) => [10, x, 20, y])];
const line = (layer, a, b) => [0, "LINE", 8, layer, 10, a[0], 20, a[1], 11, b[0], 21, b[1]];
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function pieceWith(...ents){
  const text = [0, "SECTION", 2, "BLOCKS", 0, "BLOCK", 2, "P", ...ents.flat(), 0, "ENDBLK", 0, "ENDSEC",
                0, "SECTION", 2, "ENTITIES", 0, "INSERT", 2, "P", 10, 0, 20, 0, 0, "ENDSEC", 0, "EOF"].join("\n");
  return buildModel(parseDXF(text)).pieces[0];
}
const CUT = lw("1", box(0, 0, 100, 50));            // 300 mm round

test("G2 an open layer-8 line on the piece is not its sewing line — Sewing line is empty, not the line's length", () => {
  const p = pieceWith(CUT, lw("8", [[20, 25], [80, 25]], false));
  eq(p.sew, null); eq(p.sewLen, 0); eq(p.sewLayer, null);
});

test("G2 a closed ring on layer 14 (ASTM D6673's sew line) round the piece is its sewing line", () => {
  const p = pieceWith(CUT, lw("14", box(6, 6, 94, 44)));
  eq(p.sewLayer, "14"); near(p.sewLen, 2*(88 + 38), 1e-9, "88 × 38");
  eq(p.sew.length, 4);
});

test("G2 layer 8 counts as much as 14 (Richpeace, 3380, BLOCK_36C put the seam there — CLAUDE.md §8)", () => {
  const p = pieceWith(CUT, lw("8", box(5, 5, 95, 45)));
  eq(p.sewLayer, "8"); near(p.sewLen, 2*(90 + 40), 1e-9);
});

test("G2 a small ring inside (a pad outline) is a shape on the piece: shorter than half the cut line", () => {
  eq(pieceWith(CUT, lw("8", box(40, 20, 60, 30))).sew, null, "20 × 10 = 60 mm < 150");
  const p = pieceWith(CUT, lw("8", box(40, 20, 60, 30)), lw("14", box(6, 6, 94, 44)));
  eq(p.sewLayer, "14", "có cả vòng may thật: lấy vòng may"); near(p.sewLen, 252, 1e-9);
});

test("G2 a ring farther than 30 mm from the cut line somewhere is not the piece's sewing line", () => {
  eq(pieceWith(CUT, lw("8", box(-40, -40, 140, 90))).sew, null, "vòng bao ngoài cách 40 mm");
  near(pieceWith(CUT, lw("8", box(-20, -20, 120, 70))).sewLen, 2*(140 + 90), 1e-9, "cách 20 mm: vẫn trong 30 mm");
});

test("G2 a sewing line drawn as several LINEs that close a ring counts; the longest of two rings wins", () => {
  const p = pieceWith(CUT, line("14", [6, 6], [94, 6]), line("14", [94, 6], [94, 44]), line("14", [94, 44], [6, 44]), line("14", [6, 44], [6, 6]));
  near(p.sewLen, 252, 1e-9, "bốn LINE nối thành vòng");
  near(pieceWith(CUT, lw("8", box(10, 10, 90, 40)), lw("14", box(3, 3, 97, 47))).sewLen, 2*(94 + 44), 1e-9, "vòng dài hơn thắng");
});

test("G2 a piece with no cut line: its longest closed ring on layer 8 / 14", () => {
  const p = pieceWith(lw("8", box(0, 0, 10, 10)), lw("14", box(0, 0, 50, 20)));
  eq(p.cut, null); eq(p.sewLayer, "14"); near(p.sewLen, 140, 1e-9);
});

/* real files of the library (sha256-pinned in tests/fixtures/engine/expected.json): the ring's length is summed here
   by a plain loop over the vertices the viewer drew it with */
const closedLen = pts => pts.reduce((t, q, i) => t + Math.hypot(pts[(i + 1) % pts.length][0] - q[0], pts[(i + 1) % pts.length][1] - q[1]), 0);
test("G2 real files: DM1195's sew line is its layer-14 ring (ASTM); LiftyChic's layer-8 circle is a third of the cut — not a seam", () => {
  const cf = pieceOf(modelOf("lib:DM1195--STRIKE COST-VER C.dxf"), "DM1195-CF LNG-STRIKE COST-VER C_32C");
  eq(cf.sewLayer, "14", "đường may layer 14 (4 LINE/polyline nối thành vòng)");
  ok(cf.sewLen >= 0.5*cf.cutLen && cf.sewLen < cf.cutLen, `ngắn hơn đường cắt, hơn một nửa: ${cf.sewLen} / ${cf.cutLen}`);
  near(cf.sewLen, closedLen(cf.sew), 1e-6, "chiều dài = vòng khép kín của chính các đỉnh đó");
  const lifty = pieceOf(modelOf("lib:2875_ LiftyChic_Crossian.dxf"), "1");
  eq(lifty.sew, null, "vòng tròn layer 8 dài 398.98 mm trên mảnh chu vi 1219.2 mm: hình vẽ trên mảnh");
});
