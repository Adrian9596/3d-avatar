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
 *   * CENTRE_FRONT and CENTRE_BACK land ON the symmetry plane (the crossing is
 *     interpolated, so the mesh's resolution does not limit it), and on
 *     opposite sides of the body;
 *   * SIDE_L and SIDE_R are the outermost point of their section at its own
 *     mid-depth: no sampled point of any other curve is further out at the same
 *     height, they sit on the same wall as the registry's SIDE_UNDERBUST_L/R,
 *     and the rule they replaced — the widest point of the section — is shown
 *     here to name no depth at all, jumping further between two neighbouring
 *     heights than the curve moves over its whole run;
 *   * APEX_VERTICAL_L/R pass through their apex, and without the apex landmark
 *     they report `needs` and no points at all — never a fallback near x = 0;
 *   * SIDE_L/R stop at the armhole ceiling, because above it the section is open
 *     at the armhole and its outermost point is the cut edge, not the body;
 *   * every sampled point is on the measurement surface (its height has a
 *     section, and it lies on one of that section's own segments);
 *   * no curve steps sideways by the mesh's resolution: between neighbouring
 *     heights a centre or apex curve moves in x by nothing at all — the failure
 *     the crossing rule replaced was a 5mm zig-zag at every height;
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
    { id: 'B', group: 'centre', rule: 'section_crossing_x', side: 'front', x_from_landmark: 'BUST_APEX_L', requires: [] },
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


// The crossing is interpolated along the section segment, so centre lands on
// the plane exactly — not within the mesh's resolution of it, as the nearest-
// vertex rule it replaced did (0.42mm off, where the mesh straddled x = 0 with
// points 10.7mm apart). The budget is the weld quantum, nothing chosen.
const centreOff = ['CENTRE_FRONT', 'CENTRE_BACK'].flatMap((id) => byId[id].points.map((p) => Math.abs(p[0])));
const worstCentre = Math.max(...centreOff);
gate.record('centre front and centre back sit on the symmetry plane',
  worstCentre <= DEFAULT_WELD_QUANTUM,
  `worst |x| ${mm(worstCentre)}mm — the crossing is interpolated along the section's own segment, so the mesh's resolution does not enter`);
gate.record('centre front is in front of centre back at every height',
  byId.CENTRE_FRONT.points.every((p, i) => {
    const back = byId.CENTRE_BACK.points[i];
    return back && Math.abs(back[1] - p[1]) < 1e-9 && p[2] > back[2];
  }),
  `${byId.CENTRE_FRONT.points.length} heights, front z > back z at each`);

// Side: the outermost point at the section's own mid-depth. Two claims — that
// it is the side, and that the rule it replaced could not say where in depth
// the side is. The superseded answer is computed here, so the reason for the
// change stays visible in the evidence rather than living in a comment.
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
gate.record('a side curve is the outermost point of its section',
  wider.length === 0, wider.length ? wider.slice(0, 3).join('; ') : 'no other curve reaches further out at any shared height');

// The superseded rule, run on the same sections: the widest vertex, height by
// height. Its depth jump is the ambiguity the mid-depth rule removes.
const widestAt = (y, sign) => {
  const points = segmentPoints(sectionSegments(ctx.tri, y)).filter((p) => p[0] * sign > 0);
  return points.reduce((best, p) => (best === null || p[0] * sign > best[0] * sign ? p : best), null);
};
const superseded = { jump: 0, inboard: 0, gapX: 0 };
for (const id of ['SIDE_L', 'SIDE_R']) {
  const sign = byId[id].curve.sign;
  const widest = byId[id].points.map((p) => widestAt(p[1], sign));
  for (let i = 1; i < widest.length; i++) {
    if (widest[i] && widest[i - 1]) superseded.jump = Math.max(superseded.jump, Math.abs(widest[i][1] - widest[i - 1][1]));
  }
  byId[id].points.forEach((p, i) => {
    if (widest[i]) superseded.gapX = Math.max(superseded.gapX, Math.abs(widest[i][0]) - Math.abs(p[0]));
  });
}
let curveStep = 0;
for (const id of ['SIDE_L', 'SIDE_R']) {
  const points = byId[id].points;
  for (let i = 1; i < points.length; i++) curveStep = Math.max(curveStep, Math.abs(points[i][2] - points[i - 1][2]));
}
gate.record('the widest point of a section names no depth, and the mid-depth rule does',
  curveStep < superseded.jump,
  `the widest point jumps ${mm(superseded.jump)}mm in depth between heights 5mm apart — the side of a body is a flat wall, so under a millimetre of mesh variation decides it; the mid-depth answer moves at most ${mm(curveStep)}mm`);

const foldY = evidence.landmarks?.UNDERBUST_FOLD?.y_m;
const sideCheck = [['SIDE_L', 'SIDE_UNDERBUST_L'], ['SIDE_R', 'SIDE_UNDERBUST_R']].map(([curveId, markId]) => {
  const mark = evidence.landmarks?.[markId]?.xyz_m;
  const at = byId[curveId].points.reduce((best, p) =>
    (best === null || Math.abs(p[1] - foldY) < Math.abs(best[1] - foldY) ? p : best), null);
  return { markId, dx: mark && at ? Math.abs(Math.abs(mark[0]) - Math.abs(at[0])) : Infinity };
});
// The curve is a point of the same wall: it gives up less in width than the
// depth it wins. Both sides of that comparison are measured on this mesh.
gate.record('the side curves sit on the same wall as the registry\'s own side points',
  sideCheck.every((c) => c.dx < superseded.jump),
  sideCheck.map((c) => `${c.markId} ${mm(c.dx)}mm inboard in x`).join(', ')
    + ` — against the ${mm(superseded.jump)}mm of depth the widest point cannot pin down. The registry keeps the widest point: a width needs no depth.`);

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
    `top sample y = ${top.toFixed(4)}m, ceiling ${ceiling}m — above it the section is open at the armhole, so its outermost point is the cut edge`);
}

