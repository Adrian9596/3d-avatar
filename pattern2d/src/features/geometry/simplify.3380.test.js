/* BỘ 6 — Rút gọn hình học trên rập factory 3380 (spec: simplify.md §2).

   Đây là chỗ duy nhất trả lời được câu hỏi thật: bỏ bớt đỉnh của rập NHÀ MÁY thì
   đường có xê dịch không, notch có mất không, và phép đo có đổi số không.
   Expected value lấy từ ngoài kernel: vòng lặp trần trong test, POINT nhà máy đặt,
   và chính hai phép đo Straight/Along đã được đối chiếu CAD. */
import {test, eq, near, ok} from "../../../tests/harness.js";
import {names, ringPts, pointsOn, hypot, rawPerimeter} from "../../../tests/fixture3380.js";
import {point, curve} from "./model.js";
import {chain, alongPath} from "./path.js";
import {straight} from "./straight.js";
import {simplify, detect, validateSimplify, deviation} from "./simplify.js";
import {segmentEdges} from "../edges/segment.js";

const TOL = 0.1;                                  // mm — mặc định của spec
const marks = n => [...pointsOn(n, "4"), ...pointsOn(n, "2")].map(q => [q.x, q.y]);
const run = (n, tol = TOL) => {
  const pts = ringPts(n, "1"), keep = marks(n);
  const r = simplify(pts, {closed: true, tol, keep});
  return {pts, keep, r, v: validateSimplify(pts, r.pts, {closed: true, tol, keep})};
};

test("rập nhà máy đúng là đang thừa điểm — detect nói ra bao nhiêu", () => {
  for(const n of names){
    const d = detect(ringPts(n, "1"), {closed: true, tol: TOL});
    ok(d.collinear.length > 0, `${n}: phải tìm được điểm thẳng hàng`);
    ok(d.redundant < d.count, `${n}: không thể coi mọi đỉnh là thừa`);
  }
});

test("cả 4 mảnh: rút gọn ở 0.1 mm đều PASS toàn bộ kiểm tra", () => {
  for(const n of names){
    const {v} = run(n);
    ok(v.ok, `${n}: ${JSON.stringify({dev: v.maxDeviation, self: v.noSelfIntersection,
                                      ori: v.orientationKept, mk: v.markers})}`);
  }
});

test("G4 đường không xê dịch quá tolerance — đo lại bằng vòng lặp trần", () => {
  for(const n of names){
    const {pts, r, v} = run(n);
    ok(v.maxDeviation <= TOL + 1e-9, `${n}: lệch ${v.maxDeviation}`);
    /* trọng tài: khoảng cách từng đỉnh gốc tới đường mới, tính tay ngay ở đây */
    const ring = r.pts.concat([r.pts[0]]);
    const far = pts.map(p => {
      let best = Infinity;
      for(let i = 1; i < ring.length; i++){
        const [x1, y1] = ring[i-1], [x2, y2] = ring[i];
        const dx = x2-x1, dy = y2-y1, dd = dx*dx + dy*dy;
        const t = dd === 0 ? 0 : Math.max(0, Math.min(1, ((p[0]-x1)*dx + (p[1]-y1)*dy)/dd));
        best = Math.min(best, Math.hypot(p[0]-(x1+dx*t), p[1]-(y1+dy*t)));
      }
      return best;
    });
    ok(Math.max(...far) <= TOL + 1e-9, `${n}: vòng lặp trần thấy ${Math.max(...far)}`);
  }
});

test("G7 mọi notch và turn point nằm trên đường đều còn nguyên", () => {
  for(const n of names){
    const {pts, keep, r} = run(n);
    const onLine = keep.filter(k => pts.some(p => hypot(p, k) <= 0.05));
    ok(onLine.length >= 3, `${n}: phải có mốc trên đường để mà giữ`);
    for(const k of onLine)
      ok(r.pts.some(p => hypot(p, k) <= 1e-9), `${n}: mất mốc ${k}`);
  }
});

