/* Đường as an entity — the smart pen's open line in the table of shapes (spec: sketch.md §8, L1 · L6 · L7 · L8).
   Expected values come from the construction itself (points typed here, distances by hand), never from the kernel. */
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {ENTITY_TYPES, PIECE_ENTITY_TYPES, PEN_ENTITY_TYPES, createPolyline, entityHandles, entityShape, entitySnap, entityDims,
        moveEntity, dragEntity, setEntityDim, setPathKind} from "./entity.js";
import {pointAt, length} from "./model.js";

const same = (a, b) => Object.is(a[0], b[0]) && Object.is(a[1], b[1]);
const throwsLike = (fn, re, msg) => {
  let err = null; try{ fn(); }catch(e){ err = e; }
  ok(err, `${msg}: phải từ chối`); ok(err && re.test(err.message), `${msg}: lời từ chối "${err && err.message}" không khớp ${re}`);
};
const ZIG = [[0, 0], [40, 0], [40, 30], [90, 30]];
const TURNS = ["turn", "turn", "turn", "turn"];
const ARCH = [[0, 0], [30, 20], [60, 10], [100, 40]];

test("L7 PEN_ENTITY_TYPES is the open line alone — the table of five and the piece's two are unchanged", () => {
  deepEq(PEN_ENTITY_TYPES, ["polyline"]);
  deepEq(ENTITY_TYPES, ["line", "curve", "rect", "circle", "polygon"]);
  deepEq(PIECE_ENTITY_TYPES, ["path", "point"]);
});

test("L1 createPolyline keeps the points bit for bit, its ends as corners, and no array of the caller", () => {
  const src = ZIG.map(p => p.slice()), kinds = ["curve", "curve", "turn", "curve"];
  const e = createPolyline(src, kinds);
  eq(e.type, "polyline");
  e.pts.forEach((p, i) => ok(same(p, ZIG[i]), `điểm ${i}`));
  deepEq(e.kinds, ["turn", "curve", "turn", "turn"], "hai đầu là góc");
  ok(e.pts !== src && e.pts[0] !== src[0] && e.kinds !== kinds, "không giữ mảng của người gọi");
  deepEq(kinds, ["curve", "curve", "turn", "curve"], "mảng của người gọi không bị sửa");
  throwsLike(() => createPolyline([[0, 0]], ["turn"]), /ít nhất 2/, "một điểm");
  throwsLike(() => createPolyline([[0, 0], [0, 0]], ["turn", "turn"]), /trùng/, "hai điểm trùng");
});

test("L7 handles: every point reshapes, the body moves; the kernel shape, snap points and dimensions", () => {
  const e = createPolyline(ZIG, TURNS);
  const h = entityHandles(e);
  deepEq(h.map(x => x.name), ["v0", "v1", "v2", "v3", "body"]);
  deepEq(h.map(x => x.role), ["shape", "shape", "shape", "shape", "position"]);
  ok(h[1].at !== e.pts[1] && same(h[1].at, e.pts[1]), "tay nắm là bản sao, đúng chỗ");
  const s = entityShape(e);
  eq(s.kind, "curve"); eq(s.closed, false); deepEq(s.pts, ZIG);
  const sn = entitySnap(e);
  deepEq(sn.points, ZIG); deepEq(sn.handles, ["v0", "v1", "v2", "v3"]);
  eq(sn.shapes.length, 3); ok(sn.shapes.every(x => x.kind === "line"), "đoạn thẳng là line");
  const d = entityDims(e);
  eq(d.length, 40 + 30 + 50); eq(d.points, 4); eq(d.turns, 4); eq(d.curves, 0);
  /* with curve points: a smooth kernel shape through every point, its ends exactly the ends placed */
  const c = createPolyline(ARCH, ["turn", "curve", "curve", "turn"]), cs = entityShape(c);
  eq(cs.kind, "spline");
  const a = pointAt(cs, 0), b = pointAt(cs, 1);
  eq(a.x, 0); eq(a.y, 0); eq(b.x, 100); eq(b.y, 40);
  const cd = entityDims(c);
  near(cd.length, length(cs), 1e-6); eq(cd.turns, 2); eq(cd.curves, 2);
  ok(entitySnap(c).shapes.every(x => x.kind === "spline"), "đoạn cong là curve (bezier)");
});

test("L6 · L7 move and drag: every point by exactly dx, dy; v_k alone to the target; the body by target − from", () => {
  const e = createPolyline(ARCH, ["turn", "curve", "curve", "turn"]);
  const m = moveEntity(e, 2.5, -1);
  m.pts.forEach((p, i) => { eq(p[0], ARCH[i][0] + 2.5); eq(p[1], ARCH[i][1] - 1); });
  deepEq(m.kinds, e.kinds); eq(m.type, "polyline");
  const d = dragEntity(e, "v2", [61, 14]);
  d.pts.forEach((p, i) => ok(i === 2 ? same(p, [61, 14]) : same(p, ARCH[i]), `v${i}`));
  const b = dragEntity(e, "body", [10, 10], [4, 7]);
  b.pts.forEach((p, i) => { eq(p[0], ARCH[i][0] + 6); eq(p[1], ARCH[i][1] + 3); });
  throwsLike(() => dragEntity(e, "v7", [0, 0]), /không có/, "tay nắm không có");
  ok(Object.is(e.pts[2][0], 60), "hình cũ không bị sửa");
});

test("L7 an open line has no dimension to set", () => {
  const e = createPolyline(ZIG, TURNS);
  for(const dim of ["length", "w", "d", "size", "angle"]) throwsLike(() => setEntityDim(e, dim, 10), /không có kích thước|chỉ có/, dim);
});

test("L8 Góc ⇄ Cong turns an inner point from corner to curve point and back; an end stays a corner", () => {
  const e = createPolyline(ZIG, TURNS);
  const c = setPathKind(e, 1, "curve");
  eq(c.type, "polyline"); deepEq(c.kinds, ["turn", "curve", "turn", "turn"]);
  deepEq(setPathKind(c, 1, "turn").kinds, TURNS);
  throwsLike(() => setPathKind(e, 0, "curve"), /đầu/, "đầu đầu");
  throwsLike(() => setPathKind(e, 3, "curve"), /đầu/, "đầu cuối");
  throwsLike(() => setPathKind(e, 4, "curve"), /không có điểm/, "điểm không có");
});
