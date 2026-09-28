/* Along Path — đo chiều dài THẬT từ A tới B dọc theo đường rập.

   Thước dây của thợ rập, không phải thước kẻ: hai điểm cách nhau 141 mm theo đường
   chim bay có thể cách nhau 157 mm dọc theo mép cup. Con số ráp vào nhau là con số
   đi dọc đường, nên mọi phép đo POM và mọi lần khớp đường ráp đều phải đo kiểu này.

   Ba bước, đúng như đầu bài: **nhận diện path liên tục** (chain) → **tính chiều dài
   từng geometry** (Line = Euclid, Arc = r·|góc quét|, Curve = tổng dây cung — công
   thức đóng, không lấy mẫu) → **cộng lại thành tổng**. Không có bước nào xấp xỉ, nên
   `alongPath().distance` luôn bằng tổng `parts[].length` tới từng chữ số cuối.

   Vị trí trên path đo bằng **s — chiều dài cung tính từ đầu path (mm)**, không phải
   chỉ số đỉnh: nhờ vậy điểm nằm giữa hai đỉnh vẫn có toạ độ đúng, và ring kín luôn
   có hai lối đi giữa hai điểm (đi xuôi · đi ngược) chứ không phải một. */
import {EPS, length, pointAt, closestPoint, trimBetween, reverse, sample, checkShape, checkPoint} from "./model.js";

const mod = (v, m) => ((v % m) + m) % m;
const dist = (a, b) => Math.hypot(a.x-b.x, a.y-b.y);

/* ── nhận diện path liên tục ────────────────────────────────────────────────
   Nhận một mớ hình rời (đúng thứ tự hay không, vẽ xuôi hay ngược đều được) và
   xâu lại thành một chuỗi liền mạch. Hình nào không nối được thì **ném lỗi** chứ
   không lặng lẽ bỏ qua: đo thiếu một đoạn mà vẫn ra một con số đẹp là kiểu sai
   nguy hiểm nhất của một cái thước. */
export function chain(shapes, opts = {}){
  const tol = opts.tol ?? 0.05;                    // mm — khe hở CAD chấp nhận được
  /* Checked BEFORE the zero-length filter: NaN has no length, so a filter on length would
     quietly drop the one shape that should have stopped the measurement (spec A7). */
  const given = (shapes || []).filter(s => s && s.kind !== "point");
  given.forEach(checkShape);
  const src = given.filter(s => length(s) > EPS);
  if(!src.length) throw new Error("path rỗng: không có hình nào có chiều dài");

  const ring = src.find(s => s.kind === "curve" && s.closed);
  if(ring && src.length > 1)
    throw new Error("ring kín phải đứng một mình, không xâu chung với hình khác");
  if(ring) return build([ring], true, tol);

  duplicates(src, tol);
  branches(src, tol);
  const left = src.slice();
  const seq = [left.shift()];
  grow(seq, left, tol, "end");
  grow(seq, left, tol, "start");
  if(left.length)
    throw new Error(`path đứt đoạn: ${left.length} hình không nối được (khe > ${tol} mm)`);

  /* Closed is a property of where the path ends, not of how many pieces drew it: a circle
     is one arc, and a polyline flagged open whose last vertex is its first is still a ring
     (spec A4 — four pieces of CBXO172001-DES.dxf are drawn that way). */
  const closed = dist(pointAt(seq[0], 0), pointAt(seq[seq.length-1], 1)) <= tol;
  return build(seq, closed, tol);
}

/* Two shapes tracing the same curve (same way or the other way round) would chain into a
   path twice as long that also pretends to be a closed ring — refuse (spec A1). */
function duplicates(src, tol){
  const key = s => ({a: pointAt(s, 0), b: pointAt(s, 1), m: pointAt(s, 0.5), len: length(s)});
  const ks = src.map(key);
  for(let i = 0; i < ks.length; i++) for(let j = i + 1; j < ks.length; j++){
    const p = ks[i], q = ks[j];
    if(Math.abs(p.len - q.len) > tol || dist(p.m, q.m) > tol) continue;
    const same = dist(p.a, q.a) <= tol && dist(p.b, q.b) <= tol;
    const flip = dist(p.a, q.b) <= tol && dist(p.b, q.a) <= tol;
    if(same || flip)
      throw new Error(`hình trùng nhau: hình ${i + 1} và ${j + 1} vẽ đè cùng một đường — xoá bớt một cái rồi đo`);
  }
}

