/* The outline of a new piece — turn points and curve points (spec: sketch.md §7, O1–O12).

   Every expected value is worked out HERE: a centripetal Catmull–Rom point by the Barry–Goldman
   pyramid (three levels of plain linear interpolation — not the Bezier form the kernel uses), cubic
   Beziers by this file's own de Casteljau, lengths and areas (Green's ½∮x dy − y dx) by its own Simpson
   rule. The kernel is asked for its answer, never for the ruler. */
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {OUTLINE_KINDS, checkOutline, outlineSegments, outlineShape, outlineEdges, outlineSample, outlineArea,
        outlineLength, dragOutline, moveOutline, outlineTurns, outlineLocate, outlineAt, outlineChain} from "./outline.js";
import {fromCorner} from "./corners.js";
import {length, pointAt, closestPoint, point} from "./model.js";

/* ── the rulers of this file ─────────────────────────────────────────────────── */
const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const same = (a, b) => Object.is(a[0], b[0]) && Object.is(a[1], b[1]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0])*t, a[1] + (b[1] - a[1])*t];
const throwsLike = (fn, re, msg) => {
  let err = null; try{ fn(); }catch(e){ err = e; }
  ok(err, `${msg}: phải từ chối`); ok(re.test(err.message), `${msg}: lời từ chối "${err.message}" không khớp ${re}`);
};
function bez(P, t){
  const a = lerp(P[0], P[1], t), b = lerp(P[1], P[2], t), c = lerp(P[2], P[3], t), d = lerp(a, b, t), e = lerp(b, c, t);
  return lerp(d, e, t);
}
function bezD(P, t){
  const s = 1 - t, k = [3*s*s, 6*s*t, 3*t*t];
  return [0, 1].map(j => k[0]*(P[1][j] - P[0][j]) + k[1]*(P[2][j] - P[1][j]) + k[2]*(P[3][j] - P[2][j]));
}
function bezLen(P, n = 4096){ return bezLenTo(P, 1, n); }
/* the length of a cubic from u = 0 to u, by composite Simpson */
function bezLenTo(P, u, n = 4096){
  const f = t => Math.hypot(...bezD(P, t));
  let s = f(0) + f(u);
  for(let i = 1; i < n; i++) s += (i % 2 ? 4 : 2)*f(u*i/n);
  return s*u/(3*n);
}
/* centripetal Catmull–Rom by the Barry–Goldman pyramid, at parameter t of the knots t0..t3 */
function knots(P0, P1, P2, P3){
  const t0 = 0, t1 = t0 + Math.sqrt(hyp(P0, P1)), t2 = t1 + Math.sqrt(hyp(P1, P2)), t3 = t2 + Math.sqrt(hyp(P2, P3));
  return [t0, t1, t2, t3];
}
function barryGoldman(P0, P1, P2, P3, t){
  const [t0, t1, t2, t3] = knots(P0, P1, P2, P3);
  const L = (A, B, ta, tb) => lerp(A, B, (t - ta)/(tb - ta));
  const A1 = L(P0, P1, t0, t1), A2 = L(P1, P2, t1, t2), A3 = L(P2, P3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}
/* the neighbours a span sees (spec: a turn point ends a curved run and its missing neighbour is its
   mirror image — P(-1) = 2·P0 − P1; a ring of curve points only wraps round) */
function neighbours(pts, kinds, i){
  const n = pts.length, at = k => pts[((k % n) + n) % n], kd = k => kinds[((k % n) + n) % n];
  const P1 = at(i), P2 = at(i + 1);
  const allCurve = kinds.every(k => k === "curve");
  const P0 = allCurve || kd(i) === "curve" ? at(i - 1) : [2*P1[0] - P2[0], 2*P1[1] - P2[1]];
  const P3 = allCurve || kd(i + 1) === "curve" ? at(i + 2) : [2*P2[0] - P1[0], 2*P2[1] - P1[1]];
  return [P0, P1, P2, P3];
}
function shoelace(pts){ let a = 0; for(let i = 0; i < pts.length; i++){ const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0]*q[1] - q[0]*p[1]; } return a/2; }
/* ½∮(x dy − y dx) by this file's own Simpson rule on each cubic — a chord polygon would undercut every
   convex bulge by O(1/N²) (2000 chords a span: 1.3e-4 mm² short on T2), this does not */
