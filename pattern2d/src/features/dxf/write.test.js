/* Writing a DXF back out (spec: edit/edit.md §6, X1–X9).

   The expected side of a round trip is the model the file was read into: what goes out and
   comes back must be what went out, to 0.000001 mm. Arcs have an independent yardstick — a
   point is on a circle when its distance to the centre is the radius — and the inch file has
   one too: 4" × 2" is 101.6 × 50.8 mm by definition. ezdxf reads the same files in
   scripts/check_edit.py, so the round trip is not only our own reader agreeing with itself. */
import {block36Text} from "../../../tests/data.js";
import {test, eq, near, ok} from "../../../tests/harness.js";
import {dxfOf, modelOf} from "../../../tests/engine_fixtures.js";
import {parseDXF} from "./parse.js";
import {buildModel} from "./model.js";
import {writeDXF, exportName} from "./write.js";
import {translatePiece} from "../arrange/ops.js";
import {curve} from "../geometry/model.js";
import {spline} from "../geometry/spline.js";

const DATE = new Date(Date.UTC(2026, 8, 23, 3, 4, 5));
const reread = text => buildModel(parseDXF(text));
const block36 = () => buildModel(parseDXF(block36Text()));

/* every path, point and text of two models, piece by piece, within tol */
function sameModel(a, b, tol, what){
  eq(b.pieces.length, a.pieces.length, `${what}: pieces`);
  a.pieces.forEach((p, i) => {
    const q = b.pieces[i], at = `${what} · ${p.blockName || p.name}`;
    eq(q.name, p.name, `${at}: name`); eq(q.qty, p.qty, `${at}: qty`); eq(q.category, p.category, `${at}: category`);
    eq(q.paths.length, p.paths.length, `${at}: paths`);
    p.paths.forEach((path, j) => {
      const r = q.paths[j];
      eq(r.layer, path.layer, `${at} path ${j}: layer`); eq(r.closed, path.closed, `${at} path ${j}: closed`);
      eq(r.pts.length, path.pts.length, `${at} path ${j}: vertices`);
      path.pts.forEach((v, k) => { near(r.pts[k][0], v[0], tol); near(r.pts[k][1], v[1], tol, `${at} path ${j} v${k}`); });
    });
    eq(q.points.length, p.points.length, `${at}: points`);
    p.points.forEach((v, k) => { eq(q.points[k].layer, v.layer); near(q.points[k].x, v.x, tol); near(q.points[k].y, v.y, tol, `${at} point ${k}`); });
    eq(q.texts.length, p.texts.length, `${at}: texts`);
    p.texts.forEach((t, k) => { eq(q.texts[k].text, t.text, `${at} text ${k}`); eq(q.texts[k].layer, t.layer); near(q.texts[k].h, t.h, tol); });
  });
}

test("X1 the export name is never the source name", () => {
  eq(exportName("BLOCK_36C.dxf"), "BLOCK_36C_edit.dxf");
  eq(exportName("3380泳布-7.8.DXF"), "3380泳布-7.8_edit.dxf");
  eq(exportName("x_edit.dxf"), "x_edit_edit.dxf");
  eq(exportName(""), "untitled_edit.dxf");
});

test("X2 AAMA structure: empty HEADER · one BLOCK per piece with its name · INSERT at 0,0 · EOF", () => {
  const m = block36(), {text} = writeDXF(m, {source: "BLOCK_36C.dxf", date: DATE});
  const lines = text.split("\n");
  eq(lines.slice(0, 6).join("|"), "0|SECTION|2|HEADER|0|ENDSEC");
  eq(lines[lines.length - 2], "EOF");
  const d = parseDXF(text);
  eq(Object.keys(d.blocks).join(","), m.pieces.map(p => p.blockName).join(","));
  const ins = d.entities.filter(e => e.type === "INSERT");
  eq(ins.length, m.pieces.length);
  ok(ins.every(e => (e.x || 0) === 0 && (e.y || 0) === 0), "every INSERT at the origin");
});

