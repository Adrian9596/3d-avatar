/* Anchors — how a dependent point rides on the line it belongs to (spec: edit/edit.md §5).

   Layer 4 of Edit reads relations off the piece as it is, then lets the solver keep them:
   a seam vertex rides on the cut line, a notch on its edge, a grainline end on the boundary.
   What "rides" means is decided here, once, in millimetres:

   • a SEGMENT anchor holds a point by the segment A → B nearest to it: where its foot is, and
     how far along and across the segment the point sits. The foot follows the FOOT RULE —
     only B moved: keep the distance from A; only A moved: keep the distance from B; both
     moved: keep the fraction; neither: stay. A notch is a matching mark measured from the end
     of the seam that did not change (E7);
   • a CORNER anchor holds a seam corner by the two sides of the cut line it runs along: it
     stays b1 from one and b2 from the other, so an uneven seam allowance stays uneven;
   • a REACH end keeps a line's end on the boundary, sliding along the line's own direction.

   An anchor whose host did not move gives back the very numbers it was built from — so the
   parts of a piece nobody touched are not rounded by being re-solved (spec C1). */
import {point, line, bbox} from "./model.js";
import {intersect} from "./intersect.js";

const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sameP = (a, b) => a[0] === b[0] && a[1] === b[1];
const unit = (a, b) => { const L = hyp(a, b); return [(b[0] - a[0])/L, (b[1] - a[1])/L]; };
/* signed distance from q to the line a → b, positive on its left */
const toLine = (q, a, b) => ((b[0] - a[0])*(q[1] - a[1]) - (b[1] - a[1])*(q[0] - a[0]))/hyp(a, b);

/* a kernel shape as an anchor host: its vertices and whether they close */
export function hostOf(s){
  if(s && s.kind === "curve") return {pts: s.pts, closed: !!s.closed};
  if(s && s.kind === "line") return {pts: [[s.a.x, s.a.y], [s.b.x, s.b.y]], closed: false};
  throw new Error(`chỉ bám được polyline hoặc line, không bám ${s && s.kind}`);
}

function segOf(host, i){
  const n = host.pts.length, m = host.closed ? n : n - 1;
  if(!(Number.isInteger(i) && i >= 0 && i < m)) throw new Error(`không có đoạn ${i} trên đường ${n} đỉnh`);
  return [host.pts[i], host.pts[(i + 1) % n]];
}

/* the nearest segment of any host: host k, segment i (vertex i → i+1), fraction u, foot */
export function nearestOn(hosts, q){
  let best = null;
  hosts.forEach((h, k) => {
    const n = h.pts.length, m = h.closed ? n : n - 1;
    for(let i = 0; i < m; i++){
      const A = h.pts[i], B = h.pts[(i + 1) % n];
      const dx = B[0] - A[0], dy = B[1] - A[1], dd = dx*dx + dy*dy;
      if(dd < 1e-24) continue;
      const num = (q[0] - A[0])*dx + (q[1] - A[1])*dy;
      const foot = num <= 0 ? [A[0], A[1]] : num >= dd ? [B[0], B[1]] : [A[0] + dx*num/dd, A[1] + dy*num/dd];
      const d = hyp(q, foot);
      if(!best || d < best.dist) best = {k, i, u: Math.max(0, Math.min(1, num/dd)), dist: d, foot};
    }
  });
  return best;
}

/* A point ON a vertex of its host (a turn point at a corner, a seam vertex where the seam
   allowance is 0) is held by that vertex itself: the foot rule would leave it behind the
   corner as soon as the edge grew. `vertexTol` mm decides "on". */
