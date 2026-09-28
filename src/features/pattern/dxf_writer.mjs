/**
 * ASTM D6673-10 ("AAMA") pattern DXF writer, in the dialect Gerber AccuMark's
 * importer accepts. Pure serializer: it knows nothing about meshes or bodies —
 * hand it flat pieces in millimetres and it writes text.
 *
 * What the file looks like, and why (contracts/dxf-astm-d6673.md has sources):
 * - DXF R12, ASCII, 7-bit characters only (the standard allows nothing else).
 * - An EMPTY HEADER section, NO TABLES section, and no $MODEL_SPACE /
 *   $PAPER_SPACE block definitions: Gerber's parser rejects files that carry
 *   them, even though DXF permits them (ezdxf's gerber_D6673 addon exists to
 *   strip exactly these).
 * - One BLOCK per pattern piece. Inside it, on numbered layers:
 *     1  Piece System Text (one TEXT per line, exact key syntax) and the closed
 *        boundary POLYLINE, drawn WITHOUT seam allowance (the net line);
 *     2  turn points (POINT) at corners, 3 curve points at the other vertices;
 *     7  the grain line (LINE);
 *    15  annotation text;
 *    84  the boundary quality-validation curve — a copy of the layer-1 polyline,
 *        mandatory in ASTM.
 * - ENTITIES: the Style System Text (one TEXT per line, layer 1, at the origin)
 *   and one INSERT per piece, laid out side by side.
 * - Coordinates in millimetres with two decimals, which is what "Units: METRIC"
 *   means in the standard.
 *
 * The writer refuses (throws) rather than quietly truncating: names over the
 * 20-character Gerber limit, non-ASCII text, an open outline, a piece with no
 * grain line. What it cannot check — that AccuMark actually opens the result —
 * is recorded as unverified in the contract until someone does.
 */

export const ASTM_LAYERS = Object.freeze({
  boundary: '1', system_text: '1', turn_points: '2', curve_points: '3',
  grain_line: '7', internal_lines: '8', internal_cutouts: '11', sew_lines: '14',
  annotation: '15', boundary_validation: '84',
});
export const NAME_LIMIT = 20;            // Gerber truncates longer names; we refuse instead
export const STANDARD_VERSION = 'D6673-10';
const SYSTEM_TEXT_HEIGHT_MM = 3;
const ANNOTATION_HEIGHT_MM = 5;
const LINE_STEP_MM = 4;                  // vertical spacing of stacked text lines
const PIECE_GAP_MM = 30;

const fmt = (v) => {
  const s = (Math.round(v * 100) / 100).toFixed(2);
  return s === '-0.00' ? '0.00' : s;
};

function ascii(s, what) {
  if (!/^[\x20-\x7E]*$/.test(s)) throw new Error(`${what} is not 7-bit ASCII: ${JSON.stringify(s)}`);
  return s;
}
function name20(s, what) {
  ascii(s, what);
  if (!s.length || s.length > NAME_LIMIT) throw new Error(`${what} must be 1-${NAME_LIMIT} characters, got ${s.length}: ${s}`);
  return s;
}
const pad2 = (n) => String(n).padStart(2, '0');

class Tags {
  constructor() { this.lines = []; }
  add(code, value) { this.lines.push(String(code), String(value)); return this; }
  text(layer, x, y, height, string) {
    return this.add(0, 'TEXT').add(8, layer).add(10, fmt(x)).add(20, fmt(y)).add(30, '0.00').add(40, fmt(height)).add(1, ascii(string, 'text'));
  }
  point(layer, x, y) { return this.add(0, 'POINT').add(8, layer).add(10, fmt(x)).add(20, fmt(y)).add(30, '0.00'); }
  line(layer, a, b) {
    return this.add(0, 'LINE').add(8, layer).add(10, fmt(a[0])).add(20, fmt(a[1])).add(30, '0.00').add(11, fmt(b[0])).add(21, fmt(b[1])).add(31, '0.00');
  }
  polyline(layer, points, closed) {
    this.add(0, 'POLYLINE').add(8, layer).add(66, 1).add(70, closed ? 1 : 0).add(10, '0.00').add(20, '0.00').add(30, '0.00');
    for (const [x, y] of points) this.add(0, 'VERTEX').add(8, layer).add(10, fmt(x)).add(20, fmt(y)).add(30, '0.00');
    return this.add(0, 'SEQEND').add(8, layer);
  }
  join() { return this.lines.join('\r\n') + '\r\n'; }
}

/** Stack lines of text downward from (x, yTop), one TEXT entity per line. */
function stackedText(tags, layer, x, yTop, height, lines) {
  lines.forEach((line, i) => tags.text(layer, x, yTop - i * LINE_STEP_MM, height, line));
}

function bbox(points) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of points) { if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y; }
  return { minx, miny, maxx, maxy };
}

/** Piece-name → block name: uppercase, [A-Z0-9_] only (some parsers reject spaces). */
export function blockName(pieceName) {
  return pieceName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'PIECE';
}

/**
 * @param style  { name, author, application, release, sampleSize, gradeRuleTable,
 *                 curveToleranceMm, created: Date }
 * @param pieces [{ name, outline_mm: [[x,y],...] (closed ring, last != first),
 *                  turn_point_indices: [i,...], grain_mm: [[x0,y0],[x1,y1]],
 *                  quantity: 'R,L', annotation: [lines] }]
 * @returns { text, layout: [{ name, block, insert_mm, bbox_mm }] }
 */
