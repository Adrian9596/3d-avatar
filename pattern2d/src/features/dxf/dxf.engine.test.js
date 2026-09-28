/* Measure Engine · DXF — import, then measure (spec: src/features/measure/measure_engine.md
   §4 A8, A10, A11, §5).

   Every number here was measured by ezdxf (scripts/make_engine_fixtures.py) or is a closed
   form, frozen in tests/fixtures/engine/expected.json with the sha256 of the file it belongs
   to. The path from file to number is the viewer's own: decode → parseDXF → buildModel →
   the Along tool's trackAt → alongPath — so a bug anywhere on it shows up here. */
import {mcase} from "../../../tests/engine.js";
import {expected, modelOf, pieceOf, ALL_ON} from "../../../tests/engine_fixtures.js";
import {parseDXF} from "./parse.js";
import {buildModel} from "./model.js";
import {point, length} from "../geometry/model.js";
import {alongPath} from "../geometry/path.js";
import {straight} from "../geometry/straight.js";
import * as Measure from "../measure/measure.js";

const trackAt = (...a) => Measure.trackAt(...a);
const G = "DXF", PI = Math.PI, P = (x, y) => point(x, y), X = expected;

/* the Along tool, exactly as TD uses it: click on a line, the tool follows it */
function tool(model, block, at){
  const t = trackAt([pieceOf(model, block)], ALL_ON, at);
  if(!t || t.error) throw new Error(t ? t.error : `không bám được đường nào quanh ${at}`);
  return t.chain;
}
const alongOn = (ch, a, b, opts) => alongPath(ch, P(...a), P(...b), opts);
const shapesLen = path => (path.shapes || []).reduce((s, sh) => s + length(sh), 0);

/* ── LINE ───────────────────────────────────────────────────────────────────── */
mcase({id: "DXF-01", group: G, kind: "N", what: "hình chữ nhật 4 LINE (2 cái vẽ ngược): [chu vi, lối ngắn, lối dài, Straight]",
       expect: [X.lines.perimeter, X.lines.short, X.lines.long, X.lines.straight], tol: 1e-9, source: "tay; file lines.dxf"}, () => {
  const ch = tool(modelOf("lines.dxf"), "RECT", X.lines.A);
  return [ch.total, alongOn(ch, X.lines.A, X.lines.B).distance, alongOn(ch, X.lines.A, X.lines.B, {direction: "long"}).distance,
          straight(P(...X.lines.A), P(...X.lines.B)).distance];
});
mcase({id: "DXF-02", group: G, kind: "N", what: "bảng Pieces: [chu vi đường cắt, x0 sau INSERT]", expect: [X.lines.perimeter, X.lines.bbox_x0], tol: 1e-9,
       source: "tay"}, () => { const p = pieceOf(modelOf("lines.dxf"), "RECT"); return [p.cutLen, p.bbox.x0]; });

/* ── ARC · CIRCLE ───────────────────────────────────────────────────────────── */
mcase({id: "DXF-03", group: G, kind: "N", what: "sân vận động LINE + ARC: [kín, chu vi, lối ngắn, lối dài]",
       expect: [true, X.arcs.track_perimeter, X.arcs.track_short, X.arcs.track_long], tol: 1e-9, source: "tay: 400 + 100π"}, () => {
  const ch = tool(modelOf("arcs.dxf"), "TRACK", X.arcs.track_A);
  return [ch.closed, ch.total, alongOn(ch, X.arcs.track_A, X.arcs.track_B).distance,
          alongOn(ch, X.arcs.track_A, X.arcs.track_B, {direction: "long"}).distance];
});
mcase({id: "DXF-04", group: G, kind: "N", what: "bảng Pieces: chu vi đường cắt có ARC", expect: X.arcs.track_perimeter, tol: 1e-9,
       source: "tay"}, () => pieceOf(modelOf("arcs.dxf"), "TRACK").cutLen);
mcase({id: "DXF-05", group: G, kind: "B", what: "ARC extrusion (0,0,−1): [dọc LINE → cuối cung, lệch khỏi đường]",
       expect: [X.arcs.mirror_along, 0], tol: 1e-9, source: "ezdxf OCS → WCS"}, () => {
  const ch = tool(modelOf("arcs.dxf"), "MIRROR", X.arcs.mirror_from);
  const r = alongOn(ch, X.arcs.mirror_from, X.arcs.mirror_end);
  return [r.distance, r.offPath];
});
mcase({id: "DXF-06", group: G, kind: "N", what: "CIRCLE r = 30: [chu vi, lối ngắn qua 0°]", expect: [X.arcs.hole_perimeter, X.arcs.hole_short], tol: 1e-9,
       source: "tay: 60π; 30·20°"}, () => {
  const ch = tool(modelOf("arcs.dxf"), "HOLE", X.arcs.hole_A);
  return [ch.total, alongOn(ch, X.arcs.hole_A, X.arcs.hole_B).distance];
});