// Every sampled point must lie on the section at its own height: the grid may
// not wander off the measurement surface. A crossing is a point of a segment,
// an extreme is one of its ends; both are on a segment.
const toSegment = ([x, z], [a, b]) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
};
let offSurface = 0, checked = 0, worstOff = 0;
for (const { points } of sampled) {
  for (let i = 0; i < points.length; i += 7) {          // every 7th, ~35mm apart
    const [x, y, z] = points[i];
    const segments = sectionSegments(ctx.tri, y);
    checked++;
    const off = Math.min(...segments.map((seg) => toSegment([x, z], seg)));
    worstOff = Math.max(worstOff, off);
    if (!(off < 1e-7)) offSurface++;
  }
}
gate.record('every sampled point lies on a segment of its own section',
  offSurface === 0, `${checked} points sampled across the curves, ${offSurface} off the surface, worst ${mm(worstOff)}mm`);

// The reason the crossing rule exists: a curve read from the nearest vertex
// stepped sideways at every height. In x a centre or apex curve now moves not
// at all between neighbouring heights; the check is that, not a smoothness
// number someone chose.
const sideways = sampled.filter((s) => !s.needs && s.curve.rule === 'section_crossing_x').map((s) => {
  let worst = 0;
  for (let i = 1; i < s.points.length; i++) worst = Math.max(worst, Math.abs(s.points[i][0] - s.points[i - 1][0]));
  return { id: s.curve.id, worst };
});
gate.record('a crossing curve does not step sideways between heights',
  sideways.every((s) => s.worst <= 1e-9),
  sideways.map((s) => `${s.id} ${mm(s.worst)}mm`).join(', ') + ' — x is the plane\'s, at every height');

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
      side_vs_registry_mm: sideCheck.map((c) => ({ landmark: c.markId, inboard_in_x_mm: mm(c.dx) })),
      superseded_widest_point: {
        rule: 'section_extreme_x',
        depth_jump_between_neighbouring_heights_mm: mm(superseded.jump),
        note: 'The widest point of a section is well determined in x and undetermined in depth: the side of a body is a flat wall. Kept here so the reason the rule was replaced stays checkable.',
      },
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
