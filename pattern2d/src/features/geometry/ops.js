/* Lớp 3a — các phép biến đổi hình học: move · scale · rotate · offset · trim ·
   extend · measure. Tất cả thuần tuý: nhận hình, trả hình mới.

   Solver ở solver.js gọi những hàm này; UI cũng gọi chính chúng, nên cái gì đúng
   trong test thì đúng trên canvas. */
import {EPS, point, line, arc, curve, length, pointAt, tangentAt, normalAt, closestPoint,
        trimBetween, bbox, transform, translation, scaling, rotation, sweep, angleAt,
        curveSteps, sample, isCCW} from "./model.js";
import {intersect} from "./intersect.js";

export const move = (s, dx, dy) => transform(s, translation(dx, dy));
export const scale = (s, k, origin = point(0, 0)) => transform(s, scaling(k, origin.x, origin.y));
export const rotate = (s, ang, origin = point(0, 0)) => transform(s, rotation(ang, origin.x, origin.y));

/* Offset dương = về phía pháp tuyến trái (bên trái chiều đi của hình).
   Đây là phép của rập: đường may là đường cắt lùi vào 6 mm. */
export function offset(s, d, opts = {}){
  /* side: "left" (mặc định, theo pháp tuyến trái) · "in"/"out" cho hình kín, tự lật
     dấu theo chiều quay của ring — dữ liệu thật vẽ cả hai chiều, đừng đoán */
  const side = opts.side || "left";
  if(side !== "left"){
    const ccw = s.kind === "curve" && s.closed ? isCCW(s) : (s.kind === "arc" ? s.ccw : true);
    const inward = side === "in";
    d = Math.abs(d) * ((ccw === inward) ? 1 : -1);
  }
  if(Math.abs(d) < EPS) return s;
  switch(s.kind){
    case "point": return s;
    case "line": {
      const n = normalAt(s, 0);
      return line(point(s.a.x + n.x*d, s.a.y + n.y*d), point(s.b.x + n.x*d, s.b.y + n.y*d));
    }
    case "arc": {
      /* pháp tuyến trái của cung ngược chiều KĐH chỉ vào tâm, nên bán kính co lại */
      const r = s.ccw ? s.r - d : s.r + d;
      return r <= EPS ? null : arc(s.c, r, s.a0, s.a1, s.ccw);
    }
    case "curve": {
      const {pts} = curveSteps(s);
      const n = s.closed ? pts.length - 1 : pts.length;
      const out = [];
      for(let i = 0; i < n; i++){
        const prev = i > 0 ? [pts[i-1], pts[i]] : (s.closed ? [pts[n-1], pts[0]] : null);
        const next = i < n-1 ? [pts[i], pts[i+1]] : (s.closed ? [pts[n-1], pts[0]] : null);
        const nrm = seg => { const dx = seg[1][0]-seg[0][0], dy = seg[1][1]-seg[0][1];
                             const L = Math.hypot(dx, dy) || 1; return [-dy/L, dx/L]; };
        const a = prev ? nrm(prev) : null, b = next ? nrm(next) : null;
        let nx, ny, k = 1;
        if(a && b){
          nx = a[0] + b[0]; ny = a[1] + b[1];
          const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
          k = Math.min(4, 1/Math.max(0.25, nx*a[0] + ny*a[1]));      /* miter, chặn nhọn quá */
        } else { const m = a || b; nx = m[0]; ny = m[1]; }
        out.push([pts[i][0] + nx*d*k, pts[i][1] + ny*d*k]);
      }
      return curve(prune(out, s, d, {min: s.closed ? 3 : 2}), s.closed);
    }
  }
}

/* Offset một đường lõm thì các đoạn chồm qua nhau, sinh ra vòng thừa thò vào vùng
   lẽ ra đã bị cắt. Dấu hiệu nhận ra rất gọn: **điểm offset hợp lệ phải cách đường
   gốc đúng |d|** — điểm nào gần hơn là nằm trong vòng thừa, bỏ đi.
   Trên rập 后比 của nhà máy, không dọn thì chu vi đường may dư 41 mm. */
