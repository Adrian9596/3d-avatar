/* Corners of a polyline — where one edge of a pattern piece ends and the next begins
   (spec: edit/edit.md §2).

   This is the definition the Edges feature has always used, moved here so that Edit selects
   exactly the edges Edges prints: a vertex is a corner when the direction turns by more than
   `thresh` degrees, measured over a window of `win` millimetres on each side. DXF vertices are
   spaced very unevenly — a straight edge has two, a curve has hundreds — so a per-vertex angle
   would find a corner in every coarse curve. Hits closer together than one window are one
   corner (the sharpest of them), and an edge shorter than `minEdge` is folded into its
   shorter neighbour.

   A ring of fewer than 8 vertices has no room for a window: every vertex turning by more than
   `thresh` is a corner. An open path always has its two ends as corners.

   The result keeps the order Edges labels its edges in (A, B, C … — cyclic, not necessarily
   starting at the lowest index); sort a copy when only the set matters.

   `fromCorner` measures FROM those corners: the point d mm along a path from the nearer corner of the
   edge a click is on — a notch placed "1/2 in from the corner" (spec: geometry/sketch.md §7 O17). */
import {point} from "./model.js";
import {locate, pointAtS} from "./path.js";

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function cornerIndices(pts, closed = true, {win = 7, thresh = 26, minEdge = 12} = {}){
  const n = pts.length;
  if(!closed) return openCorners(pts, win, thresh, minEdge);
  if(n < 3) return [];
  if(n < 8) return plainCorners(pts, thresh);
  return windowCorners(pts, win, thresh, minEdge);
}

/* The point d mm along the path ch (path.js chain) from the nearer corner of the edge the click p is on
   (O17). corners: points on the path where one edge ends and the next begins — Edges' corners, a Path's turn
   points. The edge is the stretch between two corners holding p's foot: on a closed path the one across its
   start too, and one corner alone makes the whole ring one edge; an open path's two ends are always corners.
   Nearer = nearer ALONG the edge; a tie goes to the edge's first corner. Refused when there is no corner, when
   d is not a length ≥ 0, or when the edge is shorter than d — then the error carries the edge's length
   (`edgeLength`, mm) for the tool to write in the display unit.
   Returns {point, corner, length (of the edge), s (of the point on ch)}. */
export function fromCorner(ch, corners, p, d){
  if(typeof d !== "number" || !Number.isFinite(d) || d < 0) throw new Error(`khoảng cách không hợp lệ: ${d} — cần một độ dài ≥ 0`);
  const total = ch.total, S = [];
  const add = s => {
    if(ch.closed && s >= total - 1e-9) s = 0;                      // the start of a ring, found at its end
    if(!S.some(x => Math.abs(x - s) <= 1e-9)) S.push(s);
  };
  for(const c of corners || []) add(locate(ch, point(c[0], c[1])).s);
  if(!ch.closed){ add(0); add(total); }
  if(!S.length) throw new Error("đường này không có góc — không đo được khoảng cách từ góc");
  S.sort((x, y) => x - y);
  const s = locate(ch, point(p[0], p[1])).s;
  let a, b;                                                         // the edge, a → b along the path (b > a)
  if(ch.closed){
    let i = S.length - 1;
    while(i >= 0 && S[i] > s) i--;
    if(i < 0){ a = S[S.length - 1] - total; b = S[0]; }              // before the first corner: the edge across the start
    else { a = S[i]; b = i + 1 < S.length ? S[i + 1] : S[0] + total; }
  } else {
    let i = S.length - 2;
    while(i > 0 && S[i] > s) i--;
    a = S[i]; b = S[i + 1];
  }
  const L = b - a, along = s - a, fromStart = along <= L - along;
  if(d > L + 1e-9){
    const e = new Error(`cạnh này chỉ dài ${L.toFixed(2)} mm — khoảng cách ${d.toFixed(2)} mm dài hơn cạnh`);
    e.edgeLength = L;
    throw e;
  }
  const at = fromStart ? Math.min(a + d, b) : Math.max(b - d, a);
  const q = pointAtS(ch, at), c = pointAtS(ch, fromStart ? a : b);
  return {point: [q.x, q.y], corner: [c.x, c.y], length: L, s: ch.closed ? ((at % total) + total) % total : at};
}

/* the turn at b between the directions a→b and b→c, in degrees; null when either is empty */
function turn(a, b, c){
  const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
  if(n1 < 1e-9 || n2 < 1e-9) return null;
  const cs = Math.max(-1, Math.min(1, (v1[0]*v2[0] + v1[1]*v2[1])/(n1*n2)));
  /* written exactly as Edges wrote it: acos·180 first, then ÷π — two nearly equal turns in one
     window pick their sharpest by the last bit, and a different rounding picks the other one */
  return Math.acos(cs) * 180/Math.PI;
}

/* small rings: the plain angle at each vertex, skipping repeated vertices */
function plainCorners(pts, thresh){
  const n = pts.length, out = [];
  for(let i = 0; i < n; i++){
    let p = (i - 1 + n) % n, q = (i + 1) % n, guard = 0;
    while(dist(pts[p], pts[i]) < 1e-9 && guard++ < n) p = (p - 1 + n) % n;
    guard = 0;
    while(dist(pts[q], pts[i]) < 1e-9 && guard++ < n) q = (q + 1) % n;
    const a = turn(pts[p], pts[i], pts[q]);
    if(a !== null && a > thresh) out.push(i);
  }
  return out;
}

