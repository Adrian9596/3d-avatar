/* Display unit — across the whole viewer (spec: src/shared/units.md §2 U4, U6–U9).

   Every feature that shows or takes a length is asked for its numbers in inch, cm and mm,
   on a real factory piece (DM1195, a file drawn in inches). Three things must hold:
     · display only — the geometry and every measured millimetre are bit-identical after all
       the switching (the fingerprint is plain JSON of the model, taken by the test);
     · one unit — every string carries the chosen unit and never another one;
     · no guess — a file that declares no unit shows drawing units ("đv?") whatever is chosen.
   Expected strings are the definitions (÷25.4, ÷10) at the precision the spec fixes. */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {mcase} from "../../../tests/engine.js";
import {expected, modelOf, pieceOf, ALL_ON} from "../../../tests/engine_fixtures.js";
import {point, curve} from "../geometry/model.js";
import {straight} from "../geometry/straight.js";
import {alongPath} from "../geometry/path.js";
import {createDoc} from "../geometry/doc.js";
import {simplify, validateSimplify, detect} from "../geometry/simplify.js";
import * as Measure from "./measure.js";
import * as PiecesM from "../pieces/pieces.js";
import * as EdgesM from "../edges/edges.js";
import * as ArrangeM from "../arrange/arrange.js";
import * as GeometryM from "../geometry/geometry.js";
import * as SimplifyM from "../simplify/simplify.js";
import * as ExportM from "../export/export.js";
const U = await import("../../shared/units.js").catch(e => { if(e.code === "ERR_MODULE_NOT_FOUND") return {}; throw e; });

const G = "Units", UNITS = ["inch", "cm", "mm"], LABEL = {inch: "in", cm: "cm", mm: "mm"};
const LIB = expected.lib;
const wingModel = () => modelOf("lib:DM1195--STRIKE COST-VER C.dxf");

/* everything the geometry is, as plain JSON — taken by the test, not by the viewer */
const fingerprint = m => JSON.stringify(m.pieces.map(p => ({paths: p.paths.map(q => [q.layer, q.closed, q.pts, q.shapes, q.snap]),
  points: p.points, bbox: p.bbox, cut: p.cut, sew: p.sew, cutLen: p.cutLen, sewLen: p.sewLen, ox: p.ox, oy: p.oy})));

/* every length-bearing output of every feature, for one formatter */
function outputs(m, p, L, unit){
  const ring = p.paths.filter(q => q.layer === "1" && q.closed).sort((a, b) => b.pts.length - a.pts.length)[0];
  const A = ring.pts[0], B = ring.pts[Math.floor(ring.pts.length/3)];
  const t = Measure.trackAt([p], ALL_ON, A);
  const sr = straight(point(...A), point(...B)), ar = alongPath(t.chain, point(...A), point(...B));
  const doc = createDoc(), cut = doc.add(curve(p.cut, true));
  doc.derive("offset", [cut], {d: 6, side: "in"}); doc.derive("perpendicular", [cut], {t: 0.3, len: 6, side: "out"});
  doc.solve();
  const keep = SimplifyM.marksOf(p), tol = 0.1;
  const s = simplify(p.cut, {closed: true, tol, keep});
  const c = {r: s, v: validateSimplify(p.cut, s.pts, {closed: true, tol, keep}), d: detect(p.cut, {closed: true, tol})};
  return {
    straight: Measure.straightReadout(sr, [false, false], L), along: Measure.alongReadout(ar, L),
    piece: PiecesM.pieceRows(p, L), caption: PiecesM.pieceCaption(p, 0, L),
    edges: EdgesM.edgeReadout(p, L), group: ArrangeM.groupRows(m.pieces.slice(0, 3), L),
    selection: ArrangeM.selectionText(m.pieces.slice(0, 3), L), simplify: SimplifyM.simplifyRows(c, L),
    relations: doc.relations(L).map(r => r.text), tsv: ExportM.tsv(m.pieces.slice(0, 2), unit),
    cursor: U.formatPoint(A, unit), scale: U.niceScale(2.43, unit).label, rate: U.pxPer(2.43, unit)
  };
}

mcase({id: "UNIT-30", group: G, kind: "N", what: "display only: đổi in → cm → mm → in… trên file thật — [hình học y nguyên, Straight (mm) y nguyên, Along (mm) y nguyên]",
       expect: [true, true, true], source: "requirement 3; vân tay JSON do test tự lấy"}, () => {
  const m = wingModel(), p = pieceOf(m, LIB.DM1195.block);
  const ring = p.paths.filter(q => q.layer === "1" && q.closed).sort((a, b) => b.pts.length - a.pts.length)[0];
  const A = ring.pts[0], B = ring.pts[Math.floor(ring.pts.length/3)];
  const measureNow = () => [straight(point(...A), point(...B)).distance,
                            alongPath(Measure.trackAt([p], ALL_ON, A).chain, point(...A), point(...B)).distance];
  const before = fingerprint(m), [s0, a0] = measureNow();
  for(const u of ["inch", "cm", "mm", "inch", "mm", "cm", "inch"]) outputs(m, p, U.lengthFormatter(u), u);
  const [s1, a1] = measureNow();
  return [fingerprint(m) === before, Object.is(s1, s0), Object.is(a1, a0)];
});

