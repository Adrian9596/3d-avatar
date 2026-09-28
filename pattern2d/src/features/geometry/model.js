/* Lớp 1 — Geometry Model.

   Bốn kiểu hình: Point · Line · Arc · Curve (polyline). Toạ độ là **milimét**, trục y
   hướng lên như rập (chỉ lúc vẽ SVG mới lật). Góc tính bằng radian.

   Mọi hình là object thuần, bất biến: phép biến đổi trả về hình mới chứ không sửa tại
   chỗ. Nhờ vậy solver so sánh được cũ/mới, và undo chỉ là giữ lại tham chiếu cũ.

   Tham số t của mọi hình chạy 0..1 **theo chiều dài cung** — nên `pointAt(s, 1/3)` là
   đúng một phần ba chiều dài, thứ rập cần khi đặt notch, chứ không phải một phần ba
   theo chỉ số điểm. */
import {spline, splineLength, splinePointAt, splineTangentAt, splineClosest, splineTrim, splineReverse,
        splineTransform, splineSample, splineBBox} from "./spline.js";

export const EPS = 1e-9;

export const point = (x, y) => ({kind: "point", x, y});
export const line = (a, b) => ({kind: "line", a, b});
/* cung tròn: tâm c, bán kính r, từ góc a0 quét tới a1; ccw = ngược chiều kim đồng hồ.
   A negative radius would give a negative length and NaN would give none at all — both
   are refused here rather than measured later (measure_engine.md A7). */
export function arc(c, r, a0, a1, ccw = true){
  if(!c || !finite(c.x) || !finite(c.y) || !finite(r) || r < 0 || !finite(a0) || !finite(a1))
    throw new Error(`cung không hợp lệ: tâm (${c && c.x}, ${c && c.y}), r = ${r}, góc ${a0} → ${a1}`);
  return {kind: "arc", c, r, a0, a1, ccw};
}
/* Curve chuẩn hoá ngay lúc dựng: bỏ đỉnh trùng liền nhau, và với ring kín thì bỏ
   luôn đỉnh cuối nếu nó lặp lại đỉnh đầu — rập 后比 của nhà máy 3380 vẽ như vậy.
   Bất biến "không có đoạn dài 0" là thứ mọi phép phía sau dựa vào: pháp tuyến của
   một đoạn dài 0 là vô nghĩa, và nó làm offset lệch ở đúng chỗ đó. */
export function curve(pts, closed = false){
  const out = [];
  for(const p of pts){
    /* a NaN vertex fails every distance test below, so the dedupe would silently DROP it and
       the polyline would come out shorter — refuse it instead (measure_engine.md A7) */
    if(!p || !finite(p[0]) || !finite(p[1])) throw new Error(`polyline không hợp lệ: đỉnh (${p && p[0]}, ${p && p[1]})`);
    const q = [p[0], p[1]];
    const last = out[out.length-1];
    if(!last || Math.hypot(q[0]-last[0], q[1]-last[1]) > EPS) out.push(q);
  }
  while(closed && out.length > 1 &&
        Math.hypot(out[0][0]-out[out.length-1][0], out[0][1]-out[out.length-1][1]) <= EPS) out.pop();
  return {kind: "curve", pts: out, closed};
}

export const isShape = s => !!s && ["point", "line", "arc", "curve", "spline"].includes(s.kind);
const P = (x, y) => ({kind: "point", x, y});
function finite(v){ return typeof v === "number" && Number.isFinite(v); }

/* The gate every measurement goes through: a point must be two finite numbers in mm. */
export function checkPoint(q, what = "điểm"){
  if(!q || !finite(q.x) || !finite(q.y))
    throw new Error(`${what} không hợp lệ: cần {x, y} là số hữu hạn (mm), nhận ${q === null || q === undefined ? String(q)
      : Array.isArray(q) ? "mảng [" + q + "]" : "{x: " + q.x + ", y: " + q.y + "}"}`);
  return q;
}
/* Same gate for a whole shape. Constructors already refuse what they can (arc, curve,
   spline); line and point are plain literals, so they are checked where they enter. */