function greenArea(segs, n = 4096){
  let A = 0;
  for(const s of segs){
    if(s.kind === "line"){ const [p, q] = s.ctrl; A += (p[0]*q[1] - q[0]*p[1])/2; continue; }
    const f = t => { const q = bez(s.ctrl, t), d = bezD(s.ctrl, t); return q[0]*d[1] - q[1]*d[0]; };
    let S = f(0) + f(1);
    for(let i = 1; i < n; i++) S += (i % 2 ? 4 : 2)*f(i/n);
    A += S/(3*n)/2;
  }
  return A;
}
/* a dense ring of points on the outline, from this file's own evaluation of each segment */
function dense(segs, per = 2000){
  const out = [];
  for(const s of segs){
    if(s.kind === "line"){ for(let k = 0; k < per; k++) out.push(lerp(s.ctrl[0], s.ctrl[1], k/per)); }
    else for(let k = 0; k < per; k++) out.push(bez(s.ctrl, k/per));
  }
  return out;
}
function distSeg(p, a, b){
  const d = [b[0] - a[0], b[1] - a[1]], dd = d[0]*d[0] + d[1]*d[1];
  const t = dd ? Math.max(0, Math.min(1, ((p[0] - a[0])*d[0] + (p[1] - a[1])*d[1])/dd)) : 0;
  return Math.hypot(p[0] - a[0] - d[0]*t, p[1] - a[1] - d[1]*t);
}

/* ── the shapes tried ─────────────────────────────────────────────────────────── */
const SQUARE = {pts: [[0, 0], [100, 0], [100, 100], [0, 100]], kinds: ["turn", "turn", "turn", "turn"]};
/* the piece of the Vẽ test (piece.md §1): straight bottom and right, a curved top and a curved left */
const T2 = {pts: [[0, -150], [180, -150], [180, -40], [90, -5], [0, -20], [-15, -85]],
            kinds: ["turn", "turn", "turn", "curve", "turn", "curve"]};
/* a ring of curve points only — nothing to stop the curve, so it wraps */
const RING = {pts: Array.from({length: 6}, (_, k) => [50*Math.cos(k*Math.PI/3), 50*Math.sin(k*Math.PI/3)]), kinds: Array(6).fill("curve")};
/* uneven spacing inside one run — the case uniform Catmull–Rom overshoots on */
const UNEVEN = {pts: [[0, 0], [200, 0], [200, 60], [196, 64], [120, 90], [10, 70]], kinds: ["turn", "turn", "turn", "curve", "curve", "turn"]};

/* ── O1 ─────────────────────────────────────────────────────────────────────────── */
test("O1 an outline is at least three finite, distinct points, each a turn or a curve point — else refused", () => {
  deepEq(OUTLINE_KINDS, ["turn", "curve"]);
  const src = SQUARE.pts.map(p => p.slice()), c = checkOutline(src, SQUARE.kinds);
  ok(c.pts !== src && c.pts[0] !== src[0], "không giữ mảng của người gọi");
  deepEq(c.pts, SQUARE.pts); deepEq(c.kinds, SQUARE.kinds);
  throwsLike(() => checkOutline([[0, 0], [1, 0]], ["turn", "turn"]), /ít nhất 3/, "2 điểm");
  throwsLike(() => checkOutline([[0, 0], [1, 0], [NaN, 1]], ["turn", "turn", "turn"]), /không hợp lệ/, "NaN");
  throwsLike(() => checkOutline([[0, 0], [1, 0], [1, 0], [0, 1]], ["turn", "turn", "turn", "turn"]), /trùng/, "hai điểm liền nhau trùng");
  throwsLike(() => checkOutline([[0, 0], [1, 0], [0, 1], [0, 0]], ["turn", "turn", "turn", "turn"]), /trùng/, "điểm cuối trùng điểm đầu");
  throwsLike(() => checkOutline([[0, 0], [1, 0], [0, 1]], ["turn", "corner", "turn"]), /turn.*curve/, "loại điểm lạ");
  throwsLike(() => checkOutline([[0, 0], [1, 0], [0, 1]], ["turn", "turn"]), /loại điểm/, "thiếu loại điểm");
});

