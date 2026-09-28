/* --- curves on the skin ------------------------------------------------------------
   The cup armhole, say: from a corner of a strap to a registry landmark on the
   same side (its _L / _R point). An end may also be an end of a line, such as
   the top of the centre-front line: on the centre plane, so both sides start
   from the same point.

   kind "shortest_surface_path": the shortest path over the skin -- the one path
   model the pen and the surface POMs use (scripts/surface_path.mjs), so the
   curve and a pen run between the same two points read the same.

   kind "tangent_curve": the curve a pattern drafter shapes with two tangent
   handles, one at each end. The shortest path is still found first; it sets
   the frame each handle is read in (0 deg = along the shortest path, positive
   = turned up, toward the shoulder, about the skin's normal) and so the
   default a handle comes back to. With both handles at 0 deg and about a third
   of the shortest path long, the curve's length is that path's to within a
   millimetre. The curve
   itself is the cubic Bezier through the ends and the handle tips, each sample
   carried onto the skin (closest point), and its length is that line on the
   skin -- what a tape laid along the drawn armhole reads. The handles are the
   contract's until someone drags them; the viewer passes its own. One handle
   pair shapes both sides, mirrored, as the body is.

   kind "control_curve": the same, shaped by one control point instead of two
   tangents. The control is a handle read at the `from` end, in the same frame
   (0 deg = along the shortest path toward the other end); its tip is the
   control point, and the curve is the quadratic Bezier from end to end bent
   toward it -- tangent at each end to the line to the control point, passing
   halfway between the control point and the middle of the chord. With the
   control at 0 deg and about half the shortest path long, the curve is close to
   that path. ------------------------------------------------------------------ */

import { surfaceRun, closestOnMesh } from '../../core/surface_path.mjs';

// The handles each shaped kind of curve carries (see the curves section).
export const HANDLE_KEYS = { tangent_curve: ['from', 'to'], control_curve: ['control'] };

/** Validate the contract's `curves` against the valid straps, lines and points.
 *  Returns the valid curves. */
export function validateCurves(contract, { errors, heightIds, shapeIds, lines, ticks, straps, points, known }) {
  // Curves on the skin, one per side, between two of: a strap corner, a registry
  // landmark (its _L / _R point), or an end of a line (on the centre plane).
  const CORNERS = ['front_inner', 'front_outer', 'back_inner', 'back_outer'];
  const endProblems = (end, name) => {
    if (end?.strap !== undefined) {
      return [
        ...(straps.some((s) => s.id === end.strap) ? [] : [`${name} strap ${end.strap} is not a valid strap`]),
        ...(CORNERS.includes(end.corner) ? [] : [`${name} corner ${end.corner} is not one of ${CORNERS.join(', ')}`]),
      ];
    }
    if (end?.line !== undefined) {
      return [
        ...(lines.some((l) => l.id === end.line) ? [] : [`${name} line ${end.line} is not a valid line`]),
        ...(['top', 'bottom'].includes(end.end) ? [] : [`${name} end ${end.end} is not top or bottom`]),
      ];
    }
    return ['L', 'R'].filter((side) => !known.has(`${end?.landmark}_${side}`)).map((side) => `${name} ${end?.landmark}_${side} is not a registry landmark`);
  };
  const curves = [];
  for (const curve of contract?.curves || []) {
    const problems = [];
    if (!curve.id || heightIds.has(curve.id) || shapeIds.has(curve.id) || lines.some((l) => l.id === curve.id) || ticks.some((t) => t.id === curve.id) || straps.some((t) => t.id === curve.id) || points.some((t) => t.id === curve.id) || curves.some((c) => c.id === curve.id)) problems.push('missing or duplicate id');
    if (!['shortest_surface_path', ...Object.keys(HANDLE_KEYS)].includes(curve.kind)) problems.push(`unknown kind ${curve.kind}`);
    for (const key of HANDLE_KEYS[curve.kind] || []) {
      const h = curve.handles?.[key];
      if (!(Number.isFinite(h?.angle_deg) && Math.abs(h.angle_deg) <= 180)) problems.push(`handles.${key}.angle_deg must be a number of degrees`);
      if (!(Number.isFinite(h?.length_mm) && h.length_mm > 0)) problems.push(`handles.${key}.length_mm must be a positive number`);
    }
    problems.push(...endProblems(curve.from, 'from'), ...endProblems(curve.to, 'to'));
    if (curve.through !== undefined && (curve.kind !== 'tangent_curve' || !points.some((p) => p.id === curve.through?.point))) problems.push(`through ${curve.through?.point} is not a valid point (and only a tangent curve passes through one)`);
    if (!/^#[0-9a-f]{6}$/i.test(curve.colour || '')) problems.push('colour must be #rrggbb');
    if (typeof curve.label !== 'string' || !curve.label) problems.push('label must be a string');
    if (problems.length) errors.push(`${curve.id || '?'}: ${problems.join('; ')}`);
    else curves.push(curve);
  }
  return curves;
}

const CURVE_SAMPLES = 96;       // Bezier samples along the curve
const TANGENT_SAMPLES = 16;     // samples along each drawn tangent line
const GUIDE_REACH_M = 0.015;    // how far along the shortest path its end direction is read

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const polyLength = (pts) => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(...sub(p, pts[i])), 0);