export function anchorAt(hosts, q, at = nearestOn(hosts, q), {vertexTol = 0.01} = {}){
  if(!at) throw new Error("không có đoạn nào để bám");
  const [A, B] = segOf(hosts[at.k], at.i);
  const dA = hyp(q, A), dB = hyp(q, B);
  if(Math.min(dA, dB) <= vertexTol){
    const n = hosts[at.k].pts.length, v = dA <= dB ? at.i : (at.i + 1) % n, V = hosts[at.k].pts[v];
    return {kind: "vertex", k: at.k, v, V0: [V[0], V[1]], off: [q[0] - V[0], q[1] - V[1]], q0: [q[0], q[1]]};
  }
  const t = unit(A, B), n = [-t[1], t[0]], w = [q[0] - at.foot[0], q[1] - at.foot[1]];
  return {kind: "seg", k: at.k, i: at.i, u: at.u, dA: hyp(A, at.foot), dB: hyp(at.foot, B),
          A0: [A[0], A[1]], B0: [B[0], B[1]], a: w[0]*t[0] + w[1]*t[1], b: w[0]*n[0] + w[1]*n[1], q0: [q[0], q[1]]};
}

/* a seam corner held by the cut corner at host vertex v: its sides v−1 → v and v → v+1 */
export function cornerAnchor(hosts, q, k, v){
  const h = hosts[k], n = h.pts.length;
  const pi = h.closed ? (v - 1 + n) % n : v - 1;
  if(pi < 0 || v >= (h.closed ? n : n - 1)) throw new Error("góc nằm ở đầu một đường hở — không có hai cạnh để bám");
  return sidesAnchor(hosts, q, {k, i: pi}, {k, i: v});
}
/* a point held by two sides — two segments, adjacent or not (a cut corner drawn as a chamfer
   has one between them): it stays b1 from the first side's line and b2 from the second's */
function sidesAnchor(hosts, q, s1, s2){
  const side = s => { const [A, B] = segOf(hosts[s.k], s.i); return {k: s.k, i: s.i, A0: [A[0], A[1]], B0: [B[0], B[1]]}; };
  const a = side(s1), b = side(s2);
  return {kind: "corner", s1: a, s2: b, b1: toLine(q, a.A0, a.B0), b2: toLine(q, b.A0, b.B0), q0: [q[0], q[1]]};
}

export function placeAnchor(hosts, an){
  if(an.kind === "corner") return placeCorner(hosts, an);
  if(an.kind === "vertex"){
    const V = (hosts[an.k] || {pts: []}).pts[an.v];
    if(!V) throw new Error(`không còn đỉnh ${an.v} để bám`);
    return sameP(V, an.V0) ? [an.q0[0], an.q0[1]] : [V[0] + an.off[0], V[1] + an.off[1]];
  }
  const [A, B] = segOf(hosts[an.k], an.i);
  const mA = !sameP(A, an.A0), mB = !sameP(B, an.B0);
  if(!mA && !mB) return [an.q0[0], an.q0[1]];
  const L = hyp(A, B);
  if(L < 1e-12) throw new Error("đoạn đang bám co về một điểm");
  const t = [(B[0] - A[0])/L, (B[1] - A[1])/L], n = [-t[1], t[0]];
  let f;
  if(mB && !mA){ const d = Math.min(an.dA, L); f = [A[0] + t[0]*d, A[1] + t[1]*d]; }
  else if(mA && !mB){ const d = Math.min(an.dB, L); f = [B[0] - t[0]*d, B[1] - t[1]*d]; }
  else f = [A[0] + (B[0] - A[0])*an.u, A[1] + (B[1] - A[1])*an.u];
  return [f[0] + an.a*t[0] + an.b*n[0], f[1] + an.a*t[1] + an.b*n[1]];
}

