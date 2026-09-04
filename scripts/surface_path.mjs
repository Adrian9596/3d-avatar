/**
 * Shortest-path-on-a-surface routine, shared by the viewer and its tests.
 *
 * WHY THIS EXISTS — and why it replaced two earlier models.
 *
 * The pen first drew a run between two anchors as the mesh's intersection with a
 * plane standing on the surface, and drew a *bent* run as a cubic Bezier whose
 * samples were snapped to the mesh. Both are legitimate curves, but they are
 * DIFFERENT curves between the same two points, so switching from one to the
 * other moved the reading by ~3% before the user had shaped anything. A measuring
 * instrument must not do that.
 *
 * There is exactly one path definition here: the shortest path along the surface.
 * It is chosen because of one property no other model has —
 *
 *     a sub-path of a shortest path is itself a shortest path.
 *
 * So if the control points are placed ON the A->B path, then the piecewise path
 * A->h1->h2->B has the SAME length as A->B. Continuity is structural, not tuned:
 * there is no mode to switch, and the number moves only when a control point is
 * actually moved.
 *
 * Method: seed with the plane-section walk (fast, already on the surface, and a
 * good initial guess), resample at a fixed spacing, then relax — repeatedly move
 * each interior point to the midpoint of its neighbours and snap it back to the
 * nearest surface point. Fixed resampling and a fixed iteration count keep the
 * result deterministic, which is what makes the reading reproducible.
 *
 * Geometry is plain [x, y, z] arrays and flat Float32Arrays so this module runs
 * in Node with no dependencies.
 */

export const DEFAULT_GRID_CELL = 0.02;
export const DEFAULT_SPACING = 0.008;   // 8mm between path samples
export const DEFAULT_ITERATIONS = 40;

/**
 * Coarse-to-fine relaxation schedule: [spacing in metres, iterations].
 *
 * Midpoint relaxation is diffusive, so information travels along the polyline
 * about one sample per pass and convergence costs O(N^2) at a fixed spacing. A
 * flat 8mm/512 pass took 88ms and still measured 222.02mm on a front-to-side
 * run; this schedule reaches 221.60mm in 11ms — better converged and eight
 * times faster — because the coarse levels settle the route before the fine
 * levels refine it.
 *
 * Convergence is what buys continuity: with a flat 8-pass relaxation, splitting
 * a run at two waypoints moved the reading by up to 8.8mm. With this schedule
 * the worst case across the torso is 0.12mm, a tenth of the 1mm reporting
 * digit. See scripts/test_surface_path.mjs.
 */
export const DEFAULT_SCHEDULE = [[0.032, 40], [0.016, 40], [0.008, 40]];

// --------------------------------------------------------------- spatial grid

