/* Geometry simplification with semantic preservation — spec: simplify.md.

   A factory DXF states a curve as a polyline, so four pieces of the 3380 pattern arrive
   as 810 vertices describing 22 real edges. Most of those vertices say nothing: they are
   samples of a curve, not decisions a pattern maker made. Dropping them makes every later
   operation cheaper — but dropping the wrong one silently moves a seam, and a notch that
   disappears is a piece that cannot be sewn.

   So the rule here is not "fewer points". It is **fewer points, none of them meaningful,
   and the line does not move by more than the stated tolerance** — measured afterwards,
   both ways, rather than trusted because the algorithm promises it.

   Nothing in this file mutates its input. Simplifying returns a new outline beside the
   original, which stays exactly as the DXF gave it (spec §1.5, Keep Original). */
import {EPS, point, line, curve, closestPoint, signedArea, isCCW} from "./model.js";
import {intersect} from "./intersect.js";

const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]);

/* Every closed ring in the 3380 factory file repeats its first vertex at the end, and
   the zero-length segment that creates makes a self-intersection test cry wolf and every
   count off by one. `curve()` in model.js normalises exactly this; anything working on
   raw coordinate arrays has to do it too, which is the trap this module fell into once.
   Copies, never mutates — Keep Original applies to the caller's array as well. */
function ringOf(pts, closed){
  const out = pts.map(p => p.slice());
  while(closed && out.length > 1 && dist(out[0], out[out.length-1]) <= EPS) out.pop();
  return out;
}

/* distance from p to the segment a→b — the one measurement everything here rests on */
function toSegment(p, a, b){
  const dx = b[0]-a[0], dy = b[1]-a[1], dd = dx*dx + dy*dy;
  const t = dd < EPS ? 0 : Math.max(0, Math.min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy)/dd));
  return Math.hypot(p[0]-(a[0]+dx*t), p[1]-(a[1]+dy*t));
}

/* ── 1 · Detect ─────────────────────────────────────────────────────────────
   Reports only. Looking at what is redundant before removing anything is how you
   notice that a "redundant" point was the notch. */
export function detect(raw, opts = {}){
  const closed = !!opts.closed, dmin = opts.dmin ?? 0.05, tol = opts.tol ?? 0.1;
  const pts = ringOf(raw, closed), n = pts.length;
  const duplicates = [], nearDuplicates = [], collinear = [];
  for(let i = 1; i < n; i++){
    const d = dist(pts[i-1], pts[i]);
    if(d <= EPS) duplicates.push(i);
    else if(d < dmin) nearDuplicates.push(i);
  }
  const lo = closed ? 0 : 1, hi = closed ? n : n-1;
  for(let i = lo; i < hi; i++){
    const a = pts[(i-1+n) % n], b = pts[i], c = pts[(i+1) % n];
    if(toSegment(b, a, c) < tol) collinear.push(i);
  }
  const closing = raw.length - n;                 // đỉnh lặp ở cuối, nếu có
  for(let k = 0; k < closing; k++) duplicates.push(raw.length - 1 - k);
  return {count: n, closed, duplicates, nearDuplicates, collinear,
          redundant: new Set([...duplicates, ...nearDuplicates, ...collinear]).size};
}

/* ── 2 · Simplify · Ramer–Douglas–Peucker ───────────────────────────────────
   Iterative rather than recursive: a factory ring can be thousands of points, and a
   blown stack is a silent failure mode in a browser. */
export function rdp(pts, tol){
  const n = pts.length;
  if(n <= 2) return pts.map(p => p.slice());
  const keep = new Array(n).fill(false);
  keep[0] = keep[n-1] = true;
  const stack = [[0, n-1]];
  while(stack.length){
    const [i, j] = stack.pop();
    let far = -1, fd = tol;
    for(let k = i+1; k < j; k++){
      const d = toSegment(pts[k], pts[i], pts[j]);
      if(d > fd){ fd = d; far = k; }
    }
    if(far < 0) continue;                    // every point in between is inside tolerance
    keep[far] = true;
    stack.push([i, far], [far, j]);
  }
  return pts.filter((_, i) => keep[i]).map(p => p.slice());
}

/* ── 3 · Preserve ──────────────────────────────────────────────────────────
   Corners are found the same way `edges/segment.js` finds them, over a window in
   MILLIMETRES, because DXF vertices are spaced very unevenly: a straight edge has two
   points, a curve has two hundred, and an angle measured over indices would call the
   dense stretch a corner. */