/* where the two sides, each shifted by its own distance, meet */
function placeCorner(hosts, an){
  const [A1, B1] = segOf(hosts[an.s1.k], an.s1.i), [A2, B2] = segOf(hosts[an.s2.k], an.s2.i);
  if(sameP(A1, an.s1.A0) && sameP(B1, an.s1.B0) && sameP(A2, an.s2.A0) && sameP(B2, an.s2.B0)) return [an.q0[0], an.q0[1]];
  if(hyp(A1, B1) < 1e-12 || hyp(A2, B2) < 1e-12) throw new Error("cạnh của góc đang bám co về một điểm");
  const t1 = unit(A1, B1), t2 = unit(A2, B2), n1 = [-t1[1], t1[0]], n2 = [-t2[1], t2[0]];
  const o1 = [A1[0] + n1[0]*an.b1, A1[1] + n1[1]*an.b1], o2 = [A2[0] + n2[0]*an.b2, A2[1] + n2[1]*an.b2];
  const cr = t1[0]*t2[1] - t1[1]*t2[0];
  if(Math.abs(cr) < Math.sin(Math.PI/180)){                        // the two sides went parallel: keep the place along the first
    const u0 = unit(an.s1.A0, an.s1.B0), along = (an.q0[0] - an.s1.A0[0])*u0[0] + (an.q0[1] - an.s1.A0[1])*u0[1];
    return [o1[0] + t1[0]*along, o1[1] + t1[1]*along];
  }
  const D = [o2[0] - o1[0], o2[1] - o1[1]], t = (D[0]*t2[1] - D[1]*t2[0])/cr;
  return [o1[0] + t1[0]*t, o1[1] + t1[1]*t];
}

/* the direction a polyline travels into vertex j (step −1) or out of it (step +1), skipping
   repeated vertices; null past the end of an open one */
function travel(pts, closed, j, step){
  const n = pts.length;
  for(let g = 1, k = j + step; g < n; g++, k += step){
    if(!closed && (k < 0 || k >= n)) return null;
    const q = pts[(k % n + n) % n];
    if(hyp(q, pts[j]) >= 1e-9) return step < 0 ? unit(q, pts[j]) : unit(pts[j], q);
  }
  return null;
}
/* the next vertex of pts from j in direction step that is not j itself, or null at an open end */
function neighbour(pts, closed, j, step){
  const n = pts.length;
  for(let g = 1, k = j + step; g < n; g++, k += step){
    if(!closed && (k < 0 || k >= n)) return null;
    const q = pts[(k % n + n) % n];
    if(hyp(q, pts[j]) >= 1e-9) return q;
  }
  return null;
}
/* the nearest segment running with direction d (either way, within the angle whose sine is
   sinTol) and no further than `band` mm */
function nearestAlong(hosts, q, d, sinTol, band){
  let best = null;
  hosts.forEach((h, k) => {
    const n = h.pts.length, m = h.closed ? n : n - 1;
    for(let i = 0; i < m; i++){
      const A = h.pts[i], B = h.pts[(i + 1) % n];
      const dx = B[0] - A[0], dy = B[1] - A[1], dd = dx*dx + dy*dy;
      if(dd < 1e-24 || Math.abs(dx*d[1] - dy*d[0])/Math.sqrt(dd) > sinTol) continue;
      const num = (q[0] - A[0])*dx + (q[1] - A[1])*dy;
      const foot = num <= 0 ? [A[0], A[1]] : num >= dd ? [B[0], B[1]] : [A[0] + dx*num/dd, A[1] + dy*num/dd];
      const dist = hyp(q, foot);
      if(dist <= band && (!best || dist < best.dist)) best = {k, i, u: Math.max(0, Math.min(1, num/dd)), dist, foot};
    }
  });
  return best;
}

