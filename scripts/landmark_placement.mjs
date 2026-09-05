/**
 * Placing a landmark by hand, the parts that are logic rather than DOM: the
 * guided order of the manual-only points, which one is needed next, where the
 * camera should stand to place each one, the mirror offer for a symmetric pair,
 * and the record a hand-placed point carries (AUTHORING_UX_PLAN.md §7, §15 C1).
 *
 * PROTOTYPE LANE ONLY. Landmarks are corrected in one place and one record
 * (qa/avatar_master/landmarks.manual.json); scripts/test_lane_parity.mjs checks
 * the production viewer never imports this.
 *
 * Nothing here places a point. A mirror is an OFFER the person accepts, recorded
 * as `manual_mirrored` with its residual; a framing is a camera pose, the point
 * is still theirs to put down.
 */

import { placement, DEFAULT_POLAR_LIMITS } from './view_geometry.mjs';
import { mirrorCandidate, MIRROR_FLAG_MM } from './pen_snap.mjs';

/** The eight points no rule may detect, in the order a fitter places them. */
export const GUIDED_ORDER = Object.freeze([
  'HPS_L', 'HPS_R',
  'ROOT_INNER_L', 'ROOT_OUTER_L', 'ROOT_TOP_L',
  'ROOT_INNER_R', 'ROOT_OUTER_R', 'ROOT_TOP_R',
]);
/** Above this footprint a placement is noted in the sheet, as a fact. */
export const PLACEMENT_NOTE_MM_PX = 3;

export function sideOf(id) {
  if (/_L$/.test(id)) return 'L';
  if (/_R$/.test(id)) return 'R';
  return null;
}

/** HPS_L ↔ HPS_R; null for a landmark without a side. */
export function oppositeOf(id) {
  const side = sideOf(id);
  if (!side) return null;
  return id.replace(/_[LR]$/, side === 'L' ? '_R' : '_L');
}

export const isPlaced = (overrides, id) => Boolean(overrides?.landmarks?.[id]);

/** The next id in the guided order not yet placed, starting after `after`; null when all are. */
export function nextNeeded(overrides, after = null, order = GUIDED_ORDER) {
  const start = after ? order.indexOf(after) + 1 : 0;
  for (let k = 0; k < order.length; k++) {
    const id = order[(start + k) % order.length];
    if (!isPlaced(overrides, id)) return id;
  }
  return null;
}

const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

/**
 * Where to look from to place `id`: a target on or near the body, a unit view
 * direction (from target towards the camera) and a distance. Built from the
 * landmarks already known — the apexes, the fold, the underarms — so it frames
 * the REGION the point belongs to; the person places the point.
 * Returns null when the landmarks it needs are not known.
 */
export function framingFor(id, landmarks) {
  const side = sideOf(id);
  const apex = side ? landmarks[`BUST_APEX_${side}`] : null;
  const s = side === 'L' ? -1 : 1;
  const base = id.replace(/_[LR]$/, '');
  if (apex && base === 'HPS') return { target: [apex[0] * 0.6, apex[1] + 0.18, apex[2] - 0.1], direction: norm([s * 0.6, 0.35, 0.7]), distance_m: 0.5 };
  if (apex && base === 'ROOT_INNER') return { target: [apex[0] * 0.4, apex[1], apex[2] - 0.02], direction: norm([s * 0.25, 0.15, 1]), distance_m: 0.45 };
  if (apex && base === 'ROOT_OUTER') return { target: [apex[0] * 1.7, apex[1] - 0.01, apex[2] - 0.05], direction: norm([s * 0.8, 0.2, 0.6]), distance_m: 0.45 };
  if (apex && base === 'ROOT_TOP') return { target: [apex[0], apex[1] + 0.06, apex[2] - 0.02], direction: norm([s * 0.2, 0.45, 0.85]), distance_m: 0.45 };
  if (apex && base === 'ROOT_BOTTOM') return { target: [apex[0], apex[1] - 0.05, apex[2] - 0.02], direction: norm([s * 0.2, -0.3, 0.9]), distance_m: 0.45 };
  if (apex && base === 'BUST_APEX') return { target: apex.slice(), direction: norm([s * 0.2, 0.1, 1]), distance_m: 0.5 };
  const known = landmarks[id];
  if (Array.isArray(known)) {
    const back = /^CB_/.test(id) || known[2] < -0.02;
    const dir = /^SIDE_|^UNDERARM_/.test(id) ? [s * 0.9, 0.15, 0.4] : back ? [0, 0.1, -1] : [0, 0.1, 1];
    return { target: known.slice(), direction: norm(dir), distance_m: 0.6 };
  }
  if (typeof known === 'number') {
    // a level: frame the front of the body at that height
    return { target: [0, known, 0.1], direction: norm([0.35, 0.15, 1]), distance_m: 0.9 };
  }
  return null;
}

