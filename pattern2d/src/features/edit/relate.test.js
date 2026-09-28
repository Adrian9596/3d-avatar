/* Layer 4 — Constraint: relations read off a piece, kept by the solver (spec: edit/edit.md §5).

   Three kinds of piece: a rectangle built here (every number known), BLOCK_36C as the
   pipeline wrote it (seam allowance 0 on the elastic edges, 6 on the seams), and the four
   factory 3380 pieces frozen in tests/fixtures/3380.json (seam allowance anywhere from 1.6 to
   7.1 mm). The yardstick is a plain loop of tests/fixture3380.js — not the kernel — so "each
   seam vertex kept its own allowance" is measured by something that has no idea how the kernel
   kept it: a seam vertex's allowance is its distance to the cut segments running with the seam
   there (rawSeamAllowance), which a chamfered cut corner does not fool. */
import {block36Text} from "../../../tests/data.js";
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {blocks, rawDistToPolyline, rawSeamAllowance} from "../../../tests/fixture3380.js";
import {curve, line, point} from "../geometry/model.js";
import {deformPath} from "../geometry/deform.js";
import {hostOf} from "../geometry/anchor.js";
import {parseDXF} from "../dxf/parse.js";
import {buildModel, summarize, SEW_BAND} from "../dxf/model.js";
import {vertsOf, isRing, cornersOf, edgesOf} from "./select.js";
import {relate, settle, shapeLike, ON_TOL} from "./relate.js";
import {poly, lineP, rectPiece} from "../../../tests/edit_fixtures.js";
import {applyMove} from "./ops.js";

const block36 = () => buildModel(parseDXF(block36Text())).pieces;
function factoryPiece(b){
  const paths = b.polylines.map(p => poly(p.layer, p.pts.map(q => q.slice()), p.closed))
    .concat(b.lines.map(l => lineP(l.layer, l.a.slice(), l.b.slice())));
  return summarize({name: b.name, blockName: b.name, qty: "", category: "", texts: [], paths,
                    points: b.points.map(q => ({layer: q.layer, x: q.x, y: q.y}))});
}
/* the geometry of a piece as plain numbers, to compare before/after */
const shot = p => JSON.stringify([p.paths.map(q => vertsOf(q)), p.points.map(q => [q.x, q.y])]);

/* drag vertex v of path i by d, the way a gesture does: from the relate-time value */
function drag(piece, rel, i, v, d){
  const src = rel.src.get(i), base = hostOf(rel.base.get(i));
  const pts = deformPath(base.pts, base.closed, rel.corners.get(i), new Map([[v, d]]));
  rel.doc.set(src, shapeLike(rel.base.get(i), pts));      // same vertex count: anchors address vertices by index
  const r = rel.doc.solve();
  settle(piece, rel, new Set([src, ...r.updated]));
  return r;
}
const cutIndex = p => p.paths.findIndex(q => q.layer === "1" && isRing(q));
const sewIndex = p => p.paths.findIndex(q => q.layer === "8" && isRing(q));

test("relations read off a rectangle: seam follows cut, notch on the cut, grainline reaches both edges, one free point", () => {
  const rel = relate(rectPiece());
  eq(rel.kind.get(0), "cut"); eq(rel.kind.get(1), "follow"); eq(rel.kind.get(2), "reach");
  eq(rel.attached.get(0).host, 0, "the notch rides on the cut line");
  ok(rel.free.has(1), "the grade point in the middle touches nothing");
  eq(SEW_BAND, 30); eq(ON_TOL, 0.01);
});

test("C1 nothing edited: every value the solver gives back is the geometry as it is, bit for bit", () => {
  const all = [rectPiece(), rectPiece({grain: "inside"}), ...block36(), ...blocks.map(factoryPiece)];
  for(const p of all){
    const before = shot(p), rel = relate(p);
    settle(p, rel, null);                                   // write EVERY node back
    eq(shot(p), before, p.name);
  }
});

