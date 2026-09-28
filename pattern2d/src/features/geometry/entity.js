/* The five shapes of TD's table — Line · Curve · Rectangle · Circle · Polygon (spec: sketch.md §2).

   A shape is made from its REAL dimensions and kept as those dimensions: a rectangle is a corner
   and W × H, a circle a centre and D, a polygon a centre, Size, sides and Angle — never a list of
   vertices it would have to be measured back from. So moving one cannot touch its size by a single
   bit, which is what "Drag vị trí, sửa W/H" asks. Line and Curve are kept as the points one drags.

   Millimetres, y up, angles in degrees counter-clockwise from +X (like deform.js). Pure functions
   on plain immutable objects: every edit returns a new shape and leaves the old one alone, so undo
   is keeping a reference. Nothing here knows about pixels or zoom (§5.17). */
import {point, line, arc, curve, length, tangentAt} from "./model.js";
import {bezier} from "./spline.js";
import {OUTLINE_KINDS, checkOutline, outlineSegments, outlineShape, outlineLength, outlineArea, outlineEdges,
        dragOutline, moveOutline} from "./outline.js";

export const ENTITY_TYPES = ["line", "curve", "rect", "circle", "polygon"];
/* what a new piece adds to the table (sketch.md §7): its outline and its notches */
export const PIECE_ENTITY_TYPES = ["path", "point"];

const EPS = 1e-9;                   // mm — shorter than this is "the same point"
const RAD = Math.PI/180;
const MAX_SIDES = 1000;
const finite = v => typeof v === "number" && Number.isFinite(v);

/* a point is [x, y] of two finite numbers; copied, so a caller's array is never shared */
function pt(p, what){
  if(!Array.isArray(p) || p.length < 2 || !finite(p[0]) || !finite(p[1]))
    throw new Error(`${what} không hợp lệ: cần [x, y] là số hữu hạn (mm), nhận ${JSON.stringify(p)}`);
  return [p[0], p[1]];
}
function positive(v, what){
  if(!finite(v) || v <= 0) throw new Error(`${what} không hợp lệ: ${v} — cần một số > 0 (mm)`);
  return v;
}
function degrees(v, what){
  if(!finite(v)) throw new Error(`${what} không hợp lệ: ${v} — cần số độ`);
  return v;
}
/* cos/sin of an angle in degrees, exact at the multiples of 90° — so Angle 90 gives a line whose
   dx is 0, not 6e-15, and a Horizontal/Vertical relation can be checked for an exact 0 */
function cs(deg){
  const q = ((deg % 360) + 360) % 360;
  if(q === 0) return [1, 0];
  if(q === 90) return [0, 1];
  if(q === 180) return [-1, 0];
  if(q === 270) return [0, -1];
  return [Math.cos(deg*RAD), Math.sin(deg*RAD)];
}
const norm360 = d => { const q = ((d % 360) + 360) % 360; return q === 0 ? 0 : q; };   // never −0
const dirDeg = (a, b) => norm360(Math.atan2(b[1] - a[1], b[0] - a[0])/RAD);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const plus = (p, d) => [p[0] + d[0], p[1] + d[1]];

/* ── create: real dimensions in, the shape out ─────────────────────────────────── */
export function createLine(a, b){
  const A = pt(a, "Start"), B = pt(b, "End");
  if(dist(A, B) <= EPS) throw new Error("đường dài 0: Start trùng End");
  return {type: "line", a: A, b: B};
}
export function createLinePolar(a, len, angle){
  const A = pt(a, "Start"), L = positive(len, "Length"), [c, s] = cs(degrees(angle, "Angle"));
  return createLine(A, [A[0] + L*c, A[1] + L*s]);
}
/* Start → End: a cubic Bezier, straight until a control point is pulled — the two control points
   wait on the chord at 1/3 and 2/3 (sketch.md G1) */
