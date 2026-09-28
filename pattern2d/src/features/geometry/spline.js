/* NURBS curves — the SPLINE entity of DXF, and Bezier as its simplest case.

   A spline is kept exact: evaluated by de Boor's algorithm in homogeneous coordinates,
   measured by Gauss–Legendre quadrature on every knot span, bisected until the sum stops
   moving. Nothing is flattened to MEASURE it — flattening is only for drawing and for
   finding a starting guess. Arc length has no closed form for a spline, so this is the one
   shape whose length is a converged integral rather than arithmetic; it converges to about
   1e-12 mm, far below any tolerance a pattern needs (measure_engine.md §3).

   Shape: {kind: "spline", degree, knots, ctrl: [[x, y]], weights | null, u0, u1}.
   [u0, u1] is the live parameter range: a trimmed spline keeps its control net and narrows
   the range, so cutting a spline never re-approximates it. Like every shape it is immutable;
   the arc-length table is cached beside it, never on it.

   This file knows nothing of model.js (model.js dispatches to it), so it carries its own
   two-line affine map instead of importing one. */

/* Gauss–Legendre nodes and weights on [−1, 1], by Newton on the Legendre polynomial */
const GN = 16, GX = [], GW = [];
for(let i = 1; i <= GN; i++){
  let x = Math.cos(Math.PI*(i - 0.25)/(GN + 0.5)), dp = 1;
  for(let it = 0; it < 100; it++){
    let p0 = 1, p1 = x;
    for(let k = 2; k <= GN; k++){ const p2 = ((2*k - 1)*x*p1 - (k - 1)*p0)/k; p0 = p1; p1 = p2; }
    dp = GN*(x*p1 - p0)/(x*x - 1);
    const dx = p1/dp;
    x -= dx;
    if(Math.abs(dx) < 1e-16) break;
  }
  GX.push(x); GW.push(2/((1 - x*x)*dp*dp));
}

const bad = why => { throw new Error(`spline không hợp lệ: ${why}`); };
const finite = v => typeof v === "number" && Number.isFinite(v);

/* ── construction ───────────────────────────────────────────────────────────
   Every rule a knot vector must obey is checked here, once: a spline that got past the
   constructor can be evaluated anywhere in its range without another question. */
export function spline({degree, knots, ctrl, weights = null, u0, u1}){
  const p = degree, n = (ctrl || []).length;
  if(!Number.isInteger(p) || p < 1) bad(`bậc ${p} (cần số nguyên ≥ 1)`);
  if(n < p + 1) bad(`${n} control point cho bậc ${p} (cần ít nhất ${p + 1})`);
  const pts = ctrl.map(q => {
    if(!q || !finite(q[0]) || !finite(q[1])) bad("control point không phải số hữu hạn");
    return [q[0], q[1]];
  });
  if(!Array.isArray(knots) || knots.length !== n + p + 1)
    bad(`${(knots || []).length} knot cho ${n} control point bậc ${p} (cần ${n + p + 1})`);
  for(let i = 0; i < knots.length; i++){
    if(!finite(knots[i])) bad("knot không phải số hữu hạn");
    if(i && knots[i] < knots[i - 1]) bad(`knot giảm dần ở vị trí ${i}`);
  }
  if(!(knots[p] < knots[n])) bad("miền tham số rỗng");
  let w = null;
  if(weights){
    if(weights.length !== n) bad(`${weights.length} weight cho ${n} control point`);
    if(weights.some(x => !finite(x) || x <= 0)) bad("weight phải dương");
    w = weights.every(x => x === 1) ? null : weights.slice();
  }
  const lo = knots[p], hi = knots[n];
  const a = u0 ?? lo, b = u1 ?? hi;
  if(!(a >= lo && b <= hi && a <= b)) bad(`khoảng tham số [${a}, ${b}] ngoài [${lo}, ${hi}]`);
  return {kind: "spline", degree: p, knots: knots.slice(), ctrl: pts, weights: w, u0: a, u1: b};
}

/* Bezier of any degree = the clamped B-spline with no interior knot */
export function bezier(ctrl){
  const n = (ctrl || []).length;
  if(n < 2) bad("Bezier cần ít nhất 2 điểm");
  return spline({degree: n - 1, knots: [...Array(n).fill(0), ...Array(n).fill(1)], ctrl});
}