test("X6 no edit: read back, the model is the model — BLOCK_36C to 0.000001 mm", () => {
  const m = block36();
  sameModel(m, reread(writeDXF(m, {source: "BLOCK_36C.dxf", date: DATE}).text), 1e-6, "BLOCK_36C");
});

test("X4 the header keeps its lines, Units says METRIC, and an EDITED line names the source", () => {
  const m = block36(), back = reread(writeDXF(m, {source: "BLOCK_36C.dxf", date: DATE}).text);
  for(const k of Object.keys(m.header)) if(k.toLowerCase() !== "units") eq(back.header[k], m.header[k], `header ${k}`);
  eq(back.header.Units, "METRIC");
  ok(/BLOCK_36C\.dxf/.test(back.header.EDITED || ""), `EDITED: ${back.header.EDITED}`);
  eq(back.units.unit, "mm");
});

test("X3 an inch file goes out METRIC: the 4\" × 2\" piece reads back 101.6 × 50.8 mm", () => {
  const m = modelOf("units_english.dxf");
  eq(m.units.unit, "inch");
  const back = reread(writeDXF(m, {source: "units_english.dxf", date: DATE}).text);
  eq(back.units.unit, "mm", "Units: METRIC in the file");
  eq(back.units.source, "AAMA");
  const b = back.pieces[0].bbox;
  near(b.w, 101.6, 1e-6); near(b.h, 50.8, 1e-6);
  sameModel(m, back, 1e-6, "units_english");
});

test("X5 arcs go out as polylines within 0.01 mm of the circle, and the count is reported", () => {
  const m = modelOf("arcs.dxf"), out = writeDXF(m, {source: "arcs.dxf", date: DATE});
  ok(out.stats.sampled > 0, `sampled ${out.stats.sampled}`);
  const back = reread(out.text);
  let worst = 0, checked = 0;
  m.pieces.forEach((p, i) => p.paths.forEach((path, j) => {
    if(path.shapes.length !== 1 || path.shapes[0].kind !== "arc") return;
    const a = path.shapes[0];                  // an ARC or CIRCLE entity: its vertices must sit on its circle
    for(const v of back.pieces[i].paths[j].pts){ worst = Math.max(worst, Math.abs(Math.hypot(v[0] - a.c.x, v[1] - a.c.y) - a.r)); checked++; }
  }));
  ok(checked > 20, `checked ${checked} vertices`);
  ok(worst <= 0.01, `worst ${worst} mm off the circle`);
});

test("X5 splines go out as polylines and still measure their length", () => {
  const m = modelOf("splines.dxf"), out = writeDXF(m, {source: "splines.dxf", date: DATE});
  ok(out.stats.sampled > 0);
  const back = reread(out.text);
  eq(back.pieces.length, m.pieces.length);
  back.pieces.forEach((p, i) => near(p.cutLen, m.pieces[i].cutLen, 0.01, `${p.name}: cut length`));
});

test("X8 a file that declares no unit is not written — METRIC would be a guess", () => {
  let err = null;
  try{ writeDXF(modelOf("units_none.dxf"), {date: DATE}); }catch(e){ err = e; }
  ok(err && /đơn vị/.test(err.message), err && err.message);
  const chosen = writeDXF(modelOf("units_none.dxf", {unit: "mm"}), {date: DATE});
  ok(/Units: METRIC/.test(chosen.text), "once TD picks the file unit, it goes out");
});

test("X9 an Arrange layout is not written: pieces go out where the file had them", () => {
  const m = block36(), ref = block36();
  translatePiece(m.pieces[0], 40, -25); translatePiece(m.pieces[2], -7.5, 3);
  sameModel(ref, reread(writeDXF(m, {date: DATE}).text), 1e-6, "arranged");
});