export function checkShape(s){
  if(!isShape(s)) throw new Error(`hình không hợp lệ: ${s && s.kind}`);
  if(s.kind === "point") checkPoint(s, "hình không hợp lệ: điểm");
  if(s.kind === "line"){ checkPoint(s.a, "hình không hợp lệ: đầu line"); checkPoint(s.b, "hình không hợp lệ: đầu line"); }
  if(s.kind === "arc") arc(s.c, s.r, s.a0, s.a1, s.ccw);
  if(s.kind === "curve") curve(s.pts, s.closed);
  return s;
}
const dist2 = (ax, ay, bx, by) => Math.hypot(ax-bx, ay-by);

/* ── cung: chuẩn hoá góc quét ───────────────────────────────────────────── */
/* The same angle twice is a point, not a circle — ezdxf reads a DXF ARC that way, and it
   is what makes trimBetween(arc, t, t) zero long like a line or a curve. A full circle is
   spelled with two angles 2π apart. */
export function sweep(a){
  let d = a.a1 - a.a0;
  if(d === 0) return 0;
  const tw = 2*Math.PI;
  if(a.ccw){ d %= tw; if(d <= 0) d += tw; }
  else     { d %= tw; if(d >= 0) d -= tw; }
  return d;
}
export const angleAt = (a, t) => a.a0 + sweep(a)*t;
/* góc ang có nằm trong cung không (dùng khi lọc giao điểm) */
export function containsAngle(a, ang){
  const d = sweep(a), tw = 2*Math.PI;
  let rel = ((ang - a.a0) % tw + tw) % tw;
  if(!a.ccw) rel = rel === 0 ? 0 : tw - rel;
  return rel <= Math.abs(d) + 1e-9;
}

/* ── curve: mốc chiều dài dồn, nền của mọi phép theo t ──────────────────── */
export function curveSteps(c){
  const pts = c.closed ? c.pts.concat([c.pts[0]]) : c.pts;
  const cum = [0];
  for(let i = 1; i < pts.length; i++) cum.push(cum[i-1] + dist2(pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1]));
  return {pts, cum, total: cum[cum.length-1]};
}

export function length(s){
  switch(s.kind){
    case "point": return 0;
    case "line":  return dist2(s.a.x, s.a.y, s.b.x, s.b.y);
    case "arc":   return Math.abs(sweep(s))*s.r;
    case "curve": return curveSteps(s).total;
    case "spline": return splineLength(s);
  }
}

export function pointAt(s, t){
  t = Math.max(0, Math.min(1, t));
  switch(s.kind){
    case "point": return P(s.x, s.y);
    case "line":  return P(s.a.x + (s.b.x-s.a.x)*t, s.a.y + (s.b.y-s.a.y)*t);
    case "arc":   { const ang = angleAt(s, t); return P(s.c.x + s.r*Math.cos(ang), s.c.y + s.r*Math.sin(ang)); }
    case "curve": {
      const {pts, cum, total} = curveSteps(s);
      if(total < EPS) return P(pts[0][0], pts[0][1]);
      const want = t*total;
      let i = 1;
      while(i < cum.length-1 && cum[i] < want) i++;
      const seg = cum[i]-cum[i-1] || 1, u = (want-cum[i-1])/seg;
      return P(pts[i-1][0] + (pts[i][0]-pts[i-1][0])*u, pts[i-1][1] + (pts[i][1]-pts[i-1][1])*u);
    }
    case "spline": { const q = splinePointAt(s, t); return P(q[0], q[1]); }
  }
}