/* ── evaluation ─────────────────────────────────────────────────────────────── */
function spanOf(s, u){
  const K = s.knots, p = s.degree, n = s.ctrl.length;
  if(u >= K[n]){ let k = n - 1; while(k > p && K[k] === K[k + 1]) k--; return k; }
  let lo = p, hi = n - 1;                          // largest k with K[k] <= u: never an empty span
  while(lo < hi){ const m = (lo + hi + 1) >> 1; if(K[m] <= u) lo = m; else hi = m - 1; }
  return lo;
}

/* point and first derivative at parameter u — de Boor, stopped one level early so the
   derivative falls out of the last two points (C' = p·(d_p − d_{p−1}) / Δknot) */
export function splineEval(s, u){
  const K = s.knots, p = s.degree, W = s.weights;
  u = Math.max(K[p], Math.min(K[s.ctrl.length], u));
  const k = spanOf(s, u);
  const d = [];
  for(let j = 0; j <= p; j++){
    const q = s.ctrl[j + k - p], w = W ? W[j + k - p] : 1;
    d.push([q[0]*w, q[1]*w, w]);
  }
  for(let r = 1; r < p; r++)
    for(let j = p; j >= r; j--){
      const a0 = K[j + k - p], a = (u - a0)/(K[j + 1 + k - r] - a0);
      for(let c = 0; c < 3; c++) d[j][c] = (1 - a)*d[j - 1][c] + a*d[j][c];
    }
  const h = K[k + 1] - K[k], a = (u - K[k])/h;
  const C = [0, 1, 2].map(c => (1 - a)*d[p - 1][c] + a*d[p][c]);
  const D = [0, 1, 2].map(c => p*(d[p][c] - d[p - 1][c])/h);
  const x = C[0]/C[2], y = C[1]/C[2];
  return {pt: [x, y], d: [(D[0] - D[2]*x)/C[2], (D[1] - D[2]*y)/C[2]]};
}

const speed = (s, u) => { const d = splineEval(s, u).d; return Math.hypot(d[0], d[1]); };
function gl(s, a, b){
  const m = (a + b)/2, h = (b - a)/2;
  let sum = 0;
  for(let i = 0; i < GN; i++) sum += GW[i]*speed(s, m + h*GX[i]);
  return h*sum;
}

/* ── arc length: adaptive Gauss–Legendre, span by span ──────────────────────
   The table holds the leaves of the bisection: parameters U and cumulative lengths S.
   Everything that needs "how far along" reads it, so every answer agrees with length(). */
const tables = new WeakMap();
function table(s){
  let t = tables.get(s);
  if(t) return t;
  const U = [s.u0], S = [0];
  const breaks = [s.u0, ...s.knots.filter(k => k > s.u0 && k < s.u1), s.u1]
    .filter((v, i, a) => i === 0 || v > a[i - 1]);
  const leaf = (a, b, whole, depth) => {
    const m = (a + b)/2, l = gl(s, a, m), r = gl(s, m, b);
    if(depth >= 40 || Math.abs(l + r - whole) <= 1e-13*Math.max(1, whole)){
      U.push(m, b); S.push(S[S.length - 1] + l, S[S.length - 1] + l + r); return;
    }
    leaf(a, m, l, depth + 1); leaf(m, b, r, depth + 1);
  };
  for(let i = 1; i < breaks.length; i++) leaf(breaks[i - 1], breaks[i], gl(s, breaks[i - 1], breaks[i]), 0);
  t = {U, S, total: S[S.length - 1]};
  tables.set(s, t);
  return t;
}

export const splineLength = s => table(s).total;