/* One anchor per vertex of a follower (a seam line) on its hosts (the cut line).

   A seam line is the cut line pushed in by the allowance, so it runs PARALLEL to the part of the
   cut line it belongs to. That, not mere nearness, says which segment a seam vertex rides on:
   where the allowance is uneven at a corner (3380 后比: 7 mm along the side, 1.6 mm along the top),
   a seam vertex just before the corner is nearer the top's line than its own side's.
     • a seam vertex that turns by more than `turn`° is a CORNER: held by the segment running with
       the seam into it and the one running with the seam out of it — adjacent or not, so a cut
       corner drawn as a chamfer holds its seam corner by the two real sides;
     • any other vertex rides on the nearest segment running with the seam there (within
       `parallel`°, no further than `band` mm), or the nearest one when none does;
     • before either: a seam vertex ON a cut vertex (≤ `vertexTol` mm — the seam meets the cut
       line there, or runs on it with allowance 0) rides on that vertex.

   A segment "running with" a vertex is only believed at an allowance the line really has: no
   further than the largest distance at which the line runs WITH the cut line somewhere (measured
   at the middle of each of its own segments), plus `slack` mm. A seam line's uneven corner passes —
   its other side IS such a distance. A layer-8 line that is not a seam line fails: the 3380 杯口
   lace scallop runs 3–5 mm under the straight top edge, and its cusps happen to run parallel to the
   curve across the piece, 20–29 mm away — they ride the edge they are next to (edit.md C8). */
export function followAnchors(hosts, pts, closed, {turn = 10, parallel = 20, band = 30, vertexTol = 0.01, slack = 1} = {}){
  const sinTol = Math.sin(parallel*Math.PI/180);
  const reach = runsWith(hosts, pts, closed, {parallel, band}).allowance + slack;
  const believed = s => s && s.dist <= reach ? s : null;
  const out = pts.map((q, j) => {
    /* ON a cut vertex (allowance 0 there: the seam meets the cut line, or follows it) → that vertex */
    const on = nearestOn(hosts, q);
    if(on && on.dist <= vertexTol){ const an = anchorAt(hosts, q, on, {vertexTol}); if(an.kind === "vertex") return an; }
    const dIn = travel(pts, closed, j, -1), dOut = travel(pts, closed, j, +1);
    if(dIn && dOut){
      const cs = Math.max(-1, Math.min(1, dIn[0]*dOut[0] + dIn[1]*dOut[1]));
      if(Math.acos(cs)*180/Math.PI > turn){
        let s1 = believed(nearestAlong(hosts, q, dIn, sinTol, band)), s2 = believed(nearestAlong(hosts, q, dOut, sinTol, band));
        /* a seam tip in a narrow V of the cut line (LiftyBliss P18-LACE, sides 15° apart): both sides run within
           `parallel`° of both arms, and from the tip itself one side is the nearer for both — so ask each arm, from
           its own middle, which side it runs along (edit.md C13). Only then: a corner held by two sides already is
           held as it was */
        if(s1 && s2 && s1.k === s2.k && s1.i === s2.i){
          const P = neighbour(pts, closed, j, -1), N = neighbour(pts, closed, j, +1);
          const t1 = believed(nearestAlong(hosts, [(P[0] + q[0])/2, (P[1] + q[1])/2], dIn, sinTol, band));
          const t2 = believed(nearestAlong(hosts, [(q[0] + N[0])/2, (q[1] + N[1])/2], dOut, sinTol, band));
          if(t1 && t2 && !(t1.k === t2.k && t1.i === t2.i)){ s1 = t1; s2 = t2; }
        }
        if(s1 && s2 && !(s1.k === s2.k && s1.i === s2.i)) return sidesAnchor(hosts, q, s1, s2);
      }
    }
    const sum = dIn && dOut ? [dIn[0] + dOut[0], dIn[1] + dOut[1]] : (dIn || dOut);
    const L = sum ? Math.hypot(sum[0], sum[1]) : 0;
    const at = (L > 1e-9 && believed(nearestAlong(hosts, q, [sum[0]/L, sum[1]/L], sinTol, band))) || nearestOn(hosts, q);
    if(!at) throw new Error("không có đường nào để bám");
    return anchorAt(hosts, q, at);
  });
  return keepTogether(hosts, pts, closed, out, {reach, sinTol, band});
}

