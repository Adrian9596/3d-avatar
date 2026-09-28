/* --- centre-back and centre-front lines -----------------------------------------
   Straight down the back (or up the front): the body cut by the centre plane
   x = 0, followed on the skin from the centre back (front) of one height to the
   centre back (front) of the other. The length is along the skin, the way a tape
   laid down the spine (or the breastbone) reads it; the straight chord between
   the ends is reported beside it. The back is walked down from its upper end;
   the front is walked up from its lower end, below the breasts, where the centre
   front of a section is plain skin whatever the cleavage does above. Either way
   the points run top first. ----------------------------------------------------- */

import { sectionSegments } from '../../core/measure_core.mjs';
import { verticalSegments, backCrossing, walkContour, byCoordinate, polylineLength } from './contour.mjs';

/** Validate the contract's `lines` against the valid heights. Returns the valid lines. */
export function validateLines(contract, { errors, heightIds, shapeIds, planePoms }) {
  // Lines join two of the heights above (a level or a reference tape), or a
  // plane-section POM's own height (the largest girth, say), straight down the
  // centre back or straight up the centre front.
  const lines = [];
  for (const line of contract?.lines || []) {
    const problems = [];
    if (!line.id || heightIds.has(line.id) || shapeIds.has(line.id) || lines.some((l) => l.id === line.id)) problems.push('missing or duplicate id');
    if (!['centre_back', 'centre_front'].includes(line.kind)) problems.push(`unknown kind ${line.kind}`);
    for (const end of ['from', 'to']) if (!heightIds.has(line[end]) && !planePoms.has(line[end])) problems.push(`${end} ${line[end]} is not a valid level, reference tape or plane-section POM`);
    if (line.from === line.to) problems.push('from and to are the same height');
    if (typeof line.label !== 'string' || !line.label) problems.push('label must be a string');
    if (problems.length) errors.push(`${line.id || '?'}: ${problems.join('; ')}`);
    else lines.push(line);
  }
  return lines;
}

export function measureLine(line, heights, tri) {
  const ys = [heights[line.from], heights[line.to]];
  if (!ys.every(Number.isFinite)) return { ...line, blocked: `needs ${[line.from, line.to].filter((id) => !Number.isFinite(heights[id])).join(', ')}`, points: [] };
  const [yTop, yBottom] = ys[0] >= ys[1] ? ys : [ys[1], ys[0]];
  const centre = verticalSegments(tri, 0);
  let walked;
  if (line.kind === 'centre_front') {
    const cf = backCrossing(sectionSegments(tri, yBottom), 0, true);
    if (!cf) return { ...line, blocked: 'no centre front at the lower end', points: [] };
    const up = walkContour(centre, [yBottom, cf[1]], (a, b) => a[0] > b[0], byCoordinate(0, yTop));
    if (!up) return { ...line, blocked: 'the front ends before the upper end', points: [] };
    walked = up.reverse();
  } else {
    const cb = backCrossing(sectionSegments(tri, yTop), 0);
    if (!cb) return { ...line, blocked: 'no centre back at the upper end', points: [] };
    walked = walkContour(centre, [yTop, cb[1]], (a, b) => a[0] < b[0], byCoordinate(0, yBottom));
    if (!walked) return { ...line, blocked: 'the back ends before the lower end', points: [] };
  }
  const points = walked.map(([y, z]) => [0, y, z]);
  const top = points[0], bottom = points[points.length - 1];
  return {
    ...line,
    blocked: null,
    y_top_m: yTop,
    y_bottom_m: yBottom,
    top,
    bottom,
    length_m: polylineLength(points),
    chord_m: Math.hypot(top[1] - bottom[1], top[2] - bottom[2]),
    points,
  };
}

/** Every declared line, with the heights of the measured levels and tapes, and
 *  `poms` (a POM id to its y) for a line that ends on a POM's own height. */
export function measureLines(loaded, measured, tapes, tri, poms = {}) {
  const heights = { ...poms };
  for (const l of measured?.levels || []) heights[l.id] = l.y_m;
  for (const t of tapes || []) heights[t.id] = t.y_m;
  return (loaded.lines || []).map((line) => measureLine(line, heights, tri));
}