/* parameter u that lies a fraction t of the way along the live range */
function uAt(s, t){
  const {U, S, total} = table(s);
  if(total <= 0) return s.u0;
  const want = Math.max(0, Math.min(1, t))*total;
  let i = 1;
  while(i < S.length - 1 && S[i] < want) i++;
  let lo = U[i - 1], hi = U[i];
  const need = want - S[i - 1], span = S[i] - S[i - 1];
  if(need <= 0) return lo;
  if(need >= span) return hi;
  let u = lo + (hi - lo)*need/span;
  for(let it = 0; it < 60; it++){                  // Newton, kept inside the bracket
    const f = gl(s, U[i - 1], u) - need;
    if(Math.abs(f) < 1e-13) break;
    if(f > 0) hi = u; else lo = u;
    const v = speed(s, u);
    let next = v > 1e-12 ? u - f/v : (lo + hi)/2;
    if(!(next > lo && next < hi)) next = (lo + hi)/2;
    u = next;
  }
  return u;
}
/* fraction of the length reached at parameter u */
function tAt(s, u){
  const {U, S, total} = table(s);
  if(total <= 0) return 0;
  let i = 1;
  while(i < U.length - 1 && U[i] < u) i++;
  return Math.max(0, Math.min(1, (S[i - 1] + gl(s, U[i - 1], Math.max(U[i - 1], Math.min(U[i], u))))/total));
}

export const splinePointAt = (s, t) => splineEval(s, uAt(s, t)).pt;
export function splineTangentAt(s, t){
  let u = uAt(s, t), d = splineEval(s, u).d;
  if(Math.hypot(d[0], d[1]) < 1e-12){               // a cusp: look a hair inside the range
    const e = (s.u1 - s.u0)*1e-6;
    d = splineEval(s, u < (s.u0 + s.u1)/2 ? u + e : u - e).d;
  }
  const n = Math.hypot(d[0], d[1]) || 1;
  return [d[0]/n, d[1]/n];
}

/* ── flattening: drawing, bounding box, a first guess for projection ─────── */
const flats = new WeakMap();                       // shape -> Map(tol -> {pts, us})
function flat(s, tol){
  let byTol = flats.get(s);
  if(!byTol){ byTol = new Map(); flats.set(s, byTol); }
  if(byTol.has(tol)) return byTol.get(tol);
  const pts = [], us = [];
  const breaks = [s.u0, ...s.knots.filter(k => k > s.u0 && k < s.u1), s.u1]
    .filter((v, i, a) => i === 0 || v > a[i - 1]);
  const at = u => splineEval(s, u).pt;
  const push = (u, q) => { pts.push(q); us.push(u); };
  const rec = (a, pa, b, pb, depth) => {
    const m = (a + b)/2, pm = at(m);
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], L = Math.hypot(dx, dy);
    const dev = L > 0 ? Math.abs((pm[0] - pa[0])*dy - (pm[1] - pa[1])*dx)/L : Math.hypot(pm[0] - pa[0], pm[1] - pa[1]);
    /* two forced levels: a cubic span can hide an S-bend whose midpoint sits on the chord */
    if(depth < 2 || (dev > tol && depth < 24)){ rec(a, pa, m, pm, depth + 1); rec(m, pm, b, pb, depth + 1); }
    else push(b, pb);
  };
  push(s.u0, at(s.u0));
  for(let i = 1; i < breaks.length; i++) rec(breaks[i - 1], at(breaks[i - 1]), breaks[i], at(breaks[i]), 0);
  const out = {tol, pts, us};
  byTol.set(tol, out);
  return out;
}
export const splineSample = (s, tol = 0.2) => flat(s, tol).pts.map(q => [q[0], q[1]]);
export function splineBBox(s){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for(const [x, y] of flat(s, 0.001).pts){ if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; }
  return {x0, y0, x1, y1, w: x1 - x0, h: y1 - y0};
}

