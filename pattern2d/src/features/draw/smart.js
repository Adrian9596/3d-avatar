/* The Bút tool's own rules, as pure functions (spec: draw/smartpen.md) — what a press is on, what a press of the pen does,
   which shape a finished line / a parallel / a compass makes, how the boxes are read and what the label says.

   No geometry rule lives here: edges, parallels, the compass and the rulers are geometry/construct.js, the open line is
   geometry/outline.js through entity.js. Everything arrives where it is SHOWN (Arrange offsets included); the controller
   (smartpen.js) takes a shape into the file frame of the piece it joins. Millimetres. */
import {createLine, createPolyline, createPath, createCircle, entityShape} from "../geometry/entity.js";
import {openSample, outlineSample} from "../geometry/outline.js";
import {polylineEdges, nearestEdge, compassPoint} from "../geometry/construct.js";
import {arc, point, curve, sample, closestPoint} from "../geometry/model.js";
import {parseLength} from "../../shared/units.js";
import {vertsOf, cornersOf, edgesOf} from "../edit/select.js";
import {DBL_MS, DBL_PX} from "./piece.js";
import {thinHandles} from "./flow.js";

/* the POINT layers a drag may start from (B7): turn · notch · grade — not curve points, which cover a curved edge */
export const PEN_POINT_LAYERS = new Set(["2", "4", "5"]);
const SOURCE_TOL = 0.005;                                       // mm — an exact curve seen as a polyline for a parallel
const EPS = 1e-9;
const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const xy = q => [q.x, q.y];

/* ── what a press may be on (B6 · B7) ─────────────────────────────────────────────── */
/* a whole exact path (an ARC, a CIRCLE, a SPLINE, a bulged polyline) as the source of a parallel: one arc stays an arc */
function wholeSource(path){
  const sh = path.shapes || [];
  if(sh.length === 1 && sh[0].kind === "arc"){
    const a = sh[0], full = Math.abs(Math.abs(a.a1 - a.a0) - 2*Math.PI) <= 1e-9;
    return full ? {circle: {c: xy(a.c), r: a.r}} : {arc: {c: xy(a.c), r: a.r, a0: a.a0, a1: a.a1, ccw: a.ccw}};
  }
  const pts = [];
  for(const s of sh) for(const q of sample(s, s.kind === "spline" ? SOURCE_TOL/2 : SOURCE_TOL)){
    if(!pts.length || hyp(q, pts[pts.length - 1]) > EPS) pts.push([q[0], q[1]]);
  }
  if(path.closed && pts.length > 1 && hyp(pts[0], pts[pts.length - 1]) <= EPS) pts.pop();
  return {pts, closed: !!path.closed};
}
/* The targets of a piece of the file as shown: the edges Edit selects (edit/select.js — the corners Edges prints), each as the
   source of a parallel, and the points a drag may start from. A layer that is off gives nothing */
