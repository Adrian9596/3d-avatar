#!/usr/bin/env node
/**
 * DXF round-trip gate for the pattern-draft export.
 *
 * Writes the flattened cup panels (scripts/flatten_cases.json, apex_panels_80mm)
 * as an ASTM D6673-10 DXF in Gerber's dialect (scripts/dxf_writer.mjs), then
 * reads the file back with an INDEPENDENT parser written here — a different
 * author of the same rules, so a writer that misremembers the layout is caught
 * rather than confirmed — and checks:
 *
 * 1. STRUCTURE Gerber's parser insists on: R12 ASCII, 7-bit only, an empty
 *    HEADER, no TABLES, no $MODEL_SPACE / $PAPER_SPACE, one BLOCK per piece,
 *    one INSERT per block.
 * 2. ASTM CONTENT per block: Piece System Text with the exact key syntax on
 *    layer 1, exactly one closed boundary POLYLINE on layer 1, a byte-identical
 *    validation copy on layer 84, a grain LINE on layer 7, every boundary vertex
 *    marked as a turn (2) or curve (3) point; Style System Text with the
 *    required keys in ENTITIES.
 * 3. GEOMETRY: coordinates read back equal the coordinates written, and the
 *    outline's perimeter survives the two-decimal (10 µm) rounding the metric
 *    convention imposes — the loss is measured and recorded, not assumed.
 *
 * What this gate cannot do is open the file in AccuMark. Until someone does,
 * the evidence says so (`import_verified: false`).
 *
 * Pass a DXF path as the first argument to check an existing file instead of
 * writing one (negative tests).
 *
 * Exit codes: 0 pass, 1 a check failed, 2 an input is missing/stale.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flattenPieces, chordReport } from './flatten_core.mjs';
import { loadAvatarContext, resolveCase } from './flatten_fixtures.mjs';
import { writeAstmDxf, ASTM_LAYERS, NAME_LIMIT } from './dxf_writer.mjs';
import { dxfPiece } from './dxf_pieces.mjs';
import { createGate, sha256Bytes as sha256 } from './gate_report.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASES_PATH = join(ROOT, 'scripts', 'flatten_cases.json');
const DXF_PATH = join(ROOT, 'qa', 'avatar_master', 'flatten-draft.dxf');
const REPORT_PATH = join(ROOT, 'qa', 'avatar_master', 'dxf-roundtrip.json');
const CHECK_ONLY = process.argv[2] ? join(process.cwd(), process.argv[2]) : null;
const FIXTURE_STAMP = new Date('2026-09-05T00:00:00Z');   // the day the Gerber contract was fixed

const { checks, record, finish, blocked } = createGate();
const SST_KEYS = ['Style Name', 'Creation Date', 'Creation Time', 'Author', 'Sample Size', 'Grade Rule Table', 'Units', 'ASTM/D13 Proposal 1 Version', 'Curve Tolerance'];
const PST_KEYS = ['Piece Name', 'Quantity'];

// ------------------------------------------------------- an independent reader

function parseDxf(text) {
  const lines = text.split(/\r?\n/);
  const tags = [];
  for (let i = 0; i + 1 < lines.length; i += 2) tags.push([lines[i].trim(), lines[i + 1]]);
  const sections = {};
  const blocks = [];
  let i = 0;
  while (i < tags.length) {
    const [code, value] = tags[i];
    if (code === '0' && value === 'SECTION') {
      const name = tags[i + 1][1].trim();
      let j = i + 2;
      const ents = [];
      while (j < tags.length && !(tags[j][0] === '0' && tags[j][1] === 'ENDSEC')) {
        if (tags[j][0] === '0') {
          const ent = { type: tags[j][1].trim(), groups: [] };
          let k = j + 1;
          while (k < tags.length && tags[k][0] !== '0') { ent.groups.push([tags[k][0], tags[k][1]]); k++; }
          ents.push(ent); j = k;
        } else j++;
      }
      sections[name] = ents;
      i = j + 1;
    } else if (code === '0' && value === 'EOF') { i++; break; } else i++;
  }
  // group BLOCKS section into block definitions
  for (const ents of [sections.BLOCKS || []]) {
    let cur = null;
    for (const e of ents) {
      if (e.type === 'BLOCK') { cur = { name: g(e, '2'), entities: [] }; blocks.push(cur); }
      else if (e.type === 'ENDBLK') cur = null;
      else if (cur) cur.entities.push(e);
    }
  }
  return { sections, blocks, eof: tags.some(([c, v]) => c === '0' && v === 'EOF') };
}
const g = (ent, code) => { const hit = ent.groups.find(([c]) => c === code); return hit ? hit[1] : undefined; };

/** Assemble POLYLINE/VERTEX/SEQEND runs into polylines. */
function polylines(entities) {
  const out = [];
  let cur = null;
  for (const e of entities) {
    if (e.type === 'POLYLINE') cur = { layer: g(e, '8'), closed: (Number(g(e, '70')) & 1) === 1, points: [] };
    else if (e.type === 'VERTEX' && cur) cur.points.push([Number(g(e, '10')), Number(g(e, '20'))]);
    else if (e.type === 'SEQEND' && cur) { out.push(cur); cur = null; }
  }
  return out;
}
const perimeter = (ring) => ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0);

