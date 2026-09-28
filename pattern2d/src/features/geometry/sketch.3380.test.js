/* New shapes on REAL pattern data (spec: sketch.md B2 · B3 · B7 · R3 · R11).

   The factory pattern 3380 comes from tests/fixtures/3380.json (frozen by scripts/make_fixture.py
   with its own parser); the ARC, SPLINE and inch files are the Measure Engine fixtures written by
   ezdxf, sha256-checked. Where a test needs to know what an entity IS — the centre and radius of
   an ARC, the control points of a SPLINE — it reads them from the raw DXF text with the ten-line
   parser below, not through the viewer's importer, so the kernel is never its own witness. */
import {test, eq, near, ok} from "../../../tests/harness.js";
import {block, ringPts, pointsOn, rawDistToPolyline, rawPerimeter} from "../../../tests/fixture3380.js";
import {bytes, modelOf, pieceOf} from "../../../tests/engine_fixtures.js";
import {createSketch, snapHit} from "./sketch.js";
import {createLine, createLinePolar, createCurve} from "./entity.js";
import {curve} from "./model.js";
import {snapDefault, parseLength} from "../../shared/units.js";

const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (u, v) => u[0]*v[1] - u[1]*v[0];
const dot = (u, v) => u[0]*v[0] + u[1]*v[1];
const same = (a, b, msg) => ok(Object.is(a[0], b[0]) && Object.is(a[1], b[1]), `${msg}: [${a}] ≠ [${b}] (từng bit)`);
const H = (id, handle) => ({id, handle});
const MM = snapDefault("mm");                                          // 0.5 mm — 3380 declares METRIC

/* the snap targets a tool would offer on a piece, built here from the raw piece data */
function targetsOf(name){
  const b = block(name);
  return {points: b.points.filter(p => ["2", "3", "4", "5"].includes(p.layer)).map(p => [p.x, p.y])
            .concat(b.polylines.flatMap(p => p.pts)),
          shapes: b.polylines.map(p => curve(p.pts, p.closed))};
}
/* ── a ten-line DXF reader: (code, value) pairs, a block's entities, an INSERT's base point ── */
function pairsOf(key){
  const L = new TextDecoder().decode(bytes(key)).split(/\r?\n/), P = [];
  for(let i = 0; i + 1 < L.length; i += 2) P.push([L[i].trim(), L[i + 1].trim()]);
  return P;
}
function blockEntities(P, name){
  for(let i = 0; i < P.length; i++){
    if(P[i][0] !== "0" || P[i][1] !== "BLOCK") continue;
    let j = i + 1;
    while(j < P.length && P[j][0] !== "0" && P[j][0] !== "2") j++;
    if(P[j][0] !== "2" || P[j][1] !== name) continue;
    const ents = [];
    for(let k = j, cur = null; k < P.length; k++){
      const [c, v] = P[k];
      if(c === "0"){ if(cur) ents.push(cur); if(v === "ENDBLK") return ents; cur = {type: v, g: []}; }
      else if(cur) cur.g.push([+c, v]);
    }
  }
  throw new Error(`không thấy block ${name}`);
}
const vals = (e, code) => e.g.filter(([c]) => c === code).map(([, v]) => +v);
function insertOf(P, name){
  for(let i = 0; i < P.length; i++){
    if(P[i][0] !== "0" || P[i][1] !== "INSERT") continue;
    const g = [];
    for(let k = i + 1; k < P.length && P[k][0] !== "0"; k++) g.push(P[k]);
    if(g.find(([c]) => c === "2")?.[1] !== name) continue;
    const num = (c, d) => +(g.find(([k]) => k === c)?.[1] ?? d);
    ok(num("41", 1) === 1 && num("42", 1) === 1 && num("50", 0) === 0, `INSERT ${name}: không phóng, không xoay`);
    return [num("10", 0), num("20", 0)];
  }
  throw new Error(`không thấy INSERT ${name}`);
}
function bez(P, t){
  const l = (p, q) => [p[0] + (q[0] - p[0])*t, p[1] + (q[1] - p[1])*t];
  const a = l(P[0], P[1]), b = l(P[1], P[2]), c = l(P[2], P[3]), d = l(a, b), e = l(b, c);
  return l(d, e);
}
function bezNearDist(P, p){
  let bu = 0, bd = Infinity;
  for(let i = 0; i <= 4000; i++){ const d = hyp(bez(P, i/4000), p); if(d < bd){ bd = d; bu = i/4000; } }
  let lo = Math.max(0, bu - 1/4000), hi = Math.min(1, bu + 1/4000);
  const g = (Math.sqrt(5) - 1)/2;
  for(let k = 0; k < 200; k++){ const c = hi - g*(hi - lo), d = lo + g*(hi - lo); if(hyp(bez(P, c), p) < hyp(bez(P, d), p)) hi = d; else lo = c; }
  return hyp(bez(P, (lo + hi)/2), p);
}
/* the segment of a ring that p lies on (≤ tol), by a plain loop */
function segmentsUnder(p, pts, tol = 1e-9){
  const out = [];
  for(let i = 0; i < pts.length; i++){
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if(hyp(a, b) === 0) continue;
    const d = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), d)/dot(d, d)));
    if(hyp(p, [a[0] + d[0]*t, a[1] + d[1]*t]) <= tol) out.push(d);
  }
  return out;
}

