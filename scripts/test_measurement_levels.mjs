#!/usr/bin/env node
/**
 * Gate for contracts/measurement-levels.json and scripts/measurement_levels.mjs —
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
import { measureSection } from './measure_core.mjs';
import {
  loadLevels, resolveLevels, measureLevels, measureShapes, measureReferenceTapes, measureLines, measureTicks, measureStraps, measureCurves, bendCurve, handleFromPoint, measurePoint, measurePoints, pointOffsets, levelsRecord, outOfRange,
  METRES_PER_INCH, LEVELS_LIMIT,
} from './measurement_levels.mjs';

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

// ---- 6. centre-back lines ---------------------------------------------------------
gate.record('every declared line validates',
  loaded.lines.length === (contract.lines || []).length,
  `${loaded.lines.length} line(s): ${loaded.lines.map((l) => `${l.id} ${l.from} -> ${l.to}`).join(', ') || 'none'}`);
const lines = measureLines(loaded, measured, tapes, ctx.tri);
const heightOf = (id) => measured.levels.find((l) => l.id === id)?.y_m ?? tapes.find((t) => t.id === id)?.y_m;
for (const line of lines) {
  const ends = [heightOf(line.from), heightOf(line.to)].sort((a, b) => b - a);
  const ok = !line.blocked
    && line.points.every((p) => p[0] === 0)
    && Math.abs(line.top[1] - ends[0]) < 1e-9 && Math.abs(line.bottom[1] - ends[1]) < 1e-9
    && line.points.every((p, i) => i === 0 || p[1] <= line.points[i - 1][1])
    && line.length_m >= line.chord_m;
  gate.record(`${line.id}: on the centre back from ${line.from} down to ${line.to}, along the skin`,
    ok,
    line.blocked || `y ${line.top[1].toFixed(4)} -> ${line.bottom[1].toFixed(4)}m, ${(line.length_m * 1000).toFixed(1)}mm on the skin, chord ${(line.chord_m * 1000).toFixed(1)}mm`);
}

// ---- 7. tick marks -------------------------------------------------------------------
gate.record('every declared tick validates',
  loaded.ticks.length === (contract.ticks || []).length,
  `${loaded.ticks.length} tick(s): ${loaded.ticks.map((t) => `${t.id} on ${t.on}`).join(', ') || 'none'}`);
const ticks = measureTicks(loaded, measured, tapes, ctx.tri);
// the torso's middle in z at the tape height: halfway between the section's front and back
const midZOf = (y) => { const sec = measureSection(ctx.tri, y) || null; const zs = sec ? sec.ring.map((p) => p[1]) : [0]; return (Math.max(...zs) + Math.min(...zs)) / 2; };
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

// ---- 9. curves from a strap to a landmark ---------------------------------------------
gate.record('every declared curve validates',
  loaded.curves.length === (contract.curves || []).length,
  `${loaded.curves.length} curve(s): ${loaded.curves.map((c) => `${c.id} ${c.from.strap}.${c.from.corner} -> ${c.to.landmark}_L/R`).join(', ') || 'none'}`);
const brokenCurve = loadLevels({ ...contract, curves: [{ id: 'C', kind: 'shortest_surface_path', from: { strap: 'NOPE', corner: 'middle' }, to: { landmark: 'NOPE' }, colour: '#000000', label: 'c' }] }, ctx.registry);
gate.record('a curve from an unknown strap, corner or landmark is refused',
  brokenCurve.curves.length === 0 && brokenCurve.errors.some((e) => /strap NOPE/.test(e) && /corner middle/.test(e) && /NOPE_L/.test(e)),
  brokenCurve.errors.join('; ').slice(0, 160));
const points = measurePoints(loaded, ctx.landmarks, ctx.tri);
const curves = measureCurves(loaded, straps, ctx.landmarks, ctx.grid, {}, points);
for (const curve of curves) {
  const strap = straps.find((s) => s.id === curve.from.strap);
  const ok = !curve.blocked && curve.runs.length === 2
    && curve.runs.every((r) => {
      const [a, z] = [r.points[0], r.points[r.points.length - 1]];
      const corner = strap.bands.find((b) => b.side === r.side).corners[curve.from.corner];
      const mark = ctx.landmarks[`${curve.to.landmark}_${r.side}`];
      const chord = Math.hypot(...a.map((v, i) => v - z[i]));
      // from the strap corner to the landmark, on the skin, no shorter than the chord
      return a.every((v, i) => v === corner[i]) && z.every((v, i) => v === mark[i])
        && r.points.every((p) => { const c = ctx.closest(p); return c && Math.hypot(...p.map((v, i) => v - c.point[i])) < 5e-4; })
        && r.length_m >= chord;
    })
    && Math.abs(curve.runs[0].length_m - curve.runs[1].length_m) < 1e-4;
  gate.record(`${curve.id}: from ${curve.from.strap} ${curve.from.corner} to ${curve.to.landmark} on each side, over the skin`,
    ok,
    curve.blocked || curve.runs.map((r) => `${r.side} ${(r.length_m * 1000).toFixed(1)}mm`).join('; '));
  if (curve.kind !== 'tangent_curve' || curve.blocked) continue;
  const onSkin = (pts) => pts.every((p) => { const c = ctx.closest(p); return c && Math.hypot(...p.map((v, i) => v - c.point[i])) < 5e-4; });
  const mirrored = (a, b) => a.points.length === b.points.length && a.points.every((p, i) => Math.hypot(p[0] + b.points[i][0], p[1] - b.points[i][1], p[2] - b.points[i][2]) < 1e-4);
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
    const bentVia = measureCurves({ curves: [curve] }, straps, ctx.landmarks, ctx.grid, {}, [moved])[0];
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
const brokenHandles = loadLevels({ ...contract, curves: (contract.curves || []).map((c) => ({ ...c, kind: 'tangent_curve', handles: { from: { angle_deg: 'up', length_mm: 40 }, to: { angle_deg: 0, length_mm: -1 } } })) }, ctx.registry);
gate.record('a tangent curve without a sound pair of handles is refused',
  (contract.curves || []).length === 0 || (brokenHandles.curves.length === 0 && brokenHandles.errors.some((e) => /handles\.from\.angle_deg/.test(e) && /handles\.to\.length_mm/.test(e))),
  brokenHandles.errors.join('; ').slice(0, 160));

// ---- 10. points offset from a landmark -------------------------------------------------
gate.record('every declared point validates',
  loaded.points.length === (contract.points || []).length,
  `${loaded.points.length} point(s): ${loaded.points.map((p) => `${p.id} ${p.up_in}in up, ${p.forward_in}in forward from ${p.from.landmark}_L/R`).join(', ') || 'none'}`);
const brokenPoint = loadLevels({ ...contract, points: [{ id: 'P', kind: 'offset_on_skin', from: { landmark: 'NOPE' }, up_in: null, forward_in: 'x', colour: '#000000', label: 'p' }] }, ctx.registry);
gate.record('a point from an unknown landmark or with bad offsets is refused',
  brokenPoint.points.length === 0 && brokenPoint.errors.some((e) => /NOPE_L/.test(e) && /up_in/.test(e) && /forward_in/.test(e)),
  brokenPoint.errors.join('; ').slice(0, 160));
for (const point of points) {
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
    id: l.id, from: l.from, to: l.to, blocked: l.blocked,
    ...(l.blocked ? {} : {
      length_mm: Number((l.length_m * 1000).toFixed(1)),
      chord_mm: Number((l.chord_m * 1000).toFixed(1)),
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
    })),
  })),
  points: points.map((p) => ({
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