/* ── O2 · O5 ────────────────────────────────────────────────────────────────────── */
test("O2 · O5 between two turn points the outline is a straight line, and a corner keeps its exact angle", () => {
  const segs = outlineSegments(SQUARE.pts, SQUARE.kinds);
  eq(segs.length, 4);
  segs.forEach((s, i) => {
    eq(s.kind, "line", `cạnh ${i}`);
    ok(same(s.ctrl[0], SQUARE.pts[i]) && same(s.ctrl[1], SQUARE.pts[(i + 1) % 4]), `cạnh ${i} đúng hai đầu, từng bit`);
  });
  const shape = outlineShape(SQUARE.pts, SQUARE.kinds);
  eq(shape.kind, "curve", "toàn turn → polyline kín như Rect");
  near(length(shape), 400, 1e-9, "chu vi hình vuông");
  /* the right angle at every corner, from the edge vectors */
  for(let i = 0; i < 4; i++){
    const a = SQUARE.pts[(i + 3) % 4], p = SQUARE.pts[i], b = SQUARE.pts[(i + 1) % 4];
    const u = [a[0] - p[0], a[1] - p[1]], v = [b[0] - p[0], b[1] - p[1]];
    near(u[0]*v[0] + u[1]*v[1], 0, 1e-12, `góc ${i} vuông`);
  }
  /* in a mixed outline the straight edges are straight too */
  const mixed = outlineSegments(T2.pts, T2.kinds);
  eq(mixed[0].kind, "line"); eq(mixed[1].kind, "line");
  near(hyp(mixed[0].ctrl[0], mixed[0].ctrl[1]), 180, 1e-12); near(hyp(mixed[1].ctrl[0], mixed[1].ctrl[1]), 110, 1e-12);
  const s = outlineShape(T2.pts, T2.kinds);
  for(const t of [0.02, 0.05, 0.1]){
    const q = pointAt(s, t);                                         // t along the arc: the first edge is the first 180 mm
    ok(Math.abs(q.y + 150) <= 1e-9, `t=${t}: điểm (${q.x}, ${q.y}) nằm trên cạnh đáy y = −150`);
  }
});

