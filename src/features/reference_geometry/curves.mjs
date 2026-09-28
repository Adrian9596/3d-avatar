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
   being pulled up its walls. The nearest point of each section jumps about a
   little from one height to the next, so the run is then eased across the body
   (see ease), its heights kept. Its bow is reported as the largest distance
   from the shortest path over the skin.

   kind "wire_curve": a wire, drawn between points: from one (the armhole mark,
   on each side) to another (the CF point, one for both sides), along the breast
   root in between. The root is found about a registry landmark on each side
   (root.about, the apex; see root.mjs): the skin's most concave line round the
   breast, where it leaves the chest wall. The wire follows it from its outer end
   (where the crease runs out) inward, until it would rise past the CF point's
   height or reach the centre plane, and it joins each end to the root in the
   chart it is drawn round the body in: each point placed by its angle about an
   upright axis through the middle of the body (on the centre plane) and by its
   height. There each join is a cubic Bezier leaving the root along the root's
   own direction, its handle a third of the join's chord long. At the armhole
   mark it does not bend (a natural spline: its inner point half way to the
   handle); at the CF point, where the two sides meet, it is drawn arriving
   level, so neither side crosses the centre plane (left free there, the join
   carried on the root's rising direction and crossed it). Eased, the two sides
   meet there in a shallow V, which is reported. A join's samples are carried
   onto the skin along their level ray out from the
   axis, to where the ray first leaves the body; the root's are on the skin
   already. The joined run is then spaced evenly along itself (2.5mm) and eased
   along itself, sixteen times, in all three directions (the root's heights are
   read off the mesh facet by facet and carry its noise), its ends kept, which
   takes out the kinks of the mesh's flat facets and keeps it within half a
   millimetre of the skin. Its lowest point
   is reported, and the two legs either side of it. It has no handles: it follows
   its points. Its end may be a dot riding on a curve declared before it, so
   curves are measured in the contract's order, with the dots on the curves
   before a wire placed first. (The first wires were two Beziers through the
   armhole mark, the fold point below the apex and the CF point: smooth, but
   9-17mm off the crease on both legs, because nothing in them knew where the
   crease was.) ------------------------------------------------------------------ */

import { surfaceRun, closestOnMesh } from '../../core/surface_path.mjs';
import { verticalSegments, backCrossing } from './contour.mjs';
import { measureCurvePoints } from './points.mjs';
import { breastRoot } from './root.mjs';

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
      if (curve.from?.point === undefined || curve.to?.point === undefined || curve.root?.about?.landmark === undefined || curve.through !== undefined) problems.push('a wire runs from a point, along the breast root about a registry landmark, to a point');
    } else if ([curve.from, curve.to].some((e) => e?.point !== undefined)) problems.push('only a wire runs from or to a point');
    else if (curve.root !== undefined) problems.push('only a wire follows the breast root');
    problems.push(...endProblems(curve.from, 'from'), ...endProblems(curve.to, 'to'));
    // what it follows or passes through: for a wire, the root about a registry landmark on each
    // side (the apex); for a tangent curve, a point per side, offset from a landmark (a dot on a
    // line is one for both)
    if (curve.kind === 'wire_curve') {
      if (curve.root?.about?.landmark !== undefined) problems.push(...endProblems({ landmark: curve.root.about.landmark }, 'root about'));
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

const RAY_REACH_M = 0.4;         // how far out from the axis a level ray looks for the skin
const WIRE_EASE_PASSES = 16;     // how many times a wire is eased along itself once joined
const JOINED_EASE_PASSES = 6;    // and a joined curve, carried to the nearest skin, which strays more

/* The upright axis a wire is drawn round, at height y: on the centre plane,
   half way between the front and the back of the body there. Null if the body
   does not cross the centre plane at that height. */
function axisAt(grid, y) {
  const cut = verticalSegments(grid.tri, 0);
  const [front, back] = [backCrossing(cut, y, true), backCrossing(cut, y)];
  return front && back ? (front[1] + back[1]) / 2 : null;
}

/* Where the level ray from the axis (x = 0, z = axisZ) out through p first
   leaves the body. It looks only at the triangles in the grid's cells along the
   ray, nearest first, as closestOnMesh does ring by ring. */
function outAlongLevelRay(grid, p, axisZ) {
  const { cells, cell, tri } = grid;
  const y = p[1], cj = Math.floor(y / cell);
  const reach = Math.hypot(p[0], p[2] - axisZ);
  if (reach < 1e-9) return null;
  const ux = p[0] / reach, uz = (p[2] - axisZ) / reach;
  const seen = new Set();
  let best = Infinity;
  for (let s = 0; s <= RAY_REACH_M; s += cell / 3) {
    const ci = Math.floor((s * ux) / cell), ck = Math.floor((axisZ + s * uz) / cell);
    for (let i = ci - 1; i <= ci + 1; i++) for (let k = ck - 1; k <= ck + 1; k++) {
      const bucket = cells.get(`${i},${cj},${k}`);
      if (!bucket) continue;
      for (const t of bucket) {
        if (seen.has(t)) continue;
        seen.add(t);
        // the triangle cut at height y, and where the ray crosses that piece
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
        const [h0, h1] = hits, ex = h1[0] - h0[0], ez = h1[1] - h0[1];
        const det = ex * uz - ux * ez;
        if (Math.abs(det) < 1e-14) continue;
        const qx = h0[0], qz = h0[1] - axisZ;
        const along = (ex * qz - qx * ez) / det, on = (ux * qz - uz * qx) / det;
        if (along > 1e-9 && on >= -1e-9 && on <= 1 + 1e-9 && along < best) best = along;
      }
    }
    // a nearer crossing would lie in a cell already looked at
    if (best < s - 2 * cell) break;
  }
  return Number.isFinite(best) ? { point: [best * ux, y, axisZ + best * uz] } : null;
}

/* A run on the skin eased across the body: `passes` times, each sample but
   the ends and the `held` ones moved a quarter of the way toward each
   neighbour in x and z, its height kept. A curve carried at its own heights
   strays only across the body -- on the mesh's flat facets (their edges are
   about 7mm here), and where the nearest skin jumps -- so this takes the kinks
   out, leaves every height as drawn (level stays level, the lowest point the
   lowest), and keeps the run within a fraction of a millimetre of the skin. */
function ease(points, passes, held = []) {
  const keep = new Set([0, points.length - 1, ...held]);
  let out = points;
  for (let pass = 0; pass < passes; pass++) {
    const was = out;
    out = was.map((p, i) => (keep.has(i) ? p : [(was[i - 1][0] + 2 * p[0] + was[i + 1][0]) / 4, p[1], (was[i - 1][2] + 2 * p[2] + was[i + 1][2]) / 4]));
  }
  return out;
}

// A cubic Bezier's point at t.
const bezierAt = (P0, P1, P2, P3, t) => {
  const u = 1 - t;
  return [0, 1, 2].map((i) => u * u * u * P0[i] + 3 * u * u * t * P1[i] + 3 * u * t * t * P2[i] + t * t * t * P3[i]);
};

// A cubic Bezier's samples, t in (0, 1], carried onto the skin (by `carry`, the
// closest point unless said otherwise); null if one misses.
function bezierOnSkin(grid, P0, P1, P2, P3, samples, carry = closestOnMesh) {
  const out = [];
  for (let s = 1; s <= samples; s++) {
    if (s === samples) { out.push(P3.slice()); break; }
    const hit = carry(grid, bezierAt(P0, P1, P2, P3, s / samples));
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
  // carried at its own heights, so level out of the centre front stays level; then eased across
  const b = bezierOnSkin(grid, P0, P1, P2, P3, CURVE_SAMPLES, levelOnMesh);
  if (!b) return { side, blocked: `the curve leaves the skin on the ${side} side` };
  // (its last few samples held, so it still runs into the strap along the strap's edge; out of
  // the centre front it keeps its heights, so it leaves level as drawn)
  const held = [CURVE_SAMPLES - 2, CURVE_SAMPLES - 1];
  const points = ease([P0.slice(), ...b], JOINED_EASE_PASSES, held);
  const jumped = jumpAcross(points, side);
  if (jumped) return { side, blocked: jumped };
  // the middle, t = 1/2, carried as it was drawn (the dot the fullness is dragged by, within
  // a millimetre or so of the eased run), and how it moves as the fullness changes (it is linear in it)
  const middle = levelOnMesh(grid, bezierAt(P0, P1, P2, P3, 0.5))?.point || points[CURVE_SAMPLES / 2];
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

const JOIN_SPACING_M = 0.002;    // about how far apart a join's samples are
const WIRE_SPACING_M = 0.0025;   // and the wire's, once joined

// How far p is from a run: its distance to the nearest of the run's segments.
function offRun(p, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], d = sub(pts[i], a), l2 = dot(d, d);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t, p[2] - a[2] - d[2] * t));
  }
  return best;
}

