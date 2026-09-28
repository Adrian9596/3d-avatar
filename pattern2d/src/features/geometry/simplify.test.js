/* Geometry Simplification — bộ test tổng hợp (spec: simplify.md).

   Expected value dựng tay: đường thẳng chia đều, hình chữ nhật, một đỉnh nhô đúng 5 mm. */
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {detect, rdp, simplify, deviation, validateSimplify, selfIntersects,
        corners, protectedIndices} from "./simplify.js";

/* đường thẳng 0→100 chia thành 11 điểm: 9 điểm giữa đều là điểm dư */
const LINE = Array.from({length: 11}, (_, i) => [i*10, 0]);
/* hình chữ nhật 100×50, mỗi cạnh chèn thêm 3 điểm giữa — 4 góc thật, 12 điểm dư */
const RECT = (() => {
  const c = [[0, 0], [100, 0], [100, 50], [0, 50]], out = [];
  for(let i = 0; i < 4; i++){
    const a = c[i], b = c[(i+1) % 4];
    out.push(a);
    for(let k = 1; k <= 3; k++) out.push([a[0] + (b[0]-a[0])*k/4, a[1] + (b[1]-a[1])*k/4]);
  }
  return out;
})();

/* ── G1 · Detect ────────────────────────────────────────────────────────── */
test("G1 đếm đúng điểm thẳng hàng trên một đường thẳng", () => {
  const d = detect(LINE, {closed: false});
  eq(d.collinear.length, 9, "9 điểm giữa đều thẳng hàng");
  eq(d.duplicates.length, 0);
});

test("G1 bắt duplicate và near-duplicate", () => {
  const pts = [[0, 0], [0, 0], [10, 0], [10.02, 0], [20, 0]];
  const d = detect(pts, {closed: false, dmin: 0.05});
  eq(d.duplicates.length, 1, "đỉnh lặp");
  eq(d.nearDuplicates.length, 1, "đỉnh cách 0.02 mm");
});

test("G1 chỉ báo cáo, không đụng vào mảng đầu vào", () => {
  const before = JSON.stringify(RECT);
  detect(RECT, {closed: true});
  eq(JSON.stringify(RECT), before);
});

/* ── G2 · RDP ───────────────────────────────────────────────────────────── */
test("G2 đường thẳng 11 điểm → còn 2 đầu", () =>
  deepEq(rdp(LINE, 0.1), [[0, 0], [100, 0]]));

test("G2 giữ đỉnh nhô cao hơn tolerance, bỏ đỉnh thấp hơn", () => {
  const spike = [[0, 0], [50, 5], [100, 0]];
  eq(rdp(spike, 1).length, 3, "nhô 5 mm > tol 1 mm thì phải giữ");
  eq(rdp(spike, 6).length, 2, "tol 6 mm thì bỏ được");
});

test("G2 mọi điểm bị bỏ đều nằm trong tolerance của đường giữ lại", () => {
  const wig = Array.from({length: 40}, (_, i) => [i, Math.sin(i/6)*0.4]);
  const out = rdp(wig, 0.5);
  ok(out.length < wig.length, "phải bỏ bớt được");
  /* trọng tài: khoảng cách điểm → đoạn, viết tay ngay ở đây */
  const far = wig.map(p => {
    let best = Infinity;
    for(let i = 1; i < out.length; i++){
      const [x1, y1] = out[i-1], [x2, y2] = out[i];
      const dx = x2-x1, dy = y2-y1, dd = dx*dx + dy*dy;
      const t = dd === 0 ? 0 : Math.max(0, Math.min(1, ((p[0]-x1)*dx + (p[1]-y1)*dy)/dd));
      best = Math.min(best, Math.hypot(p[0]-(x1+dx*t), p[1]-(y1+dy*t)));
    }
    return best;
  });
  ok(Math.max(...far) <= 0.5 + 1e-9, `điểm xa nhất ${Math.max(...far)}`);
});

/* ── G3 · Preserve ──────────────────────────────────────────────────────── */
test("G3 hình chữ nhật có điểm chèn: giữ đúng 4 góc", () => {
  const r = simplify(RECT, {closed: true, tol: 0.1});
  eq(r.pts.length, 4);
  deepEq(r.pts.map(p => p.map(Math.round)), [[0, 0], [100, 0], [100, 50], [0, 50]]);
});

test("G3 điểm được bảo vệ không bị xoá dù nằm giữa một đoạn thẳng", () => {
  const keep = [[50, 0]];                              // giữa cạnh dưới, hoàn toàn thẳng hàng
  const r = simplify(RECT, {closed: true, tol: 0.1, keep});
  ok(r.pts.some(p => Math.hypot(p[0]-50, p[1]) < 1e-9), "điểm bảo vệ phải còn");
  eq(r.pts.length, 5, "4 góc + 1 điểm bảo vệ");
});

