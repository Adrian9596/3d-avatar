import {test, eq, near, deepEq, ok} from "../../../tests/harness.js";
import {translatePiece, alignPieces, distributePieces, packPieces, snapOffset,
        gapsBetween, snapshot, restore, resetPieces, boxesOf} from "./ops.js";
import {unionBox} from "../../shared/geom.js";

const piece = (x0, y0, w, h) => {
  const pts = [[x0,y0],[x0+w,y0],[x0+w,y0+h],[x0,y0+h]];
  const p = {paths:[{layer:"1", closed:true, pts}], points:[{layer:"4", x:x0, y:y0}],
             texts:[{layer:"8", x:x0, y:y0, h:3, text:"t"}],
             bbox:{x0, y0, x1:x0+w, y1:y0+h, w, h}};
  p.cut = pts;
  return p;
};
const gaps = (ps, axis) => gapsBetween(ps, axis).map(g => +g.toFixed(6));

test("translating a piece moves its geometry and its box together", () => {
  const p = piece(0, 0, 10, 10);
  translatePiece(p, 5, -2);
  deepEq(p.paths[0].pts[0], [5,-2]);
  deepEq([p.points[0].x, p.points[0].y], [5,-2]);
  deepEq([p.texts[0].x, p.texts[0].y], [5,-2]);
  near(p.bbox.x0, 5); near(p.bbox.y1, 8);
  near(p.bbox.w, 10, 1e-9, "a move never resizes");
  deepEq([p.ox, p.oy], [5,-2], "the offset is what Reset undoes");
});

test("the cut outline follows, because it is the same array", () => {
  const p = piece(0, 0, 10, 10);
  translatePiece(p, 3, 3);
  deepEq(p.cut[0], [3,3]);
});

/* G6 (edges/edges.md) — a cut line of several entities is its OWN array, chained from the entities' points: moving the
   paths does not move it. Found on 262 of 711 library pieces (2026-09-24): Edges' labels, the highlight and the click
   that picks the piece stayed where the piece had been */
test("G6 a cut line and a sewing line of several entities follow the piece too — they are not a path's array", () => {
  const p = piece(0, 0, 10, 10);
  p.paths = [{layer: "1", closed: false, pts: [[0, 0], [10, 0], [10, 10]]}, {layer: "1", closed: false, pts: [[10, 10], [0, 10], [0, 0]]},
             {layer: "14", closed: true, pts: [[2, 2], [8, 2], [8, 8], [2, 8]]}];
  p.cut = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];                 // chained: no path holds this array
  p.sew = [[2, 2], [8, 2], [8, 8], [2, 8]];
  translatePiece(p, 5, -2);
  deepEq(p.cut, [[5, -2], [15, -2], [15, 8], [5, 8], [5, -2]], "đường cắt nhiều entity đi theo");
  deepEq(p.sew, [[7, 0], [13, 0], [13, 6], [7, 6]], "đường may đi theo");
  translatePiece(p, -5, 2);
  deepEq(p.cut, [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], "dời đi rồi dời về: đúng chỗ cũ");
});

test("G6 a cut line that IS a path's array moves once, not twice", () => {
  const p = piece(0, 0, 10, 10);
  p.sew = p.paths[0].pts;                                                 // the same array, as the importer hands a single polyline over
  translatePiece(p, 3, 4);
  deepEq(p.cut[0], [3, 4]); deepEq(p.paths[0].pts[1], [13, 4]); deepEq(p.sew[2], [13, 14]);
});

test("align pulls every piece to the edge of the union box", () => {
  const ps = [piece(0,0,50,20), piece(30,100,10,10), piece(-20,50,5,5)];
  alignPieces(ps, "left");
  ok(ps.every(p => Math.abs(p.bbox.x0 - (-20)) < 1e-9), "left edges meet at the leftmost");
  alignPieces(ps, "top");
  const top = Math.max(...ps.map(p => p.bbox.y1));
  ok(ps.every(p => Math.abs(p.bbox.y1 - top) < 1e-9), "top edges meet at the highest");
});

test("align centres, not edges, when asked", () => {
  const ps = [piece(0,0,100,10), piece(0,50,20,10)];
  alignPieces(ps, "cx");
  near((ps[0].bbox.x0+ps[0].bbox.x1)/2, (ps[1].bbox.x0+ps[1].bbox.x1)/2);
});

test("align needs two pieces to mean anything", () => eq(alignPieces([piece(0,0,1,1)], "left"), false));

test("distribute equalises the gaps and pins the outermost pieces", () => {
  const ps = [piece(0,0,20,10), piece(30,0,20,10), piece(200,0,20,10)];
  const before = unionBox(boxesOf(ps));
  distributePieces(ps, "h");
  const g = gaps(ps, "h");
  near(g[0], g[1], 1e-9, "gaps are equal: " + g);
  const after = unionBox(boxesOf(ps));
  near(after.x0, before.x0); near(after.x1, before.x1);
});

