/**
 * The body grid: the vertical half of the reference frame, declared in
 * contracts/body-grid.json and read off this mesh here.
 *
 * With contracts/measurement-levels.json giving the heights, these curves give
 * the other coordinate, so a point on the skin can be named by both — "half an
 * inch under the fold, on the apex vertical" — which is what the dotted grid on
 * the source sheets is for.
 *
 * EVERY RULE IS AN EXTREME OR AN EXACT FEATURE, never a threshold. Centre is the
 * symmetry plane, a side is the section's outermost point at its own mid-depth,
 * an apex line is the vertical through a detected apex, a boundary is where the
 * surface ends. That
 * is the same test the registry's landmark rules pass, and the reason there is
 * no princess line, no side seam and no strap line in here: those are design
 * decisions, and a rule that produced one would be reporting a choice as a
 * measurement.
 *
 * A curve is DRAWN, NEVER MEASURED. Nothing in this file returns a length, so
 * the grid carries no tolerance and cannot disagree with a POM about anything.
 * Sampling reuses the shared engine's section routine and the shared boundary
 * walk. The only maths added is the linear interpolation along a section
 * segment where it crosses the plane x = target — an exact crossing, so the
 * curve is smooth rather than stepping from mesh vertex to mesh vertex.
 *
 * Reached only through the app's Grid toggle, alongside the levels, the
 * landmarks and the pattern block.
 */

import { sectionSegments } from './measure_core.mjs';
import { weld, boundaryLoops } from './flatten_mesh.mjs';

export const GRID_LIMIT = 'The grid is where this body\'s own geometry falls, not where a bra\'s seams should go.';
const RULES = new Set(['section_crossing_x', 'section_mid_depth_x', 'boundary_loop']);

/** Validate the contract against the registry; returns { curves, boundaries, groups, errors }. */
export function loadGrid(contract, registry) {
  const errors = [];
  const known = new Set((registry?.landmarks || []).map((l) => l.id));
  const groups = contract?.groups || {};
  const ids = new Set();
  const curves = [];
  const boundaries = [];

  for (const curve of contract?.curves || []) {
    const problems = [];
    if (!curve.id || ids.has(curve.id)) problems.push('missing or duplicate id');
    ids.add(curve.id);
    if (!RULES.has(curve.rule)) problems.push(`unknown rule ${curve.rule}`);
    if (!groups[curve.group]) problems.push(`unknown group ${curve.group}`);
    if (curve.rule === 'section_crossing_x') {
      const fromLandmark = curve.x_from_landmark;
      if (fromLandmark === undefined && !Number.isFinite(curve.x_m)) problems.push('needs x_m or x_from_landmark');
      if (fromLandmark !== undefined && known.size && !known.has(fromLandmark)) problems.push(`unknown landmark ${fromLandmark}`);
      if (!['front', 'back'].includes(curve.side)) problems.push('side must be front or back');
    }
    if (curve.rule === 'section_mid_depth_x' && ![1, -1].includes(curve.sign)) problems.push('sign must be 1 or -1');
    if (curve.rule === 'boundary_loop') problems.push('a boundary loop is declared under boundaries, not curves');
    for (const id of curve.requires || []) if (known.size && !known.has(id)) problems.push(`unknown landmark ${id}`);
    // A curve that reads a landmark must say so, or a missing landmark would
    // silently become a curve drawn somewhere else.
    if (curve.x_from_landmark && !(curve.requires || []).includes(curve.x_from_landmark)) {
      problems.push(`${curve.x_from_landmark} is used but not in requires`);
    }
    if (problems.length) errors.push(`${curve.id || '?'}: ${problems.join('; ')}`);
    else curves.push(curve);
  }

  for (const boundary of contract?.boundaries || []) {
    const problems = [];
    if (!boundary.id || ids.has(boundary.id)) problems.push('missing or duplicate id');
    ids.add(boundary.id);
    if (boundary.rule !== 'boundary_loop') problems.push(`a boundary must use boundary_loop, not ${boundary.rule}`);
    if (!groups[boundary.group]) problems.push(`unknown group ${boundary.group}`);
    if (!['highest', 'lowest', 'middle'].includes(boundary.pick)) problems.push(`unknown pick ${boundary.pick}`);
    if (boundary.pick === 'middle' && ![1, -1].includes(boundary.sign)) problems.push('a middle loop must say which side it is on');
    if (problems.length) errors.push(`${boundary.id || '?'}: ${problems.join('; ')}`);
    else boundaries.push(boundary);
  }

  return {
    curves,
    boundaries,
    groups,
    errors,
    declared_limit: contract?.declared_limit || GRID_LIMIT,
    step_m: contract?.sampling?.step_m ?? null,
  };
}