export function prune(pts, source, d, opts = {}){
  /* min: số đỉnh tối thiểu còn lại thì mới dám dọn — ring cần 3, đường hở cần 2 */
  const tol = opts.tol ?? 0.02, min = opts.min ?? 3;
  const want = Math.abs(d) - tol;
  const valid = pts.map(p => closestPoint(source, point(p[0], p[1])).dist >= want);
  if(valid.every(Boolean)) return pts;
  if(!valid.some(Boolean)) return pts;

  /* xoay mảng để bắt đầu từ một đỉnh hợp lệ — ring không có "đầu" nên xoay là vô hại */
  const k = valid.indexOf(true);
  const P = pts.slice(k).concat(pts.slice(0, k));
  const V = valid.slice(k).concat(valid.slice(0, k));

  const out = [];
  for(let i = 0; i < P.length; i++){
    if(V[i]){ out.push(P[i]); continue; }
    let j = i;
    while(j < P.length && !V[j]) j++;               // khúc hỏng là [i, j-1]
    /* Hai cánh kẹp khúc hỏng gặp nhau ở đâu thì đó mới là đỉnh thật của góc lõm.
       Bỏ khúc mà không khâu lại thì góc bị cắt bằng dây cung và chu vi hụt —
       trên rập 后比 hụt 11.7 mm so với đường may nhà máy. */
    const X = meetOfLines(P[i-1], P[i], P[j-1], P[j % P.length]);
    if(X && closestPoint(source, point(X[0], X[1])).dist >= want) out.push(X);
    i = j - 1;
  }
  return out.length >= min ? out : pts;
}

/* giao của hai ĐƯỜNG THẲNG (không kẹp trong đoạn) — dùng để khâu góc */
function meetOfLines(a1, a2, b1, b2){
  if(!a1 || !a2 || !b1 || !b2) return null;
  const x1 = a1[0], y1 = a1[1], x2 = a2[0], y2 = a2[1];
  const x3 = b1[0], y3 = b1[1], x4 = b2[0], y4 = b2[1];
  const den = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4);
  if(Math.abs(den) < 1e-12) return null;
  const a = x1*y2 - y1*x2, b = x3*y4 - y3*x4;
  return [(a*(x3-x4) - (x1-x2)*b)/den, (a*(y3-y4) - (y1-y2)*b)/den];
}

/* ── trim ── cắt bỏ đúng khúc chứa điểm bấm, giữa hai giao điểm gần nhất ──
   Trả {kept: [...], removed}. Không có giao điểm nào thì không cắt gì cả. */
export function trim(s, cutters, at){
  const ts = cutParams(s, cutters);
  if(!ts.length) return {kept: [s], removed: null};
  const marks = [0, ...ts, 1];
  const tAt = closestPoint(s, at).t;
  let i = 0;
  while(i < marks.length - 2 && marks[i+1] < tAt) i++;
  const [t0, t1] = [marks[i], marks[i+1]];
  const kept = [];
  if(t0 > EPS) kept.push(trimBetween(s, 0, t0));
  if(t1 < 1 - EPS) kept.push(trimBetween(s, t1, 1));
  return {kept, removed: trimBetween(s, t0, t1)};
}

/* ── extend ── kéo dài một đầu tới giao điểm gần nhất với vật chặn ──────── */
export function extend(s, cutters, end = "end"){
  if(s.kind === "point") return s;
  const far = reach(s, cutters);
  const t = end === "start" ? 0 : 1;
  const base = pointAt(s, t);
  const dir = tangentAt(s, t);
  const sign = end === "start" ? -1 : 1;

  if(s.kind === "arc"){
    const probe = arc(s.c, s.r, end === "start" ? s.a0 : s.a1,
                      (end === "start" ? s.a0 : s.a1) + (end === "start" ? -1 : 1)*(s.ccw ? 1 : -1)*2*Math.PI*0.999,
                      end === "start" ? !s.ccw : s.ccw);
    const hits = cutters.flatMap(c => intersect(probe, c)).sort((a, b) => a.ta - b.ta);
    if(!hits.length) return s;
    const ang = Math.atan2(hits[0].y - s.c.y, hits[0].x - s.c.x);
    return end === "start" ? arc(s.c, s.r, ang, s.a1, s.ccw) : arc(s.c, s.r, s.a0, ang, s.ccw);
  }

  const probe = line(base, point(base.x + sign*dir.x*far, base.y + sign*dir.y*far));
  const hits = cutters.flatMap(c => intersect(probe, c))
                      .filter(h => Math.hypot(h.x-base.x, h.y-base.y) > 1e-7)
                      .sort((a, b) => a.ta - b.ta);
  if(!hits.length) return s;
  const q = point(hits[0].x, hits[0].y);
  if(s.kind === "line") return end === "start" ? line(q, s.b) : line(s.a, q);
  const pts = s.pts.slice();
  if(end === "start") pts.unshift([q.x, q.y]); else pts.push([q.x, q.y]);
  return curve(pts, s.closed);
}

