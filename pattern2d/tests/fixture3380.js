/* Rập factory 3380 dưới dạng dữ liệu test.

   Toạ độ đóng băng trong tests/fixtures/3380.json, sinh bởi scripts/make_fixture.py
   bằng một parser riêng — nên fixture không phụ thuộc thứ mà nó dùng để kiểm, và
   test chạy được trên máy không có thư mục `../DXF Pattern/`. */
import {readFileSync} from "node:fs";
import {dataPath, hasData, missing, NeedsData} from "./data.js";

/* factory data: not in the public repo — read from PATTERN2D_DATA (tests/data.js). Without it the
   exports below are stand-ins that throw NeedsData when a test touches them; the referee helpers
   further down are plain code and keep working for the hand-built pieces. */
const REL = "tests/fixtures/3380.json";
const data = hasData ? JSON.parse(readFileSync(dataPath(REL), "utf8")) : null;
const need = () => { if(!data) throw new NeedsData(REL); return data; };

export const source = data ? data._source : missing(REL);
export const blocks = data ? data.blocks : missing(REL, []);
export const names = data ? data.blocks.map(b => b.name) : missing(REL, []);
export const block = name => need().blocks.find(b => b.name === name);
export const measured = name => need().measured[name];

/* polyline kín của một layer: "1" đường cắt · "8" đường may */
export const ringPts = (name, layer) =>
  block(name).polylines.find(p => p.layer === layer && p.closed).pts;
export const pointsOn = (name, layer) => block(name).points.filter(p => p.layer === layer);
export const lineOn = (name, layer) => block(name).lines.find(l => l.layer === layer);

/* Các phép đo "trọng tài" — viết lại bằng vòng lặp trần, KHÔNG dùng kernel,
   để expected value không đến từ chính thứ đang bị kiểm. */
export const hypot = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
export function rawPerimeter(pts, closed = true){
  const q = closed ? pts.concat([pts[0]]) : pts;
  let s = 0;
  for(let i = 1; i < q.length; i++) s += hypot(q[i-1], q[i]);
  return s;
}
export function rawBBox(pts){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for(const [x, y] of pts){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
  return {x0, y0, x1, y1, w: x1-x0, h: y1-y0};
}
/* khoảng cách điểm → polyline, tính tay từng đoạn một */
export function rawDistToPolyline(pt, pts, closed = true){
  let best = Infinity;
  const n = pts.length;
  for(let i = 0; i < (closed ? n : n-1); i++){
    const a = pts[i], b = pts[(i+1) % n];
    const dx = b[0]-a[0], dy = b[1]-a[1], dd = dx*dx + dy*dy;
    const t = dd === 0 ? 0 : Math.max(0, Math.min(1, ((pt[0]-a[0])*dx + (pt[1]-a[1])*dy)/dd));
    best = Math.min(best, Math.hypot(pt[0]-(a[0]+dx*t), pt[1]-(a[1]+dy*t)));
  }
  return best;
}

export const median = xs => xs.slice().sort((a,b) => a-b)[Math.floor(xs.length/2)];
export const pct = (xs, p) => xs.slice().sort((a,b) => a-b)[Math.floor(xs.length*p)];

/* The seam allowance of seam vertex j, by hand: its distance to the part of the cut line that
   runs WITH the seam there — cut segments within 20° of the seam's direction into or out of j.
   Plain distance to the nearest cut point is not an allowance: at a cut corner drawn as a
   chamfer (3380 后比, first corner) the nearest point of the cut is the 7 mm chamfer, not either
   side the seam is offset from (edit.md §5, C2). */
export function rawSeamAllowance(seam, j, cut, closed = true){
  const n = seam.length, dirs = [];
  for(const step of [-1, 1]){
    for(let g = 1, k = j + step; g < n; g++, k += step){
      if(!closed && (k < 0 || k >= n)) break;
      const q = seam[(k % n + n) % n];
      const dx = q[0] - seam[j][0], dy = q[1] - seam[j][1], L = Math.hypot(dx, dy);
      if(L >= 1e-9){ dirs.push([dx/L, dy/L]); break; }
    }
  }
  let best = Infinity;
  for(let i = 0; i < cut.length; i++){
    const a = cut[i], b = cut[(i+1) % cut.length], dx = b[0]-a[0], dy = b[1]-a[1], L = Math.hypot(dx, dy);
    if(L === 0 || !dirs.some(d => Math.abs(dx*d[1] - dy*d[0])/L <= Math.sin(20*Math.PI/180))) continue;
    const t = Math.max(0, Math.min(1, ((seam[j][0]-a[0])*dx + (seam[j][1]-a[1])*dy)/(L*L)));
    best = Math.min(best, Math.hypot(seam[j][0]-a[0]-dx*t, seam[j][1]-a[1]-dy*t));
  }
  return best === Infinity ? rawDistToPolyline(seam[j], cut) : best;
}
