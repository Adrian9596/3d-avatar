/* Snap — does a point land on something within a tolerance (spec: shared/units.md §3).

   TD, 2026-09-23: "khoảng cách Snap được tính bằng chính đơn vị của bản vẽ" — the tolerance is
   a DISTANCE in the drawing (0.02 in for an inch file, 0.5 mm for a mm file), handed in here
   already in millimetres, never a count of pixels. So the same point snaps the same way at any
   zoom, any window size, any display unit — the kernel never learns what a pixel is (§5.17).

   Points win over lines: a notch or a vertex is what a pattern maker means, the line under it
   only where there is no point. `tol === null` means the drawing has no unit to measure a
   tolerance in (the file declared none): then nothing snaps — guessing one would be a guess. */
import {point, closestPoint, looseBox, boxGap} from "./model.js";
import {nearestPoint} from "./straight.js";

/* w: [x, y] mm · points: [[x, y]] · shapes: kernel shapes · tol: mm, or null for "no snap" */
export function snapTo(w, {points = [], shapes = []} = {}, tol){
  if(!Array.isArray(w) || !Number.isFinite(w[0]) || !Number.isFinite(w[1]))
    throw new Error(`điểm bấm không hợp lệ: ${JSON.stringify(w)}`);
  const free = {point: [w[0], w[1]], kind: "free", dist: null, index: -1};
  if(tol === null || tol === undefined) return free;
  if(typeof tol !== "number" || !Number.isFinite(tol) || tol < 0)
    throw new Error(`dung sai snap không hợp lệ: ${tol} — cần một khoảng cách ≥ 0`);

  const p = nearestPoint(points, w, tol);
  if(p) return {point: [p.point[0], p.point[1]], kind: "point", dist: p.dist, index: p.index};

  /* a shape whose loose box is farther than the tolerance cannot be within it: not measured at all — on a drawing of
     10 000 splines that is nearly all of them (2026-09-24: 0.2 s a pointer move in Vẽ on 2938#齐码) */
  const q = point(w[0], w[1]);
  let best = null;
  shapes.forEach((s, index) => {
    if(boxGap(looseBox(s), w) > tol) return;
    const r = closestPoint(s, q);
    if(r.dist <= tol && (!best || r.dist < best.dist)) best = {point: [r.point.x, r.point.y], kind: "line", dist: r.dist, index};
  });
  return best || free;
}