/* ── B — snap onto the factory's own points and lines ──────────────────────────── */
test("B1/B7 3380 前下摆: a cursor 0.3 mm off a real notch lands exactly on it", () => {
  const N = pointsOn("前下摆_L3", "4")[0], T = targetsOf("前下摆_L3");
  const r = snapHit([N.x + 0.3, N.y - 0.2], T, MM);
  eq(r.kind, "point"); same(r.point, [N.x, N.y], "trùng khít notch");
  eq(snapHit([N.x + 0.3, N.y - 0.45], T, MM).kind === "point", false, "cách 0.54 mm: không hít điểm nữa");
});

test("B3 3380 前下摆: onto the real cut line — on it by a plain loop; a line on the straight edge, a curve on the curved one", () => {
  const cut = ringPts("前下摆_L3", "1"), T = targetsOf("前下摆_L3");
  const a = [-234.97, -1258.95], b = [-267.74, -1105.23];            // the 157 mm straight side
  const m = [(a[0] + b[0])/2, (a[1] + b[1])/2], d = sub(b, a), n = [-d[1]/hyp(a, b), d[0]/hyp(a, b)];
  let r = snapHit([m[0] - 0.3*n[0], m[1] - 0.3*n[1]], T, MM);
  eq(r.kind, "line", "cạnh thẳng 157 mm"); ok(rawDistToPolyline(r.point, cut) <= 1e-9, "nằm trên đường cắt");
  near(r.dist, 0.3, 1e-9, "chân đường vuông góc");
  const p = cut[6], q = cut[7], e = sub(q, p), k = [-e[1]/hyp(p, q), e[0]/hyp(p, q)], c = [(p[0] + q[0])/2, (p[1] + q[1])/2];
  r = snapHit([c[0] + 0.3*k[0], c[1] + 0.3*k[1]], T, MM);
  eq(r.kind, "curve", "đoạn cong của đường cắt"); ok(rawDistToPolyline(r.point, cut) <= 1e-9, "nằm trên đường cắt");
});

test("B2 an inch file snaps at 0.02 in: 0.01 in off the edge → on it, 0.05 in → free (the sketch drag, TD's example)", () => {
  const m = modelOf("units_english.dxf"), p = pieceOf(m, "R"), tol = snapDefault(m.units.unit);
  near(tol, 0.508, 1e-12, "0.02 in");
  const T = {points: p.points.map(q => [q.x, q.y]).concat(p.paths.flatMap(q => q.snap || q.pts)), shapes: p.paths.flatMap(q => q.shapes)};
  const sk = createSketch(), L = sk.add(createLine([10, 100], [30, 120]));
  let r = sk.drag(H(L, "b"), [2.5*25.4, -0.01*25.4], {targets: T, tol});
  eq(r.snap.kind, "line"); near(sk.get(L).b[0], 63.5, 1e-9); near(sk.get(L).b[1], 0, 1e-9, "trên cạnh đáy");
  r = sk.drag(H(L, "b"), [2.5*25.4, -0.05*25.4], {targets: T, tol});
  eq(r.snap.kind, "free"); same(sk.get(L).b, [2.5*25.4, -0.05*25.4], "đúng chỗ bấm");
});

test("B3 a real ARC and a real SPLINE: the point snapped is on the entity as the file itself describes it", () => {
  const PA = pairsOf("arcs.dxf"), arcE = blockEntities(PA, "TRACK").find(e => e.type === "ARC" && vals(e, 10)[0] === 200);
  const base = insertOf(PA, "TRACK"), c = [base[0] + vals(arcE, 10)[0], base[1] + vals(arcE, 20)[0]], R = vals(arcE, 40)[0];
  const tr = pieceOf(modelOf("arcs.dxf"), "TRACK"), TA = {points: [], shapes: tr.paths.flatMap(q => q.shapes)};
  const w = [c[0] + (R + 0.3)*Math.cos(Math.PI/6), c[1] + (R + 0.3)*Math.sin(Math.PI/6)];
  let r = snapHit(w, TA, MM);
  eq(r.kind, "curve", "ARC là curve"); near(hyp(r.point, c), R, 1e-9, `trên ARC tâm ${c}, r ${R}`);
  const PS = pairsOf("splines.dxf"), sp = blockEntities(PS, "BEZ3").find(e => e.type === "SPLINE");
  const at = insertOf(PS, "BEZ3"), xs = vals(sp, 10), ys = vals(sp, 20);
  eq(xs.length, 4, "Bezier bậc 3: bốn control point");
  const P = xs.map((x, i) => [at[0] + x, at[1] + ys[i]]);
  const bz = pieceOf(modelOf("splines.dxf"), "BEZ3"), TS = {points: [], shapes: bz.paths.flatMap(q => q.shapes)};
  const q = bez(P, 0.6), q2 = bez(P, 0.6001), dq = sub(q2, q), nq = [-dq[1]/hyp(q, q2), dq[0]/hyp(q, q2)];
  r = snapHit([q[0] + 0.3*nq[0], q[1] + 0.3*nq[1]], TS, MM);
  eq(r.kind, "curve", "SPLINE là curve"); ok(bezNearDist(P, r.point) <= 1e-9, `trên SPLINE (cách ${bezNearDist(P, r.point)})`);
});