export function fileTargets(piece, layersOn){
  const points = [], edges = [];
  for(const q of piece.points || []) if(layersOn[q.layer] && PEN_POINT_LAYERS.has(q.layer)) points.push({at: [q.x, q.y]});
  (piece.paths || []).forEach(path => {
    if(!layersOn[path.layer]) return;
    const v = vertsOf(path);
    if(v) for(const c of cornersOf(path)) points.push({at: v[c]});
    else if(!path.closed) for(const q of [path.snap[0], path.snap[path.snap.length - 1]]) if(q) points.push({at: [q[0], q[1]]});
    for(const e of edgesOf(path)){
      if(e.whole){ edges.push({src: wholeSource(path)}); continue; }
      if(e.loop){ const pts = e.pts.slice(0, -1); edges.push({src: {pts, closed: true}}); continue; }
      edges.push({src: {pts: e.pts, closed: false}});
    }
  });
  return {points, edges};
}
/* a drawn shape (as shown) seen as a line: a polyline {pts, closed} · a circle · null for a notch */
function drawnLineOf(e){
  if(e.type === "point") return null;
  if(e.type === "circle") return {circle: {c: e.c.slice(), r: e.d/2}};
  if(e.type === "line") return {pts: [e.a.slice(), e.b.slice()], closed: false};
  if(e.type === "path") return {pts: outlineSample(e.pts, e.kinds, SOURCE_TOL).pts, closed: true};
  if(e.type === "polyline") return {pts: openSample(e.pts, e.kinds, SOURCE_TOL).pts, closed: false};
  const s = entityShape(e);                                    // rect · polygon: their vertices; a curve: its samples
  if(s.kind === "curve") return {pts: s.pts.map(q => q.slice()), closed: !!s.closed};
  return {pts: sample(s, SOURCE_TOL/2).map(q => [q[0], q[1]]), closed: false};
}
/* the same for a drawn shape: its edges by the same corner rule (construct.md K1), its corners — and a centre */
export function drawnTargets(e){
  const ln = drawnLineOf(e);
  if(!ln) return {points: [{at: e.p.slice()}], edges: []};
  if(ln.circle) return {points: [{at: ln.circle.c.slice()}], edges: [{src: ln}]};
  const es = polylineEdges(ln.pts, ln.closed);
  const points = [];
  for(const x of es){ for(const q of x.closed ? [] : [x.pts[0], x.pts[x.pts.length - 1]]) if(!points.some(p => hyp(p.at, q) <= EPS)) points.push({at: q.slice()}); }
  if(e.type === "polygon") points.unshift({at: e.c.slice()});
  return {points, edges: es.map(x => ({src: {pts: x.pts, closed: x.closed}}))};
}
/* how far w is from a source, and its foot */
export function srcDist(src, w){
  if(src.circle || src.arc){
    const g = src.circle || src.arc;
    const s = src.circle ? arc(point(g.c[0], g.c[1]), g.r, 0, 2*Math.PI, true) : arc(point(g.c[0], g.c[1]), g.r, g.a0, g.a1, g.ccw);
    const r = closestPoint(s, point(w[0], w[1]));
    return {dist: r.dist, foot: [r.point.x, r.point.y]};
  }
  const n = nearestEdge([{pts: src.pts, closed: src.closed}], w);
  return n ? {dist: n.dist, foot: n.foot} : {dist: Infinity, foot: null};
}
/* the kernel shapes of a source — what a compass meets */
export function srcShapes(src){
  if(src.circle) return [arc(point(src.circle.c[0], src.circle.c[1]), src.circle.r, 0, 2*Math.PI, true)];
  if(src.arc){ const g = src.arc; return [arc(point(g.c[0], g.c[1]), g.r, g.a0, g.a1, g.ccw)]; }
  return [curve(src.pts, src.closed)];
}
/* What a press at w is on (B7 › B6), within r mm (the pick radius): targets: [{points, edges, owner}] — a point first, then
   the nearest edge, else blank. {kind: "point", at, owner} · {kind: "edge", src, dist, foot, owner} · {kind: "blank"} */
export function pressOn(targets, w, r){
  let best = null;
  for(const t of targets) for(const p of t.points){
    const d = hyp(p.at, w);
    if(d <= r && (!best || d < best.dist)) best = {kind: "point", at: p.at.slice(), owner: t.owner, dist: d};
  }
  if(best) return best;
  for(const t of targets) for(const e of t.edges){
    const f = srcDist(e.src, w);
    if(f.dist <= r && (!best || f.dist < best.dist)) best = {kind: "edge", src: e.src, dist: f.dist, foot: f.foot, owner: t.owner};
  }
  return best || {kind: "blank"};
}

/* ── the pen (B2 · B3 · B4 · Q10) ─────────────────────────────────────────────────── */
/* "close" on the first point once there are three; the second press of a double-click (P16) "finish"es an open line — or is
   "few" under two points, or "ignore"d when the first press already closed / finished; else "add" */
