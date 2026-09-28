/* Layers 2 and 3 — Direct Edit and Precise Edit on a piece (spec: edit/edit.md §3–§4).

   Pieces built by hand (tests/edit_fixtures.js: the rectangle and the arc-topped piece),
   so every expected number is a construction: a bottom edge set to 150 mm
   runs from (0,0) to (150,0); a grainline set to 45° points at 45°; a split changes neither
   perimeter nor area, both summed with plain loops here. */
import {rectPiece, testPiece, lineP, poly} from "../../../tests/edit_fixtures.js";
import {blocks} from "../../../tests/fixture3380.js";
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {curve, line, point, arc, sample} from "../geometry/model.js";
import {lengthField} from "../../shared/units.js";
import {summarize} from "../dxf/model.js";
import {vertsOf, edgesOf, pickAt} from "./select.js";
import {snapPiece, restorePiece, beginEdit, driveEdit, applyMove, applyLength, applyAngle, edgePts,
        trimLine, extendLine, splitAt, joinEdges, holdBoundary, boundaryShapes, deleteItems, stepPieces} from "./ops.js";

const ALL = new Proxy({}, {get: () => true});
const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const plen = pts => pts.slice(1).reduce((s, q, i) => s + hyp(pts[i], q), 0);
const perimeter = pts => plen(pts.concat([pts[0]]));
const area = pts => Math.abs(pts.reduce((s, q, i) => { const r = pts[(i + 1) % pts.length]; return s + q[0]*r[1] - r[0]*q[1]; }, 0))/2;
const geom = p => JSON.stringify([p.paths.map(q => [q.layer, q.closed, q.pts]), p.points]);
const edgeOf = (p, i, a, b, click) => ({...edgesOf(p.paths[i]).find(e => e.a === a && e.b === b), path: i, pi: 0, click});

test("P1 Length on a Line: the bottom set to 150 mm — its far end slides, the right side stays straight", () => {
  const p = rectPiece(), e = edgeOf(p, 0, 0, 1, [90, -1]);          // clicked near (100,0): that end moves
  applyLength(p, e, 150);
  const v = vertsOf(p.paths[0]);
  deepEq(v[0], [0, 0], "the fixed end did not move");
  near(v[1][0], 150, 1e-9); near(v[1][1], 0, 1e-9);
  near(hyp(v[0], v[1]), 150, 1e-9);
  deepEq(v[2], [100, 60], "the far corner of the right side stayed");
});

test("P1 Length on a Curve: the arc-topped piece's top set to 120 mm comes out 120 mm long", () => {
  const p = testPiece(), e = edgeOf(p, 0, 2, 22, [2, 61]);          // clicked near (0,60): that end moves
  const fixed = vertsOf(p.paths[0])[2].slice();                     // (99.99999999999997, 60): cos/atan2 of the construction
  applyLength(p, e, 120);
  near(plen(edgePts(p, e).pts), 120, 1e-9);
  deepEq(vertsOf(p.paths[0])[2], fixed, "the fixed end did not move a bit");
});

test("P2 Angle: the grainline turned to 45° about its fixed end, length unchanged", () => {
  const p = rectPiece({grain: "inside"}), e = edgeOf(p, 2, 0, 1, [50, 44]);   // (50,45) moves, (50,15) stays
  applyAngle(p, e, 45);
  const [a, b] = vertsOf(p.paths[2]);
  deepEq(a, [50, 15]);
  near(Math.atan2(b[1] - a[1], b[0] - a[0])*180/Math.PI, 45, 1e-9);
  near(hyp(a, b), 30, 1e-9);
});

test("P3 Distance + Angle: a free point moved 10 mm at 30°, a whole piece 25 mm straight up", () => {
  const p = rectPiece();
  applyMove(p, [{kind: "point", src: "entity", pt: 1, pi: 0}], [10*Math.cos(Math.PI/6), 10*Math.sin(Math.PI/6)]);
  near(p.points[1].x, 20 + 10*Math.cos(Math.PI/6), 1e-12); near(p.points[1].y, 35, 1e-12);
  const q = rectPiece(), before = JSON.parse(geom(q));
  applyMove(q, [{kind: "piece", pi: 0}], [0, 25]);
  q.paths.forEach((path, i) => path.pts.forEach((v, k) => { near(v[0], before[0][i][2][k][0], 1e-9); near(v[1], before[0][i][2][k][1] + 25, 1e-9); }));
  q.points.forEach((pt, j) => near(pt.y, before[1][j].y + 25, 1e-9));
});