/* A point where three or more ends meet is a fork: walking "along the path" through it is
   a choice, and the engine does not make choices for TD (spec A2). */
function branches(src, tol){
  const ends = src.flatMap(s => [pointAt(s, 0), pointAt(s, 1)]);
  for(let i = 0; i < ends.length; i++){
    let n = 0;
    for(let j = 0; j < ends.length; j++) if(dist(ends[i], ends[j]) <= tol) n++;
    if(n >= 3)
      throw new Error(`path phân nhánh tại (${ends[i].x.toFixed(2)}, ${ends[i].y.toFixed(2)}): ${n} đầu hình gặp nhau — chọn một nhánh`);
  }
}

/* mọc thêm một đầu của chuỗi: tìm hình còn thừa có một đầu chạm đầu đang xét,
   lật chiều nếu cần — hướng đi của path là thứ quyết định dấu của s */
function grow(seq, left, tol, end){
  for(let guard = left.length; guard > 0 && left.length; guard--){
    const tip = end === "end" ? pointAt(seq[seq.length-1], 1) : pointAt(seq[0], 0);
    let hit = -1, flip = false;
    for(let i = 0; i < left.length; i++){
      const a = pointAt(left[i], 0), b = pointAt(left[i], 1);
      const da = dist(tip, a), db = dist(tip, b);
      if(Math.min(da, db) > tol) continue;
      hit = i; flip = end === "end" ? db < da : da < db;
      break;
    }
    if(hit < 0) return;
    const s = left.splice(hit, 1)[0];
    if(end === "end") seq.push(flip ? reverse(s) : s);
    else              seq.unshift(flip ? reverse(s) : s);
  }
}

function build(seq, closed, tol){
  const parts = [];
  let s0 = 0;
  for(const shape of seq){
    const len = length(shape);
    parts.push({shape, s0, s1: s0 + len, len});
    s0 += len;
  }
  const ch = {parts, closed, total: s0, tol};
  ch.crossings = crossings(ch);
  return ch;
}

/* ── where the path crosses itself ──────────────────────────────────────────
   A path that crosses itself is still one path and is measured along its strokes — never
   short-cut through the crossing — but TD has to be told (spec A3). Every part is walked as
   the segments it is drawn with (arcs and splines at 0.01 mm), and every pair of segments
   that are not neighbours on the path is tested; the crossings come back as points. */
function segmentsOf(ch){
  const segs = [];
  ch.parts.forEach(part => {
    const pts = part.shape.kind === "line" ? [[part.shape.a.x, part.shape.a.y], [part.shape.b.x, part.shape.b.y]]
              : sample(part.shape, 0.01);
    for(let i = 1; i < pts.length; i++)
      if(Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]) > EPS) segs.push([pts[i-1], pts[i]]);
  });
  return segs;
}
function crossings(ch){
  const segs = segmentsOf(ch), n = segs.length, out = [];
  const box = s => [Math.min(s[0][0], s[1][0]), Math.max(s[0][0], s[1][0]), Math.min(s[0][1], s[1][1]), Math.max(s[0][1], s[1][1])];
  const order = segs.map((s, i) => ({i, b: box(s)})).sort((p, q) => p.b[0] - q.b[0]);
  const near = (i, j) => { const d = Math.abs(i - j); return d <= 1 || (ch.closed && d === n - 1); };
  for(let a = 0; a < order.length; a++){
    const A = order[a];
    for(let b = a + 1; b < order.length && order[b].b[0] <= A.b[1] + 1e-9; b++){
      const B = order[b];
      if(near(A.i, B.i) || B.b[2] > A.b[3] + 1e-9 || B.b[3] < A.b[2] - 1e-9) continue;
      const x = cross(segs[A.i], segs[B.i]);
      if(x && !out.some(o => Math.hypot(o.x - x[0], o.y - x[1]) < 1e-6)) out.push({x: x[0], y: x[1]});
    }
  }
  return out;
}
/* proper crossing or collinear overlap of two segments; touching at an end is not a crossing */
function cross([p, q], [r, t]){
  const ux = q[0] - p[0], uy = q[1] - p[1], vx = t[0] - r[0], vy = t[1] - r[1];
  const den = ux*vy - uy*vx, wx = r[0] - p[0], wy = r[1] - p[1];
  const L = Math.hypot(ux, uy), M = Math.hypot(vx, vy);
  if(Math.abs(den) <= 1e-12*L*M){
    if(Math.abs(wx*uy - wy*ux)/L > 1e-9) return null;          // parallel, apart
    const a = (wx*ux + wy*uy)/(L*L), b = ((t[0] - p[0])*ux + (t[1] - p[1])*uy)/(L*L);
    const lo = Math.max(0, Math.min(a, b)), hi = Math.min(1, Math.max(a, b));
    return hi - lo > 1e-9 ? [p[0] + ux*lo, p[1] + uy*lo] : null; // retracing itself
  }
  const s1 = (wx*vy - wy*vx)/den, s2 = (wx*uy - wy*ux)/den;
  const e = 1e-9;
  return s1 > e && s1 < 1 - e && s2 > e && s2 < 1 - e ? [p[0] + ux*s1, p[1] + uy*s1] : null;
}