export function penStep(pts, w, r, press, prev){
  const dt = prev ? press.t - prev.t : Infinity;
  const dbl = !!prev && dt >= 0 && dt <= DBL_MS && Math.hypot(press.x - prev.x, press.y - prev.y) <= DBL_PX;
  if(dbl && prev.done) return "ignore";
  if(pts.length >= 3 && hyp(w, pts[0]) <= r) return "close";
  if(dbl) return pts.length >= 2 ? "finish" : "few";
  return "add";
}
/* a finished open line: two points a Line, more a Đường (its ends corners) */
export const penShape = (pts, kinds) => pts.length === 2 ? createLine(pts[0], pts[1]) : createPolyline(pts, kinds);
/* the shape of a parallel (B6) — an arc as a Đường of points ON the arc, its chords within 0.005 mm */
export function parallelShape(res){
  const turns = n => Array(n).fill("turn");
  if(res.kind === "line") return createLine(res.pts[0], res.pts[1]);
  if(res.kind === "polyline") return createPolyline(res.pts, turns(res.pts.length));
  if(res.kind === "ring") return createPath(res.pts, turns(res.pts.length));
  if(res.kind === "circle") return createCircle(res.circle.c, 2*res.circle.r);
  const g = res.arc, pts = sample(arc(point(g.c[0], g.c[1]), g.r, g.a0, g.a1, g.ccw), SOURCE_TOL).map(q => [q[0], q[1]]);
  return createPolyline(pts, turns(pts.length));
}
/* B8: where a drag from `start` (a point) ends — onto an edge the compass (R, or the drag's own length); elsewhere a Line to
   the release, R long when R is given. {ok, end, kind: "compass" | "line", R?} or {ok: false, reason} */
export function dragEnd(start, w, {edge = null, R = null, snapped = w} = {}){
  if(edge){
    const radius = R === null ? hyp(w, start) : R;
    const c = compassPoint(start, radius, srcShapes(edge.src), w);
    return c.ok ? {ok: true, kind: "compass", end: c.point, R: radius} : {ok: false, reason: c.reason, nearest: c.nearest, farthest: c.farthest};
  }
  let end = snapped;
  if(R !== null){
    const L = hyp(w, start);
    if(!(L > EPS)) return {ok: false, reason: "kéo ra khỏi điểm để chỉ hướng của đoạn"};
    end = [start[0] + R*(w[0] - start[0])/L, start[1] + R*(w[1] - start[1])/L];
  }
  if(!(hyp(end, start) > EPS)) return {ok: false, reason: "đoạn dài 0 — kéo ra khỏi điểm"};
  return {ok: true, kind: "line", end};
}

/* ── the boxes (B6 · B8 · B11) ─────────────────────────────────────────────────────── */
/* Cách · Compa: empty is "from the pointer" (null), else a length ≥ 0; dx · dy (signed): a length that may be negative —
   a sign in front of anything parseLength reads, so -1/4 is a quarter inch to the left */
export function readOptLength(text, unit, {signed = false} = {}){
  const t = String(text ?? "").trim();
  if(!t) return {ok: true, mm: null};
  let sign = 1, body = t;
  if(t[0] === "+" || t[0] === "-"){ sign = t[0] === "-" ? -1 : 1; body = t.slice(1).trim(); }
  if(sign < 0 && !signed) return {ok: false, error: `khoảng cách không hợp lệ: "${t}" — cần một độ dài ≥ 0`};
  try{ return {ok: true, mm: sign*parseLength(body, unit)}; }catch(e){ return {ok: false, error: e.message}; }
}

/* what a dense Đường shows (Q9) is flow.js's: pickDrawn there thins the same handles paint.js draws */
export {thinHandles};

/* ── the label (B12) ───────────────────────────────────────────────────────────────── */
const TS = ["ngang", "45°", "dọc", "45°", "ngang", "45°", "dọc", "45°"];
const SNAP = {point: "hít điểm", line: "hít đường", curve: "hít đường cong"};
/* L(mm) writes a length in the display unit */
export function labelOf(a, L){
  const tail = (a.snap && SNAP[a.snap] ? ` · ${SNAP[a.snap]}` : "") +
               (a.lock === "tsquare" ? ` · ${TS[a.dir]}` : a.lock === "square" ? ` · ${a.dir < 2 ? "∥" : "⊥"} thước` : "");
  switch(a.kind){
    case "first": return "điểm đầu" + (a.offset ? ` · lệch ${L(a.offset[0])}, ${L(a.offset[1])}` : "") + tail;
    case "point": return (a.curve ? "điểm cong" : "điểm") + tail;
    case "close": return a.piece ? "khép → mảnh" : "khép";
    case "parallel": return `song song · ${L(a.d)}`;
    case "compass": return `compa · ${L(a.R)}`;
    case "line": return `line · ${L(a.len)}`;
    case "square": return "thước tam giác: A → B";
    case "hint": return a.what === "parallel" ? "kéo: song song" : "kéo: compa";
    case "refuse": return a.reason;
  }
  return "";
}