test("C2 BLOCK_36C: drag a cut corner 4 mm right and 3 mm down — every seam vertex keeps its own allowance", () => {
  let checked = 0, moved = 0;
  for(const p of block36()){
    const ci = cutIndex(p), si = sewIndex(p);
    if(ci < 0 || si < 0) continue;
    const oldCut = vertsOf(p.paths[ci]).map(q => q.slice()), oldSew = vertsOf(p.paths[si]).map(q => q.slice());
    const rel = relate(p);
    eq(rel.kind.get(si), "follow", `${p.name}: the seam line follows`);
    const r = drag(p, rel, ci, rel.corners.get(ci)[1], [4, -3]);
    eq(r.failed.length + r.blocked.length, 0, `${p.name}: ${JSON.stringify(r.failed)}`);
    const newCut = vertsOf(p.paths[ci]), newSew = vertsOf(p.paths[si]);
    eq(newSew.length, oldSew.length);
    newSew.forEach((q, j) => near(rawSeamAllowance(newSew, j, newCut), rawSeamAllowance(oldSew, j, oldCut), 0.01, `${p.name} seam vertex ${j}`));
    checked += newSew.length;
    moved += newSew.filter((q, j) => Math.hypot(q[0] - oldSew[j][0], q[1] - oldSew[j][1]) > 0.1).length;
  }
  ok(checked > 150, `${checked} seam vertices checked`);
  ok(moved >= 10, `${moved} seam vertices actually moved — the check is not vacuous`);
});

test("C2 factory 3380 (uneven allowance 1.6–7.1 mm): drag a corner — each seam vertex keeps its own", () => {
  let checked = 0, moved = 0;
  for(const b of blocks){
    const p = factoryPiece(b), ci = cutIndex(p), si = sewIndex(p);
    const oldCut = vertsOf(p.paths[ci]).map(q => q.slice()), oldSew = vertsOf(p.paths[si]).map(q => q.slice());
    const rel = relate(p);
    eq(rel.kind.get(si), "follow", `${b.name}: the seam line follows`);
    drag(p, rel, ci, rel.corners.get(ci)[0], [3, 2]);
    const newCut = vertsOf(p.paths[ci]), newSew = vertsOf(p.paths[si]);
    newSew.forEach((q, j) => near(rawSeamAllowance(newSew, j, newCut), rawSeamAllowance(oldSew, j, oldCut), 0.01, `${b.name} seam vertex ${j}`));
    checked += newSew.length;
    moved += newSew.filter((q, j) => Math.hypot(q[0] - oldSew[j][0], q[1] - oldSew[j][1]) > 0.1).length;
  }
  ok(checked > 350, `${checked} seam vertices checked`);
  ok(moved >= 10, `${moved} seam vertices actually moved — the check is not vacuous`);
});

test("C8 factory 3380 杯口: the lace-scallop line along the straight top edge rides THAT edge — drag a corner off it, the line stays", () => {
  /* The yardstick is a plain loop: every vertex of the scallop line (layer 8, open, the long one) is
     nearest to the straight top edge — the longest Line of the ring — so an edit that leaves that edge
     where it was must leave the line where it was. The old anchoring put 15 of them on the curve
     across the piece, 20–29 mm away, because the scallop's cusps happen to run parallel to it. */
  const b = blocks.find(x => x.name.startsWith("杯口"));
  const fresh = () => factoryPiece(b);
  let p = fresh();
  const ci = cutIndex(p), sc = p.paths.findIndex(q => q.layer === "8" && !q.closed && vertsOf(q).length > 100);
  ok(sc >= 0, "the scallop line is there");
  const cut = vertsOf(p.paths[ci]), v0 = vertsOf(p.paths[sc]).map(q => q.slice());
  const long = e => Math.hypot(e.pts[e.pts.length - 1][0] - e.pts[0][0], e.pts[e.pts.length - 1][1] - e.pts[0][1]);
  const top = edgesOf(p.paths[ci]).filter(e => e.kind === "line").sort((x, y) => long(y) - long(x))[0];
  const topLine = [top.pts[0], top.pts[top.pts.length - 1]];
  v0.forEach((q, j) => near(rawDistToPolyline(q, topLine, false), rawDistToPolyline(q, cut), 1e-9, `scallop vertex ${j} is nearest to the top edge`));
  let dragged = 0;
  for(const c of cornersOf(p.paths[ci])){
    if(c === top.a || c === top.b) continue;
    p = fresh();
    const rel = relate(p);
    const r = drag(p, rel, ci, c, [4, -3]);
    eq(r.failed.length + r.blocked.length, 0, `corner ${c}: ${JSON.stringify(r.failed)}`);
    const moved = vertsOf(p.paths[sc]).map((q, j) => Math.hypot(q[0] - v0[j][0], q[1] - v0[j][1])).filter(d => d > 0);
    eq(moved.length, 0, `corner ${c} dragged: scallop vertices that moved (up to ${moved.length ? Math.max(...moved).toFixed(3) : 0} mm)`);
    dragged++;
  }
  ok(dragged >= 2, `${dragged} corners off the top edge dragged`);
});

