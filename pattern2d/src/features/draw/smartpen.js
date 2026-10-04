/* The Bút controller — the smart pen of the Vẽ tool (spec: draw/smartpen.md).

   One pen, the place and the way of a press decide what it does: a press puts down a point of the line being drawn, a drag
   on an edge makes its parallel, a drag from a point a compass arc or a line, a ⇧ drag a set square; H holds a T-square.
   Before every press and all through a drag the ghost and the label show what will happen (B12) — the ghost and the release
   ask the same functions, so the ghost stands where the shape lands.

   draw.js binds this file to its state once (`SmartPen.bind(env)`), as it binds pieces.js: it keeps the drawing, the
   selection and undo; what lives here is only what is half done — the line being drawn, the rulers, a press not yet released.
   The rules are smart.js; the geometry is construct.js and outline.js. */
import {Canvas, DRAG_PX} from "../canvas/canvas.js";
import {snapHit} from "../geometry/sketch.js";
import {createLine, createPath, moveEntity} from "../geometry/entity.js";
import {parallelOf, squareDirs, TSQUARE_DIRS, lockTo, offsetPoint} from "../geometry/construct.js";
import {pieceOffset, toFile, toShown} from "./flow.js";
import {fileTargets, drawnTargets, pressOn, penStep, penShape, parallelShape, dragEnd, labelOf} from "./smart.js";
import {penNext} from "./piece.js";

const EPS = 1e-9;
const NONE = {pi: -1, pid: null};
let E = null;                                    // draw.js's state, bound once
let line = null;                                 // the line being drawn: {pts (its piece's file frame), kinds, zone, pc, pid, off, layer}
let square = null;                               // the set square (B9): {a, b, dirs} — shown coordinates
let tsq = false;                                 // the T-square (B10), on until H again
let press = null;                                // a press not yet released
let lastPress = null;                            // {t, x, y, done}: the double-click (B3)
let hover = null;                                // where the pointer was last seen (shown) — the way a typed Length goes under a ruler
let preview = null;                              // what the canvas shows: {ghost, label, dots, link, guide, circle}
const box = {dist: null, radius: null, dx: null, dy: null};   // Cách · Compa · dx · dy (mm, or null)

const say = (ctx, text) => { E.note = text; ctx.draw(); };
const L = ctx => (v, d = 1) => ctx.len(v, d);
const pieceOf = (ctx, zone) => zone && zone.pi >= 0 ? ctx.pieces()[zone.pi] || null : null;
/* the targets a press may take, as shown: the pieces of the scope (null = every piece and every drawn shape — layer 1, as
   the piece pen), each with what it belongs to (B6 · B7) */
const fcache = new WeakMap();
function fileTargetsOf(ctx, p){
  const sig = Object.keys(ctx.layersOn).filter(k => ctx.layersOn[k]).sort().join(",") + `|${p.rev || 0}:${p.ox || 0}:${p.oy || 0}`;
  let c = fcache.get(p);
  if(!c || c.sig !== sig){ c = {sig, t: fileTargets(p, ctx.layersOn)}; fcache.set(p, c); }
  return c.t;
}
function targetsIn(ctx, scope){
  const out = [];
  ctx.pieces().forEach((p, pi) => { if(!scope || scope.pi === pi) out.push({...fileTargetsOf(ctx, p), owner: {pi, pid: null}}); });
  for(const d of E.drawnShown(ctx)){
    if(scope && !(d.pi === scope.pi && (d.pid || null) === (scope.pid || null))) continue;
    out.push({...drawnTargets(d.shown), owner: {pi: d.pi, pid: d.pid || null}});
  }
  return out;
}
const lockDirs = () => square ? square.dirs : tsq ? TSQUARE_DIRS : null;
const lockKind = () => square ? "square" : tsq ? "tsquare" : null;
const scopeOf = (zone, layer) => layer === "1" ? null : zone;
const shownPts = () => line ? line.pts.map(q => toShown(q, line.off)) : [];
/* an error in the boxes a press uses — the press does nothing (B11) */
const boxError = (...ids) => E.boxError(...ids);

