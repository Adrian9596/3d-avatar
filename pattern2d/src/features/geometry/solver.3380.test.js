/* BỘ 3 — phép tính trên input cố định của rập 3380, đối chiếu expected value.
   Mỗi expected value đến từ một nguồn KHÁC kernel: vòng lặp trần trong chính test,
   số đo trong input/reference_shapes.md, hoặc đường may do nhà máy vẽ sẵn. */
import {test, eq, near, deepEq, ok} from "../../../tests/harness.js";
import {names, ringPts, pointsOn, lineOn, measured, hypot, rawPerimeter, rawBBox,
        rawDistToPolyline, median, pct} from "../../../tests/fixture3380.js";
import {point, line, curve, length, bbox, closestPoint, sample} from "./model.js";
import {move, scale, rotate, offset, trim, extend, measure, angleBetween} from "./ops.js";

const WING = "后比_L1", CUP = "杯面_L2", CRADLE = "前下摆_L3", BINDING = "杯口_L4";
const ring = (n, l) => curve(ringPts(n, l), true);

/* ── distance ─────────────────────────────────────────────────────────── */
test("distance điểm ↔ điểm: hai notch thật cách nhau 100.8500 mm", () => {
  const [a, b] = pointsOn(CRADLE, "4");
  const got = measure(point(a.x, a.y), point(b.x, b.y)).distance;
  near(got, hypot([a.x, a.y], [b.x, b.y]), 1e-12, "khớp hypot tính tay");
  near(got, 100.85, 1e-4);
});

test("distance điểm ↔ đường: khớp phép chiếu tính tay trên từng đoạn", () => {
  const pts = ringPts(CRADLE, "1");
  for(const n of pointsOn(CRADLE, "4")){
    const got = measure(point(n.x, n.y), curve(pts, true)).distance;
    near(got, rawDistToPolyline([n.x, n.y], pts, true), 1e-9);
  }
});

test("distance đường ↔ đường: khe hẹp nhất giữa đường cắt và đường may 后比", () => {
  const cut = ringPts(WING, "1"), sew = ringPts(WING, "8");
  const expected = Math.min(...sew.map(q => rawDistToPolyline(q, cut, true)));
  near(measure(ring(WING, "1"), ring(WING, "8")).distance, expected, 0.01);
  near(expected, 1.589, 0.002, "số này là của rập nhà máy, không phải của kernel");
});

/* ── scale ────────────────────────────────────────────────────────────── */
test("scale ×2: chu vi và hộp bao nhân đôi chính xác", () => {
  const c = ring(WING, "1"), b0 = bbox(c);
  const s = scale(c, 2, point(0, 0));
  near(length(s), 2*rawPerimeter(ringPts(WING, "1")), 1e-9, "gấp đôi chu vi tính tay");
  near(length(s), 1554.0928, 1e-3, "số làm tròn 4 chữ số trong fixture");
  near(bbox(s).w, 2*b0.w, 1e-9); near(bbox(s).h, 2*b0.h, 1e-9);
});

test("scale sang inch: 777.0464 mm = 30.5924 in", () => {
  near(length(scale(ring(WING, "1"), 1/25.4, point(0, 0))), 30.5924, 1e-4);
});

test("scale quanh một gốc bất kỳ không đổi hình, chỉ đổi cỡ", () => {
  const c = ring(BINDING, "1"), o = point(-100, -1200);
  const s = scale(c, 3, o);
  near(length(s), 3*length(c), 1e-9);
  const b = bbox(c), sb = bbox(s);
  near(sb.x0, o.x + (b.x0 - o.x)*3, 1e-9, "gốc phóng đứng yên");
});

/* ── move · rotate ────────────────────────────────────────────────────── */
test("move: mọi đỉnh dịch đúng bằng nhau, chiều dài không đổi", () => {
  const c = ring(CUP, "1");
  const m = move(c, 17.5, -3.25);
  near(length(m), length(c), 1e-9);
  for(let i = 0; i < c.pts.length; i++){
    near(m.pts[i][0], c.pts[i][0] + 17.5, 1e-9);
    near(m.pts[i][1], c.pts[i][1] - 3.25, 1e-9);
  }
});

test("rotate 90°: hộp bao hoán đổi rộng ↔ cao", () => {
  const c = ring(CUP, "1"), b = bbox(c);
  const r = rotate(c, Math.PI/2, point(0, 0));
  near(length(r), length(c), 1e-9);
  near(bbox(r).w, b.h, 1e-6); near(bbox(r).h, b.w, 1e-6);
});

/* ── offset ── đáp số là đường may do chính nhà máy vẽ ────────────────── */
test("offset dựng lại đúng đường may của nhà máy trên cả 4 mảnh", () => {
  for(const n of names){
    const cut = ring(n, "1"), sew = ring(n, "8");
    const sa = median(sew.pts.map(q => rawDistToPolyline(q, cut.pts, true)));
    const off = offset(cut, sa, {side: "in"});
    const dev = sew.pts.map(q => rawDistToPolyline(q, off.pts, true));
    near(median(dev), 0, 0.05, `${n}: lệch trung vị so với đường may nhà máy`);
  }
});