test("X2 two INSERTs of one block become two blocks with their own names", () => {
  const m = modelOf("insert.dxf");
  const names = m.pieces.map(p => p.blockName);
  const out = writeDXF(m, {date: DATE}), d = parseDXF(out.text);
  eq(Object.keys(d.blocks).length, m.pieces.length, "one block per piece");
  if(new Set(names).size < names.length) ok(out.stats.renamed.length > 0, "the repeated name was changed and reported");
  sameModel(m, reread(out.text), 1e-6, "insert");
});

test("X10 a path of length 0 still goes out: a SPLINE on one spot, a ring of one vertex after a move — read back, none is missing", () => {
  /* 2938常规L carries two splines that sit on one spot; MHG568 draws drill marks as one-vertex rings.
     Written as a POLYLINE of ONE vertex they vanish on the way back (a polyline needs two) */
  const m = block36(), p = m.pieces[0];
  const q = [p.bbox.x0 + 20, p.bbox.y0 + 20];
  p.paths.push({layer: "8", closed: false, pts: [q.slice(), q.slice()], snap: [q.slice(), q.slice()],
                shapes: [spline({degree: 3, knots: [0, 0, 0, 0, 1, 1, 1, 1], ctrl: [q, q, q, q]})]});
  p.paths.push({layer: "85", closed: true, pts: [[q[0] + 5, q[1]]], snap: [[q[0] + 5, q[1]]], shapes: [curve([[q[0] + 5, q[1]], [q[0] + 5, q[1]]], true)]});
  const n = p.paths.length;
  const back = reread(writeDXF(m, {date: DATE}).text).pieces[0];
  eq(back.paths.length, n, "every path came back");
  near(back.paths[n - 2].pts[0][0], q[0], 1e-6); near(back.paths[n - 1].pts[0][0], q[0] + 5, 1e-6, "where they were");
});

test("X6 numbers: no exponent, no −0, six decimals at most", () => {
  const m = block36();
  translatePiece(m.pieces[0], 1e-9, -1e-9);
  const {text} = writeDXF(m, {date: DATE});
  ok(!/e[+-]?\d/i.test(text.split("\n").filter((l, i, a) => /^(10|20|11|21|40)$/.test(a[i - 1] || "")).join(" ")), "no exponent in a coordinate");
  ok(!/\n-0\n/.test(text), "no −0");
  ok(!/\n-?\d+\.\d{7,}\n/.test(text), "at most six decimals");
});

/* A drawing without blocks is one piece — its modelspace (2938常规L, 2938#齐码, 2999, 3004: 4 library files). Found 2026-09-24
   while writing the piece delete: the file was written from the LOOSE entities the piece shared its arrays with, and an Edit
   undone (restorePiece puts copies in the piece) left the file writing the edit that had been undone */
test("X6 a drawing without blocks goes out as its piece is now — an edit undone goes out undone", () => {
  const LOOSE = ["0", "SECTION", "2", "ENTITIES",
    "0", "LINE", "8", "1", "10", "0", "20", "0", "11", "100", "21", "0",
    "0", "LINE", "8", "1", "10", "100", "20", "0", "11", "100", "21", "50",
    "0", "TEXT", "8", "1", "10", "0", "20", "-20", "40", "5", "1", "Units: METRIC",
    "0", "ENDSEC", "0", "EOF"].join("\n");
  const m = reread(LOOSE), p = m.pieces[0], before = writeDXF(m, {date: DATE}).text;
  const kept = p.paths;
  p.paths = kept.map(q => ({...q, pts: q.pts.map(v => [v[0] + 7, v[1]])}));   // an edit, by copies — as Edit's undo puts them
  p.paths[0].shapes = [curve(p.paths[0].pts, false)];
  p.paths[1].shapes = [curve(p.paths[1].pts, false)];
  const moved = reread(writeDXF(m, {date: DATE}).text).pieces[0];
  near(moved.paths[0].pts[0][0], 7, 1e-9, "the file has the piece as it is now: moved 7 mm");
  p.paths = kept;                                                                // and undone
  eq(writeDXF(m, {date: DATE}).text, before, "undone: the file as before");
});
