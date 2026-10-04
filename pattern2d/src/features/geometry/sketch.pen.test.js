/* Đường in the sketch — the smart pen's open line among the other shapes (spec: sketch.md §8, L9).
   A Đường is a master, never a follower, like an outline (O14): what hangs on it is checked with this file's own
   rulers (a point-to-segment distance), never with the kernel's check(). */
import {test, eq, near, ok} from "../../../tests/harness.js";
import {createSketch, snapHit} from "./sketch.js";
import {createLine, createPolyline, createPoint} from "./entity.js";

const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const same = (a, b, msg) => ok(Object.is(a[0], b[0]) && Object.is(a[1], b[1]), `${msg}: [${a}] ≠ [${b}] (từng bit)`);
function distSeg(p, a, b){
  const d = [b[0] - a[0], b[1] - a[1]], dd = d[0]*d[0] + d[1]*d[1];
  const t = dd ? Math.max(0, Math.min(1, ((p[0] - a[0])*d[0] + (p[1] - a[1])*d[1])/dd)) : 0;
  return Math.hypot(p[0] - a[0] - d[0]*t, p[1] - a[1] - d[1]*t);
}
const onZig = (pts, p) => Math.min(...pts.slice(1).map((q, i) => distSeg(p, pts[i], q)));
const H = (id, handle) => ({id, handle});
const ZIG = [[0, 0], [40, 0], [40, 30], [90, 30]], TURNS = ["turn", "turn", "turn", "turn"];
const shot = sk => JSON.stringify(sk.snapshot());

test("L9 a Đường is added, read back frozen, dragged by a point and moved by its body — each a transaction", () => {
  const sk = createSketch(), P = sk.add(createPolyline(ZIG, TURNS), {id: "Duong1"});
  eq(P, "Duong1");
  const e = sk.get(P);
  eq(e.type, "polyline"); ok(Object.isFrozen(e) && Object.isFrozen(e.pts), "đóng băng như mọi hình của sketch");
  ok(sk.drag(H(P, "v2"), [45, 35]).ok);
  same(sk.get(P).pts[2], [45, 35], "v2 tới đích");
  same(sk.get(P).pts[1], [40, 0], "v1 đứng yên");
  ok(sk.move(P, 10, -5).ok);
  same(sk.get(P).pts[0], [10, -5], "dời cả đường");
  const r = sk.drag(H(P, "v1"), [10, -5]);
  ok(!r.ok && /trùng/.test(r.reason), `kéo v1 lên v0 → từ chối: ${r.reason}`);
  same(sk.get(P).pts[1], [50, -5], "bị từ chối: không gì đổi");
});

test("L9 a Line's end and a notch ride on a Đường: on it after it is reshaped and after it is moved", () => {
  const sk = createSketch(), P = sk.add(createPolyline(ZIG, TURNS)), L = sk.add(createLine([60, 31], [60, 80])), N = sk.add(createPoint([40, 12]));
  ok(sk.constrain("coincident", {id: P}, H(L, "a")).ok, "đầu line bám lên Đường");
  ok(sk.constrain("coincident", {id: P}, H(N, "p")).ok, "notch bám lên Đường");
  ok(onZig(sk.get(P).pts, sk.get(L).a) <= 1e-9, "đầu line nằm trên Đường");
  ok(onZig(sk.get(P).pts, sk.get(N).p) <= 1e-9, "notch nằm trên Đường");
  ok(sk.drag(H(P, "v3"), [90, 50]).ok, "kéo đầu cuối của Đường");
  ok(onZig(sk.get(P).pts, sk.get(L).a) <= 1e-9, `đầu line vẫn trên Đường (cách ${onZig(sk.get(P).pts, sk.get(L).a)})`);
  ok(onZig(sk.get(P).pts, sk.get(N).p) <= 1e-9, "notch vẫn trên Đường");
  const was = sk.get(N).p;
  ok(sk.move(P, 3, 4).ok);
  near(sk.get(N).p[0], was[0] + 3, 1e-9); near(sk.get(N).p[1], was[1] + 4, 1e-9, "dời Đường: notch dời theo");
  same(sk.get(L).b, [60, 80], "đầu tự do của line đứng yên");
});

test("L9 a Đường is never a follower, and takes no Equal, Tangent, Ngang or Dọc — refused with the reason, nothing changed", () => {
  const sk = createSketch(), P = sk.add(createPolyline(ZIG, TURNS)), L = sk.add(createLine([0, 50], [30, 50]));
  const before = shot(sk);
  const no = (r, re, msg) => { ok(!r.ok, `${msg}: phải từ chối`); ok(re.test(r.reason), `${msg}: "${r.reason}"`); };
  no(sk.constrain("coincident", {point: [0, 0]}, H(P, "v0")), /bên bám|không phải điểm để bám/, "đỉnh Đường làm bên bám");
  no(sk.constrain("coincident", {id: L}, H(P, "v3")), /bên bám|không phải điểm để bám/, "đầu Đường bám line");
  no(sk.constrain("equal", {id: L}, {id: P}), /Equal/, "Equal lên Đường");
  no(sk.constrain("horizontal", {id: P}), /chỉ áp cho/, "Ngang cho Đường");
  no(sk.constrain("vertical", {id: P}), /chỉ áp cho/, "Dọc cho Đường");
  no(sk.constrain("tangent", {id: P}, {id: L, handle: "a"}), /Tangent/, "Tiếp tuyến với Đường");
  eq(shot(sk), before, "không gì đổi");
});

test("L9 shapes snap to a Đường: its points, its straight spans as lines", () => {
  const sk = createSketch(); sk.add(createPolyline(ZIG, TURNS));
  const t = sk.targets(null);
  const r1 = snapHit([40.2, 29.9], t, 0.5); eq(r1.kind, "point"); same(r1.point, [40, 30], "hít đỉnh v2");
  const r2 = snapHit([65, 30.3], t, 0.5); eq(r2.kind, "line"); ok(hyp(r2.point, [65, 30]) <= 1e-9, "hít đoạn cuối");
  const sk2 = createSketch(), P = sk2.add(createPolyline(ZIG, TURNS));
  const snap = sk2.snapshot();
  ok(sk2.move(P, 1, 1).ok);
  sk2.restore(snap);
  same(sk2.get(P).pts[0], [0, 0], "snapshot / restore đưa về đúng từng bit");
});
