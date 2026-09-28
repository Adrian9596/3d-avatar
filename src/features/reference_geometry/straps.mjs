/* --- straps over the shoulder ------------------------------------------------------
   A band of `width_mm` from each mark of one tick to the same side's mark of
   another, over the shoulder, as a strap would lie. Its ends are on the tape the
   ticks stand on: half the width each way along the section from each mark, so
   each end is centred on its tick. Each long edge is the body cut by the upright
   plane through its front and back corner, followed on the skin up from the
   front corner, over the shoulder and down to the tape again on the back; it
   must arrive at the back corner, or the strap says it cannot be laid. The
   width is exact at the ends; over the shoulder it is what the two planes leave,
   reported, not forced. With `front_on`, the front end is moved up to that
   higher tape, keeping the strap where it was: its middle (the upright plane
   through the two ticks) is unchanged, and the front end is centred where that
   middle crosses the higher tape, half the width each way along it. ----------- */

import { sectionSegments } from '../../core/measure_core.mjs';
import { uprightSegments, walkContour, byLength, byCoordinate, polylineLength } from './contour.mjs';

/** Validate the contract's `straps` against the valid ticks. Returns the valid straps. */
export function validateStraps(contract, { errors, heightIds, shapeIds, lines, ticks }) {
  // Straps over the shoulder, from a centre-front tick to a centre-back tick on the same tape.
  const straps = [];
  for (const strap of contract?.straps || []) {
    const problems = [];
    const [from, to] = [strap.from, strap.to].map((id) => ticks.find((t) => t.id === id));
    if (!strap.id || heightIds.has(strap.id) || shapeIds.has(strap.id) || lines.some((l) => l.id === strap.id) || ticks.some((t) => t.id === strap.id) || straps.some((t) => t.id === strap.id)) problems.push('missing or duplicate id');
    if (strap.kind !== 'over_shoulder') problems.push(`unknown kind ${strap.kind}`);
    if (from?.anchor !== 'centre_front') problems.push(`from ${strap.from} is not a valid centre-front tick`);
    if (to?.anchor !== 'centre_back') problems.push(`to ${strap.to} is not a valid centre-back tick`);
    if (from && to && from.on !== to.on) problems.push('the two ticks are on different tapes');
    if (strap.front_on !== undefined && !heightIds.has(strap.front_on)) problems.push(`front_on ${strap.front_on} is not a valid level or reference tape`);
    if (!(Number.isFinite(strap.width_mm) && strap.width_mm > 0)) problems.push('width_mm must be a positive number');
    if (!/^#[0-9a-f]{6}$/i.test(strap.colour || '')) problems.push('colour must be #rrggbb');
    if (typeof strap.label !== 'string' || !strap.label) problems.push('label must be a string');
    if (problems.length) errors.push(`${strap.id || '?'}: ${problems.join('; ')}`);
    else straps.push(strap);
  }
  return straps;
}

// One edge of a strap: from `front` up over the shoulder and down to the height
// of `back` on the back, in the upright plane through `front` and `back`.
function overShoulder(tri, front, back) {
  const run = Math.hypot(back[0] - front[0], back[2] - front[2]);
  const d = [(back[0] - front[0]) / run, 0, (back[2] - front[2]) / run];
  const y = back[1];
  let cleared = false;
  const stop = (a, b) => {
    if (b[0] > Math.max(front[1], y) + 0.01) cleared = true;
    if (!cleared || (a[0] - y) * (b[0] - y) > 0) return null;
    return a[0] === b[0] ? 1 : (y - a[0]) / (b[0] - a[0]);
  };
  const walked = walkContour(uprightSegments(tri, front, d), [front[1], 0], (a, b) => a[0] > b[0], stop);
  if (!walked) return null;
  const points = walked.map(([py, s]) => [front[0] + s * d[0], py, front[2] + s * d[2]]);
  const end = points[points.length - 1];
  return { points, miss_m: Math.hypot(end[0] - back[0], end[1] - back[1], end[2] - back[2]) };
}

// A path that starts on the front and goes up, from where it first reaches `y`.
function fromHeight(points, y) {
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    if (a[1] < y && b[1] >= y) {
      const s = (y - a[1]) / (b[1] - a[1]);
      return [[a[0] + (b[0] - a[0]) * s, y, a[2] + (b[2] - a[2]) * s], ...points.slice(i)];
    }
  }
  return null;
}

