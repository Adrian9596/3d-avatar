/* --- curves on the skin ------------------------------------------------------------
   The cup armhole, say: from a corner of a strap to a registry landmark on the
   same side (its _L / _R point). An end may also be an end of a line, such as
   the top of the centre-front line: on the centre plane, so both sides start
   from the same point. A wire's ends are points ("points" in the contract).

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

   kind "joined_curve": a curve whose ends take their direction from what they
   join, from a line's end on the centre plane to a strap corner. At the strap it
   arrives along the strap's edge from that corner, so the two read as one line
   running on over the shoulder. At the centre front it leaves level -- the two
   sides meet smoothly in a U -- or rising at an angle, a V (handles.cf.angle_deg,
   0 = U). With both end directions set, what is left to shape is how full the
   curve is (handles.depth.fullness): the cubic Bezier whose inner points lie
   along the two end tangents, that fraction of the way to where the tangents
   meet (2/3 is the parabola through that meeting point; less is flatter, more is
   a deeper scoop). Each sample is carried onto the skin at its own height (the
   level section through it), not to the closest point, so seen from the front
   the curve is the one drafted: a U stays level into the cleavage instead of
   being pulled up its walls. Its bow is reported as the largest distance from
   the shortest path over the skin.

   kind "wire_curve": a wire, drawn between points: from one (the armhole mark,
   on each side) through a registry landmark that is its lowest point (the
   bottom of the breast root, where cup depth starts) to another (the CF point,
   one for both sides). It is two cubic Beziers joined at the lowest point,
   smoothly and level there: the tangent runs along the level section through
   it, each side of it a third of its own leg's chord long. At the ends it does
   not bend (a natural spline: each end's inner point half way to the handle at
   the lowest point). Each sample is carried onto the skin at its own height,
   as a joined curve's is. It has no handles: it follows its points. Its end may
   be a dot riding on a curve declared before it, so curves are measured in the
   contract's order, with the dots on the curves before a wire placed first. -- */

import { surfaceRun, closestOnMesh } from '../../core/surface_path.mjs';
import { measureCurvePoints } from './points.mjs';

// The handles each shaped kind of curve carries (see the curves section).
export const HANDLE_KEYS = { tangent_curve: ['from', 'to'], joined_curve: ['cf', 'depth'] };
export const CF_ANGLE_MAX_DEG = 75;          // a V steeper than this is not a neckline
export const FULLNESS_RANGE = [0.05, 1.5];   // from nearly the straight join to a deep scoop
const CF_SNAP_DEG = 3;                       // a dragged V this close to level is a U
const CF_HANDLE_MM = 20;                     // how long the centre-front tangent is drawn

/** Whether `h` is a sound value for handle `key` of a curve of `kind` (a stored
 *  one that is not falls back to the contract's). */
export function validHandle(kind, key, h) {
  if (kind === 'tangent_curve') return Number.isFinite(h?.angle_deg) && Math.abs(h.angle_deg) <= 180 && Number.isFinite(h?.length_mm) && h.length_mm > 0;
  if (kind === 'joined_curve' && key === 'cf') return Number.isFinite(h?.angle_deg) && h.angle_deg >= 0 && h.angle_deg <= CF_ANGLE_MAX_DEG;
  if (kind === 'joined_curve' && key === 'depth') return Number.isFinite(h?.fullness) && h.fullness >= FULLNESS_RANGE[0] && h.fullness <= FULLNESS_RANGE[1];
  return false;
}

/** Validate the contract's `curves` against the valid straps, lines and points.
 *  Returns the valid curves. */