test("C11 shapes drawn on a piece do not warp: a small layer-8 ring inside stays put, a layer-8 tick across the edge keeps its end on the edge", () => {
  /* VeraLifting 11_64 draws a pad placement as a small layer-8 ring 14–24 mm inside its frame; SofyLift
     ticks its strap ends with two-point layer-8 lines across the edge. Anchored vertex by vertex to
     whichever cut segment was nearest, they came apart when a corner moved. Expected by construction:
     the ring does not move a bit; the tick's outer end stays on the right side as it leans out, at the
     same height — the right side runs (100,0) → (106,60), so at y = 45 it is at x = 100 + 6·45/60 */
  const p = rectPiece({grain: "inside"});
  const ring = [[70, 30], [80, 25], [90, 30], [80, 35]];
  p.paths.push(poly("8", ring.map(q => q.slice()), true));
  p.paths.push(lineP("8", [100, 45], [92, 45]));
  summarize(p);
  const rel = relate(p);
  eq(rel.kind.get(1), "follow", "the seam line is still a seam line");
  eq(rel.kind.get(3), "line", "the small ring is a shape, not a seam line");
  eq(rel.kind.get(4), "reach", "the tick reaches the edge");
  const r = drag(p, rel, 0, 2, [6, 0]);
  eq(r.failed.length + r.blocked.length, 0, JSON.stringify(r.failed));
  deepEq(vertsOf(p.paths[3]), ring, "the ring did not move a bit");
  const [a, b] = vertsOf(p.paths[4]);
  near(a[0], 100 + 6*45/60, 1e-9); near(a[1], 45, 1e-9, "the outer end is on the leaning right side");
  deepEq(b, [92, 45], "the inner end stayed");
});

test("C10 degenerate lines (a one-vertex polyline, a LINE of length 0 — drill marks, MHG568) do not stop the piece being edited", () => {
  const p = rectPiece({grain: "inside"});
  p.paths.push(poly("85", [[40, 40], [40, 40]], true));                  // a ring of one vertex
  p.paths.push(lineP("8", [60, 40], [60, 40]));                          // a LINE of length 0, inside the seam band
  p.paths.push(poly("85", [[100, 30], [100, 30]], false));               // one vertex ON the cut line
  summarize(p);
  let rel = null;
  try{ rel = relate(p); }catch(e){ ok(false, `relate threw: ${e.message}`); }
  const r = drag(p, rel, 0, 2, [7, 5]);
  eq(r.failed.length + r.blocked.length, 0, JSON.stringify(r.failed));
  deepEq(vertsOf(p.paths[3]), [[40, 40]], "the one-vertex ring stayed put");
  deepEq(vertsOf(p.paths[4]), [[60, 40], [60, 40]], "the LINE of length 0 is no seam line: it stayed put too");
  near(vertsOf(p.paths[2])[1][1], 45, 1e-9, "the grainline inside was not touched (it touches nothing)");
  deepEq(vertsOf(p.paths[0])[2], [107, 65], "and the corner went where it was dragged");
});

