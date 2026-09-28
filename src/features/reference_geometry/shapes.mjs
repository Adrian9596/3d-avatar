/* --- reference shapes --------------------------------------------------------
   A rectangle laid on the skin the way a tape would lay it: every side is
   measured along the surface, not across it. The bottom edge runs along the
   level's own section, half the width each way from the centre-back point;
   the sides run straight up the back in the vertical planes through those two
   corners for the height; the top edge follows the section at the height the
   sides reach. On a mirrored body both sides reach the same height. The top
   edge is not forced to the width: its measured length is reported, so a back
   that narrows says so. ------------------------------------------------------ */

import { sectionSegments } from '../../core/measure_core.mjs';
import { verticalSegments, backCrossing, walkContour, byLength, byCoordinate, polylineLength } from './contour.mjs';
import { METRES_PER_INCH } from './units.mjs';

/** Validate the contract's `shapes` against the valid levels. Returns the valid
 *  shapes and every shape id seen. */
export function validateShapes(contract, { errors, ids, levels }) {
  // Reference shapes hang on a level the way the tapes do; a shape on a level
  // that did not validate has nothing to stand on and drops out with it.
  const shapes = [];
  const shapeIds = new Set();
  for (const shape of contract?.shapes || []) {
    const problems = [];
    if (!shape.id || shapeIds.has(shape.id) || ids.has(shape.id)) problems.push('missing or duplicate id');
    shapeIds.add(shape.id);
    if (shape.kind !== 'rectangle') problems.push(`unknown kind ${shape.kind}`);
    if (!levels.some((l) => l.id === shape.level)) problems.push(`level ${shape.level} is not a valid level`);
    if (shape.anchor !== 'centre_back') problems.push(`unknown anchor ${shape.anchor}`);
    for (const key of ['width_in', 'height_in']) {
      if (!(Number.isFinite(shape[key]) && shape[key] > 0)) problems.push(`${key} must be a positive number`);
    }
    if (problems.length) errors.push(`${shape.id || '?'}: ${problems.join('; ')}`);
    else shapes.push(shape);
  }
  return { shapes, shapeIds };
}

/** One reference rectangle on this body, from a measured level. Returns
 *  { outline: closed [x,y,z] polyline, corners, top_width_m, ... } or
 *  { blocked } with the reason. */
export function measureShape(shape, level, tri) {
  const base = { ...shape, width_m: shape.width_in * METRES_PER_INCH, height_m: shape.height_in * METRES_PER_INCH };
  if (!level || !Number.isFinite(level.y_m)) return { ...base, blocked: `level ${shape.level} is not on this body` };
  const y0 = level.y_m;
  const half = base.width_m / 2;
  const bottom = sectionSegments(tri, y0);
  const cb = backCrossing(bottom, 0);
  if (!cb) return { ...base, blocked: 'no centre back on the level section' };
  // bottom edge: half the width each way along the section from centre back
  const toR = walkContour(bottom, cb, (a, b) => a[0] > b[0], byLength(half));
  const toL = walkContour(bottom, cb, (a, b) => a[0] < b[0], byLength(half));
  if (!toR || !toL) return { ...base, blocked: 'the level section ends before the bottom corners' };
  const side = (corner) => {
    const up = walkContour(verticalSegments(tri, corner[0]), [y0, corner[1]], (a, b) => a[0] > b[0], byLength(base.height_m));
    return up ? up.map(([y, z]) => [corner[0], y, z]) : null;
  };
  const sideR = side(toR[toR.length - 1]);
  const sideL = side(toL[toL.length - 1]);
  if (!sideR || !sideL) return { ...base, blocked: 'the back ends before the height' };
  const topR = sideR[sideR.length - 1], topL = sideL[sideL.length - 1];
  const y1 = (topR[1] + topL[1]) / 2;
  const top = sectionSegments(tri, y1);
  const cbTop = backCrossing(top, 0);
  const topToR = cbTop && walkContour(top, cbTop, (a, b) => a[0] > b[0], byCoordinate(0, topR[0]));
  const topToL = cbTop && walkContour(top, cbTop, (a, b) => a[0] < b[0], byCoordinate(0, topL[0]));
  if (!topToR || !topToL) return { ...base, blocked: 'no top edge at the height the sides reach' };
  const at = (y) => ([x, z]) => [x, y, z];
  const bottomEdge = [...toL.slice().reverse(), ...toR.slice(1)].map(at(y0));
  const topEdge = [...topToL.slice().reverse(), ...topToR.slice(1)].map(at(y1));
  const outline = [...bottomEdge, ...sideR.slice(1), ...topEdge.slice().reverse().slice(1), ...sideL.slice().reverse().slice(1)];
  return {
    ...base,
    blocked: null,
    y_bottom_m: y0,
    y_top_m: y1,
    corners: { bottom_l: bottomEdge[0], bottom_r: bottomEdge[bottomEdge.length - 1], top_r: topEdge[topEdge.length - 1], top_l: topEdge[0] },
    centre_back: [0, y0, cb[1]],
    bottom_width_m: polylineLength(bottomEdge),
    top_width_m: polylineLength(topEdge),
    side_height_m: { l: polylineLength(sideL), r: polylineLength(sideR) },
    outline,
  };
}

/** Every declared shape on the measured levels. */
export function measureShapes(loaded, measured, tri) {
  if (!measured || measured.needs) return [];
  return (loaded.shapes || []).map((shape) => measureShape(shape, measured.levels.find((l) => l.id === shape.level), tri));
}
