/* Đường — the smart pen's open line through turn and curve points (spec: sketch.md §8, L1–L6).

   Every expected value is worked out HERE, as outline.test.js does for the closed outline: a centripetal
   Catmull–Rom point by the Barry–Goldman pyramid (three levels of plain linear interpolation), cubic Beziers
   by this file's own de Casteljau, lengths by walking the pyramid itself in fine chords. An open line differs from an
   outline in one place only — there is no closing span, and its two ends are corners — so the neighbour rule
   below is written for that, from the spec, not read from the kernel. */
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {checkOpenLine, openSegments, openShape, openLength, openSample, dragOpenLine, moveOpenLine} from "./outline.js";
import {pointAt, length} from "./model.js";

const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const same = (a, b) => Object.is(a[0], b[0]) && Object.is(a[1], b[1]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0])*t, a[1] + (b[1] - a[1])*t];
const mirror = (p, q) => [2*p[0] - q[0], 2*p[1] - q[1]];
const throwsLike = (fn, re, msg) => {
  let err = null; try{ fn(); }catch(e){ err = e; }
  ok(err, `${msg}: phải từ chối`); ok(err && re.test(err.message), `${msg}: lời từ chối "${err && err.message}" không khớp ${re}`);
};
function bez(P, t){
  const a = lerp(P[0], P[1], t), b = lerp(P[1], P[2], t), c = lerp(P[2], P[3], t), d = lerp(a, b, t), e = lerp(b, c, t);
  return lerp(d, e, t);
}
function barryGoldman(P0, P1, P2, P3, t){
  const t0 = 0, t1 = t0 + Math.sqrt(hyp(P0, P1)), t2 = t1 + Math.sqrt(hyp(P1, P2)), t3 = t2 + Math.sqrt(hyp(P2, P3));
  const L = (A, B, ta, tb) => lerp(A, B, (t - ta)/(tb - ta));
  const A1 = L(P0, P1, t0, t1), A2 = L(P1, P2, t1, t2), A3 = L(P2, P3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return {p: L(B1, B2, t1, t2), t1, t2};
}
/* the neighbours span i → i+1 of an OPEN line sees (sketch.md §8): a turn point — and each end, which is always one —
   ends a curved run and its missing neighbour is its mirror image; there is nothing to wrap round to */
function neighbours(pts, kinds, i){
  const n = pts.length, P1 = pts[i], P2 = pts[i + 1];
  const P0 = i === 0 || kinds[i] === "turn" ? mirror(P1, P2) : pts[i - 1];
  const P3 = i + 1 === n - 1 || kinds[i + 1] === "turn" ? mirror(P2, P1) : pts[i + 2];
  return [P0, P1, P2, P3];
}
function distSeg(p, a, b){
  const d = [b[0] - a[0], b[1] - a[1]], dd = d[0]*d[0] + d[1]*d[1];
  const t = dd ? Math.max(0, Math.min(1, ((p[0] - a[0])*d[0] + (p[1] - a[1])*d[1])/dd)) : 0;
  return Math.hypot(p[0] - a[0] - d[0]*t, p[1] - a[1] - d[1]*t);
}

/* ── the lines tried ─────────────────────────────────────────────────────────────── */
const TWO = {pts: [[0, 0], [50, 0]], kinds: ["turn", "turn"]};
const ZIG = {pts: [[0, 0], [40, 0], [40, 30], [90, 30]], kinds: ["turn", "turn", "turn", "turn"]};
const ARCH = {pts: [[0, 0], [30, 20], [60, 10], [100, 40]], kinds: ["turn", "curve", "curve", "turn"]};
/* a straight start, one curve point between two corners, a straight end */
const MIXED = {pts: [[0, 0], [50, 0], [80, 20], [110, 0], [160, 0]], kinds: ["turn", "turn", "curve", "turn", "turn"]};
/* uneven spacing in one run — the case uniform Catmull–Rom overshoots on */
const UNEVEN = {pts: [[0, 0], [100, 0], [104, 5], [140, 60], [150, 62]], kinds: ["turn", "curve", "curve", "curve", "turn"]};

/* ── L1 ────────────────────────────────────────────────────────────────────────────── */
test("L1 an open line is at least two finite, distinct points, each a turn or a curve point — else refused", () => {
  const src = ARCH.pts.map(p => p.slice()), c = checkOpenLine(src, ARCH.kinds);
  ok(c.pts !== src && c.pts[0] !== src[0], "không giữ mảng của người gọi");
  deepEq(c.pts, ARCH.pts); deepEq(c.kinds, ARCH.kinds);
  deepEq(checkOpenLine(TWO.pts, TWO.kinds).pts, TWO.pts, "hai điểm là đủ");
  throwsLike(() => checkOpenLine([[0, 0]], ["turn"]), /ít nhất 2/, "1 điểm");
  throwsLike(() => checkOpenLine([[0, 0], [Infinity, 1]], ["turn", "turn"]), /không hợp lệ/, "vô cực");
  throwsLike(() => checkOpenLine([[0, 0], [5, 5], [5, 5]], ["turn", "turn", "turn"]), /trùng/, "hai điểm liền nhau trùng");
  throwsLike(() => checkOpenLine([[0, 0], [5, 5]], ["turn", "bend"]), /turn.*curve/, "loại điểm lạ");
  throwsLike(() => checkOpenLine([[0, 0], [5, 5]], ["turn"]), /loại điểm/, "thiếu loại điểm");
  /* the last point back on the first is NOT a repeat: an open line may come back to where it started */
  deepEq(checkOpenLine([[0, 0], [10, 0], [10, 10], [0, 0]], ["turn", "turn", "turn", "turn"]).pts.length, 4, "đầu trùng cuối vẫn là đường hở");
});

test("L1 the two ends are corners: placed as curve points, they are kept as turn points", () => {
  const c = checkOpenLine([[0, 0], [30, 20], [60, 0]], ["curve", "curve", "curve"]);
  deepEq(c.kinds, ["turn", "curve", "turn"]);
  const src = ["curve", "turn", "curve"];
  checkOpenLine([[0, 0], [1, 1], [2, 0]], src);
  deepEq(src, ["curve", "turn", "curve"], "mảng loại điểm của người gọi không bị sửa");
});

/* ── L2 · L3 ───────────────────────────────────────────────────────────────────────── */
test("L2 n − 1 spans, no closing one; between two turn points a span is a straight line, its ends bit for bit", () => {
  const segs = openSegments(ZIG.pts, ZIG.kinds);
  eq(segs.length, 3);
  segs.forEach((s, i) => {
    eq(s.kind, "line", `đoạn ${i}`);
    ok(same(s.ctrl[0], ZIG.pts[i]) && same(s.ctrl[1], ZIG.pts[i + 1]), `đoạn ${i}: đúng hai đầu, từng bit`);
  });
  const sh = openShape(ZIG.pts, ZIG.kinds);
  eq(sh.kind, "curve"); eq(sh.closed, false, "polyline hở");
  deepEq(sh.pts, ZIG.pts);
  const two = openSegments(TWO.pts, TWO.kinds);
  eq(two.length, 1); eq(two[0].kind, "line");
  /* MIXED: the straight start and end are straight to the last bit of every sample */
  const m = openSegments(MIXED.pts, MIXED.kinds), sm = openShape(MIXED.pts, MIXED.kinds);
  eq(m[0].kind, "line"); eq(m[3].kind, "line"); eq(m[1].kind, "bezier"); eq(m[2].kind, "bezier");
  ok(same(m[0].ctrl[0], [0, 0]) && same(m[0].ctrl[1], [50, 0]) && same(m[3].ctrl[0], [110, 0]) && same(m[3].ctrl[1], [160, 0]), "MIXED: hai đoạn thẳng đúng hai đầu");
  /* the kernel shape agrees: at its very start and end it is on y = 0, at both ends exactly the points placed */
  const a = pointAt(sm, 0), b = pointAt(sm, 1);
  eq(a.x, 0); eq(a.y, 0); eq(b.x, 160); eq(b.y, 0);
});

test("L3 the line passes through every point placed, is smooth at each curve point, and every curved span IS centripetal Catmull–Rom", () => {
  for(const [name, o] of [["ARCH", ARCH], ["MIXED", MIXED], ["UNEVEN", UNEVEN]]){
    const segs = openSegments(o.pts, o.kinds);
    eq(segs.length, o.pts.length - 1, `${name}: n − 1 đoạn`);
    segs.forEach((s, i) => {
      ok(same(s.ctrl[0], o.pts[i]) && same(s.ctrl[s.ctrl.length - 1], o.pts[i + 1]), `${name} đoạn ${i}: qua đúng hai điểm đã đặt`);
      if(o.kinds[i] === "turn" && o.kinds[i + 1] === "turn"){ eq(s.kind, "line", `${name} đoạn ${i}`); return; }
      eq(s.kind, "bezier", `${name} đoạn ${i}`);
      const [P0, P1, P2, P3] = neighbours(o.pts, o.kinds, i);
      for(const u of [0.1, 0.25, 0.5, 0.75, 0.9]){
        const g = barryGoldman(P0, P1, P2, P3, 0), want = barryGoldman(P0, P1, P2, P3, g.t1 + u*(g.t2 - g.t1)).p, got = bez(s.ctrl, u);
        ok(hyp(got, want) <= 1e-9, `${name} đoạn ${i} u=${u}: lệch tháp Barry–Goldman ${hyp(got, want)} mm`);
      }
    });
    /* G1 at each inner curve point: the arms of the two spans meeting there are in line and opposite */
    for(let i = 1; i < o.pts.length - 1; i++){
      if(o.kinds[i] !== "curve") continue;
      const a = segs[i - 1].ctrl, b = segs[i].ctrl, p = o.pts[i];
      const u = [p[0] - a[2][0], p[1] - a[2][1]], v = [b[1][0] - p[0], b[1][1] - p[1]];
      const cross = u[0]*v[1] - u[1]*v[0], dot = u[0]*v[0] + u[1]*v[1];
      ok(Math.abs(cross) <= 1e-9*Math.hypot(...u)*Math.hypot(...v) + 1e-12 && dot > 0, `${name} điểm ${i}: trơn`);
    }
  }
});

/* ── L4 ────────────────────────────────────────────────────────────────────────────── */
test("L4 the length is the sum of the spans — straight by distance, curved by walking the Barry–Goldman pyramid in fine chords", () => {
  for(const [name, o] of [["TWO", TWO], ["ZIG", ZIG], ["ARCH", ARCH], ["MIXED", MIXED], ["UNEVEN", UNEVEN]]){
    let want = 0;
    for(let i = 0; i < o.pts.length - 1; i++){
      if(o.kinds[i] === "turn" && o.kinds[i + 1] === "turn"){ want += hyp(o.pts[i], o.pts[i + 1]); continue; }
      /* the pyramid itself, walked in 20 000 chords: a chord sum falls short by O(1/N²) — far under 1e-6 mm here */
      const [P0, P1, P2, P3] = neighbours(o.pts, o.kinds, i), g = barryGoldman(P0, P1, P2, P3, 0), N = 20000;
      let prev = P1;
      for(let k = 1; k <= N; k++){ const q = barryGoldman(P0, P1, P2, P3, g.t1 + (g.t2 - g.t1)*k/N).p; want += hyp(prev, q); prev = q; }
    }
    near(openLength(o.pts, o.kinds), want, 1e-6, `${name}: chiều dài`);
    near(length(openShape(o.pts, o.kinds)), openLength(o.pts, o.kinds), 1e-6, `${name}: hình kernel cùng chiều dài`);
  }
  eq(openLength(ZIG.pts, ZIG.kinds), 40 + 30 + 50, "ZIG: 40 + 30 + 50 đúng tuyệt đối");
});

/* ── L5 ────────────────────────────────────────────────────────────────────────────── */
test("L5 export samples: every point placed is a vertex, bit for bit; straight spans give only their ends; ≤ 0.01 mm off", () => {
  for(const [name, o] of [["ZIG", ZIG], ["ARCH", ARCH], ["MIXED", MIXED], ["UNEVEN", UNEVEN]]){
    const r = openSample(o.pts, o.kinds, 0.01), segs = openSegments(o.pts, o.kinds);
    eq(r.pts.length, r.turn.length, `${name}: một cờ mỗi đỉnh`);
    ok(same(r.pts[0], o.pts[0]) && same(r.pts[r.pts.length - 1], o.pts[o.pts.length - 1]), `${name}: bắt đầu và kết thúc ở hai đầu, từng bit`);
    o.pts.forEach((p, i) => {
      const k = r.pts.findIndex(q => same(q, p));
      ok(k >= 0, `${name}: điểm ${i} là một đỉnh, từng bit`);
      eq(r.turn[k], o.kinds[i] === "turn" || i === 0 || i === o.pts.length - 1, `${name}: cờ turn của điểm ${i}`);
    });
    for(let i = 1; i < r.pts.length; i++) ok(!same(r.pts[i], r.pts[i - 1]), `${name}: không đỉnh lặp (${i})`);
    let worst = 0;
    for(const s of segs){
      for(let k = 0; k <= 400; k++){
        const q = s.kind === "line" ? lerp(s.ctrl[0], s.ctrl[1], k/400) : bez(s.ctrl, k/400);
        let d = Infinity;
        for(let i = 1; i < r.pts.length; i++) d = Math.min(d, distSeg(q, r.pts[i - 1], r.pts[i]));
        worst = Math.max(worst, d);
      }
    }
    ok(worst <= 0.01 + 1e-12, `${name}: lệch xa nhất ${worst} mm > 0.01`);
  }
  deepEq(openSample(ZIG.pts, ZIG.kinds, 0.01).pts, ZIG.pts, "ZIG: đúng 4 đỉnh, không đỉnh giữa");
  const m = openSample(MIXED.pts, MIXED.kinds, 0.01);
  eq(m.pts.findIndex(q => same(q, MIXED.pts[1])), 1, "đoạn thẳng đầu: hai đỉnh liền nhau");
  eq(m.pts.length - 1 - m.pts.findIndex(q => same(q, MIXED.pts[3])), 1, "đoạn thẳng cuối: hai đỉnh liền nhau");
});

/* ── L6 ────────────────────────────────────────────────────────────────────────────── */
test("L6 dragging point k moves only that point; spans that do not see it keep every bit; moving keeps the length", () => {
  const o = UNEVEN, k = 3, before = openSegments(o.pts, o.kinds);
  const d = dragOpenLine(o, k, [141, 70]);
  d.pts.forEach((p, i) => { if(i === k) deepEq(p, [141, 70]); else ok(same(p, o.pts[i]), `điểm ${i} không đổi`); });
  deepEq(d.kinds, o.kinds);
  const after = openSegments(d.pts, d.kinds);
  /* span j sees the points j − 1 … j + 2 */
  after.forEach((s, j) => { if(k < j - 1 || k > j + 2) deepEq(s.ctrl, before[j].ctrl, `đoạn ${j} không thấy điểm ${k}`); });
  throwsLike(() => dragOpenLine(o, 1, o.pts[2]), /trùng/, "kéo lên điểm kề");
  throwsLike(() => dragOpenLine(o, 9, [0, 0]), /không có điểm/, "điểm không có");
  const m = moveOpenLine(ARCH, 12.5, -3);
  m.pts.forEach((p, i) => { eq(p[0], ARCH.pts[i][0] + 12.5); eq(p[1], ARCH.pts[i][1] - 3); });
  near(openLength(m.pts, m.kinds), openLength(ARCH.pts, ARCH.kinds), 1e-9, "dời không đổi chiều dài");
});
