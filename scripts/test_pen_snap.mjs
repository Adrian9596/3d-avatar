#!/usr/bin/env node
/**
 * Gate for scripts/pen_snap.mjs — where a pen anchor goes when a click lands
 * near something it should meet.
 *
 * What it proves: the nearest candidate within the pick radius wins and priority
 * breaks ties; nothing outside the radius snaps; snapping off returns nothing;
 * a held-modifier constraint (level, mirror) beats any proximity snap; the level
 * candidate lands on the skin at the previous anchor's height (cylinder: on the
 * surface to 1e-9); the mirror candidate on the cylinder has residual 0, and on
 * the avatar its residual is RECORDED — 0.000 mm expected on this asset, which
 * is a mirrored half, and flagged past 5 mm on any body that is not.
 *
 * Exit codes: 0 pass, 1 a check failed, 2 the avatar context is unavailable.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGate, sha256File, mm } from './gate_report.mjs';
import { buildGrid, closestOnMesh } from './surface_path.mjs';
import { sectionSegments, segmentPoints } from './measure_core.mjs';
import { cylinderSoup, loadAvatarContext } from './flatten_fixtures.mjs';
import {
  resolveSnap, nearestOnPolyline, levelCandidate, mirrorCandidate, mirrorPoints, snapRecord,
  SNAP_RADIUS_PX, SNAP_PRIORITY, MIRROR_FLAG_MM,
} from './pen_snap.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = join(ROOT, 'qa', 'avatar_master', 'pen-snap-test.json');
const gate = createGate();
const close = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- resolution: nearest wins, priority breaks ties, radius, disabled --------
const cands = [
  { kind: 'landmark', px: [100, 100], point: [0, 0, 0], ref: { name: 'BUST_APEX_L' } },
  { kind: 'anchor', px: [104, 100], point: [1, 0, 0], ref: { line: 'Line 1' } },
  { kind: 'line', px: [104, 100], point: [2, 0, 0], ref: { line: 'Line 2' } },
  { kind: 'first', px: [130, 100], point: [3, 0, 0] },
];
const nearest = resolveSnap({ cursor_px: [101, 100], candidates: cands });
gate.record('the nearest candidate within the radius wins', nearest?.kind === 'landmark' && nearest.distance_px === 1, `${nearest?.kind} at ${nearest?.distance_px} px`);
const tie = resolveSnap({ cursor_px: [104, 100], candidates: cands });
gate.record('a tie goes to the higher priority (anchor over line)', tie?.kind === 'anchor', `${tie?.kind}; order ${SNAP_PRIORITY.join(' › ')}`);
const far = resolveSnap({ cursor_px: [200, 200], candidates: cands });
gate.record(`nothing outside ${SNAP_RADIUS_PX} px snaps`, far === null, 'cursor 140 px from every candidate');
const edge = resolveSnap({ cursor_px: [85, 100], candidates: cands });
gate.record('the radius is inclusive', edge?.kind === 'landmark' && edge.distance_px === 15, `${edge?.distance_px} px (the others are 19 px and 45 px away)`);
gate.record('snapping off returns nothing', resolveSnap({ cursor_px: [101, 100], candidates: cands, enabled: false }) === null, 'N toggles it');
const constrained = resolveSnap({ cursor_px: [101, 100], candidates: [...cands, { kind: 'level', px: null, point: [9, 9, 9], ref: { height_m: 1.3 } }] });
gate.record('a held-modifier constraint beats any proximity snap', constrained?.kind === 'level' && constrained.distance_px === 0, 'level at distance 0 over a landmark 1 px away');
gate.record('an unknown kind is ignored', resolveSnap({ cursor_px: [0, 0], candidates: [{ kind: 'magic', px: [0, 0], point: [0, 0, 0] }] }) === null, 'kinds are the six of SNAP_PRIORITY');

// ---- nearest point on a polyline -------------------------------------------
const poly = [[0, 0, 0], [1, 0, 0], [1, 1, 0]];
const np = nearestOnPolyline(poly, [0.5, -0.2, 0]);
const npClosed = nearestOnPolyline(poly, [0.4, 0.6, 0], true);
gate.record('nearestOnPolyline projects onto the right segment', np && close(np.point[0], 0.5, 1e-12) && np.point[1] === 0 && np.index === 0 && close(np.distance_m, 0.2, 1e-12), JSON.stringify(np));
gate.record('nearestOnPolyline honours the closing segment', npClosed && npClosed.index === 2 && close(npClosed.distance_m, Math.abs(0.4 - 0.6) / Math.SQRT2, 1e-12), `closing segment, ${npClosed?.distance_m.toFixed(4)} m`);

// ---- cylinder: level and mirror on an analytic surface ----------------------
const R = 0.1;
const cyl = cylinderSoup({ radius_m: R, height_m: 0.4, arc_deg: 360, angular_segments: 96, vertical_segments: 8 });
const tri = new Float32Array(cyl);
const grid = buildGrid(tri);
const closest = (p) => closestOnMesh(grid, p);
const section = (y) => segmentPoints(sectionSegments(tri, y));
// on the 96-gon's surface, not the true circle: a mirror residual is measured from the skin
const previous = closest([R * Math.cos(0.3), 0.25, R * Math.sin(0.3)]).point;
const hit = [R * Math.cos(1.2), 0.11, R * Math.sin(1.2)];
const level = levelCandidate({ previous, hit, section });
const onCyl = level && close(Math.hypot(level.point[0], level.point[2]), R * Math.cos(Math.PI / 96), 2e-4);   // a facet of the 96-gon
gate.record('level candidate sits at the previous anchor\'s height', level && level.point[1] === 0.25 && close(level.residual_m, 0.14, 1e-12), `y ${level?.point[1]} (hit was at 0.11)`);
gate.record('level candidate lies on the skin, not the hull', onCyl && close(Math.atan2(level.point[2], level.point[0]), 1.2, 0.04), `radius ${Math.hypot(level.point[0], level.point[2]).toFixed(5)} m, angle ${Math.atan2(level.point[2], level.point[0]).toFixed(3)} rad`);
const mirror = mirrorCandidate({ source: previous, closest });
gate.record('mirror candidate on a symmetric surface has residual 0', mirror && close(mirror.residual_m, 0, 1e-9) && close(mirror.point[0], -previous[0], 1e-9) && !mirror.flagged, `${(mirror.residual_m * 1e6).toFixed(3)} µm`);
const off = mirrorCandidate({ source: [R * 1.2, 0.2, 0], closest });
gate.record('a mirrored point off the surface is snapped and its residual recorded', off && close(off.residual_m, 0.2 * R, 2e-4) && off.flagged, `${mm(off.residual_m, 2)} mm, flagged past ${MIRROR_FLAG_MM} mm`);

// ---- avatar: mirror residual recorded --------------------------------------
const ctx = loadAvatarContext(ROOT);
if (ctx.error) gate.blocked(ctx.error);
const apex = ctx.landmarks.BUST_APEX_L;
const avatarMirror = mirrorCandidate({ source: apex, closest: ctx.closest });
const ring = [];
for (let k = 0; k < 24; k++) {
  const th = (2 * Math.PI * k) / 24;
  ring.push(ctx.closest([apex[0] + 0.04 * Math.cos(th), apex[1] + 0.04 * Math.sin(th), apex[2]]).point);
}
const mirrored = mirrorPoints(ring, ctx.closest);
gate.record('avatar: the mirrored apex lands on the surface', avatarMirror && close(avatarMirror.point[0], -apex[0], 1e-6), `residual ${mm(avatarMirror.residual_m, 3)} mm (recorded, not budgeted)`);
gate.record('avatar: a mirrored 24-point loop records every residual', mirrored.residuals_mm.length === 24 && Number.isFinite(mirrored.max_residual_mm), `max ${mirrored.max_residual_mm} mm, flagged ${mirrored.flagged}`);
const rec = snapRecord({ ...avatarMirror, ref: { name: 'BUST_APEX_L' } });
gate.record('the snap record names its target and residual', rec.kind === 'mirror' && rec.to === 'BUST_APEX_L' && Number.isFinite(rec.residual_mm), JSON.stringify(rec));

gate.finish({
  reportPath: REPORT, relativeTo: ROOT, okDecision: 'SNAP_RESOLVES',
  body: {
    purpose: 'Where a pen anchor goes when a click lands near something it should meet: nearest within the radius, priority on ties, held constraints first; level and mirror on the skin with residuals recorded.',
    module: { file: 'scripts/pen_snap.mjs', sha256: sha256File(join(ROOT, 'scripts', 'pen_snap.mjs')) },
    asset: { file: 'assets/export/avatar_master.glb', sha256: ctx.assetSha },
    radius_px: SNAP_RADIUS_PX, priority: SNAP_PRIORITY, mirror_flag_mm: MIRROR_FLAG_MM,
    avatar: {
      apex_mirror_residual_mm: mm(avatarMirror.residual_m, 3),
      loop_24_max_residual_mm: mirrored.max_residual_mm, loop_flagged: mirrored.flagged,
      note: 'The source .blend is a mirrored half, so the residual is 0 here; on a scanned body it is expected to be non-zero and is flagged past the asymmetry threshold.',
    },
    declared_limits: [
      'A snap moves the anchor; the run between anchors stays the shortest surface path.',
      'The level candidate is taken from the section contour of the measurement surface; on an open mesh a height with no contour yields no snap.',
      'Mirror residual is recorded per point and flagged, never corrected away.',
    ],
  },
});