/* A line between two edges must not come apart (edit.md C14). Down the middle of a narrow part — SN1252: 24 mm
   wide, 12 mm from each edge — each vertex's nearest parallel edge is a tie, and a few of them ride the far edge while
   their neighbours ride the near one: move one edge and those few leave the line. A run of vertices riding a part
   of the cut line far (along it) from where both its neighbours ride is an ISLAND; a vertex of it that is no more
   than 1 mm further from its neighbours' part than from its own takes their part. A vertex clearly nearer the other
   edge keeps it — there the line does follow the other edge */
function keepTogether(hosts, pts, closed, out, {reach, sinTol, band}){
  const n = pts.length;
  if(n < 3) return out;
  const cum = hosts.map(h => { const c = [0]; for(let i = 1; i <= h.pts.length; i++) c.push(c[i - 1] + hyp(h.pts[i - 1], h.pts[i % h.pts.length])); return c; });
  /* where an anchor holds, as arc length along host k (a stretch [a, b] of no length): its foot, its vertex — or,
     for a corner, the foot of the seam vertex on each of its two sides */
  const at = (k, s) => ({k, a: s, b: s});
  const footOn = (x, q) => {
    const [A, B] = segOf(hosts[x.k], x.i), dx = B[0] - A[0], dy = B[1] - A[1], dd = dx*dx + dy*dy;
    const u = dd ? Math.max(0, Math.min(1, ((q[0] - A[0])*dx + (q[1] - A[1])*dy)/dd)) : 0;
    return at(x.k, cum[x.k][x.i] + u*(cum[x.k][x.i + 1] - cum[x.k][x.i]));
  };
  const feet = an => an.kind === "seg" ? [at(an.k, cum[an.k][an.i] + an.u*(cum[an.k][an.i + 1] - cum[an.k][an.i]))]
                   : an.kind === "corner" ? [footOn(an.s1, an.q0), footOn(an.s2, an.q0)]
                   : an.kind === "vertex" ? [at(an.k, cum[an.k][an.v])] : [];
  /* how far apart two stretches are along the cut line: 0 when they meet, the shorter way round a ring */
  const gapS = (x, y) => {
    if(x.k !== y.k) return Infinity;
    const [P, Q] = x.a <= y.a ? [x, y] : [y, x];
    if(Q.a <= P.b) return 0;
    return hosts[x.k].closed ? Math.min(Q.a - P.b, cum[x.k][cum[x.k].length - 1] - Q.b + P.a) : Q.a - P.b;
  };
  const gap = (a, b) => Math.min(Infinity, ...feet(a).flatMap(x => feet(b).map(y => gapS(x, y))));
  const m = closed ? n : n - 1, slackAlong = 2*reach + 5;
  /* the seam's own length from vertex a forward to vertex b */
  const along = (a, b) => { let L = 0; for(let j = a; j !== b; j = (j + 1) % n) L += hyp(pts[j], pts[(j + 1) % n]); return L; };
  /* a jump: from one vertex to the next the part ridden changes to one far along the cut line — or it changes AT a
     vertex, a corner held by two sides far apart (SN1252's hairpin turn: one arm with each edge of the strap). Such a
     corner goes with the run it came in by (its first side is the one its incoming arm runs with) */
  const bridging = an => an.kind === "corner" && gapS(footOn(an.s1, an.q0), footOn(an.s2, an.q0)) > slackAlong;
  const jumps = [];
  for(let j = 0; j < m; j++)
    if(bridging(out[j]) || gap(out[j], out[(j + 1) % n]) > hyp(pts[j], pts[(j + 1) % n]) + slackAlong) jumps.push(j);
  if(jumps.length < 2) return out;
  /* runs between consecutive jumps: from the vertex after one jump to the vertex of the next */
  for(let r = 0; r < jumps.length - (closed ? 0 : 1); r++){
    const first = (jumps[r] + 1) % n, last = jumps[(r + 1) % jumps.length], before = jumps[r], after = (last + 1) % n;
    if(gap(out[before], out[after]) > along(before, after) + slackAlong) continue;      // its neighbours do not ride together
    for(let t = first; ; t = (t + 1) % n){
      const q = pts[t], dIn = travel(pts, closed, t, -1), dOut = travel(pts, closed, t, +1);
      const sum = dIn && dOut ? [dIn[0] + dOut[0], dIn[1] + dOut[1]] : (dIn || dOut), L = sum ? Math.hypot(sum[0], sum[1]) : 0;
      const a = out[t], own = a.kind === "seg" ? segDist(q, ...segOf(hosts[a.k], a.i))
                            : a.kind === "corner" ? Math.min(segDist(q, ...segOf(hosts[a.s1.k], a.s1.i)), segDist(q, ...segOf(hosts[a.s2.k], a.s2.i)))
                            : a.kind === "vertex" ? hyp(q, hosts[a.k].pts[a.v]) : Infinity;
      /* the neighbours' part: within reach of where the vertex before the run, or the one after it, rides —
         as far along as the seam runs from that vertex to this one */
      const dB = along(before, t), dA = along(t, after);
      const near = (k, sAt) => feet(out[before]).some(f => gapS(f, at(k, sAt)) <= dB + slackAlong) ||
                               feet(out[after]).some(f => gapS(f, at(k, sAt)) <= dA + slackAlong);
      /* on the neighbours' part, as the neighbours themselves were anchored: the segment running with the line
         there if there is one within reach, else the nearest */
      const par = L > 1e-9 ? nearestAlongNear(hosts, cum, q, [sum[0]/L, sum[1]/L], sinTol, band, near) : null;
      const any = nearestAlongNear(hosts, cum, q, [1, 0], Infinity, band, near);
      /* a tie is decided by how near the neighbours' part comes at all; the anchor on it, as they were anchored */
      if(any && any.dist <= own + 1) out[t] = anchorAt(hosts, q, par && par.dist <= reach ? par : any);
      if(t === last) break;
    }
  }
  return out;
}
const segDist = (q, A, B) => { const dx = B[0] - A[0], dy = B[1] - A[1], dd = dx*dx + dy*dy, u = dd ? Math.max(0, Math.min(1, ((q[0] - A[0])*dx + (q[1] - A[1])*dy)/dd)) : 0; return Math.hypot(q[0] - A[0] - dx*u, q[1] - A[1] - dy*u); };
/* nearestAlong, among the segments whose foot `near(k, s)` accepts (s: arc length along host k) */
function nearestAlongNear(hosts, cum, q, d, sinTol, band, near){
  let best = null;
  hosts.forEach((h, k) => {
    const n = h.pts.length, m = h.closed ? n : n - 1;
    for(let i = 0; i < m; i++){
      const A = h.pts[i], B = h.pts[(i + 1) % n], dx = B[0] - A[0], dy = B[1] - A[1], dd = dx*dx + dy*dy;
      if(dd < 1e-24 || (sinTol < 1 && Math.abs(dx*d[1] - dy*d[0])/Math.sqrt(dd) > sinTol)) continue;     // sinTol ≥ 1: any direction
      const num = (q[0] - A[0])*dx + (q[1] - A[1])*dy, u = Math.max(0, Math.min(1, num/dd));
      const foot = [A[0] + dx*u, A[1] + dy*u], dist = hyp(q, foot);
      if(dist > band || (best && dist >= best.dist) || !near(k, cum[k][i] + u*(cum[k][i + 1] - cum[k][i]))) continue;
      best = {k, i, u, dist, foot};
    }
  });
  return best;
}