test("P4 typing the length = dragging the corner to the same place: one geometry", () => {
  const a = rectPiece(), b = rectPiece(), e = edgeOf(a, 0, 0, 1, [90, -1]);
  applyLength(a, e, 137.5);
  const g = beginEdit(b, [{kind: "point", src: "vertex", path: 0, v: 1, pi: 0}]);
  driveEdit(g, [37.5, 0]);
  eq(geom(a), geom(b));
});

test("P5 a number typed in inch goes in as millimetres: 5 in = 127 mm", () => {
  const f = lengthField({mm: 100, min: 0.001}), r = f.read("5", "inch");
  ok(r.ok);
  const p = rectPiece(); applyLength(p, edgeOf(p, 0, 0, 1, [90, -1]), r.mm);
  near(hyp(...vertsOf(p.paths[0]).slice(0, 2)), 127, 1e-9);
});

test("P6 a length of 0, −5 or NaN, an angle of NaN: refused, the piece unchanged", () => {
  const p = rectPiece(), before = geom(p), e = edgeOf(p, 0, 0, 1, [90, -1]);
  for(const L of [0, -5, NaN]){ let err = null; try{ applyLength(p, e, L); }catch(x){ err = x; } ok(err, `L = ${L}`); }
  let err = null; try{ applyAngle(p, e, NaN); }catch(x){ err = x; } ok(err, "angle NaN");
  eq(geom(p), before);
});

test("P1 Length on the seam line is refused: it follows the cut line", () => {
  const p = rectPiece(), e = edgeOf(p, 1, 0, 1, [90, 5]);
  let err = null; try{ applyLength(p, e, 50); }catch(x){ err = x; }
  ok(err && /đường cắt/.test(err.message), err && err.message);
});

test("kéo: a notch dragged off its edge slides along it instead", () => {
  const p = rectPiece(), g = beginEdit(p, [{kind: "point", src: "entity", pt: 0, pi: 0}]);
  driveEdit(g, [10, 3]);
  near(p.points[0].x, 40, 1e-9); near(p.points[0].y, 0, 1e-9);
});

test("kéo: a seam corner dragged changes the allowance there, and nothing else", () => {
  const p = rectPiece(), cut = geom({paths: [p.paths[0]], points: []}), g = beginEdit(p, [{kind: "point", src: "vertex", path: 1, v: 0, pi: 0}]);
  driveEdit(g, [-3, 0]);
  near(vertsOf(p.paths[1])[0][0], 3, 1e-9); near(vertsOf(p.paths[1])[0][1], 6, 1e-9);
  eq(geom({paths: [p.paths[0]], points: []}), cut, "the cut line is not touched");
});

test("move: dragging the selected bottom edge 5 mm down moves it; the sides follow; the top stays", () => {
  const p = rectPiece(), g = beginEdit(p, [edgeOf(p, 0, 0, 1, [50, 0])]);
  driveEdit(g, [0, -5]);
  deepEq(vertsOf(p.paths[0]), [[0, -5], [100, -5], [100, 60], [0, 60]]);
  near(p.points[0].y, -5, 1e-9, "the notch on it went too");
});

test("move: a drag replays from where it began — two drives land where the last one says", () => {
  const p = rectPiece(), q = rectPiece(), g = beginEdit(p, [edgeOf(p, 0, 0, 1, [50, 0])]);
  driveEdit(g, [0, -50]); driveEdit(g, [0, -5]);
  applyMove(q, [edgeOf(q, 0, 0, 1, [50, 0])], [0, -5]);
  eq(geom(p), geom(q));
});

test("D4 split an open line: two lines meeting at the split point, 15 + 15 mm", () => {
  const p = rectPiece({grain: "inside"}), r = splitAt(p, edgeOf(p, 2, 0, 1, [50, 30]), [50, 30]);
  ok(r.ok, r.message);
  eq(p.paths.length, 4);
  deepEq(vertsOf(p.paths[2]), [[50, 15], [50, 30]]); deepEq(vertsOf(p.paths[3]), [[50, 30], [50, 45]]);
  eq(p.paths[3].layer, "7");
});

