/**
 * What a click is worth on the skin, and where a camera must stand to look at a
 * point squarely. Pure functions on plain arrays; both viewer lanes and the pen
 * import them, and `scripts/test_view_geometry.mjs` checks them against the
 * analytic answers (AUTHORING_UX_PLAN.md §4.1, §5, §15 A1).
 *
 * The one fact this module exists to make visible: a pixel's footprint on a
 * surface is `2·d·tan(fov/2) / H` divided by the cosine of the incidence angle.
 * At the viewer's framing that is 0.87 mm facing, 3.4 mm at 75°, 10 mm at 85° —
 * incidence, not zoom, is the dominant placement error, so every hand-placed
 * point records both (`placement`).
 *
 * Conventions: metres, radians inside, degrees only in records; `up` is +Y.
 */

const DEG = 180 / Math.PI;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a) => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const UP = Object.freeze([0, 1, 0]);
/** OrbitControls' polar clamp in both lanes: the camera never looks straight down the body axis. */
export const DEFAULT_POLAR_LIMITS = Object.freeze({ min_rad: 0.35, max_rad: Math.PI - 0.35 });
/** Display thresholds for the grazing guard — they colour the tip, they change no value. */
export const GRAZING_WARN_DEG = 60;
export const GRAZING_ALERT_DEG = 75;

/**
 * Millimetres one screen pixel covers on a surface.
 * @param distance_m   camera to surface point
 * @param fov_deg      vertical field of view
 * @param pixel_height canvas height in CSS pixels
 * @param incidence_rad angle between the surface normal and the view direction (0 = facing)
 */
export function footprintMmPerPx({ distance_m, fov_deg, pixel_height, incidence_rad = 0 }) {
  const facing = (2 * distance_m * Math.tan((fov_deg * Math.PI) / 360)) / pixel_height;
  const cos = Math.cos(Math.min(Math.abs(incidence_rad), Math.PI / 2));
  return (cos > 1e-9 ? facing / cos : Infinity) * 1000;
}

/** Angle in [0, π/2] between a surface normal and the direction from the point to the camera.
 *  Orientation-free: a normal that points into the body gives the same answer. */
export function incidence(normal, toCamera) {
  const c = Math.abs(dot(normalize(normal), normalize(toCamera)));
  return Math.acos(Math.min(1, Math.max(0, c)));
}

/**
 * The record every hand-placed point carries: how far the camera was, how
 * obliquely the surface was seen, and what one pixel was worth there.
 */
export function placement({ point, normal, cameraPosition, fov_deg, pixel_height, method }) {
  const toCamera = sub(cameraPosition, point);
  const distance_m = length(toCamera);
  const inc = incidence(normal, toCamera);
  return {
    method,
    distance_m: Number(distance_m.toFixed(4)),
    incidence_deg: Number((inc * DEG).toFixed(1)),
    footprint_mm_px: Number(footprintMmPerPx({ distance_m, fov_deg, pixel_height, incidence_rad: inc }).toFixed(2)),
  };
}

/** Polar angle (from +Y) and azimuth of a camera about its target. */
export function spherical(position, target) {
  const d = sub(position, target);
  const r = length(d) || 1e-9;
  return { radius: r, polar: Math.acos(Math.min(1, Math.max(-1, d[1] / r))), azimuth: Math.atan2(d[0], d[2]) };
}

export function fromSpherical(target, { radius, polar, azimuth }) {
  const s = Math.sin(polar);
  return add(target, [radius * s * Math.sin(azimuth), radius * Math.cos(polar), radius * s * Math.cos(azimuth)]);
}

const clampPolar = (polar, limits) => Math.min(limits.max_rad, Math.max(limits.min_rad, polar));

/**
 * Where the camera stands to look at `point` along its normal from `distance_m`
 * away — the pose the `F` key moves to. The view direction is −normal except
 * where that would breach the polar limits (a normal near the body axis); then
 * the elevation is clamped and the azimuth kept, so the camera still faces the
 * point as squarely as the controls allow.
 */
export function poseFacing({ point, normal, distance_m, polar_limits = DEFAULT_POLAR_LIMITS }) {
  const n = normalize(normal);
  const raw = add(point, scale(n, distance_m));
  const sph = spherical(raw, point);
  const polar = clampPolar(sph.polar, polar_limits);
  const position = polar === sph.polar ? raw : fromSpherical(point, { ...sph, polar });
  return { position, target: [point[0], point[1], point[2]] };
}

/** Turn the camera about its target: yaw about +Y, pitch in elevation, polar clamped. */
export function turntable({ position, target }, { yaw_rad = 0, pitch_rad = 0, polar_limits = DEFAULT_POLAR_LIMITS }) {
  const sph = spherical(position, target);
  return {
    position: fromSpherical(target, { radius: sph.radius, polar: clampPolar(sph.polar - pitch_rad, polar_limits), azimuth: sph.azimuth + yaw_rad }),
    target: [target[0], target[1], target[2]],
  };
}

/** Distance at which a box of `size_m` fits the view with `margin` to spare — what
 *  both lanes' view presets use. */
export function framingDistance({ size_m, fov_deg, aspect, margin = 1.3 }) {
  const t = Math.tan((fov_deg * Math.PI) / 360);
  const fitHeight = size_m[1] / (2 * t);
  const fitWidth = Math.max(size_m[0], size_m[2]) / (2 * t * aspect);
  return Math.max(fitHeight, fitWidth) * margin;
}

/** The right-handed view frame at a pose: forward, right, up. */
export function viewFrame({ position, target }, up = UP) {
  const forward = normalize(sub(target, position));
  const right = normalize(cross(forward, up));
  return { forward, right, up: cross(right, forward) };
}

/** How the tip should read a footprint: 'ok' | 'warn' | 'alert'. Display only. */
export function grazingLevel(incidence_deg) {
  if (incidence_deg >= GRAZING_ALERT_DEG) return 'alert';
  if (incidence_deg >= GRAZING_WARN_DEG) return 'warn';
  return 'ok';
}
