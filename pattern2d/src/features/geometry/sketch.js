/* The sketch — new shapes that snap to one another and keep their relations
   (spec: sketch.md §3.3 Snap · §3.5 Constraint).

   A relation has a MASTER and a follower, the way the rest of this kernel does (graph.js, the
   §8 decision): the follower is worked out from the master, never the other way round. What is
   solved is not whole shapes but the points and sizes they are made of — a line's two ends, a
   curve's four points, a rigid shape's position and its dimensions — because a closed chain of
   lines joined end to end is a loop of shapes but not a loop of points. Every operation is one
   pass over those in dependency order: nothing iterates, nothing searches, so it always ends and
   always gives the same answer. A slot whose inputs did not change keeps every bit.

   Every operation is a transaction: it either leaves every relation holding (checked again at the
   end, to 1e-9 mm) or is refused whole and changes nothing — the drag that would fold a follower to
   nothing does not move its master either (R9). Millimetres, degrees counter-clockwise from +X. */
import {snapTo} from "./snap.js";
import {point, pointAt, tangentAt, closestPoint, length} from "./model.js";
import {cornerIndices} from "./corners.js";
import {isStraight, edgeRange} from "./deform.js";
import {createLine, createCurve, createRect, createCircle, createPolygon, createPath, createPoint, createPolyline, entityHandles, entityShape,
        entitySnap, setEntityDim, dragEntity, moveEntity, ENTITY_TYPES, PIECE_ENTITY_TYPES, PEN_ENTITY_TYPES} from "./entity.js";
import {outlineLocate, outlineAt} from "./outline.js";

export const CONSTRAINT_TYPES = ["horizontal", "vertical", "coincident", "tangent", "equal"];

const EPS = 1e-9;             // mm — closer than this is one point
const TOL = 1e-9;             // mm — how far a relation may be off after an operation: rounding only
const STRAIGHT = 0.01;        // mm — a polyline edge this close to its chord is a line (Edges, Edit S3)
const RAD = Math.PI/180;
const CYCLE = "vòng lặp phụ thuộc — quan hệ một chiều không giải được vòng; để một cạnh tự do (sketch.md G13)";

const finite = v => typeof v === "number" && Number.isFinite(v);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (u, v) => u[0]*v[0] + u[1]*v[1];
const cross = (u, v) => u[0]*v[1] - u[1]*v[0];
const samePt = (a, b) => Object.is(a[0], b[0]) && Object.is(a[1], b[1]);
const unit = v => { const n = Math.hypot(v[0], v[1]); return n > EPS ? [v[0]/n, v[1]/n] : null; };
/* cos/sin in degrees, exact at multiples of 90° (as entity.js) */
function cs(deg){
  const q = ((deg % 360) + 360) % 360;
  return q === 0 ? [1, 0] : q === 90 ? [0, 1] : q === 180 ? [-1, 0] : q === 270 ? [0, -1] : [Math.cos(deg*RAD), Math.sin(deg*RAD)];
}
function checkPt(p, what){
  if(!Array.isArray(p) || !finite(p[0]) || !finite(p[1])) throw new Error(`${what} không hợp lệ: ${JSON.stringify(p)}`);
  return [p[0], p[1]];
}
function freeze(o){ if(o && typeof o === "object" && !Object.isFrozen(o)){ Object.values(o).forEach(freeze); Object.freeze(o); } return o; }
/* a relation is frozen with its refs — but not the DXF shape it may point at: that is the caller's */
function freezeC(c){
  for(const r of [c.on, c.master, c.driven]) if(r){ if(r.point) Object.freeze(r.point); Object.freeze(r); }
  return Object.freeze(c);
}

/* ── snap: point, then line or curve, within the drawing's tolerance ─────────── */
/* snapTo (snap.js) decides WHETHER and WHERE; this adds WHAT: a polyline hit is a line on an edge
   that is straight between its corners (0.01 mm — the Edges/Edit definition) and a curve elsewhere */
export function snapHit(w, {points = [], shapes = []} = {}, tol){
  const r = snapTo(w, {points, shapes}, tol);
  return {point: r.point, kind: r.kind === "line" ? shapeKind(shapes[r.index], r.point) : r.kind, dist: r.dist, index: r.index};
}
function distSeg(p, a, b){
  const d = sub(b, a), dd = dot(d, d), t = dd ? Math.max(0, Math.min(1, dot(sub(p, a), d)/dd)) : 0;
  return Math.hypot(p[0] - a[0] - d[0]*t, p[1] - a[1] - d[1]*t);
}
function shapeKind(s, p){
  if(s.kind === "line") return "line";
  if(s.kind !== "curve") return "curve";                      // arc, spline
  const pts = s.pts, n = pts.length;
  if(n < 3) return "line";
  let seg = 0, bd = Infinity;
  for(let i = 0; i < (s.closed ? n : n - 1); i++){ const d = distSeg(p, pts[i], pts[(i + 1) % n]); if(d < bd){ bd = d; seg = i; } }
  const cs = cornerIndices(pts, s.closed).slice().sort((x, y) => x - y);
  let idx;
  if(!s.closed){
    let a = 0, b = n - 1;
    for(const c of cs){ if(c <= seg) a = c; else { b = c; break; } }
    idx = edgeRange(n, false, a, b);
  } else {
    if(!cs.length) return "curve";                            // a ring with no corner turns all the way round
    let k = cs.length - 1;
    for(let j = 0; j < cs.length; j++) if(cs[j] <= seg) k = j;
    const a = cs[k], b = cs[(k + 1) % cs.length];
    idx = a === b ? Array.from({length: n + 1}, (_, i) => (a + i) % n) : edgeRange(n, true, a, b);
  }
  return isStraight(idx.map(i => pts[i]), STRAIGHT) ? "line" : "curve";
}

