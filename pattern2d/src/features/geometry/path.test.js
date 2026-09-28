/* Along Path — bộ test tổng hợp (spec: along_path.md).

   Expected value KHÔNG lấy từ kernel: số kỳ vọng là hình học tính tay (3-4-5,
   100·π/2, chu vi hình chữ nhật) hoặc vòng lặp trần viết ngay trong test. */
import {test, eq, near, ok} from "../../../tests/harness.js";
import {point, line, arc, curve, length} from "./model.js";
import {chain, chainLength, locate, pointAtS, subPath, alongPath} from "./path.js";

const P = (x, y) => point(x, y);
const TOL = 1e-9;

/* trọng tài: chiều dài polyline tính bằng vòng lặp trần */
const rawLen = pts => {
  let s = 0;
  for(let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]);
  return s;
};

/* Đường chạy điền kinh: thẳng 200 → nửa cung r=50 → thẳng 200.
   Chiều dài tính tay: 200 + π·50 + 200 = 557.0796327 mm */
const L1 = line(P(0, 0), P(200, 0));
const ARC = arc(P(200, 50), 50, -Math.PI/2, Math.PI/2, true);
const L2 = line(P(200, 100), P(0, 100));
const TRACK = 400 + 50*Math.PI;

/* ── S1 · chiều dài từng kiểu, công thức đóng ───────────────────────────── */
test("S1 line: tam giác 3-4-5 → 500 mm", () =>
  near(chainLength(chain([line(P(0, 0), P(300, 400))])), 500, TOL));

test("S1 arc: cung phần tư r=100 → 100·π/2, không phải dây cung", () =>
  near(chainLength(chain([arc(P(0, 0), 100, 0, Math.PI/2, true)])), 100*Math.PI/2, TOL));

test("S1 curve: tổng dây cung khớp vòng lặp trần", () => {
  const pts = [[0, 0], [100, 0], [100, 50], [0, 50]];
  near(chainLength(chain([curve(pts, false)])), rawLen(pts), TOL);
  near(rawLen(pts), 250, TOL, "tính tay: 100 + 50 + 100");
});

/* ── S3 · tổng của cả path ──────────────────────────────────────────────── */
test("S3 chain nhiều segment: tổng = cộng chiều dài từng geometry", () => {
  const ch = chain([L1, ARC, L2]);
  eq(ch.parts.length, 3);
  near(ch.total, TRACK, TOL);
  near(chainLength(ch), TRACK, TOL);
  near(chainLength(ch), ch.parts.reduce((s, p) => s + length(p.shape), 0), TOL);
});

test("S3 chain giữ nguyên kiểu từng geometry, không dàn hết thành polyline", () => {
  const ch = chain([L1, ARC, L2]);
  eq(ch.parts.map(p => p.shape.kind).join(","), "line,arc,line");
});

/* ── S2 · cộng đúng: không hụt mối nối, không đếm hai lần ───────────────── */
test("S2 distance = tổng chiều dài các phần đi qua", () => {
  const ch = chain([L1, ARC, L2]);
  const r = alongPath(ch, P(100, 0), P(100, 100));
  near(r.parts.reduce((s, p) => s + p.length, 0), r.distance, TOL);
  near(r.distance, 100 + 50*Math.PI + 100, TOL, "tính tay: nửa thẳng + nửa cung + nửa thẳng");
});

test("S2 đo trọn path hở = chiều dài path", () => {
  const ch = chain([L1, ARC, L2]);
  near(alongPath(ch, P(0, 0), P(0, 100)).distance, TRACK, TOL);
});

test("S2 đo trong lòng một segment không đụng tới segment khác", () => {
  const ch = chain([L1, ARC, L2]);
  const r = alongPath(ch, P(40, 0), P(160, 0));
  eq(r.parts.length, 1);
  near(r.distance, 120, TOL);
});

/* ── S4 · xâu path không phụ thuộc thứ tự và chiều vẽ ───────────────────── */
test("S4 xáo thứ tự và lật chiều vẫn ra cùng một path", () => {
  const flipped = [line(P(0, 100), P(200, 100)),                       // L2 vẽ ngược
                   arc(P(200, 50), 50, Math.PI/2, -Math.PI/2, false),  // cung vẽ ngược
                   line(P(200, 0), P(0, 0))];                          // L1 vẽ ngược
  const ch = chain([flipped[1], flipped[2], flipped[0]]);              // lại xáo thứ tự
  eq(ch.parts.length, 3);
  near(ch.total, TRACK, TOL);
  near(alongPath(ch, P(0, 0), P(0, 100)).distance, TRACK, TOL);
});

test("S4 hình point bị loại, không sinh đoạn dài 0", () => {
  const ch = chain([L1, point(500, 500), ARC, L2]);
  eq(ch.parts.length, 3);
  near(ch.total, TRACK, TOL);
});

/* ── S5 · đứt đoạn thì báo lỗi, không trả số ────────────────────────────── */
test("S5 path đứt đoạn → ném lỗi chứ không đo phần nối được", () => {
  let msg = "";
  try{ chain([line(P(0, 0), P(100, 0)), line(P(200, 0), P(300, 0))]); }
  catch(e){ msg = e.message; }
  ok(/đứt đoạn/.test(msg), `phải báo đứt đoạn, nhận: "${msg}"`);
});

