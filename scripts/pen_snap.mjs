/**
 * Where a pen anchor goes when the click lands near something it should meet.
 * Pure functions on plain arrays; the pen (scripts/pen_tool.mjs) is the only
 * caller in either lane, and scripts/test_pen_snap.mjs checks them on a cylinder
 * and on the avatar (AUTHORING_UX_PLAN.md §6, §15 B1).
 *
 * The rule that keeps this honest: a snap moves the ANCHOR. It never changes the
 * run between two anchors, which stays the shortest surface path — the one path
 * model. So a level snap sets a height and a mirror snap picks a point; the
 * segment is then measured like any other.
 *
 * Two kinds of candidate:
 * - proximity snaps (first anchor, another line's anchor, a point on a line, a
 *   landmark) compete by screen distance within the pick radius, ties broken by
 *   `SNAP_PRIORITY`;
 * - constraint snaps (level while Shift is held, mirror while Alt is held) are
 *   an explicit intent, so they carry distance 0 and win over any proximity
 *   snap. Both are recorded on the anchor with their residual.
 */

export const SNAP_RADIUS_PX = 15;
export const SNAP_PRIORITY = Object.freeze(['first', 'anchor', 'line', 'landmark', 'level', 'mirror']);
/** Past this residual a mirrored point is flagged: the body is not symmetric there. Same figure as the authority pass's asymmetry report. */
export const MIRROR_FLAG_MM = 5;

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * The best snap for a cursor, or null.
 * @param cursor_px   [x, y] in canvas pixels
 * @param candidates  [{ kind, px: [x, y] | null, point: [x, y, z], normal?, ref?, residual_m? }]
 *                    `px` null means "constraint, always applies" (distance 0)
 */
export function resolveSnap({ cursor_px, candidates, radius_px = SNAP_RADIUS_PX, enabled = true }) {
  if (!enabled || !candidates?.length) return null;
  let best = null;
  for (const c of candidates) {
    if (!SNAP_PRIORITY.includes(c.kind)) continue;
    const distance_px = c.px ? Math.hypot(c.px[0] - cursor_px[0], c.px[1] - cursor_px[1]) : 0;
    if (distance_px > radius_px) continue;
    const rank = SNAP_PRIORITY.indexOf(c.kind);
    if (!best || distance_px < best.distance_px - 1e-9
      || (Math.abs(distance_px - best.distance_px) <= 1e-9 && rank < best.rank)) {
      best = { ...c, distance_px, rank };
    }
  }
  if (!best) return null;
  const { rank, ...out } = best;
  return { ...out, distance_px: Number(out.distance_px.toFixed(2)), residual_m: out.residual_m ?? 0 };
}

/** The point of a polyline nearest to `q` (3D), with its segment index and parameter. */
export function nearestOnPolyline(points, q, closed = false) {
  const n = points.length;
  if (!n) return null;
  const segments = closed ? n : n - 1;
  let best = null;
  for (let i = 0; i < Math.max(segments, 1); i++) {
    const A = points[i], B = points[(i + 1) % n] || A;
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
    const ll = dx * dx + dy * dy + dz * dz;
    let t = ll > 0 ? ((q[0] - A[0]) * dx + (q[1] - A[1]) * dy + (q[2] - A[2]) * dz) / ll : 0;
    t = Math.min(1, Math.max(0, t));
    const p = [A[0] + dx * t, A[1] + dy * t, A[2] + dz * t];
    const d = dist3(p, q);
    if (!best || d < best.distance_m) best = { point: p, index: i, t, distance_m: d };
  }
  return best;
}

/**
 * Level snap: the skin point at the previous anchor's height nearest the hit.
 * `section(y)` returns the section contour at height y as [x, z] points on the
 * SKIN (not the convex hull — a level snap must land on the body, and the hull
 * bridges the cleavage). The caller snaps the result to the surface for a normal.
 */
export function levelCandidate({ previous, hit, section }) {
  if (!previous || !hit) return null;
  const y = previous[1];
  const contour = section(y);
  if (!contour || !contour.length) return null;
  let best = null;
  for (const [x, z] of contour) {
    const d = Math.hypot(x - hit[0], z - hit[2]);
    if (!best || d < best.d) best = { d, x, z };
  }
  return { kind: 'level', px: null, point: [best.x, y, best.z], ref: { height_m: y }, residual_m: Math.abs(hit[1] - y) };
}

/**
 * Mirror snap: the mirror image of `source` through x → −x, snapped to the
 * surface by `closest` (p -> {point, normal}). The residual is how far the
 * mirrored point had to move to reach the skin — 0 on a symmetric body.
 */
export function mirrorCandidate({ source, closest }) {
  if (!source) return null;
  const q = [-source[0], source[1], source[2]];
  const hit = closest(q);
  if (!hit) return null;
  const residual_m = dist3(hit.point, q);
  return {
    kind: 'mirror', px: null, point: hit.point, normal: hit.normal,
    ref: { of: source }, residual_m, flagged: residual_m * 1000 > MIRROR_FLAG_MM,
  };
}

/** Mirror a whole polyline of points, each snapped; the record carries every residual. */
export function mirrorPoints(points, closest) {
  const out = [], residuals_mm = [];
  for (const p of points) {
    const c = mirrorCandidate({ source: p, closest });
    if (!c) return { error: 'a mirrored point found no surface' };
    out.push(c.point);
    residuals_mm.push(Number((c.residual_m * 1000).toFixed(3)));
  }
  const max_residual_mm = residuals_mm.length ? Math.max(...residuals_mm) : 0;
  return { points: out, residuals_mm, max_residual_mm, flagged: max_residual_mm > MIRROR_FLAG_MM };
}

/** What an anchor remembers of its snap. */
export function snapRecord(snap) {
  if (!snap) return null;
  return {
    kind: snap.kind,
    to: snap.ref?.name ?? snap.ref?.line ?? (snap.ref?.height_m !== undefined ? `y=${snap.ref.height_m.toFixed(4)}` : null),
    residual_mm: Number(((snap.residual_m ?? 0) * 1000).toFixed(3)),
    ...(snap.flagged ? { flagged: true } : {}),
  };
}