/* nearest point: best chord of a fine flattening, then golden-section on the exact curve */
export function splineClosest(s, p){
  const {pts, us} = flat(s, 0.01);
  let best = 0, bd = Infinity;
  for(let i = 1; i < pts.length; i++){
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], dd = dx*dx + dy*dy;
    const f = dd ? Math.max(0, Math.min(1, ((p[0] - a[0])*dx + (p[1] - a[1])*dy)/dd)) : 0;
    const d = Math.hypot(p[0] - a[0] - dx*f, p[1] - a[1] - dy*f);
    if(d < bd){ bd = d; best = i; }
  }
  let lo = us[Math.max(0, best - 2)], hi = us[Math.min(us.length - 1, best + 1)];
  const dist = u => { const q = splineEval(s, u).pt; return Math.hypot(q[0] - p[0], q[1] - p[1]); };
  const g = (Math.sqrt(5) - 1)/2;
  let c = hi - g*(hi - lo), d = lo + g*(hi - lo), fc = dist(c), fd = dist(d);
  for(let it = 0; it < 80 && hi - lo > 1e-15*Math.max(1, Math.abs(hi)); it++){
    if(fc < fd){ hi = d; d = c; fd = fc; c = hi - g*(hi - lo); fc = dist(c); }
    else       { lo = c; c = d; fc = fd; d = lo + g*(hi - lo); fd = dist(d); }
  }
  let u = (lo + hi)/2;
  /* Golden section finds u only to √ε — the distance is flat at its minimum — which is
     1e-6 mm on a 150 mm curve. The foot of the perpendicular is a clean root instead:
     g(u) = (C(u) − p)·C′(u) = 0, found by Illinois false position inside a bracket. */
  const gOf = v => { const e = splineEval(s, v); return (e.pt[0] - p[0])*e.d[0] + (e.pt[1] - p[1])*e.d[1]; };
  let a = us[Math.max(0, best - 2)], b = us[Math.min(us.length - 1, best + 1)], ga = gOf(a), gb = gOf(b);
  if(ga*gb < 0){
    let side = 0;
    for(let it = 0; it < 100; it++){
      const c = (a*gb - b*ga)/(gb - ga), gc = gOf(c);
      if(gc === 0 || Math.abs(b - a) <= 1e-15*Math.max(1, Math.abs(c))){ u = c; break; }
      if(gc*gb < 0){ a = b; ga = gb; b = c; gb = gc; if(side === -1) ga /= 2; side = -1; }
      else         { b = c; gb = gc; if(side === 1) ga /= 2; side = 1; }
      u = c;
    }
  }
  for(const e of [s.u0, s.u1]) if(dist(e) < dist(u)) u = e;
  const q = splineEval(s, u).pt;
  return {t: tAt(s, u), point: q, dist: Math.hypot(q[0] - p[0], q[1] - p[1])};
}

/* ── editing: trim, reverse, transform ─────────────────────────────────────── */
export function splineTrim(s, t0, t1){
  if(t1 < t0) [t0, t1] = [t1, t0];
  return spline({...s, u0: uAt(s, t0), u1: uAt(s, t1)});
}
export function splineReverse(s){
  const K = s.knots, a = K[0], b = K[K.length - 1];
  return spline({degree: s.degree, knots: K.map(k => a + b - k).reverse(), ctrl: s.ctrl.slice().reverse(),
                 weights: s.weights ? s.weights.slice().reverse() : null, u0: a + b - s.u1, u1: a + b - s.u0});
}
/* NURBS are affine-invariant: mapping the control net maps the curve exactly. A similarity (move ·
   turn · mirror · uniform scale ×k) also maps every arc length by k and keeps the parameters where
   they are, so the length table goes along instead of being integrated again: exact, a move then
   changes no length at all, and dragging a drawing of 700 splines stops re-measuring every one of
   them every frame. A rigid motion (k = 1) keeps every flattening a flattening too — the chord
   test only asks distances — so those go along, moved. A skew gets tables of its own, worked out
   when first asked. */
export function splineTransform(s, m){
  const at = ([x, y]) => [m.a*x + m.c*y + m.e, m.b*x + m.d*y + m.f];
  const out = spline({...s, ctrl: s.ctrl.map(at)});
  const ka = m.a*m.a + m.b*m.b, kc = m.c*m.c + m.d*m.d, big = Math.max(1, ka);
  if(Math.abs(ka - kc) > 1e-12*big || Math.abs(m.a*m.c + m.b*m.d) > 1e-12*big) return out;
  const k = Math.sqrt(ka), t = tables.get(s), f = flats.get(s);
  if(t) tables.set(out, k === 1 ? t : {U: t.U, S: t.S.map(x => x*k), total: t.total*k});
  if(f && Math.abs(k - 1) <= 1e-12) flats.set(out, new Map([...f].map(([tol, v]) => [tol, {tol, pts: v.pts.map(at), us: v.us}])));
  return out;
}