export function measureStrap(strap, ticks, heights, tri) {
  const [from, to] = [strap.from, strap.to].map((id) => ticks.find((t) => t.id === id));
  if (!from || !to || from.blocked || to.blocked) return { ...strap, blocked: `needs ${[from, to].some((t) => !t) ? 'both ticks' : [from, to].find((t) => t.blocked).blocked}`, bands: [] };
  const y = heights[from.on];
  const section = sectionSegments(tri, y);
  const yFront = strap.front_on ? heights[strap.front_on] : y;
  if (!Number.isFinite(yFront)) return { ...strap, blocked: `needs ${strap.front_on}`, bands: [] };
  const frontSection = strap.front_on ? sectionSegments(tri, yFront) : section;
  const half = strap.width_mm / 2000;
  const bands = [];
  for (const side of ['L', 'R']) {
    const f = from.marks.find((m) => m.side === side).point;
    const b = to.marks.find((m) => m.side === side).point;
    // the corners: half the width each way along the tape from each mark
    const along = (sec, p, outward) => {
      const w = walkContour(sec, [p[0], p[2]], (a, c) => ((p[0] > 0) === outward ? a[0] > c[0] : a[0] < c[0]), byLength(half));
      return w && [w[w.length - 1][0], p[1], w[w.length - 1][1]];
    };
    const MISS_M = 1e-6;
    const unlaid = { ...strap, blocked: `the skin over the ${side} shoulder does not carry the strap from tick to tick`, bands: [] };
    // the strap's middle: tick to tick over the shoulder; its length is the strap's
    const centre = overShoulder(tri, f, b);
    if (!centre || centre.miss_m > MISS_M) return unlaid;
    if (strap.front_on) {
      centre.points = fromHeight(centre.points, yFront);
      if (!centre.points) return { ...strap, blocked: `the strap does not reach ${strap.front_on} on the ${side} front`, bands: [] };
    }
    const fc = centre.points[0];
    const corners = { front_inner: along(frontSection, fc, false), front_outer: along(frontSection, fc, true), back_inner: along(section, b, false), back_outer: along(section, b, true) };
    if (Object.values(corners).some((c) => !c)) return { ...strap, blocked: `the tape ends before the strap's corners on the ${side} side`, bands: [] };
    const inner = overShoulder(tri, corners.front_inner, corners.back_inner);
    const outer = overShoulder(tri, corners.front_outer, corners.back_outer);
    if (!inner || !outer || [inner, outer].some((e) => e.miss_m > MISS_M)) return unlaid;
    const cut = (sec, h, p, q) => {
      const w = walkContour(sec, [p[0], p[2]], (a, c) => Math.abs(a[0] - q[0]) < Math.abs(c[0] - q[0]), byCoordinate(0, q[0]));
      return w && w.map(([x, z]) => [x, h, z]);
    };
    const frontEnd = cut(frontSection, yFront, corners.front_inner, corners.front_outer);
    const backEnd = cut(section, y, corners.back_outer, corners.back_inner);
    if (!frontEnd || !backEnd) return { ...strap, blocked: `no skin along the strap's ends on the ${side} side`, bands: [] };
    const outline = [...frontEnd, ...outer.points.slice(1), ...backEnd.slice(1), ...inner.points.slice().reverse().slice(1)];
    const topOf = (pts) => pts.reduce((t, p) => (p[1] > t[1] ? p : t));
    const [ti, to_] = [topOf(inner.points), topOf(outer.points)];
    bands.push({
      side,
      corners,
      front_width_m: polylineLength(frontEnd),
      back_width_m: polylineLength(backEnd),
      length_m: polylineLength(centre.points),
      centre: centre.points,
      inner_length_m: polylineLength(inner.points),
      outer_length_m: polylineLength(outer.points),
      top_width_m: Math.hypot(ti[0] - to_[0], ti[1] - to_[1], ti[2] - to_[2]),
      top_y_m: Math.max(ti[1], to_[1]),
      outline,
    });
  }
  return { ...strap, blocked: null, y_m: y, front_y_m: yFront, bands };
}

/** Every declared strap, between the measured ticks. */
export function measureStraps(loaded, measured, tapes, ticks, tri) {
  const heights = {};
  for (const l of measured?.levels || []) heights[l.id] = l.y_m;
  for (const t of tapes || []) heights[t.id] = t.y_m;
  return (loaded.straps || []).map((strap) => measureStrap(strap, ticks, heights, tri));
}