export function validateCurves(contract, { errors, heightIds, shapeIds, lines, ticks, straps, points, known }) {
  // Curves on the skin, one per side, between two of: a strap corner, a registry
  // landmark (its _L / _R point), an end of a line (on the centre plane), or a
  // point (a wire's ends).
  const CORNERS = ['front_inner', 'front_outer', 'back_inner', 'back_outer'];
  const curves = [];
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
    if (end?.point !== undefined) {
      const point = points.find((p) => p.id === end.point);
      if (!point) return [`${name} point ${end.point} is not a valid point`];
      // a dot riding on a curve is placed once that curve is measured, so it must be one declared before this
      return point.kind === 'on_curve' && !curves.some((c) => c.id === point.curve)
        ? [`${name} point ${end.point} rides on ${point.curve}, which is not a valid curve declared before this one`] : [];
    }
    return ['L', 'R'].filter((side) => !known.has(`${end?.landmark}_${side}`)).map((side) => `${name} ${end?.landmark}_${side} is not a registry landmark`);
  };
  for (const curve of contract?.curves || []) {
    const problems = [];
    if (!curve.id || heightIds.has(curve.id) || shapeIds.has(curve.id) || lines.some((l) => l.id === curve.id) || ticks.some((t) => t.id === curve.id) || straps.some((t) => t.id === curve.id) || points.some((t) => t.id === curve.id) || curves.some((c) => c.id === curve.id)) problems.push('missing or duplicate id');
    if (!['shortest_surface_path', 'wire_curve', ...Object.keys(HANDLE_KEYS)].includes(curve.kind)) problems.push(`unknown kind ${curve.kind}`);
    if (curve.kind === 'tangent_curve') for (const key of HANDLE_KEYS[curve.kind]) {
      const h = curve.handles?.[key];
      if (!(Number.isFinite(h?.angle_deg) && Math.abs(h.angle_deg) <= 180)) problems.push(`handles.${key}.angle_deg must be a number of degrees`);
      if (!(Number.isFinite(h?.length_mm) && h.length_mm > 0)) problems.push(`handles.${key}.length_mm must be a positive number`);
    }
    if (curve.kind === 'joined_curve') {
      if (!validHandle(curve.kind, 'cf', curve.handles?.cf)) problems.push(`handles.cf.angle_deg must be 0 (a U) to ${CF_ANGLE_MAX_DEG} degrees (a V)`);
      if (!validHandle(curve.kind, 'depth', curve.handles?.depth)) problems.push(`handles.depth.fullness must be ${FULLNESS_RANGE[0]} to ${FULLNESS_RANGE[1]}`);
      if (curve.from?.line === undefined || curve.to?.strap === undefined) problems.push('a joined curve runs from a line\'s end on the centre plane to a strap corner');
    }
    if (curve.kind === 'wire_curve') {
      if (curve.from?.point === undefined || curve.to?.point === undefined || curve.through?.landmark === undefined) problems.push('a wire runs from a point, through a registry landmark (its lowest point), to a point');
    } else if ([curve.from, curve.to].some((e) => e?.point !== undefined)) problems.push('only a wire runs from or to a point');
    problems.push(...endProblems(curve.from, 'from'), ...endProblems(curve.to, 'to'));
    // what it passes through: for a wire, a registry landmark on each side, its lowest point; for a
    // tangent curve, a point per side, offset from a landmark (a dot on a line is one for both)
    if (curve.kind === 'wire_curve') {
      if (curve.through?.landmark !== undefined) problems.push(...endProblems({ landmark: curve.through.landmark }, 'through'));
    } else if (curve.through !== undefined && (curve.kind !== 'tangent_curve' || !points.some((p) => p.id === curve.through?.point && p.kind === 'offset_on_skin'))) problems.push(`through ${curve.through?.point} is not a valid point offset on the skin (and only a tangent curve passes through one)`);
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

/* The point of the skin at p's own height nearest p across the body (in x and
   z): where the level section through p passes closest to it. It looks only at
   the triangles near p, ring by ring, as closestOnMesh does. A curve carried
   this way keeps the heights it was drawn with, so seen from the front it is
   the curve drafted -- level where it was drawn level. */
function levelOnMesh(grid, p) {
  const { cells, cell, tri } = grid;
  const y = p[1];
  const ci = Math.floor(p[0] / cell), cj = Math.floor(y / cell), ck = Math.floor(p[2] / cell);
  const seen = new Set();
  let best = null, bestSq = Infinity;
  for (let r = 0; r <= 12; r++) {
    for (let i = ci - r; i <= ci + r; i++) for (let k = ck - r; k <= ck + r; k++) {
      if (Math.max(Math.abs(i - ci), Math.abs(k - ck)) !== r) continue;
      const bucket = cells.get(`${i},${cj},${k}`);
      if (!bucket) continue;
      for (const t of bucket) {
        if (seen.has(t)) continue;
        seen.add(t);
        const hits = [];
        for (let e = 0; e < 3; e++) {
          const a = t + e * 3, b = t + ((e + 1) % 3) * 3;
          const d0 = tri[a + 1] - y, d1 = tri[b + 1] - y;
          if ((d0 > 0) !== (d1 > 0)) {
            const f = d0 / (d0 - d1);
            hits.push([tri[a] + (tri[b] - tri[a]) * f, tri[a + 2] + (tri[b + 2] - tri[a + 2]) * f]);
          }
        }
        if (hits.length !== 2) continue;
        const [h0, h1] = hits, dx = h1[0] - h0[0], dz = h1[1] - h0[1], l2 = dx * dx + dz * dz;
        const f = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - h0[0]) * dx + (p[2] - h0[1]) * dz) / l2)) : 0;
        const q = [h0[0] + dx * f, h0[1] + dz * f];
        const sq = (q[0] - p[0]) ** 2 + (q[1] - p[2]) ** 2;
        if (sq < bestSq) { bestSq = sq; best = q; }
      }
    }
    if (best && Math.sqrt(bestSq) <= r * cell) break;
  }
  return best ? { point: [best[0], y, best[1]] } : null;
}