/* A polyline (its points and the distance along it at each) at `n` + 1 points
   evenly spaced along it, the ends kept; `indexAt(d)` is the sample nearest d along. */
function resampleAt(pts, at, n) {
  const total = at[at.length - 1], out = [pts[0].slice()];
  for (let s = 1, j = 1; s < n; s++) {
    const d = (total * s) / n;
    while (j < pts.length - 1 && at[j] < d) j++;
    const f = (d - at[j - 1]) / (at[j] - at[j - 1] || 1);
    out.push(pts[j - 1].map((v, c) => v + (pts[j][c] - v) * f));
  }
  out.push(pts[pts.length - 1].slice());
  return { points: out, indexAt: (d) => Math.max(0, Math.min(n, Math.round((d / total) * n))) };
}
const JOIN_REACH = 5;            // how many root samples a join reads the root's direction over

/** One side's wire, from A to C along the breast root about `apex`: the root
 *  from its outer end inward, while it stays below C and off the centre plane,
 *  and each end joined to it round the body about the upright axis there (in the
 *  chart of angle, as a length round at the root's distance from the axis, and
 *  height), leaving the root along its own direction; the join's samples carried
 *  out along their level ray onto the skin, and the run eased. */
function wireRun(grid, side, A, apex, C) {
  const root = breastRoot(grid, apex, side);
  if (root.blocked) return { side, blocked: root.blocked };
  const all = root.samples;
  const zero = all.findIndex((s) => s.deg === 0);
  let lo = zero;
  while (lo > 0 && all[lo - 1].point[1] <= C[1] && Math.abs(all[lo - 1].point[0]) > 1e-9) lo--;
  // outer end first, as the wire runs from A
  const kept = all.slice(lo).reverse();
  if (kept.length <= 2 * JOIN_REACH) return { side, blocked: `the breast root on the ${side} side is too short to follow` };
  const bottom = all[zero].point;
  const axisZ = axisAt(grid, bottom[1]);
  if (axisZ === null) return { side, blocked: `the body does not cross the centre plane below BUST_APEX_${side}` };
  const radius = Math.hypot(bottom[0], bottom[2] - axisZ);
  const chart = (p) => [Math.atan2(p[0], p[2] - axisZ) * radius, p[1]];
  const k = kept.map((s) => chart(s.point));
  const dir = (from, to) => { const d = [to[0] - from[0], to[1] - from[1]], l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; };
  // a join's samples, t in (0, 1), each out along its level ray
  const join = (P0, P1, P2, P3) => {
    const samples = Math.max(8, Math.round(Math.hypot(P3[0] - P0[0], P3[1] - P0[1]) / JOIN_SPACING_M));
    const out = [];
    for (let s = 1; s < samples; s++) {
      const t = s / samples, u = 1 - t;
      const [round, y] = [0, 1].map((i) => u * u * u * P0[i] + 3 * u * u * t * P1[i] + 3 * u * t * t * P2[i] + t * t * t * P3[i]);
      const hit = outAlongLevelRay(grid, [Math.sin(round / radius), y, axisZ + Math.cos(round / radius)], axisZ);
      if (!hit) return null;
      out.push(hit.point);
    }
    return out;
  };
  // from A into the root's outer end, arriving along the root; from its inner end on, into C
  const [a, c, r0, r1] = [chart(A), chart(C), k[0], k[k.length - 1]];
  const t0 = dir(k[JOIN_REACH], r0), t1 = dir(k[k.length - 1 - JOIN_REACH], r1);
  const [l0, l1] = [Math.hypot(a[0] - r0[0], a[1] - r0[1]) / 3, Math.hypot(c[0] - r1[0], c[1] - r1[1]) / 3];
  const in0 = [r0[0] + t0[0] * l0, r0[1] + t0[1] * l0], out1 = [r1[0] + t1[0] * l1, r1[1] + t1[1] * l1];
  // C is on the centre plane, where the two sides meet: each is drawn arriving level, so
  // neither crosses to the other side
  const way = Math.sign(c[0] - r1[0]) || 1;
  const first = join(a, [(a[0] + in0[0]) / 2, (a[1] + in0[1]) / 2], in0, r0);
  const last = join(r1, out1, [c[0] - way * l1, c[1]], c);
  if (!first || !last) return { side, blocked: `the curve leaves the skin on the ${side} side` };
  // the joined run, spaced evenly along itself (the root's profiles are a degree apart, about a
  // millimetre, closer than the joins), then eased across the body
  const joined = [A.slice(), ...first, ...kept.map((s) => s.point.slice()), ...last, C.slice()];
  const at = [0];
  for (let i = 1; i < joined.length; i++) at.push(at[i - 1] + Math.hypot(...sub(joined[i], joined[i - 1])));
  const spaced = resampleAt(joined, at, Math.max(16, Math.round(at[at.length - 1] / WIRE_SPACING_M)));
  // eased along itself in all three directions, ends kept: the root's heights are read off the
  // mesh facet by facet, so they carry its noise too. Not carried back to the skin afterwards: the
  // nearest skin jumps at the facets' edges and puts the kinks back; eased, it stays within half a
  // millimetre of the skin (checked by the gate)
  let points = spaced.points;
  for (let pass = 0; pass < WIRE_EASE_PASSES; pass++) {
    const was = points;
    points = was.map((p, i) => (i === 0 || i === was.length - 1 ? p : p.map((v, c) => (was[i - 1][c] + 2 * v + was[i + 1][c]) / 4)));
  }
  const [followFrom, followTo] = [spaced.indexAt(at[first.length + 1]), spaced.indexAt(at[first.length + kept.length])];
  const jumped = jumpAcross(points, side);
  if (jumped) return { side, blocked: jumped };
  let mid = 1;
  for (let i = 1; i < points.length - 1; i++) if (points[i][1] < points[mid][1]) mid = i;
  return {
    side, from: A, to: C, through: points[mid], length_m: polyLength(points), points,
    leg_lengths_m: [polyLength(points.slice(0, mid + 1)), polyLength(points.slice(mid))],
    root: {
      about: apex, span_deg: [kept[kept.length - 1].deg, kept[0].deg], followed: [followFrom, followTo],
      length_m: polyLength(points.slice(followFrom, followTo)),
      eased_max_m: Math.max(...kept.map((s) => s.moved_m)),
      // how far the drawn wire runs from the root as found, profile by profile
      off_max_m: Math.max(...kept.map((s) => offRun(s.raw_point, points.slice(Math.max(0, followFrom - 1), followTo + 2)))),
    },
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
  // a wire's root is found about a registry landmark on each side (the apex)
  const abouts = curve.kind === 'wire_curve' ? ['L', 'R'].map((side) => curveEnd(curve.root.about, side, straps, landmarks, lines, points)) : [];
  const missing = [...new Set([...ends.flat(), ...abouts].filter((e) => e.needs).map((e) => e.needs))];
  if (missing.length) return { ...curve, blocked: `needs ${missing.join(', ')}`, runs: [] };
  if (curve.kind === 'wire_curve') {
    const runs = [];
    for (const [s, side] of ['L', 'R'].entries()) {
      const run = wireRun(grid, side, ends[s][0].at, abouts[s].at, ends[s][1].at);
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