test("S5 khe nhỏ hơn tol thì vẫn là một path", () => {
  const ch = chain([line(P(0, 0), P(100, 0)), line(P(100.02, 0), P(200.02, 0))], {tol: 0.05});
  eq(ch.parts.length, 2);
  near(ch.total, 200, 0.05);
});

test("S5 path rỗng → ném lỗi", () => {
  let threw = false;
  try{ chain([]); }catch(e){ threw = true; }
  ok(threw, "không có hình nào thì không có gì để đo");
});

/* ── S6 · path kín có hai lối đi ────────────────────────────────────────── */
const RING = curve([[0, 0], [100, 0], [100, 50], [0, 50]], true);     // chu vi tính tay = 300

test("S6 ring kín: chu vi 300 và cờ closed", () => {
  const ch = chain([RING]);
  ok(ch.closed, "curve closed phải nhận ra là path kín");
  near(chainLength(ch), 300, TOL);
});

test("S6 forward + backward = chu vi; short ≤ long", () => {
  const ch = chain([RING]);
  const r = alongPath(ch, P(0, 0), P(100, 0));
  near(r.forward + r.backward, 300, TOL);
  near(r.distance, 100, TOL, "lối ngắn: cạnh dưới");
  near(alongPath(ch, P(0, 0), P(100, 0), {direction: "long"}).distance, 200, TOL);
  near(alongPath(ch, P(0, 0), P(100, 0), {direction: "backward"}).distance, 200, TOL);
  near(alongPath(ch, P(0, 0), P(100, 0), {direction: "forward"}).distance, 100, TOL);
});

test("S6 lối ngắn đi qua đúng các cạnh, lối dài đi qua phần còn lại", () => {
  const ch = chain([RING]);
  const short = alongPath(ch, P(0, 0), P(100, 0));
  const long  = alongPath(ch, P(0, 0), P(100, 0), {direction: "long"});
  near(short.parts.reduce((s, p) => s + p.length, 0) +
       long.parts.reduce((s, p) => s + p.length, 0), 300, TOL);
});

/* ── S7 · chiếu điểm bấm lên path ───────────────────────────────────────── */
test("S7 điểm bấm giữa hai đỉnh vẫn đo đúng, không nhảy về đỉnh", () => {
  const ch = chain([RING]);
  const l = locate(ch, P(50, -7));
  near(l.s, 50, TOL, "rơi vào giữa cạnh dưới");
  near(l.dist, 7, TOL, "và cách path 7 mm");
  near(l.point.x, 50, TOL); near(l.point.y, 0, TOL);
});

test("S7 offPath báo đúng điểm bấm lệch nhất", () => {
  const ch = chain([RING]);
  near(alongPath(ch, P(50, -7), P(50, 51)).offPath, 7, TOL);
});

test("S7 pointAtS đi đúng s mm dọc theo path", () => {
  const ch = chain([L1, ARC, L2]);
  const a = pointAtS(ch, 200);                       // đúng mối nối thẳng → cung
  near(a.x, 200, TOL); near(a.y, 0, TOL);
  const b = pointAtS(ch, 200 + 25*Math.PI);          // nửa cung: đỉnh ngoài
  near(b.x, 250, 1e-9); near(b.y, 50, 1e-9);
  const c = pointAtS(ch, 0);
  near(c.x, 0, TOL); near(c.y, 0, TOL);
});

/* ── S8 · đo dọc đường khác đo chim bay ─────────────────────────────────── */
test("S8 cung phần tư: dọc đường 157.08 so với chim bay 141.42", () => {
  const ch = chain([arc(P(0, 0), 100, 0, Math.PI/2, true)]);
  const r = alongPath(ch, P(100, 0), P(0, 100));
  near(r.distance, 100*Math.PI/2, TOL);
  near(r.direct, 100*Math.SQRT2, TOL);
  ok(r.distance > r.direct, "dây cung luôn ngắn hơn cung");
});

test("S8 trên đoạn thẳng thì hai cách đo bằng nhau", () => {
  const r = alongPath(chain([L1]), P(20, 0), P(180, 0));
  near(r.distance, r.direct, TOL);
  near(r.distance, 160, TOL);
});

/* ── S9 · khúc vẽ ra đúng bằng khúc được đo ─────────────────────────────── */
test("S9 subPath cộng lại đúng bằng distance", () => {
  const ch = chain([L1, ARC, L2]);
  const r = alongPath(ch, P(100, 0), P(100, 100));
  const seg = subPath(ch, r.at.from.s, r.at.to.s);
  near(seg.reduce((s, x) => s + length(x), 0), r.distance, TOL);
  eq(seg.map(s => s.kind).join(","), "line,arc,line");
});

test("S9 subPath trọn path hở = chiều dài path", () => {
  const ch = chain([L1, ARC, L2]);
  near(subPath(ch, 0, ch.total).reduce((s, x) => s + length(x), 0), chainLength(ch), TOL);
});

test("S9 subPath trên ring kín vòng qua điểm đầu", () => {
  const ch = chain([RING]);
  const seg = subPath(ch, 280, 20);                  // 20 mm cuối + 20 mm đầu
  near(seg.reduce((s, x) => s + length(x), 0), 40, TOL);
});

test("S9 đi ngược trên path hở trả về khúc đã lật chiều", () => {
  const ch = chain([L1]);
  const seg = subPath(ch, 180, 20);
  near(seg.reduce((s, x) => s + length(x), 0), 160, TOL);
  near(seg[0].a.x, 180, TOL, "đi ngược thì bắt đầu ở 180");
});