test("D4 split a ring edge: a new corner, the bottom is now two edges, perimeter and area unchanged", () => {
  const p = rectPiece(), P0 = perimeter(vertsOf(p.paths[0])), A0 = area(vertsOf(p.paths[0]));
  const r = splitAt(p, edgeOf(p, 0, 0, 1, [70, 0]), [70, 0]);
  ok(r.ok, r.message);
  const v = vertsOf(p.paths[0]);
  eq(v.length, 5); near(perimeter(v), P0, 1e-9); near(area(v), A0, 1e-9);
  deepEq(edgesOf(p.paths[0]).map(e => [e.a, e.b]), [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]);
  near(p.points[0].x, 30, 0, "the notch did not move");
});

test("D4 join the two halves back: one edge again, still the same shape", () => {
  const p = rectPiece();
  splitAt(p, edgeOf(p, 0, 0, 1, [70, 0]), [70, 0]);
  const before = JSON.stringify(vertsOf(p.paths[0]));
  const r = joinEdges(p, edgeOf(p, 0, 0, 1, [30, 0]), edgeOf(p, 0, 1, 2, [80, 0]), 0.5);
  ok(r.ok, r.message);
  deepEq(edgesOf(p.paths[0]).map(e => [e.a, e.b]), [[0, 2], [2, 3], [3, 4], [4, 0]]);
  eq(JSON.stringify(vertsOf(p.paths[0])), before);
});

test("D4 join two open lines that touch: collinear LINEs → one LINE; at an angle → one polyline", () => {
  const p = rectPiece({grain: null});
  p.paths.push(lineP("0", [0, 30], [50, 30]), lineP("0", [100, 30], [50, 30]), lineP("0", [50, 30], [50, 50]));
  summarize(p);
  const r = joinEdges(p, edgeOf(p, 2, 0, 1, [20, 30]), edgeOf(p, 3, 0, 1, [80, 30]), 0.5);
  ok(r.ok, r.message);
  eq(p.paths[2].shapes[0].kind, "line"); deepEq(vertsOf(p.paths[2]), [[0, 30], [100, 30]]);
  eq(p.paths.length, 4, "the second line is gone into the first");
  const r2 = joinEdges(p, edgeOf(p, 2, 0, 1, [20, 30]), edgeOf(p, 3, 0, 1, [50, 40]), 0.5);
  ok(!r2.ok, "(0,30)–(100,30) and (50,30)–(50,50) touch in the middle, not end to end");
});

test("D4/D6 join: ends further apart than the tolerance are not joined", () => {
  const p = rectPiece({grain: null});
  p.paths.push(lineP("0", [0, 30], [50, 30]), lineP("0", [51, 30], [100, 30]));
  summarize(p);
  const r = joinEdges(p, edgeOf(p, 2, 0, 1, [20, 30]), edgeOf(p, 3, 0, 1, [80, 30]), 0.5);
  ok(!r.ok && /chạm/.test(r.message), r.message);
});

test("D5 trim: an inner line crossing the grainline loses the part clicked on", () => {
  const p = rectPiece({grain: "touch"});
  p.paths.push(lineP("0", [10, 30], [90, 30])); summarize(p);
  const r = trimLine(p, 3, [p.paths[2].shapes[0]], [80, 30]);
  ok(r.ok, r.message);
  deepEq(vertsOf(p.paths[3]), [[10, 30], [50, 30]]);
});

test("D5/D6 trim: a closed line is refused; nothing to cut is refused", () => {
  const p = rectPiece(), before = geom(p);
  const a = trimLine(p, 0, [p.paths[2].shapes[0]], [50, 0]);
  ok(!a.ok && /kín/.test(a.message), a.message);
  p.paths.push(lineP("0", [10, 70], [90, 70])); summarize(p);
  const b = trimLine(p, 3, [p.paths[2].shapes[0]], [80, 70]);
  ok(!b.ok && /giao/.test(b.message), b.message);
});