/* ── O3 · O4 · O6 ───────────────────────────────────────────────────────────────── */
test("O3 the outline passes through every point placed, turn and curve alike", () => {
  for(const [name, o] of [["T2", T2], ["RING", RING], ["UNEVEN", UNEVEN]]){
    const segs = outlineSegments(o.pts, o.kinds);
    o.pts.forEach((p, i) => {
      ok(same(segs[i].ctrl[0], p), `${name}: khúc ${i} bắt đầu đúng điểm ${i}, từng bit`);
      const prev = segs[(i - 1 + o.pts.length) % o.pts.length];
      ok(same(prev.ctrl[prev.ctrl.length - 1], p), `${name}: khúc trước kết thúc đúng điểm ${i}, từng bit`);
    });
    const shape = outlineShape(o.pts, o.kinds);
    for(const p of o.pts) ok(closestPoint(shape, point(p[0], p[1])).dist <= 1e-9, `${name}: hình kernel đi qua (${p})`);
  }
});
test("O4 at a curve point the outline is smooth: the two Bezier arms are in line and opposite", () => {
  for(const [name, o] of [["T2", T2], ["RING", RING], ["UNEVEN", UNEVEN]]){
    const segs = outlineSegments(o.pts, o.kinds), n = o.pts.length;
    o.kinds.forEach((k, i) => {
      if(k !== "curve") return;
      const out = segs[i], inn = segs[(i - 1 + n) % n];
      eq(out.kind, "bezier", `${name}: khúc rời curve point ${i} là cong`); eq(inn.kind, "bezier", `${name}: khúc tới curve point ${i} là cong`);
      const p = o.pts[i], a = [inn.ctrl[2][0] - p[0], inn.ctrl[2][1] - p[1]], b = [out.ctrl[1][0] - p[0], out.ctrl[1][1] - p[1]];
      const cr = a[0]*b[1] - a[1]*b[0], dt = a[0]*b[0] + a[1]*b[1];
      ok(Math.abs(cr) <= 1e-9*Math.hypot(...a)*Math.hypot(...b) + 1e-12, `${name}: tay ${i} thẳng hàng (cross ${cr})`);
      ok(dt < 0, `${name}: tay ${i} ngược chiều`);
    });
  }
});
test("O6 every curved span IS the centripetal Catmull–Rom spline (Barry–Goldman pyramid of this file)", () => {
  for(const [name, o] of [["T2", T2], ["RING", RING], ["UNEVEN", UNEVEN]]){
    const segs = outlineSegments(o.pts, o.kinds);
    segs.forEach((s, i) => {
      if(s.kind !== "bezier") return;
      const [P0, P1, P2, P3] = neighbours(o.pts, o.kinds, i), [, t1, t2] = knots(P0, P1, P2, P3);
      for(const u of [0, 0.1, 0.25, 0.5, 0.7, 0.9, 1]){
        const want = barryGoldman(P0, P1, P2, P3, t1 + u*(t2 - t1)), got = bez(s.ctrl, u);
        ok(hyp(want, got) <= 1e-9, `${name} khúc ${i} u=${u}: Bezier (${got}) cách Catmull–Rom (${want}) ${hyp(want, got)}`);
      }
    });
  }
});

/* ── O7 · O8 ────────────────────────────────────────────────────────────────────── */
test("O7 perimeter = the sum of the segments (Simpson of this file), area = Green's integral (Simpson of this file), turn from its sign", () => {
  for(const [name, o] of [["SQUARE", SQUARE], ["T2", T2], ["RING", RING], ["UNEVEN", UNEVEN]]){
    const segs = outlineSegments(o.pts, o.kinds);
    const want = segs.reduce((s, x) => s + (x.kind === "line" ? hyp(x.ctrl[0], x.ctrl[1]) : bezLen(x.ctrl)), 0);
    near(outlineLength(o.pts, o.kinds), want, 1e-6, `${name}: chu vi`);
    near(length(outlineShape(o.pts, o.kinds)), want, 1e-6, `${name}: chiều dài hình kernel`);
    near(outlineArea(o.pts, o.kinds), greenArea(segs), 1e-6, `${name}: diện tích`);
    ok(Math.abs(outlineArea(o.pts, o.kinds) - shoelace(dense(segs))) < 1e-3, `${name}: đa giác dày cũng gần (hụt vì dây cung)`);
  }
  near(outlineArea(SQUARE.pts, SQUARE.kinds), 10000, 1e-9, "hình vuông 100 × 100, ngược chiều kim đồng hồ");
  near(outlineArea(SQUARE.pts.slice().reverse(), SQUARE.kinds), -10000, 1e-9, "đảo chiều → diện tích âm");
});
test("O8 a ring of curve points only is periodic and smooth at the join too", () => {
  const segs = outlineSegments(RING.pts, RING.kinds);
  ok(segs.every(s => s.kind === "bezier"), "mọi khúc cong");
  const last = segs[5], first = segs[0], p = RING.pts[0];
  const a = [last.ctrl[2][0] - p[0], last.ctrl[2][1] - p[1]], b = [first.ctrl[1][0] - p[0], first.ctrl[1][1] - p[1]];
  near(a[0]*b[1] - a[1]*b[0], 0, 1e-9, "chỗ nối đầu–cuối trơn");
  /* six evenly spaced points on a circle: the ring is symmetric, so every span has the same length */
  const L = segs.map(s => bezLen(s.ctrl));
  for(const x of L) near(x, L[0], 1e-9, "sáu khúc bằng nhau");
  /* the length of the spline the definition gives — the pyramid itself, as a fine polyline — not a circle:
     six centripetal Catmull–Rom spans through six points of a circle run 310.14 mm, 4.02 short of 2πr */
  let pyr = 0;
  for(let i = 0; i < 6; i++){
    const [P0, P1, P2, P3] = neighbours(RING.pts, RING.kinds, i), [, t1, t2] = knots(P0, P1, P2, P3);
    let prev = barryGoldman(P0, P1, P2, P3, t1);
    for(let k = 1; k <= 20000; k++){ const q = barryGoldman(P0, P1, P2, P3, t1 + (t2 - t1)*k/20000); pyr += hyp(prev, q); prev = q; }
  }
  near(L.reduce((s, x) => s + x, 0), pyr, 1e-4, "chu vi = chiều dài chính đường Catmull–Rom của tháp Barry–Goldman");
});

