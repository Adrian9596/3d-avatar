/**
 * Reference levels: the house "how to measure" stack, declared in
 * contracts/measurement-levels.json as inch offsets from a registry landmark and
 * resolved here into horizontal rings on THIS body.
 *
 * A level is a HEIGHT TO LOOK AT, not a POM. It carries no tolerance, no house
 * code, no row in the POM sheet and no entry in measurements.json. The girth it
 * reports is the ordinary section girth this project measures everywhere else —
 * `measureSection` from the shared engine, convex hull, not a second model.
 * Nothing here re-derives a section; if it did, the levels and the POMs could
 * disagree about the same slice of the same body, which is the failure the
 * parity gate exists to make impossible.
 *
 * What does NOT transfer from the sheets: the reference figure's dimensions. The
 * sheets are a different body. Only the protocol — which offsets, from which
 * landmark — crosses over, and the contract says so in its declared limits.
 *
 * Honest failure: without the datum landmark this returns `needs [...]` and no
 * geometry, the same discipline the POM table's blocked_until_manual uses. A
 * level whose height lands where sections are unreliable (above the armhole,
 * outside the registry's scan) is resolved and drawn but reports no girth, with
 * the reason attached — visible absence beats a plausible number.
 *
 * scripts/test_single_engine.mjs checks the app draws levels through this
 * module and cannot redefine the section maths, so a level and a POM can never
 * disagree about the same slice of the same body.
 */

import { measureSection, sectionSegments, inchFraction } from './measure_core.mjs';
import { surfaceRun, closestOnMesh } from './surface_path.mjs';

export const METRES_PER_INCH = 0.0254;
export const LEVELS_LIMIT = 'Reference levels are heights from the underbust line, not a fit recommendation and not a size.';

/**
 * Validate the contract against the registry. Returns { levels, groups, datum,
 * errors, declared_limit }; `levels` holds only the entries that validated, so a
 * broken row drops out instead of drawing a ring nobody declared.
 */