test("offset giữ đúng khoảng cách: mọi điểm cách đường cắt đúng d", () => {
  for(const n of names){
    const cut = ring(n, "1");
    const ds = offset(cut, 7, {side: "in"}).pts.map(q => rawDistToPolyline(q, cut.pts, true));
    near(Math.min(...ds), 7, 0.03, `${n}: điểm gần nhất`);
    near(median(ds), 7, 0.03, `${n}: trung vị`);
  }
});

test("đường may nhà máy nằm trên đường offset của kernel", () => {
  for(const n of names){
    const cut = ring(n, "1"), sew = ring(n, "8");
    const sa = median(sew.pts.map(q => rawDistToPolyline(q, cut.pts, true)));
    const off = offset(cut, sa, {side: "in"});
    near(median(sew.pts.map(q => rawDistToPolyline(q, off.pts, true))), 0, 0.05, n);
  }
  /* mảnh có SA đều nhất thì phải bám tới đuôi phân phối, không chỉ ở trung vị */
  const cut = ring(CRADLE, "1"), sew = ring(CRADLE, "8");
  const sa = median(sew.pts.map(q => rawDistToPolyline(q, cut.pts, true)));
  const off = offset(cut, sa, {side: "in"});
  ok(pct(sew.pts.map(q => rawDistToPolyline(q, off.pts, true)), 0.95) < 0.2);
});

test("chu vi lệch là do SA nhà máy KHÔNG đều — có bằng chứng đo được", () => {
  for(const n of names){
    const cut = ring(n, "1"), sew = ring(n, "8");
    const ds = sew.pts.map(q => rawDistToPolyline(q, cut.pts, true));
    ok(Math.max(...ds) - Math.min(...ds) > 2,
       `${n}: SA nhà máy chạy ${Math.min(...ds).toFixed(2)}–${Math.max(...ds).toFixed(2)} mm`);
    const rel = Math.abs(length(offset(cut, median(ds), {side: "in"})) - measured(n).sew_perimeter)
                / measured(n).sew_perimeter;
    ok(rel < 0.07, `${n}: chu vi lệch ${(rel*100).toFixed(1)}% — offset đều không dựng lại được SA thay đổi`);
  }
});

test("offset ra ngoài thì chu vi tăng, vào trong thì giảm — trên ring quay theo chiều kim đồng hồ", () => {
  const c = ring(CRADLE, "1"), L = length(c);
  ok(length(offset(c, 5, {side: "out"})) > L);
  ok(length(offset(c, 5, {side: "in"})) < L);
});

/* ── trim · extend ────────────────────────────────────────────────────── */
test("trim một đường ngang: khúc giữ lại dài đúng bằng bề ngang mảnh tại đó", () => {
  const c = ring(CRADLE, "1"), b = bbox(c);
  const Y = (b.y0 + b.y1)/2;
  const through = line(point(b.x0 - 50, Y), point(b.x1 + 50, Y));
  const r = trim(through, [c], point(b.x0 - 40, Y));       // bấm vào khúc thò ra ngoài
  ok(r.removed, "có khúc bị bỏ");
  /* đáp số độc lập: giao điểm của y = Y với từng đoạn của ring */
  const xs = [];
  const pts = c.pts;
  for(let i = 0; i < pts.length; i++){
    const a = pts[i], d = pts[(i+1) % pts.length];
    if((a[1]-Y)*(d[1]-Y) <= 0 && a[1] !== d[1]) xs.push(a[0] + (d[0]-a[0])*(Y-a[1])/(d[1]-a[1]));
  }
  near(r.kept[0].a.x, Math.min(...xs), 1e-6, "cắt đúng tại mép trái của mảnh");
});

test("extend kéo một đoạn ngắn ra tới biên mảnh thật", () => {
  const c = ring(WING, "1"), b = bbox(c);
  const cx = (b.x0 + b.x1)/2, cy = (b.y0 + b.y1)/2;
  const seg = line(point(cx, cy), point(cx + 10, cy));
  const e = extend(seg, [c], "end");
  near(rawDistToPolyline([e.b.x, e.b.y], c.pts, true), 0, 1e-6, "đầu mới nằm trên biên");
  ok(length(e) > length(seg));
});

/* ── góc ──────────────────────────────────────────────────────────────── */
test("grainline của rập này song song trục dọc", () => {
  const g = lineOn(WING, "7");
  const grain = line(point(g.a[0], g.a[1]), point(g.b[0], g.b[1]));
  near(angleBetween(grain, line(point(0, 0), point(0, 100))), 0, 1e-9);
  near(angleBetween(grain, line(point(0, 0), point(100, 0))), Math.PI/2, 1e-9);
});
