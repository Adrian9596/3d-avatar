import {test, eq, ok} from "../../../tests/harness.js";
import {hitPiece} from "./hit.js";
import {pathD} from "./draw.js";
import {pieceLabel} from "./pieces.js";

const rect = (x0, y0, w, h) => {
  const pts = [[x0,y0],[x0+w,y0],[x0+w,y0+h],[x0,y0+h]];
  return {paths:[{layer:"1", closed:true, pts}], points:[], texts:[],
          cut:pts, sew:null, bbox:{x0, y0, x1:x0+w, y1:y0+h, w, h}};
};
/* an L shape: its box covers the top-right quarter, its outline does not */
const ell = () => {
  const pts = [[0,0],[100,0],[100,40],[40,40],[40,100],[0,100]];
  return {paths:[{layer:"1", closed:true, pts}], points:[], texts:[],
          cut:pts, sew:null, bbox:{x0:0, y0:0, x1:100, y1:100, w:100, h:100}};
};

test("the smallest piece under the point wins", () => {
  const pieces = [rect(0,0,200,200), rect(50,50,20,20)];
  eq(hitPiece(pieces, [60,60]), 1);
});

test("an outline hit beats a box-only hit", () => {
  const pieces = [ell(), rect(60,60,30,30)];
  eq(hitPiece(pieces, [70,70]), 1, "inside the small rect, only inside the L's box");
});

test("nothing under the point is -1, and pad decides the near miss", () => {
  const pieces = [rect(0,0,10,10)];
  eq(hitPiece(pieces, [12,5]), -1);
  eq(hitPiece(pieces, [12,5], 4), 0, "clicking just outside a thin piece still picks it");
});

test("pieces fall back to any name they have", () => {
  eq(pieceLabel({blockName:"B", name:"N", vn:"V"}, 0), "B");
  eq(pieceLabel({name:"N", vn:"V"}, 0), "N");
  eq(pieceLabel({vn:"V"}, 0), "V");
  eq(pieceLabel({}, 3), "piece 4");
});

test("pathD flips Y and closes only when asked", () => {
  eq(pathD([[0,0],[10,5]], false), "M0,0L10,-5");
  ok(pathD([[0,0],[10,5]], true).endsWith("Z"));
});
