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
  loadLevels, resolveLevels, measureLevels, levelsRecord, outOfRange,
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
gate.record('every level either yields a closed ring or says why it does not',
  measured.levels.every((l) => (l.girth_m === null
    ? Boolean(l.blocked) && l.section === null
    : l.blocked === null && l.section !== null)),
  `${reported.length} measured, ${withheld.length} withheld${withheld.length ? ` (${withheld.map((l) => `${l.id}: ${l.blocked}`).join('; ')})` : ''}`);
gate.record('no level reports a girth where a section is not trustworthy',
  measured.levels.every((l) => (outOfRange(l.y_m, { scan, maxY }) === null) || l.girth_m === null),
  `nothing above y = ${maxY}m or outside the scan yields a number`);

// The contract claims the stack fits between the waist and the armhole on this
// body. That is a property of THIS avatar, so it is measured, not asserted.
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