mcase({id: "UNIT-31", group: G, kind: "N", what: "global: mọi chuỗi độ dài của mọi feature mang đúng đơn vị đang chọn — [in có, lẫn khác] × in · cm · mm",
       expect: [true, false, true, false, true, false], source: "requirement 4"}, () => {
  const m = wingModel(), p = pieceOf(m, LIB.DM1195.block);
  return UNITS.flatMap(u => {
    const text = JSON.stringify(outputs(m, p, U.lengthFormatter(u), u));
    const others = UNITS.filter(v => v !== u).map(v => LABEL[v]).join("|");
    return [new RegExp(`\\b${LABEL[u]}\\b`).test(text), new RegExp(`\\b(${others})\\b`).test(text)];
  });
});

/* a UI module that writes "mm" or "cm" into its own strings has a second unit of its own */
const UI = ["measure/measure.js", "pieces/pieces.js", "edges/edges.js", "arrange/arrange.js", "geometry/geometry.js",
            "simplify/simplify.js", "canvas/canvas.js", "export/export.js", "readout/readout.js"];
mcase({id: "UNIT-32", group: G, kind: "B", what: "global: không module giao diện nào tự viết chữ mm/cm vào chuỗi hiển thị",
       expect: "", source: "requirement 4; quét mã nguồn"}, () => UI.flatMap(f => {
  const src = readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  const lits = src.match(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g) || [];
  return lits.filter(s => /\b(mm|cm)\b/.test(s)).map(s => `${f}: ${s.slice(0, 40)}`);
}).join("; "));

mcase({id: "UNIT-33", group: G, kind: "N", what: "input số: Gap 10 mm · Đường may 6 mm · Tolerance 0.1 mm hiện ở in; gõ 3/8 vào Gap rồi xem ở mm, cm",
       expect: ["0.394", "0.236", "0.0039", 9.525, "9.5", "0.95"], tol: 1e-9, source: "tay: ÷25.4; 3/8 × 25.4"}, () => {
  const gap = U.lengthField(ArrangeM.GAP_FIELD), sa = U.lengthField(GeometryM.SA_FIELD), tol = U.lengthField(SimplifyM.TOL_FIELD);
  const shown = [gap.text("inch"), sa.text("inch"), tol.text("inch")];
  gap.read("3/8", "inch");
  return [...shown, gap.mm, gap.text("mm"), gap.text("cm")];
});

mcase({id: "UNIT-34", group: G, kind: "N", what: "snap: cùng chỗ bấm → cùng điểm bắt ở mọi đơn vị; \"Lệch\" và toạ độ con trỏ theo đơn vị",
       expect: [true, "0.0051 in", "0.013 cm", "0.13 mm", "0.500 , -1.000 in", "1.27 , -2.54 cm", "12.7 , -25.4 mm"],
       source: "spec D1; tay: 0.13 ÷ 25.4, 12.7 ÷ 25.4"}, () => {
  const pc = {name: "r", ox: 0, oy: 0, points: [{layer: "4", x: 30, y: 0}], texts: [],
              paths: [{layer: "1", closed: true, pts: [[0, 0], [100, 0], [100, 50], [0, 50]]}]};
  const hits = UNITS.map(() => Measure.snapAt([pc], ALL_ON, [31, 1], 12/2.43).point.join(","));
  const t = Measure.trackAt([pc], ALL_ON, [50, -0.13]);
  const r = alongPath(t.chain, point(50, -0.13), point(100, 25));
  const lech = u => Measure.alongReadout(r, U.lengthFormatter(u)).rows.find(x => x[0] === "Lệch")[1];
  return [hits.every(h => h === hits[0]), ...UNITS.map(lech), ...UNITS.map(u => U.formatPoint([12.7, -25.4], u))];
});

mcase({id: "UNIT-35", group: G, kind: "B", what: "file không khai đơn vị: chọn in · cm · mm đều hiện \"đv?\", không quy đổi — [có đv?, lẫn đơn vị] × 3",
       expect: [true, false, true, false, true, false], source: "spec U9"}, () => {
  const m = modelOf("units_none.dxf"), p = pieceOf(m, "R");
  return UNITS.flatMap(u => {
    const shown = U.shownUnit(m.units, u);
    const text = JSON.stringify(outputs(m, p, U.lengthFormatter(shown), shown));
    return [text.includes("đv?"), /\b(in|cm|mm)\b/.test(text)];
  });
});

mcase({id: "UNIT-36", group: G, kind: "I", what: "input số: gõ \"abc\", \"-5\", \"1e9\" vào Gap → từ chối, giữ 10 mm — [ok, mm] × 3",
       expect: [false, 10, false, 10, false, 10], tol: 0, source: "spec U6"}, () => {
  const gap = U.lengthField(ArrangeM.GAP_FIELD);
  return [["abc", "inch"], ["-5", "mm"], ["1e9", "mm"]].flatMap(([t, u]) => { const r = gap.read(t, u); return [r.ok, gap.mm]; });
});

mcase({id: "UNIT-37", group: G, kind: "N", what: "Copy (TSV) ở inch: tiêu đề ghi đơn vị, số ÷ 25.4 tới 0.001",
       expect: ["Piece\tQty\tMaterial\tWidth (in)\tHeight (in)\tCut (in)\tSew (in)\tX (in)\tY (in)",
                "cradle_M\t1\tpower mesh\t8.291\t4.031\t27.339\t26.945\t0.486\t-0.220"], source: "spec D2; tay: ÷ 25.4"}, () => {
  const p = {blockName: "cradle_M", qty: "1", category: "power mesh", cutLen: 694.4, sewLen: 684.4,
             bbox: {x0: 12.34, y0: -5.6, x1: 222.94, y1: 96.8, w: 210.6, h: 102.4}};
  return ExportM.tsv([p], "inch").split("\n");
});