/**
 * The point where the section at `y` crosses the plane x = `targetX` on one side
 * of the body, interpolated along the section segment it crosses — not the
 * nearest section vertex. A vertex can only be as close to the plane as the
 * mesh has geometry there (5mm either side of it on this body), and picking one
 * at every height gave a curve that zig-zagged by the mesh's own resolution.
 * The crossing is exact, so the curve follows the skin smoothly.
 *
 * Which side is decided by the SECTION'S OWN MIDLINE — halfway between its
 * front-most and back-most point — not by the sign of z and not by a number
 * chosen here. Without that split the answer is as often the spine as the
 * sternum: at the apex's x the back of the body also crosses the plane, and an
 * apex vertical came out 266mm behind its own apex.
 *
 * Where a side crosses the plane more than once (a fold of skin, the shoulder
 * above the scan's reliable ceiling), the outermost crossing is taken — the
 * front-most for the front, the back-most for the back — so the curve stays on
 * the outer skin.
 */
function crossingOnSide(segments, targetX, side) {
  let minZ = Infinity, maxZ = -Infinity;
  for (const [a, b] of segments) {
    for (const [, z] of [a, b]) { if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  }
  const midline = (minZ + maxZ) / 2;
  let best = null, bestDepth = -Infinity;
  for (const [a, b] of segments) {
    const da = a[0] - targetX, db = b[0] - targetX;
    if (da * db > 0) continue;                                // both on one side of the plane
    const s = da === db ? 0 : da / (da - db);                 // where along a→b the plane is
    const z = a[1] + (b[1] - a[1]) * s;
    if (side === 'front' ? z < midline : z > midline) continue;
    const depth = side === 'front' ? z : -z;
    if (depth > bestDepth) { bestDepth = depth; best = [targetX, z]; }
  }
  return best;
}

/**
 * The outermost point of the section on one side, taken AT THE SECTION'S OWN
 * MID-DEPTH — halfway between its front-most and back-most point, the same
 * construct the side split above uses, and no number chosen here.
 *
 * This replaced the widest point of the section (`section_extreme_x`). The
 * widest point is well determined in x and NOT DETERMINED IN DEPTH: the side of
 * this body is a flat wall, so at every height the section is equally wide over
 * a run of 10 to 57mm of depth, and the widest vertex is picked out of that run
 * by variation of under a millimetre. Sampled height by height the answer jumped
 * up to 41.7mm in depth between neighbouring heights and drew a zig-zag — the
 * rule was reporting the mesh's own noise as a place on the body. At mid-depth
 * the answer is determined: it moves at most 3.55mm per height, and it sits
 * 0.68mm inboard of the widest point on average, so it is a point of the same
 * wall.
 *
 * The registry's SIDE_UNDERBUST_L/R landmarks are still the widest point, and
 * they should be: they feed a width, where depth does not enter. This is a
 * different question — where on that wall a line runs — and it needs the depth
 * the widest point cannot give.
 */
function midDepthOnSide(segments, sign) {
  let minZ = Infinity, maxZ = -Infinity;
  for (const [a, b] of segments) {
    for (const [, z] of [a, b]) { if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  }
  const mid = (minZ + maxZ) / 2;
  let best = null, bestOut = -Infinity;
  for (const [a, b] of segments) {
    const da = a[1] - mid, db = b[1] - mid;
    if (da * db > 0) continue;                                // both on one side of mid-depth
    const s = da === db ? 0 : da / (da - db);
    const x = a[0] + (b[0] - a[0]) * s;
    if (x * sign < 0) continue;
    if (x * sign > bestOut) { bestOut = x * sign; best = [x, mid]; }
  }
  return best;
}

/**
 * Sample the declared curves on this mesh. `landmarks` is { ID: [x, y, z] }.
 * Each curve comes back with its points, or with what it needs — never with a
 * fallback rule standing in for a landmark that is not there.
 */
export function sampleCurves(loaded, tri, landmarks, { scan, step = null } = {}) {
  const stepM = step ?? loaded.step_m ?? scan.step_m;
  const heights = [];
  for (let y = scan.from_m; y <= scan.to_m + 1e-9; y += stepM) heights.push(Number(y.toFixed(6)));
  // One section pass serves every curve, so they cannot be sampled differently.
  const sections = new Map();
  const segmentsAt = (y) => {
    if (!sections.has(y)) sections.set(y, sectionSegments(tri, y));
    return sections.get(y);
  };

  return loaded.curves.map((curve) => {
    const needs = (curve.requires || []).filter((id) => !Array.isArray(landmarks?.[id]));
    if (needs.length) return { curve, needs, points: [] };
    const targetX = curve.x_from_landmark ? landmarks[curve.x_from_landmark][0] : curve.x_m;
    const ceiling = Number.isFinite(curve.max_y_m) ? curve.max_y_m : Infinity;
    const points = [];
    for (const y of heights) {
      if (y > ceiling) break;
      const segments = segmentsAt(y);
      if (!segments.length) continue;
      const hit = curve.rule === 'section_mid_depth_x'
        ? midDepthOnSide(segments, curve.sign)
        : crossingOnSide(segments, targetX, curve.side);
      if (hit) points.push([hit[0], y, hit[1]]);
    }
    return { curve, needs: null, points };
  });
}

/**
 * The four places the torso mesh ends, as ordered loops. Told apart by height
 * and by side, which is what the mesh being cut at the neck, both armholes and
 * the waist makes possible; if it is cut somewhere else this returns the reason
 * rather than guessing which loop is which.
 */
export function sampleBoundaries(loaded, tri) {
  const mesh = weld(tri);
  const loops = boundaryLoops(mesh).filter((loop) => loop.length >= 3);
  const at = (i) => [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
  if (loops.length !== 4) {
    return loaded.boundaries.map((boundary) => ({
      boundary, points: [],
      blocked: `the measurement surface has ${loops.length} boundary loops, not the 4 this asset is cut into (neck, two armholes, waist)`,
    }));
  }
  const described = loops.map((loop) => {
    const pts = loop.map(at);
    const mean = (k) => pts.reduce((s, p) => s + p[k], 0) / pts.length;
    return { pts, y: mean(1), x: mean(0) };
  }).sort((a, b) => a.y - b.y);
  const chosen = {
    lowest: described[0],
    highest: described[3],
    middleNeg: described.slice(1, 3).find((l) => l.x < 0) || null,
    middlePos: described.slice(1, 3).find((l) => l.x >= 0) || null,
  };
  return loaded.boundaries.map((boundary) => {
    const loop = boundary.pick === 'middle'
      ? (boundary.sign < 0 ? chosen.middleNeg : chosen.middlePos)
      : chosen[boundary.pick];
    if (!loop) return { boundary, points: [], blocked: 'no boundary loop on that side' };
    return { boundary, points: loop.pts, blocked: null };
  });
}

/** What a record of the grid says: the rule each curve used, and what it needed. */
export function gridRecord(curves, boundaries, loaded) {
  return {
    curves: curves.map(({ curve, needs, points }) => ({
      id: curve.id, rule: curve.rule, needs: needs || null, samples: points.length,
      from_y_m: points.length ? Number(points[0][1].toFixed(5)) : null,
      to_y_m: points.length ? Number(points[points.length - 1][1].toFixed(5)) : null,
    })),
    boundaries: boundaries.map(({ boundary, points, blocked }) => ({
      id: boundary.id, rule: boundary.rule, pick: boundary.pick, blocked, samples: points.length,
    })),
    limit: loaded.declared_limit,
  };
}