/* ── R11 — the factory's entities are masters that never move ─────────────────── */
test("R11 a line from a real notch, horizontal, 5 in long: it starts on the notch; the notch never moves", () => {
  const before = JSON.stringify(block("前下摆_L3"));
  const N = pointsOn("前下摆_L3", "4")[0], at = [N.x, N.y];
  const sk = createSketch(), L = sk.add(createLinePolar(at, parseLength("5", "inch"), 17));
  ok(sk.constrain("coincident", {point: at}, H(L, "a")).ok);
  ok(sk.constrain("horizontal", {id: L}).ok);
  same(sk.get(L).a, at, "đầu line trên notch"); ok(Object.is(sk.get(L).b[1], N.y), "ngang");
  near(hyp(sk.get(L).a, sk.get(L).b), 127, 1e-9, "dài 5 in = 127 mm");
  ok(sk.drag(H(L, "b"), [N.x - 60, N.y + 40]).ok);
  same(sk.get(L).b, [N.x - 60, N.y], "kéo: trượt ngang"); same(sk.get(L).a, at, "đầu kia không rời notch");
  ok(!sk.drag(H(L, "a"), [0, 0]).ok, "đầu bám notch không kéo được");
  eq(JSON.stringify(block("前下摆_L3")), before, "rập nhà máy không đổi một bit");
});

test("R11/R3 a curve leaving the real seam line of 后比 tangentially stays on it and tangent through 200 random drags", () => {
  const seam = ringPts("后比_L1", "8"), S = curve(seam, true);
  const a = seam[71], b = seam[72 % seam.length], P = [(a[0] + b[0])/2, (a[1] + b[1])/2];   // the 145.6 mm straight run
  const sk = createSketch(), C = sk.add(createCurve([P[0] + 4, P[1] + 3], [P[0] + 60, P[1] + 40], [P[0] + 20, P[1] + 30], [P[0] + 50, P[1] + 45]));
  ok(sk.constrain("coincident", {shape: S}, H(C, "p0")).ok);
  const t = sk.constrain("tangent", {shape: S}, {id: C});
  ok(t.ok, t.reason);
  let s0 = null, seed = 3380, okN = 0;
  const rnd = () => { seed = (seed*16807) % 2147483647; return seed/2147483647; };
  const check = tag => {
    const e = sk.get(C);
    ok(rawDistToPolyline(e.p0, seam) <= 1e-9, `${tag}: Start trên đường may (cách ${rawDistToPolyline(e.p0, seam)})`);
    const segs = segmentsUnder(e.p0, seam), h = sub(e.c1, e.p0);
    ok(segs.some(d => Math.abs(cross(h, d))/Math.hypot(...d) <= 1e-9), `${tag}: control point nằm trên tiếp tuyến — song song đoạn đường may dưới nó`);
    const sg = Math.sign(dot(h, segs[0]));
    if(s0 === null) s0 = sg;
    ok(sg === s0 || segs.length > 1, `${tag}: cùng chiều như lúc khai`);
  };
  check("sau khai báo");
  for(let k = 0; k < 200; k++){
    const which = ["c1", "c2", "p3", "p0"][Math.floor(rnd()*4)];
    const r = sk.drag(H(C, which), [P[0] - 80 + rnd()*160, P[1] - 80 + rnd()*160]);
    if(r.ok){ okN++; check(`kéo ${which} lần ${k}`); }
  }
  ok(okN > 100, `đủ lần kéo được nhận (${okN})`);
});

test("R11 Equal to a real seam: a new line exactly as long as the open layer-8 line of 杯口", () => {
  const open = block("杯口_L4").polylines.filter(p => p.layer === "8" && !p.closed).sort((x, y) => y.pts.length - x.pts.length)[0].pts;
  const sk = createSketch(), L = sk.add(createLine([0, 0], [10, 0]));
  ok(sk.constrain("equal", {shape: curve(open, false)}, {id: L}).ok);
  near(hyp(sk.get(L).a, sk.get(L).b), rawPerimeter(open, false), 1e-9, "dài bằng đường may thật, đo bằng vòng lặp");
});
