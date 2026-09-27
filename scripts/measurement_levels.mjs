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
    if (tick.anchor !== 'centre_back') problems.push(`unknown anchor ${tick.anchor}`);
    if (!(Number.isFinite(tick.offset_in) && tick.offset_in > 0)) problems.push('offset_in must be a positive number');
    if (!(Number.isFinite(tick.length_mm) && tick.length_mm > 0)) problems.push('length_mm must be a positive number');
    if (!/^#[0-9a-f]{6}$/i.test(tick.colour || '')) problems.push('colour must be #rrggbb');
    if (problems.length) errors.push(`${tick.id || '?'}: ${problems.join('; ')}`);
    else ticks.push(tick);
  }

  return {
    levels,
    shapes,
    tapes,
    lines,
    ticks,
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

// Where a contour crosses u = `u` (the back-most crossing: least v), or null.
function backCrossing(segments, u) {
  let best = null;
  for (const [a, b] of segments) {
    if ((a[0] - u > 0) === (b[0] - u > 0) || a[0] === b[0]) continue;
    const s = (u - a[0]) / (b[0] - a[0]);
    const v = a[1] + (b[1] - a[1]) * s;
    if (!best || v < best[1]) best = [u, v];
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
   on each side (walked on the section, as a tape measures). The mark crosses the
   tape at right angles on the skin: its direction is the surface's own, taken
   from the section's tangent and the vertical cut through the point, and it is
   centred on the tape. ------------------------------------------------------------ */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const n = Math.hypot(...a) || 1; return a.map((v) => v / n); };

export function measureTick(tick, heights, tri) {
  const y = heights[tick.on];
  if (!Number.isFinite(y)) return { ...tick, blocked: `needs ${tick.on}`, marks: [] };
  const section = sectionSegments(tri, y);
  const cb = backCrossing(section, 0);
  if (!cb) return { ...tick, blocked: 'no centre back on that section', marks: [] };
  const along = tick.offset_in * METRES_PER_INCH;
  const half = tick.length_mm / 2000;
  const marks = [];
  for (const side of ['L', 'R']) {
    const walked = walkContour(section, cb, (a, b) => (side === 'R' ? a[0] > b[0] : a[0] < b[0]), byLength(along));
    if (!walked) return { ...tick, blocked: `the section ends before ${tick.offset_in}in on the ${side} side`, marks: [] };
    const [x, z] = walked[walked.length - 1];
    const [px, pz] = walked[walked.length - 2];
    const point = [x, y, z];
    const tangent = unit([x - px, 0, z - pz]);
    // the skin's vertical direction here: a short walk each way in the plane x = const
    const vertical = verticalSegments(tri, x);
    const up = walkContour(vertical, [y, z], (a, b) => a[0] > b[0], byLength(half));
    const down = walkContour(vertical, [y, z], (a, b) => a[0] < b[0], byLength(half));
    if (!up || !down) return { ...tick, blocked: `no skin across the tape on the ${side} side`, marks: [] };
    const [uy, uz] = up[up.length - 1], [dy, dz] = down[down.length - 1];
    const normal = cross(tangent, unit([0, uy - dy, uz - dz]));
    let across = unit(cross(normal, tangent));
    if (across[1] < 0) across = across.map((v) => -v);
    marks.push({
      side,
      point,
      arc_m: polylineLength(walked.map(([wx, wz]) => [wx, y, wz])),
      points: [-half, 0, half].map((t) => point.map((v, i) => v + across[i] * t)),
      tangent,
      normal: unit(normal),
    });
  }
  return { ...tick, blocked: null, y_m: y, centre_back: [0, y, cb[1]], marks };
}

/** Every declared tick, on the heights of the measured levels and tapes. */
export function measureTicks(loaded, measured, tapes, tri) {
  const heights = {};
  for (const l of measured?.levels || []) heights[l.id] = l.y_m;
  for (const t of tapes || []) heights[t.id] = t.y_m;
  return (loaded.ticks || []).map((tick) => measureTick(tick, heights, tri));
}
