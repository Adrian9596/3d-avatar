/* Layer 1 — Select (spec: edit/edit.md §2, S1–S4).

   A piece built by hand (tests/edit_fixtures.js): a 100 × 60 rectangle whose top edge is a sampled curve (a
   circular arc bulging 10 mm), a notch on the bottom edge, a grainline inside. Which thing a
   click lands on is known from that construction; the pick radius is handed in in mm, the way
   the Canvas hands it over after dividing its 8 px by the zoom. */
import {test, eq, ok, deepEq} from "../../../tests/harness.js";
import {curve, line, point, arc} from "../geometry/model.js";
import {testPiece} from "../../../tests/edit_fixtures.js";
import {vertsOf, cornersOf, edgesOf, targetsOf, pickAt} from "./select.js";
import {PICK_PX} from "../canvas/canvas.js";

const ALL = new Proxy({}, {get: () => true});
test("vertsOf: a polyline's vertices, a LINE's two ends, nothing for an arc", () => {
  const p = testPiece();
  eq(vertsOf(p.paths[0]).length, 23);
  deepEq(vertsOf(p.paths[1]), [[50, 15], [50, 45]]);
  eq(vertsOf({layer: "1", closed: false, pts: [], shapes: [arc(point(0, 0), 5, 0, 1, true)]}), null);
});

test("corners and edges: bottom and two sides are Lines, the top is one Curve", () => {
  const p = testPiece();
  deepEq(cornersOf(p.paths[0]), [0, 1, 2, 22]);
  const es = edgesOf(p.paths[0]);
  deepEq(es.map(e => [e.a, e.b, e.kind]), [[0, 1, "line"], [1, 2, "line"], [2, 22, "curve"], [22, 0, "line"]]);
  deepEq(edgesOf(p.paths[1]).map(e => [e.a, e.b, e.kind]), [[0, 1, "line"]]);
});

test("S3 a LINE entity is always a Line; an ARC path is always a Curve", () => {
  const ar = {layer: "1", closed: false, pts: [[5, 0], [0, 5]], shapes: [arc(point(0, 0), 5, 0, Math.PI/2, true)]};
  deepEq(edgesOf(ar).map(e => [e.kind, e.whole]), [["curve", true]]);
});

test("S1 priority: a click near the notch picks the notch, not the bottom Line under it", () => {
  const p = testPiece(), r = pickAt([p], ALL, [30.5, 0.4], 2);
  eq(r.item.kind, "point"); eq(r.item.src, "entity"); eq(r.item.pt, 0);
});

test("S1 a click near a corner picks the corner as a Point of the path", () => {
  const r = pickAt([testPiece()], ALL, [99.5, 0.6], 2);
  eq(r.item.kind, "point"); eq(r.item.src, "vertex"); eq(r.item.path, 0); eq(r.item.v, 1);
});

test("S1 a click on the middle of the bottom picks the Line, and remembers where it was clicked", () => {
  const r = pickAt([testPiece()], ALL, [70, -1], 2);
  eq(r.item.kind, "line"); eq(r.item.path, 0); eq(r.item.a, 0); eq(r.item.b, 1);
  deepEq(r.item.click, [70, -1]);
});

test("S1 a click on the top picks the Curve", () => {
  const r = pickAt([testPiece()], ALL, [50, 70.5], 2);
  eq(r.item.kind, "curve"); eq(r.item.a, 2); eq(r.item.b, 22);
});

test("S1 inside the piece, away from every line: the Piece", () => {
  const r = pickAt([testPiece()], ALL, [20, 30], 2);
  eq(r.item.kind, "piece"); eq(r.pi, 0);
});

test("S1 out of reach of everything: nothing", () => {
  eq(pickAt([testPiece()], ALL, [300, 300], 2), null);
});

test("S2 the filter: Point only skips the Line; Curve only skips the Line; Piece only skips all lines", () => {
  const p = testPiece();
  eq(pickAt([p], ALL, [70, -1], 2, {filter: "point"}), null);
  eq(pickAt([p], ALL, [70, -1], 2, {filter: "curve"}), null);
  eq(pickAt([p], ALL, [50, 70.5], 2, {filter: "curve"}).item.kind, "curve");
  eq(pickAt([p], ALL, [30.5, 0.4], 2, {filter: "line"}).item.kind, "line");
  eq(pickAt([p], ALL, [70, -1], 2, {filter: "piece"}).item.kind, "piece");
});

test("S2 the edge filter (trim · extend · split) takes a Line or a Curve, never a Point", () => {
  const p = testPiece();
  eq(pickAt([p], ALL, [99.5, 0.6], 2, {filter: "edge"}).item.kind, "line", "next to a corner: the edge, not the corner");
  eq(pickAt([p], ALL, [50, 70.5], 2, {filter: "edge"}).item.kind, "curve");
  eq(pickAt([p], ALL, [20, 30], 2, {filter: "edge"}), null, "no piece either");
});

test("S1 a layer switched off is not a target", () => {
  const off = new Proxy({}, {get: (t, k) => k !== "4"});
  eq(pickAt([testPiece()], off, [30.5, 0.4], 2).item.kind, "line");
});

test("S4 picking changes no geometry", () => {
  const p = testPiece(), before = JSON.stringify([p.paths.map(q => q.pts), p.points]);
  for(const w of [[30.5, 0.4], [70, -1], [50, 70.5], [20, 30]]) pickAt([p], ALL, w, 2);
  eq(JSON.stringify([p.paths.map(q => q.pts), p.points]), before);
});

test("the pick radius is 8 screen pixels", () => { eq(PICK_PX, 8); });

test("targetsOf lists corners, entity points and edges of the visible layers", () => {
  const t = targetsOf(testPiece(), ALL);
  eq(t.points.filter(q => q.src === "entity").length, 1);
  eq(t.points.filter(q => q.src === "vertex").length, 4 + 2);        // 4 ring corners + the grainline's two ends
  eq(t.edges.length, 4 + 1);
});