export function buildGrid(tri, cell = DEFAULT_GRID_CELL) {
  const cells = new Map();
  for (let t = 0; t < tri.length; t += 9) {
    let minx = Infinity, miny = Infinity, minz = Infinity;
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (let v = 0; v < 3; v++) {
      const x = tri[t + v * 3], y = tri[t + v * 3 + 1], z = tri[t + v * 3 + 2];
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    for (let i = Math.floor(minx / cell); i <= Math.floor(maxx / cell); i++)
      for (let j = Math.floor(miny / cell); j <= Math.floor(maxy / cell); j++)
        for (let k = Math.floor(minz / cell); k <= Math.floor(maxz / cell); k++) {
          const key = `${i},${j},${k}`;
          let bucket = cells.get(key);
          if (!bucket) { bucket = []; cells.set(key, bucket); }
          bucket.push(t);
        }
  }
  return { cells, cell, tri };
}

// Ericson, Real-Time Collision Detection.
function closestOnTriangle(px, py, pz, tri, t) {
  const ax = tri[t], ay = tri[t + 1], az = tri[t + 2];
  const bx = tri[t + 3], by = tri[t + 4], bz = tri[t + 5];
  const cx = tri[t + 6], cy = tri[t + 7], cz = tri[t + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return [ax, ay, az];
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return [bx, by, bz];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [ax + abx * v, ay + aby * v, az + abz * v];
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return [cx, cy, cz];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [ax + acx * w, ay + acy * w, az + acz * w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
}

function triangleNormal(tri, t) {
  const e1x = tri[t + 3] - tri[t], e1y = tri[t + 4] - tri[t + 1], e1z = tri[t + 5] - tri[t + 2];
  const e2x = tri[t + 6] - tri[t], e2y = tri[t + 7] - tri[t + 1], e2z = tri[t + 8] - tri[t + 2];
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

export function closestOnMesh(grid, p) {
  const { cells, cell, tri } = grid;
  const ci = Math.floor(p[0] / cell), cj = Math.floor(p[1] / cell), ck = Math.floor(p[2] / cell);
  let bestSq = Infinity, best = null, bestTri = -1;
  for (let r = 0; r <= 6; r++) {
    for (let i = ci - r; i <= ci + r; i++)
      for (let j = cj - r; j <= cj + r; j++)
        for (let k = ck - r; k <= ck + r; k++) {
          if (r > 0 && Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== r) continue;
          const bucket = cells.get(`${i},${j},${k}`);
          if (!bucket) continue;
          for (const t of bucket) {
            const q = closestOnTriangle(p[0], p[1], p[2], tri, t);
            const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
            const sq = dx * dx + dy * dy + dz * dz;
            if (sq < bestSq) { bestSq = sq; best = q; bestTri = t; }
          }
        }
    if (best && Math.sqrt(bestSq) <= r * cell) break;
  }
  if (!best) return null;
  const normal = triangleNormal(tri, bestTri);
  // orient outward against the body's vertical axis, so lifting a drawn line
  // off the skin always pushes away from the body
  const radial = [best[0], 0, best[2]];
  if (radial[0] * radial[0] + radial[2] * radial[2] > 1e-9) {
    if (normal[0] * radial[0] + normal[2] * radial[2] < 0) {
      normal[0] = -normal[0]; normal[1] = -normal[1]; normal[2] = -normal[2];
    }
  }
  return { point: best, normal };
}

// ------------------------------------------------------------- plane sectioning

export function planeSection(tri, origin, normal) {
  const segments = [];
  const side = (i) => (tri[i] - origin[0]) * normal[0]
    + (tri[i + 1] - origin[1]) * normal[1]
    + (tri[i + 2] - origin[2]) * normal[2];
  for (let t = 0; t < tri.length; t += 9) {
    const d0 = side(t), d1 = side(t + 3), d2 = side(t + 6);
    if ((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0)) continue;
    const hits = [];
    const edge = (i, j, di, dj) => {
      if ((di > 0) !== (dj > 0)) {
        const s = di / (di - dj);
        hits.push([
          tri[i] + (tri[j] - tri[i]) * s,
          tri[i + 1] + (tri[j + 1] - tri[i + 1]) * s,
          tri[i + 2] + (tri[j + 2] - tri[i + 2]) * s,
        ]);
      }
    };
    edge(t, t + 3, d0, d1); edge(t + 3, t + 6, d1, d2); edge(t + 6, t, d2, d0);
    if (hits.length === 2) segments.push(hits);
  }
  return segments;
}

const nodeKey = (p) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`;

export function walkSection(segments, A, B) {
  const nodes = new Map();
  const node = (p) => {
    const key = nodeKey(p);
    let found = nodes.get(key);
    if (!found) { found = { point: p.slice(), edges: [] }; nodes.set(key, found); }
    return found;
  };
  for (const [p, q] of segments) {
    const a = node(p), b = node(q);
    const w = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    if (w <= 0) continue;
    a.edges.push({ to: b, w }); b.edges.push({ to: a, w });
  }
  if (!nodes.size) return null;
  let start = null, goal = null, ds = Infinity, dg = Infinity;
  for (const n of nodes.values()) {
    const a = (n.point[0] - A[0]) ** 2 + (n.point[1] - A[1]) ** 2 + (n.point[2] - A[2]) ** 2;
    const b = (n.point[0] - B[0]) ** 2 + (n.point[1] - B[1]) ** 2 + (n.point[2] - B[2]) ** 2;
    if (a < ds) { ds = a; start = n; }
    if (b < dg) { dg = b; goal = n; }
  }
  if (!start || !goal || start === goal) return null;
  const dist = new Map([[start, 0]]);
  const prev = new Map();
  const done = new Set();
  const queue = [start];
  while (queue.length) {
    let best = 0;
    for (let i = 1; i < queue.length; i++) if (dist.get(queue[i]) < dist.get(queue[best])) best = i;
    const current = queue.splice(best, 1)[0];
    if (done.has(current)) continue;
    done.add(current);
    if (current === goal) break;
    for (const { to, w } of current.edges) {
      if (done.has(to)) continue;
      const alt = dist.get(current) + w;
      if (alt < (dist.has(to) ? dist.get(to) : Infinity)) {
        dist.set(to, alt); prev.set(to, current); queue.push(to);
      }
    }
  }
  if (!dist.has(goal)) return null;
  const path = [];
  for (let n = goal; n; n = prev.get(n)) path.push(n.point.slice());
  return path.reverse();
}

// ------------------------------------------------------------------ the path

export function pathLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
      points[i][2] - points[i - 1][2]);
  }
  return sum;
}

/** Resample to a fixed spacing so the relaxation and the reading are
 *  deterministic regardless of how the seed happened to be tessellated. */
export function resample(points, spacing = DEFAULT_SPACING) {
  const total = pathLength(points);
  if (total <= 0) return [points[0].slice(), points[points.length - 1].slice()];
  const count = Math.max(2, Math.min(400, Math.round(total / spacing)));
  const out = [points[0].slice()];
  let index = 1, walked = 0;
  for (let s = 1; s < count; s++) {
    const target = (total * s) / count;
    while (index < points.length) {
      const step = Math.hypot(
        points[index][0] - points[index - 1][0],
        points[index][1] - points[index - 1][1],
        points[index][2] - points[index - 1][2]);
      if (walked + step >= target || index === points.length - 1) {
        const t = step > 0 ? (target - walked) / step : 0;
        out.push([
          points[index - 1][0] + (points[index][0] - points[index - 1][0]) * t,
          points[index - 1][1] + (points[index][1] - points[index - 1][1]) * t,
          points[index - 1][2] + (points[index][2] - points[index - 1][2]) * t,
        ]);
        break;
      }
      walked += step; index++;
    }
  }
  out.push(points[points.length - 1].slice());
  return out;
}

/** Shorten the polyline toward the surface geodesic: move each interior point
 *  to the midpoint of its neighbours, then snap back onto the mesh. Endpoints
 *  are pinned. Deterministic for a fixed iteration count. */
export function relax(grid, points, iterations = DEFAULT_ITERATIONS) {
  if (points.length < 3) return points;
  let current = points.map((p) => p.slice());
  for (let pass = 0; pass < iterations; pass++) {
    const next = [current[0]];
    for (let i = 1; i < current.length - 1; i++) {
      const mid = [
        (current[i - 1][0] + current[i + 1][0]) / 2,
        (current[i - 1][1] + current[i + 1][1]) / 2,
        (current[i - 1][2] + current[i + 1][2]) / 2,
      ];
      const hit = closestOnMesh(grid, mid);
      next.push(hit ? hit.point : current[i]);
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

/**
 * The one path primitive: shortest path along the surface from A to B.
 * `onSurface` is false only when no surface route could be found at all, in
 * which case the straight chord is returned and the caller must say so.
 */
export function surfaceRun(grid, A, B, options = {}) {
  // an explicit spacing/iterations pair still works for experiments; the
  // schedule is what production uses
  const schedule = options.schedule
    ?? (options.spacing || options.iterations
      ? [[options.spacing ?? DEFAULT_SPACING, options.iterations ?? DEFAULT_ITERATIONS]]
      : DEFAULT_SCHEDULE);
  const tri = grid.tri;
  const chord = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
  if (chord < 1e-5) return { points: [A.slice(), B.slice()], length: 0, onSurface: true };

  // seed: the plane standing on the surface through A and B
  const nA = options.normalA || closestOnMesh(grid, A)?.normal || [0, 0, 1];
  const nB = options.normalB || closestOnMesh(grid, B)?.normal || [0, 0, 1];
  const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  let avg = [nA[0] + nB[0], nA[1] + nB[1], nA[2] + nB[2]];
  let avgLength = Math.hypot(...avg);
  if (avgLength < 1e-9) { avg = nA.slice(); avgLength = Math.hypot(...avg) || 1; }
  avg = avg.map((v) => v / avgLength);
  let normal = [
    ab[1] * avg[2] - ab[2] * avg[1],
    ab[2] * avg[0] - ab[0] * avg[2],
    ab[0] * avg[1] - ab[1] * avg[0],
  ];
  let normalLength = Math.hypot(...normal);
  if (normalLength < 1e-12) {
    normal = [ab[1], -ab[0], 0];
    normalLength = Math.hypot(...normal);
    if (normalLength < 1e-12) { normal = [0, ab[2], -ab[1]]; normalLength = Math.hypot(...normal) || 1; }
  }
  normal = normal.map((v) => v / normalLength);

  if (options.seed && options.seed.length > 1) {
    let relaxed = options.seed.map((q) => q.slice());
    for (const [levelSpacing, levelIterations] of schedule) {
      relaxed = resample(relaxed, levelSpacing);
      relaxed = relax(grid, relaxed, levelIterations);
      relaxed[0] = A.slice();
      relaxed[relaxed.length - 1] = B.slice();
    }
    const seededLength = pathLength(relaxed);
    if (Number.isFinite(seededLength) && seededLength <= chord * 6) {
      return { points: relaxed, length: seededLength, onSurface: true };
    }
  }

  const segments = planeSection(tri, A, normal);
  const walk = segments.length ? walkSection(segments, A, B) : null;
  let seed;
  if (walk && walk.length > 1 && pathLength([A, ...walk, B]) < chord * 6) {
    seed = [A.slice(), ...walk, B.slice()];
  } else {
    // no plane route: relax straight from the chord, which still lands on the
    // surface if the two points are on the same sheet
    seed = [A.slice(), B.slice()];
  }

  // coarse-to-fine: settle the route, then refine it
  let relaxed = seed;
  for (const [levelSpacing, levelIterations] of schedule) {
    relaxed = resample(relaxed, levelSpacing);
    relaxed = relax(grid, relaxed, levelIterations);
    relaxed[0] = A.slice();
    relaxed[relaxed.length - 1] = B.slice();
  }
  const length = pathLength(relaxed);
  // a run that ends up far longer than the chord means the relaxation never
  // found the surface; report the chord and let the caller flag it
  if (!Number.isFinite(length) || length > chord * 6) {
    return { points: [A.slice(), B.slice()], length: chord, onSurface: false };
  }
  return { points: relaxed, length, onSurface: true };
}

/** A point at a given fraction of arc length along a path. Used to park the
 *  control points ON the run, which is what makes the reading continuous. */
export function pointAtFraction(points, fraction) {
  const total = pathLength(points);
  if (total <= 0) return points[0].slice();
  const target = total * fraction;
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const step = Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
      points[i][2] - points[i - 1][2]);
    if (walked + step >= target) {
      const t = step > 0 ? (target - walked) / step : 0;
      return [
        points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
        points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
        points[i - 1][2] + (points[i][2] - points[i - 1][2]) * t,
      ];
    }
    walked += step;
  }
  return points[points.length - 1].slice();
}