/** The frame a handle at one end of the run is read in: the skin's normal, the
 *  shortest path's direction leaving that end, and the in-skin direction square
 *  to it that points up. */
function handleFrame(grid, points, atEnd) {
  const path = atEnd ? points.slice().reverse() : points;
  const origin = path[0];
  let normal = closestOnMesh(grid, origin)?.normal || [0, 0, 1];
  // on the centre plane both sides read one frame, mirrored: the normal square to it
  if (Math.abs(origin[0]) < 1e-9) normal = unit([0, normal[1], normal[2]]);
  let reach = path[path.length - 1];
  for (let i = 1, walked = 0; i < path.length; i++) {
    walked += Math.hypot(...sub(path[i], path[i - 1]));
    if (walked >= GUIDE_REACH_M) { reach = path[i]; break; }
  }
  const d = sub(reach, origin);
  const along = unit(sub(d, normal.map((v) => v * dot(d, normal))));
  let up = unit(cross(normal, along));
  if (up[1] < 0) up = up.map((v) => -v);
  return { origin, normal, along, up };
}

/** The handle tip, on the skin, for { angle_deg, length_mm } in `frame`: the
 *  point of the skin whose offset from the end, seen square to the skin's
 *  normal there, is that angle and length -- so a dragged tip stays under the
 *  pointer (handleFromPoint is its exact inverse). */
export function handleTip(grid, frame, handle) {
  const a = (handle.angle_deg * Math.PI) / 180, l = handle.length_mm / 1000;
  const target = [l * Math.cos(a), l * Math.sin(a)];
  let p = frame.origin.map((v, i) => v + target[0] * frame.along[i] + target[1] * frame.up[i]);
  let tip = p;
  for (let pass = 0; pass < 8; pass++) {
    tip = closestOnMesh(grid, p)?.point || p;
    const d = sub(tip, frame.origin);
    const miss = [target[0] - dot(d, frame.along), target[1] - dot(d, frame.up)];
    if (Math.hypot(miss[0], miss[1]) < 1e-6) break;
    p = p.map((v, i) => v + miss[0] * frame.along[i] + miss[1] * frame.up[i]);
  }
  return tip;
}

/** The inverse, for a dragged tip: { angle_deg, length_mm } of a point on the skin. */
export function handleFromPoint(frame, point) {
  const d = sub(point, frame.origin);
  const x = dot(d, frame.along), y = dot(d, frame.up);
  return { angle_deg: (Math.atan2(y, x) * 180) / Math.PI, length_mm: Math.hypot(x, y) * 1000 };
}

/** A straight 3D line from a to b carried onto the skin, sample by sample. */
function onSkin(grid, a, b, samples) {
  const out = [a.slice()];
  for (let s = 1; s < samples; s++) {
    const t = s / samples, p = a.map((v, i) => v + (b[i] - v) * t);
    out.push(closestOnMesh(grid, p)?.point || p);
  }
  out.push(b.slice());
  return out;
}

// A cubic Bezier's samples, t in (0, 1], carried onto the skin; null if one misses.
function bezierOnSkin(grid, P0, P1, P2, P3, samples) {
  const out = [];
  for (let s = 1; s <= samples; s++) {
    if (s === samples) { out.push(P3.slice()); break; }
    const t = s / samples, u = 1 - t;
    const b = [0, 1, 2].map((i) => u * u * u * P0[i] + 3 * u * u * t * P1[i] + 3 * u * t * t * P2[i] + t * t * t * P3[i]);
    const hit = closestOnMesh(grid, b);
    if (!hit) return null;
    out.push(hit.point);
  }
  return out;
}