/* How a line runs with the cut line (the hosts): over the middle of each of its own segments, the
   nearest cut segment — does it run within `parallel`° of it, and no further than `band` mm? `share`
   is the part of the line's length that does, `allowance` the largest distance at which it does (0
   when it never does). A seam line runs with the cut line nearly everywhere; a tick across an edge
   nowhere (edit.md §5). */
export function runsWith(hosts, pts, closed, {parallel = 20, band = 30} = {}){
  const sinTol = Math.sin(parallel*Math.PI/180), n = pts.length, m = closed ? n : n - 1;
  let total = 0, along = 0, allowance = 0;
  for(let j = 0; j < m; j++){
    const P = pts[j], Q = pts[(j + 1) % n], L = hyp(P, Q);
    if(L < 1e-9) continue;
    total += L;
    const r = nearestOn(hosts, [(P[0] + Q[0])/2, (P[1] + Q[1])/2]);
    if(!r || r.dist > band) continue;
    const h = hosts[r.k], A = h.pts[r.i], B = h.pts[(r.i + 1) % h.pts.length], S = hyp(A, B);
    if(Math.abs((B[0] - A[0])*(Q[1] - P[1]) - (B[1] - A[1])*(Q[0] - P[0]))/(S*L) > sinTol) continue;
    along += L;
    allowance = Math.max(allowance, r.dist);
  }
  return {share: total ? along/total : 0, allowance};
}
export const followPlace = (hosts, anchors) => anchors.map(an => placeAnchor(hosts, an));

