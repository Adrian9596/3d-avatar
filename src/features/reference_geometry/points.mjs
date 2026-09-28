/* --- points on the skin ----------------------------------------------------------
   Two kinds. An "offset_on_skin" point is found the way a tape finds it on a
   form: from a registry landmark on each side (the wing top, say), `up_in`
   straight up the skin -- the upright cut through the landmark square to the
   body's side, x along the side and y up -- and then `forward_in` toward the
   front along the level section at the height reached. Both distances are on
   the skin, and there is one point per side.
   An "on_line" point is a dot on one of the lines (the CF line, say), `up_in`
   up it from its lower end, along the skin: what a tape laid up the line from
   that end reads. It stays on the line, and a line runs on the centre plane,
   so there is one dot, not a pair. ------------------------------------------------ */

import { sectionSegments } from '../../core/measure_core.mjs';
import { nearestOnPolyline } from '../../core/pen_snap.mjs';
import { uprightSegments, walkContour, byLength, byCoordinate, polylineLength } from './contour.mjs';
import { METRES_PER_INCH } from './units.mjs';

/** Validate the contract's `points`. Returns the valid points. */
export function validatePoints(contract, { errors, heightIds, shapeIds, lines, ticks, straps, known }) {
  // Points on the skin: an offset up and then forward from a registry landmark,
  // one per side, or a dot some way up a line.
  const points = [];
  const taken = (id) => heightIds.has(id) || shapeIds.has(id) || [lines, ticks, straps, points].some((list) => list.some((x) => x.id === id));
  for (const point of contract?.points || []) {
    const problems = [];
    if (!point.id || taken(point.id)) problems.push('missing or duplicate id');
    if (point.kind === 'offset_on_skin') {
      for (const side of ['L', 'R']) if (!known.has(`${point.from?.landmark}_${side}`)) problems.push(`from ${point.from?.landmark}_${side} is not a registry landmark`);
      for (const key of ['up_in', 'forward_in']) if (!Number.isFinite(point[key])) problems.push(`${key} must be a number of inches`);
    } else if (point.kind === 'on_line') {
      if (!lines.some((l) => l.id === point.line)) problems.push(`line ${point.line} is not a valid line`);
      if (!Number.isFinite(point.up_in) || point.up_in < 0) problems.push('up_in must be a number of inches, 0 or more, up the line from its lower end');
    } else problems.push(`unknown kind ${point.kind}`);
    if (!/^#[0-9a-f]{6}$/i.test(point.colour || '')) problems.push('colour must be #rrggbb');
    if (typeof point.label !== 'string' || !point.label) problems.push('label must be a string');
    if (problems.length) errors.push(`${point.id || '?'}: ${problems.join('; ')}`);
    else points.push(point);
  }
  return points;
}

// The nearest point of a 2D contour to `p`, and how far it is.
function onContour(segments, p) {
  let best = null, gap = Infinity;
  for (const [a, b] of segments) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    if (l2 <= 0) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    const q = [a[0] + dx * t, a[1] + dy * t], g = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (g < gap) { gap = g; best = q; }
  }
  return { point: best, gap };
}

const SNAP_M = 0.002;   // a landmark this close to the cut is on it

/** `landmarks` maps a registry id to [x, y, z]. `offsets` ({ up_in, forward_in })
 *  overrides the contract's (a point dragged in the viewer); a negative offset
 *  walks down, or back. */
export function measurePoint(point, landmarks, tri, offsets = null) {
  const missing = ['L', 'R'].map((side) => `${point.from.landmark}_${side}`).filter((id) => !Array.isArray(landmarks?.[id]));
  if (missing.length) return { ...point, blocked: `needs ${missing.join(', ')}`, marks: [] };
  const upIn = offsets?.up_in ?? point.up_in, forwardIn = offsets?.forward_in ?? point.forward_in;
  const up = upIn * METRES_PER_INCH, forward = forwardIn * METRES_PER_INCH;
  const marks = [];
  for (const side of ['L', 'R']) {
    const base = landmarks[`${point.from.landmark}_${side}`];
    // up: the upright cut through the landmark along x (the plane z = its z), as [y, s]
    const d = [Math.sign(base[0]) || 1, 0, 0];
    const cut = uprightSegments(tri, base, d);
    const start = onContour(cut, [base[1], 0]);
    if (!start.point || start.gap > SNAP_M) return { ...point, blocked: `${point.from.landmark}_${side} is not on the skin`, marks: [] };
    const rise = up !== 0 ? walkContour(cut, start.point, (a, b) => (up > 0 ? a[0] > b[0] : a[0] < b[0]), byLength(Math.abs(up))) : [start.point];
    if (!rise) return { ...point, blocked: `the skin ends before ${upIn}in up on the ${side} side`, marks: [] };
    const upPath = rise.map(([y, s]) => [base[0] + s * d[0], y, base[2]]);
    const top = upPath[upPath.length - 1];
    // forward: along the level section at that height, toward the front (+z)
    const section = sectionSegments(tri, top[1]);
    const on = onContour(section, [top[0], top[2]]);
    if (!on.point || on.gap > SNAP_M) return { ...point, blocked: `no level section through the ${side} side ${upIn}in up`, marks: [] };
    const ahead = forward !== 0 ? walkContour(section, on.point, (a, b) => (forward > 0 ? a[1] > b[1] : a[1] < b[1]), byLength(Math.abs(forward))) : [on.point];
    if (!ahead) return { ...point, blocked: `the section ends before ${forwardIn}in forward on the ${side} side`, marks: [] };
    const forwardPath = ahead.map(([x, z]) => [x, top[1], z]);
    marks.push({
      side, from: base, top, point: forwardPath[forwardPath.length - 1],
      up_m: Math.sign(up) * polylineLength(upPath), forward_m: Math.sign(forward) * polylineLength(forwardPath),
      up_path: upPath, forward_path: forwardPath,
    });
  }
  return { ...point, up_in: upIn, forward_in: forwardIn, moved: Boolean(offsets), blocked: null, marks };
}