/* ── O9 · O10 ───────────────────────────────────────────────────────────────────── */
test("O9 dragging one point moves only that point; spans that do not see it keep every bit", () => {
  const o = UNEVEN, before = outlineSegments(o.pts, o.kinds);
  const moved = dragOutline(o, 4, [118, 97]);
  ok(same(moved.pts[4], [118, 97]), "điểm 4 tới đích");
  o.pts.forEach((p, i) => { if(i !== 4) ok(same(moved.pts[i], p), `điểm ${i} đứng yên, từng bit`); });
  deepEq(moved.kinds, o.kinds, "loại điểm giữ nguyên");
  const after = outlineSegments(moved.pts, moved.kinds), n = o.pts.length;
  const sees = new Set([2, 3, 4, 5].map(j => ((j % n) + n) % n));             // spans k−2 … k+1
  before.forEach((s, i) => {
    if(sees.has(i)) return;
    ok(s.ctrl.every((q, k) => same(q, after[i].ctrl[k])), `khúc ${i} không thấy điểm 4 → không đổi một bit`);
  });
  throwsLike(() => dragOutline(o, 4, o.pts[3]), /trùng/, "kéo đè lên điểm kề");
  throwsLike(() => dragOutline(o, 9, [0, 0]), /không có điểm/, "điểm không có");
});
test("O10 moving the outline moves every point by exactly dx, dy and keeps its length", () => {
  const m = moveOutline(T2, 12.5, -7.25);
  m.pts.forEach((p, i) => { eq(p[0], T2.pts[i][0] + 12.5); eq(p[1], T2.pts[i][1] - 7.25); });
  near(outlineLength(m.pts, m.kinds), outlineLength(T2.pts, T2.kinds), 1e-9);
  ok(T2.pts[0][0] === 0 && T2.pts[0][1] === -150, "bản gốc không bị sửa");
});