/* Tổng chiều dài path = cộng chiều dài từng geometry. Tính lại từ parts chứ không
   đọc `total` có sẵn — đây chính là khẳng định mà spec và test khoá lại. */
export function chainLength(ch){
  return ch.parts.reduce((s, p) => s + length(p.shape), 0);
}

const normS = (ch, s) => ch.closed ? mod(s, ch.total) : Math.max(0, Math.min(ch.total, s));
/* đoạn chứa s; ngay đúng mối nối thì trả đoạn SAU (đi xuôi nên local = 0) */
function partAt(ch, s){
  for(const p of ch.parts) if(s < p.s1 - 1e-9) return p;
  return ch.parts[ch.parts.length-1];
}

/* ── chiếu một điểm bấm lên path ────────────────────────────────────────────
   Trả cả `dist` — điểm bấm cách path bao xa — để UI biết mà cảnh báo thay vì âm
   thầm đo từ một chỗ người dùng không hề chỉ vào. */
export function locate(ch, p){
  checkPoint(p, "điểm bấm");
  /* Every candidate, not only the winner: two places on the path equally close to the click
     (the crossing of a figure 8, the middle of a thin strip) mean the click does not say
     where it is, and the result has to admit it — `ambiguous` (spec A3). */
  const cands = [];
  ch.parts.forEach((part, index) => {
    if(part.shape.kind === "curve"){
      const pts = part.shape.closed ? part.shape.pts.concat([part.shape.pts[0]]) : part.shape.pts;
      let run = 0;
      for(let i = 1; i < pts.length; i++){
        const ax = pts[i-1][0], ay = pts[i-1][1], dx = pts[i][0] - ax, dy = pts[i][1] - ay, L = Math.hypot(dx, dy);
        const f = L > 0 ? Math.max(0, Math.min(1, ((p.x - ax)*dx + (p.y - ay)*dy)/(L*L))) : 0;
        const q = {kind: "point", x: ax + dx*f, y: ay + dy*f};
        cands.push({index, point: q, dist: Math.hypot(p.x - q.x, p.y - q.y), s: part.s0 + run + f*L,
                    t: part.len > 0 ? (run + f*L)/part.len : 0});
        run += L;
      }
    } else {
      const r = closestPoint(part.shape, p);
      cands.push({index, t: r.t, point: r.point, dist: r.dist, s: part.s0 + r.t*part.len});
    }
  });
  let best = cands[0];
  for(const c of cands) if(c.dist < best.dist) best = c;
  best = {...best, s: normS(ch, best.s)};
  const apart = c => { const d = Math.abs(normS(ch, c.s) - best.s); return (ch.closed ? Math.min(d, ch.total - d) : d) > 1e-6; };
  best.ambiguous = cands.some(c => c.dist - best.dist <= 1e-9 && apart(c));
  return best;
}

/* điểm nằm cách đầu path đúng s mm — nền của notch "đặt ở 1/3 đường ráp" */
export function pointAtS(ch, s){
  const u = normS(ch, s);
  const part = partAt(ch, u);
  return pointAt(part.shape, part.len < EPS ? 0 : (u - part.s0)/part.len);
}

