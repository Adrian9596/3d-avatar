/* Edges — every edge of a piece and its length (spec: edges/edges.md). Expected values are hand geometry:
   the sides of a rectangle or a triangle, a ring's closed perimeter summed by a plain loop here. */
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {segmentEdges, edgeLabelAt, edgeLetter} from "./segment.js";
import {edgeLine, edgeReadout} from "./edges.js";

/* a rectangle sampled the way a CAD file samples one: many points, corners sharp */
function sampled(w, h, step){
  const pts = [];
  for(let x = 0; x < w; x += step) pts.push([x, 0]);
  for(let y = 0; y < h; y += step) pts.push([w, y]);
  for(let x = w; x > 0; x -= step) pts.push([x, h]);
  for(let y = h; y > 0; y -= step) pts.push([0, y]);
  return pts;
}
/* a ring's perimeter, closed, by a plain loop */
const ringLen = pts => pts.reduce((s, q, i) => s + Math.hypot(pts[(i + 1) % pts.length][0] - q[0], pts[(i + 1) % pts.length][1] - q[1]), 0);
const lens = segs => segs.map(s => +s.len.toFixed(9));

test("a rectangle splits into its four sides", () => {
  const segs = segmentEdges(sampled(200, 100, 10));
  eq(segs.length, 4);
  const ls = segs.map(s => Math.round(s.len)).sort((a,b) => a-b);
  ok(ls[0] >= 95 && ls[1] <= 105, "two short sides near 100: " + ls);
  ok(ls[3] >= 195 && ls[3] <= 205, "two long sides near 200: " + ls);
});

test("the segments cover the whole ring once", () => {
  const segs = segmentEdges(sampled(200, 100, 10));
  near(segs.reduce((t, s) => t + s.len, 0), 600, 1);
});

test("a circle has no corners, so it stays one edge", () => {
  const pts = [];
  for(let i = 0; i < 120; i++) pts.push([50*Math.cos(i/120*2*Math.PI), 50*Math.sin(i/120*2*Math.PI)]);
  eq(segmentEdges(pts).length, 1);
});

/* ── G3 · G4 — a ring of fewer than 8 vertices (H3), a ring of one corner (H4), an open line ── */
test("G3 a rectangle of 4 vertices — a strap, a loop — is four sides, and they add up to the closed ring", () => {
  const segs = segmentEdges([[0, 0], [224, 0], [224, 42], [0, 42]]);
  deepEq(lens(segs), [224, 42, 224, 42], "một cạnh cho mỗi cặp góc");
  near(segs.reduce((t, s) => t + s.len, 0), 532, 1e-9, "tổng = chu vi khép kín (dây vai 3087: 224 × 42)");
  deepEq(segs[3].pts, [[0, 42], [0, 0]], "cạnh cuối là cạnh khép vòng");
});

test("G3 a small ring that repeats its first vertex at the end: still four sides, no side of length 0", () => {
  deepEq(lens(segmentEdges([[0, 0], [224, 0], [224, 42], [0, 42], [0, 0]])), [224, 42, 224, 42]);
  deepEq(lens(segmentEdges([[0, 0], [224, 0], [224, 0], [224, 42], [0, 42]])), [224, 42, 224, 42], "đỉnh lặp ở giữa");
});

test("G3 a triangle of three vertices: three sides — 10, 10 and 10√2", () => {
  const segs = segmentEdges([[0, 0], [10, 0], [10, 10]]);
  deepEq(lens(segs), [10, 10, +Math.hypot(10, 10).toFixed(9)]);
});

test("G3 a ring with one corner is one edge all the way round — not an edge of length 0 (H4)", () => {
  /* an ice-cream cone: a 300° arc of radius 50 and two lines tangent to it meeting at an apex; the apex is rounded
     by three vertices 1 mm apart, so several vertices turn there — and they are one corner */
  const pts = [];
  for(let d = 30; d <= 330; d += 3) pts.push([50*Math.cos(d*Math.PI/180), 50*Math.sin(d*Math.PI/180)]);
  const ax = 50/Math.cos(Math.PI/6);
  pts.push([ax - 1, -0.58], [ax, 0], [ax - 1, 0.58]);
  const segs = segmentEdges(pts);
  eq(segs.length, 1, "một cạnh");
  near(segs[0].len, ringLen(pts), 1e-9, "dài trọn vòng");
  ok(segs[0].pts.length === pts.length + 1, "đi hết mọi đỉnh và về lại góc");
});

