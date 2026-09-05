/**
 * Shared measurement engine.
 *
 * The browser viewer and the Node parity test import THIS module, so "the
 * viewer agrees with the test" is true by construction rather than by
 * copy-paste. The Python authority pass (scripts/measure_avatar.py) is a
 * deliberately independent re-implementation; scripts/test_measurement_parity.mjs
 * asserts the two agree inside the registry's tolerance.
 *
 * Geometry contract: triangles arrive as a flat Float32Array of world-space
 * coordinates, 9 numbers per triangle. The asset is Y-up with the body facing
 * +Z, so a horizontal section is taken at constant Y and its 2D coordinates are
 * (x, z); front-most means maximum z.
 *
 * Girth is the perimeter of the CONVEX HULL of a section, not of the raw
 * contour: a tape bridges concavities (the cleavage gap, the spinal groove)
 * instead of sinking into them. On this body the raw contour over-reports the
 * bust by ~20mm.
 */

import { surfaceRun } from './surface_path.mjs';

export const DEFAULT_SCAN = { from_m: 1.05, to_m: 1.56, step_m: 0.005 };
export const DEFAULT_INCH_DENOMINATOR = 8;

/** Intersect triangles with the horizontal plane at `y`. Returns segments as
 *  [[x,z],[x,z]] pairs, which lets callers take either a hull or a contour. */
export function sectionSegments(tri, y) {
  const segments = [];
  for (let t = 0; t < tri.length; t += 9) {
    const ay = tri[t + 1], by = tri[t + 4], cy = tri[t + 7];
    if ((ay < y && by < y && cy < y) || (ay > y && by > y && cy > y)) continue;
    const hits = [];
    for (let e = 0; e < 3; e++) {
      const i = t + e * 3;
      const j = t + ((e + 1) % 3) * 3;
      const d0 = tri[i + 1] - y;
      const d1 = tri[j + 1] - y;
      if ((d0 > 0) !== (d1 > 0)) {
        const s = d0 / (d0 - d1);
        hits.push([tri[i] + (tri[j] - tri[i]) * s, tri[i + 2] + (tri[j + 2] - tri[i + 2]) * s]);
      }
    }
    if (hits.length === 2) segments.push([hits[0], hits[1]]);
  }
  return segments;
}

export function segmentPoints(segments) {
  const points = [];
  for (const [a, b] of segments) { points.push(a); points.push(b); }
  return points;
}

