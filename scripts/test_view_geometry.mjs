#!/usr/bin/env node
/**
 * Gate for scripts/view_geometry.mjs — the maths behind the grazing guard, the
 * `F` key and the turntable — against the analytic answers.
 *
 * What it proves: a pixel's footprint is 2·d·tan(fov/2)/H over cos(incidence),
 * reproducing AUTHORING_UX_PLAN.md §4.1 at the viewer's framing; incidence is
 * orientation-free and bounded; the pose facing a normal looks along −normal at
 * the asked distance and respects the polar clamp; 24 turntable steps of 15°
 * compose to the identity; the framing distance matches what the lanes' view
 * presets computed before it was shared.
 *
 * Exit codes: 0 pass, 1 a check failed.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGate, sha256File } from './gate_report.mjs';
import {
  footprintMmPerPx, incidence, placement, poseFacing, turntable, framingDistance, spherical,
  grazingLevel, DEFAULT_POLAR_LIMITS, GRAZING_WARN_DEG, GRAZING_ALERT_DEG,
} from './view_geometry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = join(ROOT, 'qa', 'avatar_master', 'view-geometry-test.json');
const gate = createGate();
const DEG = Math.PI / 180;
const close = (a, b, tol) => Math.abs(a - b) <= tol;
const r3 = (v) => Number(v.toFixed(3));

// ---- footprint: the §4.1 table, reproduced from the formula ----------------
// viewer framing: 28° FOV, camera 1.575 m from the body, 900 px pane
const FRAMING = { distance_m: 1.575, fov_deg: 28, pixel_height: 900 };
const table = [0, 60, 75, 85].map((deg) => ({
  incidence_deg: deg,
  mm_per_px: Number(footprintMmPerPx({ ...FRAMING, incidence_rad: deg * DEG }).toFixed(2)),
}));
const facing = (2 * 1.575 * Math.tan(14 * DEG)) / 900 * 1000;
gate.record('footprint facing = 2·d·tan(fov/2)/H', close(table[0].mm_per_px, facing, 0.005), `${table[0].mm_per_px} mm/px (analytic ${facing.toFixed(3)})`);
gate.record('footprint grows as 1/cos(incidence)',
  close(table[1].mm_per_px, facing / Math.cos(60 * DEG), 0.006) && close(table[2].mm_per_px, facing / Math.cos(75 * DEG), 0.006) && close(table[3].mm_per_px, facing / Math.cos(85 * DEG), 0.006),
  `60°: ${table[1].mm_per_px} · 75°: ${table[2].mm_per_px} · 85°: ${table[3].mm_per_px} mm/px`);
gate.record('footprint at 90° is infinite, never NaN', footprintMmPerPx({ ...FRAMING, incidence_rad: Math.PI / 2 }) === Infinity, 'grazing exactly edge-on');
const zoomed = footprintMmPerPx({ distance_m: 0.35, fov_deg: 28, pixel_height: 900 });
gate.record('zooming to 0.35 m gives 0.19 mm/px', close(zoomed, 0.19, 0.005), `${zoomed.toFixed(3)} mm/px`);

// ---- incidence -------------------------------------------------------------
const incA = incidence([0, 0, 1], [0, 0, 5]);
const incB = incidence([0, 0, -1], [0, 0, 5]);
const inc60 = incidence([0, 0, 1], [Math.sin(60 * DEG), 0, Math.cos(60 * DEG)]);
gate.record('incidence is orientation-free', close(incA, 0, 1e-12) && close(incB, 0, 1e-12), 'a normal pointing into the body reads the same');
gate.record('incidence of a 60° view is 60°', close(inc60, 60 * DEG, 1e-9), `${(inc60 / DEG).toFixed(6)}°`);
gate.record('incidence is bounded to [0°, 90°]', incidence([1, 0, 0], [-1, 0, 0]) <= Math.PI / 2 + 1e-12 && incidence([1, 0, 0], [0, 1, 0]) <= Math.PI / 2 + 1e-12, 'opposed and perpendicular directions');

// ---- placement record ------------------------------------------------------
const rec = placement({ point: [0, 1.3, 0.14], normal: [0, 0, 1], cameraPosition: [0, 1.3, 0.14 + 1.575], fov_deg: 28, pixel_height: 900, method: 'click' });
gate.record('placement records distance, incidence and footprint', rec.distance_m === 1.575 && rec.incidence_deg === 0 && close(rec.footprint_mm_px, 0.87, 0.005) && rec.method === 'click',
  JSON.stringify(rec));

// ---- pose facing a normal --------------------------------------------------
const P = [-0.08, 1.33, 0.14];
const N = [0.3, 0.2, 0.93];
const pose = poseFacing({ point: P, normal: N, distance_m: 0.4 });
const nl = Math.hypot(...N);
const dir = pose.position.map((v, i) => (v - P[i]) / 0.4);
const alongNormal = dir.every((v, i) => close(v, N[i] / nl, 1e-9));
const dist = Math.hypot(...pose.position.map((v, i) => v - P[i]));
gate.record('poseFacing looks along −normal at the asked distance', alongNormal && close(dist, 0.4, 1e-9) && pose.target.every((v, i) => v === P[i]), `direction error ${Math.max(...dir.map((v, i) => Math.abs(v - N[i] / nl))).toExponential(2)}`);
const top = poseFacing({ point: P, normal: [0, 1, 0], distance_m: 0.4 });
const topSph = spherical(top.position, P);
gate.record('poseFacing clamps a near-vertical normal to the polar limits', close(topSph.polar, DEFAULT_POLAR_LIMITS.min_rad, 1e-9) && close(topSph.radius, 0.4, 1e-9), `polar ${topSph.polar.toFixed(4)} rad (limit ${DEFAULT_POLAR_LIMITS.min_rad})`);

// ---- turntable -------------------------------------------------------------
let cam = { position: [0.2, 1.4, 1.5], target: [0, 1.3, 0] };
const start = cam.position.slice();
for (let k = 0; k < 24; k++) cam = turntable(cam, { yaw_rad: 15 * DEG });
gate.record('24 turntable steps of 15° compose to the identity', cam.position.every((v, i) => close(v, start[i], 1e-9)), `max drift ${Math.max(...cam.position.map((v, i) => Math.abs(v - start[i]))).toExponential(2)} m`);
const r0 = spherical(cam.position, cam.target).radius;
const pitched = turntable(cam, { pitch_rad: 30 * DEG });
gate.record('turntable keeps the distance to the target', close(spherical(pitched.position, pitched.target).radius, r0, 1e-9), `${r0.toFixed(6)} m`);
let up = cam;
for (let k = 0; k < 20; k++) up = turntable(up, { pitch_rad: 15 * DEG });
gate.record('turntable never breaches the polar clamp', spherical(up.position, up.target).polar >= DEFAULT_POLAR_LIMITS.min_rad - 1e-12, `polar ${spherical(up.position, up.target).polar.toFixed(4)} rad after 300° of pitch`);

// ---- framing -------------------------------------------------------------
const size = [0.799, 0.604, 0.292];
const framed = framingDistance({ size_m: size, fov_deg: 28, aspect: 1400 / 900 });
const expected = Math.max(size[1] / (2 * Math.tan(14 * DEG)), Math.max(size[0], size[2]) / (2 * Math.tan(14 * DEG) * (1400 / 900))) * 1.3;
gate.record('framingDistance matches the lanes\' former preset maths', close(framed, expected, 1e-12) && close(framed, 1.575, 0.002), `${framed.toFixed(4)} m for the avatar\'s box at 1400×900`);

// ---- grazing guard thresholds ---------------------------------------------
gate.record('grazing levels switch at the declared thresholds',
  grazingLevel(GRAZING_WARN_DEG - 0.1) === 'ok' && grazingLevel(GRAZING_WARN_DEG) === 'warn' && grazingLevel(GRAZING_ALERT_DEG) === 'alert',
  `${GRAZING_WARN_DEG}° warn, ${GRAZING_ALERT_DEG}° alert — display only`);

gate.finish({
  reportPath: REPORT, relativeTo: ROOT, okDecision: 'VIEW_GEOMETRY_VERIFIED',
  body: {
    purpose: 'The maths behind the grazing guard, the F key and the turntable, against analytic answers.',
    module: { file: 'scripts/view_geometry.mjs', sha256: sha256File(join(ROOT, 'scripts', 'view_geometry.mjs')) },
    viewer_framing: { ...FRAMING, footprint_table: table, zoomed_0p35m_mm_per_px: r3(zoomed) },
    thresholds_deg: { warn: GRAZING_WARN_DEG, alert: GRAZING_ALERT_DEG, note: 'display thresholds; they change no recorded value' },
    declared_limits: [
      'Footprint is what one pixel covers on a plane at the hit point; a curved surface inside that pixel is not modelled.',
      'The pose facing a normal is clamped to the controls\' polar limits, so a point on top of the shoulder is faced as squarely as the camera may.',
    ],
  },
});
