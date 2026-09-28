/* BỘ 4 — Along Path trên rập factory 3380 (spec: along_path.md §3).

   Expected value lấy từ nguồn NGOÀI kernel:
   (a) `measured` trong fixture — parser Python riêng của scripts/make_fixture.py,
   (b) vòng lặp trần đi trên chính các đỉnh polyline nhà máy vẽ,
   (c) turn point nhà máy đặt (layer 2) — chúng trùng đỉnh đường cắt chính xác,
   (d) quyết định đã ghi: rập cradle 3380 đối xứng hoàn toàn (CLAUDE.md §8). */
import {test, eq, near, ok} from "../../../tests/harness.js";
import {names, ringPts, pointsOn, measured, hypot} from "../../../tests/fixture3380.js";
import {point, curve, length} from "./model.js";
import {chain, chainLength, locate, subPath, alongPath} from "./path.js";

const WING = "后比_L1", CUP = "杯面_L2", CRADLE = "前下摆_L3", BINDING = "杯口_L4";
const ringOf = (name, layer = "1") => chain([curve(ringPts(name, layer), true)]);

/* ── trọng tài: đi bộ trên đỉnh polyline, không đụng tới kernel ─────────── */
const idxOf = (pts, q) => pts.findIndex(p => p[0] === q[0] && p[1] === q[1]);
function rawWalk(pts, i, j){
  let s = 0;
  for(let k = i, guard = 0; k !== j && guard <= pts.length; k = (k+1) % pts.length, guard++)
    s += hypot(pts[k], pts[(k+1) % pts.length]);
  return s;
}
/* turn point nhà máy nằm đúng trên đường cắt và đúng tại một đỉnh của nó */
const anchors = name => {
  const pts = ringPts(name, "1");
  return pointsOn(name, "2").filter(q => idxOf(pts, [q.x, q.y]) >= 0);
};

/* ── S10 · chu vi path = số đo của parser độc lập ───────────────────────── */
test("chu vi đường cắt cả 4 mảnh khớp parser độc lập trong fixture", () => {
  for(const n of names)
    near(chainLength(ringOf(n)), measured(n).cut_perimeter, 1e-3, n);
});

test("chu vi đường may cả 4 mảnh khớp parser độc lập trong fixture", () => {
  for(const n of names)
    near(chainLength(ringOf(n, "8")), measured(n).sew_perimeter, 1e-3, n);
});

/* ── S1+S2 · đo giữa hai turn point nhà máy = đi bộ trên đỉnh ───────────── */
test("mỗi mảnh: đo giữa hai turn point nhà máy khớp vòng lặp trần", () => {
  for(const n of names){
    const pts = ringPts(n, "1"), ch = ringOf(n), a = anchors(n);
    ok(a.length >= 2, `${n}: cần ít nhất 2 turn point trên đường cắt`);
    const i = idxOf(pts, [a[0].x, a[0].y]), j = idxOf(pts, [a[1].x, a[1].y]);
    const want = rawWalk(pts, i, j);                       // đi xuôi theo chiều vẽ
    const got = alongPath(ch, point(a[0].x, a[0].y), point(a[1].x, a[1].y), {direction: "forward"});
    near(got.distance, want, 1e-9, n);
    near(got.parts.reduce((s, p) => s + p.length, 0), got.distance, 1e-9, `${n}: cộng lại`);
  }
});

test("đo dọc đường luôn ≥ đo chim bay, trên mọi cặp turn point của wing", () => {
  const ch = ringOf(WING), a = anchors(WING);
  for(let i = 0; i < a.length; i++) for(let j = i+1; j < a.length; j++){
    const r = alongPath(ch, point(a[i].x, a[i].y), point(a[j].x, a[j].y));
    ok(r.distance >= r.direct - 1e-9, `cặp ${i}-${j}: ${r.distance} < ${r.direct}`);
  }
});

test("cộng dồn: A→B rồi B→C bằng đúng A→C (đi cùng một chiều)", () => {
  const ch = ringOf(WING), a = anchors(WING);
  const [A, B, C] = [a[1], a[2], a[3]].map(q => point(q.x, q.y));
  const d = (p, q) => alongPath(ch, p, q, {direction: "forward"}).distance;
  near(d(A, B) + d(B, C), d(A, C), 1e-9);
});