// ------------------------------------------------------------------- produce

let written = null, assetSha = null, casesSha = null, pieceRecords = null;
if (!CHECK_ONLY) {
  const cases = JSON.parse(readFileSync(CASES_PATH, 'utf8'));
  casesSha = sha256(readFileSync(CASES_PATH));
  const ctx = loadAvatarContext(ROOT);
  if (ctx.error) blocked(ctx.error);
  assetSha = ctx.assetSha;
  const spec = cases.cases.find((c) => c.type === 'avatar_panels');
  const built = resolveCase(spec, ctx);
  if (built.error) blocked(built.error);
  const run = flattenPieces(built.pieces, cases.solver);
  const pairs = new Set(run.shared.map((x) => x.pair));
  const reports = built.pieces.map((p, i) => chordReport(p.chords, p.sub, run.pieces[i].uv, pairs));
  const mismatchMm = Math.abs(reports[0].shared_length_flat_m - reports[1].shared_length_flat_m) * 1000;
  pieceRecords = built.pieces.map((p, i) => dxfPiece(
    { name: `CUP_${p.name.toUpperCase()}`, sub: p.sub, uv: run.pieces[i].uv, samples: p.patch.samples },
    { assetSha, seamErrorMm: reports[i].seam_error_m * 1000, sharedSeam: { with: `CUP_${built.pieces[1 - i].name.toUpperCase()}`, mismatchMm } },
  ));
  written = writeAstmDxf({
    style: {
      name: 'AVATAR_MASTER_DRAFT', author: 'Crossian', application: '3d-avatar-flatten', release: '0.1.0',
      // a FIXED stamp: this DXF is a reproducible fixture that CI compares byte
      // for byte against the committed copy (validate:evidence-drift); the
      // viewer's own export stamps the real time.
      sampleSize: 'UNGRADED', gradeRuleTable: 'NONE', curveToleranceMm: 0.01, created: FIXTURE_STAMP,
    },
    pieces: pieceRecords,
  });
  mkdirSync(dirname(DXF_PATH), { recursive: true });
  writeFileSync(DXF_PATH, written.text, 'ascii');
}
const dxfPath = CHECK_ONLY || DXF_PATH;
const bytes = readFileSync(dxfPath);
const text = bytes.toString('latin1');

// ------------------------------------------------------------------- checks

record('the file is 7-bit ASCII', [...bytes].every((b) => b >= 0x20 && b <= 0x7e || b === 0x0d || b === 0x0a), `${bytes.length} bytes`);
const doc = parseDxf(text);
record('the file ends with EOF', doc.eof, '');
record('HEADER section is present and empty', Array.isArray(doc.sections.HEADER) && doc.sections.HEADER.length === 0,
  doc.sections.HEADER ? `${doc.sections.HEADER.length} entries` : 'missing');