/** Andrew monotone chain. Input/output are [x, y] pairs. */
export function convexHull(points) {
  if (points.length < 3) return points.slice();
  const seen = new Set();
  const unique = [];
  for (const p of points) {
    const key = `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
    if (!seen.has(key)) { seen.add(key); unique.push(p); }
  }
  unique.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (unique.length < 3) return unique;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (sequence) => {
    const stack = [];
    for (const p of sequence) {
      while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], p) <= 0) stack.pop();
      stack.push(p);
    }
    stack.pop();
    return stack;
  };
  return build(unique).concat(build(unique.slice().reverse()));
}

export function ringPerimeter(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
}

export function contourLength(segments) {
  let sum = 0;
  for (const [a, b] of segments) sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  return sum;
}

/** One section, fully characterised. `front*` are the furthest-forward reaches,
 *  split by side so a per-side bust apex can be found. */
export function measureSection(tri, y) {
  const segments = sectionSegments(tri, y);
  if (segments.length < 4) return null;
  const points = segmentPoints(segments);
  const ring = convexHull(points);
  if (ring.length < 3) return null;
  let front = -Infinity, frontLeft = -Infinity, frontRight = -Infinity;
  let frontLeftPoint = null, frontRightPoint = null;
  for (const p of points) {
    if (p[1] > front) front = p[1];
    if (p[0] < 0) {
      if (p[1] > frontLeft) { frontLeft = p[1]; frontLeftPoint = p; }
    } else if (p[1] > frontRight) { frontRight = p[1]; frontRightPoint = p; }
  }
  return {
    y,
    ring,
    girth: ringPerimeter(ring),
    contour: contourLength(segments),
    front,
    frontLeft: frontLeftPoint ? frontLeft : null,
    frontRight: frontRightPoint ? frontRight : null,
    frontLeftPoint,
    frontRightPoint,
  };
}

export function scanSurface(tri, scan = DEFAULT_SCAN) {
  const out = [];
  const steps = Math.floor((scan.to_m - scan.from_m) / scan.step_m + 1e-9);
  for (let i = 0; i <= steps; i++) {
    // stepping by index avoids the drift of repeated += on a float
    const y = scan.from_m + i * scan.step_m;
    const section = measureSection(tri, y);
    if (section) out.push(section);
  }
  return out;
}

function pickExtreme(scan, lo, hi, key, mode) {
  let best = null;
  for (const section of scan) {
    if (section.y < lo - 1e-9 || section.y > hi + 1e-9) continue;
    const value = section[key];
    if (value === null || value === undefined) continue;
    if (!best || (mode === 'max' ? value > best[key] : value < best[key])) best = section;
  }
  return best;
}

/**
 * Landmarks, all purely geometric:
 *   bust apex per side = the section reaching furthest forward on that side
 *   bust level         = the mean of the two apex heights, so the bust section
 *                        stays symmetric instead of following the fuller breast
 *   underbust fold     = below the apex, the section reaching LEAST far forward
 *   waist              = below the fold, the smallest girth
 */
export function findLandmarks(scan, options = {}) {
  const searchFrom = options.search_from_m ?? 1.10;
  if (!scan.length) return null;
  const apexL = pickExtreme(scan, -Infinity, Infinity, 'frontLeft', 'max');
  const apexR = pickExtreme(scan, -Infinity, Infinity, 'frontRight', 'max');
  if (!apexL || !apexR) return null;
  const bustLevel = (apexL.y + apexR.y) / 2;
  const foldCeiling = Math.min(apexL.y, apexR.y) - 0.02;
  const fold = pickExtreme(scan, searchFrom, foldCeiling, 'front', 'min');
  const waist = fold ? pickExtreme(scan, searchFrom, fold.y - 0.02, 'girth', 'min') : null;
  const maxGirth = pickExtreme(scan, -Infinity, Infinity, 'girth', 'max');
  return {
    apexL: {
      y: apexL.y,
      x: apexL.frontLeftPoint ? apexL.frontLeftPoint[0] : null,
      z: apexL.frontLeft,
    },
    apexR: {
      y: apexR.y,
      x: apexR.frontRightPoint ? apexR.frontRightPoint[0] : null,
      z: apexR.frontRight,
    },
    bustLevel,
    fold: fold ? { y: fold.y } : null,
    waist: waist ? { y: waist.y } : null,
    maxGirth: maxGirth ? { y: maxGirth.y } : null,
  };
}

/**
 * Apply hand-placed landmark overrides on top of the automatic detection.
 *
 * Automatic detection is fast; a human tick is what makes a number defensible.
 * An override file is an INPUT to the pipeline, not a viewer-only nicety: the
 * Python authority pass reads the same file, so a corrected landmark produces
 * corrected evidence. Provenance is tracked per landmark, never per file, so a
 * report can say exactly which points a person moved.
 *
 * Apex overrides re-derive BUST_LEVEL, since that level is defined as the mean
 * of the apex pair — unless the level itself is given explicitly.
 */
/** A hand-placed landmark's source: `manual`, or `manual_mirrored` when the
 *  override says the point was accepted as the mirror of the other side. Both
 *  count as manual for every purpose except the provenance string. */
export const manualSource = (spec) => (spec && spec.source === 'manual_mirrored' ? 'manual_mirrored' : 'manual');
export const isManualSource = (source) => source === 'manual' || source === 'manual_mirrored';

export function applyLandmarkOverrides(marks, overrides) {
  const source = {
    BUST_APEX_L: 'auto', BUST_APEX_R: 'auto', BUST_LEVEL: 'auto',
    UNDERBUST_FOLD: 'auto', WAIST_LEVEL: 'auto',
  };
  // how each hand-placed point was placed (camera distance, incidence, footprint), by id
  const placement = {};
  if (!marks) return marks;
  const out = { ...marks, source, placement };
  const given = overrides && overrides.landmarks;
  if (!given) return out;

  if (given.BUST_APEX_L && Array.isArray(given.BUST_APEX_L.xyz_m)) {
    const [x, y, z] = given.BUST_APEX_L.xyz_m;
    out.apexL = { x, y, z };
    source.BUST_APEX_L = manualSource(given.BUST_APEX_L);
  }
  if (given.BUST_APEX_R && Array.isArray(given.BUST_APEX_R.xyz_m)) {
    const [x, y, z] = given.BUST_APEX_R.xyz_m;
    out.apexR = { x, y, z };
    source.BUST_APEX_R = manualSource(given.BUST_APEX_R);
  }
  if (isManualSource(source.BUST_APEX_L) || isManualSource(source.BUST_APEX_R)) {
    out.bustLevel = (out.apexL.y + out.apexR.y) / 2;
    source.BUST_LEVEL = 'derived_from_manual';
  }
  if (given.BUST_LEVEL && Number.isFinite(given.BUST_LEVEL.y_m)) {
    out.bustLevel = given.BUST_LEVEL.y_m;
    source.BUST_LEVEL = manualSource(given.BUST_LEVEL);
  }
  if (given.UNDERBUST_FOLD && Number.isFinite(given.UNDERBUST_FOLD.y_m)) {
    out.fold = { y: given.UNDERBUST_FOLD.y_m };
    source.UNDERBUST_FOLD = manualSource(given.UNDERBUST_FOLD);
  }
  if (given.WAIST_LEVEL && Number.isFinite(given.WAIST_LEVEL.y_m)) {
    out.waist = { y: given.WAIST_LEVEL.y_m };
    source.WAIST_LEVEL = manualSource(given.WAIST_LEVEL);
  }
  // every other hand-placed point (HPS, roots) is manual by definition; the
  // record keeps its source and how it was placed
  for (const [id, spec] of Object.entries(given)) {
    if (!spec || typeof spec !== 'object') continue;
    if (!(id in source) && (Array.isArray(spec.xyz_m) || Number.isFinite(spec.y_m))) source[id] = manualSource(spec);
    if (spec.placed_with) placement[id] = spec.placed_with;
  }
  return out;
}

/** Which POMs depend on which landmarks, so a manual move can be traced to the
 *  numbers it changed. */
export const POM_LANDMARKS = {
  BODY_WAIST_GIRTH: ['WAIST_LEVEL'],
  BODY_UNDERBUST_GIRTH: ['UNDERBUST_FOLD'],
  BODY_BUST_GIRTH: ['BUST_LEVEL'],
  BODY_BUST_POINT_HEIGHT: ['BUST_LEVEL'],
  BODY_APEX_TO_APEX: ['BUST_APEX_L', 'BUST_APEX_R'],
  DIAG_MAX_TORSO_GIRTH: [],
  BODY_UNDERBUST_TO_APEX_L: ['UNDERBUST_FOLD', 'BUST_APEX_L'],
  BODY_UNDERBUST_TO_APEX_R: ['UNDERBUST_FOLD', 'BUST_APEX_R'],
  BODY_HPS_TO_APEX_L: ['HPS_L', 'BUST_APEX_L'],
  BODY_HPS_TO_APEX_R: ['HPS_R', 'BUST_APEX_R'],
  BREAST_ROOT_ARC_L: ['ROOT_INNER_L', 'ROOT_OUTER_L', 'UNDERBUST_FOLD'],
  BREAST_ROOT_ARC_R: ['ROOT_INNER_R', 'ROOT_OUTER_R', 'UNDERBUST_FOLD'],
  BODY_BAND_FRONT_L: ['UNDERBUST_FOLD', 'CF_UNDERBUST', 'SIDE_UNDERBUST_L'],
  BODY_BAND_FRONT_R: ['UNDERBUST_FOLD', 'CF_UNDERBUST', 'SIDE_UNDERBUST_R'],
  BODY_UNDERARM_TO_FOLD_L: ['UNDERARM_L', 'SIDE_UNDERBUST_L'],
  BODY_UNDERARM_TO_FOLD_R: ['UNDERARM_R', 'SIDE_UNDERBUST_R'],
};

export function pomProvenance(pomId, source) {
  const inputs = POM_LANDMARKS[pomId] || [];
  if (!inputs.length) return 'auto';
  if (inputs.some((id) => isManualSource(source[id]))) return 'manual';
  if (inputs.some((id) => source[id] === 'derived_from_manual')) return 'derived_from_manual';
  return 'auto';
}

/** Values for every POM this engine can compute, in metres. Keys are registry
 *  POM ids. Levels that are not on the scan grid (the bust level is a mean of
 *  two apex heights) are sectioned freshly at their exact height. */
export function computePoms(tri, scan, landmarks) {
  const out = {};
  const girthAt = (y) => {
    const onGrid = scan.find((s) => Math.abs(s.y - y) < 1e-9);
    const section = onGrid || measureSection(tri, y);
    return section ? { girth: section.girth, contour: section.contour, y: section.y } : null;
  };

  if (landmarks.waist) {
    const s = girthAt(landmarks.waist.y);
    if (s) out.BODY_WAIST_GIRTH = { value: s.girth, at_y: s.y, contour: s.contour };
  }
  if (landmarks.fold) {
    const s = girthAt(landmarks.fold.y);
    if (s) out.BODY_UNDERBUST_GIRTH = { value: s.girth, at_y: s.y, contour: s.contour };
  }
  if (Number.isFinite(landmarks.bustLevel)) {
    const s = girthAt(landmarks.bustLevel);
    if (s) out.BODY_BUST_GIRTH = { value: s.girth, at_y: s.y, contour: s.contour };
    out.BODY_BUST_POINT_HEIGHT = { value: landmarks.bustLevel, at_y: landmarks.bustLevel };
  }
  if (landmarks.maxGirth) {
    const s = girthAt(landmarks.maxGirth.y);
    if (s) out.DIAG_MAX_TORSO_GIRTH = { value: s.girth, at_y: s.y, contour: s.contour };
  }
  const { apexL, apexR } = landmarks;
  if (apexL && apexR && apexL.x !== null && apexR.x !== null) {
    out.BODY_APEX_TO_APEX = {
      value: Math.hypot(apexR.x - apexL.x, apexR.y - apexL.y, apexR.z - apexL.z),
      at_y: (apexL.y + apexR.y) / 2,
    };
  }
  return out;
}

/**
 * HPS is MANUAL ONLY on this asset — there is no findHps here on purpose.
 *
 * An automatic rule was written and then removed. "Highest surface point
 * outboard of the neck" returns whatever sits on its own inner cutoff: 35mm
 * gives y=1593.1mm, 45mm gives 1589.2mm, 90mm gives 1534.9mm. The answer was
 * set by a parameter with no anatomical basis, not by the body, and a number
 * like that is worse than no number. The head is cut off at the neck, so there
 * is no neck-base curve to detect against.
 *
 * HPS therefore comes only from a hand-placed landmark, and the POMs that need
 * it stay blocked until someone places it.
 */

/**
 * The four boundary loops of an open torso surface, classified without a
 * threshold: the highest is the neck, the lowest is the waist, and the two that
 * remain are the armholes. Nothing about the answer depends on a chosen number —
 * the contrast with the rejected HPS rule, which returned whatever sat on its
 * own cutoff.
 */
export function findArmholes(tri) {
  const index = new Map();
  const points = [];
  const faces = [];
  for (let t = 0; t < tri.length; t += 9) {
    const face = [];
    for (let v = 0; v < 3; v++) {
      const p = [tri[t + v * 3], tri[t + v * 3 + 1], tri[t + v * 3 + 2]];
      const key = `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`;
      let id = index.get(key);
      if (id === undefined) { id = points.length; index.set(key, id); points.push(p); }
      face.push(id);
    }
    if (new Set(face).size === 3) faces.push(face);
  }
  const edgeCount = new Map();
  for (const [a, b, c] of faces) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = `${Math.min(u, v)},${Math.max(u, v)}`;
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
    }
  }
  const adjacency = new Map();
  for (const [key, count] of edgeCount) {
    if (count !== 1) continue;
    const [u, v] = key.split(',').map(Number);
    if (!adjacency.has(u)) adjacency.set(u, []);
    if (!adjacency.has(v)) adjacency.set(v, []);
    adjacency.get(u).push(v);
    adjacency.get(v).push(u);
  }
  const seen = new Set();
  const loops = [];
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    const component = [];
    const stack = [start];
    while (stack.length) {
      const node = stack.pop();
      if (seen.has(node)) continue;
      seen.add(node);
      component.push(node);
      for (const next of adjacency.get(node)) if (!seen.has(next)) stack.push(next);
    }
    loops.push(component);
  }
  if (loops.length !== 4) return { armholeL: null, armholeR: null, loops: loops.length };
  const withCentroid = loops.map((loop) => ({
    loop,
    y: loop.reduce((sum, i) => sum + points[i][1], 0) / loop.length,
    x: loop.reduce((sum, i) => sum + points[i][0], 0) / loop.length,
  }));
  withCentroid.sort((a, b) => a.y - b.y);
  const middle = withCentroid.slice(1, 3);            // neither the waist nor the neck
  const lowest = (entry) => {
    let best = entry.loop[0];
    for (const i of entry.loop) if (points[i][1] < points[best][1]) best = i;
    return { x: points[best][0], y: points[best][1], z: points[best][2] };
  };
  const left = middle.find((e) => e.x < 0);
  const right = middle.find((e) => e.x >= 0);
  return {
    armholeL: left ? lowest(left) : null,
    armholeR: right ? lowest(right) : null,
    loops: loops.length,
  };
}

/** Landmarks read off the underbust fold section: the gore point, the band
 *  closure at centre back, and the side point where the wire ends. */
export function findFoldLandmarks(tri, foldY) {
  const points = segmentPoints(sectionSegments(tri, foldY));
  if (!points.length) return {};
  let centreFront = null;
  let centreBack = null;
  let sideL = null;
  let sideR = null;
  for (const [x, z] of points) {
    if (!centreFront || Math.abs(x) < Math.abs(centreFront[0])
      || (Math.abs(x) === Math.abs(centreFront[0]) && z > centreFront[1])) centreFront = [x, z];
    if (!centreBack || Math.abs(x) < Math.abs(centreBack[0])
      || (Math.abs(x) === Math.abs(centreBack[0]) && z < centreBack[1])) centreBack = [x, z];
    if (x < 0 && (!sideL || x < sideL[0])) sideL = [x, z];
    if (x >= 0 && (!sideR || x > sideR[0])) sideR = [x, z];
  }
  // the centre pass above keeps the nearest-to-centre point; resolve the front
  // and back of that centre line properly
  let front = -Infinity;
  let back = Infinity;
  const band = Math.abs(centreFront ? centreFront[0] : 0) + 1e-4;
  for (const [x, z] of points) {
    if (Math.abs(x) > band) continue;
    if (z > front) { front = z; centreFront = [x, z]; }
    if (z < back) { back = z; centreBack = [x, z]; }
  }
  const make = (p) => (p ? { x: p[0], y: foldY, z: p[1] } : null);
  return {
    cfUnderbust: make(centreFront),
    cbUnderbust: make(centreBack),
    sideL: make(sideL),
    sideR: make(sideR),
  };
}

/** Arc length along a horizontal section between two points on it. A band
 *  follows the underbust line, so the section's own arc is the right model —
 *  a free shortest path would cut a chord across it. */
export function sectionArc(tri, y, from, to) {
  const segments = sectionSegments(tri, y);
  if (!segments.length || !from || !to) return null;
  const nodes = new Map();
  const key = (p) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;
  const node = (p) => {
    const k = key(p);
    let found = nodes.get(k);
    if (!found) { found = { p, edges: [] }; nodes.set(k, found); }
    return found;
  };
  for (const [a, b] of segments) {
    const na = node(a);
    const nb = node(b);
    const w = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (w <= 0) continue;
    na.edges.push({ to: nb, w });
    nb.edges.push({ to: na, w });
  }
  let start = null;
  let goal = null;
  let ds = Infinity;
  let dg = Infinity;
  for (const n of nodes.values()) {
    const a = (n.p[0] - from.x) ** 2 + (n.p[1] - from.z) ** 2;
    const b = (n.p[0] - to.x) ** 2 + (n.p[1] - to.z) ** 2;
    if (a < ds) { ds = a; start = n; }
    if (b < dg) { dg = b; goal = n; }
  }
  if (!start || !goal || start === goal) return null;
  const dist = new Map([[start, 0]]);
  const done = new Set();
  const prev = new Map();
  const queue = [start];
  while (queue.length) {
    let best = 0;
    for (let i = 1; i < queue.length; i++) if (dist.get(queue[i]) < dist.get(queue[best])) best = i;
    const current = queue.splice(best, 1)[0];
    if (done.has(current)) continue;
    done.add(current);
    if (current === goal) break;
    for (const { to: next, w } of current.edges) {
      if (done.has(next)) continue;
      const alt = dist.get(current) + w;
      if (alt < (dist.has(next) ? dist.get(next) : Infinity)) {
        dist.set(next, alt); prev.set(next, current); queue.push(next);
      }
    }
  }
  if (!dist.has(goal)) return null;
  const path = [];
  for (let n = goal; n; n = prev.get(n)) path.push([n.p[0], y, n.p[1]]);
  path.reverse();
  return { value: dist.get(goal), points: path };
}

/** The point on a section directly below an apex: same side, nearest in x, and
 *  front-most among those, so the run starts where a tape would be laid. */
export function sectionPointNearX(tri, y, targetX, band = 0.01) {
  const points = segmentPoints(sectionSegments(tri, y));
  if (!points.length) return null;
  let best = null, bestScore = Infinity;
  for (const [x, z] of points) {
    if (Math.sign(x) !== Math.sign(targetX) && Math.abs(x) > 1e-6) continue;
    const dx = Math.abs(x - targetX);
    // inside the band prefer the front-most point, outside it prefer nearest x
    const score = dx < band ? -z : dx + 1000;
    if (score < bestScore) { bestScore = score; best = { x, y, z }; }
  }
  return best;
}

/**
 * POMs measured along the surface rather than around a section. They all use the
 * one path model (shortest surface path) so a reading here is comparable with a
 * line drafted by the pen.
 */
export function computeSurfacePoms(grid, tri, marks, options = {}) {
  const out = {};
  if (!marks) return out;
  const run = (a, b) => {
    if (!a || !b) return null;
    const result = surfaceRun(grid, [a.x, a.y, a.z], [b.x, b.y, b.z]);
    return { value: result.length, points: result.points, onSurface: result.onSurface };
  };

  if (marks.fold) {
    for (const [id, apex] of [['BODY_UNDERBUST_TO_APEX_L', marks.apexL],
                              ['BODY_UNDERBUST_TO_APEX_R', marks.apexR]]) {
      if (!apex || apex.x === null) continue;
      const foot = sectionPointNearX(tri, marks.fold.y, apex.x);
      const result = run(foot, apex);
      if (result) out[id] = { ...result, at_y: (marks.fold.y + apex.y) / 2, from: foot, to: apex };
    }
  }

  // Breast root arc: inner end -> bottom -> outer end. The bottom is derived
  // (the same fold point cup depth starts from); the two ends are hand-placed,
  // because where a wire sits at the inner and outer ends is a TD decision.
  const manual = options.manualPoints || {};
  if (marks.fold) {
    for (const side of ['L', 'R']) {
      const apex = side === 'L' ? marks.apexL : marks.apexR;
      const inner = manual[`ROOT_INNER_${side}`];
      const outer = manual[`ROOT_OUTER_${side}`];
      if (!apex || apex.x === null || !inner || !outer) continue;
      const bottom = manual[`ROOT_BOTTOM_${side}`]
        || sectionPointNearX(tri, marks.fold.y, apex.x);
      if (!bottom) continue;
      const first = run(inner, bottom);
      const second = run(bottom, outer);
      if (!first || !second) continue;
      out[`BREAST_ROOT_ARC_${side}`] = {
        value: first.value + second.value,
        points: first.points.concat(second.points.slice(1)),
        onSurface: first.onSurface && second.onSurface,
        at_y: bottom.y,
        via: bottom,
      };
    }
  }

  // band front along the underbust line, and wing height up to the armhole
  const fold = options.foldLandmarks || {};
  const armholes = options.armholes || {};
  if (marks.fold) {
    for (const side of ['L', 'R']) {
      const sidePoint = side === 'L' ? fold.sideL : fold.sideR;
      if (fold.cfUnderbust && sidePoint) {
        const arc = sectionArc(tri, marks.fold.y, fold.cfUnderbust, sidePoint);
        if (arc) out[`BODY_BAND_FRONT_${side}`] = { ...arc, at_y: marks.fold.y, onSurface: true };
      }
      const armpit = side === 'L' ? armholes.armholeL : armholes.armholeR;
      if (armpit && sidePoint) {
        const result = run(armpit, sidePoint);
        if (result) out[`BODY_UNDERARM_TO_FOLD_${side}`] = {
          ...result, at_y: (armpit.y + sidePoint.y) / 2,
        };
      }
    }
  }

  const hps = options.hps || {};
  for (const [id, start, apex] of [['BODY_HPS_TO_APEX_L', hps.hpsL, marks.apexL],
                                   ['BODY_HPS_TO_APEX_R', hps.hpsR, marks.apexR]]) {
    if (!start || !apex || apex.x === null) continue;
    const result = run(start, apex);
    if (result) out[id] = { ...result, at_y: (start.y + apex.y) / 2, from: start, to: apex };
  }
  return out;
}

/** Factory convention: inches as a reduced fraction, default nearest 1/8. */
export function inchFraction(metres, denominator = DEFAULT_INCH_DENOMINATOR) {
  const inches = (metres * 100) / 2.54;
  const whole = Math.floor(inches);
  let numerator = Math.round((inches - whole) * denominator);
  let den = denominator;
  if (numerator === 0) return `${whole}"`;
  if (numerator === den) return `${whole + 1}"`;
  while (numerator % 2 === 0 && den % 2 === 0) { numerator /= 2; den /= 2; }
  return `${whole} ${numerator}/${den}"`;
}

export function centimetres(metres) {
  return Number((metres * 100).toFixed(1));
}

export function millimetres(metres) {
  return Number((metres * 1000).toFixed(1));
}