/* ── khúc path thực sự đi qua ───────────────────────────────────────────────
   Trả về hình học đã cắt đúng hai đầu, theo thứ tự đi — để canvas tô đúng khúc
   vừa đo, và để cộng lại kiểm tra được tổng. */
export function subPath(ch, from, to){
  const a = normS(ch, from), b = normS(ch, to);
  if(!ch.closed && b < a) return subPath(ch, b, a).reverse().map(reverse);
  const span = ch.closed ? mod(b - a, ch.total) : b - a;
  if(span <= EPS) return [];

  const out = [];
  let walked = 0;
  for(let guard = 0; guard <= ch.parts.length + 2 && walked < span - 1e-9; guard++){
    const s = ch.closed ? mod(a + walked, ch.total) : a + walked;
    const part = partAt(ch, s);
    const local = s - part.s0;
    const take = Math.min(part.len - local, span - walked);
    if(take > EPS) out.push(trimBetween(part.shape, local/part.len, (local + take)/part.len));
    walked += take;
  }
  return out;
}

/* ── phép đo ────────────────────────────────────────────────────────────────
   direction: "short" (mặc định) · "long" · "forward" · "backward" — chỉ có nghĩa
   trên path kín, nơi đi từ A tới B luôn có hai lối. Trên path hở chỉ có một lối,
   nên `forward`/`backward` bị bỏ qua thay vì trả một con số vô nghĩa. */
export function alongPath(ch, a, b, opts = {}){
  const la = locate(ch, a), lb = locate(ch, b);
  const dir = opts.direction || "short";

  let forward, backward = null, taken = "forward";
  if(ch.closed){
    forward  = mod(lb.s - la.s, ch.total);
    backward = ch.total - forward;
    taken = dir === "forward"  ? "forward"
          : dir === "backward" ? "backward"
          : dir === "long"     ? (forward >= backward ? "forward" : "backward")
          :                      (forward <= backward ? "forward" : "backward");
  } else {
    forward = Math.abs(lb.s - la.s);
  }

  const shapes = taken === "forward" ? subPath(ch, la.s, lb.s)
                                     : subPath(ch, lb.s, la.s).reverse().map(reverse);
  const parts = shapes.map(s => ({kind: s.kind, length: length(s), shape: s}));
  return {
    distance: taken === "forward" ? forward : backward,
    direct: dist(la.point, lb.point),          // đường chim bay, để so sánh
    forward, backward, direction: taken,
    from: la.point, to: lb.point, at: {from: la, to: lb},
    parts, shapes, total: ch.total, closed: ch.closed,
    offPath: Math.max(la.dist, lb.dist),       // điểm bấm lệch khỏi path bao nhiêu
    ambiguous: la.ambiguous || lb.ambiguous,   // a click the path cannot place on one spot
    crossings: ch.crossings                    // where the path crosses itself
  };
}

/* ── which shapes touch end to end ──────────────────────────────────────────
   The connected pieces of a drawing, before any of them is asked to be a path: a cut line
   drawn as LINE + ARC + LINE entities is one component, and Along Path must follow all of
   it, not the one entity under the click. `ends[i]` = [start, end] as [x, y]; ends within
   `tol` are one node. A grid of `tol`-sized cells keeps this linear on 10 000 splines. */
export function components(ends, tol = 0.05){
  const parent = ends.map((_, i) => i);
  const find = i => { while(parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const grid = new Map(), cell = v => Math.floor(v/tol);
  ends.forEach(([a, b], i) => {
    for(const q of [a, b]){
      const cx = cell(q[0]), cy = cell(q[1]);
      for(let dx = -1; dx <= 1; dx++) for(let dy = -1; dy <= 1; dy++)
        for(const [j, r] of grid.get(`${cx + dx},${cy + dy}`) || [])
          if(Math.hypot(q[0] - r[0], q[1] - r[1]) <= tol) parent[find(i)] = find(j);
      const k = `${cx},${cy}`;
      if(!grid.has(k)) grid.set(k, []);
      grid.get(k).push([i, q]);
    }
  });
  const groups = new Map();
  ends.forEach((_, i) => { const r = find(i); if(!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  return [...groups.values()];
}
