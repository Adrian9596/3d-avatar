/* The Vẽ tool — TD's table of Line · Curve · Rectangle · Circle · Polygon on the canvas, and a new pattern
   piece drawn in as few operations as it takes (spec: draw/draw.md · draw/piece.md; kernel: geometry/sketch.md).

   Every shape, drag, typed number, snap and relation goes through the proven kernel — entity.js, outline.js
   and sketch.js; the rules of the tool itself are the pure functions of flow.js (shapes) and piece.js (a
   piece). This file is the controller: it holds the drawing and the selection, takes the pointer and the
   keys, keeps undo, and tells the dock (dock.js) and the painter (paint.js) what is true — neither of them
   keeps anything. The pieces drawn here and their pen are pieces.js, bound to this file's state; what goes
   into the file is out.js.

   A drawn shape belongs to a piece of the file (or to none) and keeps the FILE's coordinates; it is drawn
   where Arrange shows its piece. A piece drawn here is a block of its own, and its file frame is the canvas.
   None of it is part of the DXF that is open — Edit and Measure do not see it (draw.md W10, piece.md P8) —
   until Xuất DXF writes it (V13, M10). */
import {isTyping, arrowStep, downloadText} from "../../shared/dom.js";
import {parseAngle} from "../../shared/units.js";
import {Canvas, PICK_PX} from "../canvas/canvas.js";
import {Readout, noteRow, headed} from "../readout/readout.js";
import {createSketch, snapHit} from "../geometry/sketch.js";
import {entityHandles, entityDims} from "../geometry/entity.js";
import {polar} from "../geometry/deform.js";
import {layerMeta} from "../dxf/aama.js";
import {writeDXF, exportName} from "../dxf/write.js";
import {DRAW_LAYERS, DRAW_NUMS, clicksNeeded, shapeFrom, ghostOf, pieceOffset, toFile, toShown, joinTarget, layerApplies,
        shownEntity, pickDrawn, pieceTargets, drawnRows, relationText, junctionOf, shownSel, drawKey, dockGroups, openKey,
        layerRefusal, deletedText, framedTargets, framedRef, frameClash, madeLayer, zoneTargets, placedShapes, thinHandles} from "./flow.js";
import {penCloses, penPress, penNext, penGhost, isClosedShape} from "./piece.js";
import {PieceTool} from "./pieces.js";
import {SmartPen} from "./smartpen.js";
import {withDrawings} from "./out.js";
import {buildDock, MODE_NAME, RELS} from "./dock.js";
import {paintDrawing} from "./paint.js";

const ID_NAME = {line: "Line", curve: "Curve", rect: "Rect", circle: "Circle", polygon: "Poly", path: "Vien", point: "Notch", grain: "Grain", polyline: "Duong"};
const UNDO_MAX = 80;                                              // steps kept — as Edit and Arrange keep

let button = null, dock = null;
let sk = createSketch(), meta = new Map(), seq = 0;              // the shapes: kernel sketch + {pc, layer, piece?, role?} per id —
                                                                  // pc: the piece of the file itself, never its place in the list
let mode = "select", layer = DRAW_LAYERS[0];
let nums = {...DRAW_NUMS};                                        // numbers for the next shape (mm · ° · sides)
let clicks = [], clickPc = null, clickPid = null, clickLayer = null; // the shape being made: its clicks, in its piece's file frame;
                                                                  // the piece it joins — of the file (the piece itself) or drawn
                                                                  // (pid, M17) — and the layer it was started on (V10)
let lastPress = null;                                             // the pen's last press {t, x, y, closed}: a double-click (M2)
let sel = [], active = null;                                      // selected ids · the handle last grabbed
let pending = null;                                               // {kind, driven}: Trùng / Bằng waiting for the master
let gesture = null, hover = null, lastAt = null, lastSnap = null, shiftHeld = false;
let undo = [], note = "", filled = "";
let notchDist = null;                                             // Cách góc (mm), or null: a notch lands at the click (M15)

const on = () => Canvas.activeTool() === "draw";
/* the window pieces.js has on this file's state — it keeps the pieces, this file keeps the drawing */
PieceTool.bind({
  get sk(){ return sk; }, get meta(){ return meta; },
  get sel(){ return sel; }, set sel(v){ sel = v; },
  get active(){ return active; }, set active(v){ active = v; },
  set note(v){ note = v; }, set filled(v){ filled = v; }, set lastAt(v){ lastAt = v; }, get notchDist(){ return notchDist; },
  act: (ctx, fn) => act(ctx, fn), nextId: type => `${ID_NAME[type]}${++seq}`, visible: (ctx, l) => visible(ctx, l)
});
/* the window smartpen.js has on this file's state — the Bút keeps only what is half done (smartpen.md) */
SmartPen.bind({
  get layer(){ return layer; }, set note(v){ note = v; },
  place: (ctx, shape, at) => place(ctx, shape, at),
  target: (ctx, w) => target(ctx, w),
  snapTargets: (ctx, zone) => snapTargets(ctx, zone),
  drawnShown: ctx => placed(ctx.pieces()).filter(d => visible(ctx, d.layer))
                      .map(d => ({id: d.id, shown: shownEntity(sk.get(d.id), pieceOffset(d.m.pc)), pi: d.pi, pid: d.pid})),
  boxError: (...ids) => dock.error(...ids)
});