/* ── where a point of the line goes (B2 · B9 · B10 · B11) ──────────────────────────── */
function placeAt(ctx, w, zone){
  const r = snapHit(w, E.snapTargets(ctx, scopeOf(zone, line ? line.layer : E.layer)), ctx.snapTol());
  const pts = shownPts();
  if(!pts.length){
    const off = box.dx || box.dy ? [box.dx || 0, box.dy || 0] : null;
    return {shown: off ? offsetPoint(r.point, off[0], off[1]) : r.point, snap: r.kind, base: off ? r.point : null, offset: off};
  }
  const dirs = lockDirs();
  if(dirs){
    const k = lockTo(pts[pts.length - 1], w, dirs);
    if(!k) return {error: "con trỏ đang ở điểm vừa đặt — rê ra theo hướng cần đi"};
    return {shown: k.point, snap: "free", lock: lockKind(), dir: k.index};
  }
  return {shown: r.point, snap: r.kind};
}
function addPoint(ctx, shown, curve){
  const p = toFile(shown, line.off), last = line.pts[line.pts.length - 1];
  if(last && Math.hypot(p[0] - last[0], p[1] - last[1]) <= EPS){ say(ctx, "điểm này trùng điểm vừa đặt"); return false; }
  line.pts.push(p); line.kinds.push(curve ? "curve" : "turn");
  E.note = ""; return true;
}
function startLine(ctx, zone){
  const pc = pieceOf(ctx, zone);
  line = {pts: [], kinds: [], zone, pc, pid: zone.pid || null, off: pieceOffset(pc), layer: E.layer};
}

/* ── finishing (B3 · B4) ───────────────────────────────────────────────────────────── */
const where = () => ({pc: line.pc, pid: line.pid, layer: line.layer});
/* the line and its set square go BEFORE the shape is placed — placing draws the frame, and the panel must not still show
   them; a placing refused (a piece with no inside, M16) gives both back */
function finish(ctx){
  if(!line || line.pts.length < 2) return say(ctx, "đường cần ít nhất 2 điểm — bấm thêm, hay Esc");
  const kept = line, sq = square;
  line = null; square = null; preview = null;
  const r = E.place(ctx, penShape(kept.pts, kept.kinds), {pc: kept.pc, pid: kept.pid, layer: kept.layer});
  if(r && r.ok === false){ line = kept; square = sq; ctx.draw(); }
}
function close(ctx){
  const kept = line, sq = square;
  let shape;
  try{ shape = createPath(kept.pts, kept.kinds); }catch(e){ return say(ctx, e.message); }
  line = null; square = null; preview = null;
  const r = E.place(ctx, shape, {pc: kept.pc, pid: kept.pid, layer: kept.layer});
  if(r && r.ok === false){ line = kept; square = sq; ctx.draw(); }
}

/* ── a drag (B6 · B8 · B9) — the preview and the release ask the same question ─────── */
function gesture(ctx, p, w){
  if(p.shift){
    const t = E.snapTargets(ctx, null), a = snapHit(p.w0, t, ctx.snapTol()).point, b = snapHit(w, t, ctx.snapTol()).point;
    if(Math.hypot(b[0] - a[0], b[1] - a[1]) <= EPS) return {error: "thước tam giác: kéo từ A tới một điểm B khác"};
    return {kind: "square", a, b, label: labelOf({kind: "square"}, L(ctx)), guide: [a, b]};
  }
  if(p.target.kind === "edge"){
    const err = boxError("pdist");
    if(err) return {error: err};
    const r = parallelOf(p.target.src, w, box.dist);
    if(!r.ok) return {error: r.reason};
    return {kind: "parallel", shape: parallelShape(r), owner: p.target.owner, label: labelOf({kind: "parallel", d: r.d}, L(ctx))};
  }
  /* from a point: onto a line of the same zone the compass, elsewhere a Line — a line of another zone is refused (V4) */
  const err = boxError("prad");
  if(err) return {error: err};
  const start = p.target.at, r = Canvas.pickMM();
  const mine = pressOn(targetsIn(ctx, p.scope).map(t => ({...t, points: []})), w, r);
  if(mine.kind !== "edge" && p.scope && pressOn(targetsIn(ctx, null).map(t => ({...t, points: []})), w, r).kind === "edge")
    return {error: "compa: đường vừa thả lên thuộc mảnh khác — mỗi mảnh một vùng riêng (V4); thả lên đường của chính mảnh này"};
  const snapped = snapHit(w, E.snapTargets(ctx, p.scope), ctx.snapTol()).point;
  const d = dragEnd(start, w, {edge: mine.kind === "edge" ? mine : null, R: box.radius, snapped});
  if(!d.ok){
    const why = d.nearest !== undefined
      ? `compa ${ctx.len(box.radius === null ? Math.hypot(w[0] - start[0], w[1] - start[1]) : box.radius)} không tới đường — đường cách điểm từ ${ctx.len(d.nearest)} tới ${ctx.len(d.farthest)}`
      : d.reason;
    return {error: why};
  }
  const len = Math.hypot(d.end[0] - start[0], d.end[1] - start[1]);
  return {kind: d.kind, shape: createLine(start, d.end), owner: p.target.owner,
          label: d.kind === "compass" ? labelOf({kind: "compass", R: d.R}, L(ctx)) : labelOf({kind: "line", len}, L(ctx)),
          circle: d.kind === "compass" ? {c: start, r: d.R} : null};
}
function commit(ctx, p, w){
  const g = gesture(ctx, p, w);
  if(g.error) return say(ctx, g.error);
  if(g.kind === "square"){
    square = {a: g.a, b: g.b, dirs: squareDirs(g.a, g.b)}; tsq = false;
    return say(ctx, "thước tam giác: các điểm sau đi song song hay vuông góc với A → B — tới hết đường này");
  }
  /* the shape is as shown: into the file frame of the piece it joins; layer 1 joins none (M6) */
  const layer = E.layer, owner = layer === "1" ? NONE : g.owner, pc = pieceOf(ctx, owner), off = pieceOffset(pc);
  const shape = off[0] || off[1] ? moveEntity(g.shape, -off[0], -off[1]) : g.shape;
  E.place(ctx, shape, {pc, pid: owner.pid || null, layer});
}