test("distribute needs three pieces — two are already evenly spaced", () =>
  eq(distributePieces([piece(0,0,1,1), piece(5,0,1,1)], "h"), false));

test("row layout gives the gap it was asked for and aligns tops", () => {
  const ps = [piece(0,0,30,40), piece(100,-200,20,10), piece(400,80,50,25)];
  packPieces(ps, "row", 12);
  deepEq(gaps(ps, "h"), [12, 12]);
  const top = ps[0].bbox.y1;
  ok(ps.every(p => Math.abs(p.bbox.y1 - top) < 1e-9), "tops aligned");
});

test("column layout stacks downward at the gap, left edges aligned", () => {
  const ps = [piece(0,0,30,40), piece(100,-200,20,10)];
  packPieces(ps, "col", 8);
  deepEq(gaps(ps, "v"), [8]);
  near(ps[0].bbox.x0, ps[1].bbox.x0);
});

test("grid packing keeps every piece inside the block it reports", () => {
  const ps = [piece(0,0,100,50), piece(0,0,80,70), piece(0,0,60,30), piece(0,0,40,90)];
  packPieces(ps, "grid", 10, 1);
  const u = unionBox(boxesOf(ps));
  ok(u.w <= 260 && u.h <= 260, `block stays compact: ${u.w} x ${u.h}`);
  for(const a of ps) for(const b of ps) if(a !== b)
    ok(a.bbox.x1 <= b.bbox.x0 + 1e-9 || b.bbox.x1 <= a.bbox.x0 + 1e-9 ||
       a.bbox.y1 <= b.bbox.y0 + 1e-9 || b.bbox.y1 <= a.bbox.y0 + 1e-9, "no two pieces overlap");
});

test("a drag snaps to the nearest of the nine edge and centre relations", () => {
  const moving = {x0:0, y0:0, x1:10, y1:10};
  const other = {x0:100, y0:0, x1:110, y1:10};
  const s = snapOffset(moving, 97, 0, [other], 7);
  near(s.dx, 95, 1e-9, "the centre landing on the neighbour's left edge is 2 mm away, " +
                       "the left edges meeting is 3 mm — the nearer relation wins");
  ok(s.guides.length > 0, "a snap always draws the line it is holding");
});

test("edges meet when that is the nearest relation", () => {
  const s = snapOffset({x0:0, y0:0, x1:10, y1:10}, 99, 0, [{x0:100, y0:0, x1:110, y1:10}], 7);
  near(s.dx, 100, 1e-9);
});

test("each axis snaps on its own", () => {
  const s = snapOffset({x0:0, y0:0, x1:10, y1:10}, 300, 2, [{x0:100, y0:0, x1:110, y1:10}], 7);
  near(s.dx, 300, 1e-9, "nothing in range across");
  near(s.dy, 0, 1e-9, "but the tops line up, so the drag is pulled level");
});

test("out of range, a drag is left alone", () => {
  const s = snapOffset({x0:0, y0:0, x1:10, y1:10}, 50, 0, [{x0:100, y0:40, x1:110, y1:50}], 7);
  near(s.dx, 50); near(s.dy, 0); eq(s.guides.length, 0);
});

/* pieces/remove.md R5: a step of undo holds the pieces themselves, not their places in the list — delete one and the
   step still puts each piece back where IT was (by place in the list, the piece after the deleted one took its offset) */
test("R5 undo after a piece is deleted puts each piece back where it was — not its neighbour's place", () => {
  const ps = [piece(0,0,10,10), piece(50,0,10,10), piece(100,0,10,10)];
  translatePiece(ps[0], 10, 0); translatePiece(ps[1], 20, 0); translatePiece(ps[2], 30, 0);
  const snap = snapshot(ps);
  for(const p of ps) translatePiece(p, 5, 5);
  const left = [ps[0], ps[2]];                                    // piece 1 deleted
  restore(left, snap);
  near(left[0].bbox.x0, 10, 1e-9, "mảnh 0 về +10");
  near(left[1].bbox.x0, 130, 1e-9, "mảnh 2 cũ về +30 (100 + 30) — không lấy +20 của mảnh đã xoá");
  near(left[1].bbox.y0, 0, 1e-9);
  restore(ps, snap);                                              // and back in the list, the deleted one goes home too
  near(ps[1].bbox.x0, 70, 1e-9, "mảnh 1 (được ⌘Z đem về) về +20");
});

test("undo and reset both go back to where the DXF put the piece", () => {
  const ps = [piece(0,0,10,10), piece(50,0,10,10)];
  const snap = snapshot(ps);
  alignPieces(ps, "left");
  restore(ps, snap);
  near(ps[1].bbox.x0, 50, 1e-9, "undo replays the offsets");
  packPieces(ps, "row", 5);
  ok(resetPieces(ps), "something had moved");
  near(ps[0].bbox.x0, 0); near(ps[1].bbox.x0, 50);
  eq(resetPieces(ps), false, "nothing left to reset");
});
