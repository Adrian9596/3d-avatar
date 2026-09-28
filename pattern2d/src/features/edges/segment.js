/* Splitting an outline into the edges a pattern maker would name (spec: edges/edges.md).
   Pure geometry — the numbers the readout prints come from here. Where the corners are is
   decided by geometry/corners.js, the same function Edit selects edges with, so an edge Edges
   labels and an edge Edit picks up are one and the same (edit/edit.md §2). */
import {plen} from "../../shared/geom.js";
import {cornerIndices} from "../geometry/corners.js";

/* edge segmentation — direction change measured over a window in MILLIMETRES,
   because DXF vertices are spaced very unevenly (a straight edge has 2 points).
   `closed`: a ring (the cut and sewing lines always are); an open line has no closing edge (G3). */
export function segmentEdges(poly, win = 7, thresh = 26, minEdge = 12, closed = true){
  if(!closed) return openEdges(poly, win, thresh, minEdge);
  if(poly.length < 8) return smallRing(poly, thresh);
  const corners = cornerIndices(poly, true, {win, thresh, minEdge});
  if(!corners.length) return [whole(poly)];
  return ringEdges(poly, corners);
}

/* the ring closed back on its first vertex, as one edge */
const whole = ring => { const pts = ring.concat(ring.length ? [ring[0]] : []); return {pts, len: plen(pts)}; };

/* corner a to the next corner b, walking forward — all the way round when a ring has one corner (b === a):
   an edge of length 0 there is a ring's whole outline measured as nothing (H4) */
function ringEdges(poly, corners){
  const n = poly.length;
  return corners.map((a, j) => {
    const b = corners[(j + 1) % corners.length], pts = [poly[a]];
    for(let t = (a + 1) % n;; t = (t + 1) % n){ pts.push(poly[t]); if(t === b) break; }
    return {pts, len: plen(pts)};
  });
}

/* the vertices once each: a vertex repeated in a row, or a ring's first repeated as its last, is one point —
   counted twice it would be a corner twice, with an edge of length 0 between */
function distinct(poly, closed){
  const out = [];
  for(const q of poly) if(!out.length || Math.hypot(q[0] - out[out.length - 1][0], q[1] - out[out.length - 1][1]) > 1e-9) out.push(q);
  while(closed && out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-9) out.pop();
  return out;
}

/* A ring of fewer than 8 vertices — a strap, a loop, a label drawn as a rectangle — has no room for the
   window: every vertex turning by more than `thresh` is a corner, as corners.js reads it for Edit. It used to
   be one edge as long as the OPEN path, its closing side missing (H3: 113 library pieces) */
function smallRing(poly, thresh){
  const ring = distinct(poly, true);
  if(ring.length < 3) return [whole(ring)];
  const corners = cornerIndices(ring, true, {thresh});
  return corners.length ? ringEdges(ring, corners) : [whole(ring)];
}

/* an open line: its ends and the elbows between them, no closing edge */
function openEdges(poly, win, thresh, minEdge){
  const pts = distinct(poly, false);
  if(pts.length < 2) return [{pts, len: 0}];
  const cs = cornerIndices(pts, false, {win, thresh, minEdge});
  return cs.slice(0, -1).map((a, j) => { const s = pts.slice(a, cs[j + 1] + 1); return {pts: s, len: plen(s)}; });
}

/* Where an edge's label goes (G5): the point half its length along it, and the direction of the edge there —
   not its middle vertex by index, which on a straight edge of two vertices is a CORNER (H6: 649 of 1934
   library edges) and on an unevenly sampled curve is anywhere */
export function edgeLabelAt(pts){
  const half = plen(pts)/2;
  let acc = 0;
  for(let i = 1; i < pts.length; i++){
    const a = pts[i - 1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if(d > 0 && acc + d >= half){
      const t = (half - acc)/d;
      return {at: [a[0] + (b[0] - a[0])*t, a[1] + (b[1] - a[1])*t], dir: [(b[0] - a[0])/d, (b[1] - a[1])/d]};
    }
    acc += d;
  }
  return {at: pts.length ? [pts[0][0], pts[0][1]] : [0, 0], dir: [1, 0]};
}

/* A … Z, AA, AB … — a piece of 30 corners does not run into "[" and "\" after Z */
export function edgeLetter(j){
  let s = "";
  for(let k = j + 1; k > 0; k = Math.floor((k - 1)/26)) s = String.fromCharCode(65 + (k - 1) % 26) + s;
  return s;
}