/* ── what the canvas shows when no button is down (B12) ──────────────────────────── */
function hoverPreview(ctx, w, shift){
  if(boxError("pdx", "pdy")) return {label: boxError("pdx", "pdy"), dots: []};
  if(line){
    const pts = shownPts();
    if(pts.length >= 3 && Math.hypot(w[0] - pts[0][0], w[1] - pts[0][1]) <= Canvas.pickMM()){
      let ghost = null;
      try{ ghost = createPath(pts, line.kinds); }catch(e){ ghost = null; }
      return {ghost, label: labelOf({kind: "close", piece: line.layer === "1"}, L(ctx)), dots: pts};
    }
    const at = placeAt(ctx, w, line.zone);
    if(at.error) return {label: at.error, dots: pts};
    let ghost = null;
    try{ ghost = penShape([...pts, at.shown], [...line.kinds, shift ? "curve" : "turn"]); }catch(e){ ghost = null; }
    return {ghost, label: labelOf({kind: "point", curve: shift, snap: at.snap === "free" ? null : at.snap, lock: at.lock, dir: at.dir}, L(ctx)),
            dots: pts, at: at.shown};
  }
  const zone = E.target(ctx, w), at = placeAt(ctx, w, zone);
  const t = pressOn(targetsIn(ctx, scopeOf(zone, E.layer)), w, Canvas.pickMM());
  const hint = t.kind === "edge" ? " · " + labelOf({kind: "hint", what: "parallel"}, L(ctx)) : t.kind === "point" ? " · " + labelOf({kind: "hint", what: "compass"}, L(ctx)) : "";
  return {label: labelOf({kind: "first", offset: at.offset, snap: at.snap === "free" ? null : at.snap}, L(ctx)) + hint,
          dots: [at.shown], link: at.base ? [at.base, at.shown] : null, at: at.shown};
}

