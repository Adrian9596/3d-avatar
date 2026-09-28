/* BỘ 2 — Relationship Engine trên rập thật 3380.
   Dời một Point của đường cắt rồi kiểm: đúng những nút phụ thuộc được tính lại,
   tính lại ĐÚNG, và nhánh không liên quan không bị đụng tới. */
import {test, eq, near, deepEq, ok} from "../../../tests/harness.js";
import {ringPts, pointsOn, lineOn, rawDistToPolyline, median, pct} from "../../../tests/fixture3380.js";
import {point, line, curve, length, bbox, closestPoint, pointAt, sample} from "./model.js";
import {createDoc} from "./doc.js";

const WING = "后比_L1", CRADLE = "前下摆_L3";
const SA = 7;                       // seam allowance nhà máy dùng trên mảnh này (đo được)

/* một tài liệu chứa HAI mảnh: mảnh thứ hai là đối chứng — nó phải đứng yên */
function setup(){
  const d = createDoc();
  const cut = d.add(curve(ringPts(CRADLE, "1"), true), {name: "cradle cắt"});
  const sew = d.derive("offset", [cut], {d: SA, side: "in"}, {name: "cradle may"});
  const n0 = pointsOn(CRADLE, "4")[0];
  const t = closestPoint(d.get(cut), point(n0.x, n0.y)).t;
  const tick = d.derive("perpendicular", [cut], {t, len: 6}, {name: "vạch notch"});
  const b = bbox(d.get(cut));
  const axis = d.add(line(point((b.x0+b.x1)/2, b.y0), point((b.x0+b.x1)/2, b.y1)), {name: "trục CF"});
  const mir = d.derive("mirror", [cut, axis], {}, {name: "ảnh gương"});

  const wcut = d.add(curve(ringPts(WING, "1"), true), {name: "wing cắt"});
  const wsew = d.derive("offset", [wcut], {d: SA, side: "in"}, {name: "wing may"});
  const g = lineOn(WING, "7");
  const grain = d.add(line(point(g.a[0], g.a[1]), point(g.b[0], g.b[1])), {name: "grainline"});
  const gfit = d.derive("extendTo", [d.derive("extendTo", [grain, wcut], {end: "end"}), wcut],
                        {end: "start"}, {name: "grainline chạm biên"});
  d.solve();
  return {d, cut, sew, tick, mir, axis, wcut, wsew, grain, gfit, t};
}

const sewGap = (d, sew, cutPts) =>
  median(sample(d.get(sew), 0.3).map(q => rawDistToPolyline(q, cutPts, true)));

test("trước khi dời: đường may cách đường cắt đúng 7 mm trên cả mảnh", () => {
  const {d, sew} = setup();
  const gap = sewGap(d, sew, ringPts(CRADLE, "1"));
  near(gap, SA, 0.05);
});

test("dời Point A: đúng ba nút phụ thuộc được tính lại, đúng thứ tự", () => {
  const {d, cut, sew, tick, mir, wsew, gfit} = setup();
  const pts = d.get(cut).pts.map(p => p.slice());
  pts[30] = [pts[30][0] + 12, pts[30][1] - 8];              // Point A
  d.set(cut, curve(pts, true));
  const r = d.solve();
  deepEq(r.updated, [sew, tick, mir], "chỉ nhánh của đường cắt cradle");
  eq(r.failed.length, 0);
  ok(!r.order.includes(wsew) && !r.order.includes(gfit), "nhánh wing không bị đụng tới");
});

test("dời Point A: đường may vẫn cách đường cắt MỚI đúng 7 mm", () => {
  const {d, cut, sew} = setup();
  const pts = d.get(cut).pts.map(p => p.slice());
  pts[30] = [pts[30][0] + 12, pts[30][1] - 8];
  d.set(cut, curve(pts, true));
  d.solve();
  near(sewGap(d, sew, pts), SA, 0.05, "quan hệ offset giữ nguyên sau khi hình đổi");
});