test("D5 extend: an inner line reaches the grainline from the end clicked", () => {
  const p = rectPiece({grain: "touch"});
  p.paths.push(lineP("0", [10, 30], [40, 30])); summarize(p);
  const r = extendLine(p, 3, [p.paths[2].shapes[0]], [38, 30]);
  ok(r.ok, r.message);
  deepEq(vertsOf(p.paths[3]), [[10, 30], [50, 30]]);
  const r2 = extendLine(p, 3, [p.paths[2].shapes[0]], [11, 30]);
  ok(!r2.ok && /chạm/.test(r2.message), "from the other end there is nothing to reach: " + r2.message);
});

test("C5 a whole piece dragged: its outline, cut and sewing lengths are the ones it had — moved, never re-measured to other digits", () => {
  /* a move changes no length: the readout's Cut line must not flicker in its last digit while TD
     drags. Expected by construction: the same numbers, the box and outline shifted by exactly d —
     on the hand-built pieces and on the four factory 3380 pieces, whose 杯口 re-measured after a
     move came out 1.1e-13 mm shorter in its sewing line */
  const factory = blocks.map(b => () => summarize({name: b.name, blockName: b.name, qty: "", category: "", texts: [],
    paths: b.polylines.map(q => poly(q.layer, q.pts.map(v => v.slice()), q.closed)).concat(b.lines.map(l => lineP(l.layer, l.a.slice(), l.b.slice()))),
    points: b.points.map(q => ({layer: q.layer, x: q.x, y: q.y}))}));
  for(const make of [rectPiece, testPiece, ...factory]){
    const p = make(), cut0 = p.cut.map(q => q.slice()), sew0 = p.sew && p.sew.map(q => q.slice());
    const {cutLen, sewLen} = p, b0 = {...p.bbox};
    const g = beginEdit(p, [{kind: "piece", pi: 0}]);
    for(const d of [[3, 1], [10.25, -5.5], [-7, 12]]){
      driveEdit(g, d);
      ok(p.cutLen === cutLen && p.sewLen === sewLen, `${p.name} ${d}: lengths ${p.cutLen - cutLen}, ${p.sewLen - sewLen}`);
      p.cut.forEach((q, k) => { near(q[0], cut0[k][0] + d[0], 1e-9); near(q[1], cut0[k][1] + d[1], 1e-9, `${p.name} cut ${k}`); });
      if(sew0) p.sew.forEach((q, k) => near(q[1], sew0[k][1] + d[1], 1e-9, `${p.name} sew ${k}`));
      for(const [k, v] of [["x0", d[0]], ["x1", d[0]], ["y0", d[1]], ["y1", d[1]]]) near(p.bbox[k], b0[k] + v, 1e-9, `${p.name} bbox.${k}`);
      near(p.bbox.w, b0.w, 1e-9); near(p.bbox.h, b0.h, 1e-9);
    }
  }
});

test("D7 undo: a snapPiece restored gives the piece back bit for bit", () => {
  const p = rectPiece(), before = geom(p), s = snapPiece(p);
  applyLength(p, edgeOf(p, 0, 0, 1, [90, -1]), 150);
  splitAt(p, edgeOf(p, 0, 1, 2, [150, 30]), [150, 30]);
  ok(geom(p) !== before);
  restorePiece(p, s);
  eq(geom(p), before);
});

test("D7 undo keeps an Arrange move made after the edit", () => {
  const p = rectPiece(), s = snapPiece(p);
  applyLength(p, edgeOf(p, 0, 0, 1, [90, -1]), 150);
  for(const path of p.paths) for(const v of path.pts){ v[0] += 20; }    // what Arrange's translatePiece does
  p.ox = 20;
  restorePiece(p, s);
  deepEq(vertsOf(p.paths[0]), [[20, 0], [120, 0], [120, 60], [20, 60]]);
});

test("the edge picked by a click and the edge an op works on are the same edge", () => {
  const p = rectPiece(), hit = pickAt([p], ALL, [90, -1], 2);
  eq(hit.item.kind, "line");
  applyLength(p, hit.item, 150);
  near(vertsOf(p.paths[0])[1][0], 150, 1e-9);
});

