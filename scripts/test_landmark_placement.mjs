#!/usr/bin/env node
/**
 * Gate for scripts/landmark_placement.mjs — the logic behind placing a landmark
 * by hand in the authoring lane.
 *
 * What it proves: the guided order covers exactly the registry's manual-only
 * landmarks and `nextNeeded` walks it, skipping placed ones; every registry
 * landmark gets a framing whose direction is unit, whose distance is positive
 * and whose target lies within 25 cm of the measurement surface; the pose it
 * yields respects the polar clamp; the mirror offer exists only when the
 * opposite side is hand-placed, lands on the skin and records its residual
 * (0.000 mm on this mirrored asset); a record carries value, source and
 * placed_with; placement notes fire above 3 mm/px and not below.
 *
 * Exit codes: 0 pass, 1 a check failed, 2 the avatar context is unavailable.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGate, sha256File } from './gate_report.mjs';
import { loadAvatarContext } from './flatten_fixtures.mjs';
import { DEFAULT_POLAR_LIMITS } from './view_geometry.mjs';
import {
  GUIDED_ORDER, PLACEMENT_NOTE_MM_PX, sideOf, oppositeOf, nextNeeded, framingFor, poseFor,
  mirrorOffer, landmarkRecord, placementRecord, placementNotes,
} from './landmark_placement.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = join(ROOT, 'qa', 'avatar_master', 'landmark-placement-test.json');
const gate = createGate();
const close = (a, b, tol) => Math.abs(a - b) <= tol;

const ctx = loadAvatarContext(ROOT);
if (ctx.error) gate.blocked(ctx.error);
const { registry, closest, landmarks: known } = ctx;
// levels the framing needs, from the authority pass
const evidence = JSON.parse((await import('node:fs')).readFileSync(join(ROOT, 'qa', 'avatar_master', 'measurements.json'), 'utf8'));
const landmarks = { ...known };
for (const [id, m] of Object.entries(evidence.landmarks || {})) if (Number.isFinite(m.y_m)) landmarks[id] = m.y_m;

// ---- the guided order is the registry's manual-only set ---------------------
const manualOnly = registry.landmarks.filter((l) => l.rule === 'manual_only').map((l) => l.id).sort();
gate.record('the guided order covers exactly the manual-only landmarks', JSON.stringify([...GUIDED_ORDER].sort()) === JSON.stringify(manualOnly), manualOnly.join(', '));
gate.record('nextNeeded starts at the first unplaced point', nextNeeded({ landmarks: {} }) === 'HPS_L', 'HPS_L');
gate.record('nextNeeded skips placed points and continues after the current one',
  nextNeeded({ landmarks: { HPS_L: { xyz_m: [0, 0, 0] }, ROOT_INNER_L: { xyz_m: [0, 0, 0] } } }, 'HPS_R') === 'ROOT_OUTER_L'
  && nextNeeded({ landmarks: { HPS_L: { xyz_m: [0, 0, 0] } } }, 'ROOT_TOP_R') === 'HPS_R', 'wraps around, never returns a placed id');
const all = Object.fromEntries(GUIDED_ORDER.map((id) => [id, { xyz_m: [0, 0, 0] }]));
gate.record('nextNeeded is null once every point is placed', nextNeeded({ landmarks: all }) === null, 'nothing needed');
gate.record('sides and opposites resolve', sideOf('ROOT_TOP_L') === 'L' && oppositeOf('ROOT_TOP_L') === 'ROOT_TOP_R' && oppositeOf('CF_UNDERBUST') === null && sideOf('WAIST_LEVEL') === null, 'HPS_L ↔ HPS_R; CF has no side');

// ---- a framing for every registry landmark ---------------------------------
const framings = registry.landmarks.map((l) => ({ id: l.id, framing: framingFor(l.id, landmarks) }));
const missing = framings.filter((f) => !f.framing).map((f) => f.id);
gate.record('every registry landmark has a framing', missing.length === 0, missing.length ? `none for ${missing.join(', ')}` : `${framings.length} landmarks`);
const unit = framings.every((f) => f.framing && close(Math.hypot(...f.framing.direction), 1, 1e-9) && f.framing.distance_m > 0);
gate.record('framing directions are unit and distances positive', unit, 'direction |d| = 1, distance_m > 0');
const offBody = framings.map((f) => {
  const c = closest(f.framing.target);
  return { id: f.id, target_to_skin_mm: c ? Number((Math.hypot(...c.point.map((v, i) => v - f.framing.target[i])) * 1000).toFixed(1)) : Infinity };
});
const worst = offBody.reduce((m, x) => Math.max(m, x.target_to_skin_mm), 0);
gate.record('every framing target lies within 25 cm of the measurement surface', worst <= 250, `worst ${worst} mm (${offBody.find((x) => x.target_to_skin_mm === worst)?.id})`);
const poses = framings.map((f) => poseFor(f.framing));
const polarOk = poses.every((p) => {
  const d = p.position.map((v, i) => v - p.target[i]);
  const polar = Math.acos(d[1] / Math.hypot(...d));
  return polar >= DEFAULT_POLAR_LIMITS.min_rad - 1e-9 && polar <= DEFAULT_POLAR_LIMITS.max_rad + 1e-9;
});
gate.record('every framing pose respects the polar clamp', polarOk, `${poses.length} poses`);
const hpsL = framingFor('HPS_L', landmarks), hpsR = framingFor('HPS_R', landmarks);
gate.record('left and right framings mirror each other', close(hpsL.target[0], -hpsR.target[0], 1e-9) && close(hpsL.direction[0], -hpsR.direction[0], 1e-9) && hpsL.target[1] === hpsR.target[1], 'HPS_L vs HPS_R');

// ---- the mirror offer -------------------------------------------------------
gate.record('no offer when the opposite side is not hand-placed', mirrorOffer('ROOT_INNER_R', { landmarks: {} }, closest) === null && mirrorOffer('CF_UNDERBUST', { landmarks: {} }, closest) === null, 'nothing to mirror');
const placedL = closest([known.BUST_APEX_L[0] * 0.4, known.BUST_APEX_L[1] - 0.005, known.BUST_APEX_L[2] - 0.01]).point;
const offer = mirrorOffer('ROOT_INNER_R', { landmarks: { ROOT_INNER_L: { xyz_m: placedL, source: 'manual' } } }, closest);
gate.record('the offer mirrors the opposite hand-placed point onto the skin', offer && offer.from === 'ROOT_INNER_L' && close(offer.xyz_m[0], -placedL[0], 1e-4) && close(offer.xyz_m[1], placedL[1], 1e-4), offer ? `ROOT_INNER_R ← ROOT_INNER_L, residual ${offer.residual_mm} mm` : 'no offer');
gate.record('the offer residual is recorded and unflagged on this mirrored asset', offer && Number.isFinite(offer.residual_mm) && offer.residual_mm < 5 && !offer.flagged, `${offer?.residual_mm} mm (flag past 5 mm)`);
const levelOffer = mirrorOffer('BUST_LEVEL', { landmarks: {} }, closest);
gate.record('a level has no mirror offer', levelOffer === null, 'levels have no side');

// ---- records ----------------------------------------------------------------
const pw = placementRecord({ point: placedL, normal: closest(placedL).normal, cameraPosition: [placedL[0], placedL[1], placedL[2] + 0.45], fov_deg: 28, pixel_height: 900, method: 'drag' });
const rec = landmarkRecord({ kind: 'point', point: placedL, placed_with: pw });
const mirrored = landmarkRecord({ kind: 'point', point: offer.xyz_m, placed_with: { method: 'mirror', residual_mm: offer.residual_mm, from: offer.from }, source: 'manual_mirrored' });
const level = landmarkRecord({ kind: 'level', y: 1.27004, placed_with: pw });
gate.record('a point record carries xyz, source manual and placed_with', rec.xyz_m.length === 3 && rec.source === 'manual' && rec.placed_with.method === 'drag' && Number.isFinite(rec.placed_with.footprint_mm_px), JSON.stringify(rec.placed_with));
gate.record('a mirrored record says so', mirrored.source === 'manual_mirrored' && mirrored.placed_with.method === 'mirror' && mirrored.placed_with.from === 'ROOT_INNER_L', 'source manual_mirrored, from ROOT_INNER_L');
gate.record('a level record carries only the height', level.y_m === 1.27004 && level.xyz_m === undefined, 'y_m, no xyz');
const notes = placementNotes({ landmarks: { A: { placed_with: { footprint_mm_px: 3.4, incidence_deg: 75 } }, B: { placed_with: { footprint_mm_px: 0.9 } }, C: {} } });
gate.record(`placement notes fire above ${PLACEMENT_NOTE_MM_PX} mm/px and not below`, notes.length === 1 && notes[0].id === 'A', JSON.stringify(notes));

gate.finish({
  reportPath: REPORT, relativeTo: ROOT, okDecision: 'PLACEMENT_LOGIC_OK',
  body: {
    purpose: 'The logic behind hand placement in the authoring lane: guided order, framing per landmark, the mirror offer, and the record a placed point carries.',
    module: { file: 'scripts/landmark_placement.mjs', sha256: sha256File(join(ROOT, 'scripts', 'landmark_placement.mjs')) },
    asset: { file: 'assets/export/avatar_master.glb', sha256: ctx.assetSha },
    guided_order: GUIDED_ORDER,
    framings: framings.map((f, i) => ({ id: f.id, target_m: f.framing.target.map((v) => Number(v.toFixed(4))), distance_m: f.framing.distance_m, target_to_skin_mm: offBody[i].target_to_skin_mm })),
    mirror_offer_example: offer,
    declared_limits: [
      'A framing frames the region a point belongs to; it does not place the point.',
      'A mirror is an offer, recorded as manual_mirrored with its residual when accepted; past 5 mm it is flagged, never corrected.',
      'placed_with is context about how a point was placed, not a correction to its value.',
    ],
  },
});
