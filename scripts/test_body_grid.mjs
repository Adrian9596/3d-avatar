#!/usr/bin/env node
/**
 * Gate for contracts/body-grid.json and scripts/body_grid.mjs — the vertical
 * half of the reference frame.
 *
 * The claim being gated is not "these curves are in the right place" (a curve
 * has no right place to be checked against). It is that every curve is READ OFF
 * THE MESH BY A RULE WITH NO CHOSEN NUMBER IN IT, and that the rules do what
 * they say:
 *
 *   * the contract validates against the registry, and a rule this module does
 *     not implement, an unlisted landmark or a boundary smuggled in as a curve
 *     is refused;
 *   * the contract carries no threshold, tolerance or length — a curve is drawn,
 *     never measured, so it cannot disagree with a POM;
 *   * CENTRE_FRONT and CENTRE_BACK land on the symmetry plane to within the
 *     mesh's own weld quantum, and on opposite sides of the body;
 *   * SIDE_L and SIDE_R are the widest points of their sections: no sampled
 *     point of any other curve is further out at the same height, and the pair
 *     agrees with the registry's own SIDE_UNDERBUST_L/R at the fold, which was
 *     detected by the same rule through a different code path;
 *   * APEX_VERTICAL_L/R pass through their apex, and without the apex landmark
 *     they report `needs` and no points at all — never a fallback near x = 0;
 *   * SIDE_L/R stop at the armhole ceiling, because above it the widest point of
 *     a section is the cut edge and not the body;
 *   * every sampled point is on the measurement surface (its height has a
 *     section, and it is one of that section's own points);
 *   * the four boundary loops are the four the asset is cut into, they close,
 *     and the armhole pair matches the registry's UNDERARM_L/R, which are
 *     defined as the lowest point of exactly those loops.
 *
 * Exit codes: 0 pass, 1 a check failed, 2 an input is missing or stale.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGate, sha256File } from './gate_report.mjs';
import { loadAvatarContext } from './flatten_fixtures.mjs';
import { sectionSegments, segmentPoints } from './measure_core.mjs';
import { DEFAULT_WELD_QUANTUM } from './flatten_mesh.mjs';
import { loadGrid, sampleCurves, sampleBoundaries, gridRecord, GRID_LIMIT } from './body_grid.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = join(ROOT, 'contracts', 'body-grid.json');
const REPORT = join(ROOT, 'qa', 'avatar_master', 'body-grid.json');
const gate = createGate();
const mm = (v) => Number((v * 1000).toFixed(4));

const ctx = loadAvatarContext(ROOT);
if (ctx.error) gate.blocked(ctx.error);
if (!existsSync(CONTRACT)) gate.blocked(`missing ${relative(ROOT, CONTRACT)}`);
const contract = JSON.parse(readFileSync(CONTRACT, 'utf8'));
const evidence = JSON.parse(readFileSync(join(ROOT, 'qa', 'avatar_master', 'measurements.json'), 'utf8'));

// ---- the contract ----------------------------------------------------------
const loaded = loadGrid(contract, ctx.registry);
gate.record('the contract validates against the registry',
  loaded.errors.length === 0
    && loaded.curves.length === contract.curves.length
    && loaded.boundaries.length === contract.boundaries.length,
  loaded.errors.join('; ') || `${loaded.curves.length} curves, ${loaded.boundaries.length} boundaries, every landmark declared`);
gate.record('the contract states the grid limit', loaded.declared_limit === GRID_LIMIT, loaded.declared_limit);

const bad = loadGrid({
  groups: contract.groups,
  curves: [
    { id: 'A', group: 'centre', rule: 'princess_line', side: 'front', x_m: 0 },
    { id: 'B', group: 'centre', rule: 'section_nearest_x', side: 'front', x_from_landmark: 'BUST_APEX_L', requires: [] },
    { id: 'C', group: 'nope', rule: 'boundary_loop' },
  ],
  boundaries: [{ id: 'D', group: 'boundary', rule: 'boundary_loop', pick: 'middle' }],
}, ctx.registry);
gate.record('an unimplemented rule, an unlisted landmark, a boundary as a curve and a sideless middle loop are all refused',
  bad.curves.length === 0 && bad.boundaries.length === 0 && bad.errors.length === 4,
  bad.errors.join(' | ').slice(0, 220));

// A curve is drawn, never measured: there is nothing in the contract for a
// number to hide in, which is what keeps the grid out of the measurement story.
const text = JSON.stringify(contract);
// Prose is where the contract explains it carries no tolerance, so the scan for
// one reads the declared FIELDS with every comment dropped, not the sentences
// about them — otherwise the sentence "no length is reported" fails the check
// that no length is reported.
const withoutProse = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !/comment|note|label/.test(k)));
const declarations = JSON.stringify({
  curves: contract.curves.map(withoutProse),
  boundaries: contract.boundaries.map(withoutProse),
  sampling: withoutProse(contract.sampling),
});
gate.record('the contract carries no tolerance, no length and no threshold',
  !/tolerance|threshold|length|girth|house_code/i.test(declarations)
    && ![...contract.curves, ...contract.boundaries].some((c) => 'tolerance' in c || 'threshold' in c),
  'a curve has a rule and a side, and nothing to compare a body against');
gate.record('no curve is a seam, a style line or a princess line',
  contract.declared_limits.some((l) => /not a seam|no curve here is a seam/i.test(l))
    && !/princess|style_line|side_seam|strap_line/i.test(text.replace(/"comment":"[^"]*"|"[^"]*_note":"[^"]*"|"declared_limits?":\[[^\]]*\]|"status_note":"[^"]*"/g, '')),
  'the grid declares geometry; where a seam goes stays a person\'s decision');

// ---- the curves on this body ----------------------------------------------
const scan = ctx.registry.scan;
const sampled = sampleCurves(loaded, ctx.tri, ctx.landmarks, { scan });
const byId = Object.fromEntries(sampled.map((s) => [s.curve.id, s]));
gate.record('every curve with its landmarks present samples along the body',
  sampled.every((s) => (s.needs ? s.points.length === 0 : s.points.length > 20)),
  sampled.map((s) => `${s.curve.id} ${s.needs ? `needs ${s.needs.join(',')}` : `${s.points.length} pts`}`).join(', '));


// A section point is where an edge crosses that height, so a curve can only
// land as close to its plane as the mesh has geometry there. The budget is the
// mesh's own resolution — the widest gap between neighbouring section points
// around centre — not a number picked to make this pass.
const centreOff = ['CENTRE_FRONT', 'CENTRE_BACK'].flatMap((id) => byId[id].points.map((p) => Math.abs(p[0])));
let centreResolution = 0;
for (const p of byId.CENTRE_FRONT.points) {
  const section = segmentPoints(sectionSegments(ctx.tri, p[1]));
  const nearby = section.filter(([, z]) => Math.abs(z - p[2]) < 0.02).map(([x]) => x).sort((a, b) => a - b);
  for (let i = 1; i < nearby.length; i++) {
    if (nearby[i - 1] <= 0 && nearby[i] >= 0) centreResolution = Math.max(centreResolution, nearby[i] - nearby[i - 1]);
  }
}
const worstCentre = Math.max(...centreOff);
gate.record('centre front and centre back sit on the symmetry plane, to the mesh\'s own resolution',
  worstCentre <= centreResolution / 2 + DEFAULT_WELD_QUANTUM,
  `worst |x| ${mm(worstCentre)}mm; the mesh straddles x = 0 with points ${mm(centreResolution)}mm apart there, so half of that is all a section point can do`);
gate.record('centre front is in front of centre back at every height',
  byId.CENTRE_FRONT.points.every((p, i) => {
    const back = byId.CENTRE_BACK.points[i];
    return back && Math.abs(back[1] - p[1]) < 1e-9 && p[2] > back[2];
  }),
  `${byId.CENTRE_FRONT.points.length} heights, front z > back z at each`);

// Side: the widest point, cross-checked against a landmark found another way.
const wider = [];
for (const id of ['SIDE_L', 'SIDE_R']) {
  const sign = byId[id].curve.sign;
  for (const [x, y] of byId[id].points.map((p) => [p[0], p[1]])) {
    for (const other of sampled) {
      if (other.curve.id === id) continue;
      const at = other.points.find((p) => Math.abs(p[1] - y) < 1e-9);
      if (at && at[0] * sign > x * sign + 1e-9) wider.push(`${other.curve.id} at y=${y}`);
    }
  }
}
gate.record('a side curve is the widest point of its section',
  wider.length === 0, wider.length ? wider.slice(0, 3).join('; ') : 'no other curve reaches further out at any shared height');

const foldY = evidence.landmarks?.UNDERBUST_FOLD?.y_m;
const sideCheck = [['SIDE_L', 'SIDE_UNDERBUST_L'], ['SIDE_R', 'SIDE_UNDERBUST_R']].map(([curveId, markId]) => {
  const mark = evidence.landmarks?.[markId]?.xyz_m;
  const at = byId[curveId].points.reduce((best, p) =>
    (best === null || Math.abs(p[1] - foldY) < Math.abs(best[1] - foldY) ? p : best), null);
  return { markId, delta: mark && at ? Math.hypot(mark[0] - at[0], mark[2] - at[2]) : Infinity };
});
gate.record('the side curves agree with the registry\'s own side points at the fold',
  sideCheck.every((c) => c.delta <= 0.001),
  sideCheck.map((c) => `${c.markId} ${mm(c.delta)}mm`).join(', ') + ' — same rule, different code path');

// Apex verticals: through the apex, and honest without it.
const apexCheck = [['APEX_VERTICAL_L', 'BUST_APEX_L'], ['APEX_VERTICAL_R', 'BUST_APEX_R']].map(([curveId, markId]) => {
  const apex = ctx.landmarks[markId];
  const at = byId[curveId].points.reduce((best, p) =>
    (best === null || Math.abs(p[1] - apex[1]) < Math.abs(best[1] - apex[1]) ? p : best), null);
  return { curveId, dx: Math.abs(at[0] - apex[0]), dz: Math.abs(at[2] - apex[2]) };
});
gate.record('an apex vertical passes through its apex',
  apexCheck.every((c) => c.dx <= 0.001 && c.dz <= 0.002),
  apexCheck.map((c) => `${c.curveId} Δx ${mm(c.dx)}mm Δz ${mm(c.dz)}mm`).join(', '));
const noApex = sampleCurves(loaded, ctx.tri, {}, { scan });
const apexRows = noApex.filter((s) => s.curve.x_from_landmark);
gate.record('without the apex landmark an apex vertical reads needs …, never a fallback near centre',
  apexRows.length === 2 && apexRows.every((s) => s.needs?.length === 1 && s.points.length === 0),
  apexRows.map((s) => `${s.curve.id} needs ${s.needs?.join(',')}`).join(', '));
gate.record('a curve that needs nothing still draws without any landmark',
  noApex.filter((s) => !s.curve.x_from_landmark).every((s) => s.points.length > 20),
  'centre and side depend on the mesh alone');

// The ceiling, and the reason for it.
for (const id of ['SIDE_L', 'SIDE_R']) {
  const ceiling = byId[id].curve.max_y_m;
  const top = byId[id].points[byId[id].points.length - 1][1];
  gate.record(`${id} stops at the armhole ceiling`,
    top <= ceiling + 1e-9 && top > ceiling - scan.step_m - 1e-9,
    `top sample y = ${top.toFixed(4)}m, ceiling ${ceiling}m — above it the widest point is the armhole cut`);
}

// Every sampled point must be a point of the section at its own height: the
// grid may not wander off the measurement surface.
let offSurface = 0, checked = 0;
for (const { points } of sampled) {
  for (let i = 0; i < points.length; i += 7) {          // every 7th, ~35mm apart
    const [x, y, z] = points[i];
    const section = segmentPoints(sectionSegments(ctx.tri, y));
    checked++;
    if (!section.some(([sx, sz]) => Math.abs(sx - x) < 1e-9 && Math.abs(sz - z) < 1e-9)) offSurface++;
  }
}
gate.record('every sampled point is a point of its own section',
  offSurface === 0, `${checked} points sampled across the curves, ${offSurface} off the surface`);

// ---- the boundaries --------------------------------------------------------
const bounds = sampleBoundaries(loaded, ctx.tri);
const byBound = Object.fromEntries(bounds.map((b) => [b.boundary.id, b]));
gate.record('the four cut lines of this asset are found',
  bounds.every((b) => !b.blocked && b.points.length > 8),
  bounds.map((b) => `${b.boundary.id} ${b.blocked || `${b.points.length} pts`}`).join(', '));
gate.record('each boundary loop closes',
  bounds.every((b) => {
    if (b.blocked) return false;
    const a = b.points[0], z = b.points[b.points.length - 1];
    return Math.hypot(a[0] - z[0], a[1] - z[1], a[2] - z[2]) < 0.02;
  }),
  'first and last vertex of each walk are neighbours on the same loop');
const armCheck = [['ARMHOLE_L', 'UNDERARM_L'], ['ARMHOLE_R', 'UNDERARM_R']].map(([id, markId]) => {
  const mark = evidence.landmarks?.[markId]?.xyz_m;
  const lowest = byBound[id].points.reduce((best, p) => (p[1] < best[1] ? p : best), byBound[id].points[0]);
  return { markId, delta: mark ? Math.hypot(mark[0] - lowest[0], mark[1] - lowest[1], mark[2] - lowest[2]) : Infinity };
});
gate.record('the armhole loops are the ones the registry\'s underarm points came from',
  armCheck.every((c) => c.delta <= 0.001),
  armCheck.map((c) => `${c.markId} ${mm(c.delta)}mm from the loop's lowest point`).join(', '));
gate.record('the neck opening is above every armhole and the waist cut below',
  Math.min(...byBound.NECK_OPENING.points.map((p) => p[1]))
    > Math.max(...byBound.ARMHOLE_L.points.map((p) => p[1]), ...byBound.ARMHOLE_R.points.map((p) => p[1])) - 1e-9
  && Math.max(...byBound.WAIST_CUT.points.map((p) => p[1]))
    < Math.min(...byBound.ARMHOLE_L.points.map((p) => p[1]), ...byBound.ARMHOLE_R.points.map((p) => p[1])),
  'sorted by height, and the two left over are the armholes — no threshold anywhere');
gate.record('the contract says the boundaries are cut lines, not garment edges',
  contract.declared_limits.some((l) => /cut line/i.test(l) && /head was removed/i.test(l)),
  'the neck opening is where the head was removed');

// ---- evidence ---------------------------------------------------------------
const record = gridRecord(sampled, bounds, loaded);
gate.finish({
  reportPath: REPORT,
  body: {
    purpose: 'The vertical half of the reference frame: centre, side and apex curves read off this mesh, and the four lines it is cut on.',
    asset: { path: ctx.registry.asset, sha256: ctx.assetSha },
    contract: { path: 'contracts/body-grid.json', sha256: sha256File(CONTRACT) },
    scan,
    cross_checks: {
      side_vs_registry_mm: sideCheck.map((c) => ({ landmark: c.markId, delta_mm: mm(c.delta) })),
      armhole_vs_registry_mm: armCheck.map((c) => ({ landmark: c.markId, delta_mm: mm(c.delta) })),
      centre_off_plane_mm: mm(Math.max(...centreOff)),
    },
    ...record,
    declared_limits: contract.declared_limits,
  },
  okDecision: 'GRID_IS_READ_OFF_THIS_MESH',
  relativeTo: ROOT,
  lines: [
    `CURVES ${sampled.filter((s) => !s.needs).length} drawn, ${sampled.filter((s) => s.needs).length} needing a landmark`,
    `BOUNDS ${bounds.filter((b) => !b.blocked).length} of ${bounds.length} cut lines found`,
    'GRID   drawn, never measured — no length, no tolerance, no seam',
  ],
});