export const Draw = {
  mount(ctx, ui){
    button = Canvas.toolButton(ui, {id: "draw", label: "Vẽ", tool: "draw",
      title: "Vẽ (V): Line · Curve · Rect · Circle · Polygon · Mảnh · Notch bằng kích thước thật — snap, nhập số, quan hệ; Xuất DXF có cả hình vẽ và mảnh vẽ"}, ctx);
    dock = buildDock(ctx, ui, nums, {
      mode: m => setMode(ctx, m),
      rel: kind => declare(ctx, kind),
      act: a => ({undo: doUndo, delete: doDelete, export: doExport, free: freeShape, move: moveBy,
                  piece: c => PieceTool.toPiece(c), kind: c => PieceTool.toggleKind(c)})[a](ctx),
      layer: v => setLayer(ctx, v),
      typedLine: (input, ev) => typedLine(ctx, input, ev),
      typedDim: (input, dim) => typedDim(ctx, input, dim),
      moveBy: input => moveBy(ctx, input),
      typed: (key, v) => { if(mode !== "select") nums[key] = v; },
      pieceField: (key, value, outline) => PieceTool.setField(ctx, key, value, outline),
      notchDist: v => { notchDist = v; ctx.draw(); },
      penBox: (key, v) => { SmartPen.setBox(key, v); ctx.draw(); }
    });

    Canvas.tool("draw", {cursor: "drawing", onDown, onMove, onUp,
                         onExit(){ clicks = []; PieceTool.clearPen(); SmartPen.clear(); pending = null; gesture = null; hover = null; lastAt = null; lastSnap = null; lastPress = null; }});
    Canvas.layer((root, ppm, c) => paint(root, ppm, c));          // drawn shapes show with the tool off too (W11)
    Canvas.afterDraw(c => sync(c));
    Readout.section(readout);
    ctx.onLoad(() => { sk = createSketch(); meta = new Map(); PieceTool.reset(); SmartPen.reset(); seq = 0; sel = []; active = null; clicks = [];
                       pending = null; gesture = null; undo = []; note = ""; filled = ""; });
    /* one Xuất DXF, whichever button: the file carries the drawing and the pieces drawn (V13, M10) */
    ctx.onExport(model => withDrawings(model, drawnList(model.pieces).filter(d => !d.piece), PieceTool.out()));
    /* a piece of the file deleted or put back (pieces/remove.md R4): its shapes leave the selection with it — they are not
       placed while it is gone — and a shape half made on it is dropped */
    ctx.onPieces(c => {
      const here = new Set(placedShapes(meta, c.pieces()).map(d => d.id));
      sel = sel.filter(id => here.has(id));
      if(active && !here.has(active.id)) active = null;
      if(pending && !here.has(pending.driven.id)) pending = null;
      if(clickPc && !c.pieces().includes(clickPc)){ clicks = []; clickPc = null; }
      SmartPen.piecesChanged(c);
      hover = null; gesture = null; filled = "";
    });
    ctx.key("v", () => Canvas.setTool(on() ? null : "draw", ctx));
    /* from any other tool, or none: Vẽ straight in Mảnh / Notch (piece.md M13); while Vẽ is on, the capture below has them */
    ctx.key("6", ev => openIn(ctx, ev));
    ctx.key("7", ev => openIn(ctx, ev));
    ctx.key("8", ev => openIn(ctx, ev));                          // Bút (smartpen.md B1)

    /* capture: while Vẽ is on these keys are Vẽ's — ⌘Z undoes a Vẽ step, not an Edit or Arrange one (V8) */
    addEventListener("keydown", ev => {
      shiftHeld = ev.shiftKey;
      if(!on() || isTyping(ev)) return;
      const cmd = ev.metaKey || ev.ctrlKey;
      if(cmd && ev.key.toLowerCase() === "z"){ ev.preventDefault(); ev.stopImmediatePropagation(); doUndo(ctx); return; }
      const m = drawKey(ev);
      if(m){ ev.preventDefault(); ev.stopImmediatePropagation(); if(!gesture) setMode(ctx, m); return; }
      if(mode === "piece" && PieceTool.pen().pts.length){       // the pen's own keys (M2)
        if(ev.key === "Enter"){ ev.preventDefault(); ev.stopImmediatePropagation(); PieceTool.close(ctx); return; }
        if(ev.key === "Backspace" || ev.key === "Delete"){ ev.preventDefault(); ev.stopImmediatePropagation(); PieceTool.pop(ctx); return; }
      }
      if(mode === "pen"){                                         // the Bút's own keys (smartpen.md B2 · B3 · B10)
        if((ev.key === "h" || ev.key === "H") && !cmd && !ev.altKey){ ev.preventDefault(); ev.stopImmediatePropagation(); SmartPen.toggleTSquare(ctx); return; }
        if(SmartPen.drawing()){
          if(ev.key === "Enter"){ ev.preventDefault(); ev.stopImmediatePropagation(); SmartPen.finish(ctx); return; }
          if(ev.key === "Backspace" || ev.key === "Delete"){ ev.preventDefault(); ev.stopImmediatePropagation(); SmartPen.pop(ctx); return; }
        }
      }
      /* Delete is Vẽ's while it is on — a drawn shape, never a piece of the file (V9, pieces/remove.md R1) */
      if((ev.key === "Delete" || ev.key === "Backspace") && !cmd){
        ev.preventDefault(); ev.stopImmediatePropagation();
        if(sel.length) doDelete(ctx);
        else { note = "Delete: chọn hình vẽ cần xoá — xoá mảnh của file: tắt Vẽ (V) hay dùng Edit (D), chọn mảnh, Delete"; ctx.draw(); }
        return;
      }
      const d = arrowStep(ev);                                    // mm, as Arrange and Edit nudge (units.md D4)
      if(d && sel.length){
        ev.preventDefault(); ev.stopImmediatePropagation();
        act(ctx, () => moveSelected(d, `dời ${Math.abs(d[0] || d[1])} mm`));
      }
    }, true);
    addEventListener("keyup", ev => { shiftHeld = ev.shiftKey; if(on() && mode === "piece" && PieceTool.pen().pts.length) ctx.draw(); });
  },
  /* for the console: what the drawing holds, and the file Xuất DXF would write */
  shapes: ctx => drawnList((ctx || window.PP.ctx).pieces()).map(d => ({id: d.id, entity: d.entity, pi: d.pi, layer: d.layer, piece: d.piece || null, role: (meta.get(d.id) || {}).role || null})),
  undoCount: () => undo.length,
  pieces: () => PieceTool.records().map(([pid, p]) => ({pid, ...p})),
  sketch: () => sk,
  exportText(ctx){ const r = writeDXF(ctx.exportModel(), {source: ctx.fileName}); return {...r, name: exportName(ctx.fileName)}; }
};

