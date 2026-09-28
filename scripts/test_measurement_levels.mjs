#!/usr/bin/env node
/**
 * Gate for contracts/measurement-levels.json and src/features/reference_geometry/ —
 * the house "how to measure" stack drawn on this avatar.
 *
 * Two separate claims are gated, because they can fail independently.
 *
 * 1. THE SHEETS SAY WHAT THE CONTRACT SAYS THEY SAY. The three source PNGs are
 *    pinned by sha256, and the trace evidence (scripts/trace_measurement_levels.py)
 *    must have been made from exactly those files. On every sheet the thirteen
 *    printed values must fit a linear inch scale within the contract's residual
 *    budget, and the fitted zero must land inside the sheets' one unlabelled gap —
 *    between the +1/2in and -1in leaders — which is where the black 0 ring is
 *    drawn. That does not prove the black line is the underbust line; nothing
 *    automatic can, and the contract's datum field says so. It proves the scale
 *    puts its origin there.
 *
 * 2. THE STACK RESOLVES HONESTLY ON THIS BODY. The contract validates against the
 *    registry; every level resolves to a height from the detected UNDERBUST_FOLD;
 *    each one either yields a closed ring whose girth equals what the shared
 *    engine measures at that height (the levels must not be a second way to
 *    measure a section) or says why it does not; and without the datum landmark
 *    the whole stack reads `needs …` and produces no geometry at all.
 *
 * The girths recorded here are of THIS body, at heights borrowed from a sheet
 * drawn on a DIFFERENT one. They are reference readings, not POMs: no tolerance
 * is applied to any of them and none reaches the POM sheet.
 *
 * Exit codes: 0 pass, 1 a check failed, 2 an input is missing or stale.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGate, sha256File } from './gate_report.mjs';
import { loadAvatarContext } from './flatten_fixtures.mjs';
import { measureSection, sectionPointNearX } from '../src/core/measure_core.mjs';
import {
  loadLevels, resolveLevels, measureLevels, measureShapes, measureReferenceTapes, measureLines, measureTicks, measureStraps, measureCurves, measureWires, bendCurve, handleFromPoint, dragHandle, measurePoint, measurePoints, pointOffsets, measureLinePoint, linePointOffsets, measureCurvePoint, measureCurvePoints, levelsRecord, outOfRange, sectionChains,
  METRES_PER_INCH, LEVELS_LIMIT,
} from '../src/features/reference_geometry/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = join(ROOT, 'contracts', 'measurement-levels.json');
const TRACE = join(ROOT, 'qa', 'avatar_master', 'measurement-levels-trace.json');
const REPORT = join(ROOT, 'qa', 'avatar_master', 'measurement-levels.json');
const gate = createGate();

const ctx = loadAvatarContext(ROOT);
if (ctx.error) gate.blocked(ctx.error);
if (!existsSync(CONTRACT)) gate.blocked(`missing ${relative(ROOT, CONTRACT)}`);
const contract = JSON.parse(readFileSync(CONTRACT, 'utf8'));

// ---- 1. the sheets ---------------------------------------------------------
for (const sheet of contract.source_sheets) {
  const path = join(ROOT, sheet.path);
  if (!existsSync(path)) gate.blocked(`missing source sheet ${sheet.path}`);
  const sha = sha256File(path);
  if (sha !== sheet.sha256) {
    gate.blocked(`${sheet.path} is ${sha.slice(0, 12)}…, the contract pins ${sheet.sha256.slice(0, 12)}… — a different sheet is a different protocol`);
  }
}
gate.record('every source sheet is the one the contract pins', true,
  `${contract.source_sheets.length} sheets, sha256 matched`);

if (!existsSync(TRACE)) gate.blocked(`missing ${relative(ROOT, TRACE)} — run \`npm run trace:measurement-levels\``);
const trace = JSON.parse(readFileSync(TRACE, 'utf8'));
if (trace.contract_sha256 !== sha256File(CONTRACT)) {
  gate.blocked(`the trace was made against contract ${trace.contract_sha256?.slice(0, 12)}…, on disk is ${sha256File(CONTRACT).slice(0, 12)}… — run \`npm run trace:measurement-levels\``);
}
for (const sheet of trace.sheets) {
  const pinned = contract.source_sheets.find((s) => s.path === sheet.path);
  if (!pinned || pinned.sha256 !== sheet.sha256) {
    gate.blocked(`the trace of ${sheet.path} was made from a different file — run \`npm run trace:measurement-levels\``);
  }
}
gate.record('the trace evidence is of these sheets and this contract', true,
  `${trace.sheets.length} sheets traced by ${trace.tool}`);

const labelled = contract.levels.filter((l) => l.label_in !== null);
const budget = contract.trace.worst_residual_in;
const worst = Math.max(...trace.sheets.map((s) => s.fit?.worst_residual_in ?? Infinity));
gate.record('every sheet traced one leader per printed value',
  trace.sheets.every((s) => s.leaders_y_px.length === labelled.length),
  trace.sheets.map((s) => `${s.view} ${s.leaders_y_px.length}`).join(', ') + ` of ${labelled.length}`);
gate.record(`the printed values hold a linear inch scale within ${budget}in`,
  Number.isFinite(worst) && worst <= budget,
  `worst ${worst.toFixed(4)}in (${trace.sheets.map((s) => `${s.view} ${s.fit?.px_per_inch}px/in`).join(', ')})`);
gate.record('on every sheet the fitted zero lands in the one unlabelled gap',
  trace.sheets.every((s) => s.fit?.zero_falls_between?.inside),
  trace.sheets.map((s) => {
    const z = s.fit?.zero_falls_between;
    return `${s.view}: ${z?.clear_of_above_in}in below ${z?.above}, ${z?.clear_of_below_in}in above ${z?.below}`;
  }).join('; '));
gate.record('the contract does not claim the black line was detected',
  /INTERPRETATION/.test(contract.datum.comment) && /does not pretend to have detected it/.test(contract.datum.comment),
  'the datum reading is declared as a person\'s, in one correctable field');

// ---- 2. the contract against the registry ----------------------------------
const loaded = loadLevels(contract, ctx.registry);
gate.record('the contract validates against the registry',
  loaded.errors.length === 0 && loaded.levels.length === contract.levels.length,
  loaded.errors.join('; ') || `${loaded.levels.length} levels, datum ${loaded.datum} is a registry landmark, offsets on the quarter inch and ordered`);
gate.record('the contract states the levels limit', loaded.declared_limit === LEVELS_LIMIT, loaded.declared_limit);
gate.record('levels are declared as reference heights, not POMs',
  contract.declared_limits.some((l) => /not POMs|no house code/i.test(l))
  && !JSON.stringify(contract).includes('house_code')
  && !contract.levels.some((l) => 'tolerance' in l || 'status' in l),
  'no tolerance, no house code, no status ladder — a level is a place to look');

const broken = loadLevels({
  ...contract,
  levels: [{ id: 'X', offset_in: 0.3, label_in: '+0.3"', group: 'nope' }, { id: 'X', offset_in: 0, label_in: null, group: 'datum' }],
}, ctx.registry);
gate.record('a duplicate id, an off-grid offset or an unknown group is refused',
  broken.levels.length === 0 && broken.errors.length >= 2,
  broken.errors.join('; ').slice(0, 160));

// ---- 3. the stack on this body ---------------------------------------------
// Some registry landmarks are a height rather than a point (UNDERBUST_FOLD is
// one), and the shared fixture only carries the points. The authority pass has
// both, and loadAvatarContext has already refused it if it was measured on a
// different asset, so reading the heights back out of it is safe here.
const evidence = JSON.parse(readFileSync(join(ROOT, 'qa', 'avatar_master', 'measurements.json'), 'utf8'));
const landmarks = { ...ctx.landmarks };
for (const [id, mark] of Object.entries(evidence.landmarks || {})) {
  if (!landmarks[id] && Number.isFinite(mark?.y_m)) landmarks[id] = mark.y_m;
}
const resolved = resolveLevels(loaded, landmarks);
if (resolved.needs) gate.blocked(`the datum landmark ${resolved.needs.join(', ')} is not in qa/avatar_master/measurements.json`);
gate.record('every level resolves from the detected datum',
  resolved.levels.length === loaded.levels.length,
  `${loaded.datum} at y = ${resolved.datum_y_m.toFixed(4)}m, ${resolved.levels.length} heights`);
gate.record('a level height is the datum plus its offset in inches, exactly',
  resolved.levels.every((l) => Math.abs(l.y_m - (resolved.datum_y_m + l.offset_in * METRES_PER_INCH)) < 1e-12),
  `${METRES_PER_INCH}m per inch, no rounding on the way in`);

const scan = ctx.registry.scan;
const maxY = loaded.max_y_m;
const measured = measureLevels(resolved, ctx.tri, { scan, maxY, inchDenominator: ctx.registry.reporting.inch_denominator });

// The levels must not become a second way to measure a section: the girth at a
// level has to be exactly what the shared engine says at that height.
let worstDelta = 0;
for (const level of measured.levels) {
  if (level.girth_m === null) continue;
  const direct = measureSection(ctx.tri, level.y_m);
  worstDelta = Math.max(worstDelta, Math.abs(direct.girth - level.girth_m));
}
gate.record('a level girth is the shared engine\'s section girth, not a second model',
  worstDelta === 0, `identical for every measured level (worst difference ${worstDelta})`);

const reported = measured.levels.filter((l) => l.girth_m !== null);
const withheld = measured.levels.filter((l) => l.girth_m === null);
gate.record('a level reports a girth exactly when it is not blocked',
  measured.levels.every((l) => (l.girth_m === null) === Boolean(l.blocked)),
  `${reported.length} measured, ${withheld.length} withheld${withheld.length ? ` (${withheld.map((l) => `${l.id}: ${l.blocked}`).join('; ')})` : ''}`);
gate.record('a measured level always has the section its girth came from',
  measured.levels.every((l) => l.girth_m === null || l.section !== null),
  'no girth without the ring it was computed from');
gate.record('no level reports a girth where a section is not trustworthy',
  measured.levels.every((l) => (outOfRange(l.y_m, { scan, maxY }) === null) || l.girth_m === null),
  `nothing above y = ${maxY}m or outside the scan yields a number`);

// A level blocked only because it is out of the trustworthy range usually
// still has real mesh geometry there — the ring should stay drawable even
// though the number is withheld. On this asset every level currently falls
// inside range, so this is checked on a synthetic level pushed past the
// armhole ceiling, on the real mesh.
const pushedHigh = { ...resolved, levels: [{ ...resolved.levels[0], y_m: maxY + 0.03 }] };
const [highLevel] = measureLevels(pushedHigh, ctx.tri, { scan, maxY, inchDenominator: ctx.registry.reporting.inch_denominator }).levels;
gate.record('a level blocked by the range ceiling still carries its ring, only the girth withheld',
  highLevel.girth_m === null && Boolean(highLevel.blocked) && highLevel.section !== null,
  `y = ${highLevel.y_m.toFixed(4)}m, ${(maxY + 0.03 > maxY) ? 'above' : 'at'} the ${maxY}m ceiling — blocked: ${highLevel.blocked}, section: ${highLevel.section ? `${highLevel.section.ring.length} pts` : 'null'}`);

// The contract claims the stack fits between the waist and the armhole on this
// body. That is a property of THIS avatar, so it is measured, not asserted.
const taped = measured.levels.filter((l) => l.tape);
gate.record('a level drawn as a tape is one of the printed rings, and measurable here',
  taped.every((l) => l.label_in !== null && l.girth_m !== null),
  taped.map((l) => `${l.label_in} ${(l.girth_m * 1000).toFixed(1)}mm`).join(', ') || 'none drawn as tapes');
const top = measured.levels[0], bottom = measured.levels[measured.levels.length - 1];
gate.record('the whole stack lands on the reliable part of this torso',
  top.y_m <= maxY && bottom.y_m >= scan.from_m,
  `+${top.offset_in}in at y = ${top.y_m.toFixed(4)}m (${((maxY - top.y_m) * 1000).toFixed(0)}mm below the armhole ceiling), ${bottom.offset_in}in at y = ${bottom.y_m.toFixed(4)}m`);

// Honest failure: no datum, no geometry — not a fallback ring at some default height.
const noDatum = resolveLevels(loaded, {});
gate.record('without the datum landmark the stack reads needs …, never a number',
  Array.isArray(noDatum.needs) && noDatum.needs.length === 1 && !noDatum.levels,
  `needs ${noDatum.needs?.join(', ')}`);
const record = levelsRecord(measureLevels(noDatum, ctx.tri, { scan, maxY }), loaded);
gate.record('the record of a stack that cannot resolve carries the need and the limit',
  Array.isArray(record.needs) && record.limit === LEVELS_LIMIT,
  `needs ${record.needs?.join(', ')}`);

// ---- 4. reference shapes ------------------------------------------------------
// A shape is laid on the skin like a tape: the bottom edge along its level's
// ring, centred on centre back, the sides up the back for the height. Both are
// held to the declared inches; the top edge is measured, not forced.
gate.record('every declared shape validates on a valid level',
  loaded.shapes.length === (contract.shapes || []).length,
  `${loaded.shapes.length} shape(s): ${loaded.shapes.map((s) => `${s.id} on ${s.level}`).join(', ') || 'none'}`);
const brokenShape = loadLevels({ ...contract, shapes: [{ id: 'S', kind: 'rectangle', level: 'NOPE', anchor: 'centre_back', width_in: 0, height_in: 1 }] }, ctx.registry);
gate.record('a shape on an unknown level or with no width is refused',
  brokenShape.shapes.length === 0 && brokenShape.errors.some((e) => /level NOPE/.test(e) && /width_in/.test(e)),
  brokenShape.errors.join('; ').slice(0, 160));
const shapes = measureShapes(loaded, measured, ctx.tri);
const SHAPE_TOL_M = 1e-6;
for (const shape of shapes) {
  const level = measured.levels.find((l) => l.id === shape.level);
  const ok = !shape.blocked
    && Math.abs(shape.corners.bottom_l[1] - level.y_m) < 1e-12 && Math.abs(shape.corners.bottom_r[1] - level.y_m) < 1e-12
    && Math.abs(shape.bottom_width_m - shape.width_m) < SHAPE_TOL_M
    && Math.abs(shape.side_height_m.l - shape.height_m) < SHAPE_TOL_M && Math.abs(shape.side_height_m.r - shape.height_m) < SHAPE_TOL_M
    && shape.centre_back[0] === 0;
  gate.record(`${shape.id}: stands on ${level.label_in} at centre back, ${shape.width_in}in along the ring and ${shape.height_in}in up the skin`,
    ok,
    shape.blocked || `bottom ${(shape.bottom_width_m * 1000).toFixed(2)}mm, sides ${(shape.side_height_m.l * 1000).toFixed(2)}/${(shape.side_height_m.r * 1000).toFixed(2)}mm, top edge ${(shape.top_width_m * 1000).toFixed(2)}mm at y = ${shape.y_top_m.toFixed(4)}m`);
  // the bottom midpoint is centre back: the two bottom corners mirror through x = 0
  const [bl, br] = [shape.corners.bottom_l, shape.corners.bottom_r];
  gate.record(`${shape.id}: the bottom edge is centred on centre back`,
    !shape.blocked && Math.abs(bl[0] + br[0]) < 1e-5 && Math.abs(bl[2] - br[2]) < 1e-5,
    `corners at x = ${(bl[0] * 1000).toFixed(2)} / ${(br[0] * 1000).toFixed(2)}mm`);
}

// ---- 5. reference tapes from another height ------------------------------------
// Hung on a plane-section POM's own height, read back from the authority pass.
gate.record('every declared reference tape validates',
  loaded.tapes.length === (contract.reference_tapes || []).length,
  `${loaded.tapes.length} tape(s): ${loaded.tapes.map((t) => `${t.id} ${t.offset_in > 0 ? '+' : ''}${t.offset_in}in from ${t.from}`).join(', ') || 'none'}`);
const pomHeights = Object.fromEntries((evidence.poms || []).filter((p) => Number.isFinite(p.at_y_m)).map((p) => [p.id, p.at_y_m]));
const tapes = measureReferenceTapes(loaded, pomHeights, ctx.tri, { scan, maxY, inchDenominator: ctx.registry.reporting.inch_denominator });
for (const tape of tapes) {
  const exact = Number.isFinite(tape.y_m) && Math.abs(tape.y_m - (pomHeights[tape.from] + tape.offset_in * METRES_PER_INCH)) < 1e-12;
  // above the ceiling: no girth, the reason, and the pieces on the skin; below it: the engine's own girth
  const honest = tape.blocked
    ? tape.girth_m === null && tape.chains.length > 0 && tape.pieces_m.every((v) => v > 0.05)
    : Math.abs(tape.girth_m - measureSection(ctx.tri, tape.y_m).girth) === 0;
  gate.record(`${tape.id}: ${tape.offset_in}in from ${tape.from}, ${tape.blocked ? 'drawn in pieces with no girth' : 'girth from the shared engine'}`,
    exact && honest,
    `y = ${tape.y_m?.toFixed(4)}m; ${tape.blocked ? `${tape.blocked}; pieces ${tape.pieces_m.map((v) => (v * 1000).toFixed(1)).join(' + ')}mm` : `${(tape.girth_m * 1000).toFixed(1)}mm`}`);
}
const unhung = measureReferenceTapes(loaded, {}, ctx.tri, { scan, maxY });
gate.record('a reference tape without its height reads needs …, never a line',
  unhung.every((t) => t.blocked === `needs ${t.from}` && !t.chains.length), unhung.map((t) => t.blocked).join('; '));

// ---- 6. centre-back and centre-front lines -----------------------------------------
gate.record('every declared line validates',
  loaded.lines.length === (contract.lines || []).length,
  `${loaded.lines.length} line(s): ${loaded.lines.map((l) => `${l.id} ${l.kind} ${l.from} -> ${l.to}`).join(', ') || 'none'}`);
const brokenLine = loadLevels({ ...contract, lines: [{ id: 'L', kind: 'sideways', from: 'LVL_M1_3_4', to: 'NOPE', label: 'x' }] }, ctx.registry);
gate.record('a line of an unknown kind or to an unknown height is refused',
  brokenLine.lines.length === 0 && brokenLine.errors.some((e) => /unknown kind sideways/.test(e) && /to NOPE/.test(e)),
  brokenLine.errors.join('; ').slice(0, 160));
const lines = measureLines(loaded, measured, tapes, ctx.tri, pomHeights);
const heightOf = (id) => measured.levels.find((l) => l.id === id)?.y_m ?? tapes.find((t) => t.id === id)?.y_m ?? pomHeights[id];
// the torso's middle in z at a height: halfway between the section's front and back
const midZOf = (y) => { const sec = measureSection(ctx.tri, y) || null; const zs = sec ? sec.ring.map((p) => p[1]) : [0]; return (Math.max(...zs) + Math.min(...zs)) / 2; };
// where the section at `y` crosses x = 0 on the front (greatest z) or the back (least z)
const centreOf = (y, front) => {
  const zs = [];
  for (const chain of sectionChains(ctx.tri, y)) for (let i = 1; i < chain.length; i++) {
    const [a, b] = [chain[i - 1], chain[i]];
    if ((a[0] > 0) !== (b[0] > 0)) zs.push(a[2] + (b[2] - a[2]) * (a[0] / (a[0] - b[0])));
  }
  return zs.length ? (front ? Math.max(...zs) : Math.min(...zs)) : null;
};
// the tape's own centre front at `y`: where its hull crosses x = 0 on the front
const hullFrontOf = (y) => {
  const ring = measureSection(ctx.tri, y)?.ring || [];
  const zs = ring.flatMap((a, i) => { const b = ring[(i + 1) % ring.length]; return (a[0] > 0) !== (b[0] > 0) ? [a[1] + (b[1] - a[1]) * (a[0] / (a[0] - b[0]))] : []; });
  return zs.length ? Math.max(...zs) : null;
};
const lineGaps = {};
for (const line of lines) {
  const front = line.kind === 'centre_front';
  const ends = [heightOf(line.from), heightOf(line.to)].sort((a, b) => b - a);
  // the walked end is the section's own centre back (at the top) or centre front (at the bottom)
  const start = front ? line.bottom : line.top;
  const startZ = centreOf(start[1], front);
  const ok = !line.blocked
    && line.points.every((p) => p[0] === 0)
    && Math.abs(line.top[1] - ends[0]) < 1e-9 && Math.abs(line.bottom[1] - ends[1]) < 1e-9
    && line.points.every((p, i) => i === 0 || p[1] <= line.points[i - 1][1])
    && startZ !== null && Math.abs(start[2] - startZ) < 1e-6
    && line.points.every((p) => (front ? p[2] > midZOf(p[1]) : p[2] < midZOf(p[1])))
    && line.length_m >= line.chord_m;
  gate.record(`${line.id}: on the centre ${front ? 'front' : 'back'} ${front ? `up from ${line.from} to ${line.to}` : `from ${line.from} down to ${line.to}`}, along the skin`,
    ok,
    line.blocked || `y ${line.top[1].toFixed(4)} -> ${line.bottom[1].toFixed(4)}m, ${(line.length_m * 1000).toFixed(1)}mm on the skin, chord ${(line.chord_m * 1000).toFixed(1)}mm`);
  // at a POM's height the line stops on the skin; the POM's tape (a hull) may bridge in front of it
  const pomEnd = [line.from, line.to].find((id) => id in pomHeights && !measured.levels.some((l) => l.id === id) && !tapes.some((t) => t.id === id));
  if (!line.blocked && front && pomEnd) {
    const end = Math.abs(line.top[1] - pomHeights[pomEnd]) < 1e-9 ? line.top : line.bottom;
    const hullZ = hullFrontOf(end[1]);
    lineGaps[line.id] = hullZ === null ? null : hullZ - end[2];
    gate.record(`${line.id}: ends on the skin at ${pomEnd}'s height, behind (never in front of) that tape`,
      hullZ !== null && hullZ - end[2] >= -1e-6,
      hullZ === null ? 'no tape at that height' : `the ${pomEnd} tape crosses the centre front ${((hullZ - end[2]) * 1000).toFixed(1)}mm in front of the line's end`);
  }
}

// ---- 7. tick marks -------------------------------------------------------------------
gate.record('every declared tick validates',
  loaded.ticks.length === (contract.ticks || []).length,
  `${loaded.ticks.length} tick(s): ${loaded.ticks.map((t) => `${t.id} on ${t.on}`).join(', ') || 'none'}`);
const ticks = measureTicks(loaded, measured, tapes, ctx.tri);
for (const tick of ticks) {
  const midZ = midZOf(heightOf(tick.on));
  const ok = !tick.blocked && tick.marks.length === 2
    && tick.marks.every((m) => Math.abs(m.arc_m - tick.offset_in * METRES_PER_INCH) < 1e-9
      && Math.abs(m.length_m - tick.length_mm / 1000) < 1e-9
      && Math.abs(m.point[1] - heightOf(tick.on)) < 1e-12
      // centred on the tape: the point is on the mark, with half the length each side
      && m.points.some((p) => p.every((v, i) => Math.abs(v - m.point[i]) < 1e-12)))
    && Math.abs(tick.marks[0].point[0] + tick.marks[1].point[0]) < 1e-5
    // on the side of the body it was anchored to
    // on the half of the body it is anchored to: in front of the torso's middle, or behind it
    && tick.marks.every((m) => (tick.anchor === 'centre_front' ? m.point[2] > midZ : m.point[2] < midZ));
  // upright: the whole mark stays in the vertical plane through its point, square to the horizontal tape
  const worst = Math.max(...tick.marks.map((m) => Math.max(...m.points.map((p) => Math.abs(p[0] - m.point[0])))));
  gate.record(`${tick.id}: ${tick.length_mm}mm marks across ${tick.on}, ${tick.offset_in}in from ${tick.anchor.replace('_', ' ')} each way along it`,
    ok && worst === 0,
    tick.blocked || tick.marks.map((m) => `${m.side} at x = ${(m.point[0] * 1000).toFixed(1)}mm, arc ${(m.arc_m * 1000).toFixed(2)}mm, ${(m.length_m * 1000).toFixed(2)}mm long on the skin, upright`).join('; '));
}

// ---- 8. straps over the shoulder -------------------------------------------------------
gate.record('every declared strap validates',
  loaded.straps.length === (contract.straps || []).length,
  `${loaded.straps.length} strap(s): ${loaded.straps.map((s) => `${s.id} ${s.from} -> ${s.to}`).join(', ') || 'none'}`);
const brokenStrap = loadLevels({ ...contract, straps: [{ id: 'X', kind: 'over_shoulder', from: 'TICK_MAXP2_CB_4IN', to: 'TICK_MAXP2_CB_4IN', width_mm: 20, colour: '#000000', label: 'x' }] }, ctx.registry);
gate.record('a strap that does not run from a centre-front tick to a centre-back tick is refused',
  brokenStrap.straps.length === 0 && brokenStrap.errors.some((e) => /not a valid centre-front tick/.test(e)),
  brokenStrap.errors.join('; ').slice(0, 160));
const straps = measureStraps(loaded, measured, tapes, ticks, ctx.tri);
for (const strap of straps) {
  const [from, to] = [strap.from, strap.to].map((id) => ticks.find((t) => t.id === id));
  const width = strap.width_mm / 1000;
  const y = heightOf(from.on);
  // with front_on the front end is moved up to that tape, the edges unchanged
  const yFront = strap.front_on ? heightOf(strap.front_on) : y;
  const same = (p, q) => p.every((v, i) => Math.abs(v - q[i]) < 1e-6);
  const ok = !strap.blocked && strap.bands.length === 2
    && strap.bands.every((b) => Math.abs(b.front_width_m - width) < 1e-6 && Math.abs(b.back_width_m - width) < 1e-6
      // the corners are on their tapes; the outline is closed and goes over the shoulder
      && [b.corners.back_inner, b.corners.back_outer].every((c) => c[1] === y)
      && [b.corners.front_inner, b.corners.front_outer, b.centre[0]].every((c) => Math.abs(c[1] - yFront) < 1e-12)
      && same(b.outline[0], b.outline[b.outline.length - 1])
      && b.top_y_m > y + 0.05
      // the length runs tick to tick, between the two edges' lengths
      && [...(strap.front_on ? [] : [[b.centre[0], from]]), [b.centre[b.centre.length - 1], to]].every(([p, t]) => same(p, t.marks.find((m) => m.side === b.side).point))
      && b.length_m > Math.min(b.inner_length_m, b.outer_length_m) && b.length_m < Math.max(b.inner_length_m, b.outer_length_m)
      // each end is centred on its tick: the tick's point lies on the end, between the two corners
      && [...(strap.front_on ? [] : [[from, 'front']]), [to, 'back']].every(([t, end]) => {
        const p = t.marks.find((m) => m.side === b.side).point;
        const [i, o] = [b.corners[`${end}_inner`], b.corners[`${end}_outer`]];
        return (p[0] - i[0]) * (p[0] - o[0]) < 0;
      }))
    // L and R mirror
    && same(strap.bands[0].corners.front_inner.map((v, i) => (i ? v : -v)), strap.bands[1].corners.front_inner);
  gate.record(`${strap.id}: ${strap.width_mm}mm band from ${strap.from}${strap.front_on ? ` (front end moved up to ${strap.front_on})` : ''} over the shoulder to ${strap.to} on each side`,
    ok,
    strap.blocked || strap.bands.map((b) => `${b.side} ${(b.length_m * 1000).toFixed(1)}mm long along the middle, ends ${(b.front_width_m * 1000).toFixed(2)}/${(b.back_width_m * 1000).toFixed(2)}mm, edges ${(b.inner_length_m * 1000).toFixed(1)}/${(b.outer_length_m * 1000).toFixed(1)}mm, ${(b.top_width_m * 1000).toFixed(2)}mm wide at the shoulder top y = ${b.top_y_m.toFixed(4)}m`).join('; '));
}

// ---- 9. curves on the skin --------------------------------------------------------------
// an end as the contract names it, and where it is on one side (a point's: once the points are placed)
const endName = (e) => (e.strap ? `${e.strap}.${e.corner}` : e.line ? `${e.line}.${e.end}` : e.point ? e.point : `${e.landmark}_L/R`);
const pointAt = (p, side) => (p.kind === 'on_line' ? p.at : p.marks.find((m) => m.side === side).point);
const endAt = (e, side) => (e.strap ? straps.find((s) => s.id === e.strap).bands.find((b) => b.side === side).corners[e.corner]
  : e.line ? lines.find((l) => l.id === e.line)[e.end] : e.point ? pointAt(points.find((p) => p.id === e.point), side) : ctx.landmarks[`${e.landmark}_${side}`]);
gate.record('every declared curve validates',
  loaded.curves.length === (contract.curves || []).length,
  `${loaded.curves.length} curve(s): ${loaded.curves.map((c) => `${c.id} ${c.kind} ${endName(c.from)} -> ${endName(c.to)}`).join(', ') || 'none'}`);
const brokenCurve = loadLevels({ ...contract, curves: [{ id: 'C', kind: 'shortest_surface_path', from: { strap: 'NOPE', corner: 'middle' }, to: { landmark: 'NOPE' }, colour: '#000000', label: 'c' }] }, ctx.registry);
gate.record('a curve from an unknown strap, corner or landmark is refused',
  brokenCurve.curves.length === 0 && brokenCurve.errors.some((e) => /strap NOPE/.test(e) && /corner middle/.test(e) && /NOPE_L/.test(e)),
  brokenCurve.errors.join('; ').slice(0, 160));
const strapId = (contract.straps || [])[0]?.id;
const brokenEnds = loadLevels({ ...contract, curves: [
  { id: 'C', kind: 'joined_curve', from: { line: 'NOPE', end: 'middle' }, to: { strap: strapId, corner: 'front_inner' }, handles: { cf: { angle_deg: 90 } }, colour: '#000000', label: 'c' },
  { id: 'D', kind: 'joined_curve', from: { landmark: 'SIDE_WING_HIGH' }, to: { strap: strapId, corner: 'front_inner' }, handles: { cf: { angle_deg: 0 }, depth: { fullness: 0.5 } }, colour: '#000000', label: 'd' },
] }, ctx.registry);
gate.record('a curve from an unknown line or line end, a joined curve with unsound handles, or one not from the centre to a strap, is refused',
  brokenEnds.curves.length === 0 && brokenEnds.errors.some((e) => /line NOPE/.test(e) && /end middle/.test(e) && /handles\.cf\.angle_deg/.test(e) && /handles\.depth\.fullness/.test(e))
    && brokenEnds.errors.some((e) => /^D: .*a joined curve runs from a line's end on the centre plane to a strap corner/.test(e)),
  brokenEnds.errors.join('; ').slice(0, 220));
// ROOT_BOTTOM_L / _R, where cup depth starts, are derived (rule fold_section_below_apex: the
// fold section's point directly below the apex), so the evidence does not carry them; found
// here the way the viewer finds them
const onBody = { ...ctx.landmarks };
for (const side of ['L', 'R']) {
  const b = sectionPointNearX(ctx.tri, landmarks.UNDERBUST_FOLD, ctx.landmarks[`BUST_APEX_${side}`][0]);
  if (b) onBody[`ROOT_BOTTOM_${side}`] = [b.x, b.y, b.z];
}
const unplaced = measurePoints(loaded, onBody, ctx.tri, {}, lines);
const curves = measureCurves(loaded, straps, onBody, ctx.grid, {}, unplaced, lines);
// a dot on a curve is placed once the curves are measured
const points = measureCurvePoints(unplaced, curves);
const onSkin = (pts) => pts.every((p) => { const c = ctx.closest(p); return c && Math.hypot(...p.map((v, i) => v - c.point[i])) < 5e-4; });
const mirrored = (a, b) => a.points.length === b.points.length && a.points.every((p, i) => Math.hypot(p[0] + b.points[i][0], p[1] - b.points[i][1], p[2] - b.points[i][2]) < 1e-4);
// how kinked a run is: the most any sample strays from the middle of its neighbours, and the
// sharpest turn from one sample to the next
const kinks = (r) => {
  let off = 0, turn = 0;
  for (let i = 1; i < r.points.length - 1; i++) {
    const [a, p, b] = [r.points[i - 1], r.points[i], r.points[i + 1]];
    off = Math.max(off, Math.hypot(...p.map((v, k) => v - (a[k] + b[k]) / 2)));
    const u = p.map((v, k) => v - a[k]), w = b.map((v, k) => v - p[k]);
    const c = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w));
    turn = Math.max(turn, (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI);
  }
  return { off, turn };
};
const smooth = (c) => !c.blocked && c.runs.every((r) => { const k = kinks(r); return k.off < 2.5e-4 && k.turn < 6; });
const kinked = (c) => c.runs.map((r) => { const k = kinks(r); return `${r.side} ${(k.off * 1000).toFixed(2)}mm, ${k.turn.toFixed(1)}deg`; }).join(', ');
for (const curve of curves) {
  const ok = !curve.blocked && curve.runs.length === 2
    && curve.runs.every((r) => {
      const [a, z] = [r.points[0], r.points[r.points.length - 1]];
      const [start, end] = [endAt(curve.from, r.side), endAt(curve.to, r.side)];
      const chord = Math.hypot(...a.map((v, i) => v - z[i]));
      // from one declared end to the other, on the skin, no shorter than the chord
      return a.every((v, i) => v === start[i]) && z.every((v, i) => v === end[i])
        && r.points.every((p) => { const c = ctx.closest(p); return c && Math.hypot(...p.map((v, i) => v - c.point[i])) < 5e-4; })
        && r.length_m >= chord;
    })
    && Math.abs(curve.runs[0].length_m - curve.runs[1].length_m) < 1e-4;
  gate.record(`${curve.id}: from ${endName(curve.from)} to ${endName(curve.to)} on each side, over the skin`,
    ok,
    curve.blocked || curve.runs.map((r) => `${r.side} ${(r.length_m * 1000).toFixed(1)}mm`).join('; '));
  if (curve.kind === 'joined_curve' && !curve.blocked) {
    const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const unit3 = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
    const deg = (u, v) => (Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) * 180) / Math.PI;
    // seen from the front, how steeply it leaves the centre front (over its first few mm)
    const rise = (r) => (Math.atan2(r.points[4][1] - r.points[0][1], Math.abs(r.points[4][0] - r.points[0][0])) * 180) / Math.PI;
    // the strap's inner edge as it leaves the corner, over its first 15mm
    const edgeLeaving = (r) => {
      const edge = straps.find((st) => st.id === curve.to.strap).bands.find((b) => b.side === r.side).edges[curve.to.corner];
      let walked = 0, i = 1;
      for (; i < edge.length - 1 && walked < 0.015; i++) walked += Math.hypot(...sub3(edge[i], edge[i - 1]));
      return unit3(sub3(edge[i], edge[0]));
    };
    const arrival = (r) => unit3(sub3(r.points[r.points.length - 1], r.points[r.points.length - 3]));
    const shape = (run) => `${run.side} rises ${rise(run).toFixed(1)}deg out of CF, meets the strap edge at ${deg(arrival(run), edgeLeaving(run)).toFixed(1)}deg`;
    gate.record(`${curve.id}: leaves the centre front level (a U) and runs on into the strap along its inner edge, mirrored`,
      curve.handles.cf.angle_deg === 0 && curve.runs.every((r) => Math.abs(rise(r)) < 2 && deg(arrival(r), edgeLeaving(r)) < 3) && mirrored(curve.runs[0], curve.runs[1]),
      curve.runs.map(shape).join('; '));
    // a V: each side rises at about its angle; U or V, fuller is deeper and longer
    const v30 = bendCurve(curve, { cf: { angle_deg: 30 }, depth: curve.handles.depth }, ctx.grid);
    const byFullness = [0.3, 0.667, 1.0].map((k) => bendCurve(curve, { cf: curve.handles.cf, depth: { fullness: k } }, ctx.grid));
    const deeper = byFullness.every((c, i) => !c.blocked && (i === 0 || (c.runs[0].depth_m > byFullness[i - 1].runs[0].depth_m && c.runs[0].length_m > byFullness[i - 1].runs[0].length_m)));
    gate.record(`${curve.id}: as a V it rises at its angle out of the centre front; fuller is deeper; on the skin and mirrored throughout`,
      !v30.blocked && v30.runs.every((r) => rise(r) > 25 && rise(r) < 40 && deg(arrival(r), edgeLeaving(r)) < 3 && onSkin(r.points)) && mirrored(v30.runs[0], v30.runs[1])
        && deeper && byFullness.every((c) => mirrored(c.runs[0], c.runs[1]) && c.runs.every((r) => onSkin(r.points))),
      `V 30deg: ${v30.blocked || v30.runs.map(shape).join('; ')}; fullness 0.3/0.667/1: depth ${byFullness.map((c) => (c.runs[0].depth_m * 1000).toFixed(1)).join(' / ')}mm, length ${byFullness.map((c) => (c.runs[0].length_m * 1000).toFixed(1)).join(' / ')}mm`);
    // its two dots read back: the middle as the fullness, the centre-front tip as the angle (near level snaps to U)
    const R = curve.runs.find((r) => r.side === 'R');
    const middleOf = (c) => c.runs.find((r) => r.side === 'R').tangents.find((t) => t.end === 'depth').tip;
    const cfTipOf = (c) => c.runs.find((r) => r.side === 'R').tangents.find((t) => t.end === 'cf').tip;
    const backDepth = dragHandle(curve, R, 'depth', middleOf(byFullness[2]), ctx.grid);
    const backCf = dragHandle(curve, R, 'cf', cfTipOf(bendCurve(curve, { cf: { angle_deg: 40 }, depth: curve.handles.depth }, ctx.grid)), ctx.grid);
    const backLevel = dragHandle(curve, R, 'cf', cfTipOf(bendCurve(curve, { cf: { angle_deg: 2 }, depth: curve.handles.depth }, ctx.grid)), ctx.grid);
    gate.record(`${curve.id}: dragging its middle reads back the fullness, dragging its centre-front dot the angle, and near level snaps to U`,
      Math.abs(backDepth?.fullness - 1.0) < 1e-3 && Math.abs(backCf?.angle_deg - 40) < 0.5 && backLevel?.angle_deg === 0,
      `fullness ${backDepth?.fullness?.toFixed(4)} (1), angle ${backCf?.angle_deg?.toFixed(2)} (40), 2deg -> ${backLevel?.angle_deg}`);
    // smooth as drawn, as a V and at every fullness (carried to the nearest skin alone it had 1.5mm and 34deg)
    gate.record(`${curve.id}: smooth on the skin, as declared, as a V and at every fullness: every sample within 0.25mm of the middle of its neighbours, no turn over 6deg`,
      [curve, v30, ...byFullness].every(smooth),
      `as declared ${kinked(curve)}; V 30deg ${kinked(v30)}; fullness 0.3/0.667/1 ${byFullness.map(kinked).join(' / ')}`);
    const restored = bendCurve(v30, curve.handles, ctx.grid);
    gate.record(`${curve.id}: putting the contract's shape back restores it exactly`,
      !restored.blocked && restored.runs.every((r, i) => Math.abs(r.length_m - curve.runs[i].length_m) < 1e-9),
      `${curve.runs.map((r) => (r.length_m * 1000).toFixed(1)).join(', ')}mm, bowing ${(curve.runs[0].depth_m * 1000).toFixed(1)}mm below the shortest path (${(curve.runs[0].guide_length_m * 1000).toFixed(1)}mm)`);
  }
  if (curve.kind === 'wire_curve' && !curve.blocked) {
    // through its lowest point on each side: a sample there, none lower, level there (the chord
    // between the samples either side of it, its tangent there, within 1deg of level); mirrored,
    // both sides ending at the one CF point
    const low = (side) => onBody[`${curve.through.landmark}_${side}`];
    const slope = (q, m) => (Math.atan2(q[1] - m[1], Math.hypot(q[0] - m[0], q[2] - m[2])) * 180) / Math.PI;
    const lowest = curve.runs.every((r) => {
      const m = low(r.side), i = r.points.findIndex((q) => q.every((v, k) => v === m[k]));
      return i > 0 && i < r.points.length - 1 && r.points.every((q) => q[1] >= m[1] - 1e-12)
        && Math.abs(slope(r.points[i + 1], r.points[i - 1])) < 1
        && Math.abs(r.leg_lengths_m[0] + r.leg_lengths_m[1] - r.length_m) < 1e-9;
    });
    const meet = curve.runs[0].to.every((v, i) => v === curve.runs[1].to[i]) && curve.runs[0].to[0] === 0;
    gate.record(`${curve.id}: through ${curve.through.landmark}_L/R on each side, its lowest point and level there; mirrored, the two sides meeting on the centre plane`,
      lowest && meet && mirrored(curve.runs[0], curve.runs[1]),
      curve.runs.map((r) => {
        const m = r.through, i = r.points.findIndex((q) => q.every((v, k) => v === m[k]));
        return `${r.side} ${(r.leg_lengths_m[0] * 1000).toFixed(1)} + ${(r.leg_lengths_m[1] * 1000).toFixed(1)}mm, lowest at y = ${m[1].toFixed(4)}m (sample ${i}), its tangent there ${slope(r.points[i + 1], r.points[i - 1]).toFixed(2)}deg from level`;
      }).join('; '));
    // (carried to the nearest skin, the same three points gave 1.4mm and 28deg)
    gate.record(`${curve.id}: smooth on the skin: every sample within 0.25mm of the middle of its neighbours, no turn over 6deg from one to the next`,
      smooth(curve), kinked(curve));
    // it follows its points: the CF point slid up its line, the armhole's handles turned (the mark
    // rides on it), the armhole point moved; drawn again with nothing moved it is the same wire
    const cfEnd = points.find((p) => p.id === curve.to.point), markEnd = points.find((p) => p.id === curve.from.point);
    const cfLine = lines.find((l) => l.id === cfEnd.line);
    const slid = points.map((p) => (p.id === cfEnd.id ? measureLinePoint(cfEnd, cfLine, { up_in: 1.5 }) : p));
    const wireIn = (cs) => cs.find((c) => c.id === curve.id);
    const again = wireIn(measureWires(loaded, curves, onBody, ctx.grid, points));
    const afterSlide = wireIn(measureWires(loaded, curves, onBody, ctx.grid, slid));
    const armhole = curves.find((c) => c.id === markEnd.curve);
    const turnedArm = bendCurve(armhole, { from: { angle_deg: 30, length_mm: 50 }, to: { angle_deg: -20, length_mm: 45 } }, ctx.grid);
    const afterTurn = wireIn(measureWires(loaded, curves.map((c) => (c.id === armhole.id ? turnedArm : c)), onBody, ctx.grid, points));
    const armPoint = points.find((p) => p.id === armhole.through?.point);
    const movedArm = measureCurves(loaded, straps, onBody, ctx.grid, {}, unplaced.map((p) => (p.id === armPoint.id ? measurePoint(armPoint, ctx.landmarks, ctx.tri, { up_in: 0.6, forward_in: 0.8 }) : p)), lines);
    const same = (a, b) => a.every((v, i) => v === b[i]);
    const follows = (w, fromAt, toAt) => !w.blocked && w.runs.every((r) => same(r.points[0], fromAt(r.side)) && same(r.points[r.points.length - 1], toAt(r.side))
      && r.points.some((q) => same(q, low(r.side))) && onSkin(r.points)) && mirrored(w.runs[0], w.runs[1]);
    const newCf = slid.find((p) => p.id === cfEnd.id), newMark = measureCurvePoint(markEnd, turnedArm), movedMark = measureCurvePoint(markEnd, movedArm.find((c) => c.id === armhole.id));
    const mm = (w) => (w.blocked ? w.blocked : w.runs.map((r) => `${r.side} ${(r.length_m * 1000).toFixed(1)}mm`).join(', '));
    gate.record(`${curve.id}: follows its points: the CF point slid along its line, the armhole reshaped or its point moved (the mark rides on it); drawn again with nothing moved it is the same wire`,
      !again.blocked && again.runs.every((r, i) => r.length_m === curve.runs[i].length_m && r.points.every((q, k) => same(q, curve.runs[i].points[k])))
        && follows(afterSlide, (side) => pointAt(markEnd, side), () => newCf.at) && !same(newCf.at, cfEnd.at)
        && follows(afterTurn, (side) => pointAt(newMark, side), () => cfEnd.at) && !same(pointAt(newMark, 'R'), pointAt(markEnd, 'R'))
        && follows(wireIn(movedArm), (side) => pointAt(movedMark, side), () => cfEnd.at) && !same(pointAt(movedMark, 'R'), pointAt(markEnd, 'R')),
      `CF point 1.5in up its line: ${mm(afterSlide)}; armhole handles turned: ${mm(afterTurn)}; armhole point moved: ${mm(wireIn(movedArm))} (as declared ${mm(curve)})`);
    // what it waits on: its lowest point, either end
    const noLow = wireIn(measureCurves(loaded, straps, ctx.landmarks, ctx.grid, {}, unplaced, lines));
    const noCf = wireIn(measureWires(loaded, curves, onBody, ctx.grid, points.map((p) => (p.id === cfEnd.id ? measureLinePoint(cfEnd, cfLine, { up_in: 40 }) : p))));
    const noArm = wireIn(measureWires(loaded, curves.map((c) => (c.id === armhole.id ? { ...c, blocked: 'gone', runs: [] } : c)), onBody, ctx.grid, points));
    gate.record(`${curve.id}: without its lowest point, or with either end blocked, it reads needs …, never a curve`,
      noLow.blocked === `needs ${curve.through.landmark}_L, ${curve.through.landmark}_R` && noCf.blocked === `needs ${cfEnd.id}` && noArm.blocked === `needs ${markEnd.id}`
        && [noLow, noCf, noArm].every((w) => w.runs.length === 0),
      [noLow, noCf, noArm].map((w) => w.blocked).join('; '));
  }
  if (curve.kind !== 'tangent_curve' || curve.blocked) continue;
  // the handles as declared: along the shortest path, so the curve reads it (through
  // a point, it rounds the corner the two shortest paths make there, so a little longer)
  const via = curve.through ? points.find((p) => p.id === curve.through.point) : null;
  const declared = curve.runs.every((r) => r.length_m >= r.guide_length_m - 1e-3
    && r.length_m - r.guide_length_m < (via ? 0.02 * r.guide_length_m : 1e-3));
  gate.record(`${curve.id}: with the contract's handles its length is the shortest path's${via ? ' through the point, within 2%' : ' within 1mm'}`,
    declared,
    curve.runs.map((r) => `${r.side} ${(r.length_m * 1000).toFixed(1)}mm vs shortest ${(r.guide_length_m * 1000).toFixed(1)}mm`).join('; '));
  if (via) {
    const through = curve.runs.every((r) => {
      const m = via.marks.find((k) => k.side === r.side).point;
      return r.points.some((q) => q.every((v, i) => v === m[i])) && Math.abs(r.leg_lengths_m[0] + r.leg_lengths_m[1] - r.length_m) < 1e-9;
    });
    // moving the point moves the curve with it, still through it
    const moved = measurePoint(via, ctx.landmarks, ctx.tri, { up_in: 0.6, forward_in: 0.8 });
    const bentVia = measureCurves({ curves: [curve] }, straps, ctx.landmarks, ctx.grid, {}, [moved], lines)[0];
    const follows = !moved.blocked && !bentVia.blocked && bentVia.runs.every((r) => {
      const m = moved.marks.find((k) => k.side === r.side).point;
      return r.points.some((q) => q.every((v, i) => v === m[i])) && onSkin(r.points);
    }) && mirrored(bentVia.runs[0], bentVia.runs[1]);
    gate.record(`${curve.id}: passes through ${via.id} on each side, and follows it when it moves`,
      through && follows,
      `legs ${curve.runs[0].leg_lengths_m.map((v) => (v * 1000).toFixed(1)).join(' + ')}mm; moved 0.6in up, 0.8in forward: ${bentVia.blocked || bentVia.runs.map((r) => `${r.side} ${(r.length_m * 1000).toFixed(1)}mm`).join(', ')}`);
  }
  // each tangent runs on the skin from its end to its tip, and the tip reads back as its handle
  const tangents = curve.runs.every((r) => r.tangents.length === 2 && r.tangents.every((t) => {
    const back = handleFromPoint(r.frames[t.end], t.tip), want = curve.handles[t.end];
    const end = t.end === 'from' ? r.from : r.to;
    return t.points[0].every((v, i) => v === end[i]) && t.points[t.points.length - 1].every((v, i) => v === t.tip[i]) && onSkin(t.points)
      && Math.abs(back.length_mm - want.length_mm) < 0.5 && Math.abs(back.angle_deg - want.angle_deg) < 1;
  }));
  gate.record(`${curve.id}: each tangent lies on the skin and its tip reads back as its handle`,
    tangents,
    curve.runs[0].tangents.map((t) => { const b = handleFromPoint(curve.runs[0].frames[t.end], t.tip); return `${t.end} ${b.angle_deg.toFixed(2)}deg ${b.length_mm.toFixed(2)}mm`; }).join('; '));
  // dragged: both sides follow, mirrored, still on the skin, and the length follows the shape
  const turned = { from: { angle_deg: 30, length_mm: 50 }, to: { angle_deg: -20, length_mm: 45 } };
  const bent = bendCurve(curve, turned, ctx.grid);
  const bentOk = !bent.blocked && bent.runs.length === 2 && mirrored(bent.runs[0], bent.runs[1])
    && bent.runs.every((r) => onSkin(r.points) && r.points[0].every((v, i) => v === curve.runs.find((c) => c.side === r.side).from[i]))
    && Math.abs(bent.runs[0].length_m - curve.runs[0].length_m) > 1e-3;
  const back = bendCurve(bent, curve.handles, ctx.grid);
  const backOk = !back.blocked && back.runs.every((r, i) => Math.abs(r.length_m - curve.runs[i].length_m) < 1e-9);
  gate.record(`${curve.id}: turning the handles reshapes both sides, mirrored, on the skin, and putting them back restores it`,
    bentOk && backOk,
    bent.blocked || `turned ${bent.runs.map((r) => `${r.side} ${(r.length_m * 1000).toFixed(1)}mm`).join(', ')}; restored ${back.runs?.map((r) => (r.length_m * 1000).toFixed(1)).join(', ')}mm`);
}
const dots = (contract.points || []).filter((p) => p.kind !== 'offset_on_skin');
const throughDots = dots.map((dot) => loadLevels({ ...contract, curves: (contract.curves || []).filter((c) => c.kind === 'tangent_curve' && c.through).map((c) => ({ ...c, through: { point: dot.id } })) }, ctx.registry));
gate.record('a curve cannot pass through a dot on a line or on a curve, only a point offset on each side',
  throughDots.every((l, i) => l.curves.length === 0 && l.errors.some((e) => e.includes(`through ${dots[i].id} is not a valid point offset on the skin`))),
  throughDots.map((l) => l.errors.join('; ')).join(' | ').slice(0, 220));
const brokenHandles = loadLevels({ ...contract, curves: (contract.curves || []).map((c) => ({ ...c, kind: 'tangent_curve', handles: { from: { angle_deg: 'up', length_mm: 40 }, to: { angle_deg: 0, length_mm: -1 } } })) }, ctx.registry);
// a wire runs from a point, through a registry landmark (its lowest point), to a point, and a dot
// on a curve it starts from rides on a curve declared before it; nothing else runs to a point
const wireDef = (contract.curves || []).find((c) => c.kind === 'wire_curve');
if (wireDef) {
  const others = contract.curves.filter((c) => c.id !== wireDef.id);
  const rider = (contract.points || []).find((p) => p.id === wireDef.from.point && p.kind === 'on_curve');
  const withWire = (w) => loadLevels({ ...contract, curves: [...others, { ...wireDef, ...w }] }, ctx.registry);
  const cases = [
    [withWire({ from: { landmark: 'SIDE_WING_HIGH' } }), wireDef.id, /a wire runs from a point, through a registry landmark \(its lowest point\), to a point/],
    [withWire({ through: { point: wireDef.to.point } }), wireDef.id, /a wire runs from a point, through a registry landmark/],
    [withWire({ to: { point: 'NOPE' } }), wireDef.id, /to point NOPE is not a valid point/],
    [withWire({ through: { landmark: 'NOPE' } }), wireDef.id, /through NOPE_L is not a registry landmark/],
    ...(rider ? [[loadLevels({ ...contract, curves: [wireDef, ...others] }, ctx.registry), wireDef.id, new RegExp(`from point ${rider.id} rides on ${rider.curve}, which is not a valid curve declared before this one`)]] : []),
    [loadLevels({ ...contract, curves: [...contract.curves, { id: 'X', kind: 'shortest_surface_path', from: wireDef.from, to: { landmark: 'SIDE_WING_HIGH' }, colour: '#000000', label: 'x' }] }, ctx.registry), 'X', /only a wire runs from or to a point/],
  ];
  gate.record('a wire from or to anything but a point, through anything but a registry landmark, or from a dot on a curve declared after it, is refused; nothing but a wire runs to a point',
    cases.every(([l, id, want]) => !l.curves.some((c) => c.id === id) && l.errors.some((e) => e.startsWith(`${id}: `) && want.test(e))),
    cases.map(([l, id]) => l.errors.find((e) => e.startsWith(`${id}: `)) || `${id} not refused`).join(' | ').slice(0, 400));
}
gate.record('a tangent curve without a sound pair of handles is refused',
  (contract.curves || []).length === 0 || (brokenHandles.curves.length === 0 && brokenHandles.errors.some((e) => /handles\.from\.angle_deg/.test(e) && /handles\.to\.length_mm/.test(e))),
  brokenHandles.errors.join('; ').slice(0, 160));

// ---- 10. points offset from a landmark, and dots on a line -------------------------------
gate.record('every declared point validates',
  loaded.points.length === (contract.points || []).length,
  `${loaded.points.length} point(s): ${loaded.points.map((p) => (p.kind === 'on_line' ? `${p.id} ${p.up_in}in up ${p.line}` : p.kind === 'on_curve' ? `${p.id} ${p.along_in}in along ${p.curve} from its ${p.end} end`
    : `${p.id} ${p.up_in}in up, ${p.forward_in}in forward from ${p.from.landmark}_L/R`)).join(', ') || 'none'}`);
const brokenPoint = loadLevels({ ...contract, points: [
  { id: 'P', kind: 'offset_on_skin', from: { landmark: 'NOPE' }, up_in: null, forward_in: 'x', colour: '#000000', label: 'p' },
  { id: 'Q', kind: 'on_line', line: 'NOPE', up_in: -1, colour: '#000000', label: 'q' },
  { id: 'S', kind: 'on_curve', curve: 'NOPE', end: 'middle', along_in: -1, colour: '#000000', label: 's' },
] }, ctx.registry);
gate.record('a point from an unknown landmark or with bad offsets, or a dot on an unknown line or curve, from no end or before it, is refused',
  brokenPoint.points.length === 0 && brokenPoint.errors.some((e) => /^P: /.test(e) && /NOPE_L/.test(e) && /up_in/.test(e) && /forward_in/.test(e))
    && brokenPoint.errors.some((e) => /^Q: /.test(e) && /line NOPE/.test(e) && /up_in must be .* 0 or more/.test(e))
    && brokenPoint.errors.some((e) => /^S: /.test(e) && /curve NOPE/.test(e) && /end middle/.test(e) && /along_in must be .* 0 or more/.test(e)),
  brokenPoint.errors.join('; ').slice(0, 260));
for (const point of points.filter((p) => p.kind === 'offset_on_skin')) {
  const up = point.up_in * METRES_PER_INCH, forward = point.forward_in * METRES_PER_INCH;
  const skin = (p) => { const c = ctx.closest(p); return c && Math.hypot(...p.map((v, i) => v - c.point[i])) < 5e-4; };
  const ok = !point.blocked && point.marks.length === 2
    && point.marks.every((m) => {
      const base = ctx.landmarks[`${point.from.landmark}_${m.side}`];
      // up the side in the plane z = the landmark's, then level; both legs on the skin, at their lengths
      return Math.abs(m.up_m - up) < 1e-6 && Math.abs(m.forward_m - forward) < 1e-6
        && m.up_path.every((q) => q[2] === base[2]) && m.forward_path.every((q) => q[1] === m.top[1])
        && m.top[1] > base[1] && m.point[2] > m.top[2]
        && [...m.up_path, ...m.forward_path].every(skin);
    })
    && Math.hypot(point.marks[0].point[0] + point.marks[1].point[0], point.marks[0].point[1] - point.marks[1].point[1], point.marks[0].point[2] - point.marks[1].point[2]) < 1e-4;
  // a dragged place reads back as the offsets that reach it, on each side
  const inverse = !point.blocked && point.marks.every((m) => {
    const o = pointOffsets(point, m.side, m.point, ctx.landmarks, ctx.tri);
    return o && Math.abs(o.up_in - point.up_in) < 1e-6 && Math.abs(o.forward_in - point.forward_in) < 1e-6;
  });
  const elsewhere = { up_in: -0.2, forward_in: 2.1 };
  const there = measurePoint(point, ctx.landmarks, ctx.tri, elsewhere);
  const back = !there.blocked && there.marks.every((m) => {
    const o = pointOffsets(point, m.side, m.point, ctx.landmarks, ctx.tri);
    return o && Math.abs(o.up_in - elsewhere.up_in) < 1e-6 && Math.abs(o.forward_in - elsewhere.forward_in) < 1e-6;
  });
  gate.record(`${point.id}: a place on the skin reads back as the offsets that reach it (for dragging)`,
    inverse && back,
    there.blocked || `contract place and ${elsewhere.up_in}in up, ${elsewhere.forward_in}in forward both read back`);
  gate.record(`${point.id}: ${point.up_in}in up the skin from ${point.from.landmark}, then ${point.forward_in}in forward, on each side`,
    ok,
    point.blocked || point.marks.map((m) => `${m.side} at (${m.point.map((v) => (v * 1000).toFixed(1)).join(', ')})mm, up ${(m.up_m * 1000).toFixed(2)}mm, forward ${(m.forward_m * 1000).toFixed(2)}mm`).join('; '));
}

// a dot on a line: `up_in` up it from its lower end along the skin, on the line and the skin,
// read back from where it is (and from beside the line, or past an end), for dragging
const walkedTo = (pts) => pts.reduce((sum, p, i) => (i ? sum + Math.hypot(...p.map((v, k) => v - pts[i - 1][k])) : 0), 0);
for (const point of points.filter((p) => p.kind === 'on_line')) {
  const line = lines.find((l) => l.id === point.line);
  if (point.blocked || !line || line.blocked) { gate.record(`${point.id}: ${point.up_in}in up ${point.line}`, false, point.blocked || `${point.line} is blocked`); continue; }
  const up = point.up_in * METRES_PER_INCH;
  const skin = (p) => { const c = ctx.closest(p); return c && Math.hypot(...p.map((v, i) => v - c.point[i])) < 5e-4; };
  // the line rises from its lower end, so the piece up to the dot is the line's points below it, then the dot
  const upTo = (at) => walkedTo([...line.points.filter((p) => p[1] < at[1]).reverse(), at]);
  const ok = point.at[0] === 0 && skin(point.at)
    && Math.abs(upTo(point.at) - up) < 1e-6 && Math.abs(point.up_m - up) < 1e-12 && Math.abs(point.up_m + point.down_m - line.length_m) < 1e-12
    && point.at[1] > line.bottom[1] && point.at[1] < line.top[1];
  gate.record(`${point.id}: ${point.up_in}in up ${point.line} from its lower end, along the skin, on the line`,
    ok,
    `at (${point.at.map((v) => (v * 1000).toFixed(1)).join(', ')})mm, ${(upTo(point.at) * 1000).toFixed(2)}mm walked up the line, ${(point.down_m * 1000).toFixed(1)}mm below its top (line ${(line.length_m * 1000).toFixed(1)}mm)`);
  // moved: higher up the line is higher up the body; the ends are the line's ends; past them is refused
  const lengthIn = line.length_m / METRES_PER_INCH;
  const along = [0, 1, point.up_in, 4, lengthIn].map((u) => measureLinePoint(point, line, { up_in: u }));
  const rising = along.every((p, i) => !p.blocked && skin(p.at) && (i === 0 || p.at[1] > along[i - 1].at[1]) && Math.abs(upTo(p.at) - p.up_m) < 1e-6);
  const ends = along[0].at.every((v, i) => v === line.bottom[i]) && along[4].at.every((v, i) => Math.abs(v - line.top[i]) < 1e-9);
  const past = [lengthIn + 0.5, -0.5].map((u) => measureLinePoint(point, line, { up_in: u }));
  const unhungDot = measureLinePoint(point, null);
  gate.record(`${point.id}: moved up or down it stays on the line, from its lower end to its top, and past an end it is refused`,
    rising && ends && past.every((p) => p.blocked && p.at === null) && unhungDot.blocked === `needs ${point.line}`,
    `0 / 1 / ${point.up_in} / 4 / ${lengthIn.toFixed(3)}in up: y ${along.map((p) => p.at ? p.at[1].toFixed(4) : p.blocked).join(' < ')}m; ${past.map((p) => p.blocked).join('; ')}`);
  // dragged: a place reads back as how far up the line it is; beside the line it slides onto it, past an end it stops there
  const readBack = (q) => linePointOffsets(line, q)?.up_in;
  const beside = [0.03, point.at[1], point.at[2]];
  const aboveTop = [0, line.top[1] + 0.05, line.top[2]], belowBottom = [0, line.bottom[1] - 0.05, line.bottom[2]];
  gate.record(`${point.id}: a place on the line reads back as how far up it is; beside it, the same; past an end, that end (for dragging)`,
    along.every((p) => Math.abs(readBack(p.at) - p.up_in) < 1e-6) && Math.abs(readBack(beside) - point.up_in) < 1e-6
      && Math.abs(readBack(aboveTop) - lengthIn) < 1e-9 && readBack(belowBottom) === 0,
    `${point.up_in}in -> ${readBack(point.at)?.toFixed(6)}in; 30mm to the side -> ${readBack(beside)?.toFixed(6)}in; above the top -> ${readBack(aboveTop)?.toFixed(4)}in; below the bottom -> ${readBack(belowBottom)}in`);
}

// a dot on a curve: `along_in` along each side's run from the curve's `end`, on the run and the
// skin, mirrored; before the curves are measured it waits on its curve; it rides on the curve,
// the same distance along a reshaped one (handles turned, or the point it passes through moved)
for (const point of points.filter((p) => p.kind === 'on_curve')) {
  const curve = curves.find((c) => c.id === point.curve);
  if (point.blocked || !curve || curve.blocked) { gate.record(`${point.id}: ${point.along_in}in along ${point.curve}`, false, point.blocked || `${point.curve} is blocked`); continue; }
  const along = point.along_in * METRES_PER_INCH;
  const skin = (p) => { const c = ctx.closest(p); return c && Math.hypot(...p.map((v, i) => v - c.point[i])) < 5e-4; };
  // how far from the end a place on a run is, walked sample by sample to the segment it lies on (null if on none)
  const fromEnd = (run, at) => {
    const path = point.end === 'to' ? run.points.slice().reverse() : run.points;
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]], d = b.map((v, k) => v - a[k]), ll = d.reduce((sum, v) => sum + v * v, 0);
      const t = ll > 0 ? d.reduce((sum, v, k) => sum + (at[k] - a[k]) * v, 0) / ll : 0;
      if (t >= -1e-9 && t <= 1 + 1e-9 && Math.hypot(...a.map((v, k) => v + d[k] * t - at[k])) < 1e-9) return walkedTo([...path.slice(0, i), at]);
    }
    return null;
  };
  const placedOn = (c, dot) => !dot.blocked && dot.marks.length === 2 && dot.marks.every((m) => {
    const run = c.runs.find((r) => r.side === m.side), walked = fromEnd(run, m.point);
    return walked !== null && Math.abs(walked - along) < 1e-6 && Math.abs(m.along_m + m.rest_m - walkedTo(run.points)) < 1e-9 && skin(m.point);
  }) && Math.hypot(dot.marks[0].point[0] + dot.marks[1].point[0], dot.marks[0].point[1] - dot.marks[1].point[1], dot.marks[0].point[2] - dot.marks[1].point[2]) < 1e-4;
  const waits = unplaced.find((p) => p.id === point.id);
  gate.record(`${point.id}: ${point.along_in}in along ${point.curve} from its ${point.end} end, on each side, on the curve and the skin, mirrored`,
    placedOn(curve, point) && waits.blocked === `needs ${point.curve}`,
    point.marks.map((m) => `${m.side} at (${m.point.map((v) => (v * 1000).toFixed(1)).join(', ')})mm, ${(fromEnd(curve.runs.find((r) => r.side === m.side), m.point) * 1000).toFixed(2)}mm walked from the end, ${(m.rest_m * 1000).toFixed(1)}mm on to the other`
      + (Number.isFinite(m.to_through_m) ? `, the through point ${(m.to_through_m * 1000).toFixed(2)}mm further along` : '')).join('; '));
  // reshaped: handles turned, or the point it passes through moved; past the other end, or with no curve, it is blocked
  const turned = curve.kind === 'tangent_curve' ? bendCurve(curve, { from: { angle_deg: 30, length_mm: 50 }, to: { angle_deg: -20, length_mm: 45 } }, ctx.grid) : null;
  const via = curve.through ? points.find((p) => p.id === curve.through.point) : null;
  const viaMoved = via ? measureCurves({ curves: [curve] }, straps, ctx.landmarks, ctx.grid, {}, [measurePoint(via, ctx.landmarks, ctx.tri, { up_in: 0.6, forward_in: 0.8 })], lines)[0] : null;
  const rides = [turned, viaMoved].filter(Boolean).map((c) => ({ c, dot: measureCurvePoint(point, c) }));
  const shifted = (dot) => dot.marks.every((m, i) => Math.hypot(...m.point.map((v, k) => v - point.marks[i].point[k])) > 1e-4);
  const past = measureCurvePoint({ ...point, along_in: 40 }, curve), none = measureCurvePoint(point, null);
  gate.record(`${point.id}: it rides on ${point.curve}, the same distance along when the curve is reshaped; past the other end, or without the curve, it is blocked`,
    rides.length > 0 && rides.every(({ c, dot }) => !c.blocked && placedOn(c, dot) && shifted(dot)) && past.blocked && !past.marks.length && none.blocked === `needs ${point.curve}`,
    rides.map(({ c, dot }, i) => `${i ? 'point moved' : 'handles turned'}: ${c.blocked || dot.marks.map((m) => `${m.side} (${m.point.map((v) => (v * 1000).toFixed(1)).join(', ')})mm`).join(', ')}`).join('; ') + `; ${past.blocked}`);
}

// ---- evidence ---------------------------------------------------------------
const body = {
  purpose: 'The house "how to measure" level stack, read off the source sheets and resolved on this avatar.',
  asset: { path: ctx.registry.asset, sha256: ctx.assetSha },
  contract: { path: 'contracts/measurement-levels.json', sha256: sha256File(CONTRACT) },
  trace: { path: 'qa/avatar_master/measurement-levels-trace.json', generated_at: trace.generated_at },
  sheets: contract.source_sheets.map((s) => ({
    path: s.path, view: s.view, sha256: s.sha256,
    px_per_inch: trace.sheets.find((t) => t.path === s.path)?.fit?.px_per_inch ?? null,
    worst_residual_in: trace.sheets.find((t) => t.path === s.path)?.fit?.worst_residual_in ?? null,
  })),
  datum: { landmark: loaded.datum, y_m: Number(resolved.datum_y_m.toFixed(5)), source: 'auto' },
  levels: levelsRecord(measured, loaded).levels,
  shapes: shapes.map((s) => ({
    id: s.id, level: s.level, width_in: s.width_in, height_in: s.height_in, blocked: s.blocked,
    ...(s.blocked ? {} : {
      bottom_width_mm: Number((s.bottom_width_m * 1000).toFixed(2)),
      side_height_mm: Number((s.side_height_m.l * 1000).toFixed(2)),
      top_width_mm: Number((s.top_width_m * 1000).toFixed(2)),
      y_bottom_m: Number(s.y_bottom_m.toFixed(5)),
      y_top_m: Number(s.y_top_m.toFixed(5)),
      corners_m: Object.fromEntries(Object.entries(s.corners).map(([k, p]) => [k, p.map((v) => Number(v.toFixed(5)))])),
    }),
  })),
  reference_tapes: tapes.map((t) => ({
    id: t.id, from: t.from, offset_in: t.offset_in, y_m: Number(t.y_m.toFixed(5)),
    girth_mm: t.girth_m === null ? null : Number((t.girth_m * 1000).toFixed(1)),
    pieces_mm: t.pieces_m ? t.pieces_m.map((v) => Number((v * 1000).toFixed(1))) : null,
    blocked: t.blocked,
  })),
  lines: lines.map((l) => ({
    id: l.id, kind: l.kind, from: l.from, to: l.to, blocked: l.blocked,
    ...(l.blocked ? {} : {
      length_mm: Number((l.length_m * 1000).toFixed(1)),
      chord_mm: Number((l.chord_m * 1000).toFixed(1)),
      ...(l.id in lineGaps && lineGaps[l.id] !== null ? { tape_in_front_mm: Number((lineGaps[l.id] * 1000).toFixed(1)) } : {}),
      top_m: l.top.map((v) => Number(v.toFixed(5))),
      bottom_m: l.bottom.map((v) => Number(v.toFixed(5))),
    }),
  })),
  ticks: ticks.map((t) => ({
    id: t.id, on: t.on, offset_in: t.offset_in, length_mm: t.length_mm, colour: t.colour, blocked: t.blocked,
    marks: t.marks.map((m) => ({ side: m.side, point_m: m.point.map((v) => Number(v.toFixed(5))), arc_mm: Number((m.arc_m * 1000).toFixed(2)) })),
  })),
  straps: straps.map((s) => ({
    id: s.id, from: s.from, to: s.to, width_mm: s.width_mm, colour: s.colour, blocked: s.blocked,
    bands: s.bands.map((b) => ({
      side: b.side,
      front_width_mm: Number((b.front_width_m * 1000).toFixed(2)),
      back_width_mm: Number((b.back_width_m * 1000).toFixed(2)),
      length_mm: Number((b.length_m * 1000).toFixed(1)),
      inner_length_mm: Number((b.inner_length_m * 1000).toFixed(1)),
      outer_length_mm: Number((b.outer_length_m * 1000).toFixed(1)),
      top_width_mm: Number((b.top_width_m * 1000).toFixed(2)),
      top_y_m: Number(b.top_y_m.toFixed(5)),
      corners_m: Object.fromEntries(Object.entries(b.corners).map(([k, p]) => [k, p.map((v) => Number(v.toFixed(5)))])),
    })),
  })),
  curves: curves.map((c) => ({
    id: c.id, from: c.from, to: c.to, colour: c.colour, blocked: c.blocked,
    kind: c.kind, handles: c.handles || null, through: c.through || null,
    runs: c.runs.map((r) => ({
      side: r.side, length_mm: Number((r.length_m * 1000).toFixed(1)),
      ...(r.guide_length_m ? { shortest_path_mm: Number((r.guide_length_m * 1000).toFixed(1)) } : {}),
      ...(r.leg_lengths_m ? { legs_mm: r.leg_lengths_m.map((v) => Number((v * 1000).toFixed(1))), through_m: r.through.map((v) => Number(v.toFixed(5))) } : {}),
      from_m: r.from.map((v) => Number(v.toFixed(5))), to_m: r.to.map((v) => Number(v.toFixed(5))),
      ...(r.tangents ? { tips_m: Object.fromEntries(r.tangents.map((t) => [t.end, t.tip.map((v) => Number(v.toFixed(5)))])) } : {}),
      ...(Number.isFinite(r.depth_m) ? { depth_mm: Number((r.depth_m * 1000).toFixed(1)) } : {}),
    })),
  })),
  points: points.map((p) => (p.kind === 'on_line' ? {
    id: p.id, kind: p.kind, line: p.line, up_in: p.up_in, colour: p.colour, blocked: p.blocked,
    ...(p.blocked ? {} : { point_m: p.at.map((v) => Number(v.toFixed(5))), up_mm: Number((p.up_m * 1000).toFixed(2)), to_top_mm: Number((p.down_m * 1000).toFixed(2)) }),
  } : p.kind === 'on_curve' ? {
    id: p.id, kind: p.kind, curve: p.curve, end: p.end, along_in: p.along_in, colour: p.colour, blocked: p.blocked,
    marks: p.marks.map((m) => ({
      side: m.side, point_m: m.point.map((v) => Number(v.toFixed(5))), along_mm: Number((m.along_m * 1000).toFixed(2)), rest_mm: Number((m.rest_m * 1000).toFixed(2)),
      ...(Number.isFinite(m.to_through_m) ? { to_through_mm: Number((m.to_through_m * 1000).toFixed(2)) } : {}),
    })),
  } : {
    id: p.id, from: p.from, up_in: p.up_in, forward_in: p.forward_in, colour: p.colour, blocked: p.blocked,
    marks: p.marks.map((m) => ({ side: m.side, point_m: m.point.map((v) => Number(v.toFixed(5))), up_mm: Number((m.up_m * 1000).toFixed(2)), forward_mm: Number((m.forward_m * 1000).toFixed(2)) })),
  })),
  declared_limits: contract.declared_limits,
};

gate.finish({
  reportPath: REPORT,
  body,
  okDecision: 'LEVELS_RESOLVE_ON_THIS_BODY',
  relativeTo: ROOT,
  lines: [
    `SHEETS ${contract.source_sheets.length} pinned, worst inch-scale residual ${worst.toFixed(4)}in (budget ${budget}in)`,
    `DATUM  ${loaded.datum} at y = ${resolved.datum_y_m.toFixed(4)}m (auto)`,
    `LEVELS ${reported.length} measured, ${withheld.length} withheld — reference heights, not POMs`,
  ],
});