export function createCurve(p0, p3, c1, c2){
  const P0 = pt(p0, "Start"), P3 = pt(p3, "End");
  if(dist(P0, P3) <= EPS) throw new Error("curve không hợp lệ: Start trùng End");
  const C1 = c1 === undefined ? [P0[0] + (P3[0] - P0[0])/3, P0[1] + (P3[1] - P0[1])/3] : pt(c1, "control point 1");
  const C2 = c2 === undefined ? [P0[0] + 2*(P3[0] - P0[0])/3, P0[1] + 2*(P3[1] - P0[1])/3] : pt(c2, "control point 2");
  return {type: "curve", p0: P0, c1: C1, c2: C2, p3: P3};
}
/* W × H from the placing point, which is the lower-left corner (sketch.md G3) */
export function createRect(corner, w, h){
  const C = pt(corner, "góc đặt");
  return {type: "rect", x: C[0], y: C[1], w: positive(w, "W"), h: positive(h, "H")};
}
export function createCircle(center, d){
  return {type: "circle", c: pt(center, "tâm"), d: positive(d, "Diameter")};
}
/* Size = the diameter of the circle through the vertices; Angle 0 = the bottom edge level (G4) */
export function createPolygon(center, size, sides, angle = 0){
  if(!Number.isInteger(sides) || sides < 3 || sides > MAX_SIDES)
    throw new Error(`số cạnh không hợp lệ: ${sides} — cần số nguyên từ 3 tới ${MAX_SIDES}`);
  return {type: "polygon", c: pt(center, "tâm"), size: positive(size, "Size"), sides, angle: norm360(degrees(angle, "Angle"))};
}

/* the outline of a new piece: the points placed and which are corners (sketch.md §7, outline.js) */
export function createPath(pts, kinds){
  const o = checkOutline(pts, kinds);
  return {type: "path", pts: o.pts, kinds: o.kinds};
}
/* a notch, or any mark: a position and nothing else */
export function createPoint(p){ return {type: "point", p: pt(p, "điểm")}; }
/* point k of an outline becomes a corner ("turn") or a point the curve passes through ("curve") */
export function setPathKind(e, k, kind){
  if(!e || e.type !== "path") throw new Error(`chỉ đường viền mới có loại điểm — không phải ${e && e.type}`);
  if(!Number.isInteger(k) || k < 0 || k >= e.pts.length) throw new Error(`không có điểm ${k} — đường viền có ${e.pts.length} điểm`);
  if(!OUTLINE_KINDS.includes(kind)) throw new Error(`loại điểm không hợp lệ: "${kind}" — chỉ có turn · curve`);
  return createPath(e.pts, e.kinds.map((x, i) => i === k ? kind : x));
}

/* ── derived points ───────────────────────────────────────────────────────────── */
function rectVerts(e){ return [[e.x, e.y], [e.x + e.w, e.y], [e.x + e.w, e.y + e.h], [e.x, e.y + e.h]]; }
/* vertex k sits at −90° + 180°/n + Angle + k·360°/n: at Angle 0 the edge v(n−1) → v0 is the level
   bottom one, and the ring runs counter-clockwise */
function polyVerts(e){
  const R = e.size/2, out = [];
  for(let k = 0; k < e.sides; k++){
    const [c, s] = cs(-90 + 180/e.sides + e.angle + 360*k/e.sides);
    out.push([e.c[0] + R*c, e.c[1] + R*s]);
  }
  return out;
}
const verticesOf = e => e.type === "rect" ? rectVerts(e) : e.type === "polygon" ? polyVerts(e) : [];