record('no TABLES section (Gerber rejects it)', !('TABLES' in doc.sections), Object.keys(doc.sections).join(', '));
record('no $MODEL_SPACE / $PAPER_SPACE blocks (Gerber rejects them)', !doc.blocks.some((b) => /^\$/.test(b.name || '')), doc.blocks.map((b) => b.name).join(', '));
record('at least one pattern piece block', doc.blocks.length > 0, `${doc.blocks.length} block(s)`);

const entities = doc.sections.ENTITIES || [];
const inserts = entities.filter((e) => e.type === 'INSERT');
record('one INSERT per block, each naming an existing block',
  inserts.length === doc.blocks.length && inserts.every((e) => doc.blocks.some((b) => b.name === g(e, '2'))),
  `${inserts.length} insert(s) for ${doc.blocks.length} block(s)`);
const sstLines = entities.filter((e) => e.type === 'TEXT' && g(e, '8') === ASTM_LAYERS.system_text).map((e) => g(e, '1'));
const sstMissing = SST_KEYS.filter((k) => !sstLines.some((l) => l.startsWith(`${k}: `)));
record('Style System Text on layer 1 with every required key, exact case', sstMissing.length === 0,
  sstMissing.length ? `missing ${sstMissing.join(', ')}` : sstLines.length + ' lines');
record('Style System Text declares metric units', sstLines.includes('Units: METRIC'), sstLines.find((l) => l.startsWith('Units')) || 'missing');
const styleName = (sstLines.find((l) => l.startsWith('Style Name: ')) || '').slice('Style Name: '.length);
record(`Style Name within ${NAME_LIMIT} characters`, styleName.length > 0 && styleName.length <= NAME_LIMIT, styleName);

const pieceRows = [];
let worstCoord = 0, worstPerimeter = 0;
for (const block of doc.blocks) {
  const pl = polylines(block.entities);
  const boundary = pl.filter((p) => p.layer === ASTM_LAYERS.boundary);
  const validation = pl.filter((p) => p.layer === ASTM_LAYERS.boundary_validation);
  const pst = block.entities.filter((e) => e.type === 'TEXT' && g(e, '8') === ASTM_LAYERS.system_text).map((e) => g(e, '1'));
  const pstMissing = PST_KEYS.filter((k) => !pst.some((l) => l.startsWith(`${k}: `)));
  const pieceName = (pst.find((l) => l.startsWith('Piece Name: ')) || '').slice('Piece Name: '.length);
  const grain = block.entities.filter((e) => e.type === 'LINE' && g(e, '8') === ASTM_LAYERS.grain_line);
  const points = block.entities.filter((e) => e.type === 'POINT');
  const turn = points.filter((e) => g(e, '8') === ASTM_LAYERS.turn_points).length;
  const curve = points.filter((e) => g(e, '8') === ASTM_LAYERS.curve_points).length;
  const notes = block.entities.filter((e) => e.type === 'TEXT' && g(e, '8') === ASTM_LAYERS.annotation).length;
  const tag = `block ${block.name}`;
  record(`${tag}: Piece System Text on layer 1 with the required keys`, pstMissing.length === 0, pstMissing.length ? `missing ${pstMissing.join(', ')}` : pst.join(' | '));
  record(`${tag}: Piece Name within ${NAME_LIMIT} characters`, pieceName.length > 0 && pieceName.length <= NAME_LIMIT, pieceName);
  record(`${tag}: exactly one closed boundary polyline on layer 1`, boundary.length === 1 && boundary[0].closed && boundary[0].points.length >= 3,
    `${boundary.length} polyline(s)${boundary[0] ? `, ${boundary[0].points.length} vertices, closed=${boundary[0].closed}` : ''}`);
  record(`${tag}: validation curve on layer 84 is a copy of the boundary`,
    validation.length === 1 && boundary.length === 1 && validation[0].closed && JSON.stringify(validation[0].points) === JSON.stringify(boundary[0].points),
    `${validation.length} validation polyline(s)`);
  record(`${tag}: one grain line on layer 7`, grain.length === 1, `${grain.length} line(s)`);
  record(`${tag}: every boundary vertex is a turn (2) or curve (3) point`, boundary.length === 1 && turn + curve === boundary[0].points.length,
    `${turn} turn + ${curve} curve points for ${boundary[0]?.points.length ?? 0} vertices`);
  record(`${tag}: annotation present on layer 15`, notes > 0, `${notes} line(s)`);

  // geometry round trip against what was written
  if (pieceRecords && boundary.length === 1) {
    const rec = pieceRecords.find((p) => p.name === pieceName);
    if (rec) {
      const bb = rec.outline_mm.reduce((a, [x, y]) => ({ minx: Math.min(a.minx, x), miny: Math.min(a.miny, y) }), { minx: Infinity, miny: Infinity });
      const expected = rec.outline_mm.map(([x, y]) => [x - bb.minx, y - bb.miny]);
      let maxDelta = 0;
      expected.forEach(([x, y], i) => { const [rx, ry] = boundary[0].points[i]; maxDelta = Math.max(maxDelta, Math.abs(rx - x), Math.abs(ry - y)); });
      const dPer = Math.abs(perimeter(boundary[0].points) - perimeter(expected));
      worstCoord = Math.max(worstCoord, maxDelta); worstPerimeter = Math.max(worstPerimeter, dPer);
      record(`${tag}: coordinates survive the round trip to the 0.01mm the metric convention writes`, maxDelta <= 0.005 + 1e-9,
        `worst vertex Δ ${maxDelta.toFixed(4)}mm`);
      record(`${tag}: outline perimeter survives rounding`, dPer <= 0.05, `Δ ${dPer.toFixed(4)}mm over ${perimeter(expected).toFixed(2)}mm`);
      pieceRows.push({ block: block.name, piece_name: pieceName, vertices: boundary[0].points.length, turn_points: turn, curve_points: curve,
        perimeter_mm: Number(perimeter(boundary[0].points).toFixed(2)), worst_vertex_delta_mm: Number(maxDelta.toFixed(4)), perimeter_delta_mm: Number(dPer.toFixed(4)) });
    }
  } else {
    pieceRows.push({ block: block.name, piece_name: pieceName, vertices: boundary[0]?.points.length ?? 0, turn_points: turn, curve_points: curve });
  }
}

