/* Pieces built by hand for the Edit tests (src/features/edit/*.test.js) — every number in them
   is known from the construction, so a test can say where a corner must land without asking
   the kernel. Shaped the way dxf/model.js shapes an imported piece: paths with pts · shapes ·
   snap, points, texts, then summarize(). */
import {curve, line, point} from "../src/features/geometry/model.js";
import {summarize} from "../src/features/dxf/model.js";

export const poly = (layer, pts, closed) => ({layer, closed, pts, shapes: [curve(pts, closed)], snap: pts.map(q => q.slice())});
export const lineP = (layer, a, b) => ({layer, closed: false, pts: [a, b], shapes: [line(point(...a), point(...b))], snap: [a, b]});

/* 100 × 60 cut line, seam 6 mm inside it, a notch at (30,0) on the bottom, a grade point at
   (20,30) touching nothing, and a grainline that either reaches the bottom and top ("touch"),
   sits inside ("inside"), or is left out (null) */
export function rectPiece({grain = "touch"} = {}){
  const paths = [poly("1", [[0, 0], [100, 0], [100, 60], [0, 60]], true),
                 poly("8", [[6, 6], [94, 6], [94, 54], [6, 54]], true)];
  if(grain === "touch") paths.push(lineP("7", [50, 0], [50, 60]));
  if(grain === "inside") paths.push(lineP("7", [50, 15], [50, 45]));
  return summarize({name: "R", blockName: "R", qty: "1", category: "", texts: [], paths,
    points: [{layer: "4", x: 30, y: 0}, {layer: "5", x: 20, y: 30}]});
}

/* the top edge: an arc through (100,60) → (50,70) → (0,60), sampled at 21 points */
function topArc(){
  const cx = 50, r = (50*50 + 10*10)/(2*10), cy = 70 - r, pts = [];
  const a0 = Math.atan2(60 - cy, 100 - cx), a1 = Math.atan2(60 - cy, 0 - cx);
  for(let i = 0; i <= 20; i++){ const a = a0 + (a1 - a0)*i/20; pts.push([cx + r*Math.cos(a), cy + r*Math.sin(a)]); }
  return pts;
}
/* a 100 × 60 piece whose top is that arc, a notch at (30,0), a grainline inside */
export function testPiece(){
  const ring = [[0, 0], [100, 0], ...topArc()];
  return summarize({name: "T", blockName: "T", qty: "1", category: "", texts: [],
    paths: [{layer: "1", closed: true, pts: ring, shapes: [curve(ring, true)], snap: ring},
            lineP("7", [50, 15], [50, 45])],
    points: [{layer: "4", x: 30, y: 0}]});
}
