/* Plane geometry on [x, y] pairs and {x0,y0,x1,y1,w,h} boxes, in millimetres.
   Pure functions only — no DOM, no state — so every feature can test against them. */

export const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]);

export const plen = p => {
  let s = 0;
  for(let i = 0; i < p.length-1; i++) s += dist(p[i], p[i+1]);
  return s;
};

export function bboxOf(pts){
  if(!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for(const [x, y] of pts){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
  return {x0, y0, x1, y1, w:x1-x0, h:y1-y0};
}

/* union of boxes — the reference rectangle every align/distribute command reads */
export function unionBox(boxes){
  const bs = (boxes || []).filter(Boolean);
  if(!bs.length) return null;
  const x0 = Math.min(...bs.map(b => b.x0)), y0 = Math.min(...bs.map(b => b.y0));
  const x1 = Math.max(...bs.map(b => b.x1)), y1 = Math.max(...bs.map(b => b.y1));
  return {x0, y0, x1, y1, w:x1-x0, h:y1-y0};
}

export const cxOf = b => (b.x0+b.x1)/2;
export const cyOf = b => (b.y0+b.y1)/2;

export const boxesTouch = (a, b) =>
  !!a && !!b && a.x1 >= b.x0 && a.x0 <= b.x1 && a.y1 >= b.y0 && a.y0 <= b.y1;

/* ray casting; poly is an implicitly closed ring */
export function pointInPoly(poly, q){
  let ins = false;
  for(let i = 0, n = poly.length; i < n; i++){
    const [x1, y1] = poly[i], [x2, y2] = poly[(i+1)%n];
    if((y1 > q[1]) !== (y2 > q[1])){
      if(q[0] < x1 + (q[1]-y1)*(x2-x1)/(y2-y1)) ins = !ins;
    }
  }
  return ins;
}