test("C3 notch on an edge that grows at one end keeps its distance from the other end", () => {
  let p = rectPiece(), rel = relate(p);
  drag(p, rel, 0, 1, [20, 0]);                       // (100,0) → (120,0): the fixed end is (0,0)
  near(p.points[0].x, 30, 1e-9); near(p.points[0].y, 0, 1e-9);
  p = rectPiece(); rel = relate(p);
  drag(p, rel, 0, 0, [-20, 0]);                      // (0,0) → (−20,0): the fixed end is (100,0), 70 away
  near(p.points[0].x, 30, 1e-9); near(p.points[0].y, 0, 1e-9);
});

test("C3 notch on an edge moved as a whole moves with it", () => {
  const p = rectPiece(), rel = relate(p), src = rel.src.get(0), base = hostOf(rel.base.get(0));
  rel.doc.set(src, shapeLike(rel.base.get(0), deformPath(base.pts, true, rel.corners.get(0), new Map([[0, [0, -5]], [1, [0, -5]]]))));
  const r = rel.doc.solve(); settle(p, rel, new Set([src, ...r.updated]));
  near(p.points[0].x, 30, 1e-9); near(p.points[0].y, -5, 1e-9);
});

test("C4 grainline reaching both edges: the top goes up 10 → the grainline ends at the new top, still vertical", () => {
  const p = rectPiece(), rel = relate(p), src = rel.src.get(0), base = hostOf(rel.base.get(0));
  rel.doc.set(src, shapeLike(rel.base.get(0), deformPath(base.pts, true, rel.corners.get(0), new Map([[2, [0, 10]], [3, [0, 10]]]))));
  const r = rel.doc.solve(); settle(p, rel, new Set([src, ...r.updated]));
  const g = vertsOf(p.paths[2]);
  deepEq(g[0], [50, 0], "the bottom did not move, so neither did that end");
  near(g[1][0], 50, 1e-9); near(g[1][1], 70, 1e-9);
  near(vertsOf(p.paths[1])[2][1], 64, 1e-9, "and the seam 6 mm under it");
});

test("C5 the whole cut moved by one vector: everything that rides on it moves by exactly that", () => {
  const p = rectPiece(), before = shot(p), rel = relate(p), src = rel.src.get(0), base = hostOf(rel.base.get(0));
  rel.doc.set(src, shapeLike(rel.base.get(0), base.pts.map(q => [q[0] + 12.5, q[1] - 4])));
  const r = rel.doc.solve(); settle(p, rel, new Set([src, ...r.updated]));
  const [paths0] = JSON.parse(before);
  vertsOf(p.paths[1]).forEach((q, j) => { near(q[0], paths0[1][j][0] + 12.5, 1e-9); near(q[1], paths0[1][j][1] - 4, 1e-9); });
  near(p.points[0].x, 42.5, 1e-9); near(p.points[0].y, -4, 1e-9);
});

test("C6 a relation that breaks fails alone: the seam keeps its old line, the grainline still follows", () => {
  const p = rectPiece(), rel = relate(p), oldSew = JSON.stringify(vertsOf(p.paths[1]));
  const r = drag(p, rel, 0, 2, [0, -60]);            // (100,60) onto (100,0): the right side is 0 long
  ok(r.failed.some(f => f.id === rel.out.get(1)), `seam node failed: ${JSON.stringify(r.failed)}`);
  eq(JSON.stringify(vertsOf(p.paths[1])), oldSew, "the failed seam line is left as it was");
  near(vertsOf(p.paths[2])[1][1], 30, 1e-9, "the grainline met the slanted top at y = 30");
});