/* ── the pieces a shape is solved in ─────────────────────────────────────────── */
/* A Point (a notch) is solved like a rigid shape with nothing to size: its position follows what it is
   held on. A Path (a new piece's outline, sketch.md §7) is one slot — its points and their kinds — that
   only the hand changes: it is a master to what rides on it, never a follower (O14). */
const RIGID = new Set(["rect", "circle", "polygon", "point"]);
const isRigid = e => RIGID.has(e.type);
/* a Path and the smart pen's Đường (sketch.md §8, L9) are each one slot — points and kinds — that only the hand changes */
const isWhole = e => e.type === "path" || e.type === "polyline";
const slotsOf = e => e.type === "line" ? ["a", "b"] : e.type === "curve" ? ["p0", "c1", "c2", "p3"] : isWhole(e) ? ["geom"] : ["pos", "dims"];
const key = (id, s) => `${id}\u0001${s}`;
const unkey = k => { const i = k.lastIndexOf("\u0001"); return [k.slice(0, i), k.slice(i + 1)]; };
function slotValue(e, s){
  if(e.type === "line" || e.type === "curve") return e[s];
  if(e.type === "rect") return s === "pos" ? [e.x, e.y] : {w: e.w, h: e.h};
  if(e.type === "circle") return s === "pos" ? e.c : {d: e.d};
  if(e.type === "point") return s === "pos" ? e.p : {};
  if(isWhole(e)) return e;
  return s === "pos" ? e.c : {size: e.size, angle: e.angle};
}
const sameVal = (a, b) => Array.isArray(a) ? samePt(a, b) : Object.keys(a).every(k => Object.is(a[k], b[k]));
function assemble(e0, get){
  switch(e0.type){
    case "line": return {type: "line", a: get("a"), b: get("b")};
    case "curve": return {type: "curve", p0: get("p0"), c1: get("c1"), c2: get("c2"), p3: get("p3")};
    case "rect": { const p = get("pos"), d = get("dims"); return {type: "rect", x: p[0], y: p[1], w: d.w, h: d.h}; }
    case "circle": return {type: "circle", c: get("pos"), d: get("dims").d};
    case "polygon": { const d = get("dims"); return {type: "polygon", c: get("pos"), size: d.size, sides: e0.sides, angle: d.angle}; }
    case "point": return {type: "point", p: get("pos")};
    case "path": case "polyline": return get("geom");
  }
}
/* the constructors check what came out: a line of length 0, a curve whose ends met — refused */
function rebuild(e){
  switch(e.type){
    case "line": return createLine(e.a, e.b);
    case "curve": return createCurve(e.p0, e.p3, e.c1, e.c2);
    case "rect": return createRect([e.x, e.y], e.w, e.h);
    case "circle": return createCircle(e.c, e.d);
    case "polygon": return createPolygon(e.c, e.size, e.sides, e.angle);
    case "point": return createPoint(e.p);
    case "path": return createPath(e.pts, e.kinds);
    case "polyline": return createPolyline(e.pts, e.kinds);
  }
}
const handlePos = (e, h) => (entityHandles(e).find(x => x.name === h) || {}).at || null;
const ENDS = {line: ["a", "b"], curve: ["p0", "p3"]};
const isEnd = (e, h) => (ENDS[e.type] || []).includes(h);
/* a point another shape may follow: never a control point, never "body" */
const isMasterHandle = (e, h) => h !== "body" && h !== "c1" && h !== "c2" && !!handlePos(e, h);
/* a point that may follow: an end, a corner, a vertex, a centre — never a point of an outline (O14) */
const isDrivenHandle = (e, h) => (e.type === "line" || e.type === "curve") ? isEnd(e, h) : isWhole(e) ? false : (h !== "body" && !!handlePos(e, h));
const isCopy = c => c.master.point !== undefined || c.master.handle !== undefined;

