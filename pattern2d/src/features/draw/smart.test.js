/* The Bút tool's own rules, pure (spec: draw/smartpen.md B1 · B3 · B6 · B7 · B8 · B11 · B12, Q9 · Q10). Pieces built by hand
   (tests/edit_fixtures.js): every number below is known from the construction, not asked of the code. */
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {rectPiece, poly} from "../../../tests/edit_fixtures.js";
import {fileTargets, drawnTargets, pressOn, penStep, penShape, parallelShape, dragEnd, readOptLength, thinHandles, labelOf,
        PEN_POINT_LAYERS} from "./smart.js";
import {drawKey, openKey, dockGroups} from "./flow.js";
import {createLine, createRect, createCircle, createPolyline, createCurve} from "../geometry/entity.js";
import {lengthFormatter} from "../../shared/units.js";

const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const L = lengthFormatter("mm");
const ON = {"1": true, "2": true, "3": true, "4": true, "5": true, "7": true, "8": true};
const key = (k, extra = {}) => ({key: k, target: {matches: () => false}, ...extra});

test("B1 key 8 is the pen in Vẽ, and opens Vẽ at the pen from anywhere — not with ⌘ · Ctrl · ⌥, not while typing", () => {
  eq(drawKey(key("8")), "pen");
  eq(openKey(key("8")), "pen");
  for(const extra of [{metaKey: true}, {ctrlKey: true}, {altKey: true}, {target: {matches: () => true}}]) eq(openKey(key("8", extra)), null);
  eq(openKey(key("5")), null, "1–5 vẫn chỉ trong Vẽ");
  ok(dockGroups({mode: "pen", kind: "create", type: "pen"}).has("pen"), "dock: nhóm ô của Bút");
  ok(dockGroups({mode: "pen", kind: "create", type: "pen"}).has("line"), "dock: Length + Angle");
  ok(dockGroups({mode: "pen", kind: "create", type: "pen"}).has("layer"), "dock: Layer");
});

test("B7 the points a drag may start from: POINTs on 2 · 4 · 5, the corners, the ends — not a layer-3 POINT", () => {
  deepEq([...PEN_POINT_LAYERS].sort(), ["2", "4", "5"]);
  const p = rectPiece({grain: "inside"});
  p.points.push({layer: "3", x: 70, y: 0});
  const t = fileTargets(p, ON), at = t.points.map(q => q.at.join(","));
  for(const want of ["30,0", "20,30", "0,0", "100,0", "100,60", "0,60", "6,6", "50,15", "50,45"]) ok(at.includes(want), `có điểm ${want}`);
  ok(!at.includes("70,0"), "POINT layer 3 không phải điểm để kéo");
  /* the cut ring's four sides, the seam ring's four, the grainline */
  eq(t.edges.length, 9);
  const off = fileTargets(p, {...ON, "4": false, "8": false}).points.map(q => q.at.join(","));
  ok(!off.includes("30,0") && !off.includes("6,6"), "layer tắt: không có điểm của nó");
});

test("B6 · B7 what a press is on: a point within the pick radius wins over an edge; then the nearest edge; else blank", () => {
  const t = [{...fileTargets(rectPiece({grain: "inside"}), ON), owner: {pi: 0, pid: null}}];
  const a = pressOn(t, [30.4, 0.3], 1);
  eq(a.kind, "point"); deepEq(a.at, [30, 0]); deepEq(a.owner, {pi: 0, pid: null});
  const b = pressOn(t, [70, 0.4], 1);
  eq(b.kind, "edge"); near(b.dist, 0.4, 1e-12); deepEq(b.src.pts, [[0, 0], [100, 0]], "cạnh đáy của đường cắt");
  eq(pressOn(t, [70, 20], 1).kind, "blank");
  eq(pressOn(t, [70, 1.5], 1).kind, "blank", "ngoài bán kính nhặt");
});