/* The windowed rule of Edges, step for step (its output is pinned by edges.test.js and by the
   corner test on the real 3380 rings): edge lengths are summed in the same order as Edges
   summed them, because a tie in "which neighbour is shorter" must break the same way. */
function windowCorners(poly, win, thresh, minEdge){
  const n = poly.length;
  const step = [];
  for(let i = 0; i < n; i++) step.push(dist(poly[i], poly[(i + 1) % n]));
  const walk = (i, back) => {
    let acc = 0, j = i;
    for(let guard = 0; guard < n; guard++){
      const k = back ? (j - 1 + n) % n : j, d = step[k];
      if(d > 0 && acc + d >= win){
        const t = (win - acc)/d;
        const pa = back ? poly[(j - 1 + n) % n] : poly[j];
        const pb = back ? poly[j] : poly[(j + 1) % n];
        return back ? [pb[0] + (pa[0] - pb[0])*t, pb[1] + (pa[1] - pb[1])*t]
                    : [pa[0] + (pb[0] - pa[0])*t, pa[1] + (pb[1] - pa[1])*t];
      }
      acc += d; j = back ? (j - 1 + n) % n : (j + 1) % n;
    }
    return poly[j];
  };
  const hits = [];
  for(let i = 0; i < n; i++){
    const ang = turn(walk(i, true), poly[i], walk(i, false));
    if(ang !== null && ang > thresh) hits.push([i, ang]);
  }
  if(hits.length < 2) return [];
  const cum = [0];
  for(const d of step) cum.push(cum[cum.length - 1] + d);
  const total = cum[n];
  const near = (a, b) => Math.min((cum[a] - cum[b] + total) % total, (cum[b] - cum[a] + total) % total);
  const groups = [];
  for(const h of hits){
    const g = groups[groups.length - 1];
    if(g && near(h[0], g[g.length - 1][0]) <= win) g.push(h); else groups.push([h]);
  }
  if(groups.length > 1 && near(groups[0][0][0], groups[groups.length - 1].slice(-1)[0][0]) <= win)
    groups[0] = groups.pop().concat(groups[0]);
  const corners = [...new Set(groups.map(g => g.reduce((m, x) => x[1] > m[1] ? x : m)[0]))].sort((a, b) => a - b);

  /* an edge is [a, b] walking forward; its length is summed from a, as Edges' plen did */
  const lenOf = (a, b) => {
    let s = 0;
    for(let t = a; t !== b; t = (t + 1) % n) s += dist(poly[t], poly[(t + 1) % n]);
    return s;
  };
  let segs = corners.map((a, j) => { const b = corners[(j + 1) % corners.length]; return {a, b, len: lenOf(a, b)}; });
  let changed = true;
  while(changed && segs.length > 2){
    changed = false;
    for(let j = 0; j < segs.length; j++){
      if(segs[j].len >= minEdge) continue;
      const prev = segs[(j - 1 + segs.length) % segs.length], nxt = segs[(j + 1) % segs.length];
      if(prev.len <= nxt.len){ prev.b = segs[j].b; prev.len = lenOf(prev.a, prev.b); }
      else { nxt.a = segs[j].a; nxt.len = lenOf(nxt.a, nxt.b); }
      segs.splice(j, 1); changed = true; break;
    }
  }
  return segs.map(s => s.a);
}

/* an open path: the two ends, plus every elbow the window finds in between */
function openCorners(pts, win, thresh, minEdge){
  const n = pts.length;
  if(n === 0) return [];
  if(n === 1) return [0];
  const step = [];
  for(let i = 0; i < n - 1; i++) step.push(dist(pts[i], pts[i + 1]));
  /* the point `win` mm away along the path, or the end of the path if it is nearer */
  const walk = (i, back) => {
    let acc = 0, j = i;
    while(back ? j > 0 : j < n - 1){
      const d = back ? step[j - 1] : step[j];
      if(d > 0 && acc + d >= win){
        const t = (win - acc)/d, pa = pts[j], pb = back ? pts[j - 1] : pts[j + 1];
        return [pa[0] + (pb[0] - pa[0])*t, pa[1] + (pb[1] - pa[1])*t];
      }
      acc += d; j += back ? -1 : 1;
    }
    return pts[j];
  };
  const cum = [0];
  for(const d of step) cum.push(cum[cum.length - 1] + d);
  const groups = [];
  for(let i = 1; i < n - 1; i++){
    const ang = turn(walk(i, true), pts[i], walk(i, false));
    if(ang === null || ang <= thresh) continue;
    const g = groups[groups.length - 1];
    if(g && cum[i] - cum[g[g.length - 1][0]] <= win) g.push([i, ang]); else groups.push([[i, ang]]);
  }
  const inner = groups.map(g => g.reduce((m, x) => x[1] > m[1] ? x : m)[0]);
  const cs = [0, ...inner, n - 1];
  /* fold an edge shorter than minEdge into its shorter neighbour; the two ends never go */
  let changed = true;
  while(changed && cs.length > 2){
    changed = false;
    for(let j = 0; j < cs.length - 1; j++){
      const len = cum[cs[j + 1]] - cum[cs[j]];
      if(len >= minEdge) continue;
      if(cs.length === 2) break;
      const prev = j > 0 ? cum[cs[j]] - cum[cs[j - 1]] : Infinity;
      const next = j + 2 < cs.length ? cum[cs[j + 2]] - cum[cs[j + 1]] : Infinity;
      if(j === 0) cs.splice(1, 1);
      else if(j + 1 === cs.length - 1) cs.splice(j, 1);
      else cs.splice(prev <= next ? j : j + 1, 1);
      changed = true; break;
    }
  }
  return cs;
}