/* the handles one can grab: a "shape" handle reshapes, a "position" handle moves (sketch.md §2) */
export function entityHandles(e){
  const c = p => p.slice();                        // copies: a handle list must not alias the shape
  switch(e.type){
    case "line": return [{name: "a", at: c(e.a), role: "shape"}, {name: "b", at: c(e.b), role: "shape"}, {name: "body", at: null, role: "position"}];
    case "curve": return [{name: "p0", at: c(e.p0), role: "shape"}, {name: "c1", at: c(e.c1), role: "shape"},
                          {name: "c2", at: c(e.c2), role: "shape"}, {name: "p3", at: c(e.p3), role: "shape"},
                          {name: "body", at: null, role: "position"}];
    case "circle": return [{name: "c", at: c(e.c), role: "position"}, {name: "body", at: null, role: "position"}];
    case "rect": return [...rectVerts(e).map((v, k) => ({name: `v${k}`, at: v, role: "position"})), {name: "body", at: null, role: "position"}];
    case "polygon": return [{name: "c", at: c(e.c), role: "position"},
                            ...polyVerts(e).map((v, k) => ({name: `v${k}`, at: v, role: "position"})), {name: "body", at: null, role: "position"}];
    case "path": return [...e.pts.map((v, k) => ({name: `v${k}`, at: c(v), role: "shape"})), {name: "body", at: null, role: "position"}];
    case "point": return [{name: "p", at: c(e.p), role: "position"}, {name: "body", at: null, role: "position"}];
  }
  throw new Error(`hình không hợp lệ: ${e && e.type}`);
}
function handlePoint(e, name){
  const h = entityHandles(e).find(x => x.name === name);
  if(!h || !h.at) throw new Error(`tay nắm không có: ${e.type} không có "${name}"`);
  return h.at;
}

/* the exact kernel shape — what is drawn, measured, snapped to and exported */
export function entityShape(e){
  switch(e.type){
    case "line": return line(point(e.a[0], e.a[1]), point(e.b[0], e.b[1]));
    case "curve": return bezier([e.p0, e.c1, e.c2, e.p3]);
    case "circle": return arc(point(e.c[0], e.c[1]), e.d/2, 0, 2*Math.PI, true);
    case "rect": case "polygon": return curve(verticesOf(e), true);
    case "path": return outlineShape(e.pts, e.kinds);
    case "point": return point(e.p[0], e.p[1]);
  }
  throw new Error(`hình không hợp lệ: ${e && e.type}`);
}

/* what other shapes may snap to (G8): ends, corners, vertices, centres — never a control point;
   the edges of a rectangle or polygon as lines, so a snap on them says "line" */
export function entitySnap(e){
  switch(e.type){
    case "line": return {points: [e.a.slice(), e.b.slice()], handles: ["a", "b"], shapes: [entityShape(e)]};
    case "curve": return {points: [e.p0.slice(), e.p3.slice()], handles: ["p0", "p3"], shapes: [entityShape(e)]};
    case "circle": return {points: [e.c.slice()], handles: ["c"], shapes: [entityShape(e)]};
    case "rect": case "polygon": {
      const v = verticesOf(e), edges = v.map((p, k) => line(point(p[0], p[1]), point(v[(k + 1) % v.length][0], v[(k + 1) % v.length][1])));
      const pts = e.type === "polygon" ? [e.c.slice(), ...v] : v;
      const names = e.type === "polygon" ? ["c", ...v.map((_, k) => `v${k}`)] : v.map((_, k) => `v${k}`);
      return {points: pts, handles: names, shapes: edges};
    }
    /* an outline's straight edges as lines, its curved spans as curves — so a snap says which */
    case "path": return {points: e.pts.map(p => p.slice()), handles: e.pts.map((_, k) => `v${k}`),
                         shapes: outlineSegments(e.pts, e.kinds).map(s => s.kind === "line"
                           ? line(point(s.ctrl[0][0], s.ctrl[0][1]), point(s.ctrl[1][0], s.ctrl[1][1])) : bezier(s.ctrl))};
    case "point": return {points: [e.p.slice()], handles: ["p"], shapes: []};
  }
  throw new Error(`hình không hợp lệ: ${e && e.type}`);
}