test("G3 notch nhà máy truyền vào bằng toạ độ, không bằng chỉ số", () => {
  const r = simplify(RECT, {closed: true, tol: 0.1, keep: [[25, 0], [100, 25]]});
  for(const k of [[25, 0], [100, 25]])
    ok(r.pts.some(p => Math.hypot(p[0]-k[0], p[1]-k[1]) < 1e-9), `mất ${k}`);
});

/* ── G5 · G6 · topology ─────────────────────────────────────────────────── */
test("G5 ring kín vẫn kín, chiều quay không đổi, còn ít nhất 3 đỉnh", () => {
  const v = validateSimplify(RECT, simplify(RECT, {closed: true, tol: 0.1}).pts, {closed: true, tol: 0.1});
  ok(v.closedKept, "vẫn là ring");
  ok(v.orientationKept, "chiều quay giữ nguyên");
  ok(v.enoughPoints, "≥ 3 đỉnh");
  ok(v.ok, "tổng thể phải đạt");
});

test("G6 báo lỗi khi kết quả tự cắt", () => {
  const bow = [[0, 0], [100, 0], [0, 50], [100, 50]];      // nơ — tự cắt sẵn
  const v = validateSimplify(bow, bow, {closed: true, tol: 0.1});
  ok(!v.noSelfIntersection, "phải phát hiện tự cắt");
  ok(!v.ok);
});

/* ── G4 · deviation hai chiều ───────────────────────────────────────────── */
test("G4 deviation đo cả hai chiều, không chỉ một", () => {
  const a = [[0, 0], [50, 0], [100, 0]], b = [[0, 0], [50, 3], [100, 0]];
  near(deviation(a, b).max, 3, 1e-9);
  near(deviation(b, a).max, 3, 1e-9, "đổi chiều vẫn phải thấy 3 mm");
});

test("G4 rút gọn trong tolerance thì deviation không vượt tolerance", () => {
  const wig = Array.from({length: 60}, (_, i) => [i, Math.cos(i/5)*2]);
  const r = simplify(wig, {closed: false, tol: 0.3});
  const v = validateSimplify(wig, r.pts, {closed: false, tol: 0.3});
  ok(v.maxDeviation <= 0.3 + 1e-9, `lệch ${v.maxDeviation}`);
  ok(v.ok);
});

/* ── G9 · G10 · G11 ─────────────────────────────────────────────────────── */
test("G9 chạy hai lần cho kết quả giống hệt nhau", () =>
  deepEq(simplify(RECT, {closed: true, tol: 0.1}).pts,
         simplify(RECT, {closed: true, tol: 0.1}).pts));

test("G10 rút gọn lần hai không bỏ thêm điểm nào", () => {
  const once = simplify(RECT, {closed: true, tol: 0.1}).pts;
  deepEq(simplify(once, {closed: true, tol: 0.1}).pts, once);
});

test("G11 không sửa mảng đầu vào — bản gốc luôn còn nguyên để rollback", () => {
  const before = JSON.stringify(RECT);
  simplify(RECT, {closed: true, tol: 0.1});
  eq(JSON.stringify(RECT), before);
});

test("G11 kết quả kèm thống kê để biết đã bỏ những gì", () => {
  const r = simplify(RECT, {closed: true, tol: 0.1});
  eq(r.before, 16); eq(r.after, 4); eq(r.removed, 12);
  near(r.ratio, 0.75, 1e-9);
});

/* ── G3b · mốc nằm ngoài đường viền ─────────────────────────────────────────
   Rập 3380 vẽ 10/17 điểm layer 2 LỆCH RA NGOÀI đường cắt 7–25 mm: chúng là vạch
   annotation, không phải đỉnh của đường. Một mốc chưa bao giờ nằm trên đường thì
   không thể "bị mất khỏi đường" — validator phải chỉ đòi những mốc từng là đỉnh. */
test("G3b mốc vẽ lệch ra ngoài đường không làm hỏng validate", () => {
  const off = [[50, 40]];                             // cách cạnh dưới 40 mm
  const r = simplify(RECT, {closed: true, tol: 0.1, keep: off});
  const v = validateSimplify(RECT, r.pts, {closed: true, tol: 0.1, keep: off});
  ok(v.markersKept, "mốc ngoài đường không phải điều kiện");
  ok(v.ok, "và không được kéo cả kết quả xuống FAIL");
  eq(v.markers.given, 1); eq(v.markers.onOutline, 0); eq(v.markers.lost, 0);
});