/** The inverse, for a point dragged on the skin at `q` on one side: the
 *  { up_in, forward_in } that measurePoint walks to it -- back along the level
 *  section through q to the upright cut through the landmark, then down (or
 *  up) that cut to the landmark. Null if q is not somewhere the walk can reach. */
export function pointOffsets(point, side, q, landmarks, tri) {
  const base = landmarks?.[`${point.from.landmark}_${side}`];
  if (!Array.isArray(base) || Math.sign(q[0]) !== Math.sign(base[0])) return null;
  const section = sectionSegments(tri, q[1]);
  const on = onContour(section, [q[0], q[2]]);
  if (!on.point || on.gap > SNAP_M) return null;
  let forward = 0;
  if (Math.abs(on.point[1] - base[2]) > 1e-9) {
    const ahead = on.point[1] > base[2];
    const back = walkContour(section, on.point, (a, b) => (ahead ? a[1] < b[1] : a[1] > b[1]), byCoordinate(1, base[2]));
    if (!back) return null;
    const end = back[back.length - 1];
    if (Math.sign(end[0]) !== Math.sign(base[0])) return null;
    forward = (ahead ? 1 : -1) * polylineLength(back.map(([x, z]) => [x, q[1], z]));
  }
  const d = [Math.sign(base[0]) || 1, 0, 0];
  const cut = uprightSegments(tri, base, d);
  const start = onContour(cut, [base[1], 0]);
  if (!start.point || start.gap > SNAP_M) return null;
  let up = 0;
  if (Math.abs(q[1] - start.point[0]) > 1e-9) {
    const rising = q[1] > start.point[0];
    const walk = walkContour(cut, start.point, (a, b) => (rising ? a[0] > b[0] : a[0] < b[0]), byCoordinate(0, q[1]));
    if (!walk) return null;
    up = (rising ? 1 : -1) * polylineLength(walk.map(([y, sv]) => [sv, y, 0]));
  }
  return { up_in: up / METRES_PER_INCH, forward_in: forward / METRES_PER_INCH };
}

// A line's points run top first; a dot on it is measured up from the lower end.
const upward = (line) => line.points.slice().reverse();
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** An "on_line" point on its measured `line`. `offsets` ({ up_in }) overrides
 *  the contract's (a dot dragged in the viewer). The dot is where a tape laid
 *  up the line from its lower end reads `up_in`; past either end it is blocked,
 *  not moved to the end. */
export function measureLinePoint(point, line, offsets = null) {
  if (!line || line.blocked) return { ...point, blocked: `needs ${point.line}`, at: null };
  const upIn = offsets?.up_in ?? point.up_in;
  const up = upIn * METRES_PER_INCH;
  const path = upward(line);
  if (!(up >= 0) || up > line.length_m + 1e-9) {
    return { ...point, blocked: `${+Number(upIn).toFixed(3)}in up is past the ends of ${line.id} (${(line.length_m / METRES_PER_INCH).toFixed(2)}in long)`, at: null };
  }
  let at = path[path.length - 1].slice(), walked = 0;
  for (let i = 1; i < path.length; i++) {
    const step = gap(path[i], path[i - 1]);
    if (walked + step >= up) {
      const t = step > 0 ? (up - walked) / step : 0;
      at = path[i - 1].map((v, k) => v + (path[i][k] - v) * t);
      break;
    }
    walked += step;
  }
  return {
    ...point, up_in: upIn, moved: Boolean(offsets), blocked: null,
    at, up_m: up, down_m: Math.max(0, line.length_m - up), line_length_m: line.length_m,
  };
}

/** The inverse, for a dot dragged to `q`: the { up_in } of the point of the
 *  line nearest q, so a place beside the line (or past an end) slides to the
 *  line (or stops at that end). */
export function linePointOffsets(line, q) {
  if (!line || line.blocked || !Array.isArray(q)) return null;
  const path = upward(line);
  const near = nearestOnPolyline(path, q);
  if (!near) return null;
  let up = 0;
  for (let i = 1; i <= near.index; i++) up += gap(path[i], path[i - 1]);
  if (near.index + 1 < path.length) up += near.t * gap(path[near.index + 1], path[near.index]);
  return { up_in: Math.min(up, line.length_m) / METRES_PER_INCH };
}

/** Every declared point; `lines` are the measured lines (measureLines), for a
 *  dot on one. */
export function measurePoints(loaded, landmarks, tri, offsets = {}, lines = []) {
  return (loaded.points || []).map((point) => (point.kind === 'on_line'
    ? measureLinePoint(point, lines.find((l) => l.id === point.line), offsets[point.id] || null)
    : measurePoint(point, landmarks, tri, offsets[point.id] || null)));
}