/* the drawn shapes in the drawing now — a shape whose piece of the file was deleted is not (placedShapes, remove.md R4) */
const placed = pieces => placedShapes(meta, pieces).filter(d => sk.get(d.id));
const drawnList = pieces => placed(pieces).map(d => ({id: d.id, entity: sk.get(d.id), pi: d.pi, layer: d.layer, piece: d.pid}));
const visible = (ctx, lay) => ctx.layersOn[lay] !== false;       // a layer the file never had is on
const offOf = (ctx, id) => pieceOffset((meta.get(id) || {}).pc);
const pieceOfShape = id => PieceTool.ofShape(id);
function items(ctx){
  return placed(ctx.pieces()).filter(d => visible(ctx, d.layer)).map(d => ({id: d.id, entity: sk.get(d.id), off: pieceOffset(d.m.pc)}));
}
/* the zone of a drawn shape — {pi, pid} of its piece (V4) — and of the shape being made */
function zoneOf(ctx, id){ const m = meta.get(id); return m ? {pi: m.pc ? ctx.pieces().indexOf(m.pc) : -1, pid: m.piece || null} : null; }
const makingZone = ctx => ({pi: clickPc ? ctx.pieces().indexOf(clickPc) : -1, pid: clickPid});
/* a piece's snap targets as shown, kept per piece until it changes — its revision, its place, the layers on (a drawing of
   10 000 splines is one piece) */
const pcache = new WeakMap();
function pieceSnapsOf(ctx, p){
  const sig = Object.keys(ctx.layersOn).filter(k => ctx.layersOn[k]).sort().join(",") + `|${p.rev || 0}:${p.ox || 0}:${p.oy || 0}`;
  let c = pcache.get(p);
  if(!c || c.sig !== sig){ c = {sig, t: pieceTargets([p], ctx.layersOn, {shown: true})}; pcache.set(p, c); }
  return c.t;
}
/* What a click may snap to, AS IT IS ON SCREEN (V4): for a shape of `zone`, the drawn shapes of that zone and its own piece's
   POINTs, vertices and lines — a shape snaps inside its own piece (TD 2026-09-24: "không hít vào mảnh khác"); zone null is
   everything (the piece pen, M1). `except`: the shape being dragged. A shape being drawn or dragged takes these into its own
   frame (framedTargets) */
function snapTargets(ctx, zone, except = null){
  const drawn = placed(ctx.pieces()).filter(d => visible(ctx, d.layer))
                  .map(d => ({id: d.id, shown: shownEntity(sk.get(d.id), pieceOffset(d.m.pc)), pi: d.pi, pid: d.pid}));
  return zoneTargets(drawn, ctx.pieces(), ctx.layersOn, zone, except, p => pieceSnapsOf(ctx, p));
}

/* ── one undo step per operation ──────────────────────────────────────────────── */
const copyMap = m => new Map([...m].map(([k, v]) => [k, {...v}]));
const state = () => ({sk: sk.snapshot(), meta: copyMap(meta), pieces: PieceTool.snapshot(), sel: sel.slice(), seq});
function restoreState(s){ sk.restore(s.sk); meta = copyMap(s.meta); PieceTool.restore(s.pieces); sel = s.sel.slice(); seq = s.seq; }
const remember = s => { undo.push(s); if(undo.length > UNDO_MAX) undo.shift(); };
function act(ctx, fn){
  const before = state();
  let r;
  try{ r = fn(); }catch(e){ r = {ok: false, reason: e.message}; }
  if(r && r.ok === false){ restoreState(before); note = r.reason; ctx.draw(); return r; }
  remember(before);
  note = (r && r.message) || "";
  ctx.draw();
  return r;
}
function doUndo(ctx){
  const s = undo.pop();
  if(!s){ note = "không còn gì để hoàn tác"; ctx.draw(); return; }
  restoreState(s); active = null; pending = null; clicks = []; PieceTool.clearPen(); SmartPen.clear(); note = "đã hoàn tác"; filled = "";
  ctx.draw();
}
const kernel = r => r.ok ? {ok: true} : {ok: false, reason: r.reason};
const declared = (kind, r) => r.ok ? {ok: true, message: `đã khai ${RELS[kind]}`} : {ok: false, reason: r.reason};

function openIn(ctx, ev){
  const m = ev && openKey(ev);
  if(!m) return;
  if(!on()) Canvas.setTool("draw", ctx);
  setMode(ctx, m);
}
function setMode(ctx, m){
  mode = m; clicks = []; PieceTool.clearPen(); SmartPen.clear(); pending = null; note = ""; filled = ""; lastAt = null;
  if(m !== "select") active = null;
  ctx.draw();
}
/* drawing: the Layer list is the next shape's; choosing: it re-layers the selection (M11, F1) — never a shape of a
   piece onto the cut layer: that piece has its cut line (M6) */