/* ── reach: a line's end kept on the boundary ────────────────────────────────
   Its end E and the vertex F before it give the line's own direction; after an edit the end
   goes where that line meets the boundary, nearest to where it was, at the same tiny offset
   it had (a grainline drawn 0.004 mm short stays 0.004 mm short). */
function endsOf(s){
  const pts = hostOf(s).pts;
  if(pts.length < 2) throw new Error("đường chạm biên cần ít nhất hai đỉnh");
  return pts;
}
/* the whole line through F along d, long enough to cross everything */
function probeOf(F, d, boundary){
  const boxes = boundary.map(bbox);
  const far = Math.max(1, ...boxes.flatMap(b => [Math.abs(b.x0), Math.abs(b.x1), Math.abs(b.y0), Math.abs(b.y1)]),
                       Math.abs(F[0]), Math.abs(F[1]));
  const R = 4*far + 1000;
  return line(point(F[0] - d[0]*R, F[1] - d[1]*R), point(F[0] + d[0]*R, F[1] + d[1]*R));
}
/* Where the end that was at E meets the boundary now: on the PART of the cut line it was on — segment
   `seg` of the host it lay on, or the nearest segment round that host the line crosses — as a notch
   rides its segment. "The crossing nearest to where the end was" is wrong as soon as an edit moves
   the boundary by more than half the width across it: a line across an 8 mm strap shifted 4.2 mm
   finds the far side nearer, and a 6 mm binding raised 8 mm finds its bottom edge nearer (edit.md C9).
   Only when no segment of that host crosses the line any more: the crossing ahead of F nearest to E,
   anywhere on the boundary. The crossing may lie behind F: the caller walks the end back. */
function sideHit(F, d, boundary, E, seg){
  const probe = probeOf(F, d, boundary), hosts = boundary.map(hostOf), h = hosts[seg.k];
  if(h){
    const n = h.pts.length, m = h.closed ? n : n - 1;
    for(let step = 0; step <= m; step++){
      let best = null;
      for(const i0 of step ? [seg.i + step, seg.i - step] : [seg.i]){
        const i = h.closed ? ((i0 % m) + m) % m : i0;
        if(i < 0 || i >= m) continue;
        const A = h.pts[i], B = h.pts[(i + 1) % n];
        if(hyp(A, B) < 1e-12) continue;
        for(const x of intersect(probe, line(point(A[0], A[1]), point(B[0], B[1])))){
          const q = [x.x, x.y], away = hyp(q, E);
          if(!best || away < best.away) best = {q, away};
        }
      }
      if(best) return best.q;
      if(h.closed && 2*step >= m) break;
    }
  }
  let best = null;
  for(const b of boundary) for(const x of intersect(probe, b)){
    const q = [x.x, x.y];
    if((q[0] - F[0])*d[0] + (q[1] - F[1])*d[1] <= 1e-9) continue;
    const away = hyp(q, E);
    if(!best || away < best.away) best = {q, away};
  }
  return best && best.q;
}