export function createSketch(){
  let ents = new Map(), cons = new Map(), seq = 0, cseq = 0;

  const need = id => { const e = ents.get(id); if(!e) throw new Error(`hình không có: ${id}`); return e; };
  const describe = r => !r ? "?" : r.point ? `điểm DXF (${r.point[0]}, ${r.point[1]})` : r.shape ? "đường DXF"
                      : r.handle !== undefined ? `${r.id}.${r.handle}` : String(r.id);

  /* who drives what — at most one relation per degree of freedom (R7) */
  function drivers(C, E){
    const D = new Map();
    const of = id => { if(!D.has(id)) D.set(id, {pin: {}, dir: {}, len: null, pos: null, dims: null}); return D.get(id); };
    for(const c of C.values()){
      if(c.type === "coincident"){
        const e = E.get(c.driven.id), d = of(c.driven.id);
        if(isRigid(e)){ if(d.pos) return {clash: `${c.driven.id} đã bám ${describe(C.get(d.pos).master)} — gỡ quan hệ cũ trước`}; d.pos = c.cid; }
        else { if(d.pin[c.driven.handle]) return {clash: `${describe(c.driven)} đã bám ${describe(C.get(d.pin[c.driven.handle]).master)} — gỡ quan hệ cũ trước`}; d.pin[c.driven.handle] = c.cid; }
      } else if(c.type === "horizontal" || c.type === "vertical" || c.type === "tangent"){
        const id = c.type === "tangent" ? c.driven.id : c.on.id, e = E.get(id), d = of(id);
        const slot = c.type === "tangent" ? (e.type === "line" ? "line" : (c.end === "p0" ? "c1" : "c2")) : (c.on.handle || "line");
        if(d.dir[slot]) return {clash: `${id}${slot === "line" ? "" : "." + slot} đã bị khoá hướng bởi ${C.get(d.dir[slot]).type} — mỗi hướng chỉ một quan hệ`};
        d.dir[slot] = c.cid;
      } else if(c.type === "equal"){
        const e = E.get(c.driven.id), d = of(c.driven.id);
        if(e.type === "line"){ if(d.len) return {clash: `${c.driven.id} đã bằng chiều dài ${describe(C.get(d.len).master)}`}; d.len = c.cid; }
        else { if(d.dims) return {clash: `${c.driven.id} đã bằng ${describe(C.get(d.dims).master)}`}; d.dims = c.cid; }
      }
    }
    for(const [id, d] of D)
      if(E.get(id).type === "line" && d.pin.a && d.pin.b && (d.dir.line || d.len))
        return {clash: `${id} đã bám cả hai đầu — không khoá thêm hướng hay chiều dài được`};
    return {D};
  }
  const NONE = {pin: {}, dir: {}, len: null, pos: null, dims: null};
  /* the end a line turns about: the one that is pinned, else Start (G9) */
  const pivotOf = d => d.pin.b && !d.pin.a ? "b" : "a";

  /* the dependency graph between slots, and its order — null when it has a loop (R8) */
  function graph(E, C, D, swap){
    const nodes = [], deps = new Map();
    for(const [id, e] of E) for(const s of slotsOf(e)){ nodes.push(key(id, s)); deps.set(key(id, s), new Set()); }
    const add = (n, d) => { if(n !== d) deps.get(n).add(d); };
    const all = id => slotsOf(E.get(id)).map(s => key(id, s));
    const handleSlots = (id, h) => { const e = E.get(id); return isRigid(e) ? (h === "c" ? [key(id, "pos")] : [key(id, "pos"), key(id, "dims")]) : isWhole(e) ? [key(id, "geom")] : [key(id, h)]; };
    const fromRef = (n, r) => { if(r.id !== undefined) (r.handle !== undefined ? handleSlots(r.id, r.handle) : all(r.id)).forEach(s => add(n, s)); };
    for(const c of C.values()){
      if(c.type !== "coincident") continue;
      const e = E.get(c.driven.id), n = isRigid(e) ? key(c.driven.id, "pos") : key(c.driven.id, c.driven.handle);
      fromRef(n, c.master);
      if(isRigid(e)) add(n, key(c.driven.id, "dims"));
    }
    for(const [id, e] of E){
      const d = D.get(id) || NONE;
      if(e.type === "line" && (d.dir.line || d.len)){
        const piv = swap && swap.id === id ? swap.pivot : pivotOf(d), n = key(id, piv === "a" ? "b" : "a");
        add(n, key(id, piv));
        for(const cid of [d.dir.line, d.len]) if(cid && C.get(cid).master) fromRef(n, {id: C.get(cid).master.id});
      }
      if(e.type === "curve"){
        add(key(id, "c1"), key(id, "p0")); add(key(id, "c2"), key(id, "p3"));
        for(const h of ["c1", "c2"]) if(d.dir[h] && C.get(d.dir[h]).master) fromRef(key(id, h), {id: C.get(d.dir[h]).master.id});
      }
      if(isRigid(e) && d.dims && C.get(d.dims).master.id !== undefined) add(key(id, "dims"), key(C.get(d.dims).master.id, "dims"));
    }
    return {nodes, deps};
  }
  function topo({nodes, deps}){
    const indeg = new Map(), users = new Map(nodes.map(n => [n, []]));
    for(const n of nodes){ indeg.set(n, deps.get(n).size); for(const d of deps.get(n)) users.get(d).push(n); }
    const queue = nodes.filter(n => indeg.get(n) === 0), order = [];
    while(queue.length){
      const n = queue.shift(); order.push(n);
      for(const u of users.get(n)){ indeg.set(u, indeg.get(u) - 1); if(indeg.get(u) === 0) queue.push(u); }
    }
    return order.length === nodes.length ? order : null;
  }

  /* ── one pass: old shapes + relations + one operation → new shapes, or a refusal ──
     op: {kind: "drag", id, handle, target} · {kind: "shift", id, d} · {kind: "dim", id, dim, value, keep}
         · {kind: "settle", id} (after a declaration: its follower is worked out afresh)
         · {kind: "reshape", id, entity} (an outline replaced by another outline — its points' kinds changed) */
  function evaluate(E0, C0, op){
    const {D, clash} = drivers(C0, E0);
    if(clash) throw new Error(clash);
    /* a line with nothing pinned turns about the end NOT being dragged, or the end being kept —
       unless that would make a loop, then about Start as always (G9) */
    let swap = null;
    if((op.kind === "drag" || op.kind === "dim") && E0.get(op.id).type === "line"){
      const d = D.get(op.id) || NONE, want = op.kind === "drag" ? (op.handle === "a" ? "b" : "a") : (op.keep || "a");
      if((d.dir.line || d.len) && !d.pin.a && !d.pin.b && want !== "a") swap = {id: op.id, pivot: want};
    }
    let G = graph(E0, C0, D, swap), order = topo(G);
    if(!order && swap){ swap = null; G = graph(E0, C0, D, null); order = topo(G); }
    if(!order) throw new Error(CYCLE);

    const S = new Map(), dirty = new Set(), tNew = new Map(), edgeNew = new Map();
    const seeds = new Set(op.id !== undefined ? slotsOf(E0.get(op.id)).map(s => key(op.id, s)) : []);
    const newPoint = r => {
      if(r.point) return r.point;
      const e0 = E0.get(r.id);
      if(isWhole(e0)) return handlePos(S.get(key(r.id, "geom")), r.handle);
      if(!isRigid(e0)) return S.get(key(r.id, r.handle));
      return handlePos(assemble(e0, s => S.get(key(r.id, s))), r.handle);
    };
    const newEnt = id => assemble(E0.get(id), s => S.get(key(id, s)));
    const newShape = r => r.shape || entityShape(newEnt(r.id));
    const lengthOf = r => r.shape ? length(r.shape) : length(entityShape(newEnt(r.id)));
    /* where along the master a junction sits, then the master's direction there, turned by the sign */
    const junctionT = via => {
      if(via.master.handle !== undefined) return via.master.handle === "a" || via.master.handle === "p0" ? 0 : 1;
      return tNew.has(via.cid) ? tNew.get(via.cid) : via.t;
    };
    const tangentDir = c => { const q = tangentAt(newShape(c.master), junctionT(C0.get(c.via))); return [c.sign*q.x, c.sign*q.y]; };
    const shiftOf = id => op.kind === "shift" && op.id === id ? op.d : null;
    const dragOf = (id, h) => op.kind === "drag" && op.id === id && op.handle === h ? op.target : null;
    const dimOf = id => op.kind === "dim" && op.id === id ? op : null;

    /* A point held on a new piece's outline rides on its EDGE (sketch.md O14, O16): the same share of the
       same edge, so reshaping another edge cannot move it. Moved by the hand, it is placed afresh; when its
       edge no longer exists (a corner added or taken away inside it) it stays at the outline's point nearest
       to where it was. */
    const outlineOf = r => r.id !== undefined && E0.get(r.id).type === "path" ? newEnt(r.id) : null;
    function rideEdge(c, P, target, prev){
      let loc = null;
      if(target) loc = outlineLocate(P.pts, P.kinds, target);
      else { try{ return outlineAt(P.pts, P.kinds, c.from, c.to, c.share); }catch(e){ loc = outlineLocate(P.pts, P.kinds, prev); } }
      edgeNew.set(c.cid, {from: loc.from, to: loc.to, share: loc.share});
      return loc.point.slice();
    }
    function pinnedPoint(id, s, c){
      if(isCopy(c)) return newPoint(c.master).slice();
      const T = dragOf(id, s), P = outlineOf(c.master);
      if(P) return rideEdge(c, P, T, E0.get(id)[s]);
      const shape = newShape(c.master);
      let t = c.t;
      if(T){ t = closestPoint(shape, point(T[0], T[1])).t; tNew.set(c.cid, t); }
      const q = pointAt(shape, t);
      return [q.x, q.y];
    }
    /* a line end worked out from its pivot: direction from H/V/Tangent, length from Equal; what is not
       locked is kept (a drag projects onto what is free; with nothing dragged the length is kept and
       an unlocked direction points where the end already was — G10) */
    function lineFar(id, e0, d, piv, far){
      const J = S.get(key(id, piv)), J0 = e0[piv], F0 = e0[far], T = dragOf(id, far), dim = dimOf(id);
      const dirC = d.dir.line ? C0.get(d.dir.line) : null, lenC = d.len ? C0.get(d.len) : null;
      const hv = dirC && dirC.type !== "tangent";
      let u;
      if(hv){
        const ax = dirC.type === "horizontal" ? 0 : 1;
        let sg = T ? Math.sign(T[ax] - J[ax]) : 0;
        if(!sg) sg = Math.sign(F0[ax] - J0[ax]) || 1;
        u = ax === 0 ? [sg, 0] : [0, sg];
      } else if(dirC) u = tangentDir(dirC);
      else if(T){ u = unit(sub(T, J)); if(!u) throw new Error("đầu kéo đè lên gốc — không còn hướng"); }
      else if(dim && dim.dim === "angle"){ const q = cs(dim.value); u = piv === "a" ? q : [-q[0], -q[1]]; }
      else u = unit(sub(F0, J)) || unit(sub(F0, J0));
      let L;
      if(lenC) L = lengthOf(lenC.master);
      else if(T){ L = dot(sub(T, J), u); if(!hv && !(L > EPS)) throw new Error("kéo lùi qua chỗ nối — tiếp tuyến phải đi tới"); }
      else if(dim && dim.dim === "length") L = dim.value;
      else L = dist(F0, J0);
      if(!(L > EPS)) throw new Error("đường dài 0: đầu chạy đè lên gốc");
      return [J[0] + L*u[0], J[1] + L*u[1]];
    }
    function curveHandle(id, e0, d, h){
      const an = h === "c1" ? "p0" : "p3", A = S.get(key(id, an)), A0 = e0[an], H0 = e0[h], T = dragOf(id, h);
      const dirC = d.dir[h] ? C0.get(d.dir[h]) : null;
      if(!dirC){
        if(T) return T.slice();
        return samePt(A, A0) ? H0 : [A[0] + H0[0] - A0[0], A[1] + H0[1] - A0[1]];      // travels with its end (G2)
      }
      let u;
      const hv = dirC.type !== "tangent";
      if(hv){
        const ax = dirC.type === "horizontal" ? 0 : 1;
        let sg = T ? Math.sign(T[ax] - A[ax]) : 0;
        if(!sg) sg = Math.sign(H0[ax] - A0[ax]) || 1;
        u = ax === 0 ? [sg, 0] : [0, sg];
      } else u = tangentDir(dirC);
      const k = T ? dot(sub(T, A), u) : dist(H0, A0);
      if(!(k > EPS)) throw new Error(hv ? "tay nắm dài 0 — không còn hướng" : "kéo lùi qua chỗ nối — tiếp tuyến phải đi tới");
      return [A[0] + k*u[0], A[1] + k*u[1]];
    }
    function rigidSlot(id, e0, d, s){
      const old = slotValue(e0, s);
      if(s === "dims"){
        const dim = dimOf(id);
        if(d.dims){
          const md = S.get(key(C0.get(d.dims).master.id, "dims"));
          if(e0.type === "circle") return {d: md.d};
          if(e0.type === "rect") return {w: md.w, h: md.h};
          return {size: md.size, angle: dim && dim.dim === "angle" ? setEntityDim(e0, "angle", dim.value).angle : old.angle};
        }
        return dim ? slotValue(setEntityDim(e0, dim.dim, dim.value), "dims") : old;
      }
      const dd = shiftOf(id), dims = S.get(key(id, "dims"));
      if(!d.pos) return dd ? [old[0] + dd[0], old[1] + dd[1]] : old;
      const c = C0.get(d.pos), h = c.driven.handle;
      const probe = assemble(e0, x => x === "pos" ? [0, 0] : dims), off = handlePos(probe, h);
      let P;
      if(isCopy(c)){ if(dd) throw new Error(`${id} đang trùng ${describe(c.master)} — kéo cái nó bám`); P = newPoint(c.master); }
      else if(outlineOf(c.master)){
        const at = handlePos(e0, h);
        P = rideEdge(c, outlineOf(c.master), dd ? [at[0] + dd[0], at[1] + dd[1]] : null, at);
      } else {
        const shape = newShape(c.master);
        let t = c.t;
        if(dd){ const at = handlePos(e0, h); t = closestPoint(shape, point(at[0] + dd[0], at[1] + dd[1])).t; tNew.set(c.cid, t); }
        const q = pointAt(shape, t); P = [q.x, q.y];
      }
      return [P[0] - off[0], P[1] - off[1]];
    }
    /* an outline: the hand moves it (a point dragged, the body shifted) — nothing else ever does */
    function pathSlot(id, e0){
      const dd = shiftOf(id);
      if(dd) return moveEntity(e0, dd[0], dd[1]);
      if(op.kind === "drag" && op.id === id) return dragEntity(e0, op.handle, op.target);
      if(op.kind === "reshape" && op.id === id) return op.entity;
      return e0;
    }
    function slot(id, s){
      const e0 = E0.get(id), d = D.get(id) || NONE;
      if(isWhole(e0)) return pathSlot(id, e0);
      if(isRigid(e0)) return rigidSlot(id, e0, d, s);
      const dd = shiftOf(id);
      if(d.pin[s]){
        if(dd) throw new Error(`${id} đang bám ${describe(C0.get(d.pin[s]).master)} — kéo đầu tự do hoặc cái nó bám`);
        return pinnedPoint(id, s, C0.get(d.pin[s]));
      }
      if(dd) return [e0[s][0] + dd[0], e0[s][1] + dd[1]];
      if(e0.type === "curve"){
        if(s === "c1" || s === "c2") return curveHandle(id, e0, d, s);
        return dragOf(id, s) ? dragOf(id, s).slice() : e0[s];
      }
      const driven = d.dir.line || d.len;
      if(driven){
        const piv = swap && swap.id === id ? swap.pivot : pivotOf(d), far = piv === "a" ? "b" : "a";
        if(s === far) return lineFar(id, e0, d, piv, far);
      }
      if(dragOf(id, s)) return dragOf(id, s).slice();
      const dim = dimOf(id);
      if(dim && !driven) return setEntityDim(e0, dim.dim, dim.value, {keep: d.pin.a ? "a" : d.pin.b ? "b" : (dim.keep || "a")})[s];
      return e0[s];
    }

    for(const k of order){
      const [id, s] = unkey(k), old = slotValue(E0.get(id), s);
      if(!seeds.has(k) && ![...G.deps.get(k)].some(x => dirty.has(x))){ S.set(k, old); continue; }
      const v = slot(id, s);
      S.set(k, v);
      if(!sameVal(v, old)) dirty.add(k);
    }
    const E1 = new Map(), changed = [];
    for(const [id, e0] of E0){
      if(!slotsOf(e0).some(s => dirty.has(key(id, s)))){ E1.set(id, e0); continue; }
      E1.set(id, freeze(rebuild(newEnt(id))));
      changed.push(id);
    }
    const C1 = new Map(C0);
    for(const [cid, t] of tNew) C1.set(cid, freezeC({...C0.get(cid), t}));
    for(const [cid, f] of edgeNew) C1.set(cid, freezeC({...C0.get(cid), ...f}));
    for(const c of C1.values()){
      const err = residual(c, E1, C1);
      if(!(err <= TOL)) throw new Error(`không giữ được ${c.type} (${describe(c.driven || c.on)} lệch ${err} mm)`);
    }
    return {E1, C1, changed};
  }

  /* how far a relation is from holding, in mm, on finished shapes */
  function residual(c, E, C){
    const pointOf = r => r.point || handlePos(E.get(r.id), r.handle);
    const shapeOf = r => r.shape || entityShape(E.get(r.id));
    if(c.type === "coincident"){
      const p = handlePos(E.get(c.driven.id), c.driven.handle);
      return isCopy(c) ? dist(p, pointOf(c.master)) : closestPoint(shapeOf(c.master), point(p[0], p[1])).dist;
    }
    if(c.type === "horizontal" || c.type === "vertical"){
      const ax = c.type === "horizontal" ? 1 : 0, e = E.get(c.on.id);
      if(e.type === "line") return Math.abs(e.b[ax] - e.a[ax]);
      return Math.abs(e[c.on.handle][ax] - e[c.on.handle === "c1" ? "p0" : "p3"][ax]);
    }
    if(c.type === "tangent"){
      const e = E.get(c.driven.id), via = C.get(c.via);
      const t = via.master.handle !== undefined ? (via.master.handle === "a" || via.master.handle === "p0" ? 0 : 1) : via.t;
      const q = tangentAt(shapeOf(c.master), t), u = [c.sign*q.x, c.sign*q.y];
      const v = e.type === "line" ? sub(e[c.end === "a" ? "b" : "a"], e[c.end]) : sub(e[c.end === "p0" ? "c1" : "c2"], e[c.end]);
      return dot(v, u) > 0 ? Math.abs(cross(v, u)) : Infinity;
    }
    const e = E.get(c.driven.id);
    if(e.type === "line") return Math.abs(dist(e.a, e.b) - (c.master.shape ? length(c.master.shape) : length(entityShape(E.get(c.master.id)))));
    const m = E.get(c.master.id);
    if(e.type === "circle") return Math.abs(e.d - m.d);
    if(e.type === "rect") return Math.max(Math.abs(e.w - m.w), Math.abs(e.h - m.h));
    return Math.abs(e.size - m.size);
  }

  /* ── declaring a relation: checked, then its follower is worked out ──────────── */
  function build(type, first, second, cid){
    if(!CONSTRAINT_TYPES.includes(type))
      throw new Error(`quan hệ chưa có: "${type}" — hiện có ${CONSTRAINT_TYPES.join(" · ")} (sketch.md G15)`);
    const ref = (r, what) => { if(!r || typeof r !== "object") throw new Error(`${what} không hợp lệ: ${JSON.stringify(r)}`); return r; };
    const handleOf = (r, e) => { if(!handlePos(e, r.handle)) throw new Error(`tay nắm không có: ${e.type} không có "${r.handle}"`); };
    if(type === "horizontal" || type === "vertical"){
      const r = ref(first, "hình"), e = need(r.id);
      if(e.type === "line" && r.handle === undefined) return {cid, type, on: {id: r.id}};
      if(e.type === "curve" && (r.handle === "c1" || r.handle === "c2")){
        if(dist(e[r.handle], e[r.handle === "c1" ? "p0" : "p3"]) <= EPS) throw new Error("tay nắm dài 0 không có hướng — kéo control point ra trước");
        return {cid, type, on: {id: r.id, handle: r.handle}};
      }
      throw new Error(`${type} chỉ áp cho một Line, hoặc tay nắm c1/c2 của một Curve — không cho ${e.type}${r.handle ? "." + r.handle : ""}`);
    }
    const m = ref(first, "hình chủ"), f = ref(second, "hình bám");
    const D = need(f.id);
    if(m.id !== undefined){ need(m.id); if(m.id === f.id) throw new Error(`${type} lên chính nó — cần hai hình khác nhau`); }
    else if(!m.point && !m.shape) throw new Error(`hình chủ không hợp lệ: ${JSON.stringify(m)}`);
    if(m.point) checkPt(m.point, "điểm DXF");
    if(type === "coincident"){
      if(D.type === "path") throw new Error("đường viền không làm bên bám — nó là chủ của notch và của hình bám vào nó; kéo đỉnh của nó (sketch.md O14)");
      if(D.type === "polyline") throw new Error("Đường của Bút không làm bên bám — nó là chủ của hình bám vào nó; kéo điểm của nó (sketch.md L9)");
      if(f.handle === undefined) throw new Error("Coincident: bên bám phải là một điểm (đầu mút, góc, đỉnh, tâm)");
      handleOf(f, D);
      if(!isDrivenHandle(D, f.handle)) throw new Error(`${D.type}.${f.handle} không phải điểm để bám (control point không nằm trên hình)`);
      const c = {cid, type, master: m.point ? {point: [m.point[0], m.point[1]]} : m.shape ? {shape: m.shape} : m.handle !== undefined ? {id: m.id, handle: m.handle} : {id: m.id},
                 driven: {id: f.id, handle: f.handle}};
      if(m.handle !== undefined){
        const M = need(m.id); handleOf(m, M);
        if(!isMasterHandle(M, m.handle)) throw new Error(`${M.type}.${m.handle} không phải điểm để bám (control point không nằm trên hình)`);
      }
      if(!isCopy(c)){
        const p = handlePos(D, f.handle), s = m.shape || entityShape(need(m.id));
        c.t = closestPoint(s, point(p[0], p[1])).t;
        if(m.id !== undefined && need(m.id).type === "path"){                        // on an outline: its edge and share (O16)
          const M = need(m.id), loc = outlineLocate(M.pts, M.kinds, p);
          c.from = loc.from; c.to = loc.to; c.share = loc.share;
        }
      }
      return c;
    }
    if(type === "equal"){
      const M = m.id !== undefined ? need(m.id) : null;
      if(m.point) throw new Error("Equal cần một hình chủ, không phải một điểm");
      if(D.type === "curve") throw new Error("Curve không co giãn theo Equal — chỉ làm hình chủ (sketch.md G12)");
      if(D.type === "point" || isWhole(D))
        throw new Error(`Equal không áp cho ${D.type === "point" ? "notch / điểm (không có kích thước)" : D.type === "path" ? "đường viền" : "Đường của Bút"} (sketch.md O14, L9)`);
      if(D.type === "line"){
        if(M && !["line", "curve"].includes(M.type)) throw new Error(`Equal không ghép được ${M.type} với line — line bằng chiều dài line/curve/đường DXF`);
        return {cid, type, master: M ? {id: m.id} : {shape: m.shape}, driven: {id: f.id}};
      }
      if(!M || M.type !== D.type) throw new Error(`Equal không ghép được ${M ? M.type : "đường DXF"} với ${D.type}`);
      return {cid, type, master: {id: m.id}, driven: {id: f.id}};
    }
    /* tangent: the follower's end must already be held on the master by a Coincident (G11) */
    if(!["line", "curve"].includes(D.type)) throw new Error(`Tangent: bên bám phải là Line hoặc Curve, không phải ${D.type}`);
    const M = m.id !== undefined ? need(m.id) : null;
    if(m.point) throw new Error("Tangent cần một đường chủ, không phải một điểm");
    if(M && !["line", "curve", "circle"].includes(M.type)) throw new Error(`Tangent chỉ với Line · Curve · Circle · đường DXF — không với ${M.type}`);
    const onMaster = c => c.type === "coincident" && c.driven.id === f.id && isEnd(D, c.driven.handle) &&
      (m.shape ? c.master.shape === m.shape : c.master.id === m.id && (c.master.handle === undefined || (M && isEnd(M, c.master.handle))));
    let vias = [...cons.values()].filter(onMaster);
    if(f.handle !== undefined) vias = vias.filter(c => c.driven.handle === f.handle);
    if(!vias.length) throw new Error(`Tangent cần chỗ nối: khai Coincident một đầu của ${f.id} lên ${describe(m)} trước (sketch.md G11)`);
    if(vias.length > 1) throw new Error(`hai đầu của ${f.id} cùng bám ${describe(m)} — chỉ rõ đầu nào (handle)`);
    const via = vias[0], end = via.driven.handle, shape = m.shape || entityShape(M);
    const t = via.master.handle !== undefined ? (via.master.handle === "a" || via.master.handle === "p0" ? 0 : 1) : via.t;
    const q = tangentAt(shape, t);
    const v = D.type === "line" ? sub(D[end === "a" ? "b" : "a"], D[end]) : sub(D[end === "p0" ? "c1" : "c2"], D[end]);
    if(Math.hypot(v[0], v[1]) <= EPS) throw new Error("tay nắm ở chỗ nối dài 0 không có hướng — kéo control point ra trước");
    const k = v[0]*q.x + v[1]*q.y;
    return {cid, type, master: M ? {id: m.id} : {shape: m.shape}, driven: {id: f.id}, end, via: via.cid, sign: k > 0 ? 1 : k < 0 ? -1 : (t === 0 ? -1 : 1)};
  }

  /* the snap targets the sketch itself offers, with what each one is */
  function targets(except){
    const out = {points: [], shapes: [], refs: {points: [], shapes: []}};
    for(const [id, e] of ents){
      if(id === except) continue;
      const s = entitySnap(e);
      s.points.forEach((p, i) => { out.points.push(p); out.refs.points.push({id, handle: s.handles[i]}); });
      s.shapes.forEach(sh => { out.shapes.push(sh); out.refs.shapes.push({id}); });
    }
    return out;
  }
  /* own: false — the caller hands in every target, the other shapes of the sketch too (the Vẽ tool, which knows where
     each shape is SHOWN: a shape of a piece Arrange laid out elsewhere is not where its coordinates say) */
  function combined(except, ext = {}, own = true){
    const t = own ? targets(except) : {points: [], shapes: [], refs: {points: [], shapes: []}};
    for(const p of ext.points || []){ t.points.push(p); t.refs.points.push({point: [p[0], p[1]]}); }
    for(const s of ext.shapes || []){ t.shapes.push(s); t.refs.shapes.push({shape: s}); }
    return t;
  }
  function hit(w, t, tol){
    const r = snapHit(w, t, tol);
    return {kind: r.kind, point: r.point, dist: r.dist,
            ref: r.kind === "free" ? null : r.kind === "point" ? t.refs.points[r.index] : t.refs.shapes[r.index]};
  }
  /* a point beats a line wherever it is; between two of a kind, the nearer (B1, B5) */
  function better(a, b){
    if(!b) return true;
    if((a.kind === "point") !== (b.kind === "point")) return a.kind === "point";
    return a.dist < b.dist;
  }

  function commit(r){ ents = r.E1; cons = r.C1; }
  function run(op){ const r = evaluate(ents, cons, op); commit(r); return r; }
  const refuse = err => ({ok: false, reason: err.message || String(err), snap: null, changed: []});

  const sk = {
    add(entity, meta = {}){
      if(!entity || !(ENTITY_TYPES.includes(entity.type) || PIECE_ENTITY_TYPES.includes(entity.type) || PEN_ENTITY_TYPES.includes(entity.type))) throw new Error(`hình không hợp lệ: ${entity && entity.type}`);
      const id = meta.id !== undefined ? String(meta.id) : `e${++seq}`;
      if(ents.has(id)) throw new Error(`đã có hình ${id}`);
      ents = new Map(ents).set(id, freeze(rebuild(entity)));
      return id;
    },
    get: id => ents.get(id) || null,
    ids: () => [...ents.keys()],
    remove(id){
      if(!ents.has(id)) return {ok: false, reason: `hình không có: ${id}`};
      const uses = c => [c.on, c.master, c.driven].some(r => r && r.id === id);
      const gone = new Set([...cons.values()].filter(uses).map(c => c.cid));
      for(const c of cons.values()) if(c.type === "tangent" && gone.has(c.via)) gone.add(c.cid);
      const E = new Map(ents); E.delete(id);
      ents = E; cons = new Map([...cons].filter(([cid]) => !gone.has(cid)));
      return {ok: true, removed: [...gone]};
    },

    constrain(type, first, second){
      try{
        const c = freezeC(build(type, first, second, `c${cseq + 1}`));
        const C1 = new Map(cons).set(c.cid, c);
        const id = c.type === "horizontal" || c.type === "vertical" ? c.on.id : c.driven.id;
        commit(evaluate(ents, C1, {kind: "settle", id}));
        cseq++;
        return {ok: true, cid: c.cid};
      }catch(err){ return {ok: false, reason: err.message}; }
    },
    unconstrain(cid){
      if(!cons.has(cid)) return {ok: false, reason: `không có quan hệ ${cid}`};
      const gone = new Set([cid]);
      for(const c of cons.values()) if(c.type === "tangent" && c.via === cid) gone.add(c.cid);
      cons = new Map([...cons].filter(([k]) => !gone.has(k)));
      return {ok: true, removed: [...gone]};
    },
    constraints: () => [...cons.values()].map(c => ({...c})),

    /* drag a handle to target (mm): snapped first when a tolerance is given (units.md §3), then the
       relations have their say. Refused → {ok: false, reason} and nothing moved. */
    drag(ref, target, {from, targets: ext, tol, own = true} = {}){
      try{
        const e = need(ref && ref.id), h = ref.handle;
        if(h !== "body" && !handlePos(e, h)) throw new Error(`tay nắm không có: ${e.type} không có "${h}"`);
        const T0 = checkPt(target, "đích"), snapping = tol !== undefined && tol !== null;
        const t = snapping ? combined(ref.id, ext, own) : null;
        const d = drivers(cons, ents).D?.get(ref.id) || NONE;
        let snap = null, T = T0, delta = null;
        if(h === "body"){
          if(!from) throw new Error("kéo thân cần chỗ nắm (from)");
          const F = checkPt(from, "chỗ nắm");
          delta = [T0[0] - F[0], T0[1] - F[1]];
          if(snapping){
            let best = null, at = null;
            for(const q of entitySnap(e).points){
              const r = hit([q[0] + delta[0], q[1] + delta[1]], t, tol);
              if(r.kind !== "free" && better(r, best)){ best = r; at = [q[0] + delta[0], q[1] + delta[1]]; }
            }
            snap = best || {kind: "free", point: T0, dist: null, ref: null};
            if(best) delta = [delta[0] + best.point[0] - at[0], delta[1] + best.point[1] - at[1]];
          }
        } else {
          if(snapping){
            snap = h === "c1" || h === "c2" ? {kind: "free", point: T0, dist: null, ref: null} : hit(T0, t, tol);
            if(snap.kind !== "free") T = snap.point.slice();
          }
          if(isRigid(e)){ const at = handlePos(e, h); delta = [T[0] - at[0], T[1] - at[1]]; }
        }
        const lock = cid => ({ok: false, locked: true, snap, changed: [],
                              reason: `${ref.id}${h === "body" ? "" : "." + h} đang bám ${describe(cons.get(cid).master)} — kéo cái nó bám`});
        if(delta && !isRigid(e)){ const p = Object.values(d.pin)[0]; if(p) return lock(p); }
        if(delta && isRigid(e) && d.pos && isCopy(cons.get(d.pos))) return lock(d.pos);
        if(!delta && d.pin[h] && isCopy(cons.get(d.pin[h]))) return lock(d.pin[h]);
        const r = run(delta ? {kind: "shift", id: ref.id, d: delta} : {kind: "drag", id: ref.id, handle: h, target: T});
        return {ok: true, snap, changed: r.changed};
      }catch(err){ return refuse(err); }
    },
    move(id, dx, dy){
      try{
        const e = need(id), d = drivers(cons, ents).D?.get(id) || NONE;
        if(!finite(dx) || !finite(dy)) throw new Error(`độ dời không hợp lệ: ${dx}, ${dy}`);
        const pin = isRigid(e) ? (d.pos && isCopy(cons.get(d.pos)) ? d.pos : null) : Object.values(d.pin)[0];
        if(pin) return {ok: false, locked: true, snap: null, changed: [], reason: `${id} đang bám ${describe(cons.get(pin).master)} — dời cái nó bám`};
        return {ok: true, snap: null, changed: run({kind: "shift", id, d: [dx, dy]}).changed};
      }catch(err){ return refuse(err); }
    },
    setDim(id, dim, value, {keep} = {}){
      try{
        const e = need(id), d = drivers(cons, ents).D?.get(id) || NONE;
        setEntityDim(e, dim, value, keep ? {keep} : {});                     // the number itself (N3)
        if(e.type === "line"){
          if(d.pin.a && d.pin.b) throw new Error(`${id} bám cả hai đầu — Length/Angle không đổi được`);
          if(dim === "length" && d.len) throw new Error(`Length của ${id} đang bằng ${describe(cons.get(d.len).master)} (Equal) — sửa hình chủ`);
          if(dim === "angle" && d.dir.line) throw new Error(`Angle của ${id} đang bị khoá bởi ${cons.get(d.dir.line).type}`);
        } else if(d.dims && !(e.type === "polygon" && dim === "angle"))
          throw new Error(`${dim} của ${id} đang bằng ${describe(cons.get(d.dims).master)} (Equal) — sửa hình chủ`);
        return {ok: true, snap: null, changed: run({kind: "dim", id, dim, value, keep}).changed};
      }catch(err){ return refuse(err); }
    },

    /* an outline replaced by another outline (a point turned from corner to curve, sketch.md §7): what rides
       on it is worked out again — a notch keeps its share of the length (G14) */
    reshape(id, entity){
      try{
        const e = need(id);
        if(!isWhole(e)) throw new Error(`chỉ đường viền và Đường mới đổi dáng kiểu này — ${id} là ${e.type}`);
        if(!entity || entity.type !== e.type) throw new Error(`${e.type === "path" ? "đường viền" : "Đường"} chỉ thay được bằng một ${e.type === "path" ? "đường viền" : "Đường"} — không phải ${entity && entity.type}`);
        return {ok: true, snap: null, changed: run({kind: "reshape", id, entity: freeze(rebuild(entity))}).changed};
      }catch(err){ return refuse(err); }
    },
    check: () => [...cons.values()].map(c => { const err = residual(c, ents, cons); return {cid: c.cid, type: c.type, err, ok: err <= TOL}; }),
    targets,
    shapes: () => [...ents].map(([id, e]) => ({id, type: e.type, shape: entityShape(e)})),
    snapshot: () => ({entities: [...ents], constraints: [...cons], seq, cseq}),
    restore(snap){
      ents = new Map(snap.entities.map(([id, e]) => [id, e]));
      cons = new Map(snap.constraints.map(([cid, c]) => [cid, c]));
      seq = snap.seq; cseq = snap.cseq;
    }
  };
  return sk;
}