/* ── O11 ────────────────────────────────────────────────────────────────────────── */
test("O11 export samples: every point placed is a vertex, bit for bit; straight edges give only their ends; ≤ 0.01 mm off", () => {
  for(const [name, o] of [["SQUARE", SQUARE], ["T2", T2], ["RING", RING], ["UNEVEN", UNEVEN]]){
    const r = outlineSample(o.pts, o.kinds, 0.01), segs = outlineSegments(o.pts, o.kinds);
    eq(r.pts.length, r.turn.length, `${name}: một cờ mỗi đỉnh`);
    o.pts.forEach((p, i) => {
      const k = r.pts.findIndex(q => same(q, p));
      ok(k >= 0, `${name}: điểm ${i} (${p}) là một đỉnh, từng bit`);
      eq(r.turn[k], o.kinds[i] === "turn", `${name}: cờ turn của điểm ${i}`);
    });
    eq(r.turn.filter(Boolean).length, o.kinds.filter(k => k === "turn").length, `${name}: chỉ turn point mang cờ turn`);
    for(let i = 0; i < r.pts.length; i++) ok(!same(r.pts[i], r.pts[(i + 1) % r.pts.length]), `${name}: không có đỉnh lặp (${i})`);
    /* the polyline stays within 0.01 mm of the exact outline, measured from a dense ring of this file */
    let worst = 0;
    for(const q of dense(segs, 400)){
      let d = Infinity;
      for(let i = 0; i < r.pts.length; i++) d = Math.min(d, distSeg(q, r.pts[i], r.pts[(i + 1) % r.pts.length]));
      worst = Math.max(worst, d);
    }
    ok(worst <= 0.01 + 1e-12, `${name}: lệch xa nhất ${worst} mm > 0.01`);
  }
  eq(outlineSample(SQUARE.pts, SQUARE.kinds, 0.01).pts.length, 4, "hình vuông: đúng 4 đỉnh");
  const t2 = outlineSample(T2.pts, T2.kinds, 0.01), i0 = t2.pts.findIndex(q => same(q, T2.pts[0])), i1 = t2.pts.findIndex(q => same(q, T2.pts[1]));
  eq((i1 - i0 + t2.pts.length) % t2.pts.length, 1, "cạnh đáy thẳng: hai đỉnh liền nhau, không đỉnh giữa");
});

/* ── O12 ────────────────────────────────────────────────────────────────────────── */
test("O12 the edges are the runs between two turn points, with their lengths", () => {
  const e = outlineEdges(T2.pts, T2.kinds), segs = outlineSegments(T2.pts, T2.kinds);
  deepEq(e.map(x => [x.from, x.to]), [[0, 1], [1, 2], [2, 4], [4, 0]], "đáy · phải · cong trên · cong trái");
  near(e[0].length, 180, 1e-12); near(e[1].length, 110, 1e-12);
  near(e[2].length, bezLen(segs[2].ctrl) + bezLen(segs[3].ctrl), 1e-6, "cạnh trên = hai khúc cong");
  near(e[3].length, bezLen(segs[4].ctrl) + bezLen(segs[5].ctrl), 1e-6, "cạnh trái = hai khúc cong");
  deepEq(outlineTurns(T2.kinds), [0, 1, 2, 4]);
  const ring = outlineEdges(RING.pts, RING.kinds);
  eq(ring.length, 1, "không có góc: cả vòng là một cạnh");
  near(ring[0].length, outlineLength(RING.pts, RING.kinds), 1e-9);
});