test("G3 an open line: its two ends and its elbow are corners, and no edge closes it", () => {
  const segs = segmentEdges([[0, 0], [50, 0], [100, 0], [100, 60], [100, 100]], undefined, undefined, undefined, false);
  deepEq(lens(segs), [100, 100]);
  deepEq(segs[0].pts[0], [0, 0]); deepEq(segs[1].pts[segs[1].pts.length - 1], [100, 100]);
});

/* ── G5 — where the label goes, and what it is called ── */
test("G5 the label sits at half the edge's length, measured along it — a straight edge of two vertices at its middle", () => {
  const a = edgeLabelAt([[0, 0], [100, 0]]);
  deepEq(a.at, [50, 0], "giữa cạnh, không phải góc"); deepEq(a.dir, [1, 0]);
  /* sampled densely at one end: the middle vertex by index would be at x = 90 */
  const pts = [[0, 0]]; for(let x = 80; x <= 100; x += 1) pts.push([x, 0]);
  deepEq(edgeLabelAt(pts).at, [50, 0], "nửa chiều dài, không phải đỉnh giữa theo chỉ số");
  const L = edgeLabelAt([[0, 0], [30, 0], [30, 40]]);
  deepEq(L.at, [30, 5], "khúc gãy: 35 mm dọc cạnh"); deepEq(L.dir, [0, 1]);
  deepEq(edgeLabelAt([[7, 7], [7, 7]]).at, [7, 7], "cạnh dài 0: đỉnh của nó");
});

test("G5 edge letters: A … Z, then AA, AB …", () => {
  deepEq([0, 1, 25, 26, 27, 51, 52].map(edgeLetter), ["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
});

/* ── G1 — which line, and the readout says which ── */
const ring = [[0, 0], [200, 0], [200, 100], [0, 100]], seam = [[6, 6], [194, 6], [194, 94], [6, 94]];
const piece = {cut: ring, cutLen: 600, cutClosed: true, sew: seam, sewLen: 552, sewLayer: "14"};
const mm = v => v.toFixed(1) + " mm";

test("G1 the sewing line while its layer is on, else the cut line — named in the readout", () => {
  const all = {"1": true, "14": true};
  eq(edgeLine(piece, all).name, "đường may"); eq(edgeLine(piece, all).pts, seam);
  eq(edgeLine(piece, {...all, "14": false}).name, "đường cắt", "layer may đang tắt → đo đường cắt");
  eq(edgeLine(piece, {...all, "14": false}).pts, ring);
  eq(edgeLine({...piece, sew: null, sewLen: 0, sewLayer: null}, all).name, "đường cắt", "không có đường may");
  eq(edgeLine(piece, {"1": false, "14": false}).name, "đường may", "tắt cả hai: đường mảnh có, như trước");
  eq(edgeLine(piece).name, "đường may", "không nói layer: mọi layer đang bật");
  eq(edgeLine({cut: null, sew: null}), null);
  eq(edgeReadout(piece, mm, {"1": true, "14": true}).section, "Edges · đường may");
  eq(edgeReadout(piece, mm, {"1": true, "14": false}).section, "Edges · đường cắt");
});

test("G4 the readout: one row per edge, lettered, and a total that is the line's closed length", () => {
  const r = edgeReadout({...piece, sew: null, sewLen: 0, sewLayer: null}, mm);
  deepEq(r.rows.map(x => [x[0], x[1]]), [["A", "200.0 mm"], ["B", "100.0 mm"], ["C", "200.0 mm"], ["D", "100.0 mm"]]);
  deepEq(r.total, ["Total", "600.0 mm"]);
});