/* the real dimensions, read back from what is stored */
export function entityDims(e){
  switch(e.type){
    case "line": return {length: dist(e.a, e.b), angle: dirDeg(e.a, e.b)};
    case "curve": {
      const s = entityShape(e), t0 = tangentAt(s, 0), t1 = tangentAt(s, 1);
      return {length: length(s), chord: dist(e.p0, e.p3), startAngle: norm360(Math.atan2(t0.y, t0.x)/RAD),
              endAngle: norm360(Math.atan2(t1.y, t1.x)/RAD)};
    }
    case "rect": return {w: e.w, h: e.h, perimeter: 2*(e.w + e.h), area: e.w*e.h};
    case "circle": return {d: e.d, r: e.d/2, circumference: Math.PI*e.d, area: Math.PI*e.d*e.d/4};
    case "polygon": {
      const R = e.size/2, n = e.sides, side = e.size*Math.sin(Math.PI/n);
      return {size: e.size, sides: n, angle: e.angle, side, perimeter: n*side, area: n/2*R*R*Math.sin(2*Math.PI/n),
              inradius: R*Math.cos(Math.PI/n)};
    }
    case "path": {
      const turns = e.kinds.filter(k => k === "turn").length;
      return {perimeter: outlineLength(e.pts, e.kinds), area: Math.abs(outlineArea(e.pts, e.kinds)), points: e.pts.length,
              turns, curves: e.pts.length - turns, edges: outlineEdges(e.pts, e.kinds).map(x => x.length)};
    }
    case "point": return {x: e.p[0], y: e.p[1]};
  }
  throw new Error(`hình không hợp lệ: ${e && e.type}`);
}

/* ── edit ─────────────────────────────────────────────────────────────────────── */
export function moveEntity(e, dx, dy){
  if(!finite(dx) || !finite(dy)) throw new Error(`độ dời không hợp lệ: ${dx}, ${dy}`);
  const d = [dx, dy];
  switch(e.type){
    case "line": return {type: "line", a: plus(e.a, d), b: plus(e.b, d)};
    case "curve": return {type: "curve", p0: plus(e.p0, d), c1: plus(e.c1, d), c2: plus(e.c2, d), p3: plus(e.p3, d)};
    case "rect": return {type: "rect", x: e.x + dx, y: e.y + dy, w: e.w, h: e.h};
    case "circle": return {type: "circle", c: plus(e.c, d), d: e.d};
    case "polygon": return {type: "polygon", c: plus(e.c, d), size: e.size, sides: e.sides, angle: e.angle};
    case "path": { const o = moveOutline(e, dx, dy); return {type: "path", pts: o.pts, kinds: o.kinds}; }
    case "point": return {type: "point", p: plus(e.p, d)};
  }
  throw new Error(`hình không hợp lệ: ${e && e.type}`);
}

/* Drag one handle to `target` — the rule of the table (sketch.md §2):
     Line   a / b   that end goes there, the other keeps every bit
     Curve  p0 / p3 that end goes there and its control point comes along (G2) · c1 / c2 only that point
     any    body    moves by target − from (from = where it was grabbed)
     Rectangle · Circle · Polygon: every handle only moves the shape, so the handle lands on target
   A drag that would collapse the shape is refused (K4). */
