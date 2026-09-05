#!/usr/bin/env node
/**
 * Gate for contracts/pattern-templates.json and scripts/pattern_templates.mjs —
 * template drafts as proposals.
 *
 * What it proves, against a DECLARED SYNTHETIC landmark set
 * (scripts/pattern_template_fixture_landmarks.json — the manual-only roots are
 * made up around the detected apex; the viewer never reads it): the contract
 * validates against the registry; every template resolves, flattens sound
 * (0 fold-overs, converged) with a shared-seam mismatch within the seam
 * tolerance; resolution is deterministic (anchor hash identical run to run); a
 * template missing a requirement reports `needs` and no geometry; the cup
 * numbers AUTHORING_UX_PLAN.md §4.3 measured are reproduced (one piece ~19.5 mm,
 * vertical 7.6/2.5 mm at 1.05 mm mismatch, horizontal 3.9/2.2 mm at 0.59 mm);
 * and the record a drafted piece carries names the template and every
 * landmark's provenance in ASCII.
 *
 * Exit codes: 0 pass, 1 a check failed, 2 the avatar context is unavailable.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGate, sha256File, sha256Bytes } from './gate_report.mjs';
import { loadAvatarContext } from './flatten_fixtures.mjs';
import { draftPieces, flattenDraft, draftSummary, draftExport, asciiPieceName, SEAM_TOLERANCE_MM } from './pattern_draft.mjs';
import { loadTemplates, resolveTemplate, templatesFor, templateRecord, templateAnnotation, templatePolyline, TEMPLATE_LIMIT } from './pattern_templates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = join(ROOT, 'contracts', 'pattern-templates.json');
const FIXTURE = join(ROOT, 'scripts', 'pattern_template_fixture_landmarks.json');
const REPORT = join(ROOT, 'qa', 'avatar_master', 'pattern-templates-test.json');
const gate = createGate();
const round2 = (v) => Number(v.toFixed(2));

const ctx = loadAvatarContext(ROOT);
if (ctx.error) gate.blocked(ctx.error);
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
if (fixture.asset?.sha256 !== ctx.assetSha) gate.blocked(`fixture landmarks were made on ${fixture.asset?.sha256?.slice(0, 12)}…, asset on disk is ${ctx.assetSha.slice(0, 12)}…`);
gate.record('the fixture declares itself synthetic', fixture.fixture === true && /SYNTHETIC/.test(fixture.note), 'roots made up around the detected apex; the viewer never reads this file');

// ---- the contract validates against the registry -----------------------------
const contract = JSON.parse(readFileSync(CONTRACT, 'utf8'));
const { templates, errors, declared_limit } = loadTemplates(contract, ctx.registry);
gate.record('the contract validates against the registry', errors.length === 0 && templates.length === contract.templates.length, errors.join('; ') || `${templates.length} templates, every anchor a registry landmark, every seam end on its outline`);
gate.record('every template is a proposal', templates.every((t) => t.status === 'proposal'), 'status: proposal');
gate.record('the contract states the template limit', declared_limit === TEMPLATE_LIMIT, declared_limit);
const bad = loadTemplates({ templates: [{ id: 'X_L', side: 'L', status: 'proposal', requires: ['NOPE'], outline: { closed: true, anchors: ['NOPE', 'BUST_APEX_L', 'ROOT_TOP_L'] }, seam: null }] }, ctx.registry);
gate.record('an unknown landmark or an unlisted requirement is refused', bad.templates.length === 0 && bad.errors.length === 1, bad.errors[0]);

// ---- resolution ------------------------------------------------------------
const L = fixture.landmarks;
const { available, blocked } = templatesFor(null, L, templates);
gate.record('every template resolves on the fixture', available.length === templates.length && blocked.length === 0, `${available.length} available`);
const withoutRoots = Object.fromEntries(Object.entries(L).filter(([k]) => !/^ROOT_(TOP|INNER|OUTER)_/.test(k)));
const real = templatesFor(null, withoutRoots, templates);
gate.record('without the hand-placed roots every template reads needs …, never a number', real.available.length === 0 && real.blocked.every((b) => b.needs.length >= 2 && b.needs.every((id) => /^ROOT_/.test(id))), real.blocked.map((b) => `${b.template.id}: ${b.needs.join(', ')}`).join('; ').slice(0, 160));
const hashes = [0, 1].map(() => sha256Bytes(JSON.stringify(templates.map((t) => resolveTemplate(t, L)))));
gate.record('resolution is deterministic', hashes[0] === hashes[1], `anchors sha256 ${hashes[0].slice(0, 12)}…`);

// ---- every template flattens sound ------------------------------------------
const results = [];
for (const { template, resolved } of available) {
  const t0 = performance.now();
  const outline = templatePolyline(resolved.outline.anchors, true, ctx.grid);
  const seam = resolved.seam ? templatePolyline(resolved.seam.anchors, false, ctx.grid) : null;
  const cut = draftPieces({
    mesh: ctx.mesh, closest: ctx.closest,
    outline: { name: template.id, points: outline.points },
    seam: seam ? { name: `${template.id} SEAM`, points: seam.points } : null,
  });
  if (cut.error) { results.push({ id: template.id, error: cut.error }); continue; }
  const flat = flattenDraft(cut.pieces);
  const summary = draftSummary(cut.pieces, flat);
  results.push({
    id: template.id, side: template.side, pieces: summary.pieces.map((p) => ({ name: p.name, seam_error_mm: p.seam_error_mm, seam_3d_mm: p.seam_length_3d_mm, triangle_flips: p.triangle_flips })),
    shared_mismatch_mm: summary.shared_seam?.mismatch_mm ?? null, iterations: summary.iterations, converged: summary.converged, sound: flat.sound,
    outline_mm: round2(outline.length_m * 1000), under_budget: performance.now() - t0 < 400,
  });
}
const failed = results.filter((r) => r.error || !r.sound);
gate.record('every template flattens sound (converged, no fold-over)', failed.length === 0, failed.map((r) => `${r.id}: ${r.error || 'unsound'}`).join('; ') || `${results.length} templates`);
const overTol = results.filter((r) => r.shared_mismatch_mm !== null && r.shared_mismatch_mm > SEAM_TOLERANCE_MM);
gate.record(`every shared seam agrees within ${SEAM_TOLERANCE_MM} mm`, overTol.length === 0, overTol.map((r) => `${r.id}: ${r.shared_mismatch_mm}`).join('; ') || results.filter((r) => r.shared_mismatch_mm !== null).map((r) => `${r.id} ${r.shared_mismatch_mm}`).join(', '));
const byId = Object.fromEntries(results.map((r) => [r.id, r]));
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const one = byId.CUP_1PIECE_L, vert = byId.CUP_2PANEL_VERTICAL_L, horiz = byId.CUP_2PANEL_HORIZONTAL_L;
gate.record('the plan\'s §4.3 cup numbers are reproduced (±0.5 mm)',
  one && near(one.pieces[0].seam_error_mm, 19.5, 0.5)
  && vert && near(vert.pieces[0].seam_error_mm, 7.6, 0.5) && near(vert.pieces[1].seam_error_mm, 2.5, 0.5) && near(vert.shared_mismatch_mm, 1.05, 0.5)
  && horiz && near(horiz.pieces[0].seam_error_mm, 3.9, 0.5) && near(horiz.pieces[1].seam_error_mm, 2.2, 0.5) && near(horiz.shared_mismatch_mm, 0.59, 0.5),
  `one piece ${one?.pieces[0].seam_error_mm}; vertical ${vert?.pieces.map((p) => p.seam_error_mm).join('/')} @ ${vert?.shared_mismatch_mm}; horizontal ${horiz?.pieces.map((p) => p.seam_error_mm).join('/')} @ ${horiz?.shared_mismatch_mm} mm`);
const mirrorPairs = templates.filter((t) => t.side === 'L').map((t) => [byId[t.id], byId[t.id.replace(/_L$/, '_R')]]);
const symmetric = mirrorPairs.every(([l, r]) => l && r && l.pieces.every((p, i) => near(p.seam_error_mm, r.pieces[i].seam_error_mm, 0.05)));
gate.record('left and right templates agree on this mirrored body (±0.05 mm)', symmetric, mirrorPairs.map(([l, r]) => `${l?.id}: ${l?.pieces.map((p) => p.seam_error_mm).join('/')} vs ${r?.pieces.map((p) => p.seam_error_mm).join('/')}`).join('; ').slice(0, 200));
// timing is checked, not recorded: a millisecond figure would drift the committed evidence on every run
gate.record('a template flattens fast enough to follow a landmark drag (< 400 ms)', results.every((r) => r.under_budget), `${results.length} templates under budget`);

// ---- a drafted template exports: two panels of a long template name stay distinct blocks ----
{
  const t = templates.find((x) => x.id === 'CUP_2PANEL_HORIZONTAL_L');
  const r = resolveTemplate(t, L);
  const outline = templatePolyline(r.outline.anchors, true, ctx.grid), seam = templatePolyline(r.seam.anchors, false, ctx.grid);
  const cut = draftPieces({ mesh: ctx.mesh, closest: ctx.closest, outline: { name: t.id, points: outline.points }, seam: { name: `${t.id} SEAM`, points: seam.points } });
  const flat = flattenDraft(cut.pieces);
  const record = templateRecord(t, L, fixture.provenance, false);
  let exported = null, error = null;
  try {
    exported = draftExport({ pieces: cut.pieces, result: flat, outline: { name: t.id, closed: true, length: outline.length_m, anchors: r.outline.anchors, origin: { template: t.id } }, seam: { name: `${t.id} SEAM`, closed: false, length: seam.length_m, anchors: r.seam.anchors }, asset: { file: 'avatar_master.glb', sha256: ctx.assetSha }, registrySha: 'test', release: 'test', template: record, now: new Date('2026-09-05T00:00:00Z') });
  } catch (e) { error = e.message; }
  gate.record('two panels of a 23-character template name export as distinct 20-character blocks', Boolean(exported) && exported.names.length === 2 && exported.names[0] !== exported.names[1] && exported.names.every((n) => n.length <= 20 && /^[A-Z0-9_]+$/.test(n)),
    error || exported.names.join(', '));
  gate.record('asciiPieceName keeps the panel letter when it cuts', asciiPieceName('CUP_2PANEL_HORIZONTAL_L A', 'X') === 'CUP_2PANEL_HORIZON_A' && asciiPieceName('Cup L', 'X') === 'CUP_L', asciiPieceName('CUP_2PANEL_HORIZONTAL_L A', 'X'));
  const ev = exported ? JSON.parse(exported.evidence) : null;
  gate.record("the export evidence and the DXF name the template and its landmarks' provenance", Boolean(ev?.template) && ev.template.id === t.id && ev.template.landmarks.ROOT_TOP_L.source === 'fixture' && (exported.dxf.match(/Template CUP_2PANEL_HORIZONTAL_L:/g) || []).length === 2 && exported.dxf.includes('Template seams are conventional cuts'),
    ev ? `template ${ev.template.id}, ${Object.keys(ev.template.landmarks).length} landmarks, annotation on both pieces` : 'no export');
}

// ---- the record --------------------------------------------------------------
const rec = templateRecord(templates[1], L, fixture.provenance, false);
const recEdited = templateRecord(templates[1], L, fixture.provenance, true);
const ann = templateAnnotation(recEdited);
gate.record('the record names the template and every landmark with its provenance', rec.id === 'CUP_2PANEL_VERTICAL_L' && Object.keys(rec.landmarks).length === 5 && rec.landmarks.ROOT_TOP_L.source === 'fixture' && rec.landmarks.BUST_APEX_L.source === 'auto' && rec.limit === TEMPLATE_LIMIT, `${Object.keys(rec.landmarks).length} landmarks`);
gate.record('the layer-15 annotation is ASCII and says edited when edited', /^Template CUP_2PANEL_VERTICAL_L \(edited\): /.test(ann) && /^[\x20-\x7e]+$/.test(ann), ann.slice(0, 90));

gate.finish({
  reportPath: REPORT, relativeTo: ROOT, okDecision: 'TEMPLATES_ARE_PROPOSALS',
  body: {
    purpose: 'Template drafts resolve, flatten sound and stay proposals: needs … without the hand-placed roots, seam error reported per panel, the person chooses.',
    contract: { file: 'contracts/pattern-templates.json', sha256: sha256File(CONTRACT) },
    fixture: { file: 'scripts/pattern_template_fixture_landmarks.json', sha256: sha256File(FIXTURE), synthetic: true },
    asset: { file: 'assets/export/avatar_master.glb', sha256: ctx.assetSha },
    tolerance_mm: SEAM_TOLERANCE_MM,
    results,
    declared_limits: [
      TEMPLATE_LIMIT,
      'The roots in the fixture are synthetic; on the real body a person places them and the numbers will differ.',
      'The gate builds template lines the way the pen does (shortest paths, control points at thirds) but without the pen; the viewer drafts through the pen itself.',
    ],
  },
});