/* ── D8–D10: what a click names as the cutter (Trim) or the boundary (Extend) ──────────────────
   Every expected vertex is a construction: a line running along +X from x = 40 meets the right
   side of a 100-wide rectangle at x = 100; a line crossing that side at (100,30) keeps (50,30)→(100,30). */
const nearPts = (a, b, tol, msg) => {
  eq(a.length, b.length, `${msg}: vertex count`);
  a.forEach((q, k) => { near(q[0], b[k][0], tol, `${msg} [${k}].x`); near(q[1], b[k][1], tol, `${msg} [${k}].y`); });
};
/* the middle of each side of the rectangle's cut line: bottom, right, top, left */
const CUT_CLICKS = [[70, 0], [100, 40], [50, 60], [0, 20]];
const cutEdgeAt = (p, c) => {
  const hit = pickAt([p], ALL, c, 1, {filter: "edge"});
  eq(hit && hit.item.path, 0, `the click at ${c} lands on the cut line`);
  return hit.item;
};

test("D8 extend: a click on ANY side of the cut line names the whole cut line — the inner line reaches the side its own direction meets", () => {
  /* the clicked side alone — the rule before — reached (100,30) only when the click was on the right side */
  for(const c of CUT_CLICKS){
    const p = rectPiece({grain: null});
    p.paths.push(lineP("0", [10, 30], [40, 30])); summarize(p);
    const r = extendLine(p, 2, boundaryShapes(p, holdBoundary(p, cutEdgeAt(p, c).path), 2), [38, 30]);
    ok(r.ok, `clicked ${c}: ${r.message}`);
    nearPts(vertsOf(p.paths[2]), [[10, 30], [100, 30]], 1e-9, `clicked ${c}`);
  }
});

test("D8 trim: the part of a line outside the cut line goes, whichever side of the cut line was clicked", () => {
  /* (50,30)→(130,30) crosses only the right side; the top side alone crosses nothing — refused before */
  for(const c of CUT_CLICKS){
    const p = rectPiece({grain: null});
    p.paths.push(lineP("0", [50, 30], [130, 30])); summarize(p);
    const r = trimLine(p, 2, boundaryShapes(p, holdBoundary(p, cutEdgeAt(p, c).path), 2), [120, 30]);
    ok(r.ok, `clicked ${c}: ${r.message}`);
    nearPts(vertsOf(p.paths[2]), [[50, 30], [100, 30]], 1e-9, `clicked ${c}`);
  }
});

/* a cut line drawn as four LINE entities — as 273 of the library's 718 pieces draw theirs in several —
   the bottom one overshooting both its corners by 10 mm */
function linesPiece(){
  return summarize({name: "L", blockName: "L", qty: "1", category: "", texts: [], points: [],
    paths: [lineP("1", [-10, 0], [110, 0]), lineP("1", [100, 0], [100, 60]), lineP("1", [100, 60], [0, 60]), lineP("1", [0, 60], [0, 0])]});
}

test("D8 a cut line drawn in several entities is ONE cut line: a click on its bottom LINE, and the inner line reaches the right one", () => {
  const p = linesPiece();
  p.paths.push(lineP("0", [10, 30], [40, 30])); summarize(p);
  eq(boundaryShapes(p, holdBoundary(p, 0), 4).length, 4, "all four entities of layer 1");
  const r = extendLine(p, 4, boundaryShapes(p, holdBoundary(p, 0), 4), [38, 30]);
  ok(r.ok, r.message);
  nearPts(vertsOf(p.paths[4]), [[10, 30], [100, 30]], 1e-9, "reached the right LINE");
});

test("D8 the line edited is never its own cutter: the bottom LINE's overshoot trimmed against the rest of the cut line", () => {
  /* (−10,0)→(110,0) crosses the right LINE at (100,0): a click at (105,0) cuts the 10 mm beyond it */
  const p = linesPiece(), held = holdBoundary(p, 1), shapes = boundaryShapes(p, held, 0);
  eq(shapes.length, 3, "the other three entities");
  ok(!shapes.includes(p.paths[0].shapes[0]), "not the bottom LINE itself");
  const r = trimLine(p, 0, shapes, [105, 0]);
  ok(r.ok, r.message);
  nearPts(vertsOf(p.paths[0]), [[-10, 0], [100, 0]], 1e-6, "the overshoot is gone");
});