const LEVEL_REACH_M = 0.005;    // how far to either side a level section's direction is read

/* The direction of the level section through p: the chord between the
   section's points nearest p -+ LEVEL_REACH_M along `toward` (laid level),
   pointing the way `toward` does. It is read from the section, not from the
   skin's normal, which at a crease (the underbust fold) turns from one
   triangle to the next. Null if the section is not there. */
function levelDirection(grid, p, toward) {
  const h = unit([toward[0], 0, toward[2]]);
  const [a, b] = [-1, 1].map((s) => levelOnMesh(grid, p.map((v, i) => v + s * LEVEL_REACH_M * h[i]))?.point);
  if (!a || !b || Math.hypot(...sub(b, a)) < 1e-6) return null;
  const t = unit(sub(b, a));
  return dot(t, h) < 0 ? t.map((v) => -v) : t;
}

// A cubic Bezier's samples, t in (0, 1], carried onto the skin (by `carry`, the
// closest point unless said otherwise); null if one misses.
function bezierOnSkin(grid, P0, P1, P2, P3, samples, carry = closestOnMesh) {
  const out = [];
  for (let s = 1; s <= samples; s++) {
    if (s === samples) { out.push(P3.slice()); break; }
    const t = s / samples, u = 1 - t;
    const b = [0, 1, 2].map((i) => u * u * u * P0[i] + 3 * u * u * t * P1[i] + 3 * u * t * t * P2[i] + t * t * t * P3[i]);
    const hit = carry(grid, b);
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

/** The frame the centre-front tangent is read in, on one side: the skin's
 *  normal there (square to the centre plane, so both sides read one frame,
 *  mirrored), the level direction toward that side laid in the skin, and the
 *  in-skin direction square to it that points up. */
function centreFrame(grid, origin, side) {
  let normal = closestOnMesh(grid, origin)?.normal || [0, 0, 1];
  if (Math.abs(origin[0]) < 1e-9) normal = unit([0, normal[1], normal[2]]);
  const out = [side === 'R' ? 1 : -1, 0, 0];
  const along = unit(sub(out, normal.map((v) => v * dot(out, normal))));
  let up = unit(cross(normal, along));
  if (up[1] < 0) up = up.map((v) => -v);
  return { origin, normal, along, up };
}

/* How far along each end tangent the two come closest: `s` forward from P0
   along t0, `u` back from P3 along t3. Tangents that are parallel, or meet
   behind an end, fall back to a third of the chord, so a steep V still curves. */
function tangentReach(P0, t0, P3, t3) {
  const chord = Math.hypot(...sub(P3, P0));
  const d = sub(P0, P3), c = dot(t0, t3), det = 1 - c * c;
  let s = chord / 3, u = chord / 3;
  if (det > 1e-6) {
    s = (-dot(t0, d) + c * dot(t3, d)) / det;
    u = (-dot(t3, d) + c * dot(t0, d)) / det;
  }
  const clamp = (v) => (v > 0 ? Math.min(Math.max(v, 0.1 * chord), 1.5 * chord) : chord / 3);
  return { s: clamp(s), u: clamp(u) };
}

/* How far a curve bows from a path on the skin: the largest distance from a
   point of the curve to the path, positive where the curve runs below it. */
function bowFrom(points, path) {
  let bow = 0;
  for (const p of points) {
    let gap = Infinity, below = false;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], d = sub(path[i], a), l2 = dot(d, d);
      const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
      const q = a.map((v, k) => v + d[k] * t);
      const g = Math.hypot(...sub(p, q));
      if (g < gap) { gap = g; below = p[1] < q[1]; }
    }
    if (gap > Math.abs(bow)) bow = below ? gap : -gap;
  }
  return bow;
}