/* ── POLYLINE · LWPOLYLINE · bulge ─────────────────────────────────────────── */
mcase({id: "DXF-07", group: G, kind: "B", what: "POLYLINE cũ, cờ kín + lặp đỉnh cuối (kiểu 3380)", expect: X.bulge.old_rect, tol: 1e-9,
       source: "tay: 2·(50 + 30)"}, () => tool(modelOf("bulge.dxf"), "OLDRECT", [925, 0]).total);
mcase({id: "DXF-08", group: G, kind: "N", what: "LWPOLYLINE có bulge 90° + một đoạn thẳng", expect: X.bulge.lw_open, tol: 1e-9,
       source: "ezdxf bulge_to_arc: r·θ + 60"}, () => alongOn(tool(modelOf("bulge.dxf"), "LWBULGE", [0, 0]), [0, 0], [100, 60]).distance);
mcase({id: "DXF-09", group: G, kind: "N", what: "LWPOLYLINE kín bulge = 1 (nửa tròn): [chu vi, lệch tại đỉnh cung]",
       expect: [X.bulge.lw_d, 0], tol: 1e-9, source: "tay: 300 + 50π"}, () => {
  const ch = tool(modelOf("bulge.dxf"), "LWD", [350, 0]);
  return [ch.total, alongOn(ch, [350, 0], X.bulge.d_far_point).offPath];
});
mcase({id: "DXF-10", group: G, kind: "N", what: "POLYLINE cũ có bulge ở VERTEX", expect: X.bulge.old_d, tol: 1e-9,
       source: "tay: 300 + 50π"}, () => tool(modelOf("bulge.dxf"), "OLDD", [650, 0]).total);

/* ── SPLINE ─────────────────────────────────────────────────────────────────── */
const S = X.splines;
mcase({id: "DXF-11", group: G, kind: "N", what: "SPLINE NURBS ¼ đường tròn: dọc đầu → cuối", expect: S.closed_forms.QUARTER, tol: 1e-6,
       source: "tay: 50π (ezdxf: " + S.QUARTER.length.toFixed(6) + ")"}, () =>
  alongOn(tool(modelOf("splines.dxf"), "QUARTER", S.QUARTER.start), S.QUARTER.start, S.QUARTER.end).distance);
mcase({id: "DXF-12", group: G, kind: "N", what: "SPLINE NURBS đường tròn 9 điểm: [kín, chu vi]", expect: [true, S.closed_forms.CIRCLE9], tol: 1e-6,
       source: "tay: 80π"}, () => { const ch = tool(modelOf("splines.dxf"), "CIRCLE9", S.CIRCLE9.start); return [ch.closed, ch.total]; });
mcase({id: "DXF-13", group: G, kind: "N", what: "SPLINE Bezier bậc 3", expect: S.BEZ3.length, tol: 1e-6,
       source: "ezdxf + Gauss–Legendre"}, () => tool(modelOf("splines.dxf"), "BEZ3", S.BEZ3.start).total);
mcase({id: "DXF-14", group: G, kind: "N", what: "SPLINE chuỗi Bezier (knot bội 4)", expect: S.STRING.length, tol: 1e-6,
       source: "ezdxf + Gauss–Legendre"}, () => tool(modelOf("splines.dxf"), "STRING", S.STRING.start).total);
mcase({id: "DXF-15", group: G, kind: "B", what: "SPLINE bậc 1", expect: S.closed_forms.LIN1, tol: 1e-9,
       source: "tay: 100 + 50"}, () => tool(modelOf("splines.dxf"), "LIN1", S.LIN1.start).total);
mcase({id: "DXF-16", group: G, kind: "I", what: "SPLINE chỉ có fit point → [có cảnh báo, không dựng mảnh]", expect: [true, false],
       source: "spec A10"}, () => {
  const m = modelOf("splines.dxf");
  return [(m.warnings || []).some(w => /fit/i.test(w)), !!pieceOf(m, "FITONLY")];
});

/* ── INSERT ─────────────────────────────────────────────────────────────────── */
mcase({id: "DXF-17", group: G, kind: "N", what: "INSERT scale 2 · xoay 90° · base point (10,10): [x0, y0, x1, y1, chu vi, notch x, y]",
       expect: [...X.insert.bbox, X.insert.perimeter, ...X.insert.notch], tol: 1e-9, source: "ezdxf virtual_entities()"}, () => {
  const m = modelOf("insert.dxf"), p = pieceOf(m, "RECT2"), n = p.points.find(q => q.layer === "4");
  const ch = tool(m, "RECT2", X.insert.vertices[0]);
  return [p.bbox.x0, p.bbox.y0, p.bbox.x1, p.bbox.y1, ch.total, n.x, n.y];
});
mcase({id: "DXF-18", group: G, kind: "I", what: "INSERT phóng lệch trục chứa ARC → [có cảnh báo, không dựng cung sai]", expect: [true, false],
       source: "spec A11"}, () => {
  const m = modelOf("insert.dxf"), p = pieceOf(m, "SKEW");
  return [(m.warnings || []).some(w => /lệch trục/.test(w)), !!(p && p.paths.length)];
});