/* ── S6 · ring kín có hai lối, cộng lại bằng chu vi ─────────────────────── */
test("杯口: hai lối đi giữa hai turn point cộng lại bằng chu vi", () => {
  const ch = ringOf(BINDING), a = anchors(BINDING);
  const r = alongPath(ch, point(a[0].x, a[0].y), point(a[1].x, a[1].y));
  near(r.forward + r.backward, measured(BINDING).cut_perimeter, 1e-3);
  ok(r.distance <= r.total - r.distance + 1e-9, "mặc định phải là lối ngắn");
  near(r.distance, Math.min(r.forward, r.backward), 1e-9);
  near(alongPath(ch, point(a[0].x, a[0].y), point(a[1].x, a[1].y), {direction: "long"}).distance,
       Math.max(r.forward, r.backward), 1e-9);
});

test("cradle đối xứng: hai notch CF/CB chia chu vi làm đôi (CLAUDE.md §8)", () => {
  const ch = ringOf(CRADLE);
  const marks = pointsOn(CRADLE, "4").filter(q => locate(ch, point(q.x, q.y)).dist < 1e-6);
  ok(marks.length >= 2, "cradle phải có notch nằm trên đường cắt");
  const r = alongPath(ch, point(marks[0].x, marks[0].y), point(marks[1].x, marks[1].y));
  near(r.forward, measured(CRADLE).cut_perimeter/2, 0.01, "nửa chu vi");
  near(r.backward, measured(CRADLE).cut_perimeter/2, 0.01, "nửa còn lại");
});

/* ── S4 · xâu lại rập thật đã bị cắt vụn và xáo trộn ────────────────────── */
test("cắt ring thật thành 3 khúc, xáo thứ tự + lật chiều → vẫn đúng chu vi", () => {
  const ch = ringOf(WING), P = ch.total;          // chu vi đầy đủ, không phải số đã làm tròn
  const cuts = [0, P*0.31, P*0.77];
  const bits = [subPath(ch, cuts[0], cuts[1]), subPath(ch, cuts[1], cuts[2]), subPath(ch, cuts[2], P)]
    .map(seg => seg.length === 1 ? seg[0] : curve(seg.flatMap(s => s.pts), false));
  const shuffled = [bits[2], curve(bits[0].pts.slice().reverse(), false), bits[1]];
  const back = chain(shuffled, {tol: 1e-6});
  ok(back.closed, "ba khúc ráp lại phải thành ring kín");
  near(chainLength(back), P, 1e-6);
  near(P, measured(WING).cut_perimeter, 1e-3, "và P vẫn là chu vi nhà máy");
});

/* ── S7 · điểm bấm lệch khỏi đường ──────────────────────────────────────── */
test("đuôi vạch notch của nhà máy nằm cách đường cắt đúng 7 mm", () => {
  const ch = ringOf(CRADLE);
  const off = pointsOn(CRADLE, "4").map(q => locate(ch, point(q.x, q.y)).dist).filter(d => d > 1e-6);
  ok(off.length > 0, "phải có điểm nằm ngoài đường cắt");
  for(const d of off) near(d, 7, 0.02, "độ sâu vạch notch");
});

test("bấm hụt ra ngoài mảnh vẫn đo được, và offPath nói rõ hụt bao nhiêu", () => {
  const ch = ringOf(CUP), a = anchors(CUP);
  const r = alongPath(ch, point(a[0].x + 12, a[0].y), point(a[1].x, a[1].y));
  ok(r.offPath > 0, "phải báo có điểm không nằm trên đường");
  ok(r.offPath <= 12 + 1e-9, "và không báo quá khoảng cách thật");
});

/* ── S9 · khúc vẽ ra đúng bằng khúc được đo, trên toạ độ thật ───────────── */
test("subPath trên rập thật cộng lại đúng bằng distance", () => {
  for(const n of names){
    const ch = ringOf(n), a = anchors(n);
    const r = alongPath(ch, point(a[0].x, a[0].y), point(a[1].x, a[1].y));
    const seg = r.direction === "forward" ? subPath(ch, r.at.from.s, r.at.to.s)
                                          : subPath(ch, r.at.to.s, r.at.from.s);
    near(seg.reduce((s, x) => s + length(x), 0), r.distance, 1e-9, n);
  }
});