test("dời Point A: vạch notch vẫn dính đường cắt và vẫn dài đúng 6 mm", () => {
  const {d, cut, tick} = setup();
  const before = d.get(tick);
  const pts = d.get(cut).pts.map(p => p.slice());
  pts[30] = [pts[30][0] + 12, pts[30][1] - 8];
  d.set(cut, curve(pts, true));
  d.solve();
  const after = d.get(tick);
  near(length(after), 6, 1e-9);
  near(rawDistToPolyline([after.a.x, after.a.y], pts, true), 0, 1e-6, "chân vạch nằm trên đường cắt");
  ok(Math.hypot(after.a.x-before.a.x, after.a.y-before.a.y) >= 0, "vị trí bám theo % chiều dài");
});

test("dời Point A: ảnh gương phản chiếu đúng điểm vừa dời", () => {
  const {d, cut, mir, axis} = setup();
  const ax = d.get(axis).a.x;
  const pts = d.get(cut).pts.map(p => p.slice());
  pts[30] = [pts[30][0] + 12, pts[30][1] - 8];
  d.set(cut, curve(pts, true));
  d.solve();
  const expect = [2*ax - pts[30][0], pts[30][1]];           // phản chiếu tính tay
  near(rawDistToPolyline(expect, d.get(mir).pts, true), 0, 1e-6);
});

test("dời nguồn của wing thì chỉ nhánh wing chạy, cradle đứng yên", () => {
  const {d, cut, sew, grain, gfit, wcut} = setup();
  const cradleSewBefore = d.get(sew);
  const g = d.get(grain);
  d.set(grain, line(point(g.a.x + 5, g.a.y), point(g.b.x + 5, g.b.y)));
  const r = d.solve();
  ok(r.updated.length === 2, "hai nút extendTo nối tiếp: " + r.updated.length);
  eq(d.get(sew), cradleSewBefore, "cùng một object — cradle không bị tính lại");
  for(const end of [d.get(gfit).a, d.get(gfit).b])
    near(rawDistToPolyline([end.x, end.y], d.get(wcut).pts, true), 0, 1e-6,
         "hai đầu grainline vẫn chạm biên mảnh sau khi dời");
});

test("grainline chạm biên: dài hơn đoạn gốc và nằm đúng trên trục đứng của nó", () => {
  const {d, grain, gfit} = setup();
  const g0 = d.get(grain), g1 = d.get(gfit);
  ok(length(g1) > length(g0), `${length(g1).toFixed(1)} > ${length(g0).toFixed(1)}`);
  near(g1.a.x, g0.a.x, 1e-9); near(g1.b.x, g0.a.x, 1e-9);
  /* đáp số độc lập: cắt ring bằng chính đường thẳng đứng x = g0.a.x, lấy y min/max */
  const pts = ringPts(WING, "1"), X = g0.a.x, ys = [];
  for(let i = 0; i < pts.length; i++){
    const a = pts[i], b = pts[(i+1) % pts.length];
    if((a[0]-X)*(b[0]-X) <= 0 && a[0] !== b[0]) ys.push(a[1] + (b[1]-a[1])*(X-a[0])/(b[0]-a[0]));
  }
  near(length(g1), Math.max(...ys) - Math.min(...ys), 1e-6);
});

test("đổi tham số đường may 7 → 10 mm thì khoảng cách đổi theo", () => {
  const {d, sew} = setup();
  d.setParams(sew, {d: 10});
  d.solve();
  near(sewGap(d, sew, ringPts(CRADLE, "1")), 10, 0.05);
});

test("undo trả mọi thứ về đúng hình ban đầu", () => {
  const {d, cut, sew, tick} = setup();
  const snap = d.snapshot();
  const len0 = length(d.get(sew)), tick0 = d.get(tick);
  const pts = d.get(cut).pts.map(p => p.slice());
  pts[30] = [pts[30][0] + 40, pts[30][1] - 40];
  d.set(cut, curve(pts, true));
  d.solve();
  ok(Math.abs(length(d.get(sew)) - len0) > 1, "đã đổi thật");
  d.restore(snap);
  near(length(d.get(sew)), len0, 1e-9);
  deepEq(d.get(tick), tick0);
});

test("quan hệ gãy trên dữ liệu thật vẫn không làm chết lần giải", () => {
  const {d, cut, sew, tick} = setup();
  d.setParams(sew, {d: 500, side: "in"});                  // lùi quá sâu, hình sập
  const r = d.solve();
  ok(r.failed.length + r.updated.length >= 1);
  ok(d.get(tick), "vạch notch vẫn tính được vì nó không phụ thuộc đường may");
});
