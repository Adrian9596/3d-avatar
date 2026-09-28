/* --- tick marks ------------------------------------------------------------------
   A short mark across a level or tape, `offset_in` along it from its centre back
   (or centre front) on each side (walked on the section, as a tape measures). The mark
   stands upright across the (horizontal) tape: it is the vertical cut through
   the point, x = const, followed on the skin half its length up and half down,
   so from the front or the back it reads square to the tape however the chest
   curves there. -------------------------------------------------------------------- */

import { sectionSegments } from '../../core/measure_core.mjs';
import { verticalSegments, backCrossing, walkContour, byLength, polylineLength } from './contour.mjs';
import { METRES_PER_INCH } from './units.mjs';

/** Validate the contract's `ticks` against the valid heights. Returns the valid ticks. */
export function validateTicks(contract, { errors, heightIds, shapeIds, lines }) {
  // Tick marks across a level or tape, a distance either side of centre back.
  const ticks = [];
  for (const tick of contract?.ticks || []) {
    const problems = [];
    if (!tick.id || heightIds.has(tick.id) || shapeIds.has(tick.id) || lines.some((l) => l.id === tick.id) || ticks.some((t) => t.id === tick.id)) problems.push('missing or duplicate id');
    if (!heightIds.has(tick.on)) problems.push(`on ${tick.on} is not a valid level or reference tape`);
    if (!['centre_back', 'centre_front'].includes(tick.anchor)) problems.push(`unknown anchor ${tick.anchor}`);
    if (!(Number.isFinite(tick.offset_in) && tick.offset_in > 0)) problems.push('offset_in must be a positive number');
    if (!(Number.isFinite(tick.length_mm) && tick.length_mm > 0)) problems.push('length_mm must be a positive number');
    if (!/^#[0-9a-f]{6}$/i.test(tick.colour || '')) problems.push('colour must be #rrggbb');
    if (problems.length) errors.push(`${tick.id || '?'}: ${problems.join('; ')}`);
    else ticks.push(tick);
  }
  return ticks;
}

export function measureTick(tick, heights, tri) {
  const y = heights[tick.on];
  if (!Number.isFinite(y)) return { ...tick, blocked: `needs ${tick.on}`, marks: [] };
  const section = sectionSegments(tri, y);
  const front = tick.anchor === 'centre_front';
  const cb = backCrossing(section, 0, front);
  if (!cb) return { ...tick, blocked: `no ${front ? 'centre front' : 'centre back'} on that section`, marks: [] };
  const along = tick.offset_in * METRES_PER_INCH;
  const half = tick.length_mm / 2000;
  const marks = [];
  for (const side of ['L', 'R']) {
    const walked = walkContour(section, cb, (a, b) => (side === 'R' ? a[0] > b[0] : a[0] < b[0]), byLength(along));
    if (!walked) return { ...tick, blocked: `the section ends before ${tick.offset_in}in on the ${side} side`, marks: [] };
    const [x, z] = walked[walked.length - 1];
    const point = [x, y, z];
    // upright on the skin: half the length each way in the plane x = const
    const vertical = verticalSegments(tri, x);
    const up = walkContour(vertical, [y, z], (a, b) => a[0] > b[0], byLength(half));
    const down = walkContour(vertical, [y, z], (a, b) => a[0] < b[0], byLength(half));
    if (!up || !down) return { ...tick, blocked: `no skin across the tape on the ${side} side`, marks: [] };
    const points = [...down.slice().reverse(), ...up.slice(1)].map(([vy, vz]) => [x, vy, vz]);
    marks.push({
      side,
      point,
      arc_m: polylineLength(walked.map(([wx, wz]) => [wx, y, wz])),
      length_m: polylineLength(points),
      points,
    });
  }
  return { ...tick, blocked: null, y_m: y, anchor_point: [0, y, cb[1]], marks };
}

/** Every declared tick, on the heights of the measured levels and tapes. */
export function measureTicks(loaded, measured, tapes, tri) {
  const heights = {};
  for (const l of measured?.levels || []) heights[l.id] = l.y_m;
  for (const t of tapes || []) heights[t.id] = t.y_m;
  return (loaded.ticks || []).map((tick) => measureTick(tick, heights, tri));
}