/** One side's joined curve: level (or at the V's angle) out of the centre
 *  front, along the strap's edge into the strap, as full as `depth` says. Its
 *  two dots are the centre-front tangent's tip and the curve's middle. */
function joinedRun(grid, side, frames, handles, guideLength) {
  const P0 = frames.cf.origin, P3 = frames.strap.origin, t3 = frames.strap.direction;
  const a = (handles.cf.angle_deg * Math.PI) / 180;
  const t0 = unit(frames.cf.along.map((v, i) => Math.cos(a) * v + Math.sin(a) * frames.cf.up[i]));
  const { s, u } = tangentReach(P0, t0, P3, t3);
  const k = handles.depth.fullness;
  const P1 = P0.map((v, i) => v + k * s * t0[i]);
  const P2 = P3.map((v, i) => v - k * u * t3[i]);
  // carried at its own heights, so level out of the centre front stays level
  const b = bezierOnSkin(grid, P0, P1, P2, P3, CURVE_SAMPLES, levelOnMesh);
  if (!b) return { side, blocked: `the curve leaves the skin on the ${side} side` };
  const points = [P0.slice(), ...b];
  const jumped = jumpAcross(points, side);
  if (jumped) return { side, blocked: jumped };
  // the middle, t = 1/2, and how it moves as the fullness changes (it is linear in it)
  const middle = points[CURVE_SAMPLES / 2];
  const chordMiddle = P0.map((v, i) => (v + P3[i]) / 2);
  const pull = t0.map((v, i) => (3 / 8) * (s * v - u * t3[i]));
  const cfTip = handleTip(grid, frames.cf, { angle_deg: handles.cf.angle_deg, length_mm: CF_HANDLE_MM });
  return {
    side, from: P0, to: P3, through: null, length_m: polyLength(points), points, guide_length_m: guideLength,
    depth_m: bowFrom(points, frames.guide), cf_direction: t0, strap_direction: t3,
    frames, pull, chord_middle: chordMiddle,
    tangents: [
      { end: 'cf', tip: cfTip, points: onSkin(grid, P0, cfTip, TANGENT_SAMPLES) },
      { end: 'depth', tip: middle, points: [middle] },
    ],
  };
}

/** One side's wire, from A through M, its lowest point, to C: two cubic
 *  Beziers joined at M, level there along the level section, each handle a
 *  third of its own leg's chord long; at A and C no bend. */
function wireRun(grid, side, A, M, C) {
  const t = levelDirection(grid, M, sub(C, A));
  if (!t) return { side, blocked: `no level section through the lowest point on the ${side} side` };
  const [la, lb] = [Math.hypot(...sub(M, A)) / 3, Math.hypot(...sub(C, M)) / 3];
  const inA = M.map((v, i) => v - la * t[i]), outC = M.map((v, i) => v + lb * t[i]);
  // a natural spline's ends (no second derivative there): each end's inner point half way to the handle at M
  const A1 = A.map((v, i) => (v + inA[i]) / 2), C1 = C.map((v, i) => (v + outC[i]) / 2);
  const share = Math.max(8, Math.round((CURVE_SAMPLES * la) / (la + lb)));
  // carried at its own heights, so it stays level through M as drawn
  const a = bezierOnSkin(grid, A, A1, inA, M, share, levelOnMesh);
  const b = bezierOnSkin(grid, M, outC, C1, C, Math.max(8, CURVE_SAMPLES - share), levelOnMesh);
  if (!a || !b) return { side, blocked: `the curve leaves the skin on the ${side} side` };
  const points = [A.slice(), ...a, ...b];
  const jumped = jumpAcross(points, side);
  if (jumped) return { side, blocked: jumped };
  return {
    side, from: A, to: C, through: M, length_m: polyLength(points), points,
    leg_lengths_m: [polyLength(points.slice(0, a.length + 1)), polyLength(points.slice(a.length))],
  };
}