test("D9 the cutter holds through a trim that renumbers the lines: a second line cut against the same U", () => {
  /* the U (40,10)→(40,50)→(60,50)→(60,10) comes AFTER the two lines it cuts. Cutting the middle out of the first
     splits it in two and moves every line after it one place on — the next click must still cut against the U,
     not against whatever now sits where the U was (the second line itself) */
  const p = rectPiece({grain: null});
  p.paths.push(lineP("0", [10, 20], [90, 20]), lineP("0", [10, 40], [90, 40]), poly("0", [[40, 10], [40, 50], [60, 50], [60, 10]], false));
  summarize(p);
  const U = p.paths[4], held = holdBoundary(p, 4);
  const r1 = trimLine(p, 2, boundaryShapes(p, held, 2), [50, 20]);
  ok(r1.ok, r1.message);
  eq(p.paths.indexOf(U), 5, "the U moved one place on");
  deepEq(boundaryShapes(p, held, -1), U.shapes, "the cutter is still the U");
  const i = p.paths.findIndex(q => q !== U && vertsOf(q)[0][1] === 40);
  const r2 = trimLine(p, i, boundaryShapes(p, held, i), [50, 40]);
  ok(r2.ok, r2.message);
  deepEq(p.paths.filter(q => q !== U && vertsOf(q).every(v => v[1] === 40)).map(vertsOf), [[[10, 40], [40, 40]], [[60, 40], [90, 40]]]);
});

/* a piece with a notch 40 wide and 40 deep cut into its top: a U of cut line */
function notchedPiece(){
  const ring = [[0, 0], [100, 0], [100, 60], [70, 60], [70, 20], [30, 20], [30, 60], [0, 60]];
  return summarize({name: "U", blockName: "U", qty: "1", category: "", texts: [], points: [], paths: [poly("1", ring, true)]});
}

test("D10 extend from an end already on the boundary: refused, says so — it does not jump the notch to its far wall", () => {
  /* (10,40)→(30,40) ends ON the notch's left wall; on along +X it would next meet the right wall at (70,40),
     across the outside of the piece. Its other end runs −X to the left side at (0,40) */
  const p = notchedPiece();
  p.paths.push(lineP("0", [10, 40], [30, 40])); summarize(p);
  const before = geom(p);
  const r = extendLine(p, 1, boundaryShapes(p, holdBoundary(p, 0), 1), [29, 40]);
  ok(!r.ok && /đã nằm trên/.test(r.message), r.message);
  eq(geom(p), before, "nothing changed");
  const r2 = extendLine(p, 1, boundaryShapes(p, holdBoundary(p, 0), 1), [11, 40]);
  ok(r2.ok, r2.message);
  nearPts(vertsOf(p.paths[1]), [[0, 40], [30, 40]], 1e-9, "the free end reached the left side");
});

test("P9 Length and Angle on a closed whole curve (a CIRCLE): refused, saying why — the piece unchanged", () => {
  /* both ends of a circle are one point: there is no end to run. Length used to answer "done" and change nothing */
  const p = rectPiece({grain: null}), s = arc(point(50, 30), 10, 0, 2*Math.PI, true);
  p.paths.push({layer: "11", closed: true, shapes: [s], pts: sample(s, 0.05), snap: [[60, 30]]}); summarize(p);
  const before = geom(p), it = {kind: "curve", whole: true, a: null, b: null, path: 2, pi: 0, click: [60, 30]};
  for(const [what, fn] of [["Length", () => applyLength(p, it, 70)], ["Angle", () => applyAngle(p, it, 30)]]){
    let err = null; try{ fn(); }catch(x){ err = x; }
    ok(err && /kín/.test(err.message), `${what}: ${err ? err.message : "no refusal"}`);
    eq(geom(p), before, `${what} changed nothing`);
  }
});