test("C4 a line lying along the cut line (BLOCK_36C's wing grainline, on the band's bottom) rides on it", () => {
  const p = block36().find(q => q.blockName === "wing_M"), gi = p.paths.findIndex(q => q.layer === "7");
  const rel = relate(p);
  eq(rel.kind.get(gi), "ride", "it lies on the edge, it does not reach across it");
  const ci = cutIndex(p), c = rel.corners.get(ci)[1];
  drag(p, rel, ci, c, [5, -3]);
  const cut = vertsOf(p.paths[ci]);
  for(const q of vertsOf(p.paths[gi])) near(rawDistToPolyline(q, cut), 0, 0.01, "grainline end still on the cut line");
  eq(p.paths[gi].shapes[0].kind, "line", "and it is still a LINE");
});

test("C4 a grainline crossing the piece is a reach line, not a rider", () => {
  const p = rectPiece(), rel = relate(p);
  eq(rel.kind.get(2), "reach");
});

test("C7 a point and a line that touch nothing stay put when the cut line changes", () => {
  const p = rectPiece({grain: "inside"}), rel = relate(p);
  ok(rel.free.has(1)); eq(rel.kind.get(2), "line");
  drag(p, rel, 0, 2, [15, 15]);
  deepEq(vertsOf(p.paths[2]), [[50, 15], [50, 45]]); eq(p.points[1].x, 20); eq(p.points[1].y, 30);
});

test("a point on the cut and the seam at once (allowance 0) rides on the cut", () => {
  const p = rectPiece();
  p.paths[1] = poly("8", [[0, 0], [100, 0], [94, 54], [6, 54]], true);
  p.points.push({layer: "2", x: 100, y: 0});
  const rel = relate(summarize(p));
  eq(rel.attached.get(2).host, 0);
});

test("settle writes only what changed: a path nobody touched keeps its very arrays", () => {
  const p = rectPiece({grain: "inside"}), grainPts = p.paths[2].pts, rel = relate(p);
  drag(p, rel, 0, 2, [5, 5]);
  ok(p.paths[2].pts === grainPts, "the grainline was not rewritten");
  ok(p.rev >= 1, "the piece says it changed");
});

/* ── C12: the ASTM / AAMA sew line is layer 14 (D6673: layer 8 is "internal lines") ─────────── */
const dist = (q, a, b) => rawDistToPolyline(q, [a, b], false);
test("C12 a seam on layer 14 follows the cut line: the right side pushed out, every seam vertex keeps its 6 mm", () => {
  /* the rectangle with its seam drawn where the standard puts it. Drag corner (100,60) by (4,−3): the right side
     becomes (100,0)→(104,57), the top (104,57)→(0,60) — the seam corners must stay 6 mm from the sides they follow */
  const p = rectPiece(); p.paths[1].layer = "14"; summarize(p);
  eq(relate(p).kind.get(1), "follow", "layer 14 read as the seam line");
  applyMove(p, [{kind: "point", src: "vertex", path: 0, v: 2, pi: 0}], [4, -3]);      // the way the Edit tool drags it
  const v = vertsOf(p.paths[1]), c = vertsOf(p.paths[0]);
  deepEq(c[2], [104, 57], "the corner went where it was dragged");
  near(dist(v[1], c[1], c[2]), 6, 1e-9, "(94,6) → right side"); near(dist(v[2], c[1], c[2]), 6, 1e-9, "(94,54) → right side");
  near(dist(v[2], c[2], c[3]), 6, 1e-9, "(94,54) → top"); near(dist(v[3], c[2], c[3]), 6, 1e-9, "(6,54) → top");
});
test("C12 a small layer-14 ring inside the piece is not the seam line: it stays put", () => {
  const p = rectPiece(); p.paths.push(poly("14", [[40, 25], [60, 25], [60, 35], [40, 35]], true)); summarize(p);
  const before = JSON.stringify(vertsOf(p.paths[3]));
  ok(relate(p).kind.get(3) !== "follow", "not a seam");
  applyMove(p, [{kind: "point", src: "vertex", path: 0, v: 2, pi: 0}], [4, -3]);
  deepEq(vertsOf(p.paths[0])[2], [104, 57], "the corner went where it was dragged");
  eq(JSON.stringify(vertsOf(p.paths[3])), before);
});