/** The handle a dragged dot asks for: handle `key` of `curve`, its dot dragged
 *  to `point` on the skin on `run`'s side. Null when the drag gives no sound one
 *  (the curve then keeps the shape it had). */
export function dragHandle(curve, run, key, point, grid) {
  if (curve.kind === 'tangent_curve') {
    const h = handleFromPoint(run.frames[key], point);
    return h.length_mm >= 3 ? h : null;
  }
  if (curve.kind !== 'joined_curve') return null;
  if (key === 'cf') {
    let a = handleFromPoint(run.frames.cf, point).angle_deg;
    if (a < -90 || a > 150) return null;                 // across the centre, or back on itself
    a = Math.max(0, Math.min(CF_ANGLE_MAX_DEG, a));
    return { angle_deg: a < CF_SNAP_DEG ? 0 : a };
  }
  // the middle moves along `pull` as the fullness changes: follow the pointer along it
  const p2 = dot(run.pull, run.pull);
  if (!(p2 > 0)) return null;
  let k = curve.handles.depth.fullness;
  for (let pass = 0; pass < 6; pass++) {
    const at = run.chord_middle.map((v, i) => v + k * run.pull[i]);
    const middle = levelOnMesh(grid, at)?.point || at;
    const step = dot(sub(point, middle), run.pull) / p2;
    k = Math.max(FULLNESS_RANGE[0], Math.min(FULLNESS_RANGE[1], k + step));
    if (Math.abs(step) < 1e-5) break;
  }
  return { fullness: k };
}

// One side of a shaped curve, from the frames kept on its run.
function shapeRun(kind, grid, side, frames, handles, guideLength, to, through) {
  return kind === 'joined_curve'
    ? joinedRun(grid, side, frames, handles, guideLength)
    : tangentRun(grid, side, frames, handles, guideLength, through);
}

/** Re-shape a measured curve with new handles (a tangent pair, or a joined
 *  curve's centre-front angle and fullness),
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
function curveEnd(end, side, straps, landmarks, lines, points) {
  if (end.strap !== undefined) {
    const strap = straps.find((s) => s.id === end.strap);
    if (!strap || strap.blocked) return { needs: end.strap };
    const band = strap.bands.find((b) => b.side === side);
    return { at: band.corners[end.corner], edge: band.edges[end.corner] };
  }
  if (end.line !== undefined) {
    const line = lines.find((l) => l.id === end.line);
    return line && !line.blocked ? { at: line[end.end] } : { needs: end.line };
  }
  if (end.point !== undefined) {
    // a dot on a line is one for both sides; a point offset from a landmark, or a dot on a curve, is one per side
    const point = points.find((p) => p.id === end.point);
    if (!point || point.blocked) return { needs: end.point };
    return { at: point.kind === 'on_line' ? point.at : point.marks.find((m) => m.side === side).point };
  }
  const id = `${end.landmark}_${side}`;
  return Array.isArray(landmarks?.[id]) ? { at: landmarks[id] } : { needs: id };
}

/** `landmarks` maps a registry id to [x, y, z]; `grid` is surface_path's buildGrid.
 *  `handles` overrides a shaped curve's contract handles ({ from, to } for a
 *  tangent curve, { cf, depth } for a joined curve; one missing or unsound
 *  keeps the contract's); `points` are the measured points (measurePoints), for a curve
 *  with `through` or a wire ending on one; `lines` the measured lines, for a curve ending on one.
 *  Each handle is read against the shortest path over the skin from its end to
 *  the next point the curve must meet (the through point, or the other end). */
