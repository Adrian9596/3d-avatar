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
   so there is one dot, not a pair.
   An "on_curve" point is a dot on each side's run of a curve (the cup armhole,
   say), `along_in` along it from one of its ends (`end`: "from" or "to"). It
   rides on the curve: whenever the curve is reshaped it is measured again, the
   same distance along. A curve is measured after the points it passes through,
   so these are measured once the curves are (measureCurvePoints). ------------------ */

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
    } else if (point.kind === 'on_curve') {
      // curves are validated after the points (they may pass through one), so this names a declared curve;
      // one that does not validate leaves the dot blocked when it is measured
      if (!(contract?.curves || []).some((c) => c.id === point.curve)) problems.push(`curve ${point.curve} is not a declared curve`);
      if (!['from', 'to'].includes(point.end)) problems.push(`end ${point.end} is not from or to (the end of the curve it is measured from)`);
      if (!Number.isFinite(point.along_in) || point.along_in < 0) problems.push('along_in must be a number of inches, 0 or more, along the curve from that end');
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

// The point `distance` along a polyline from its first point (its last point, past the end).
function pointAlong(path, distance) {
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const step = gap(path[i], path[i - 1]);
    if (walked + step >= distance) {
      const t = step > 0 ? (distance - walked) / step : 0;
      return path[i - 1].map((v, k) => v + (path[i][k] - v) * t);
    }
    walked += step;
  }
  return path[path.length - 1].slice();
}

/** An "on_line" point on its measured `line`. `offsets` ({ up_in }) overrides
 *  the contract's (a dot dragged in the viewer). The dot is where a tape laid
 *  up the line from its lower end reads `up_in`; past either end it is blocked,
 *  not moved to the end. */
export function measureLinePoint(point, line, offsets = null) {
  if (!line || line.blocked) return { ...point, blocked: `needs ${point.line}`, at: null };
  const upIn = offsets?.up_in ?? point.up_in;
  const up = upIn * METRES_PER_INCH;
  if (!(up >= 0) || up > line.length_m + 1e-9) {
    return { ...point, blocked: `${+Number(upIn).toFixed(3)}in up is past the ends of ${line.id} (${(line.length_m / METRES_PER_INCH).toFixed(2)}in long)`, at: null };
  }
  return {
    ...point, up_in: upIn, moved: Boolean(offsets), blocked: null,
    at: pointAlong(upward(line), up), up_m: up, down_m: Math.max(0, line.length_m - up), line_length_m: line.length_m,
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

/** An "on_curve" point on its measured `curve`: on each side, `along_in`
 *  along the run from the curve's `end`, on the skin, with how far on the run
 *  goes (`rest_m`) and, for a curve through a point, how far on that point is
 *  (`to_through_m`, negative if the dot is past it). Past the other end it is
 *  blocked. */
export function measureCurvePoint(point, curve) {
  if (!curve || curve.blocked || !curve.runs?.length) return { ...point, blocked: `needs ${point.curve}`, marks: [] };
  const along = point.along_in * METRES_PER_INCH;
  const marks = [];
  for (const run of curve.runs) {
    const path = point.end === 'to' ? run.points.slice().reverse() : run.points;
    const length = polylineLength(path);
    if (along > length + 1e-9) {
      return { ...point, blocked: `${point.along_in}in along is past the other end of ${point.curve} (${(length / METRES_PER_INCH).toFixed(2)}in on the ${run.side} side)`, marks: [] };
    }
    const legs = run.leg_lengths_m;
    marks.push({
      side: run.side, point: pointAlong(path, along), along_m: along, rest_m: Math.max(0, length - along),
      ...(legs ? { to_through_m: (point.end === 'to' ? legs[1] : legs[0]) - along } : {}),
    });
  }
  return { ...point, blocked: null, marks };
}

/** Every declared point; `lines` are the measured lines (measureLines), for a
 *  dot on one, and `curves` the measured curves (measureCurves), for a dot on
 *  one. Curves are measured after the points they pass through, so a dot on a
 *  curve reads `needs …` here until measureCurvePoints places it. */
export function measurePoints(loaded, landmarks, tri, offsets = {}, lines = [], curves = []) {
  return (loaded.points || []).map((point) => (point.kind === 'on_line'
    ? measureLinePoint(point, lines.find((l) => l.id === point.line), offsets[point.id] || null)
    : point.kind === 'on_curve' ? measureCurvePoint(point, curves.find((c) => c.id === point.curve))
      : measurePoint(point, landmarks, tri, offsets[point.id] || null)));
}

/** The measured `points` with each dot on a curve placed on the measured
 *  `curves`, again: after the curves are measured, or one is reshaped. */
export function measureCurvePoints(points, curves) {
  return points.map((p) => (p.kind === 'on_curve' ? measureCurvePoint(p, curves.find((c) => c.id === p.curve)) : p));
}