function setLayer(ctx, v){
  const was = layer;
  layer = v;
  if(layerApplies(mode, sel) === "selection"){
    const r = act(ctx, () => {
      for(const id of sel){ const m = meta.get(id), why = m && !m.role && layerRefusal(m, layer); if(why) return {ok: false, reason: why}; }
      for(const id of sel) if(meta.get(id) && !meta.get(id).role) meta.get(id).layer = layer;
      return {ok: true, message: `layer ${layer}`};
    });
    if(r && r.ok === false){ layer = was; ctx.draw(); }
  }
  else { note = mode === "select" ? "" : `hình sau: layer ${layer}`; ctx.draw(); }
}

/* ── numbers ───────────────────────────────────────────────────────────────────── */
/* what the boxes speak for: the next shape of the mode, or the one shape selected */
function context(){
  if(mode !== "select") return {kind: "create", type: mode};
  const e = sel.length === 1 ? sk.get(sel[0]) : null;
  return e ? {kind: "edit", type: e.type, id: sel[0], e} : {kind: "none", type: null};
}
function fillBoxes(ctx){
  const c = context(), p = sel.length === 1 ? pieceOfShape(sel[0]) : null;
  const key = c.kind + ":" + c.type + ":" + (c.id || "") + ":" + (c.e ? JSON.stringify(c.e) : "") + ":" + ctx.shownUnit() + ":" + (p ? JSON.stringify(p) : "");
  if(key === filled) return;
  filled = key;
  dock.fill({kind: c.kind, type: c.type, dims: c.e && c.e.type !== "path" && c.e.type !== "point" ? entityDims(c.e) : null}, nums, p);
}
/* Line: Start clicked, then Length + Angle and Enter makes it (V2); a line selected: Enter sets it (V6);
   the piece pen: the next point along it (M3) — focus stays for the next side */
function typedLine(ctx, input, ev){
  const c = context();
  const error = mode === "piece" || mode === "pen" || (c.kind === "create" && mode === "line")
    ? dock.error("dlen", "dang") : dock.error(input.id);
  if(error){ note = error; ctx.draw(); return; }
  let angle = null;
  const readAngle = () => { angle = parseAngle(document.getElementById("dang").value); return angle; };
  if(mode === "piece" || mode === "pen" || (c.kind === "create" && mode === "line") || (c.kind === "edit" && c.type === "line" && input.id !== "dlen")){
    try{ readAngle(); }catch(e){ note = e.message; ctx.draw(); return; }
  }
  if(mode === "piece"){
    const pts = PieceTool.pen().pts;
    if(!pts.length){ note = "bấm điểm đầu của mảnh trước, rồi gõ Length + Angle cho từng cạnh"; ctx.draw(); return; }
    let p;
    try{ p = penNext(pts[pts.length - 1], dock.F.dlen.field.mm, angle); }catch(e){ note = e.message; ctx.draw(); return; }
    PieceTool.addPoint(ctx, p, ev && ev.shiftKey);
    input.select();                                               // the next side types over it (M3)
    return;
  }
  if(mode === "pen"){                                             // the Bút: the next point of its line (smartpen.md B5)
    SmartPen.typedNext(ctx, dock.F.dlen.field.mm, angle, ev && ev.shiftKey);
    input.select();
    return;
  }
  if(c.kind === "create" && mode === "line"){
    if(clicks.length !== 1){ note = "bấm Start trước, rồi gõ Length + Angle và Enter"; ctx.draw(); return; }
    let shape;
    try{ shape = shapeFrom("line", clicks, {...nums, len: dock.F.dlen.field.mm, lineAngle: angle}, {typed: true}); }
    catch(e){ note = e.message; ctx.draw(); return; }
    make(ctx, shape);
    input.blur();                                                 // done once: 0–7 are shortcuts again (M11, F8)
    return;
  }
  if(c.kind === "edit" && c.type === "line"){
    if(input.id === "dlen") act(ctx, () => kernel(sk.setDim(c.id, "length", dock.F.dlen.field.mm)));
    else act(ctx, () => kernel(sk.setDim(c.id, "angle", angle)));
    filled = ""; input.blur();
  }
}
function typedDim(ctx, input, dim){
  const c = context();
  if(c.kind !== "edit" || input.hasAttribute("aria-invalid")) return;
  if(dim === "angle" && c.type !== "polygon") return;
  let v;
  try{ v = dim === "angle" ? parseAngle(input.value) : dock.F[input.id].field.mm; }catch(e){ note = e.message; ctx.draw(); return; }
  act(ctx, () => kernel(sk.setDim(c.id, dim, v)));
  filled = ""; input.blur();
}
/* a nudge or Dời: every shape selected by d — and a drawn piece's cut line takes its piece along, as a drag of it does (M9) */
function moveSelected(d, message){
  for(const id of sel){
    const r = sk.move(id, d[0], d[1]);
    if(!r.ok) return {ok: false, reason: r.reason};
    const c = PieceTool.carryBy(id, d, sel);
    if(!c.ok) return {ok: false, reason: c.reason};
  }
  return {ok: true, message};
}
function moveBy(ctx, input){
  if(!sel.length){ note = "chọn hình cần dời"; ctx.draw(); return; }
  const error = dock.error("ddist");
  if(error){ note = error; ctx.draw(); return; }
  const dir = document.getElementById("ddir");
  let deg;
  try{ deg = parseAngle(dir.value); dir.removeAttribute("aria-invalid"); }
  catch(e){ dir.setAttribute("aria-invalid", "true"); note = e.message; ctx.draw(); return; }
  const dist = dock.F.ddist.field.mm;
  act(ctx, () => moveSelected(polar(dist, deg), `đã dời ${ctx.len(dist)} theo ${deg}°`));
  if(input && input.blur) input.blur();
}
/* Delete: the shapes selected with their relations; a piece's cut line takes the whole piece with it (M9) — and it says
   what went, and which shapes stopped hanging on what went (V9) */