test("B6 · B7 a drawn shape's edges and points: a rectangle's sides and corners, a circle whole with its centre, a line's ends", () => {
  const r = drawnTargets(createRect([10, 10], 40, 20));
  eq(r.edges.length, 4); eq(r.points.length, 4);
  deepEq(r.edges[0].src.pts, [[10, 10], [50, 10]]);
  const c = drawnTargets(createCircle([0, 0], 20));
  eq(c.edges.length, 1); deepEq(c.edges[0].src.circle, {c: [0, 0], r: 10}); deepEq(c.points.map(q => q.at), [[0, 0]]);
  const l = drawnTargets(createLine([0, 0], [30, 40]));
  eq(l.edges.length, 1); deepEq(l.points.map(q => q.at), [[0, 0], [30, 40]]);
  const k = drawnTargets(createCurve([0, 0], [100, 0], [30, 40], [70, 40]));
  eq(k.edges.length, 1, "curve trơn: một cạnh"); deepEq(k.points.map(q => q.at), [[0, 0], [100, 0]]);
});

test("B3 · B4 · Q10 a press of the pen: on the first point it closes, a double-click finishes, else it adds", () => {
  const pts = [[0, 0], [40, 0], [40, 30]];
  eq(penStep(pts, [0.5, 0.2], 1, {t: 9000, x: 0, y: 0}, null), "close");
  eq(penStep(pts.slice(0, 2), [0.5, 0.2], 1, {t: 9000, x: 0, y: 0}, null), "add", "2 điểm: chưa khép được");
  eq(penStep(pts, [60, 10], 1, {t: 1300, x: 100, y: 100}, {t: 1000, x: 102, y: 101}), "finish", "300 ms, 2.2 px");
  eq(penStep([[0, 0]], [60, 10], 1, {t: 1300, x: 100, y: 100}, {t: 1000, x: 100, y: 100}), "few");
  eq(penStep(pts, [60, 10], 1, {t: 1300, x: 100, y: 100}, {t: 1000, x: 100, y: 100, done: true}), "ignore");
  eq(penStep(pts, [60, 10], 1, {t: 1600, x: 100, y: 100}, {t: 1000, x: 100, y: 100}), "add", "600 ms: hai cú bấm");
  eq(penStep(pts, [60, 10], 1, {t: 1300, x: 108, y: 100}, {t: 1000, x: 100, y: 100}), "add", "8 px: hai cú bấm");
});

test("B3 two points are a Line, more are a Đường; the ends are corners", () => {
  const l = penShape([[0, 0], [30, 40]], ["turn", "curve"]);
  eq(l.type, "line"); deepEq(l.a, [0, 0]); deepEq(l.b, [30, 40]);
  const p = penShape([[0, 0], [30, 40], [60, 0]], ["curve", "curve", "turn"]);
  eq(p.type, "polyline"); deepEq(p.kinds, ["turn", "curve", "turn"]);
});

test("B6 the shape of a parallel: a Line, a Đường, a closed line, a Circle, an arc as a Đường on the arc", () => {
  const l = parallelShape({ok: true, kind: "line", pts: [[0, 10], [100, 10]]});
  eq(l.type, "line"); deepEq([l.a, l.b], [[0, 10], [100, 10]]);
  const p = parallelShape({ok: true, kind: "polyline", pts: [[0, 5], [45, 5], [45, 40]]});
  eq(p.type, "polyline"); deepEq(p.kinds, ["turn", "turn", "turn"]);
  const g = parallelShape({ok: true, kind: "ring", pts: [[6, 6], [94, 6], [94, 54], [6, 54]]});
  eq(g.type, "path"); deepEq(g.kinds, ["turn", "turn", "turn", "turn"]);
  const c = parallelShape({ok: true, kind: "circle", circle: {c: [10, 10], r: 30}});
  eq(c.type, "circle"); eq(c.d, 60); deepEq(c.c, [10, 10]);
  const a = parallelShape({ok: true, kind: "arc", arc: {c: [0, 0], r: 45, a0: 0, a1: Math.PI/2, ccw: true}});
  eq(a.type, "polyline");
  a.pts.forEach((q, i) => near(hyp(q, [0, 0]), 45, 1e-9, `đỉnh ${i} nằm trên cung r 45`));
  near(a.pts[0][0], 45, 1e-12); near(a.pts[a.pts.length - 1][1], 45, 1e-12);
  for(let i = 1; i < a.pts.length; i++){
    const m = [(a.pts[i][0] + a.pts[i - 1][0])/2, (a.pts[i][1] + a.pts[i - 1][1])/2];
    ok(45 - hyp(m, [0, 0]) <= 0.005 + 1e-12, `dây ${i} hụt cung ≤ 0.005 mm`);
  }
});