/* ── O16 ────────────────────────────────────────────────────────────────────────── */
test("O16 a point on the outline ↔ its edge (from turn point to turn point) and its share of that edge's length", () => {
  const segs = outlineSegments(T2.pts, T2.kinds);
  /* on the straight bottom edge, 60 mm from v0: share 60/180, by plain arithmetic */
  const a = outlineLocate(T2.pts, T2.kinds, [60, -148]);
  deepEq([a.from, a.to], [0, 1]); near(a.share, 60/180, 1e-12); near(a.dist, 2, 1e-12); deepEq(a.point, [60, -150]);
  ok(same(outlineAt(T2.pts, T2.kinds, 0, 1, 60/180), [60, -150]), "và ngược lại, đúng từng bit");
  /* on the curved top edge (v2 → v4 through the curve point v3): share by this file's Simpson */
  /* a click 0.5 mm off the curve ALONG ITS NORMAL at q (this file's derivative) has its foot at q */
  const q = bez(segs[3].ctrl, 0.3), d = bezD(segs[3].ctrl, 0.3), nd = Math.hypot(...d), nrm = [-d[1]/nd, d[0]/nd];
  const b = outlineLocate(T2.pts, T2.kinds, [q[0] + 0.5*nrm[0], q[1] + 0.5*nrm[1]]);
  deepEq([b.from, b.to], [2, 4]);
  const edge = bezLen(segs[2].ctrl) + bezLen(segs[3].ctrl), part = bezLen(segs[2].ctrl) + bezLenTo(segs[3].ctrl, 0.3);
  ok(hyp(b.point, q) <= 1e-6, `chân vuông góc trên đường cong (cách ${hyp(b.point, q)})`);
  near(b.share, part/edge, 1e-7, "tỉ lệ trên cạnh trên");
  ok(hyp(outlineAt(T2.pts, T2.kinds, 2, 4, b.share), b.point) <= 1e-9, "ngược lại: cùng điểm");
  /* a ring with no corner: one edge, from 0 round to 0 */
  const c = outlineLocate(RING.pts, RING.kinds, [0, 49]);
  deepEq([c.from, c.to], [0, 0]); ok(c.share > 0 && c.share < 1);
  ok(hyp(outlineAt(RING.pts, RING.kinds, 0, 0, c.share), c.point) <= 1e-9, "vòng không góc: cùng điểm");
  throwsLike(() => outlineAt(T2.pts, T2.kinds, 3, 4, 0.5), /không có cạnh/, "3 không phải góc: không có cạnh 3 → 4");
  throwsLike(() => outlineAt(T2.pts, T2.kinds, 0, 1, 1.2), /tỉ lệ/, "tỉ lệ ngoài 0 … 1");
});

/* ── O17 ────────────────────────────────────────────────────────────────────────── */
test("O17 outlineChain: the Path as a path of its own segments — its length, its turn points as corners, d along a curved edge", () => {
  const ch = outlineChain(T2.pts, T2.kinds), segs = outlineSegments(T2.pts, T2.kinds);
  ok(ch.closed, "vòng kín");
  const simpson = segs.reduce((s, x) => s + (x.kind === "line" ? hyp(x.ctrl[0], x.ctrl[1]) : bezLen(x.ctrl)), 0);
  near(ch.total, simpson, 1e-6, "chu vi = Simpson của file này");
  const corners = outlineTurns(T2.kinds).map(k => T2.pts[k]);
  const r = fromCorner(ch, corners, [10, -149.6], 25);
  ok(hyp(r.point, [25, -150]) <= 1e-9, `cạnh đáy thẳng: đúng tuyệt đối (${JSON.stringify(r.point)})`); near(r.length, 180, 1e-9, "cạnh đáy dài 180");
  /* the curved top edge v2 → v4 is segments 2 and 3: the point 30 mm from v2 along it, by this file's Simpson + bisection */
  const at = (P, len) => { let lo = 0, hi = 1; for(let k = 0; k < 60; k++){ const m = (lo + hi)/2; if(bezLenTo(P, m) < len) lo = m; else hi = m; } return bez(P, (lo + hi)/2); };
  const L2 = bezLen(segs[2].ctrl), L3 = bezLen(segs[3].ctrl);
  ok(30 < L2 && 20 < L3, "cả hai điểm thử nằm trong một khúc");
  const a = fromCorner(ch, corners, bez(segs[2].ctrl, 0.2), 30);
  ok(hyp(a.point, at(segs[2].ctrl, 30)) <= 1e-6, `cạnh cong trên, 30 mm từ v2 dọc đường cong (lệch ${hyp(a.point, at(segs[2].ctrl, 30))})`);
  near(a.length, L2 + L3, 1e-6, "cạnh trên = hai khúc cong");
  const b = fromCorner(ch, corners, bez(segs[3].ctrl, 0.9), 20);
  ok(hyp(b.point, at(segs[3].ctrl, L3 - 20)) <= 1e-6, `…và 20 mm từ v4, đo ngược lại (lệch ${hyp(b.point, at(segs[3].ctrl, L3 - 20))})`);
  /* a ring of curve points only has no corner to measure from */
  throwsLike(() => fromCorner(outlineChain(RING.pts, RING.kinds), [], [50.2, 0], 5), /góc/, "vòng không góc");
});