function doDelete(ctx){
  if(!sel.length) return;
  act(ctx, () => {
    const r = PieceTool.remove(sel);
    sel = []; active = null;
    return {ok: true, message: deletedText(r)};
  });
}
function doExport(ctx){
  try{
    const {text, stats} = writeDXF(ctx.exportModel(), {source: ctx.fileName});
    const name = exportName(ctx.fileName);
    const drawings = drawnList(ctx.pieces()).filter(d => !d.piece);
    const openCut = drawings.filter(d => d.layer === "1").length;
    const noGrain = PieceTool.missingGrain(), bad = PieceTool.problems();
    downloadText(text, name);
    note = `đã xuất ${name} — ${PieceTool.count()} mảnh vẽ, ${drawings.length} hình vẽ, ${stats.pieces} block; file gốc không đổi` +
           (openCut ? ` · ⚠ ${openCut} đường layer 1 chưa thành mảnh` : "") + (noGrain.length ? ` · ⚠ thiếu canh sợi: ${noGrain.join(", ")}` : "") +
           (bad.length ? ` · ⚠ ${bad.join(" · ")}` : "");
  }catch(e){ note = e.message; }
  ctx.draw();
}

/* ── relations (V7) ────────────────────────────────────────────────────────────── */
function declare(ctx, kind){
  const id = sel.length === 1 ? sel[0] : null, e = id && sk.get(id);
  if(!e){ note = `${RELS[kind]}: chọn đúng một hình trước`; ctx.draw(); return; }
  if(kind === "horizontal" || kind === "vertical"){
    const h = active && active.id === id && (active.handle === "c1" || active.handle === "c2") ? active.handle : null;
    if(e.type !== "line" && !(e.type === "curve" && h)){ note = `${RELS[kind]}: chọn một Line, hoặc nắm control point của Curve`; ctx.draw(); return; }
    act(ctx, () => declared(kind, sk.constrain(kind, h ? {id, handle: h} : {id})));
    return;
  }
  if(kind === "tangent"){
    const end = active && active.id === id && ["a", "b", "p0", "p3"].includes(active.handle) ? active.handle : undefined;
    const js = junctionOf(sk.constraints(), id, end);
    if(!js.length){ note = `Tiếp tuyến: đầu của ${id} chưa bám vào đâu — khai Trùng ở chỗ nối trước`; ctx.draw(); return; }
    if(js.length > 1){ note = "Tiếp tuyến: hai đầu cùng bám — nắm đầu cần tiếp tuyến rồi bấm lại"; ctx.draw(); return; }
    act(ctx, () => declared("tangent", sk.constrain("tangent", js[0].master, {id, handle: js[0].end})));
    return;
  }
  if(kind === "coincident"){
    let h = active && active.id === id ? active.handle : null;
    if(!h && (e.type === "circle" || e.type === "polygon")) h = "c";                   // a round shape: its centre
    if(!h && e.type === "point") h = "p";
    if(!h || h === "body" || h === "c1" || h === "c2"){ note = "Trùng: nắm điểm bám trước — đầu mút, góc hay tâm"; ctx.draw(); return; }
    pending = {kind, driven: {id, handle: h}};
  } else pending = {kind, driven: {id}};
  note = `${RELS[kind]}: giờ bấm ${kind === "coincident" ? "điểm hay đường" : "hình"} làm chủ · Esc thôi`;
  ctx.draw();
}
/* the click that names the master: a point first, then a line or curve — drawn or DXF (W6) */
function pickMaster(ctx, w){
  const p = pending; pending = null;
  const m = meta.get(p.driven.id);
  if(!m || !sk.get(p.driven.id)){ note = "hình bám không còn"; ctx.draw(); return true; }
  /* picked where things are shown, inside the zone of the shape that hangs on it (V7 — each piece its own zone); a DXF master
     is a snapshot there, taken into the frame of that shape */
  const off = pieceOffset(m.pc);
  const radius = Math.max(ctx.snapTol() || 0, Canvas.pickMM());
  const hitIn = t => {
    if(p.kind === "coincident"){
      const r = snapHit(w, t, radius);
      return r.kind === "point" ? t.refs.points[r.index] : r.kind !== "free" ? t.refs.shapes[r.index] : null;
    }
    const r = snapHit(w, {points: [], shapes: t.shapes}, radius);
    return r.kind !== "free" ? t.refs.shapes[r.index] : null;
  };
  const ref = hitIn(snapTargets(ctx, zoneOf(ctx, p.driven.id), p.driven.id));
  if(!ref){
    note = hitIn(snapTargets(ctx, null, p.driven.id))
      ? `${RELS[p.kind]}: thứ vừa bấm thuộc mảnh khác — chủ phải cùng mảnh với ${p.driven.id} (mỗi mảnh một vùng riêng); bấm ${RELS[p.kind]} lại rồi bấm hình chủ trong mảnh đó`
      : `${RELS[p.kind]}: không bấm trúng gì — bấm ${RELS[p.kind]} lại rồi bấm hình chủ`;
    ctx.draw(); return true;
  }
  if(ref.id !== undefined && frameClash(m, meta.get(ref.id), ctx.pieces())){
    note = `${RELS[p.kind]}: ${ref.id} và ${p.driven.id} đang hiện lệch nhau so với trên file (Arrange đã dời mảnh của một trong hai) — quan hệ giữ theo file nên trên màn hình sẽ không trùng; Reset Arrange rồi khai`;
    ctx.draw(); return true;
  }
  const master = framedRef(ref, off);
  act(ctx, () => declared(p.kind, sk.constrain(p.kind, master, p.driven)));
  return true;
}
function freeShape(ctx){
  const id = sel.length === 1 ? sel[0] : null;
  if(!id){ note = "Gỡ: chọn đúng một hình"; ctx.draw(); return; }
  const mine = sk.constraints().filter(c => (c.on && c.on.id === id) || (c.driven && c.driven.id === id));
  if(!mine.length){ note = `${id} không bám theo quan hệ nào`; ctx.draw(); return; }
  act(ctx, () => { for(const c of mine) sk.unconstrain(c.cid); return {ok: true, message: `đã gỡ ${mine.length} quan hệ — hình đứng yên`}; });
}

