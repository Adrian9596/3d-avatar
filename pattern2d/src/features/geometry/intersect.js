/* Giao điểm giữa hai hình — nền của trim, extend và mọi quan hệ "cắt nhau tại".

   Trả về danh sách {x, y, ta, tb}: toạ độ, tham số trên hình a và trên hình b.
   Line·Line, Line·Arc, Arc·Arc giải thẳng bằng công thức; hễ có Curve thì băm
   curve thành đoạn rồi quy về các trường hợp trên — đúng tinh thần dữ liệu DXF
   của rập, vốn là polyline chứ không phải spline. */
import {EPS, line, point, closestPoint, containsAngle, sweep, curveSteps} from "./model.js";

const hit = (x, y, ta, tb) => ({x, y, ta, tb});
const inUnit = t => t >= -1e-9 && t <= 1 + 1e-9;

export function lineLine(l1, l2){
  const x1 = l1.a.x, y1 = l1.a.y, x2 = l1.b.x, y2 = l1.b.y;
  const x3 = l2.a.x, y3 = l2.a.y, x4 = l2.b.x, y4 = l2.b.y;
  const den = (x2-x1)*(y4-y3) - (y2-y1)*(x4-x3);
  if(Math.abs(den) < EPS) return [];                       // song song hoặc trùng
  const ta = ((x3-x1)*(y4-y3) - (y3-y1)*(x4-x3))/den;
  const tb = ((x3-x1)*(y2-y1) - (y3-y1)*(x2-x1))/den;
  if(!inUnit(ta) || !inUnit(tb)) return [];
  return [hit(x1 + (x2-x1)*ta, y1 + (y2-y1)*ta, ta, tb)];
}

export function lineArc(l, a){
  const dx = l.b.x-l.a.x, dy = l.b.y-l.a.y;
  const fx = l.a.x-a.c.x, fy = l.a.y-a.c.y;
  const A = dx*dx + dy*dy, B = 2*(fx*dx + fy*dy), C = fx*fx + fy*fy - a.r*a.r;
  const disc = B*B - 4*A*C;
  if(A < EPS || disc < 0) return [];
  const sq = Math.sqrt(disc), out = [];
  for(const t of [(-B-sq)/(2*A), (-B+sq)/(2*A)]){
    if(!inUnit(t)) continue;
    const x = l.a.x + dx*t, y = l.a.y + dy*t;
    const ang = Math.atan2(y-a.c.y, x-a.c.x);
    if(!containsAngle(a, ang)) continue;
    out.push(hit(x, y, t, paramOnArc(a, ang)));
  }
  return dedupe(out);
}

export function arcArc(a1, a2){
  const dx = a2.c.x-a1.c.x, dy = a2.c.y-a1.c.y, d = Math.hypot(dx, dy);
  if(d < EPS || d > a1.r + a2.r + EPS || d < Math.abs(a1.r - a2.r) - EPS) return [];
  const a = (a1.r*a1.r - a2.r*a2.r + d*d)/(2*d);
  const h2 = a1.r*a1.r - a*a;
  if(h2 < -EPS) return [];
  const h = Math.sqrt(Math.max(0, h2));
  const mx = a1.c.x + a*dx/d, my = a1.c.y + a*dy/d;
  const out = [];
  for(const s of [1, -1]){
    const x = mx + s*h*(-dy)/d, y = my + s*h*dx/d;
    const an1 = Math.atan2(y-a1.c.y, x-a1.c.x), an2 = Math.atan2(y-a2.c.y, x-a2.c.x);
    if(containsAngle(a1, an1) && containsAngle(a2, an2))
      out.push(hit(x, y, paramOnArc(a1, an1), paramOnArc(a2, an2)));
    if(h < EPS) break;                                     // tiếp xúc: một điểm
  }
  return dedupe(out);
}

function paramOnArc(a, ang){
  const tw = 2*Math.PI, d = sweep(a);
  let rel = ((ang - a.a0) % tw + tw) % tw;
  if(!a.ccw) rel = rel === 0 ? 0 : tw - rel;
  return Math.abs(d) < EPS ? 0 : Math.min(1, Math.max(0, rel/Math.abs(d)));
}

/* curve → các đoạn thẳng kèm khoảng tham số của chúng trên curve */
function segments(c){
  const {pts, cum, total} = curveSteps(c);
  const out = [];
  for(let i = 1; i < pts.length; i++)
    out.push({seg: line(point(pts[i-1][0], pts[i-1][1]), point(pts[i][0], pts[i][1])),
              t0: total < EPS ? 0 : cum[i-1]/total, t1: total < EPS ? 0 : cum[i]/total});
  return out;
}

function dedupe(list){
  const out = [];
  for(const h of list)
    if(!out.some(o => Math.hypot(o.x-h.x, o.y-h.y) < 1e-7)) out.push(h);
  return out;
}

/* Giao của hai hình bất kỳ. Point không cắt gì — nó chỉ nằm trên hoặc không. */
export function intersect(a, b){
  if(!a || !b || a.kind === "point" || b.kind === "point") return [];
  const swap = list => list.map(h => hit(h.x, h.y, h.tb, h.ta));

  if(a.kind === "curve"){
    const out = [];
    for(const {seg, t0, t1} of segments(a))
      for(const h of intersect(seg, b))
        out.push(hit(h.x, h.y, t0 + (t1-t0)*h.ta, h.tb));
    return dedupe(out).sort((p, q) => p.ta - q.ta);
  }
  if(b.kind === "curve") return swap(intersect(b, a)).sort((p, q) => p.ta - q.ta);

  const key = a.kind + "/" + b.kind;
  const out = key === "line/line" ? lineLine(a, b)
            : key === "line/arc"  ? lineArc(a, b)
            : key === "arc/line"  ? swap(lineArc(b, a))
            :                       arcArc(a, b);
  return out.sort((p, q) => p.ta - q.ta);
}

/* điểm p có nằm trên hình không (trong dung sai) */
export const onShape = (s, p, tol = 1e-6) => closestPoint(s, p).dist <= tol;