export function measureCurve(curve, straps, landmarks, grid, handles = null, points = [], lines = []) {
  const ends = ['L', 'R'].map((side) => [curveEnd(curve.from, side, straps, landmarks, lines, points), curveEnd(curve.to, side, straps, landmarks, lines, points)]);
  // a wire's lowest point is a registry landmark on each side
  const lows = curve.kind === 'wire_curve' ? ['L', 'R'].map((side) => curveEnd(curve.through, side, straps, landmarks, lines, points)) : [];
  const missing = [...new Set([...ends.flat(), ...lows].filter((e) => e.needs).map((e) => e.needs))];
  if (missing.length) return { ...curve, blocked: `needs ${missing.join(', ')}`, runs: [] };
  if (curve.kind === 'wire_curve') {
    const runs = [];
    for (const [s, side] of ['L', 'R'].entries()) {
      const run = wireRun(grid, side, ends[s][0].at, lows[s].at, ends[s][1].at);
      if (run.blocked) return { ...curve, blocked: run.blocked, runs: [] };
      runs.push(run);
    }
    return { ...curve, blocked: null, runs };
  }
  const via = curve.through ? points.find((p) => p.id === curve.through.point) : null;
  if (curve.through && (!via || via.blocked)) return { ...curve, blocked: `needs ${curve.through.point}`, runs: [] };
  const keys = HANDLE_KEYS[curve.kind];
  const use = keys ? Object.fromEntries(keys.map((k) => [k, handles?.[k] && validHandle(curve.kind, k, handles[k]) ? handles[k] : curve.handles[k]])) : null;
  const runs = [];
  for (const [s, side] of ['L', 'R'].entries()) {
    const [from, to] = ends[s].map((e) => e.at);
    const edge = ends[s][1].edge;
    const M = via ? via.marks.find((m) => m.side === side).point : null;
    const legs = M ? [surfaceRun(grid, from, M), surfaceRun(grid, M, to)] : [surfaceRun(grid, from, to)];
    if (!legs.every((l) => l.onSurface)) return { ...curve, blocked: `no path over the skin on the ${side} side`, runs: [] };
    const guide = legs.reduce((sum, l) => sum + l.length, 0);
    if (!use) { runs.push({ side, from, to, length_m: guide, points: legs[0].points }); continue; }
    const frames = curve.kind === 'joined_curve'
      // level out of the centre front; into the strap along its edge (the direction it leaves the corner)
      ? { cf: centreFrame(grid, from, side), strap: { origin: to, direction: handleFrame(grid, edge, false).along }, guide: legs[0].points }
      : { from: handleFrame(grid, legs[0].points, false), to: handleFrame(grid, legs[legs.length - 1].points, true) };
    const bent = shapeRun(curve.kind, grid, side, frames, use, guide, to, M);
    if (bent.blocked) return { ...curve, handles: use, blocked: bent.blocked, runs: [] };
    runs.push(bent);
  }
  return { ...curve, handles: use, blocked: null, runs };
}

/** Every declared curve, from the measured straps and lines, in the contract's
 *  order: a wire may end on a dot riding on a curve before it, so the dots on
 *  the curves measured so far are placed before a wire is. `handles` maps a
 *  curve id to handles that override the contract's (the viewer's dragged ones). */
export function measureCurves(loaded, straps, landmarks, grid, handles = {}, points = [], lines = []) {
  const curves = [];
  for (const curve of loaded.curves || []) {
    const placed = curve.kind === 'wire_curve' ? measureCurvePoints(points, curves) : points;
    curves.push(measureCurve(curve, straps, landmarks, grid, handles[curve.id] || null, placed, lines));
  }
  return curves;
}

/** The measured `curves` again after a point moved or a curve was reshaped,
 *  finding no shortest path again: each wire drawn on `points` as they are now
 *  (the dots on the curves before it placed first), every other curve kept. */
export function measureWires(loaded, curves, landmarks, grid, points) {
  const out = [];
  for (const curve of curves) {
    const declared = curve.kind === 'wire_curve' && (loaded.curves || []).find((c) => c.id === curve.id);
    out.push(declared ? measureCurve(declared, [], landmarks, grid, null, measureCurvePoints(points, out), []) : curve);
  }
  return out;
}
