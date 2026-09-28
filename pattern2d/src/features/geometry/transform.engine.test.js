/* Measure Engine · Transform — rigid motions of the geometry
   (spec: src/features/measure/measure_engine.md §5; the view side — zoom, pan, resize —
   is in canvas/view.engine.test.js).

   A rigid motion must not change a measurement. The anchors are moved with plain
   trigonometry written here, not with the kernel's matrix: if the kernel rotated the shape
   wrongly the anchors would fall off it, and offPath would say so. */
import {mcase} from "../../../tests/engine.js";
import {point, line, arc, length, transform, rotation, matrix, translation} from "./model.js";
import {chain, alongPath} from "./path.js";
import {straight} from "./straight.js";
/* spline.js is new: a missing module must fail these cases, not the whole test run */
const {spline} = await import("./spline.js").catch(e => { if(e.code === "ERR_MODULE_NOT_FOUND") return {}; throw e; });

const G = "Transform", PI = Math.PI, P = (x, y) => point(x, y);
const stadium = () => [line(P(0, 0), P(200, 0)), arc(P(200, 50), 50, -PI/2, PI/2, true),
                       line(P(200, 100), P(0, 100)), arc(P(0, 50), 50, PI/2, 3*PI/2, true)];
const turn = (q, ang, o) => { const c = Math.cos(ang), s = Math.sin(ang), x = q[0] - o[0], y = q[1] - o[1];
                              return [o[0] + c*x - s*y, o[1] + s*x + c*y]; };
function measured(m, mapPt){
  const ch = chain(stadium().map(s => transform(s, m)));
  const r = alongPath(ch, P(...mapPt([50, 0])), P(...mapPt([50, 100])));
  return [ch.total, r.distance, r.offPath];
}
const WANT = [400 + 100*PI, 100 + 50*PI, 0];

mcase({id: "TRF-07", group: G, kind: "N", what: "xoay 37° quanh (13, −8): [chu vi, lối ngắn, offPath]", expect: WANT, tol: 1e-9,
       source: "tay: bất biến khi xoay"}, () => measured(rotation(37*PI/180, 13, -8), q => turn(q, 37*PI/180, [13, -8])));
mcase({id: "TRF-08", group: G, kind: "N", what: "gương qua trục y: [chu vi, lối ngắn, offPath]", expect: WANT, tol: 1e-9,
       source: "tay: bất biến khi lật"}, () => measured(matrix(-1, 0, 0, 1, 0, 0), q => [-q[0], q[1]]));
mcase({id: "TRF-09", group: G, kind: "N", what: "tịnh tiến (1234.5, −987.6): [chu vi, lối ngắn, offPath]", expect: WANT, tol: 1e-9,
       source: "tay"}, () => measured(translation(1234.5, -987.6), q => [q[0] + 1234.5, q[1] - 987.6]));
mcase({id: "TRF-10", group: G, kind: "B", what: "xoay đường tròn đủ vòng 1 rad: [kín, chu vi]", expect: [true, 60*PI], tol: 1e-9,
       source: "tay"}, () => { const ch = chain([transform(arc(P(0, 0), 30, 0, 2*PI, true), rotation(1, 5, 5))]); return [ch.closed, ch.total]; });
mcase({id: "TRF-11", group: G, kind: "N", what: "xoay NURBS ¼ đường tròn 2 rad", expect: 50*PI, tol: 1e-6,
       source: "tay"}, () => length(transform(spline({degree: 2, knots: [0, 0, 0, 1, 1, 1],
         ctrl: [[100, 0], [100, 100], [0, 100]], weights: [1, Math.SQRT1_2, 1]}), rotation(2, -40, 7))));
mcase({id: "TRF-12", group: G, kind: "B", what: "xoay đủ 360°: Straight không đổi", expect: Math.hypot(173.2, 41.9), tol: 1e-9,
       source: "tay"}, () => {
  const m = rotation(2*PI, 50, 50);
  const a = transform(P(10, 10), m), b = transform(P(183.2, 51.9), m);
  return straight(a, b).distance;
});