/** A framing as a camera pose, clamped like the F key. */
export function poseFor(framing, polar_limits = DEFAULT_POLAR_LIMITS) {
  if (!framing) return null;
  const { target, direction, distance_m } = framing;
  let position = target.map((v, i) => v + direction[i] * distance_m);
  const d = position.map((v, i) => v - target[i]);
  const r = Math.hypot(...d);
  const polar = Math.acos(Math.min(1, Math.max(-1, d[1] / r)));
  const clamped = Math.min(polar_limits.max_rad, Math.max(polar_limits.min_rad, polar));
  if (clamped !== polar) {
    const az = Math.atan2(d[0], d[2]);
    position = [target[0] + r * Math.sin(clamped) * Math.sin(az), target[1] + r * Math.cos(clamped), target[2] + r * Math.sin(clamped) * Math.cos(az)];
  }
  return { position, target: target.slice() };
}

/**
 * The mirror of the opposite side's hand-placed point, snapped to the surface —
 * offered, never applied. Null when the opposite side is not hand-placed.
 * `closest`: p -> { point, normal } over the measurement surface.
 */
export function mirrorOffer(id, overrides, closest, flag_mm = MIRROR_FLAG_MM) {
  const other = oppositeOf(id);
  const spec = other && overrides?.landmarks?.[other];
  if (!spec) return null;
  if (Array.isArray(spec.xyz_m)) {
    const c = mirrorCandidate({ source: spec.xyz_m, closest });
    if (!c) return null;
    const residual_mm = Number((c.residual_m * 1000).toFixed(3));
    return { from: other, xyz_m: c.point.map((v) => Number(v.toFixed(5))), residual_mm, flagged: residual_mm > flag_mm };
  }
  if (Number.isFinite(spec.y_m)) return { from: other, y_m: spec.y_m, residual_mm: 0, flagged: false };
  return null;
}

/** The override entry a placement writes: value, how it was placed, and its source. */
export function landmarkRecord({ kind, point, y, placed_with, source = 'manual' }) {
  const r5 = (v) => Number(v.toFixed(5));
  const entry = kind === 'point'
    ? { xyz_m: point.map(r5) }
    : { y_m: r5(y) };
  entry.source = source;
  if (placed_with) entry.placed_with = placed_with;
  return entry;
}

/** placed_with for a landmark hit, through the same routine the pen uses. */
export function placementRecord({ point, normal, cameraPosition, fov_deg, pixel_height, method }) {
  return placement({ point, normal, cameraPosition, fov_deg, pixel_height, method });
}

/** Landmarks whose footprint at placement exceeded the note threshold, as facts for the sheet. */
export function placementNotes(overrides, threshold = PLACEMENT_NOTE_MM_PX) {
  const out = [];
  for (const [id, spec] of Object.entries(overrides?.landmarks || {})) {
    const pw = spec?.placed_with;
    if (pw && Number.isFinite(pw.footprint_mm_px) && pw.footprint_mm_px > threshold) {
      out.push({ id, footprint_mm_px: pw.footprint_mm_px, incidence_deg: pw.incidence_deg ?? null, method: pw.method ?? null });
    }
  }
  return out;
}