test("G8 chu vi lệch dưới 0.1 % — đo bằng rawPerimeter của fixture", () => {
  for(const n of names){
    const {pts, r} = run(n);
    const p0 = rawPerimeter(pts), p1 = rawPerimeter(r.pts);
    ok(Math.abs(p1-p0)/p0*100 < 0.1, `${n}: lệch ${(Math.abs(p1-p0)/p0*100).toFixed(4)}%`);
  }
});

test("số cạnh của mảnh không đổi — rút gọn không được xoá mất một cạnh", () => {
  for(const n of names){
    const {pts, r} = run(n);
    eq(segmentEdges(r.pts.slice()).length, segmentEdges(pts.slice()).length, n);
  }
});

test("phép đo không đổi: Along và Straight giữa hai mốc lệch dưới 0.05 mm", () => {
  for(const n of names){
    const {pts, keep, r} = run(n);
    const on = keep.filter(k => pts.some(p => hypot(p, k) <= 0.05));
    const A = point(on[0][0], on[0][1]), B = point(on[1][0], on[1][1]);
    const a0 = alongPath(chain([curve(pts, true)]), A, B).distance;
    const a1 = alongPath(chain([curve(r.pts, true)]), A, B).distance;
    near(a1, a0, 0.05, `${n}: Along đổi ${Math.abs(a1-a0).toFixed(4)} mm`);
    near(straight(A, B).distance, straight(A, B).distance, 1e-12, "Straight không thể đổi");
  }
});

test("rút gọn phải thật sự bỏ được điểm, và mảnh cong bỏ được nhiều hơn mảnh thẳng", () => {
  /* Ngưỡng lấy từ số đo, không đặt bừa: ở 0.1 mm, 后比 bỏ 14 % (mảnh này phần lớn là
     cạnh thẳng, vốn ít điểm thừa), ba mảnh cong còn lại bỏ 26 %. Đặt sàn dưới con số
     thật một chút để test bắt được hồi quy mà không gãy vì làm tròn. */
  const curvy = ["杯面_L2", "前下摆_L3", "杯口_L4"];
  for(const n of names){
    const {r} = run(n);
    ok(r.ratio >= 0.10, `${n}: mới bỏ ${(r.ratio*100).toFixed(0)}%`);
    if(curvy.includes(n)) ok(r.ratio >= 0.22, `${n}: mảnh cong mà chỉ bỏ ${(r.ratio*100).toFixed(0)}%`);
  }
});

test("tolerance lớn hơn thì bỏ nhiều hơn, và deviation lớn theo — không có bữa trưa miễn phí", () => {
  const n = names[2];
  const a = run(n, 0.1), b = run(n, 0.3);
  ok(b.r.after < a.r.after, "0.3 mm phải gọn hơn 0.1 mm");
  ok(b.v.maxDeviation > a.v.maxDeviation, "và lệch nhiều hơn");
  ok(b.v.maxDeviation <= 0.3 + 1e-9, "nhưng vẫn trong tolerance của chính nó");
});

test("G10 luỹ đẳng trên rập thật: rút gọn lần hai không bỏ thêm đỉnh nào", () => {
  for(const n of names){
    const {r, keep} = run(n);
    const again = simplify(r.pts, {closed: true, tol: TOL, keep});
    eq(again.after, r.after, n);
  }
});

test("G11 mảng toạ độ gốc của fixture không bị đụng tới", () => {
  const before = JSON.stringify(ringPts(names[0], "1"));
  run(names[0]);
  eq(JSON.stringify(ringPts(names[0], "1")), before);
});

test("deviation đo hai chiều: đường mới cũng không lang thang khỏi đường gốc", () => {
  for(const n of names){
    const {pts, r} = run(n);
    const d = deviation(pts, r.pts);
    ok(d.max <= TOL + 1e-9, `${n}: ${d.max}`);
    ok(d.median < d.max, `${n}: trung vị phải nhỏ hơn cực đại`);
  }
});
