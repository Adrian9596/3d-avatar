/* The deform rule — what every edit of a line comes down to (spec: edit/edit.md §3–§4).

   A drag, a move, a typed length or angle: in the end some corners of a path travel by some
   vector. Each edge between two neighbouring corners A → B then follows by one rule:

     • both ends moved by the same vector  → the edge is translated;
     • otherwise                           → the similarity (turn + uniform scale + move) that
                                              takes A and B where they went — a straight edge
                                              stays straight, a curve keeps its shape;
     • neither end moved                   → the edge keeps every bit.

   Direct Edit and Precise Edit are two ways to say where the corners go; they cannot disagree,
   because they end here. Pure functions on [x, y] arrays in millimetres. */
import {matrix, applyM} from "./model.js";

const EPS = 1e-12;
const finite2 = v => Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]);
const RAD = Math.PI/180;

/* the similarity z → αz + β that takes a to a2 and b to b2 (complex numbers, as a matrix) */
export function similarity(a, b, a2, b2){
  const dx = b[0] - a[0], dy = b[1] - a[1], ex = b2[0] - a2[0], ey = b2[1] - a2[1];
  const dd = dx*dx + dy*dy;
  if(dd < EPS){
    if(ex*ex + ey*ey < EPS) return matrix(1, 0, 0, 1, a2[0] - a[0], a2[1] - a[1]);
    throw new Error("hai đầu cạnh trùng nhau — không kéo giãn được");
  }
  const p = (ex*dx + ey*dy)/dd, q = (ey*dx - ex*dy)/dd;            // α = (b2 − a2)/(b − a)
  return matrix(p, q, -q, p, a2[0] - (p*a[0] - q*a[1]), a2[1] - (q*a[0] + p*a[1]));
}

/* the vertex indices of the edge a → b, walking forward (and round, on a ring) */
export function edgeRange(n, closed, a, b){
  const out = [a];
  for(let t = a; t !== b; ){
    t = closed ? (t + 1) % n : t + 1;
    if(!closed && t >= n) break;
    out.push(t);
  }
  return out;
}

/* pts: [[x, y]] · bounds: vertex indices that bound edges — the corners (an open path's ends are added) ·
   moves: Map(index → [dx, dy]); a vertex inside an edge with its own move (a grip) moves alone */
export function deformPath(pts, closed, bounds, moves){
  const n = pts.length;
  for(const [i, d] of moves){
    if(!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`đỉnh không có: ${i}`);
    if(!finite2(d)) throw new Error(`độ dời không hợp lệ: [${d}]`);
  }
  const out = pts.map(q => q);                                     // untouched vertices stay the same arrays
  const at = i => moves.get(i);
  const shift = (i, d) => { out[i] = [pts[i][0] + d[0], pts[i][1] + d[1]]; };
  let cs = [...new Set(bounds)].filter(i => i >= 0 && i < n).sort((x, y) => x - y);
  if(!closed && n) cs = [...new Set([0, ...cs, n - 1])].sort((x, y) => x - y);

  for(const [i, d] of moves) shift(i, d);                          // corners and grips go where they were told
  if(cs.length < 2 && closed) return out;                          // no edge to carry: only the moved vertices
  const pairs = closed ? cs.map((a, j) => [a, cs[(j + 1) % cs.length]]) : cs.slice(0, -1).map((a, j) => [a, cs[j + 1]]);
  for(const [a, b] of pairs){
    const dA = at(a) || [0, 0], dB = at(b) || [0, 0];
    const idle = !at(a) && !at(b);
    const inner = edgeRange(n, closed, a, b).slice(1, -1).filter(i => !moves.has(i));
    if(idle || !inner.length) continue;
    if(dA[0] === dB[0] && dA[1] === dB[1]){ for(const i of inner) shift(i, dA); continue; }
    const m = similarity(pts[a], pts[b], [pts[a][0] + dA[0], pts[a][1] + dA[1]], [pts[b][0] + dB[0], pts[b][1] + dB[1]]);
    for(const i of inner){ const q = applyM(m, pts[i][0], pts[i][1]); out[i] = [q.x, q.y]; }
  }
  return out;
}

/* every vertex within `tol` mm of the chord first → last */
export function isStraight(pts, tol = 0.01){
  if(pts.length < 3) return true;
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  if(L < EPS) return false;
  return pts.every(q => Math.abs((q[0] - a[0])*dy - (q[1] - a[1])*dx)/L <= tol);
}

const polyLength = pts => { let s = 0; for(let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]); return s; };

/* Precise Length: where the moving end M (last vertex) must go so that the edge from its fixed
   end A (first vertex) is L long — a uniform scale about A, which is a slide along a straight
   edge and keeps the shape of a curved one */
export function lengthMove(edge, L){
  if(!Number.isFinite(L) || L <= 0) throw new Error(`chiều dài không hợp lệ: ${L} — cần một số > 0`);
  const s = polyLength(edge);
  if(s < 1e-9) throw new Error("cạnh dài 0 — không có hướng để kéo dài");
  const A = edge[0], M = edge[edge.length - 1], k = L/s;
  if(Math.hypot(M[0] - A[0], M[1] - A[1]) < 1e-9) throw new Error("cạnh khép kín về chính góc của nó — không phóng quanh góc đó được");
  return [A[0] + k*(M[0] - A[0]), A[1] + k*(M[1] - A[1])];
}

/* Precise Angle: where M must go so that the chord A → M points at `deg` (counter-clockwise
   from +X), turning about A */
export function angleMove(edge, deg){
  if(!Number.isFinite(deg)) throw new Error(`góc không hợp lệ: ${deg}`);
  const A = edge[0], M = edge[edge.length - 1], r = Math.hypot(M[0] - A[0], M[1] - A[1]);
  if(r < 1e-9) throw new Error("dây cung dài 0 — cạnh không có hướng");
  return [A[0] + r*Math.cos(deg*RAD), A[1] + r*Math.sin(deg*RAD)];
}

/* the chord direction first → last, in degrees 0 ≤ θ < 360 counter-clockwise from +X */
export function chordAngle(edge){
  const A = edge[0], M = edge[edge.length - 1];
  const a = Math.atan2(M[1] - A[1], M[0] - A[0])/RAD;
  return a < 0 ? a + 360 : a;
}

/* Distance + Angle: the vector of a move */
export function polar(d, deg){
  if(!Number.isFinite(d) || !Number.isFinite(deg)) throw new Error(`khoảng cách / góc không hợp lệ: ${d}, ${deg}`);
  return [d*Math.cos(deg*RAD), d*Math.sin(deg*RAD)];
}