/* which ends of s lie on the boundary (≤ tol mm), and how they sit on it */
export function reachBuild(s, boundary, {tol = 0.01} = {}){
  const pts = endsOf(s), out = [];
  for(const end of ["start", "end"]){
    const E = end === "start" ? pts[0] : pts[pts.length - 1];
    const F = end === "start" ? pts[1] : pts[pts.length - 2];
    if(hyp(E, F) < 1e-12) continue;
    const on = nearestOn(boundary.map(hostOf), E);
    if(!on || on.dist > tol) continue;
    const seg = {k: on.k, i: on.i}, d = unit(F, E), h = sideHit(F, d, boundary, E, seg);
    if(!h) continue;
    /* on the boundary but crossing it elsewhere: the line lies ALONG an edge — riding it, not
       reaching it (edit.md §5); relate.js gives such a line to the seam rule instead */
    const delta = (E[0] - h[0])*d[0] + (E[1] - h[1])*d[1];
    if(Math.abs(delta) > tol) continue;
    out.push({end, seg, h0: h, e0: [E[0], E[1]], f0: [F[0], F[1]], delta});
  }
  return out;
}

/* After an edit an end slides along its last segment to the boundary — unless the boundary came in
   past that segment's other vertex F (a polyline with a 1 mm last segment: VeraLifting, Bianca).
   Sliding would then put the end BEHIND F and fold the line back on itself; instead the end walks
   back along the line itself to where the line now crosses the boundary, and the vertices it passes
   join it there — same vertex count, same track, nothing reversed (edit.md C9). A line the boundary
   has passed entirely is an error, as any relation that breaks (C6). */
export function reachEnds(s, boundary, {ends}){
  const src = endsOf(s), n = src.length, pts = src.map(q => [q[0], q[1]]);
  for(const e of ends){
    const start = e.end === "start", say = start ? "đầu" : "cuối";
    const iE = start ? 0 : n - 1, iF = start ? 1 : n - 2;
    const E = src[iE], F = src[iF], d = unit(F, E);
    const h = sideHit(F, d, boundary, E, e.seg || {k: -1, i: 0});
    if(h){
      if(sameP(h, e.h0) && sameP(E, e.e0) && sameP(F, e.f0)){ pts[iE] = [e.e0[0], e.e0[1]]; continue; }
      const P = [h[0] + d[0]*e.delta, h[1] + d[1]*e.delta];
      if((P[0] - F[0])*d[0] + (P[1] - F[1])*d[1] > 1e-9){ pts[iE] = P; continue; }
    }
    const step = start ? 1 : -1;
    let k = iF, hit = null;
    for(; start ? k < n - 1 : k > 0; k += step){
      const A = src[k], B = src[k + step];
      if(hyp(A, B) < 1e-12) continue;
      const seg = line(point(A[0], A[1]), point(B[0], B[1]));
      for(const b of boundary) for(const x of intersect(seg, b)){
        const q = [x.x, x.y];
        if(!hit || hyp(q, A) < hyp(hit, A)) hit = q;
      }
      if(hit) break;
    }
    if(!hit) throw new Error(`${say} đường không còn chạm biên — cả đường nằm ngoài biên mới`);
    for(let m = iE; m !== k + step; m += step) pts[m] = [hit[0], hit[1]];
  }
  /* both ends walked back past each other: nothing of the line is left inside */
  for(let m = 1; m < n; m++){
    const a = src[m - 1], b = src[m], dx = pts[m][0] - pts[m - 1][0], dy = pts[m][1] - pts[m - 1][1];
    if(dx*(b[0] - a[0]) + dy*(b[1] - a[1]) < -1e-12) throw new Error("biên cắt ngang qua hết đường — đường sẽ gập ngược");
  }
  return s.kind === "line" ? line(point(pts[0][0], pts[0][1]), point(pts[1][0], pts[1][1])) : {kind: "curve", pts, closed: false};
}
