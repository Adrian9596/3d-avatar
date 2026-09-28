/* Point-to-Point (Straight) — spec: point_to_point.md.

   The measurement AccuMark calls *Straight*: pick two defined points on a piece, read
   the distance between them. It is deliberately blind to the pattern lines — no path,
   no geometry in between, no question of which side you walk around. That blindness is
   the whole point, and it is what separates this from Along Path (along_path.md), where
   the same two points can be 100 mm apart in a straight line and 240 mm apart along the
   seam. A pattern needs both numbers, and must never confuse one for the other.

   Everything here is in millimetres of world space, so the number never depends on zoom
   (CLAUDE.md §5.17). */
import {point, checkPoint} from "./model.js";

/* dx and dy come back alongside the distance: they are what tells you whether two
   points are square to each other, which a single length cannot. */
export function straight(a, b){
  /* NaN, ∞, a missing y or an [x, y] array would all come out as a NaN distance — refused
     here instead, because a readout that prints NaN is the lucky case (spec A7) */
  checkPoint(a, "điểm A"); checkPoint(b, "điểm B");
  const dx = b.x - a.x, dy = b.y - a.y;
  return {distance: Math.hypot(dx, dy), dx, dy, from: point(a.x, a.y), to: point(b.x, b.y)};
}

/* Nearest defined point to a click, or null when nothing is close enough.

   Takes plain [x, y] pairs rather than shape objects, because that is what a piece
   carries (POINT entities and polyline vertices) and converting the whole list on every
   pointer move would be waste. `tol` is a RADIUS in mm — the caller turns screen pixels
   into mm, so the kernel never learns what a pixel is. Returning null rather than the
   nearest-at-any-distance is deliberate: a click far from every point is a free
   measurement, and the tool has to be able to say so. */
export function nearestPoint(pts, w, tol){
  let best = null;
  for(let i = 0; i < pts.length; i++){
    const d = Math.hypot(pts[i][0] - w[0], pts[i][1] - w[1]);
    if(d <= tol && (!best || d < best.dist)) best = {point: pts[i], dist: d, index: i};
  }
  return best;
}