/* vector đơn vị theo chiều đi của hình tại t */
export function tangentAt(s, t){
  switch(s.kind){
    case "point": return P(0, 0);
    case "line":  { const dx = s.b.x-s.a.x, dy = s.b.y-s.a.y, n = Math.hypot(dx,dy) || 1; return P(dx/n, dy/n); }
    case "arc":   { const ang = angleAt(s, t), k = sweep(s) >= 0 ? 1 : -1; return P(-k*Math.sin(ang), k*Math.cos(ang)); }
    case "curve": {
      const {pts, cum, total} = curveSteps(s);
      const want = Math.max(0, Math.min(1, t))*total;
      let i = 1;
      while(i < cum.length-1 && cum[i] < want) i++;
      const dx = pts[i][0]-pts[i-1][0], dy = pts[i][1]-pts[i-1][1], n = Math.hypot(dx,dy) || 1;
      return P(dx/n, dy/n);
    }
    case "spline": { const d = splineTangentAt(s, t); return P(d[0], d[1]); }
  }
}
/* pháp tuyến trái — hướng offset dương (mép may nằm bên trong đường cắt kín ngược chiều KĐH) */
export function normalAt(s, t){ const d = tangentAt(s, t); return P(-d.y, d.x); }

/* Diện tích có dấu của một ring kín: dương = ngược chiều kim đồng hồ.
   Rập nhà máy 3380 vẽ theo chiều kim đồng hồ, rập của project theo chiều ngược —
   nên "lùi vào trong" phải hỏi chiều quay chứ không được đoán. */
export function signedArea(c){
  const pts = c.kind === "curve" ? c.pts : [];
  let a = 0;
  for(let i = 0; i < pts.length; i++){
    const [x1, y1] = pts[i], [x2, y2] = pts[(i+1) % pts.length];
    a += x1*y2 - x2*y1;
  }
  return a/2;
}
export const isCCW = c => signedArea(c) > 0;