/* ── the pointer ───────────────────────────────────────────────────────────────── */
/* A shape into the drawing, one undo step: a closed shape on the cut layer is a new piece (M5); the rest is a shape of its
   piece — of the file (pc, the piece itself), drawn here (pid, M17) — or of its own. `done` runs inside the step, after it
   is added. The shape makers of Vẽ and the Bút (smartpen.md) both come through here */
function place(ctx, shape, {pc = null, pid = null, layer: lay}, done = () => {}){
  if(lay === "1" && isClosedShape(shape)) return act(ctx, () => PieceTool.make(ctx, shape));
  const r = act(ctx, () => {
    const id = `${ID_NAME[shape.type]}${++seq}`;
    sk.add(shape, {id}); meta.set(id, pid ? {pc: null, layer: lay, piece: pid} : {pc, layer: lay});
    sel = [id]; active = null; done();
    return {ok: true, message: `đã vẽ ${id}` + (pid ? ` — vào ${PieceTool.name(pid)}` : pc ? ""
                                                : lay === "1" ? " — đường cắt hở: chưa là mảnh (M6)" : " — hình vẽ riêng (không thuộc mảnh nào)")};
  });
  filled = "";
  return r;
}
function make(ctx, shape){
  /* its layer is the one it was started on (madeLayer): it chose the piece */
  const lay = madeLayer({clicks: clicks.length, first: clickLayer, now: layer});
  if(lay === "1" && isClosedShape(shape)){ act(ctx, () => PieceTool.make(ctx, shape)); clicks = []; lastAt = null; return; }
  place(ctx, shape, {pc: clickPc, pid: clickPid, layer: lay}, () => { clicks = []; lastAt = null; });
}
/* Pointer-defined lines/curves do not consume the numerical length/angle boxes. */
function creationError(){
  const ids = {rect: ["dw", "dh"], circle: ["dd"], polygon: ["dsize", "dsides", "dpang"]};
  return dock.error(...(ids[mode] || []));
}
function onDown(ev, w, ctx){
  if(ev.button === 1 || ev.altKey || !ctx.model) return false;
  if(pending) return pickMaster(ctx, w);
  if(mode === "pen") return SmartPen.onDown(ev, w, ctx);         // the Bút decides what a press is (smartpen.md)
  if(mode === "notch"){
    const error = dock.error("dcorner");
    if(error){ note = error; lastAt = null; lastSnap = null; ctx.draw(); }
    else PieceTool.placeNotch(ctx, w);
    return true;
  }
  if(mode === "piece"){
    /* a press on the first point closes the pen, and so does the second press of a double-click (M2); the pen snaps to all
       that is shown — a new piece is no piece yet (V4, M1) */
    const press = {t: ev.timeStamp, x: ev.clientX, y: ev.clientY};
    const what = penPress(PieceTool.pen().pts, w, Canvas.pickMM(), press, lastPress);
    if(what === "ignore"){ lastPress = null; return true; }
    if(what === "few"){ lastPress = null; note = "mảnh cần ít nhất 3 điểm"; ctx.draw(); return true; }
    if(what === "close"){ PieceTool.close(ctx); lastPress = {...press, closed: !PieceTool.pen().pts.length}; return true; }
    const r = snapHit(w, snapTargets(ctx, null), ctx.snapTol());
    PieceTool.addPoint(ctx, r.point, ev.shiftKey);
    lastPress = {...press, closed: false};
    return true;
  }
  const hit = pickDrawn(items(ctx), w, Canvas.pickMM(), sel);
  /* while drawing, a click draws — onto the end of the line just made too (it snaps there); only the control
     points of the curve just made are taken by the hand: "Start → End → kéo control point" */
  const own = hit && sel.includes(hit.id) && (mode === "select" ? hit.handle !== "body" : hit.handle === "c1" || hit.handle === "c2");
  if(own || (mode === "select" && hit)){
    if(mode === "select" && ev.shiftKey){ sel = sel.includes(hit.id) ? sel.filter(x => x !== hit.id) : sel.concat([hit.id]); note = ""; ctx.draw(); return true; }
    if(!sel.includes(hit.id)){ sel = [hit.id]; note = ""; }   // the message was about the shape before
    active = hit.handle !== "body" ? {id: hit.id, handle: hit.handle} : active && active.id === hit.id ? active : null;
    gesture = {id: hit.id, handle: hit.handle, w0: w, started: false, base: null, last: null};
    ctx.draw();
    return true;
  }
  if(mode === "select"){ if(!ev.shiftKey){ sel = []; active = null; note = ""; } ctx.draw(); return false; }
  /* a click of a shape being made: snapped, in the frame of the piece it will join */
  const error = creationError();
  if(error){ note = error; lastAt = null; lastSnap = null; ctx.draw(); return true; }
  if(!clicks.length){ const t = target(ctx, w); clickPc = t.pi >= 0 ? ctx.pieces()[t.pi] : null; clickPid = t.pid; clickLayer = layer; }
  const s = snapCursor(ctx, w);
  clicks.push(s.file);
  let shape = null;
  try{ shape = shapeFrom(mode, clicks, nums); }catch(e){ clicks.pop(); note = e.message; ctx.draw(); return true; }
  if(shape) make(ctx, shape); else { note = ""; ctx.draw(); }
  return true;
}
/* the piece a shape started at w would join (V11, M17) — the zone the press is in; a drawn piece's frame is the canvas */
const target = (ctx, w) => joinTarget(layer, ctx.pieces(), ctx.primary, w, PieceTool.targets(), Canvas.pickMM());
/* a click of a shape being made: snapped to what is on screen inside the piece it joins (V4), kept in that piece's frame */
function snapCursor(ctx, w){
  const zone = clicks.length ? makingZone(ctx) : target(ctx, w);
  const off = pieceOffset(zone.pi >= 0 ? ctx.pieces()[zone.pi] : null);
  const r = snapHit(w, snapTargets(ctx, zone), ctx.snapTol());
  return {file: toFile(r.point, off), shown: r.point, kind: r.kind, off};
}
function onMove(ev, w, ctx){
  if(gesture){
    if(!gesture.started){
      if(!Canvas.dragged(gesture.w0, w)) return;
      gesture.base = state(); gesture.last = gesture.base.sk; gesture.started = true;
      remember(gesture.base);
    }
    const off = offOf(ctx, gesture.id);
    /* every frame from where the drag began: where the shape ends depends on where the pointer is,
       never on the way it went (sketch.md N4) */
    sk.restore(gesture.base.sk);
    /* the targets of the shape's own piece as shown, in the frame of the shape dragged (V4, V5) — the sketch adds none of its
       own (own: false): its other shapes are in their own pieces' frames */
    const frame = framedTargets(snapTargets(ctx, zoneOf(ctx, gesture.id), gesture.id), off);
    let r = sk.drag({id: gesture.id, handle: gesture.handle}, toFile(w, off),
                    {from: toFile(gesture.w0, off), targets: frame, tol: ctx.snapTol(), own: false});
    if(r.ok && gesture.handle === "body"){ const c = PieceTool.carry(gesture.id, gesture.base); if(!c.ok) r = c; }
    if(r.ok){ gesture.last = sk.snapshot(); note = ""; lastSnap = r.snap && r.snap.kind !== "free" ? {kind: r.snap.kind, at: toShown(r.snap.point, off)} : null; }
    else { sk.restore(gesture.last); note = r.reason; }
    ctx.draw();
    return;
  }
  if(mode === "pen"){ SmartPen.onMove(ev, w, ctx); return; }
  if(mode === "piece"){
    const r = snapHit(w, snapTargets(ctx, null), ctx.snapTol());
    lastAt = {file: r.point, shown: r.point, kind: r.kind, off: [0, 0], closing: penCloses(PieceTool.pen().pts, w, Canvas.pickMM()), curve: ev.shiftKey};
    lastSnap = r.kind !== "free" ? {kind: r.kind, at: r.point} : null;
    ctx.draw();
    return;
  }
  if(mode === "notch"){
    const error = dock.error("dcorner");
    if(error){ note = error; lastAt = null; lastSnap = null; ctx.draw(); return; }
    const hit = PieceTool.notchAt(ctx, w);
    lastAt = hit && hit.point ? {notch: hit.point} : hit && hit.error ? {notchErr: PieceTool.notchRefusal(ctx, hit)} : null; lastSnap = null;
    ctx.draw();
    return;
  }
  if(mode !== "select" || pending){
    const error = creationError();
    if(error){ note = error; lastAt = null; lastSnap = null; ctx.draw(); return; }
    if(mode !== "select"){ lastAt = snapCursor(ctx, w); lastSnap = lastAt.kind !== "free" ? {kind: lastAt.kind, at: lastAt.shown} : null; }
    ctx.draw();
    return;
  }
  const h = pickDrawn(items(ctx), w, Canvas.pickMM(), sel);
  const k = h ? h.id + ":" + h.handle : "";
  if(k !== (hover ? hover.id + ":" + hover.handle : "")){ hover = h; ctx.draw(); }
}
function onUp(ev, ctx){
  if(gesture){ const moved = gesture.started; gesture = null; if(moved){ filled = ""; ctx.draw(); } return; }
  if(mode === "pen") SmartPen.onUp(ev, ctx);
}