test("D12 an open line whose two ends are one point is a closed line to Trim and Extend: refused, saying why", () => {
  /* a drill mark drawn as an OPEN polyline that comes back to where it began (DM1192 layer 11): "the end
     clicked" is both ends at once — before, Extend ran the other one out to the cut line */
  const loop = () => { const p = rectPiece({grain: null});
    p.paths.push(poly("11", [[40, 20], [60, 20], [60, 40], [40, 40], [40, 20]], false), lineP("0", [50, 10], [50, 50])); return summarize(p); };
  const p = loop(), before = geom(p);
  eq(vertsOf(p.paths[2]).length, 5, "open, its first vertex repeated at its end");
  const x = extendLine(p, 2, boundaryShapes(p, holdBoundary(p, 0), 2), [40, 20]);
  ok(!x.ok && /hai đầu trùng/.test(x.message), x.message);
  const t = trimLine(p, 2, boundaryShapes(p, holdBoundary(p, 3), 2), [45, 20]);
  ok(!t.ok && /hai đầu trùng/.test(t.message), t.message);
  eq(geom(p), before, "nothing changed");
});

test("D13 a line drawn over the edge is not cut where it shares the edge's vertices: trimmed against the cut line, it has nothing to cut", () => {
  /* a layer-84 line on vertices 7…12 of the arc top — the cut line's own vertices, as SONASHAPE draws one. Every
     shared vertex used to read as a crossing, and the click took out the stretch between two of them */
  const p = testPiece(), ring = vertsOf(p.paths[0]);
  p.paths.push(poly("84", ring.slice(7, 13).map(q => q.slice()), false)); summarize(p);
  const before = geom(p), mid = ring.slice(9, 11), click = [(mid[0][0] + mid[1][0])/2, (mid[0][1] + mid[1][1])/2];
  const r = trimLine(p, 2, boundaryShapes(p, holdBoundary(p, 0), 2), click);
  ok(!r.ok && /giao điểm/.test(r.message), r.message);
  eq(geom(p), before, "nothing changed");
});

test("D13 a line along the edge that leaves it: the place it leaves is where it is cut", () => {
  /* on vertices 7…12 of the arc top, then straight up and out to (x12, 90): trimming the stretch along the edge
     takes it off up to vertex 12, where the line leaves the cut line — the tail outside is what is left */
  const p = testPiece(), ring = vertsOf(p.paths[0]), v12 = ring[12];
  p.paths.push(poly("84", ring.slice(7, 13).map(q => q.slice()).concat([[v12[0], 90]]), false)); summarize(p);
  const click = [(ring[9][0] + ring[10][0])/2, (ring[9][1] + ring[10][1])/2];
  const r = trimLine(p, 2, boundaryShapes(p, holdBoundary(p, 0), 2), click);
  ok(r.ok, r.message);
  nearPts(vertsOf(p.paths[2]), [v12, [v12[0], 90]], 1e-6, "the tail outside the piece");
});

test("D9 the cutter holds through a refused click too: the piece put back from its snapshot is copies, the U is still the cutter", () => {
  /* a click that is refused (the line does not cross the cutter) puts the piece back from its snapshot —
     every path a copy. The cutter must be found again in the copies, and still cut */
  const p = rectPiece({grain: null});
  p.paths.push(lineP("0", [10, 20], [90, 20]), poly("0", [[40, 10], [40, 50], [60, 50], [60, 10]], false)); summarize(p);
  const held = holdBoundary(p, 3), s = snapPiece(p);
  restorePiece(p, s);
  deepEq(boundaryShapes(p, held, -1).map(q => q.pts), [[[40, 10], [40, 50], [60, 50], [60, 10]]], "found in the copies");
  const r = trimLine(p, 2, boundaryShapes(p, held, 2), [50, 20]);
  ok(r.ok, r.message);
  deepEq(p.paths.filter(q => q.layer === "0" && vertsOf(q).length === 2).map(vertsOf), [[[10, 20], [40, 20]], [[60, 20], [90, 20]]]);
});

/* ── §6b Delete (TD 2026-09-24: "Làm, trừ đường cắt") ─────────────────────────────────────────────────
   rectPiece: cut ring (layer 1) · seam ring (8) · grainline (7) · notch (4) at (30,0) · grade point (5) — every expected
   count is the construction's */
const withInner = () => { const p = rectPiece(); p.paths.push(lineP("8", [20, 20], [40, 40])); return summarize(p); };
const pointItem = j => ({kind: "point", src: "entity", pt: j, pi: 0});