test("B8 a drag from a point: onto a line the compass; elsewhere a Line to the release — R long when Compa is typed", () => {
  const edge = {src: {pts: [[100, 0], [100, 60]], closed: false}};
  const a = dragEnd([30, 0], [100, 30], {edge, R: null, snapped: [100, 30]});
  ok(a.ok, a.reason); eq(a.kind, "compass"); near(a.end[0], 100, 1e-9); near(a.end[1], 30, 1e-9);
  const b = dragEnd([30, 0], [100, 30], {edge, R: 74, snapped: [100, 30]});
  ok(b.ok); near(b.end[1], 24, 1e-9, "70² + 24² = 74²");
  const c = dragEnd([30, 0], [100, 30], {edge, R: 50, snapped: [100, 30]});
  ok(!c.ok && /không tới/.test(c.reason), `R 50 không tới x = 100: ${c.reason}`);
  const d = dragEnd([30, 0], [60, 40], {edge: null, R: null, snapped: [60, 40]});
  ok(d.ok); eq(d.kind, "line"); deepEq(d.end, [60, 40]);
  const e = dragEnd([30, 0], [60, 40], {edge: null, R: 10, snapped: [60, 40]});
  ok(e.ok); near(e.end[0], 36, 1e-12); near(e.end[1], 8, 1e-12);
  ok(!dragEnd([30, 0], [30, 0], {edge: null, R: null, snapped: [30, 0]}).ok, "dài 0");
});

test("B11 · Q8 the boxes: Cách and Compa a length ≥ 0 or empty; dx and dy may be negative, fractions too", () => {
  deepEq(readOptLength("", "inch"), {ok: true, mm: null});
  deepEq(readOptLength("  ", "mm"), {ok: true, mm: null});
  near(readOptLength("1/4", "inch").mm, 6.35, 1e-12);
  near(readOptLength("6", "mm").mm, 6, 0);
  ok(!readOptLength("-6", "mm").ok, "Cách âm");
  ok(!readOptLength("abc", "mm").ok, "chữ");
  near(readOptLength("-1/4", "inch", {signed: true}).mm, -6.35, 1e-12);
  near(readOptLength("+3mm", "inch", {signed: true}).mm, 3, 1e-12);
  ok(!readOptLength("- x", "mm", {signed: true}).ok, "dấu trừ rồi chữ");
});

test("Q9 a dense Đường shows its ends and the handles at least minDist apart", () => {
  const pts = Array.from({length: 101}, (_, i) => [i*0.5, 0]);
  const hs = thinHandles([...pts.map((at, k) => ({name: `v${k}`, at, role: "shape"})), {name: "body", at: null, role: "position"}], 8);
  const v = hs.filter(h => h.at);
  eq(v[0].name, "v0"); eq(v[v.length - 1].name, "v100");
  for(let i = 1; i < v.length - 1; i++) ok(hyp(v[i].at, v[i - 1].at) >= 8, `tay nắm ${v[i].name} cách tay nắm trước ≥ 8`);
  ok(hs.some(h => h.name === "body"), "thân vẫn nắm được");
  eq(thinHandles([{name: "v0", at: [0, 0]}, {name: "v1", at: [30, 0]}], 8).length, 2, "ít điểm: giữ hết");
});

test("B12 the label says what will happen, in the display unit", () => {
  eq(labelOf({kind: "first"}, L), "điểm đầu");
  eq(labelOf({kind: "first", offset: [5, -2]}, L), "điểm đầu · lệch 5.0 mm, -2.0 mm");
  eq(labelOf({kind: "point", curve: true, snap: "point"}, L), "điểm cong · hít điểm");
  eq(labelOf({kind: "point", lock: "tsquare", dir: 2}, L), "điểm · dọc");
  eq(labelOf({kind: "point", lock: "tsquare", dir: 1}, L), "điểm · 45°");
  eq(labelOf({kind: "point", lock: "square", dir: 3}, L), "điểm · ⊥ thước");
  eq(labelOf({kind: "close", piece: true}, L), "khép → mảnh");
  eq(labelOf({kind: "parallel", d: 6}, L), "song song · 6.0 mm");
  eq(labelOf({kind: "compass", R: 74}, L), "compa · 74.0 mm");
  eq(labelOf({kind: "hint", what: "parallel"}, L), "kéo: song song");
  eq(labelOf({kind: "refuse", reason: "không tới"}, L), "không tới");
});