export function loadLevels(contract, registry) {
  const errors = [];
  const known = new Set((registry?.landmarks || []).map((l) => l.id));
  const groups = contract?.groups || {};
  const datum = contract?.datum?.landmark || null;

  if (!datum) errors.push('no datum landmark declared');
  else if (known.size && !known.has(datum)) errors.push(`datum ${datum} is not a registry landmark`);

  const metresPerInch = contract?.unit?.metres_per_inch;
  if (metresPerInch !== METRES_PER_INCH) errors.push(`unit.metres_per_inch must be ${METRES_PER_INCH}`);

  const ids = new Set();
  const offsets = new Set();
  const levels = [];
  for (const level of contract?.levels || []) {
    const problems = [];
    if (!level.id || ids.has(level.id)) problems.push('missing or duplicate id');
    ids.add(level.id);
    if (!Number.isFinite(level.offset_in)) problems.push('offset_in must be a number');
    else if (offsets.has(level.offset_in)) problems.push(`two levels at ${level.offset_in}in`);
    offsets.add(level.offset_in);
    // The sheets print quarter inches; a value off that grid is a typo, not a level.
    if (Number.isFinite(level.offset_in) && Math.abs(level.offset_in * 4 - Math.round(level.offset_in * 4)) > 1e-9) {
      problems.push(`${level.offset_in}in is not a quarter of an inch`);
    }
    if (!groups[level.group]) problems.push(`unknown group ${level.group}`);
    if (level.label_in === undefined) problems.push('label_in must be a string or null (null = the unlabelled datum ring)');
    // a tape level is also drawn as a tape in the measurement table; the datum already is the underbust
    if (level.tape !== undefined && typeof level.tape !== 'boolean') problems.push('tape must be true or false');
    if (level.tape && level.offset_in === 0) problems.push('the 0 ring is the underbust POM\'s own tape');
    if (problems.length) errors.push(`${level.id || '?'}: ${problems.join('; ')}`);
    else levels.push(level);
  }
  // Top to bottom is how the sheets read and how the panel lists them.
  const ordered = levels.every((l, i) => i === 0 || levels[i - 1].offset_in > l.offset_in);
  if (!ordered) errors.push('levels must be ordered top to bottom by offset_in');
  const zeros = levels.filter((l) => l.offset_in === 0);
  if (zeros.length !== 1) errors.push(`expected exactly one level at 0in, found ${zeros.length}`);
  else if (zeros[0].label_in !== null) errors.push('the 0 level is the sheets\' unlabelled ring: label_in must be null');

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

  // Reference tapes hang on a registry height other than the datum -- a
  // plane-section POM's own level, such as the largest girth. Same inch grid.
  const planePoms = new Set((registry?.poms || []).filter((p) => p.method === 'plane_section').map((p) => p.id));
  const tapes = [];
  for (const tape of contract?.reference_tapes || []) {
    const problems = [];
    if (!tape.id || ids.has(tape.id) || shapeIds.has(tape.id) || tapes.some((t) => t.id === tape.id)) problems.push('missing or duplicate id');
    if (!(known.has(tape.from) || planePoms.has(tape.from))) problems.push(`from ${tape.from} is not a registry landmark or plane-section POM`);
    if (!Number.isFinite(tape.offset_in) || tape.offset_in === 0) problems.push('offset_in must be a non-zero number');
    else if (Math.abs(tape.offset_in * 4 - Math.round(tape.offset_in * 4)) > 1e-9) problems.push(`${tape.offset_in}in is not a quarter of an inch`);
    if (typeof tape.label !== 'string' || !tape.label) problems.push('label must be a string');
    if (problems.length) errors.push(`${tape.id || '?'}: ${problems.join('; ')}`);
    else tapes.push(tape);
  }

  // Centre-back lines join two of the heights above (a level or a reference
  // tape) straight down the back.
  const lines = [];
  const heightIds = new Set([...levels.map((l) => l.id), ...tapes.map((t) => t.id)]);
  for (const line of contract?.lines || []) {
    const problems = [];
    if (!line.id || heightIds.has(line.id) || shapeIds.has(line.id) || lines.some((l) => l.id === line.id)) problems.push('missing or duplicate id');
    if (line.kind !== 'centre_back') problems.push(`unknown kind ${line.kind}`);
    for (const end of ['from', 'to']) if (!heightIds.has(line[end])) problems.push(`${end} ${line[end]} is not a valid level or reference tape`);
    if (line.from === line.to) problems.push('from and to are the same height');
    if (typeof line.label !== 'string' || !line.label) problems.push('label must be a string');
    if (problems.length) errors.push(`${line.id || '?'}: ${problems.join('; ')}`);
    else lines.push(line);
  }

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

  // Curves on the skin from a strap corner to a registry landmark, one per side.
  const CORNERS = ['front_inner', 'front_outer', 'back_inner', 'back_outer'];
  const curves = [];
  for (const curve of contract?.curves || []) {
    const problems = [];
    if (!curve.id || heightIds.has(curve.id) || shapeIds.has(curve.id) || lines.some((l) => l.id === curve.id) || ticks.some((t) => t.id === curve.id) || straps.some((t) => t.id === curve.id) || curves.some((c) => c.id === curve.id)) problems.push('missing or duplicate id');
    if (!['shortest_surface_path', 'tangent_curve'].includes(curve.kind)) problems.push(`unknown kind ${curve.kind}`);
    if (curve.kind === 'tangent_curve') {
      for (const end of ['from', 'to']) {
        const h = curve.handles?.[end];
        if (!(Number.isFinite(h?.angle_deg) && Math.abs(h.angle_deg) <= 180)) problems.push(`handles.${end}.angle_deg must be a number of degrees`);
        if (!(Number.isFinite(h?.length_mm) && h.length_mm > 0)) problems.push(`handles.${end}.length_mm must be a positive number`);
      }
    }
    if (!straps.some((s) => s.id === curve.from?.strap)) problems.push(`from strap ${curve.from?.strap} is not a valid strap`);
    if (!CORNERS.includes(curve.from?.corner)) problems.push(`from corner ${curve.from?.corner} is not one of ${CORNERS.join(', ')}`);
    for (const side of ['L', 'R']) if (!known.has(`${curve.to?.landmark}_${side}`)) problems.push(`to ${curve.to?.landmark}_${side} is not a registry landmark`);
    if (!/^#[0-9a-f]{6}$/i.test(curve.colour || '')) problems.push('colour must be #rrggbb');
    if (typeof curve.label !== 'string' || !curve.label) problems.push('label must be a string');
    if (problems.length) errors.push(`${curve.id || '?'}: ${problems.join('; ')}`);
    else curves.push(curve);
  }

  // Points on the skin, an offset up and then forward from a registry landmark, one per side.
  const points = [];
  const taken = (id) => heightIds.has(id) || shapeIds.has(id) || [lines, ticks, straps, curves, points].some((list) => list.some((x) => x.id === id));
  for (const point of contract?.points || []) {
    const problems = [];
    if (!point.id || taken(point.id)) problems.push('missing or duplicate id');
    if (point.kind !== 'offset_on_skin') problems.push(`unknown kind ${point.kind}`);
    for (const side of ['L', 'R']) if (!known.has(`${point.from?.landmark}_${side}`)) problems.push(`from ${point.from?.landmark}_${side} is not a registry landmark`);
    for (const key of ['up_in', 'forward_in']) if (!(Number.isFinite(point[key]) && point[key] >= 0)) problems.push(`${key} must be a number of inches, 0 or more`);
    if (!/^#[0-9a-f]{6}$/i.test(point.colour || '')) problems.push('colour must be #rrggbb');
    if (typeof point.label !== 'string' || !point.label) problems.push('label must be a string');
    if (problems.length) errors.push(`${point.id || '?'}: ${problems.join('; ')}`);
    else points.push(point);
  }

  return {
    levels,
    shapes,
    tapes,
    lines,
    ticks,
    straps,
    curves,
    points,
    groups,
    datum,
    errors,
    declared_limit: contract?.declared_limit || LEVELS_LIMIT,
    max_y_m: contract?.reliability?.max_y_m ?? null,
  };
}

/**
 * The height of every level from a landmark map, or what is missing.
 * `landmarks` is { ID: [x, y, z] } or { ID: y } — the datum is a height, and the
 * registry records some landmarks as a level and some as a point.
 */
export function resolveLevels(loaded, landmarks) {
  const mark = landmarks?.[loaded.datum];
  const datumY = Array.isArray(mark) ? mark[1] : (typeof mark === 'number' ? mark : null);
  if (!Number.isFinite(datumY)) return { needs: [loaded.datum] };
  return {
    datum: loaded.datum,
    datum_y_m: datumY,
    levels: loaded.levels.map((level) => ({
      ...level,
      y_m: datumY + level.offset_in * METRES_PER_INCH,
    })),
  };
}

/**
 * Reason a level cannot be measured here, or null. Kept separate from the
 * measuring so the viewer can draw a ring it may not report a number for.
 */
export function outOfRange(y, { scan, maxY }) {
  if (Number.isFinite(maxY) && y > maxY) {
    return `above y = ${maxY}m, where the torso is open at the armhole and a section is not a closed body ring`;
  }
  if (scan && (y < scan.from_m || y > scan.to_m)) {
    return `outside the registry scan ${scan.from_m}–${scan.to_m}m`;
  }
  return null;
}

/**
 * Measure every resolved level on this body. Each entry keeps its ring (for
 * drawing, whenever the mesh has one — even a level outside the trustworthy
 * range usually still has geometry there, just not a girth this project will
 * report) and either a girth or the reason there is none — never both, and
 * never a number where the section is not trustworthy. `blocked` and `section`
 * are independent: a level can be blocked (no girth) while still drawable, and
 * is only undrawable when the mesh genuinely has no closed section there.
 */
export function measureLevels(resolved, tri, { scan = null, maxY = null, inchDenominator = 8 } = {}) {
  if (resolved.needs) return resolved;
  return {
    ...resolved,
    levels: resolved.levels.map((level) => {
      const rangeReason = outOfRange(level.y_m, { scan, maxY });
      const section = measureSection(tri, level.y_m);
      const blocked = rangeReason || (section ? null : 'no closed section at this height');
      if (blocked) {
        return { ...level, section, girth_m: null, girth_in: null, blocked };
      }
      return {
        ...level,
        section,
        girth_m: section.girth,
        girth_in: inchFraction(section.girth, inchDenominator),
        blocked: null,
      };
    }),
  };
}

/** What a level says in a list: its printed label, or the datum's own name. */
export function levelLabel(level, groups) {
  return level.label_in || `0" · ${groups?.[level.group]?.label_en || 'datum'}`;
}

/** The record an export carries: the protocol, the datum it hung on, and the limits. */
export function levelsRecord(measured, loaded, provenance = 'auto') {
  if (measured.needs) return { needs: measured.needs, limit: loaded.declared_limit };
  return {
    datum: { landmark: measured.datum, y_m: Number(measured.datum_y_m.toFixed(5)), source: provenance },
    levels: measured.levels.map((l) => ({
      id: l.id,
      offset_in: l.offset_in,
      label: l.label_in,
      tape: Boolean(l.tape),
      y_m: Number(l.y_m.toFixed(5)),
      girth_mm: l.girth_m === null ? null : Number((l.girth_m * 1000).toFixed(1)),
      blocked: l.blocked,
    })),
    limit: loaded.declared_limit,
  };
}

/* --- reference shapes --------------------------------------------------------
   A rectangle laid on the skin the way a tape would lay it: every side is
   measured along the surface, not across it. The bottom edge runs along the
   level's own section, half the width each way from the centre-back point;
   the sides run straight up the back in the vertical planes through those two
   corners for the height; the top edge follows the section at the height the
   sides reach. On a mirrored body both sides reach the same height. The top
   edge is not forced to the width: its measured length is reported, so a back
   that narrows says so. ------------------------------------------------------ */

// The body cut by the vertical plane x = `x`, as [[y, z], [y, z]] segments.
function verticalSegments(tri, x) {
  const segments = [];
  for (let t = 0; t < tri.length; t += 9) {
    const ax = tri[t], bx = tri[t + 3], cx = tri[t + 6];
    if ((ax < x && bx < x && cx < x) || (ax > x && bx > x && cx > x)) continue;
    const hits = [];
    for (let e = 0; e < 3; e++) {
      const i = t + e * 3;
      const j = t + ((e + 1) % 3) * 3;
      const d0 = tri[i] - x;
      const d1 = tri[j] - x;
      if ((d0 > 0) !== (d1 > 0)) {
        const s = d0 / (d0 - d1);
        hits.push([tri[i + 1] + (tri[j + 1] - tri[i + 1]) * s, tri[i + 2] + (tri[j + 2] - tri[i + 2]) * s]);
      }
    }
    if (hits.length === 2) segments.push([hits[0], hits[1]]);
  }
  return segments;
}

// Where a contour crosses u = `u` (the back-most crossing: least v; the
// front-most with `front`), or null.
function backCrossing(segments, u, front = false) {
  let best = null;
  for (const [a, b] of segments) {
    if ((a[0] - u > 0) === (b[0] - u > 0) || a[0] === b[0]) continue;
    const s = (u - a[0]) / (b[0] - a[0]);
    const v = a[1] + (b[1] - a[1]) * s;
    if (!best || (front ? v > best[1] : v < best[1])) best = [u, v];
  }
  return best;
}

/* Walk a contour from `from` (a point on it), first toward the end of its
   segment that `ahead` prefers, until `stop(a, b)` returns where along the step
   a -> b to end (0..1) or null to keep going. Returns the points walked, or null
   if the contour ends first. */
function walkContour(segments, from, ahead, stop) {
  const key = (p) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;
  const nodes = new Map();
  const node = (p) => {
    const k = key(p);
    if (!nodes.has(k)) nodes.set(k, { p, next: [] });
    return nodes.get(k);
  };
  let start = null;
  let startGap = Infinity;
  for (const [a, b] of segments) {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= 0) continue;
    const na = node(a), nb = node(b);
    na.next.push(nb);
    nb.next.push(na);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const s = Math.max(0, Math.min(1, ((from[0] - a[0]) * dx + (from[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    const gap = Math.hypot(a[0] + dx * s - from[0], a[1] + dy * s - from[1]);
    if (gap < startGap) { startGap = gap; start = [na, nb]; }
  }
  if (!start || startGap > 1e-6) return null;
  let current = ahead(start[0].p, start[1].p) ? start[0] : start[1];
  let previous = current === start[0] ? start[1] : start[0];
  const points = [from];
  let at = from;
  for (let guard = 0; guard < nodes.size + 2; guard++) {
    const t = stop(at, current.p);
    if (t !== null) {
      points.push([at[0] + (current.p[0] - at[0]) * t, at[1] + (current.p[1] - at[1]) * t]);
      return points;
    }
    points.push(current.p);
    at = current.p;
    const options = current.next.filter((n) => n !== previous);
    if (!options.length) return null;
    previous = current;
    current = options[0];
  }
  return null;
}

const byLength = (length) => {
  let left = length;
  return (a, b) => {
    const step = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (step >= left) return left / step;
    left -= step;
    return null;
  };
};
const byCoordinate = (index, target) => (a, b) => {
  if ((a[index] - target) * (b[index] - target) > 0) return null;
  return a[index] === b[index] ? 1 : (target - a[index]) / (b[index] - a[index]);
};
const polylineLength = (pts) => pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]) : 0), 0);

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

/* --- reference tapes from another height -------------------------------------
   A tape `offset_in` from a registry height that is not the datum (the
   largest-girth level, say). Below the reliability ceiling it is an ordinary
   level: the shared engine's section, its girth, its hull ring. Above it the
   torso is open at the armholes, so there is no girth to report; the tape is
   drawn as the pieces of the section that lie on the skin (front and back),
   each with its own length, and the reason is attached. ---------------------- */

// The section at `y` as ordered [x, y, z] polylines: one closed loop, or the
// open pieces between the holes.
export function sectionChains(tri, y) {
  const key = (p) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;
  const nodes = new Map();
  const node = (p) => {
    const k = key(p);
    if (!nodes.has(k)) nodes.set(k, { p, next: [] });
    return nodes.get(k);
  };
  for (const [a, b] of sectionSegments(tri, y)) {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= 0) continue;
    const na = node(a), nb = node(b);
    na.next.push(nb);
    nb.next.push(na);
  }
  const seen = new Set();
  const walk = (start) => {
    const out = [start];
    seen.add(start);
    let current = start;
    for (;;) {
      const next = current.next.find((n) => !seen.has(n));
      if (!next) break;
      out.push(next);
      seen.add(next);
      current = next;
    }
    if (out.length > 2 && current.next.includes(start)) out.push(start);
    return out.map((n) => [n.p[0], y, n.p[1]]);
  };
  const chains = [];
  // open pieces first, from their ends, so none is started in its middle
  for (const n of nodes.values()) if (n.next.length === 1 && !seen.has(n)) chains.push(walk(n));
  for (const n of nodes.values()) if (!seen.has(n)) chains.push(walk(n));
  // stray slivers (a triangle's worth) are not a tape
  return chains.filter((c) => polylineLength(c) > 0.01);
}

/** Every reference tape on this body. `heights` maps a registry id to its y. */
export function measureReferenceTapes(loaded, heights, tri, { scan = null, maxY = null, inchDenominator = 8 } = {}) {
  return (loaded.tapes || []).map((tape) => {
    const from = heights?.[tape.from];
    if (!Number.isFinite(from)) return { ...tape, y_m: null, chains: [], girth_m: null, blocked: `needs ${tape.from}` };
    const y = from + tape.offset_in * METRES_PER_INCH;
    const rangeReason = outOfRange(y, { scan, maxY });
    const section = measureSection(tri, y);
    const chains = sectionChains(tri, y);
    if (rangeReason || !section) {
      return {
        ...tape, y_m: y, from_y_m: from, section: null, chains, girth_m: null, girth_in: null,
        pieces_m: chains.map(polylineLength),
        blocked: rangeReason || 'no closed section at this height',
      };
    }
    return {
      ...tape, y_m: y, from_y_m: from, section, chains, girth_m: section.girth,
      girth_in: inchFraction(section.girth, inchDenominator), blocked: null,
    };
  });
}

/* --- centre-back lines ---------------------------------------------------------
   Straight down the back: the body cut by the centre plane x = 0, followed on
   the skin from the centre back of one height to the centre back of the other.
   The length is along the skin, the way a tape laid down the spine reads it;
   the straight chord between the ends is reported beside it. ------------------ */

export function measureLine(line, heights, tri) {
  const ys = [heights[line.from], heights[line.to]];
  if (!ys.every(Number.isFinite)) return { ...line, blocked: `needs ${[line.from, line.to].filter((id) => !Number.isFinite(heights[id])).join(', ')}`, points: [] };
  const [yTop, yBottom] = ys[0] >= ys[1] ? ys : [ys[1], ys[0]];
  const cb = backCrossing(sectionSegments(tri, yTop), 0);
  if (!cb) return { ...line, blocked: 'no centre back at the upper end', points: [] };
  const down = walkContour(verticalSegments(tri, 0), [yTop, cb[1]], (a, b) => a[0] < b[0], byCoordinate(0, yBottom));
  if (!down) return { ...line, blocked: 'the back ends before the lower end', points: [] };
  const points = down.map(([y, z]) => [0, y, z]);
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

/** Every declared line, with the heights of the measured levels and tapes. */
export function measureLines(loaded, measured, tapes, tri) {
  const heights = {};
  for (const l of measured?.levels || []) heights[l.id] = l.y_m;
  for (const t of tapes || []) heights[t.id] = t.y_m;
  return (loaded.lines || []).map((line) => measureLine(line, heights, tri));
}

/* --- tick marks ------------------------------------------------------------------
   A short mark across a level or tape, `offset_in` along it from its centre back
   (or centre front) on each side (walked on the section, as a tape measures). The mark
   stands upright across the (horizontal) tape: it is the vertical cut through
   the point, x = const, followed on the skin half its length up and half down,
   so from the front or the back it reads square to the tape however the chest
   curves there. -------------------------------------------------------------------- */

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

// The body cut by the upright plane through `origin` along the horizontal unit
// direction `d`, as [[y, s], [y, s]] segments (s measured along d from origin).
function uprightSegments(tri, origin, d) {
  const n = [d[2], 0, -d[0]];
  const segments = [];
  for (let t = 0; t < tri.length; t += 9) {
    const dist = [0, 1, 2].map((k) => (tri[t + k * 3] - origin[0]) * n[0] + (tri[t + k * 3 + 2] - origin[2]) * n[2]);
    if ((dist[0] < 0 && dist[1] < 0 && dist[2] < 0) || (dist[0] > 0 && dist[1] > 0 && dist[2] > 0)) continue;
    const hits = [];
    for (let e = 0; e < 3; e++) {
      const i = t + e * 3, j = t + ((e + 1) % 3) * 3;
      const d0 = dist[e], d1 = dist[(e + 1) % 3];
      if ((d0 > 0) !== (d1 > 0)) {
        const s = d0 / (d0 - d1);
        const x = tri[i] + (tri[j] - tri[i]) * s, z = tri[i + 2] + (tri[j + 2] - tri[i + 2]) * s;
        hits.push([tri[i + 1] + (tri[j + 1] - tri[i + 1]) * s, (x - origin[0]) * d[0] + (z - origin[2]) * d[2]]);
      }
    }
    if (hits.length === 2) segments.push([hits[0], hits[1]]);
  }
  return segments;
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

/* --- curves from a strap to a landmark ---------------------------------------------
   The cup armhole, say: from a corner of a strap to a registry landmark on the
   same side (its _L / _R point).

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
   pair shapes both sides, mirrored, as the body is. ---------------------------- */

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
  const normal = closestOnMesh(grid, origin)?.normal || [0, 0, 1];
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

/** One side's tangent curve from its two frames and the handle pair. */
function tangentRun(grid, side, frames, handles, guideLength) {
  const [P0, P3] = [frames.from.origin, frames.to.origin];
  const [P1, P2] = [handleTip(grid, frames.from, handles.from), handleTip(grid, frames.to, handles.to)];
  const points = [P0.slice()];
  let jump = 0;
  for (let s = 1; s < CURVE_SAMPLES; s++) {
    const t = s / CURVE_SAMPLES, u = 1 - t;
    const b = [0, 1, 2].map((i) => u * u * u * P0[i] + 3 * u * u * t * P1[i] + 3 * u * t * t * P2[i] + t * t * t * P3[i]);
    const hit = closestOnMesh(grid, b);
    if (!hit) return { side, blocked: `the curve leaves the skin on the ${side} side` };
    points.push(hit.point);
  }
  points.push(P3.slice());
  const length = polyLength(points);
  for (let i = 1; i < points.length; i++) jump = Math.max(jump, Math.hypot(...sub(points[i], points[i - 1])));
  // carried across a gap in the skin (the armhole opening) rather than along it
  if (jump > Math.max(0.012, (6 * length) / CURVE_SAMPLES)) return { side, blocked: `the curve jumps ${(jump * 1000).toFixed(0)}mm across the skin on the ${side} side` };
  return {
    side, from: P0, to: P3, length_m: length, points, guide_length_m: guideLength,
    frames,
    tangents: [
      { end: 'from', tip: P1, points: onSkin(grid, P0, P1, TANGENT_SAMPLES) },
      { end: 'to', tip: P2, points: onSkin(grid, P3, P2, TANGENT_SAMPLES) },
    ],
  };
}

/** Re-shape a measured tangent curve with a new handle pair, both sides, without
 *  finding the shortest path again (its frames are kept on each run). */
export function bendCurve(measured, handles, grid) {
  if (measured.blocked || measured.kind !== 'tangent_curve') return measured;
  const runs = [];
  for (const run of measured.runs) {
    const next = tangentRun(grid, run.side, run.frames, handles, run.guide_length_m);
    if (next.blocked) return { ...measured, handles, blocked: next.blocked, runs: [] };
    runs.push(next);
  }
  return { ...measured, handles, blocked: null, runs };
}

/** `landmarks` maps a registry id to [x, y, z]; `grid` is surface_path's buildGrid.
 *  `handles` overrides a tangent curve's contract handles ({ from, to }). */
export function measureCurve(curve, straps, landmarks, grid, handles = null) {
  const strap = straps.find((s) => s.id === curve.from.strap);
  if (!strap || strap.blocked) return { ...curve, blocked: `needs ${curve.from.strap}`, runs: [] };
  const missing = ['L', 'R'].map((side) => `${curve.to.landmark}_${side}`).filter((id) => !Array.isArray(landmarks?.[id]));
  if (missing.length) return { ...curve, blocked: `needs ${missing.join(', ')}`, runs: [] };
  const use = curve.kind === 'tangent_curve' ? (handles || curve.handles) : null;
  const runs = [];
  for (const side of ['L', 'R']) {
    const from = strap.bands.find((b) => b.side === side).corners[curve.from.corner];
    const to = landmarks[`${curve.to.landmark}_${side}`];
    const run = surfaceRun(grid, from, to);
    if (!run.onSurface) return { ...curve, blocked: `no path over the skin on the ${side} side`, runs: [] };
    if (!use) { runs.push({ side, from, to, length_m: run.length, points: run.points }); continue; }
    const frames = { from: handleFrame(grid, run.points, false), to: handleFrame(grid, run.points, true) };
    const bent = tangentRun(grid, side, frames, use, run.length);
    if (bent.blocked) return { ...curve, handles: use, blocked: bent.blocked, runs: [] };
    runs.push(bent);
  }
  return { ...curve, handles: use, blocked: null, runs };
}

/** Every declared curve, from the measured straps. `handles` maps a curve id to a
 *  handle pair that overrides the contract's (the viewer's dragged ones). */
export function measureCurves(loaded, straps, landmarks, grid, handles = {}) {
  return (loaded.curves || []).map((curve) => measureCurve(curve, straps, landmarks, grid, handles[curve.id] || null));
}

/* --- points offset from a landmark -------------------------------------------------
   A point found the way a tape finds it on a form: from a registry landmark on
   each side (the wing top, say), `up_in` straight up the skin -- the upright
   cut through the landmark square to the body's side, x along the side and y
   up -- and then `forward_in` toward the front along the level section at the
   height reached. Both distances are on the skin. -------------------------------- */

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

/** `landmarks` maps a registry id to [x, y, z]. */
export function measurePoint(point, landmarks, tri) {
  const missing = ['L', 'R'].map((side) => `${point.from.landmark}_${side}`).filter((id) => !Array.isArray(landmarks?.[id]));
  if (missing.length) return { ...point, blocked: `needs ${missing.join(', ')}`, marks: [] };
  const up = point.up_in * METRES_PER_INCH, forward = point.forward_in * METRES_PER_INCH;
  const marks = [];
  for (const side of ['L', 'R']) {
    const base = landmarks[`${point.from.landmark}_${side}`];
    // up: the upright cut through the landmark along x (the plane z = its z), as [y, s]
    const d = [Math.sign(base[0]) || 1, 0, 0];
    const cut = uprightSegments(tri, base, d);
    const start = onContour(cut, [base[1], 0]);
    if (!start.point || start.gap > SNAP_M) return { ...point, blocked: `${point.from.landmark}_${side} is not on the skin`, marks: [] };
    const rise = up > 0 ? walkContour(cut, start.point, (a, b) => a[0] > b[0], byLength(up)) : [start.point];
    if (!rise) return { ...point, blocked: `the skin ends before ${point.up_in}in up on the ${side} side`, marks: [] };
    const upPath = rise.map(([y, s]) => [base[0] + s * d[0], y, base[2]]);
    const top = upPath[upPath.length - 1];
    // forward: along the level section at that height, toward the front (+z)
    const section = sectionSegments(tri, top[1]);
    const on = onContour(section, [top[0], top[2]]);
    if (!on.point || on.gap > SNAP_M) return { ...point, blocked: `no level section through the ${side} side ${point.up_in}in up`, marks: [] };
    const ahead = forward > 0 ? walkContour(section, on.point, (a, b) => a[1] > b[1], byLength(forward)) : [on.point];
    if (!ahead) return { ...point, blocked: `the section ends before ${point.forward_in}in forward on the ${side} side`, marks: [] };
    const forwardPath = ahead.map(([x, z]) => [x, top[1], z]);
    marks.push({
      side, from: base, top, point: forwardPath[forwardPath.length - 1],
      up_m: polylineLength(upPath), forward_m: polylineLength(forwardPath),
      up_path: upPath, forward_path: forwardPath,
    });
  }
  return { ...point, blocked: null, marks };
}

/** Every declared point. */
export function measurePoints(loaded, landmarks, tri) {
  return (loaded.points || []).map((point) => measurePoint(point, landmarks, tri));
}