export const SmartPen = {
  bind(env){ E = env; },
  /* a new file: nothing half done; the boxes keep their numbers (Q8) */
  reset(){ line = null; square = null; press = null; lastPress = null; preview = null; hover = null; },
  /* Esc, another mode, the tool off, ⌘Z (B1) — the T-square stays as it was set (B10) */
  clear(){ line = null; square = null; press = null; preview = null; },
  drawing: () => !!line && line.pts.length > 0,
  setBox(key, mm){ box[key] = mm; },
  /* a piece of the file deleted: a line drawn on it goes with it */
  piecesChanged(ctx){ if(line && line.pc && !ctx.pieces().includes(line.pc)) line = null; },
  toggleTSquare(ctx){
    tsq = !tsq; if(tsq) square = null;
    say(ctx, tsq ? "thước ngang: các điểm sau đi ngang · dọc · 45° — H lần nữa để thôi" : "thước ngang tắt");
  },
  pop(ctx){
    if(!line || !line.pts.length) return;
    line.pts.pop(); line.kinds.pop();
    if(!line.pts.length) line = null;
    say(ctx, line ? `bỏ điểm cuối — còn ${line.pts.length} điểm` : "đã bỏ hết điểm");
  },
  finish,
  /* Length + Angle, Enter: the next point exactly (B5) — under a ruler the way is the ruler's nearest the pointer */
  typedNext(ctx, len, angle, curve){
    if(!line || !line.pts.length) return say(ctx, "bấm điểm đầu của đường trước, rồi gõ Length + Angle cho từng đoạn");
    const last = shownPts()[line.pts.length - 1], dirs = lockDirs();
    let next;
    if(dirs){
      const k = lockTo(last, hover || [last[0] + 1, last[1]], dirs, len);
      if(!k) return say(ctx, "Length phải > 0");
      next = k.point;
    } else {
      /* as the piece pen's typed side (M3): exact on the axes — Angle 90 is dx = 0, not 6e-15 */
      try{ next = penNext(last, len, angle); }catch(e){ return say(ctx, e.message); }
    }
    addPoint(ctx, next, curve);
    preview = null; ctx.draw();
  },

  /* ── the pointer ── a press on a target or with ⇧ is the pen's (the drag is a gesture); a press on nothing is the canvas's,
     so a drag there pans (N6) and a click there is resolved at release */
  onDown(ev, w, ctx){
    if(boxError("pdx", "pdy")){ say(ctx, boxError("pdx", "pdy")); return true; }
    const zone = line ? line.zone : E.target(ctx, w), scope = scopeOf(zone, line ? line.layer : E.layer);
    const target = line || ev.shiftKey ? {kind: "blank"} : pressOn(targetsIn(ctx, scope), w, Canvas.pickMM());
    press = {w0: w, last: w, t: ev.timeStamp, x: ev.clientX, y: ev.clientY, shift: !!ev.shiftKey, target, zone, scope, moved: false,
             claimed: !!ev.shiftKey || target.kind !== "blank"};
    return press.claimed;
  },
  onMove(ev, w, ctx){
    hover = w;
    if(press){
      press.last = w;
      if(!press.moved && Canvas.dragged(press.w0, w)) press.moved = true;
      if(press.claimed && press.moved){
        const g = gesture(ctx, press, w);
        preview = g.error ? {label: g.error, dots: []} : {ghost: g.shape ? g.shape : null, label: g.label, dots: g.circle ? [g.circle.c] : [],
                                                         guide: g.guide || null, circle: g.circle || null};
      }
      ctx.draw(); return;
    }
    preview = hoverPreview(ctx, w, ev.shiftKey);
    ctx.draw();
  },
  onUp(ev, ctx){
    const p = press; press = null;
    if(!p) return;
    const panned = Number.isFinite(ev.clientX) && Number.isFinite(p.x) && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > DRAG_PX;
    if(p.claimed && p.moved){ commit(ctx, p, p.last); preview = null; ctx.draw(); return; }
    if(!p.claimed && (p.moved || panned)) return;                       // that was a pan
    SmartPen.click(ctx, p);
  },
  click(ctx, p){
    if(boxError("pdx", "pdy")) return say(ctx, boxError("pdx", "pdy"));
    const w = p.w0, step = penStep(shownPts(), w, Canvas.pickMM(), {t: p.t, x: p.x, y: p.y}, lastPress);
    const mark = done => { lastPress = {t: p.t, x: p.x, y: p.y, done}; };
    if(step === "ignore"){ lastPress = null; return; }
    if(step === "few"){ lastPress = null; return say(ctx, "đường cần ít nhất 2 điểm — bấm thêm, hay Esc"); }
    if(step === "close"){ close(ctx); mark(true); return; }
    if(step === "finish"){ finish(ctx); mark(true); return; }
    if(!line) startLine(ctx, p.zone);
    const at = placeAt(ctx, w, line.zone);
    if(at.error){ if(!line.pts.length) line = null; return say(ctx, at.error); }
    if(!addPoint(ctx, at.shown, p.shift) && !line.pts.length) line = null;
    mark(false);
    preview = null; ctx.draw();
  },

  /* what paint.js draws for the pen (B12): the ghost, the label by the pointer, the points of the line, the rulers */
  scene(ctx){
    const s = {ghost: null, label: null, dots: [], pen: null, guide: null, link: null, circle: null};
    if(line && line.pts.length) s.pen = {pts: shownPts(), kinds: line.kinds};
    if(square) s.guide = [square.a, square.b];
    if(preview){
      s.ghost = preview.ghost || null; s.dots = preview.dots || []; s.link = preview.link || null; s.circle = preview.circle || null;
      if(preview.guide) s.guide = preview.guide;
      const at = hover || (preview.dots && preview.dots[0]);
      if(preview.label && at) s.label = {at, text: preview.label};
    }
    return s;
  },
  rows(ctx){
    const k = line ? line.kinds.filter(x => x === "curve").length : 0;
    const rows = [["Sắp làm", preview && preview.label ? preview.label : "—", false],
                  ["Hướng", square ? "thước tam giác" : tsq ? "thước ngang" : "tự do", false],
                  ["Đang vẽ", line && line.pts.length ? `${line.pts.length} điểm · ${k} cong` : "0 điểm", false]];
    if(box.dist !== null) rows.push(["Cách", ctx.len(box.dist), false]);
    if(box.radius !== null) rows.push(["Compa", ctx.len(box.radius), false]);
    if(box.dx || box.dy) rows.push(["Lệch", `${ctx.len(box.dx || 0)}, ${ctx.len(box.dy || 0)}`, false]);
    return rows;
  }
};