/** One side's tangent curve from its frames and the handle pair. With a
 *  `through` point it is two Beziers joined there, smoothly: the tangent at the
 *  point is the chord from end to end laid in the skin, each side of it a third
 *  of its own segment's chord long. */
function tangentRun(grid, side, frames, handles, guideLength, through = null) {
  const [P0, P3] = [frames.from.origin, frames.to.origin];
  const [T0, T3] = [handleTip(grid, frames.from, handles.from), handleTip(grid, frames.to, handles.to)];
  let points, mid = -1;
  if (!through) {
    const b = bezierOnSkin(grid, P0, T0, T3, P3, CURVE_SAMPLES);
    if (!b) return { side, blocked: `the curve leaves the skin on the ${side} side` };
    points = [P0.slice(), ...b];
  } else {
    const M = through;
    const n = closestOnMesh(grid, M)?.normal || [0, 0, 1];
    const chord = sub(P3, P0);
    const dir = unit(sub(chord, n.map((v) => v * dot(chord, n))));
    const [la, lb] = [Math.hypot(...sub(M, P0)) / 3, Math.hypot(...sub(P3, M)) / 3];
    const inA = M.map((v, i) => v - la * dir[i]), outB = M.map((v, i) => v + lb * dir[i]);
    const share = Math.max(8, Math.round((CURVE_SAMPLES * 3 * la) / (3 * la + 3 * lb)));
    const a = bezierOnSkin(grid, P0, T0, inA, M, share);
    const b = bezierOnSkin(grid, M, outB, T3, P3, Math.max(8, CURVE_SAMPLES - share));
    if (!a || !b) return { side, blocked: `the curve leaves the skin on the ${side} side` };
    points = [P0.slice(), ...a, ...b];
    mid = a.length;
  }
  const length = polyLength(points);
  const jumped = jumpAcross(points, side);
  if (jumped) return { side, blocked: jumped };
  return {
    side, from: P0, to: P3, through, length_m: length, points, guide_length_m: guideLength,
    ...(through ? { leg_lengths_m: [polyLength(points.slice(0, mid + 1)), polyLength(points.slice(mid))] } : {}),
    frames,
    tangents: [
      { end: 'from', tip: T0, points: onSkin(grid, P0, T0, TANGENT_SAMPLES) },
      { end: 'to', tip: T3, points: onSkin(grid, P3, T3, TANGENT_SAMPLES) },
    ],
  };
}

// Why a curve on the skin is not one, or null: carried across a gap in the skin
// (the armhole opening) rather than along it.
function jumpAcross(points, side) {
  const length = polyLength(points);
  let jump = 0;
  for (let i = 1; i < points.length; i++) jump = Math.max(jump, Math.hypot(...sub(points[i], points[i - 1])));
  return jump > Math.max(0.012, (6 * length) / CURVE_SAMPLES) ? `the curve jumps ${(jump * 1000).toFixed(0)}mm across the skin on the ${side} side` : null;
}

/** One side's control curve from its frame at the `from` end, the control handle
 *  and the other end: the quadratic Bezier bent toward the control point. Its
 *  two dashed guides run from each end to the control point. */
function controlRun(grid, side, frames, handles, guideLength, P3) {
  const P0 = frames.control.origin;
  const C = handleTip(grid, frames.control, handles.control);
  // the quadratic as a cubic: each inner point two thirds of the way to C
  const P1 = P0.map((v, i) => v + (2 / 3) * (C[i] - v));
  const P2 = P3.map((v, i) => v + (2 / 3) * (C[i] - v));
  const b = bezierOnSkin(grid, P0, P1, P2, P3, CURVE_SAMPLES);
  if (!b) return { side, blocked: `the curve leaves the skin on the ${side} side` };
  const points = [P0.slice(), ...b];
  const jumped = jumpAcross(points, side);
  if (jumped) return { side, blocked: jumped };
  return {
    side, from: P0, to: P3, through: null, length_m: polyLength(points), points, guide_length_m: guideLength,
    frames, control: C,
    tangents: [
      { end: 'control', tip: C, points: onSkin(grid, P0, C, TANGENT_SAMPLES) },
      { end: 'control', tip: C, points: onSkin(grid, P3, C, TANGENT_SAMPLES) },
    ],
  };
}

// One side of a shaped curve, from the frames kept on its run.
function shapeRun(kind, grid, side, frames, handles, guideLength, to, through) {
  return kind === 'control_curve'
    ? controlRun(grid, side, frames, handles, guideLength, to)
    : tangentRun(grid, side, frames, handles, guideLength, through);
}