export function bbox(s){
  if(s.kind === "spline") return splineBBox(s);
  const pts = s.kind === "point" ? [[s.x, s.y]]
            : s.kind === "line"  ? [[s.a.x, s.a.y], [s.b.x, s.b.y]]
            : s.kind === "curve" ? s.pts
            : sampleArcExtremes(s);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for(const [x, y] of pts){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
  return {x0, y0, x1, y1, w: x1-x0, h: y1-y0};
}
/* A box that surely holds the shape, cheap: a spline by its control polygon — a B-spline, rational with positive weights
   too, lies inside the convex hull of its control points — every other kind by its exact box. Kept per shape object
   (shapes are never changed in place: a move makes new ones), so asking again costs nothing. What snap, Along and the
   notch pick ask first: a click near one spline of 10 000 measures only the few whose box comes near it */
const loose = new WeakMap();
export function looseBox(s){
  let b = loose.get(s);
  if(b) return b;
  if(s.kind === "spline"){
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for(const [x, y] of s.ctrl){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
    b = {x0, y0, x1, y1, w: x1-x0, h: y1-y0};
  } else b = bbox(s);
  loose.set(s, b);
  return b;
}
/* how far q = [x, y] is from a box at least — 0 inside it */
export const boxGap = (b, q) => Math.hypot(Math.max(b.x0 - q[0], 0, q[0] - b.x1), Math.max(b.y0 - q[1], 0, q[1] - b.y1));
/* hộp bao cung phải tính cả 4 điểm cực nếu cung quét qua chúng */
function sampleArcExtremes(a){
  const out = [[a.c.x + a.r*Math.cos(a.a0), a.c.y + a.r*Math.sin(a.a0)],
               [a.c.x + a.r*Math.cos(a.a1), a.c.y + a.r*Math.sin(a.a1)]];
  for(let k = 0; k < 4; k++){
    const ang = k*Math.PI/2;
    if(containsAngle(a, ang)) out.push([a.c.x + a.r*Math.cos(ang), a.c.y + a.r*Math.sin(ang)]);
  }
  return out;
}

/* điểm trên hình gần p nhất — nền của measure, trim và bắt điểm */
export function closestPoint(s, p){
  switch(s.kind){
    case "point": return {t: 0, point: P(s.x, s.y), dist: dist2(s.x, s.y, p.x, p.y)};
    case "line": {
      const dx = s.b.x-s.a.x, dy = s.b.y-s.a.y, dd = dx*dx + dy*dy;
      let t = dd < EPS ? 0 : ((p.x-s.a.x)*dx + (p.y-s.a.y)*dy)/dd;
      t = Math.max(0, Math.min(1, t));
      const q = pointAt(s, t);
      return {t, point: q, dist: dist2(q.x, q.y, p.x, p.y)};
    }
    case "arc": {
      const ang = Math.atan2(p.y-s.c.y, p.x-s.c.x);
      if(containsAngle(s, ang)){
        const q = P(s.c.x + s.r*Math.cos(ang), s.c.y + s.r*Math.sin(ang));
        const d = sweep(s), tw = 2*Math.PI;
        let rel = ((ang - s.a0) % tw + tw) % tw;
        if(!s.ccw) rel = rel === 0 ? 0 : tw - rel;
        return {t: Math.abs(d) < EPS ? 0 : rel/Math.abs(d), point: q, dist: dist2(q.x, q.y, p.x, p.y)};
      }
      const ends = [{t: 0, point: pointAt(s, 0)}, {t: 1, point: pointAt(s, 1)}]
        .map(e => ({...e, dist: dist2(e.point.x, e.point.y, p.x, p.y)}));
      return ends[0].dist <= ends[1].dist ? ends[0] : ends[1];
    }
    case "curve": {
      const {pts, cum, total} = curveSteps(s);
      let best = null;
      for(let i = 1; i < pts.length; i++){
        const seg = line(P(pts[i-1][0], pts[i-1][1]), P(pts[i][0], pts[i][1]));
        const r = closestPoint(seg, p);
        const at = total < EPS ? 0 : (cum[i-1] + r.t*(cum[i]-cum[i-1]))/total;
        if(!best || r.dist < best.dist) best = {t: at, point: r.point, dist: r.dist};
      }
      return best || {t: 0, point: P(s.pts[0][0], s.pts[0][1]), dist: Infinity};
    }
    case "spline": { const r = splineClosest(s, [p.x, p.y]); return {t: r.t, point: P(r.point[0], r.point[1]), dist: r.dist}; }
  }
}

/* cắt hình tại t → hai mảnh (point không cắt được) */
export function split(s, t){
  if(s.kind === "point" || t <= EPS || t >= 1-EPS) return [s];
  if(s.kind === "line") return [line(s.a, pointAt(s, t)), line(pointAt(s, t), s.b)];
  if(s.kind === "arc"){
    const mid = angleAt(s, t);
    return [arc(s.c, s.r, s.a0, mid, s.ccw), arc(s.c, s.r, mid, s.a1, s.ccw)];
  }
  return [trimBetween(s, 0, t), trimBetween(s, t, 1)];
}

/* giữ lại đoạn giữa hai tham số — phép cắt nền của trim */
export function trimBetween(s, t0, t1){
  if(t1 < t0) [t0, t1] = [t1, t0];
  t0 = Math.max(0, t0); t1 = Math.min(1, t1);
  switch(s.kind){
    case "point": return s;
    case "line":  return line(pointAt(s, t0), pointAt(s, t1));
    case "arc":   return arc(s.c, s.r, angleAt(s, t0), angleAt(s, t1), s.ccw);
    case "spline": return splineTrim(s, t0, t1);
    case "curve": {
      const {pts, cum, total} = curveSteps(s);
      const a = pointAt(s, t0), b = pointAt(s, t1);
      const out = [[a.x, a.y]];
      for(let i = 1; i < pts.length - 1; i++){
        const u = total < EPS ? 0 : cum[i]/total;
        if(u > t0 + EPS && u < t1 - EPS) out.push(pts[i]);
      }
      out.push([b.x, b.y]);
      return curve(out, false);
    }
  }
}

export const reverse = s =>
  s.kind === "line"   ? line(s.b, s.a)
: s.kind === "arc"    ? arc(s.c, s.r, s.a1, s.a0, !s.ccw)
: s.kind === "curve"  ? curve(s.pts.slice().reverse(), s.closed)
: s.kind === "spline" ? splineReverse(s)
: s;

/* ma trận affine {a,b,c,d,e,f}: x' = a·x + c·y + e, y' = b·x + d·y + f */
export const matrix = (a, b, c, d, e, f) => ({a, b, c, d, e, f});
export const translation = (dx, dy) => matrix(1, 0, 0, 1, dx, dy);
export const scaling = (k, ox = 0, oy = 0) => matrix(k, 0, 0, k, ox*(1-k), oy*(1-k));
export function rotation(ang, ox = 0, oy = 0){
  const c = Math.cos(ang), s = Math.sin(ang);
  return matrix(c, s, -s, c, ox - ox*c + oy*s, oy - ox*s - oy*c);
}
export const applyM = (m, x, y) => P(m.a*x + m.c*y + m.e, m.b*x + m.d*y + m.f);

export function transform(s, m){
  const scale = Math.sqrt(Math.abs(m.a*m.d - m.b*m.c)) || 1;
  switch(s.kind){
    case "point": return applyM(m, s.x, s.y);
    case "line":  return line(applyM(m, s.a.x, s.a.y), applyM(m, s.b.x, s.b.y));
    case "arc": {
      /* Only a similarity (move · turn · mirror · uniform scale) keeps an arc an arc; a skew
         makes it an ellipse, which this kernel has no kind for — refuse, do not bend it.
         The sweep is carried over rather than re-read from the end point: two ends that
         coincide (a full circle) would otherwise collapse the arc to nothing. */
      const sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d);
      if(Math.abs(sx - sy) > 1e-9*Math.max(1, sx) || Math.abs(m.a*m.c + m.b*m.d) > 1e-9*Math.max(1, sx*sy))
        throw new Error("cung không biến đổi lệch trục được (thành ellipse)");
      const c = applyM(m, s.c.x, s.c.y);
      const p0 = applyM(m, s.c.x + s.r*Math.cos(s.a0), s.c.y + s.r*Math.sin(s.a0));
      const flip = (m.a*m.d - m.b*m.c) < 0, sw = sweep(s);
      const a0 = Math.atan2(p0.y-c.y, p0.x-c.x);
      return arc(c, s.r*scale, a0, a0 + (flip ? -sw : sw), flip ? !s.ccw : s.ccw);
    }
    case "curve": return curve(s.pts.map(([x, y]) => { const q = applyM(m, x, y); return [q.x, q.y]; }), s.closed);
    case "spline": return splineTransform(s, m);
  }
}

/* điểm để vẽ: line/curve giữ nguyên đỉnh, arc chia nhỏ theo sai số cung */
export function sample(s, tolerance = 0.2){
  switch(s.kind){
    case "point": return [[s.x, s.y]];
    case "line":  return [[s.a.x, s.a.y], [s.b.x, s.b.y]];
    case "curve": return s.closed ? s.pts.concat([s.pts[0]]) : s.pts.slice();
    case "spline": return splineSample(s, tolerance);
    case "arc": {
      const step = 2*Math.acos(Math.max(-1, Math.min(1, 1 - tolerance/Math.max(s.r, tolerance))));
      const n = Math.max(2, Math.ceil(Math.abs(sweep(s))/Math.max(step, 1e-3)));
      const out = [];
      for(let i = 0; i <= n; i++){ const q = pointAt(s, i/n); out.push([q.x, q.y]); }
      return out;
    }
  }
}
