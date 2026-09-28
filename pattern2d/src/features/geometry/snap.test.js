/* Snap — the same answer as looking at every shape, only faster (spec: shared/units.md §3).
   snapTo now asks each shape's loose box first and measures only the shapes whose box comes within the tolerance:
   the expected answer here is this file's own scan of EVERY shape, points first, then the nearest line. */
import {test, eq, ok} from "../../../tests/harness.js";
import {snapTo} from "./snap.js";
import {point, line, arc, curve, closestPoint} from "./model.js";
import {spline} from "./spline.js";

let seed = 12345;
const rnd = () => { seed = (seed*1103515245 + 12345) % 2147483648; return seed/2147483648; };
function scan(w, pts, shapes, tol){
  let bp = null;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - w[0], p[1] - w[1]); if(d <= tol && (!bp || d < bp.d)) bp = {d, i}; });
  if(bp) return {kind: "point", index: bp.i};
  let bs = null;
  shapes.forEach((s, i) => { const d = closestPoint(s, point(w[0], w[1])).dist; if(d <= tol && (!bs || d < bs.d)) bs = {d, i}; });
  return bs ? {kind: "line", index: bs.i} : {kind: "free", index: -1};
}

test("snapTo = a scan of every point and every shape: lines, arcs, polylines, splines, 400 clicks, two tolerances", () => {
  const shapes = [];
  for(let k = 0; k < 60; k++){
    const x = rnd()*300, y = rnd()*300;
    shapes.push(line(point(x, y), point(x + rnd()*40 - 20, y + rnd()*40 - 20)));
    shapes.push(arc(point(x, y), 3 + rnd()*20, rnd()*6, rnd()*6, rnd() < 0.5));
    shapes.push(curve([[x, y], [x + rnd()*20, y + rnd()*5], [x + rnd()*30, y + rnd()*25]], rnd() < 0.3));
    shapes.push(spline({degree: 3, knots: [0, 0, 0, 0, 1, 1, 1, 1], ctrl: [[x, y], [x + rnd()*30, y + rnd()*30], [x + rnd()*30, y - rnd()*30], [x + rnd()*40, y]]}));
  }
  const pts = [];
  for(let k = 0; k < 40; k++) pts.push([rnd()*300, rnd()*300]);
  let hits = 0;
  for(const tol of [0.5, 5]) for(let k = 0; k < 200; k++){
    /* half the clicks close to a shape, where a snap is likely */
    const s = shapes[Math.floor(rnd()*shapes.length)], near = closestPoint(s, point(rnd()*300, rnd()*300)).point;
    const w = k % 2 ? [near.x + rnd()*2*tol - tol, near.y + rnd()*2*tol - tol] : [rnd()*300, rnd()*300];
    const got = snapTo(w, {points: pts, shapes}, tol), want = scan(w, pts, shapes, tol);
    eq(`${got.kind}:${got.index}`, `${want.kind}:${want.index}`, `click ${w.map(v => v.toFixed(3))} tol ${tol}`);
    if(got.kind !== "free") hits++;
  }
  ok(hits > 100, `đủ lần hít để phép so có nghĩa (${hits})`);
});
