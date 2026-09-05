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
 * symmetry plane, a side is the widest point of a section, an apex line is the
 * vertical through a detected apex, a boundary is where the surface ends. That
 * is the same test the registry's landmark rules pass, and the reason there is
 * no princess line, no side seam and no strap line in here: those are design
 * decisions, and a rule that produced one would be reporting a choice as a
 * measurement.
 *
 * A curve is DRAWN, NEVER MEASURED. Nothing in this file returns a length, so
 * the grid carries no tolerance and cannot disagree with a POM about anything.
 * Sampling reuses the shared engine's section routine and the shared boundary
 * walk; no intersection or edge maths is written here.
 *
 * PROTOTYPE LANE ONLY, like the levels, the landmarks and the pattern block.
 */

import { sectionSegments, segmentPoints } from './measure_core.mjs';
import { weld, boundaryLoops } from './flatten_mesh.mjs';

export const GRID_LIMIT = 'The grid is where this body\'s own geometry falls, not where a bra\'s seams should go.';
const RULES = new Set(['section_nearest_x', 'section_extreme_x', 'boundary_loop']);

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
    if (curve.rule === 'section_nearest_x') {
      const fromLandmark = curve.x_from_landmark;
      if (fromLandmark === undefined && !Number.isFinite(curve.x_m)) problems.push('needs x_m or x_from_landmark');
      if (fromLandmark !== undefined && known.size && !known.has(fromLandmark)) problems.push(`unknown landmark ${fromLandmark}`);
      if (!['front', 'back'].includes(curve.side)) problems.push('side must be front or back');
    }
    if (curve.rule === 'section_extreme_x' && ![1, -1].includes(curve.sign)) problems.push('sign must be 1 or -1');
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
 * The point of the section at `y` nearest `targetX` on one side of the body.
 *
 * Which side is decided by the SECTION'S OWN MIDLINE — halfway between its
 * front-most and back-most point — not by the sign of z and not by a number
 * chosen here. Without that split the nearest point in x is as often the spine
 * as the sternum: at the apex's x the back of the body is nearer in x than any
 * front vertex, and an apex vertical came out 266mm behind its own apex.
 */
function nearestOnSide(points, targetX, side) {
  let minZ = Infinity, maxZ = -Infinity;
  for (const [, z] of points) { if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  const midline = (minZ + maxZ) / 2;
  let best = null, bestDx = Infinity, bestDepth = -Infinity;
  for (const [x, z] of points) {
    if (side === 'front' ? z < midline : z > midline) continue;
    const depth = side === 'front' ? z : -z;
    const dx = Math.abs(x - targetX);
    // nearest in x wins; ties (a vertex either side of the plane) go to the
    // front-most (or back-most) point, so the curve stays on the outer skin
    if (dx < bestDx - 1e-9 || (Math.abs(dx - bestDx) <= 1e-9 && depth > bestDepth)) {
      bestDx = dx; bestDepth = depth; best = [x, z];
    }
  }
  return best;
}

/** The section point furthest out in x on one side. */
function extremeX(points, sign) {
  let best = null, bestX = -Infinity;
  for (const [x, z] of points) {
    const out = x * sign;
    if (out > bestX) { bestX = out; best = [x, z]; }
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
  const pointsAt = (y) => {
    if (!sections.has(y)) sections.set(y, segmentPoints(sectionSegments(tri, y)));
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
      const section = pointsAt(y);
      if (!section.length) continue;
      const hit = curve.rule === 'section_extreme_x'
        ? extremeX(section, curve.sign)
        : nearestOnSide(section, targetX, curve.side);
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