export function dragEntity(e, handle, target, from){
  const T = pt(target, "đích");
  if(handle === "body"){
    if(from === undefined) throw new Error("kéo thân cần chỗ nắm (from)");
    const F = pt(from, "chỗ nắm");
    return moveEntity(e, T[0] - F[0], T[1] - F[1]);
  }
  if(e.type === "line"){
    if(handle === "a") return createLine(T, e.b);
    if(handle === "b") return createLine(e.a, T);
  }
  if(e.type === "curve"){
    if(handle === "p0" || handle === "p3"){
      const P = handle === "p0" ? e.p0 : e.p3, d = [T[0] - P[0], T[1] - P[1]];
      if(dist(T, handle === "p0" ? e.p3 : e.p0) <= EPS) throw new Error("curve không hợp lệ: Start trùng End");
      return handle === "p0" ? {type: "curve", p0: T, c1: plus(e.c1, d), c2: e.c2, p3: e.p3}
                             : {type: "curve", p0: e.p0, c1: e.c1, c2: plus(e.c2, d), p3: T};
    }
    if(handle === "c1") return {type: "curve", p0: e.p0, c1: T, c2: e.c2, p3: e.p3};
    if(handle === "c2") return {type: "curve", p0: e.p0, c1: e.c1, c2: T, p3: e.p3};
  }
  /* "v7" → 7, by comparing strings: a regex ending in "$" reads as a name to the build (CLAUDE.md §7) */
  const vk = typeof handle === "string" && handle[0] === "v" ? Number(handle.slice(1)) : NaN;
  if(e.type === "path" && Number.isInteger(vk) && String(vk) === handle.slice(1)){
    const k = vk;
    if(k >= e.pts.length) throw new Error(`tay nắm không có: path không có "${handle}"`);
    const o = dragOutline(e, k, T);
    return {type: "path", pts: o.pts, kinds: o.kinds};
  }
  if(e.type === "point" && handle === "p") return {type: "point", p: T};
  if(e.type === "circle" && handle === "c") return {type: "circle", c: T, d: e.d};
  if(e.type === "polygon" && handle === "c") return {type: "polygon", c: T, size: e.size, sides: e.sides, angle: e.angle};
  if((e.type === "rect" || e.type === "polygon") && typeof handle === "string" && handle[0] === "v"){
    const at = handlePoint(e, handle);                          // v0 … v(n−1); anything else is refused there
    return moveEntity(e, T[0] - at[0], T[1] - at[1]);
  }
  throw new Error(`tay nắm không có: ${e && e.type} không có "${handle}"`);
}

/* Numbers when precision matters (N2):
     Line    length — the kept end stays, the other slides along the line · angle — turns about the kept end
             (keep: "a" = Start, the default, or "b"); the angle is always the direction Start → End
     Rect    w · h — the anchor corner stays
     Circle  d — the centre stays
     Polygon size · angle — the centre stays; the number of sides is fixed once made (G4) */
const DIMS = {line: ["length", "angle"], rect: ["w", "h"], circle: ["d"], polygon: ["size", "angle"], curve: [], path: [], point: []};
export function setEntityDim(e, dim, value, {keep = "a"} = {}){
  if(!DIMS[e.type]) throw new Error(`hình không hợp lệ: ${e && e.type}`);
  if(e.type === "polygon" && dim === "sides") throw new Error("số cạnh không sửa sau khi tạo (sketch.md G4)");
  if(!DIMS[e.type].includes(dim)) throw new Error(`${e.type} không có kích thước "${dim}" để đặt — chỉ có ${DIMS[e.type].join(" · ") || "vị trí"}`);
  if(e.type === "line"){
    if(keep !== "a" && keep !== "b") throw new Error(`đầu giữ không hợp lệ: ${keep}`);
    const K = keep === "a" ? e.a : e.b, M = keep === "a" ? e.b : e.a;
    if(dim === "length"){
      const L = positive(value, "Length"), n = dist(K, M), u = [(M[0] - K[0])/n, (M[1] - K[1])/n];
      const far = [K[0] + L*u[0], K[1] + L*u[1]];
      return keep === "a" ? createLine(K, far) : createLine(far, K);
    }
    const [c, s] = cs(degrees(value, "Angle")), L = dist(K, M);
    return keep === "a" ? createLine(K, [K[0] + L*c, K[1] + L*s]) : createLine([K[0] - L*c, K[1] - L*s], K);
  }
  if(e.type === "rect") return {type: "rect", x: e.x, y: e.y, w: dim === "w" ? positive(value, "W") : e.w, h: dim === "h" ? positive(value, "H") : e.h};
  if(e.type === "circle") return {type: "circle", c: e.c, d: positive(value, "Diameter")};
  return dim === "size" ? {type: "polygon", c: e.c, size: positive(value, "Size"), sides: e.sides, angle: e.angle}
                        : {type: "polygon", c: e.c, size: e.size, sides: e.sides, angle: norm360(degrees(value, "Angle"))};
}