/* ── the frame: what is on screen, handed to paint.js ─────────────────────────── */
function paint(root, ppm, ctx){
  if(!ctx.model || !meta.size && !on()) return;
  /* every frame, before the readout and the keys see it: a layer just turned off takes its shapes out of
     the selection (V10), and so does a piece of the file deleted (remove.md R4) */
  const here = new Set(placed(ctx.pieces()).map(d => d.id));
  const kept = shownSel(sel, meta, ctx.layersOn).filter(id => here.has(id));
  if(kept.length !== sel.length){
    sel = kept;
    if(active && !sel.includes(active.id)) active = null;
    if(pending && !sel.includes(pending.driven && pending.driven.id)) pending = null;
  }
  const shapes = [];
  for(const d of placed(ctx.pieces())){
    if(!visible(ctx, d.layer)) continue;
    shapes.push({shown: shownEntity(sk.get(d.id), pieceOffset(d.m.pc)), tok: layerMeta(d.layer).tok, layer: d.layer});
  }
  const scene = {shapes, labels: PieceTool.labels(ctx), on: on(), selected: [], hover: null, ghost: null, dots: [], pen: null, snap: lastSnap};
  if(scene.on){
    for(const id of sel){
      const e = sk.get(id); if(!e) continue;
      const shown = shownEntity(e, offOf(ctx, id));
      /* a dense Đường shows its handles thinned, as pickDrawn takes them (smartpen.md Q9) */
      const hs = shown.type === "polyline" ? thinHandles(entityHandles(shown), 2*PICK_PX/ppm) : entityHandles(shown);
      scene.selected.push({shown, handles: hs, active: active && active.id === id ? active.handle : null});
    }
    if(hover && !gesture && !sel.includes(hover.id) && sk.get(hover.id)) scene.hover = shownEntity(sk.get(hover.id), offOf(ctx, hover.id));
    const pen = PieceTool.pen();
    if(mode === "piece" && pen.pts.length){
      scene.pen = {pts: pen.pts, kinds: pen.kinds, closing: !!(lastAt && lastAt.closing)};
      if(lastAt) scene.ghost = lastAt.closing ? PieceTool.closed() : penGhost(pen.pts, pen.kinds, lastAt.file, lastAt.curve || shiftHeld);
    } else if(mode === "notch" && !dock.error("dcorner") && lastAt && lastAt.notch){
      scene.dots = [lastAt.notch];
    } else if(mode === "pen"){
      const s = SmartPen.scene(ctx);
      if(s.pen) scene.pen = {pts: s.pen.pts, kinds: s.pen.kinds, closing: false};
      scene.ghost = s.ghost; scene.dots = s.dots; scene.smart = s;
    } else if(mode !== "select" && mode !== "piece" && mode !== "notch" && lastAt && !pending){
      const gh = ghostOf(mode, clicks, lastAt.file, nums);
      if(gh) scene.ghost = shownEntity(gh, lastAt.off);
      scene.dots = clicks.map(c => toShown(c, lastAt.off));
    }
  }
  paintDrawing(root, ppm, scene);
}