export function corners(pts, opts = {}){
  const win = opts.win ?? 7, thresh = opts.angle ?? 26;
  const closed = opts.closed !== false;
  const n = pts.length;
  if(n < 8) return pts.map((_, i) => i);
  /* An open line must NOT wrap: walking past the last vertex round to the first invents
     a sharp turn at each end, and a smooth arc comes back reported as two corners. Its
     ends are protected anyway — as endpoints, which is what they are. */
  const walk = (i, back) => {                // step `win` mm away along the outline
    let acc = 0, j = i;
    for(let g = 0; g < n; g++){
      if(!closed && ((back && j === 0) || (!back && j === n-1))) return pts[j];
      const k = back ? (j-1+n) % n : j;
      const d = dist(pts[k], pts[(k+1) % n]);
      if(d > 0 && acc + d >= win){
        const t = (win-acc)/d;
        const pa = back ? pts[(j-1+n) % n] : pts[j], pb = back ? pts[j] : pts[(j+1) % n];
        return back ? [pb[0]+(pa[0]-pb[0])*t, pb[1]+(pa[1]-pb[1])*t]
                    : [pa[0]+(pb[0]-pa[0])*t, pa[1]+(pb[1]-pa[1])*t];
      }
      acc += d; j = back ? (j-1+n) % n : (j+1) % n;
    }
    return pts[j];
  };
  const out = [];
  for(let i = closed ? 0 : 1; i < (closed ? n : n-1); i++){
    const a = walk(i, true), b = pts[i], c = walk(i, false);
    const v1 = [b[0]-a[0], b[1]-a[1]], v2 = [c[0]-b[0], c[1]-b[1]];
    const n1 = Math.hypot(...v1), n2 = Math.hypot(...v2);
    if(n1 < 1e-9 || n2 < 1e-9) continue;
    const cs = Math.max(-1, Math.min(1, (v1[0]*v2[0] + v1[1]*v2[1])/(n1*n2)));
    if(Math.acos(cs)*180/Math.PI > thresh) out.push(i);
  }
  return out;
}

/* Indices no simplification may drop: corners, the ends of an open line, and every
   vertex a caller names by COORDINATE — notches, seam junctions, grade points. By
   coordinate and not by index, because the caller reads those from the DXF, where
   nobody promises an index order. */
export function protectedIndices(pts, opts = {}){
  const closed = !!opts.closed, snap = opts.snap ?? 0.05;
  const keep = new Set(opts.corners !== false ? corners(pts, opts) : []);
  if(!closed){ keep.add(0); keep.add(pts.length-1); }
  for(const k of opts.keep || []){
    let best = -1, bd = snap;
    for(let i = 0; i < pts.length; i++){
      const d = dist(pts[i], k);
      if(d <= bd){ bd = d; best = i; }
    }
    if(best >= 0) keep.add(best);
  }
  return [...keep].sort((a, b) => a - b);
}

/* RDP runs BETWEEN protected points, never across one. That is what makes preservation
   a property of the construction instead of a promise checked afterwards — and it stops
   RDP from cutting the corner off a sharp turn, its classic topology failure. */
export function simplify(pts, opts = {}){
  const closed = !!opts.closed, tol = opts.tol ?? 0.1;
  const src = ringOf(pts, closed);
  if(src.length <= (closed ? 3 : 2)) return stats(src, src, closed, tol);

  const anchors = protectedIndices(src, {...opts, closed});
  if(anchors.length < (closed ? 2 : 2)) {
    const flat = closed ? rdpRing(src, tol) : rdp(src, tol);
    return stats(src, flat, closed, tol);
  }
  const out = [];
  for(let s = 0; s < anchors.length; s++){
    const i = anchors[s];
    const j = anchors[(s+1) % anchors.length];
    if(!closed && s === anchors.length-1) break;
    const run = [];
    for(let k = i; ; k = (k+1) % src.length){
      run.push(src[k]);
      if(k === j) break;
    }
    const thin = rdp(run, tol);
    out.push(...thin.slice(0, -1));                // the far anchor opens the next run
  }
  if(!closed) out.push(src[src.length-1]);
  return stats(src, out, closed, tol);
}

/* A ring has no ends for RDP to hold on to, so pin the two farthest-apart vertices
   first. Only used when a ring has no corners at all — a perfect circle, say. */