/** Re-shape a measured curve with new handles (a tangent pair, or the control),
 *  both sides, without finding the shortest paths again (its frames are kept
 *  on each run). */
export function bendCurve(measured, handles, grid) {
  if (measured.blocked || !HANDLE_KEYS[measured.kind]) return measured;
  const runs = [];
  for (const run of measured.runs) {
    const next = shapeRun(measured.kind, grid, run.side, run.frames, handles, run.guide_length_m, run.to, run.through);
    if (next.blocked) return { ...measured, handles, blocked: next.blocked, runs: [] };
    runs.push(next);
  }
  return { ...measured, handles, blocked: null, runs };
}

// A curve's end on one side: { at: [x, y, z] }, or { needs } naming what is missing.
function curveEnd(end, side, straps, landmarks, lines) {
  if (end.strap !== undefined) {
    const strap = straps.find((s) => s.id === end.strap);
    return strap && !strap.blocked ? { at: strap.bands.find((b) => b.side === side).corners[end.corner] } : { needs: end.strap };
  }
  if (end.line !== undefined) {
    const line = lines.find((l) => l.id === end.line);
    return line && !line.blocked ? { at: line[end.end] } : { needs: end.line };
  }
  const id = `${end.landmark}_${side}`;
  return Array.isArray(landmarks?.[id]) ? { at: landmarks[id] } : { needs: id };
}

/** `landmarks` maps a registry id to [x, y, z]; `grid` is surface_path's buildGrid.
 *  `handles` overrides a shaped curve's contract handles ({ from, to } for a
 *  tangent curve, { control } for a control curve; one missing keeps the
 *  contract's); `points` are the measured points (measurePoints), for a curve
 *  with `through`; `lines` the measured lines, for a curve ending on one.
 *  Each handle is read against the shortest path over the skin from its end to
 *  the next point the curve must meet (the through point, or the other end). */
export function measureCurve(curve, straps, landmarks, grid, handles = null, points = [], lines = []) {
  const ends = ['L', 'R'].map((side) => [curveEnd(curve.from, side, straps, landmarks, lines), curveEnd(curve.to, side, straps, landmarks, lines)]);
  const missing = [...new Set(ends.flat().filter((e) => e.needs).map((e) => e.needs))];
  if (missing.length) return { ...curve, blocked: `needs ${missing.join(', ')}`, runs: [] };
  const via = curve.through ? points.find((p) => p.id === curve.through.point) : null;
  if (curve.through && (!via || via.blocked)) return { ...curve, blocked: `needs ${curve.through.point}`, runs: [] };
  const keys = HANDLE_KEYS[curve.kind];
  const use = keys ? Object.fromEntries(keys.map((k) => [k, handles?.[k] || curve.handles[k]])) : null;
  const runs = [];
  for (const [s, side] of ['L', 'R'].entries()) {
    const [from, to] = ends[s].map((e) => e.at);
    const M = via ? via.marks.find((m) => m.side === side).point : null;
    const legs = M ? [surfaceRun(grid, from, M), surfaceRun(grid, M, to)] : [surfaceRun(grid, from, to)];
    if (!legs.every((l) => l.onSurface)) return { ...curve, blocked: `no path over the skin on the ${side} side`, runs: [] };
    const guide = legs.reduce((sum, l) => sum + l.length, 0);
    if (!use) { runs.push({ side, from, to, length_m: guide, points: legs[0].points }); continue; }
    const frames = curve.kind === 'control_curve'
      ? { control: handleFrame(grid, legs[0].points, false) }
      : { from: handleFrame(grid, legs[0].points, false), to: handleFrame(grid, legs[legs.length - 1].points, true) };
    const bent = shapeRun(curve.kind, grid, side, frames, use, guide, to, M);
    if (bent.blocked) return { ...curve, handles: use, blocked: bent.blocked, runs: [] };
    runs.push(bent);
  }
  return { ...curve, handles: use, blocked: null, runs };
}

/** Every declared curve, from the measured straps and lines. `handles` maps a
 *  curve id to handles that override the contract's (the viewer's dragged ones). */
export function measureCurves(loaded, straps, landmarks, grid, handles = {}, points = [], lines = []) {
  return (loaded.curves || []).map((curve) => measureCurve(curve, straps, landmarks, grid, handles[curve.id] || null, points, lines));
}