function sync(ctx){
  button.setAttribute("aria-pressed", on()); button.classList.toggle("on", on());
  const np = PieceTool.count();
  const ns = placed(ctx.pieces()).length;                        // shapes of a deleted piece are not counted (remove.md R4)
  if(!on()){ dock.sync({on: false}); Canvas.status("draw", ns ? `Vẽ · ${np ? np + " mảnh · " : ""}${ns} hình` : ""); return; }
  const c = context(), one = sel.length === 1, one1 = one && meta.get(sel[0]);
  const groups = dockGroups({mode, kind: c.kind, type: c.type, count: sel.length, closed: one && isClosedShape(sk.get(sel[0])),
                             piece: !!(one && pieceOfShape(sel[0])), role: one1 ? one1.role || null : null});
  const kindOf = active && sk.get(active.id) && sk.get(active.id).type;
  const canKind = !!((kindOf === "path" || kindOf === "polyline") && active.handle && active.handle[0] === "v");
  dock.sync({on: true, mode, pending, groups, one, selCount: sel.length, undoCount: undo.length, layer: one1 && mode === "select" ? one1.layer : layer, canKind});
  fillBoxes(ctx);
  Canvas.status("draw", `Vẽ · ${MODE_NAME[mode]} · ${np ? np + " mảnh · " : ""}${ns} hình · ${sel.length} chọn` + (undo.length ? ` · ${undo.length} bước` : ""));
}

function readout(ctx){
  if(!on()) return null;
  const L = (v, d, l) => ctx.len(v, d, l);
  const rows = [["Chế độ", MODE_NAME[mode] + (pending ? ` · bấm hình chủ cho ${RELS[pending.kind]}` : ""), false]];
  if(mode === "notch"){
    rows.push(["Cách góc", dock.error("dcorner") || (notchDist === null ? "— (notch rơi đúng chỗ bấm)" : `${ctx.len(notchDist)} dọc đường cắt, từ góc gần chỗ bấm`), false]);
    if(lastAt && lastAt.notchErr) rows.push(["Không đặt được", lastAt.notchErr.replace(/^Notch: /, ""), false]);
  }
  if(mode === "pen") rows.push(...SmartPen.rows(ctx));
  if(mode === "piece"){
    const pen = PieceTool.pen(), turns = pen.kinds.filter(k => k === "turn").length;
    rows.push(["Đang vẽ", pen.pts.length ? `${pen.pts.length} điểm · ${turns} góc · ${pen.pts.length - turns} cong` : "bấm điểm đầu", false]);
    if(pen.pts.length >= 3) rows.push(["Khép", "bấm điểm đầu hoặc Enter", false]);
  }
  if(sel.length === 1 && sk.get(sel[0])){
    const id = sel[0], m = meta.get(id), p = m.pc, dp = pieceOfShape(id), e = sk.get(id);
    if(dp){
      rows.push(...PieceTool.rows(id, L));
      if(m.role === "grain" || !m.role) rows.push(...(e.type === "point" ? [] : drawnRows(e, L)));
    } else {
      rows.push(["Tên", id, false], ...(e.type === "point" ? [["Hình", "Notch", false]] : drawnRows(e, L)),
                ["Thuộc", p ? (p.blockName || p.name || `mảnh ${ctx.pieces().indexOf(p) + 1}`) : "hình vẽ riêng", false]);
    }
    rows.push(["Layer", `${m.layer} · ${layerMeta(m.layer).name}`, false]);
    const mine = sk.constraints().filter(c => (c.on && c.on.id === id) || (c.driven && c.driven.id === id));
    if(!dp || mine.length) rows.push(["Quan hệ", mine.length ? mine.map(relationText).join(" · ") : "—", false]);
    if(active && active.id === id) rows.push(["Đang nắm", active.handle, false]);
  } else if(sel.length > 1) rows.push(["Đã chọn", `${sel.length} hình`, false]);
  if(clicks.length) rows.push(["Đang vẽ", `${clicks.length}/${clicksNeeded(mode)} cú bấm`, false]);
  if(lastSnap) rows.push(["Snap", lastSnap.kind, false]);
  const ns = placed(ctx.pieces()).length;
  rows.push(["Hình vẽ", PieceTool.count() ? `${PieceTool.count()} mảnh · ${ns} hình` : String(ns), false]);
  if(note) rows.push(noteRow(note));
  /* nobody else claims the panel when no piece is selected: then Vẽ does, so a shape drawn off the
     pieces still shows its numbers (readout.js headed — Measure and Edit do the same) */
  return headed({section: "Vẽ", rows}, ctx.selection.size > 0);
}