export function writeAstmDxf({ style, pieces }) {
  if (!pieces?.length) throw new Error('no pieces to write');
  name20(style.name, 'Style Name');
  const d = style.created instanceof Date ? style.created : new Date();
  const sst = [
    `Style Name: ${style.name}`,
    `Creation Date: ${pad2(d.getUTCDate())}-${pad2(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`,
    `Creation Time: ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`,
    `Author: ${ascii(style.author, 'Author')};${ascii(style.application, 'Application')};${ascii(style.release, 'Release')}`,
    `Sample Size: ${ascii(style.sampleSize ?? '', 'Sample Size')}`,
    `Grade Rule Table: ${ascii(style.gradeRuleTable ?? '', 'Grade Rule Table')}`,
    'Units: METRIC',
    `ASTM/D13 Proposal 1 Version: ${STANDARD_VERSION}`,
    `Curve Tolerance: ${fmt(style.curveToleranceMm ?? 0.01)}`,
  ];

  const blocks = new Tags();
  const entities = new Tags();
  const layout = [];
  const seen = new Set();
  // style system text at the origin; pieces start to the right of it
  stackedText(entities, ASTM_LAYERS.system_text, 0, 0, SYSTEM_TEXT_HEIGHT_MM, sst);
  let cursorX = 120;

  for (const piece of pieces) {
    name20(piece.name, 'Piece Name');
    const block = blockName(piece.name);
    if (seen.has(block)) throw new Error(`duplicate block name ${block}`);
    seen.add(block);
    const ring = piece.outline_mm;
    if (!ring || ring.length < 3) throw new Error(`${piece.name}: outline needs at least 3 points`);
    const [fx, fy] = ring[0], [lx, ly] = ring[ring.length - 1];
    if (fx === lx && fy === ly) throw new Error(`${piece.name}: outline must not repeat its first point`);
    if (!piece.grain_mm || piece.grain_mm.length !== 2) throw new Error(`${piece.name}: a grain line is required (layer 7)`);
    const bb = bbox(ring);
    // block geometry is local: bbox min at the origin
    const local = ring.map(([x, y]) => [x - bb.minx, y - bb.miny]);
    const grain = piece.grain_mm.map(([x, y]) => [x - bb.minx, y - bb.miny]);
    const turn = new Set(piece.turn_point_indices || []);
    const pst = [
      `Piece Name: ${piece.name}`,
      `Quantity: ${ascii(piece.quantity ?? '1,1', 'Quantity')}`,
    ];

    blocks.add(0, 'BLOCK').add(8, '0').add(2, block).add(70, 0).add(10, '0.00').add(20, '0.00').add(30, '0.00').add(3, block);
    const width = bb.maxx - bb.minx, height = bb.maxy - bb.miny;
    stackedText(blocks, ASTM_LAYERS.system_text, width * 0.5, height + LINE_STEP_MM * (pst.length + 1), SYSTEM_TEXT_HEIGHT_MM, pst);
    blocks.polyline(ASTM_LAYERS.boundary, local, true);
    blocks.polyline(ASTM_LAYERS.boundary_validation, local, true);
    local.forEach(([x, y], i) => blocks.point(turn.has(i) ? ASTM_LAYERS.turn_points : ASTM_LAYERS.curve_points, x, y));
    blocks.line(ASTM_LAYERS.grain_line, grain[0], grain[1]);
    if (piece.annotation?.length) {
      stackedText(blocks, ASTM_LAYERS.annotation, width * 0.05, height * 0.5 + LINE_STEP_MM * piece.annotation.length * 0.5, ANNOTATION_HEIGHT_MM, piece.annotation);
    }
    blocks.add(0, 'ENDBLK').add(8, '0');

    entities.add(0, 'INSERT').add(8, ASTM_LAYERS.boundary).add(2, block).add(10, fmt(cursorX)).add(20, '0.00').add(30, '0.00');
    layout.push({ name: piece.name, block, insert_mm: [Number(fmt(cursorX)), 0], bbox_mm: { width: Number(fmt(width)), height: Number(fmt(height)) } });
    cursorX += width + PIECE_GAP_MM;
  }

  const out = new Tags();
  out.add(999, `ASTM ${STANDARD_VERSION} pattern DXF (R12, Gerber dialect: empty HEADER, no TABLES, no layout blocks)`);
  out.add(0, 'SECTION').add(2, 'HEADER').add(0, 'ENDSEC');
  out.add(0, 'SECTION').add(2, 'BLOCKS');
  out.lines.push(...blocks.lines);
  out.add(0, 'ENDSEC');
  out.add(0, 'SECTION').add(2, 'ENTITIES');
  out.lines.push(...entities.lines);
  out.add(0, 'ENDSEC').add(0, 'EOF');
  const text = out.join();
  // whole-file check: printable ASCII plus the CR/LF line breaks DXF uses
  if (!/^[\x20-\x7E\r\n]*$/.test(text)) throw new Error('DXF text is not 7-bit ASCII');
  return { text, layout, style_system_text: sst };
}
