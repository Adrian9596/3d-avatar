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
  loadLevels, resolveLevels, measureLevels, measureShapes, measureReferenceTapes, measureLines, levelsRecord, outOfRange,
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