test("Z1 Delete on a Line takes its whole path; the others stay the very same objects", () => {
  const p = withInner(), [cut, sew, grain, inner] = p.paths;
  const r = deleteItems(p, [edgeOf(p, 3, 0, 1, [30, 30])]);
  ok(r.ok, r.message);
  eq(p.paths.length, 3, "một đường ít hơn");
  ok(p.paths[0] === cut && p.paths[1] === sew && p.paths[2] === grain, "các đường khác: chính các object đó");
  ok(!p.paths.includes(inner), "đường trong không còn");
  ok(/đã xoá 1 đường/.test(r.message), r.message);
});

test("Z1 two edges of one path: the path goes once · a POINT goes · one message for all", () => {
  const p = withInner(), grade = p.points[1];
  const e = edgesOf(p.paths[1]);                                  // the seam ring: four edges
  const r = deleteItems(p, [{...e[0], path: 1, pi: 0}, {...e[2], path: 1, pi: 0}, pointItem(0)]);
  ok(r.ok, r.message);
  deepEq(p.paths.map(q => q.layer), ["1", "7", "8"], "vòng may đi một lần; cắt, canh sợi, đường trong còn");
  eq(p.points.length, 1); ok(p.points[0] === grade, "notch đi, grade point còn");
  ok(/1 đường/.test(r.message) && /1 điểm/.test(r.message), r.message);
  eq(p.sewLen, 0, "không còn đường may: Sewing line trống (dòng readout đọc summarize)");
});

test("Z2 a cut line is refused — alone or with others — and nothing changes", () => {
  const p = withInner(), before = geom(p);
  let r = deleteItems(p, [edgeOf(p, 0, 0, 1, [50, -1])]);
  ok(!r.ok && /đường cắt/.test(r.message) && /cả mảnh/.test(r.message), r.message);
  eq(geom(p), before, "không đổi một bit");
  r = deleteItems(p, [edgeOf(p, 3, 0, 1, [30, 30]), edgeOf(p, 0, 0, 1, [50, -1])]);
  ok(!r.ok, "có đường cắt trong lựa chọn → từ chối cả lựa chọn");
  eq(geom(p), before, "đường trong cũng còn nguyên");
});

test("Z3 a corner of a path is not a thing to delete: refused, with what to do instead", () => {
  const p = withInner(), before = geom(p);
  const r = deleteItems(p, [{kind: "point", src: "vertex", path: 3, v: 0, pi: 0}]);
  ok(!r.ok && /đỉnh/.test(r.message) && /Line/.test(r.message), r.message);
  eq(geom(p), before);
});

test("Z4 the last grainline or the last notch may go — with a warning (CLAUDE.md §5.10)", () => {
  let p = rectPiece(), r = deleteItems(p, [edgeOf(p, 2, 0, 1, [50, 30])]);
  ok(r.ok && /⚠/.test(r.message) && /canh sợi/.test(r.message), r.message);
  p = rectPiece(); r = deleteItems(p, [pointItem(0)]);
  ok(r.ok && /⚠/.test(r.message) && /notch/.test(r.message), r.message);
  p = withInner(); r = deleteItems(p, [edgeOf(p, 3, 0, 1, [30, 30])]);
  ok(r.ok && !/⚠/.test(r.message), "đường trong: không thiếu gì — không cảnh báo");
});

/* pieces/remove.md R5: an undo step holds the pieces themselves — a piece deleted since is skipped, one after it is found
   where it is now, not at the place it had */
test("R5 an Edit undo step finds its piece where it is now — after a piece before it was deleted", () => {
  const A = {n: "A"}, B = {n: "B"}, C = {n: "C"};
  const step = [{piece: C, snap: "c"}, {piece: B, snap: "b"}];
  deepEq(stepPieces(step, [A, C]).map(s => [s.index, s.piece.n, s.snap]), [[1, "C", "c"]], "B đã xoá: bỏ qua; C giờ ở chỗ 1");
  deepEq(stepPieces(step, [A, B, C]).map(s => s.index), [2, 1], "chưa xoá gì: đúng chỗ");
});
