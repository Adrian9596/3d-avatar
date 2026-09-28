/* BỘ 5 — Point-to-Point trên rập factory 3380 (spec: point_to_point.md §3).

   Expected value lấy từ nguồn NGOÀI kernel:
   (a) `hypot` viết tay trong tests/fixture3380.js,
   (b) turn point nhà máy đặt (layer 2), trùng đỉnh đường cắt chính xác,
   (c) vạch notch nhà máy vẽ sâu đúng 7 mm (đã đo được ở bộ Along Path). */
import {test, eq, near, ok} from "../../../tests/harness.js";
import {names, ringPts, pointsOn, hypot} from "../../../tests/fixture3380.js";
import {point, curve} from "./model.js";
import {chain, alongPath, locate} from "./path.js";
import {straight, nearestPoint} from "./straight.js";

const WING = "后比_L1", CRADLE = "前下摆_L3";
const ringOf = name => chain([curve(ringPts(name, "1"), true)]);
const anchors = name => {
  const pts = ringPts(name, "1");
  return pointsOn(name, "2").filter(q => pts.some(p => p[0] === q.x && p[1] === q.y));
};
const P = q => point(q.x, q.y);

/* ── P1 · khớp công thức tính tay ───────────────────────────────────────── */
test("mọi cặp turn point: khoảng cách khớp hypot viết tay", () => {
  for(const n of names){
    const a = anchors(n);
    for(let i = 0; i < a.length; i++) for(let j = i+1; j < a.length; j++)
      near(straight(P(a[i]), P(a[j])).distance,
           hypot([a[i].x, a[i].y], [a[j].x, a[j].y]), 1e-9, n);
  }
});

test("dx² + dy² = distance² trên toạ độ thật", () => {
  const a = anchors(WING);
  const r = straight(P(a[0]), P(a[3]));
  near(r.dx*r.dx + r.dy*r.dy, r.distance*r.distance, 1e-6);
});

/* ── P2 · đối xứng ──────────────────────────────────────────────────────── */
test("đo hai chiều ra cùng một số, dx/dy đổi dấu", () => {
  const a = anchors(CRADLE);
  const f = straight(P(a[0]), P(a[4])), b = straight(P(a[4]), P(a[0]));
  near(f.distance, b.distance, 1e-12);
  near(f.dx, -b.dx, 1e-12); near(f.dy, -b.dy, 1e-12);
});

/* ── P5 · quan hệ với Along Path ────────────────────────────────────────── */
test("đo thẳng không bao giờ dài hơn đo dọc đường, trên mọi cặp mốc của cả 4 mảnh", () => {
  for(const n of names){
    const ch = ringOf(n), a = anchors(n);
    for(let i = 0; i < a.length; i++) for(let j = i+1; j < a.length; j++){
      const s = straight(P(a[i]), P(a[j])).distance;
      const al = alongPath(ch, P(a[i]), P(a[j])).distance;
      ok(al >= s - 1e-9, `${n} cặp ${i}-${j}: dọc ${al} < thẳng ${s}`);
    }
  }
});

test("trên một cạnh thẳng thật của rập, hai phép đo cho cùng một số", () => {
  /* mốc 4→5 của 后比 là một đoạn thẳng nhà máy vẽ — chỗ duy nhất hai cách đo gặp nhau */
  const ch = ringOf(WING), a = anchors(WING);
  const s = straight(P(a[4]), P(a[5])).distance;
  const al = alongPath(ch, P(a[4]), P(a[5])).distance;
  near(al, s, 1e-9, "cạnh thẳng: dọc đường = chim bay");
  near(s, 102.559, 0.001, "và dài đúng 102.559 mm");

  /* chứng minh nó thẳng thật, không phải trùng số ngẫu nhiên: mọi đỉnh nằm giữa
     hai mốc đều nằm trên đường thẳng AB */
  const seg = alongPath(ch, P(a[4]), P(a[5])).shapes;
  const far = seg.flatMap(sh => sh.pts || []).map(([x, y]) => {
    const A = a[4], B = a[5], L = hypot([A.x, A.y], [B.x, B.y]);
    return Math.abs((B.x-A.x)*(A.y-y) - (A.x-x)*(B.y-A.y))/L;
  });
  ok(Math.max(...far) < 1e-6, `đỉnh xa đường thẳng nhất: ${Math.max(...far)} mm`);
});

test("trên cạnh cong thì đo dọc dài hơn hẳn — hai phép đo không thay nhau được", () => {
  const ch = ringOf(CRADLE), a = anchors(CRADLE);
  const s = straight(P(a[0]), P(a[6])).distance;
  const al = alongPath(ch, P(a[0]), P(a[6])).distance;
  ok(al - s > 10, `chênh mới ${al - s} mm — cặp này lẽ ra phải cong rõ`);
});

/* ── P4 · không cần chung một đường ─────────────────────────────────────── */
test("hai điểm ở hai MẢNH khác nhau vẫn đo thẳng được", () => {
  const w = anchors(WING)[0], c = anchors(CRADLE)[0];
  const r = straight(P(w), P(c));
  ok(r.distance > 0 && Number.isFinite(r.distance));
  near(r.distance, hypot([w.x, w.y], [c.x, c.y]), 1e-9);
});

test("cùng hai điểm đó thì Along Path phải từ chối, vì không có path liên tục", () => {
  let threw = false;
  try{ chain([curve(ringPts(WING, "1"), true), curve(ringPts(CRADLE, "1"), true)]); }
  catch(e){ threw = true; }
  ok(threw, "hai ring rời nhau không được lặng lẽ thành một path");
});

/* ── P1 + P6 · đo tới vạch notch nhà máy ────────────────────────────────── */
test("đo từ notch trên đường tới đuôi vạch của nó = 7 mm nhà máy vẽ", () => {
  const ch = ringOf(CRADLE);
  const marks = pointsOn(CRADLE, "4").map(q => ({q, d: locate(ch, P(q)).dist}));
  const on = marks.filter(m => m.d < 1e-6), off = marks.filter(m => m.d > 1e-6);
  ok(on.length && off.length, "phải có cả điểm trên đường và đuôi vạch");
  for(const t of off){
    const nearest = Math.min(...on.map(o => straight(P(o.q), P(t.q)).distance));
    near(nearest, 7, 0.02, "độ sâu vạch notch đo thẳng");
  }
});

test("bắt điểm trên rập thật: bấm lệch 3 mm vẫn về đúng turn point", () => {
  const a = anchors(WING);
  const pts = pointsOn(WING, "2").map(q => [q.x, q.y]);
  const hit = nearestPoint(pts, [a[2].x + 2, a[2].y + 2], 12/3);
  ok(hit, "phải bắt được");
  near(straight(point(hit.point[0], hit.point[1]), P(a[2])).distance, 0, 1e-9);
});
