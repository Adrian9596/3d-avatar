/* --- the body cut by a plane, walked on the skin --------------------------------
   The helpers every reference kind measures with: the body cut by an upright
   plane (x = const, or through a point along a direction), where a contour
   crosses a line, and a walk along a contour until a length or a coordinate is
   reached. Lengths are along the skin, the way a tape reads them. ---------------- */

// The body cut by the vertical plane x = `x`, as [[y, z], [y, z]] segments.
export function verticalSegments(tri, x) {
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
export function backCrossing(segments, u, front = false) {
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
export function walkContour(segments, from, ahead, stop) {
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

export const byLength = (length) => {
  let left = length;
  return (a, b) => {
    const step = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (step >= left) return left / step;
    left -= step;
    return null;
  };
};
export const byCoordinate = (index, target) => (a, b) => {
  if ((a[index] - target) * (b[index] - target) > 0) return null;
  return a[index] === b[index] ? 1 : (target - a[index]) / (b[index] - a[index]);
};
export const polylineLength = (pts) => pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]) : 0), 0);

// The body cut by the upright plane through `origin` along the horizontal unit
// direction `d`, as [[y, s], [y, s]] segments (s measured along d from origin).
export function uprightSegments(tri, origin, d) {
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