/* ── an open polyline that closes on itself · a broken number ───────────────── */
mcase({id: "DXF-19", group: G, kind: "B", what: "LWPOLYLINE cờ hở, đỉnh cuối = đỉnh đầu: [kín, chu vi, lối ngắn qua mối]",
       expect: [true, X.open_ring.perimeter, X.open_ring.short], tol: 1e-9, source: "spec A4"}, () => {
  const ch = tool(modelOf("open_ring.dxf"), "OPENRING", X.open_ring.A);
  return [ch.closed, ch.total, alongOn(ch, X.open_ring.A, X.open_ring.B).distance];
});
mcase({id: "DXF-20", group: G, kind: "I", what: "số hỏng \"abc\" ở toạ độ: [cảnh báo đúng số dòng, số path còn lại, LINE còn đúng]",
       expect: [true, 1, X.corrupt.line_length], tol: 1e-9, source: "spec A8"}, () => {
  const m = modelOf("corrupt.dxf"), paths = m.pieces.flatMap(p => p.paths);
  return [(m.warnings || []).some(w => w.includes(`dòng ${X.corrupt.bad_line}`)), paths.length,
          paths.length === 1 ? Math.hypot(paths[0].pts[1][0] - paths[0].pts[0][0], paths[0].pts[1][1] - paths[0].pts[0][1]) : -1];
});
mcase({id: "DXF-26", group: G, kind: "I", what: "đường cắt phân nhánh trong DXF → tool báo lỗi, không đo", expect: {throws: /phân nhánh/},
       source: "spec A2"}, () => {
  const txt = [0, "SECTION", 2, "ENTITIES", 0, "TEXT", 8, "0", 10, 0, 20, -50, 40, 3, 1, "Units: METRIC",
    0, "LINE", 8, "1", 10, 0, 20, 0, 11, 100, 21, 0, 0, "LINE", 8, "1", 10, 100, 20, 0, 11, 200, 21, 0,
    0, "LWPOLYLINE", 8, "1", 90, 3, 70, 0, 10, 100, 20, 0, 10, 50, 20, 50, 10, 0, 20, 0,
    0, "ENDSEC", 0, "EOF"].join("\n");
  const m = buildModel(parseDXF(txt));
  return tool(m, m.pieces[0].name, [150, 0]).total;
});

/* ── the real library ───────────────────────────────────────────────────────── */
const L = X.lib;
mcase({id: "DXF-21", group: G, kind: "N", what: "file thật CBXO172001-DES Piece01 (ring vẽ hở): [chu vi, lối ngắn qua mối]",
       expect: () => [L.CBXO.perimeter, L.CBXO.short], tol: 1e-6, source: "ezdxf + vòng lặp Python"}, () => {
  const ch = tool(modelOf("lib:CBXO172001-DES.dxf"), L.CBXO.block, L.CBXO.A);
  return [ch.total, alongOn(ch, L.CBXO.A, L.CBXO.B).distance];
});
mcase({id: "DXF-22", group: G, kind: "N", what: "file thật 2938常规L (toàn SPLINE): [số spline dựng được, tổng chiều dài layer 1]",
       expect: () => [L.S2938.splines, L.S2938.per_layer["1"]], tol: 1e-3, source: "ezdxf + Gauss–Legendre"}, () => {
  const paths = modelOf("lib:2938常规L.dxf").pieces.flatMap(p => p.paths).filter(q => (q.shapes || []).some(s => s.kind === "spline"));
  return [paths.length, paths.filter(q => q.layer === "1").reduce((s, q) => s + shapesLen(q), 0)];
});
mcase({id: "DXF-23", group: G, kind: "N", what: "file thật 2938常规L: spline đầu tiên của layer 1", expect: () => L.S2938.first["1"].length, tol: 1e-6,
       source: "ezdxf + Gauss–Legendre"}, () => {
  const q = modelOf("lib:2938常规L.dxf").pieces.flatMap(p => p.paths).find(q => q.layer === "1" && (q.shapes || []).some(s => s.kind === "spline"));
  return shapesLen(q);
});
mcase({id: "DXF-24", group: G, kind: "N", what: "file thật DM1195 (inch): bề rộng đường cắt wing theo mm", expect: () => L.DM1195.w_mm, tol: 1e-6,
       source: "ezdxf × 25.4"}, () => {
  const p = pieceOf(modelOf("lib:DM1195--STRIKE COST-VER C.dxf"), L.DM1195.block);
  const ring = p.paths.filter(q => q.layer === "1" && q.closed).sort((a, b) => b.pts.length - a.pts.length)[0];
  let lo = Infinity, hi = -Infinity;
  for(const [x] of ring.pts){ lo = Math.min(lo, x); hi = Math.max(hi, x); }
  return hi - lo;
});
mcase({id: "DXF-25", group: G, kind: "N", what: "file thật 2875 LiftyChic: CIRCLE (inch) → chu vi mm", expect: () => L.LIFTY.length_mm, tol: 1e-6,
       source: "ezdxf: 2πr × 25.4"}, () => {
  const p = pieceOf(modelOf("lib:2875_ LiftyChic_Crossian.dxf"), L.LIFTY.block);
  const circle = p.paths.find(q => (q.shapes || []).some(s => s.kind === "arc"));
  return shapesLen(circle);
});