function rdpRing(pts, tol){
  let a = 0, b = 0, best = -1;
  for(let i = 1; i < pts.length; i++){
    const d = dist(pts[0], pts[i]);
    if(d > best){ best = d; b = i; }
  }
  const half1 = pts.slice(a, b+1), half2 = pts.slice(b).concat([pts[0]]);
  return rdp(half1, tol).slice(0, -1).concat(rdp(half2, tol).slice(0, -1));
}

function stats(before, after, closed, tol){
  return {pts: after, closed, tol,
          before: before.length, after: after.length,
          removed: before.length - after.length,
          ratio: before.length ? (before.length - after.length)/before.length : 0};
}

/* ── 4 · Validate ──────────────────────────────────────────────────────────
   Deviation BOTH ways. One way alone misses the case where the new line wanders off
   where the old one had no vertex to complain with. */
export function deviation(a, b){
  const one = (from, to) => {
    const ds = from.map(p => {
      let best = Infinity;
      for(let i = 1; i < to.length; i++) best = Math.min(best, toSegment(p, to[i-1], to[i]));
      return best;
    });
    return ds;
  };
  const ring = pts => pts.concat([pts[0]]);
  const ds = one(a, ring(b)).concat(one(b, ring(a)));
  const sorted = ds.slice().sort((x, y) => x - y);
  return {max: Math.max(...ds), median: sorted[Math.floor(sorted.length/2)] || 0, n: ds.length};
}

const perimeter = (pts, closed) => {
  const q = closed ? pts.concat([pts[0]]) : pts;
  let s = 0;
  for(let i = 1; i < q.length; i++) s += dist(q[i-1], q[i]);
  return s;
};

/* Self-intersection through the same intersect() the rest of the kernel uses, so a bug
   there shows up in one place rather than two. Neighbouring segments share an endpoint
   and are skipped. */
export function selfIntersects(raw, closed){
  const pts = ringOf(raw, closed);
  const n = pts.length, m = closed ? n : n-1;
  const seg = i => line(point(pts[i][0], pts[i][1]),
                        point(pts[(i+1) % n][0], pts[(i+1) % n][1]));
  for(let i = 0; i < m; i++){
    if(dist(pts[i], pts[(i+1) % n]) <= EPS) continue;          // đoạn dài 0: bỏ qua
    for(let j = i+2; j < m; j++){
      if(closed && i === 0 && j === m-1) continue;             // hai đoạn kề qua điểm đóng ring
      if(dist(pts[j], pts[(j+1) % n]) <= EPS) continue;
      if(intersect(seg(i), seg(j)).length) return true;
    }
  }
  return false;
}

export function validateSimplify(rawBefore, rawAfter, opts = {}){
  const closed = !!opts.closed, tol = opts.tol ?? 0.1;
  const before = ringOf(rawBefore, closed), after = ringOf(rawAfter, closed);
  const dev = deviation(before, after);
  const p0 = perimeter(before, closed), p1 = perimeter(after, closed);
  const a0 = signedArea(curve(before, closed)), a1 = signedArea(curve(after, closed));
  /* Only markers that WERE vertices of the outline can be kept in it. The 3380 pattern
     draws 10 of its 17 layer-2 points 7–25 mm off the cut line — those are annotation
     ticks, not vertices, and demanding them back would fail every real piece. */
  const snap = opts.snap ?? 0.05;
  const onOutline = (opts.keep || []).filter(k => before.some(p => dist(p, k) <= snap));
  const lost = onOutline.filter(k => !after.some(p => dist(p, k) <= snap));
  const out = {
    maxDeviation: dev.max, medianDeviation: dev.median,
    perimeter: {before: p0, after: p1, delta: p1-p0, pct: p0 ? (p1-p0)/p0*100 : 0},
    area: {before: Math.abs(a0), after: Math.abs(a1), delta: Math.abs(a1)-Math.abs(a0),
           pct: a0 ? (Math.abs(a1)-Math.abs(a0))/Math.abs(a0)*100 : 0},
    withinTolerance: dev.max <= tol + 1e-9,
    closedKept: true,
    orientationKept: !closed || isCCW(curve(before, true)) === isCCW(curve(after, true)),
    enoughPoints: after.length >= (closed ? 3 : 2),
    noSelfIntersection: !selfIntersects(after, closed),
    markers: {given: (opts.keep || []).length, onOutline: onOutline.length, lost: lost.length},
    markersKept: lost.length === 0,
    removed: before.length - after.length
  };
  out.ok = out.withinTolerance && out.orientationKept && out.enoughPoints &&
           out.noSelfIntersection && out.markersKept;
  return out;
}