/* Edit D15–D18: move one endpoint to the nearest intersection, choosing trim or
   extend by the distance changed ALONG the source. The other endpoint is fixed.
   Spline intersections use a 0.001 mm chord oracle; the kept spline stays exact. */
export function trimExtend(s, targets, end = "end"){
  const refuse = message => ({ok: false, message});
  if(!s || !["line", "curve", "arc", "spline"].includes(s.kind)) return refuse("chọn một đường hở");
  const a = pointAt(s, 0), b = pointAt(s, 1), L = length(s);
  if(s.closed || Math.hypot(a.x - b.x, a.y - b.y) <= 1e-9)
    return refuse("đường kín hoặc dài 0 — không có đầu để sửa");
  const E = end === "start" ? a : b;
  if(targets.some(t => closestPoint(t, E).dist <= 0.01))
    return refuse("đầu này đã nằm trên đường đích — không cần sửa");
  const crossingShape = q => q.kind === "spline" ? curve(sample(q, 0.001), false) : q;
  const cutters = targets.map(crossingShape), source = crossingShape(s), candidates = [];
  for(const h of cutters.flatMap(c => intersect(source, c))){
    const t = s.kind === "spline" ? closestPoint(s, point(h.x, h.y)).t : h.ta;
    if(t <= 0 || t >= 1) continue;
    const shape = end === "start" ? trimBetween(s, t, 1) : trimBetween(s, 0, t);
    const kept = length(shape), change = L - kept;
    if(kept > 1e-9 && change > 1e-9) candidates.push({shape, action: "trim", change});
  }
  if(s.kind !== "spline"){
    const shape = extend(s, cutters, end), change = length(shape) - L;
    if(change > 1e-9) candidates.push({shape, action: "extend", change});
  }
  candidates.sort((x, y) => Math.abs(x.change - y.change) <= 1e-9
    ? (x.action === "trim" ? -1 : 1) : x.change - y.change);
  if(!candidates.length) return refuse(s.kind === "spline"
    ? "không có giao điểm để cắt; spline chưa kéo dài được"
    : "không có giao điểm hợp lệ theo đầu đã chọn — chọn đường đích khác");
  return {ok: true, ...candidates[0]};
}

/* ── measure ── khoảng cách giữa hai hình bất kỳ, kèm hai đầu đoạn đo ───── */
export function measure(a, b){
  if(a.kind === "point" && b.kind === "point")
    return {distance: Math.hypot(a.x-b.x, a.y-b.y), from: a, to: b};
  if(a.kind === "point"){ const r = closestPoint(b, a); return {distance: r.dist, from: a, to: r.point}; }
  if(b.kind === "point"){ const r = closestPoint(a, b); return {distance: r.dist, from: r.point, to: b}; }
  if(intersect(a, b).length){
    const h = intersect(a, b)[0];
    return {distance: 0, from: point(h.x, h.y), to: point(h.x, h.y)};
  }
  let best = {distance: Infinity};
  for(const s of [a, b]){
    const other = s === a ? b : a;
    for(const [x, y] of sample(s, 0.5)){
      const r = closestPoint(other, point(x, y));
      if(r.dist < best.distance)
        best = {distance: r.dist, from: s === a ? point(x, y) : r.point, to: s === a ? r.point : point(x, y)};
    }
  }
  return best;
}

/* góc giữa hai đường, tính ở đầu mỗi đường, trả radian trong [0, π/2] */
export function angleBetween(s1, s2){
  const d1 = tangentAt(s1, 0.5), d2 = tangentAt(s2, 0.5);
  const cos = Math.abs(d1.x*d2.x + d1.y*d2.y);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

function cutParams(s, cutters){
  const ts = [];
  for(const c of cutters)
    for(const h of intersect(s, c))
      if(h.ta > 1e-7 && h.ta < 1 - 1e-7) ts.push(h.ta);
  return [...new Set(ts.map(t => +t.toFixed(9)))].sort((a, b) => a - b);
}

/* đủ dài để chạm mọi vật chặn, không hơn: dùng cho tia thăm dò của extend */
function reach(s, cutters){
  const boxes = [bbox(s), ...cutters.map(bbox)];
  const x0 = Math.min(...boxes.map(b => b.x0)), y0 = Math.min(...boxes.map(b => b.y0));
  const x1 = Math.max(...boxes.map(b => b.x1)), y1 = Math.max(...boxes.map(b => b.y1));
  return Math.hypot(x1-x0, y1-y0)*2 + 1;
}