test("G3b mốc từng nằm trên đường mà biến mất thì phải FAIL", () => {
  const onLine = [[50, 0]];
  const cut = RECT.filter(p => !(p[0] === 50 && p[1] === 0));   // cố tình bỏ mốc đó đi
  const v = validateSimplify(RECT, cut, {closed: true, tol: 0.1, keep: onLine});
  ok(!v.markersKept, "phải bắt được mốc bị mất");
  ok(!v.ok);
  eq(v.markers.onOutline, 1); eq(v.markers.lost, 1);
});

/* ── G12 · ring có đỉnh lặp ─────────────────────────────────────────────────
   Cả 4 mảnh của rập 3380 đều lặp đỉnh đầu ở cuối polyline (CLAUDE.md §7 đã ghi
   một lần rồi, ở chỗ khác). Đoạn nối dài 0 mm sinh ra từ đó làm bộ dò tự cắt báo
   động giả, và làm mọi phép đếm lệch đi một. Chuẩn hoá ngay lúc nhận, như curve(). */
const RING_DUP = RECT.concat([RECT[0].slice()]);

test("G12 ring lặp đỉnh cuối: chuẩn hoá rồi mới làm gì thì làm", () => {
  const r = simplify(RING_DUP, {closed: true, tol: 0.1});
  eq(r.before, 16, "đỉnh lặp không được tính là một đỉnh thật");
  eq(r.after, 4);
  ok(!r.pts.some((p, i) => i > 0 && Math.hypot(p[0]-r.pts[0][0], p[1]-r.pts[0][1]) < 1e-9),
     "kết quả không được lặp lại đỉnh đầu");
});

test("G12 đoạn dài 0 không bị coi là tự cắt", () => {
  ok(!selfIntersects(RING_DUP, true), "ring lặp đỉnh vẫn là ring hợp lệ");
  const v = validateSimplify(RING_DUP, simplify(RING_DUP, {closed: true, tol: 0.1}).pts,
                             {closed: true, tol: 0.1});
  ok(v.noSelfIntersection);
  ok(v.ok);
});

test("G12 detect đếm đỉnh lặp là duplicate, không phải collinear", () => {
  const d = detect(RING_DUP, {closed: true});
  eq(d.count, 16, "đếm trên ring đã chuẩn hoá");
});

/* ── G3c · hai khối con của Preserve, kiểm riêng ────────────────────────────
   `corners` và `protectedIndices` là chỗ quyết định điểm nào được sống. Chúng phải
   đúng một mình, không chỉ đúng khi nằm trong simplify(). */
test("G3c corners tìm đúng 4 góc của hình chữ nhật có điểm chèn", () => {
  const c = corners(RECT, {win: 7, angle: 26});
  deepEq(c.map(i => RECT[i].map(Math.round)).sort(),
         [[0, 0], [0, 50], [100, 0], [100, 50]].sort());
});

test("G3c corners không coi điểm giữa một cạnh thẳng là góc", () => {
  const c = corners(RECT, {win: 7, angle: 26});
  ok(!c.some(i => RECT[i][0] === 25 && RECT[i][1] === 0), "điểm giữa cạnh dưới không phải góc");
});

test("G3c đường HỞ thoải thì không có góc nào — và phải khai là hở", () => {
  const arc = Array.from({length: 60}, (_, k) => {
    const t = Math.PI*k/59;                       // nửa đường tròn r=100, rất thoải
    return [100*Math.cos(t), 100*Math.sin(t)];
  });
  eq(corners(arc, {win: 7, angle: 26, closed: false}).length, 0);
  /* Cùng bấy nhiêu điểm mà coi là RING kín thì hai đầu cung là góc thật: dây cung
     nối chúng lại gặp cung ở đúng hai chỗ đó. Cùng dữ liệu, hai câu trả lời đúng —
     nên hàm không được tự đoán, người gọi phải nói. */
  deepEq(corners(arc, {win: 7, angle: 26, closed: true}), [0, 59]);
});

test("G3c protectedIndices gộp góc, hai đầu đường hở, và mốc truyền vào", () => {
  const open = [[0, 0], [25, 0], [50, 0], [75, 0], [100, 0], [100, 25], [100, 50], [75, 50]];
  const idx = protectedIndices(open, {closed: false, keep: [[50, 0]]});
  ok(idx.includes(0) && idx.includes(open.length-1), "hai đầu đường hở luôn được giữ");
  ok(idx.includes(2), "mốc [50,0] phải nằm trong danh sách");
  deepEq(idx, [...idx].sort((a, b) => a - b), "trả về theo thứ tự tăng dần");
});

test("G3c protectedIndices bỏ qua mốc nằm xa mọi đỉnh", () => {
  const a = protectedIndices(RECT, {closed: true, keep: [[50, 40]], corners: false});
  eq(a.length, 0, "mốc cách đường 40 mm thì không bám vào đỉnh nào");
});
