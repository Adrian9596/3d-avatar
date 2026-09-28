/* Layer 1 — Select: what the pointer is on (spec: edit/edit.md §2).

   Four kinds of thing, in the order a click prefers them: a POINT (a POINT entity, a corner of
   a line, the end of an open one), a LINE or a CURVE (an edge between two corners — straight
   to within 0.01 mm, or not), a PIECE. The corners are the ones Edges prints
   (geometry/corners.js), plus the splits and minus the joins made in this session, which the
   path carries as `pin` / `unpin` vertex indices.

   Everything is in millimetres; the pick radius arrives already divided by the zoom — it is
   a screen distance on purpose (choosing, not snapping: shared/units.md S5). Nothing here
   changes a path. */
import {closestPoint, point} from "../geometry/model.js";
import {cornerIndices} from "../geometry/corners.js";
import {isStraight, edgeRange} from "../geometry/deform.js";
import {hitPiece} from "../pieces/hit.js";

/* The vertices Edit edits a path by: its polyline's (normalised: no repeated vertex) or its
   LINE's two ends. An arc, circle, spline or bulged polyline has none — it moves as one shape. */
export function vertsOf(path){
  const sh = path && path.shapes;
  if(!sh || sh.length !== 1) return null;
  if(sh[0].kind === "curve") return sh[0].pts;
  if(sh[0].kind === "line") return [[sh[0].a.x, sh[0].a.y], [sh[0].b.x, sh[0].b.y]];
  return null;
}
export const isRing = path => !!path.closed && (vertsOf(path) || []).length > 2;

/* corners as Edit sees them, sorted */
export function cornersOf(path){
  const v = vertsOf(path);
  if(!v) return [];
  const pin = new Set(path.pin || []), unpin = new Set(path.unpin || []);
  const cs = new Set(cornerIndices(v, isRing(path)));
  for(const i of pin) if(i >= 0 && i < v.length) cs.add(i);
  for(const i of unpin) cs.delete(i);
  if(!isRing(path)){ cs.add(0); cs.add(v.length - 1); }             // the ends of an open line always stay
  return [...cs].sort((a, b) => a - b);
}

/* the edges between neighbouring corners: {a, b, kind, pts}; an exact curve is one whole edge */
export function edgesOf(path){
  const v = vertsOf(path);
  if(!v) return [{kind: "curve", whole: true, a: null, b: null}];
  const cs = cornersOf(path), ring = isRing(path), n = v.length;
  if(ring && cs.length < 2){
    const a = cs.length ? cs[0] : 0, idx = [...edgeRange(n, true, (a + 1) % n, a)];
    return [{kind: "curve", a, b: a, loop: true, pts: [v[a], ...idx.map(i => v[i])]}];
  }
  const pairs = ring ? cs.map((a, j) => [a, cs[(j + 1) % cs.length]]) : cs.slice(0, -1).map((a, j) => [a, cs[j + 1]]);
  const straightEntity = path.shapes[0].kind === "line";
  return pairs.map(([a, b]) => {
    const pts = edgeRange(n, ring, a, b).map(i => v[i]);
    return {kind: straightEntity || isStraight(pts, 0.01) ? "line" : "curve", a, b, pts};
  });
}

/* everything of a piece a click may land on, for the layers that are on */
export function targetsOf(piece, layersOn){
  const points = [], edges = [];
  (piece.points || []).forEach((q, j) => { if(layersOn[q.layer]) points.push({kind: "point", src: "entity", pt: j, at: [q.x, q.y]}); });
  (piece.paths || []).forEach((path, i) => {
    if(!layersOn[path.layer]) return;
    const v = vertsOf(path);
    if(v) for(const c of cornersOf(path)) points.push({kind: "point", src: "vertex", path: i, v: c, at: v[c]});
    for(const e of edgesOf(path)) edges.push({...e, path: i});
  });
  return {points, edges};
}

/* distance from w to a polyline, a plain loop over its segments */
function toPolyline(pts, w){
  let best = Infinity;
  for(let i = 1; i < pts.length; i++){
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], dd = dx*dx + dy*dy;
    const t = dd ? Math.max(0, Math.min(1, ((w[0] - a[0])*dx + (w[1] - a[1])*dy)/dd)) : 0;
    best = Math.min(best, Math.hypot(w[0] - a[0] - dx*t, w[1] - a[1] - dy*t));
  }
  return best;
}
const edgeDist = (piece, e, w) => e.whole
  ? Math.min(...piece.paths[e.path].shapes.map(s => closestPoint(s, point(w[0], w[1])).dist))
  : toPolyline(e.pts, w);

/* The thing under w within `radius` mm: {pi, item, dist}, or null. filter: "all" · "piece" ·
   "line" · "point" · "curve", or "edge" (a Line or a Curve — what trim, extend and split act
   on). `grips` are extra point targets (the inner vertices of a curve being edited), picked
   before anything else. `targets` lets the caller hand in a cached targetsOf. */
export function pickAt(pieces, layersOn, w, radius, {filter = "all", grips = [], targets = p => targetsOf(p, layersOn)} = {}){
  const want = k => filter === "all" || filter === k || (filter === "edge" && (k === "line" || k === "curve"));
  const d = at => Math.hypot(at[0] - w[0], at[1] - w[1]);
  if(want("point")){
    let best = null;
    for(const g of grips){ const dist = d(g.at); if(dist <= radius && (!best || dist < best.dist)) best = {pi: g.pi, item: g, dist}; }
    if(best) return best;
    pieces.forEach((p, pi) => {
      for(const t of targets(p).points){
        const dist = d(t.at);
        if(dist <= radius && (!best || dist < best.dist)) best = {pi, item: {...t, pi}, dist};
      }
    });
    if(best) return best;
  }
  if(want("line") || want("curve")){
    let best = null;
    pieces.forEach((p, pi) => {
      for(const e of targets(p).edges){
        if(!want(e.kind)) continue;
        const dist = edgeDist(p, e, w);
        if(dist <= radius && (!best || dist < best.dist)) best = {pi, item: {...e, pi, click: [w[0], w[1]]}, dist};
      }
    });
    if(best) return best;
  }
  if(want("piece")){
    const pi = hitPiece(pieces, w, radius);
    if(pi >= 0) return {pi, item: {kind: "piece", pi}, dist: 0};
  }
  return null;
}