finish({
  reportPath: CHECK_ONLY ? null : REPORT_PATH, relativeTo: ROOT, okDecision: 'DXF_ROUNDTRIPS',
  lines: CHECK_ONLY ? [] : [`WROTE  ${relative(ROOT, DXF_PATH)} (${bytes.length} bytes)`],
  body: {
    purpose: 'The pattern-draft DXF is structurally what Gerber AccuMark imports (ASTM D6673-10, R12 dialect) and its geometry survives a read-back by an independent parser.',
    asset: { file: 'assets/export/avatar_master.glb', sha256: assetSha },
    cases: { file: relative(ROOT, CASES_PATH), sha256: casesSha },
    dxf: { file: relative(ROOT, DXF_PATH), sha256: sha256(bytes), bytes: bytes.length, layers_used: ASTM_LAYERS, version: 'R12 ASCII, Gerber dialect' },
    target_cad: 'Gerber AccuMark',
    creation_stamp_fixed: FIXTURE_STAMP.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    import_verified: false,
    import_verified_note: 'Structure follows ASTM D6673-10 and the constraints Gerber\'s parser is documented to impose (contracts/dxf-astm-d6673.md). Nobody has yet opened this file in AccuMark; when someone does, record the AccuMark version here.',
    style_system_text: written?.style_system_text,
    layout: written?.layout,
    pieces: pieceRows,
    worst_vertex_delta_mm: Number(worstCoord.toFixed(4)),
    worst_perimeter_delta_mm: Number(worstPerimeter.toFixed(4)),
    declared_limits: [
      'Pieces are shells of the body surface at 1:1: no ease, no seam allowance, no grading. The annotation on layer 15 says so inside the file.',
      'Grain line is a default (the body\'s vertical through the piece centre); Quantity 1,1 is a default. Both are for the pattern maker to set.',
      'Turn points are vertices turning more than 30 degrees, a geometric rule; curve points are every other outline vertex.',
      'Coordinates are written to 0.01mm per the metric convention; the rounding loss is recorded above.',
    ],
  },
});
