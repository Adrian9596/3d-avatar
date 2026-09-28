/* The Edit tool — the four layers of edit/edit.md on the canvas.

   1 Select      a click takes the nearest Point, else Line / Curve, else Piece (select.js);
                 ⇧ adds or drops; the filter limits what a click may take.
   2 Direct      drag to reshape/move; Trim / Extend takes a source then a destination.
                 Split acts on one click, Join on two selected edges (T/X · K · J).
   3 Precise     Length and Angle of the one edge selected, Distance + direction for any
                 selection — typed in the display unit, applied with Enter (ops.js); a Length led by
                 + or − changes the length the edge has.
   4 Constraint  every edit goes through relate.js: seam lines, points on lines and lines
                 touching the cut line follow, by the solver that was already there.

   "Xuất DXF" writes a NEW file (dxf/write.js); nothing here touches the file that was opened.
   Picking is by screen distance (8 px, a choice), snapping a dragged point by the drawing's
   tolerance (units.md §3). */
import {$, el, node, bindLength, isTyping, arrowStep, onEnter, downloadText, inputError} from "../../shared/dom.js";
import {lengthField, formatLength, parseLength, parseAngle} from "../../shared/units.js";
import {Canvas} from "../canvas/canvas.js";
import {Readout, noteRow, headed} from "../readout/readout.js";
import {snapTo} from "../geometry/snap.js";
import {polar} from "../geometry/deform.js";
import {sample, pointAt} from "../geometry/model.js";
import {writeDXF, exportName} from "../dxf/write.js";
import {vertsOf, edgesOf, targetsOf, pickAt} from "./select.js";
import {relate} from "./relate.js";
import {snapPiece, restorePiece, beginEdit, driveEdit, applyMove, applyLength, applyAngle, edgePts, edgeMeasure, movingEnd,
        trimExtendSource, trimExtendLine, splitAt, joinEdges, deleteItems, stepPieces} from "./ops.js";
import {removedText} from "../pieces/remove.js";

let button = null, dock = null, tip = null;
let mode = "drag", filter = "all";
let sel = [], hover = null, pendingLine = null, gesture = null, note = "", exported = null;
let undo = [], prefilled = "";
let lenField = null;                             // a lengthBox: a length, or a change of the selected edge's (P7)
const distField = lengthField({mm: 0, min: 0, max: 100000, d: 2});
let showLen = () => {}, showDist = () => {};

const on = () => Canvas.activeTool() === "edit";
const MODES = {drag: "Kéo", trimExtend: "Trim / Extend", split: "Split"};
const MODE_TITLES = {drag: "Chọn · kéo để sửa dáng · kéo thứ đang chọn để dời",
  trimExtend: "Trim / Extend (T hoặc X) — bấm đường cần sửa, rồi bấm đường đích",
  split: "Split (K) — bấm chỗ cần tách"};
const TIPS = {
  drag: "Bấm chọn Point · Line · Curve · Piece (⇧ thêm) · kéo để sửa · ⌥ kéo để pan · T/X Trim / Extend · K Split · J Join · Delete xoá",
  trimExtend: "1 · Bấm đường cần sửa, gần đầu muốn cắt / kéo dài · 2 · Bấm đường đích · Esc thôi",
  split: "Split: bấm chỗ cần tách · K hoặc Esc để thôi"
};

/* ── pure helpers (edit.test.js) ─────────────────────────────────────────── */
/* The Length box (edit.md P7): a bare length SETS the edge's length; one led by + or − CHANGES the
   length the edge has — base(), asked when the text is read — by that much: "+1/4" a quarter inch
   longer while the display is inch, "-3mm" three millimetres shorter. A length is never negative, so
   a minus has no other meaning here (an angle's has: E17). It answers like a lengthField, so
   bindLength drives it; the bounds are millimetres. */
export function lengthBox(base, {mm = 100, min = 0.001, max = 100000, d = 2} = {}){
  const abs = lengthField({mm, min, max, d});
  return {
    get mm(){ return abs.mm; },
    set(v){ abs.set(v); },
    text: unit => abs.text(unit),
    read(text, unit){
      const m = /^\s*([+-])\s*([\s\S]*)$/.exec(String(text ?? ""));
      if(!m) return abs.read(text, unit);
      try{
        if(/^[+-]/.test(m[2])) throw new Error(`số không hợp lệ: "${text}" — một dấu + hoặc − thôi`);
        const by = parseLength(m[2], unit), L0 = base();
        if(!Number.isFinite(L0)) throw new Error("chọn một cạnh trước — số gia cộng vào chiều dài của cạnh đó");
        const L = m[1] === "+" ? L0 + by : L0 - by, f = v => formatLength(v, unit, {d});
        if(!(L >= min && L <= max))                     // min is 0.001 mm: written in inch it reads "0.0000", say what it means
          throw new Error(`chiều dài không hợp lệ: ${f(L0)} ${m[1] === "+" ? "+" : "−"} ${f(by)} = ${f(L)} — ` + (L < min ? "cạnh phải còn dài hơn 0" : `dài nhất ${f(max)}`));
        abs.set(L);
        return {ok: true, mm: L, error: null};
      }catch(e){ return {ok: false, mm: abs.mm, error: e.message}; }
    }
  };
}
/* The Edit keys (edit.md D11): T/X Trim / Extend · K Split — the same key again goes back to Kéo —
   and J joins the two edges selected. Held with ⌘ · Ctrl · ⌥ a key is the browser's (⌘X, ⌘J) or
   pan's (⌥); typed into a box it is text. */
export const EDIT_KEYS = {t: "trimExtend", x: "trimExtend", k: "split", j: "join"};
export function editKey(ev, mode){
  if(ev.metaKey || ev.ctrlKey || ev.altKey) return null;
  if(ev.target && typeof ev.target.matches === "function" && ev.target.matches("input,select,textarea")) return null;
  const k = EDIT_KEYS[String(ev.key || "").toLowerCase()];
  if(!k) return null;
  return k === "join" ? {act: "join"} : {mode: k === mode ? "drag" : k};
}
export const itemKey = it => [it.pi, it.kind, it.src || "", it.path ?? "", it.v ?? "", it.pt ?? "", it.a ?? "", it.b ?? ""].join(":");
export function groupItems(items){
  const g = new Map();
  for(const it of items){ if(!g.has(it.pi)) g.set(it.pi, []); g.get(it.pi).push(it); }
  return g;
}
const POINT_NAME = {"2": "turn", "3": "curve", "4": "notch", "5": "grade", "11": "drill"};
/* what the readout says about a selection, for a length formatter L(mm, d, label) */
export function selectionRows(pieces, items, L){
  if(!items.length) return [["Chọn", "Point · Line · Curve · Piece", false]];
  if(items.length > 1) return [["Đã chọn", `${items.length} thứ`, true]];
  const it = items[0], p = pieces[it.pi];
  if(!p) return [["Chọn", "—", false]];
  if(it.kind === "piece") return [["Loại", "Piece", true], ["Kích thước", L(p.bbox.w, 1, false) + " × " + L(p.bbox.h), true]];
  if(it.kind === "point"){
    const at = posOf(p, it);
    const what = it.src === "entity" ? "Point · " + (POINT_NAME[p.points[it.pt].layer] || "layer " + p.points[it.pt].layer) : "Point · góc";
    return [["Loại", what, true], ["x", L(at[0]), true], ["y", L(at[1]), true]];
  }
  const kind = (it.kind === "line" ? "Line" : "Curve") + (it.whole ? " (nguyên khối)" : "");
  let m;
  try{ m = edgeMeasure(p, it); }catch(e){ return [["Loại", kind, true]]; }
  return [["Loại", kind, true], ["Dài", L(m.length), true], ["Góc", m.angle === null ? "—" : m.angle.toFixed(2) + "°", true]];
}
/* the length of the one edge selected, for a Length typed as a change (P7) */
function selectedLength(ctx){
  const it = sel.length === 1 && isEdge(sel[0]) ? sel[0] : null, p = it && ctx.pieces()[it.pi];
  if(!p) return NaN;
  try{ return edgeMeasure(p, it).length; }catch(e){ return NaN; }
}
/* where a selected point is NOW (it may have been moved since it was picked) */
function posOf(p, it){
  if(it.src === "entity"){ const q = p.points[it.pt]; return q ? [q.x, q.y] : [NaN, NaN]; }
  const v = vertsOf(p.paths[it.path]);
  return v && v[it.v] ? v[it.v] : [NaN, NaN];
}

/* targets change only when the piece does — or when Arrange moves it, or a layer is switched */
const cache = new WeakMap();
function targetsFn(ctx){
  const key = Object.keys(ctx.layersOn).filter(k => ctx.layersOn[k]).sort().join(",");
  return p => {
    const sig = `${p.rev || 0}|${p.ox || 0}|${p.oy || 0}|${key}`, c = cache.get(p);
    if(c && c.sig === sig) return c.t;
    const t = targetsOf(p, ctx.layersOn);
    cache.set(p, {sig, t});
    return t;
  };
}
/* how many relations the piece holds — read off it once per revision; during a drag, off the
   relations the drag itself keeps (the piece changes every frame, reading it again each time would
   cost a whole relate per pointer move on a big piece) */
const relCache = new WeakMap();
function relationCounts(p, live){
  const sig = `${p.rev || 0}|${p.ox || 0}|${p.oy || 0}`, c = relCache.get(p);
  if(c && c.sig === sig) return c.n;
  let n = null;
  try{
    const r = live || relate(p), kinds = [...r.kind.values()];
    n = {follow: kinds.filter(k => k === "follow").length, reach: kinds.filter(k => k === "reach" || k === "ride").length,
         attach: r.attached.size, free: r.free.size};
  }catch(e){ n = null; }
  relCache.set(p, {sig, n});
  return n;
}

export const Edit = {
  mount(ctx, ui){
    button = Canvas.toolButton(ui, {id: "edit", label: "Edit", tool: "edit",
      title: "Sửa DXF (D): chọn · kéo · Trim / Extend (T hoặc X) · split (K) · join (J) · nhập số — xuất ra file mới"}, ctx);

    buildDock(ctx, ui);
    Canvas.tool("edit", {cursor: "editing", onDown, onMove, onUp, onExit(){ gesture = null; hover = null; pendingLine = null; }});
    Canvas.layer((root, ppm, c) => { if(on()) draw(root, ppm, c); });
    Canvas.afterDraw(c => sync(c));
    Readout.section(readout);
    ctx.onLoad(() => { sel = []; hover = null; pendingLine = null; gesture = null; undo = []; note = ""; exported = null; mode = "drag"; });
    /* a piece deleted or put back: what was selected names places in the list — let it go (pieces/remove.md R5) */
    ctx.onPieces(() => { sel = []; hover = null; pendingLine = null; gesture = null; prefilled = ""; });
    ctx.key("d", () => Canvas.setTool(on() ? null : "edit", ctx));

    /* capture: while Edit is on, ⌘Z undoes an edit, not an Arrange layout */
    addEventListener("keydown", ev => {
      if(!on() || isTyping(ev)) return;
      const cmd = ev.metaKey || ev.ctrlKey;
      if(cmd && ev.key.toLowerCase() === "z"){ ev.preventDefault(); ev.stopImmediatePropagation(); doUndo(ctx); return; }
      const k = editKey(ev, mode);
      if(k){
        ev.preventDefault(); ev.stopImmediatePropagation();
        if(gesture) return;                                      // not in the middle of a drag
        if(k.act === "join") doJoin(ctx); else setMode(ctx, k.mode);
        return;
      }
      if(ev.key === "Escape"){ sel = []; pendingLine = null; setMode(ctx, "drag"); note = ""; return; }
      if((ev.key === "Delete" || ev.key === "Backspace") && !cmd){      // Edit's own: an undo of Edit's (§6b, remove.md R3)
        ev.preventDefault(); ev.stopImmediatePropagation();
        if(!gesture) doDelete(ctx);
        return;
      }
      const d = arrowStep(ev);                            // millimetres, as Arrange nudges (units.md D4)
      if(d && sel.length){
        ev.preventDefault(); ev.stopImmediatePropagation();
        run(ctx, [...groupItems(sel).keys()], () => {
          for(const [pi, items] of groupItems(sel)) applyMove(ctx.pieces()[pi], items, d);
          return {ok: true, message: `dời ${Math.abs(d[0] || d[1])} mm`};
        });
      }
    }, true);
  },
  /* the file Xuất DXF would write, without downloading it — for checking from the console */
  exportText(ctx){ const r = writeDXF(exported_(ctx), {source: ctx.fileName}); return {...r, name: exportName(ctx.fileName)}; }
};

/* ── the bar ────────────────────────────────────────────────────────────── */
function buildDock(ctx, ui){
  dock = node("div", {className: "dock edit", id: "editdock", hidden: true});
  dock.innerHTML =
    `<div class="tip" id="edittip"></div>` +
    `<div class="arrangebar">` +
      `<span class="grp"><select id="editfilter" title="Chỉ chọn loại này">` +
        `<option value="all">Tất cả</option><option value="piece">Piece</option><option value="line">Line</option>` +
        `<option value="point">Point</option><option value="curve">Curve</option></select></span>` +
      `<span class="grp">` + Object.entries(MODES).map(([k, v]) => `<button class="btn" data-mode="${k}" title="${MODE_TITLES[k]}">${v}</button>`).join("") +
        `<button class="btn" data-act="join" title="Nối hai cạnh đang chọn (J)">Join</button></span>` +
      `<span class="grp"><span class="gapf"><label for="elen">Length</label><input id="elen" type="text" inputmode="decimal" autocomplete="off" title="Chiều dài cạnh đang chọn — gõ rồi Enter; +1/4 hay -3mm là dài thêm / ngắn đi; đầu gần chỗ bấm là đầu chạy"><span class="utag" id="elenu"></span></span>` +
        `<span class="gapf"><label for="eang">Angle</label><input id="eang" type="text" inputmode="decimal" autocomplete="off" title="Hướng của cạnh (độ, ngược chiều kim đồng hồ từ +X) — gõ rồi Enter"><span class="utag">°</span></span>` +
        `<button class="btn" data-act="flip" title="Đổi đầu chạy của cạnh">⇄</button></span>` +
      `<span class="grp"><span class="gapf"><label for="edist">Distance</label><input id="edist" type="text" inputmode="decimal" autocomplete="off" title="Dời thứ đang chọn một đoạn — gõ rồi Enter"><span class="utag" id="edistu"></span></span>` +
        `<span class="gapf"><label for="edir">Hướng</label><input id="edir" type="text" inputmode="decimal" autocomplete="off" value="0" title="Hướng dời (độ, ngược chiều kim đồng hồ từ +X)"><span class="utag">°</span></span>` +
        `<button class="btn" data-act="move">Dời</button></span>` +
      `<span class="grp"><button class="btn" data-act="undo" title="Hoàn tác (⌘Z)">↶</button>` +
        `<button class="btn" data-act="export" title="Tải về một file DXF MỚI (AAMA, METRIC) — file gốc không bị đụng tới">Xuất DXF</button></span>` +
    `</div>`;
  ui.stage.appendChild(dock);
  tip = dock.querySelector("#edittip");
  const unit = () => ctx.shownUnit();
  lenField = lengthBox(() => selectedLength(ctx), {mm: 100, min: 0.001, max: 100000, d: 2});
  showLen = bindLength(dock.querySelector("#elen"), lenField, {unit, tag: dock.querySelector("#elenu"), onValue(){}});
  showDist = bindLength(dock.querySelector("#edist"), distField, {unit, tag: dock.querySelector("#edistu"), onValue(){}});
  ctx.onUnit(() => { showLen(); showDist(); }); ctx.onLoad(() => { showLen(); showDist(); });

  dock.querySelector("#editfilter").addEventListener("change", ev => { filter = ev.target.value; ctx.draw(); });
  dock.addEventListener("click", ev => {
    const t = ev.target.closest("[data-mode],[data-act]");
    if(!t || t.disabled) return;
    if(t.dataset.mode) return setMode(ctx, t.dataset.mode);
    const act = t.dataset.act;
    if(act === "undo") doUndo(ctx);
    if(act === "export") doExport(ctx);
    if(act === "flip" && sel.length === 1 && isEdge(sel[0])){
      const p = ctx.pieces()[sel[0].pi];
      sel[0] = {...sel[0], to: movingEnd(p, sel[0]) === "b" ? "a" : "b"};
      prefilled = ""; ctx.draw();
    }
    if(act === "move") moveBy(ctx);
    if(act === "join") doJoin(ctx);
  });
  for(const [id, fn] of [["#elen", setLength], ["#eang", setAngle], ["#edist", moveBy], ["#edir", moveBy]]) onEnter(dock.querySelector(id), input => fn(ctx, input));
}
const isEdge = it => it.kind === "line" || it.kind === "curve";

function setMode(ctx, m){ mode = m; pendingLine = null; if(m === "trimExtend") sel = []; note = ""; ctx.draw(); }

/* every edit goes through here: one undo step holding the pieces it touched */
/* a step of undo holds the pieces themselves with their snapshots — never their places in the list: a piece deleted since
   is skipped, the ones after it are found where they are now (pieces/remove.md R5) — and, for a delete, the record of the
   pieces that went */
const snapsOf = (ctx, pis) => pis.map(pi => ({piece: ctx.pieces()[pi], snap: snapPiece(ctx.pieces()[pi])}));
const remember = step => { undo.push(step); if(undo.length > 80) undo.shift(); };
function run(ctx, pis, fn){
  const snaps = snapsOf(ctx, pis);
  let r;
  try{ r = fn(); }catch(e){ r = {ok: false, message: e.message}; }
  if(r && r.ok === false){ for(const s of snaps) restorePiece(s.piece, s.snap); note = r.message; ctx.draw(); return r; }
  remember({snaps});
  note = (r && r.message) || "";
  for(const pi of pis) ctx.edited(pi);
  ctx.refresh();
  return r;
}
function doUndo(ctx){
  pendingLine = null;
  const step = undo.pop();
  if(!step){ note = "không còn gì để hoàn tác"; ctx.draw(); return; }
  if(step.remove) ctx.restorePieces(step.remove);                 // the pieces back first: the edits before stand on them
  for(const s of stepPieces(step.snaps || [], ctx.pieces())){ restorePiece(s.piece, s.snap); ctx.edited(s.index); }
  sel = []; pendingLine = null; note = step.remove ? `đã đưa lại ${step.remove.removed.length} mảnh` : "đã hoàn tác";
  ctx.refresh();
}
/* Delete (§6b, pieces/remove.md): the lines and POINTs selected — all or nothing — and the pieces selected, for good; with
   nothing chosen in Edit, the pieces selected in the piece list. One step of undo */
function doDelete(ctx){
  const whole = new Set(sel.filter(it => it.kind === "piece").map(it => it.pi));
  if(!sel.length) for(const i of ctx.selection) whole.add(i);
  const groups = groupItems(sel.filter(it => it.kind !== "piece" && !whole.has(it.pi)));
  if(!whole.size && !groups.size){ note = "Delete: chọn đường, điểm (POINT) hay mảnh cần xoá"; ctx.draw(); return; }
  const snaps = snapsOf(ctx, [...groups.keys()]), said = [];
  for(const [pi, items] of groups){
    const r = deleteItems(ctx.pieces()[pi], items);
    if(!r.ok){ for(const s of snaps) restorePiece(s.piece, s.snap); note = r.message; ctx.draw(); return; }
    said.push(r.message);
  }
  for(const pi of groups.keys()) ctx.edited(pi);                  // before the list changes under these indices
  const rec = whole.size ? ctx.removePieces([...whole]) : null;
  remember({snaps, remove: rec && rec.removed.length ? rec : null});
  if(rec && rec.removed.length) said.push(removedText(rec));
  sel = []; hover = null; pendingLine = null; note = said.join(" · ");
  ctx.refresh();
}

/* ── Precise Edit ───────────────────────────────────────────────────────── */
function oneEdge(ctx){
  if(sel.length !== 1 || !isEdge(sel[0])){ note = "chọn đúng một Line hoặc Curve"; ctx.draw(); return null; }
  return sel[0];
}
function setLength(ctx, input){
  const e = oneEdge(ctx); if(!e) return;
  if(input.hasAttribute("aria-invalid")){ note = input.title; ctx.draw(); return; }
  run(ctx, [e.pi], () => { applyLength(ctx.pieces()[e.pi], e, lenField.mm); return {ok: true, message: "đã đặt chiều dài"}; });
  prefilled = "";
}
function setAngle(ctx, input){
  const e = oneEdge(ctx); if(!e) return;
  let deg; try{ deg = parseAngle(input.value); }catch(err){ input.setAttribute("aria-invalid", "true"); note = err.message; ctx.draw(); return; }
  input.removeAttribute("aria-invalid");
  run(ctx, [e.pi], () => { applyAngle(ctx.pieces()[e.pi], e, deg); return {ok: true, message: "đã đặt góc"}; });
  prefilled = "";
}
function moveBy(ctx){
  if(!sel.length){ note = "chọn thứ cần dời"; ctx.draw(); return; }
  const error = inputError($("edist"));
  if(error){ note = error; ctx.draw(); return; }
  const dirInput = $("edir");
  let deg; try{ deg = parseAngle(dirInput.value); dirInput.removeAttribute("aria-invalid"); }
  catch(err){ dirInput.setAttribute("aria-invalid", "true"); note = err.message; ctx.draw(); return; }
  const d = polar(distField.mm, deg), groups = groupItems(sel);
  run(ctx, [...groups.keys()], () => {
    for(const [pi, items] of groups) applyMove(ctx.pieces()[pi], items, d);
    return {ok: true, message: `đã dời ${ctx.len(distField.mm)} theo ${deg}°`};
  });
}
function doJoin(ctx){
  if(sel.length !== 2 || !sel.every(isEdge) || sel[0].pi !== sel[1].pi){ note = "Join: chọn hai cạnh (⇧ bấm) của cùng một mảnh"; ctx.draw(); return; }
  const [a, b] = sel, pi = a.pi;
  run(ctx, [pi], () => clearing(joinEdges(ctx.pieces()[pi], a, b, ctx.snapTol() ?? 1e-6)));
}
/* a structural edit renumbers paths and vertices: what was selected no longer names the same
   thing, so the selection goes — before the redraw, not after it */
function clearing(r){ if(r && r.ok) sel = []; return r; }

/* ── export ─────────────────────────────────────────────────────────────── */
/* what goes out: the open model plus what other tools add to the file (Vẽ's shapes, draw/draw.md V13) */
const exported_ = ctx => ctx.exportModel ? ctx.exportModel() : ctx.model;
function doExport(ctx){
  try{
    const {text, stats} = writeDXF(exported_(ctx), {source: ctx.fileName});
    const name = exportName(ctx.fileName);
    downloadText(text, name);
    exported = {name, stats};
    note = `đã xuất ${name} — file gốc không đổi`;
  }catch(e){ note = e.message; }
  ctx.draw();
}

/* ── the pointer ────────────────────────────────────────────────────────── */
function grips(ctx){
  if(sel.length !== 1 || sel[0].kind !== "curve" || sel[0].whole) return [];
  const it = sel[0], p = ctx.pieces()[it.pi], v = p && vertsOf(p.paths[it.path]);
  if(!v) return [];
  const e = edgePts(p, it);
  return e.idx.slice(1, -1).map(k => ({kind: "point", src: "vertex", path: it.path, v: k, at: v[k], pi: it.pi, grip: true}));
}
const radius = () => Canvas.pickMM();
function pick(ctx, w, f){ return pickAt(ctx.pieces(), ctx.layersOn, w, radius(), {filter: f, grips: f === "edge" ? [] : grips(ctx), targets: targetsFn(ctx)}); }

function focus(ctx){
  const pis = [...new Set(sel.map(s => s.pi))];
  const same = pis.length === ctx.selection.size && pis.every(i => ctx.selection.has(i));
  if(!same && pis.length) ctx.select(pis, pis[pis.length - 1]);
}

function onDown(ev, w, ctx){
  if(ev.button === 1 || ev.altKey || !ctx.pieces().length) return false;
  if(mode === "drag"){
    const hit = pick(ctx, w, filter);
    if(!hit){ if(!ev.shiftKey){ sel = []; } ctx.draw(); return false; }       // empty: drop the selection, then pan
    const key = itemKey(hit.item), has = sel.some(s => itemKey(s) === key);
    if(ev.shiftKey){ sel = has ? sel.filter(s => itemKey(s) !== key) : sel.concat([hit.item]); focus(ctx); ctx.draw(); return true; }
    if(!has) sel = [hit.item];
    focus(ctx);
    const point = hit.item.kind === "point" ? hit.item : null;
    gesture = {items: point ? [point] : sel.slice(), point, w0: w, started: false, gs: null, targets: null};
    ctx.draw();
    return true;
  }
  const hit = pick(ctx, w, "edge");
  if(mode === "split"){
    if(!hit) return false;
    const p = ctx.pieces()[hit.pi];
    const own = {points: p.points.filter(q => ctx.layersOn[q.layer]).map(q => [q.x, q.y]), shapes: []};
    const q = snapTo(w, own, ctx.snapTol()).point;                            // a notch there is where it splits
    run(ctx, [hit.pi], () => clearing(splitAt(p, hit.item, q)));
    return true;
  }
  /* D14–D20: source first, destination second; each successful pair is one undo. */
  if(!hit){ note = pendingLine ? "bấm đường 2 làm đích — Esc để chọn lại đường 1" : "bấm đường 1 cần sửa"; ctx.draw(); return false; }
  const p = ctx.pieces()[hit.pi], path = p.paths[hit.item.path];
  if(!pendingLine){
    const r = trimExtendSource(path, w);
    if(!r.ok){ note = r.message; ctx.draw(); return true; }
    pendingLine = {piece: p, path, end: r.end}; sel = []; hover = null;
    note = "đã chọn đường 1 — bấm đường 2 làm đích";
    ctx.draw(); return true;
  }
  const source = pendingLine, pi = ctx.pieces().indexOf(source.piece), i = source.piece.paths.indexOf(source.path);
  if(pi < 0 || i < 0){ pendingLine = null; note = "đường 1 không còn — chọn lại"; ctx.draw(); return true; }
  if(path === source.path){ note = "đây là đường 1 — bấm đường 2 làm đích"; ctx.draw(); return true; }
  const targets = (path.layer === "1" ? p.paths.filter(q => q.layer === "1") : [path]).filter(q => q !== source.path);
  const r = run(ctx, [pi], () => trimExtendLine(source.piece, i, targets.flatMap(q => q.shapes), source.end));
  if(r && r.ok){ pendingLine = null; sel = []; hover = null; }
  else source.path = source.piece.paths[i]; // run() restores path objects on refusal; keep the same source for retry.
  ctx.draw();
  return true;
}

/* what a dragged point may snap to: everything visible that is not riding on this very edit */
function snapTargets(ctx, g){
  const it = gesture.point, rel = g.rel, points = [], shapes = [];
  ctx.pieces().forEach((p, pi) => {
    const mine = pi === it.pi;
    p.points.forEach((q, j) => {
      if(!ctx.layersOn[q.layer]) return;
      if(mine && (!rel.free.has(j) || (it.src === "entity" && j === it.pt))) return;
      points.push([q.x, q.y]);
    });
    p.paths.forEach((path, i) => {
      if(!ctx.layersOn[path.layer]) return;
      if(mine && (i === it.path || rel.kind.get(i) !== "line")) return;
      for(const v of path.snap || path.pts) points.push([v[0], v[1]]);
      shapes.push(...path.shapes);
    });
  });
  return {points, shapes};
}

function onMove(ev, w, ctx){
  if(!gesture){
    const h = pick(ctx, w, mode === "drag" ? filter : "edge");
    const k = h ? itemKey(h.item) : "";
    if(k !== (hover ? itemKey(hover.item) : "")){ hover = h; ctx.draw(); }
    return;
  }
  if(!gesture.started){
    if(!Canvas.dragged(gesture.w0, w)) return;
    try{ gesture.gs = [...groupItems(gesture.items)].map(([pi, items]) => ({pi, g: beginEdit(ctx.pieces()[pi], items)})); }
    catch(e){ note = e.message; gesture = null; ctx.draw(); return; }
    remember({snaps: gesture.gs.map(x => ({piece: ctx.pieces()[x.pi], snap: x.g.snap}))});
    if(gesture.point) gesture.targets = snapTargets(ctx, gesture.gs[0].g);
    gesture.started = true; note = ""; hover = null;
  }
  let d = [w[0] - gesture.w0[0], w[1] - gesture.w0[1]];
  if(gesture.point){
    const t = snapTo(w, gesture.targets, ctx.snapTol()).point, at = gesture.point.at;
    d = [t[0] - at[0], t[1] - at[1]];
  }
  try{
    for(const x of gesture.gs){
      const r = driveEdit(x.g, d);
      const bad = r.report ? r.report.failed.length + r.report.blocked.length : 0;
      note = bad ? `⚠ ${bad} quan hệ gãy — phần đó giữ hình cũ` : "";
      ctx.edited(x.pi);
    }
  }catch(e){ note = e.message; }
  ctx.draw();
}
function onUp(ev, ctx){
  if(gesture && gesture.started){ gesture = null; prefilled = ""; ctx.refresh(); return; }
  gesture = null;
}

/* ── drawing: handles, what is picked, what the pointer is over ───────────── */
function draw(root, ppm, ctx){
  const g = el("g", {}), pieces = ctx.pieces();
  const stroke = (pts, color, w, dash) => g.appendChild(el("path", {d: "M" + pts.map(q => `${q[0]},${-q[1]}`).join("L"),
    fill: "none", stroke: color, "stroke-width": w, "stroke-dasharray": dash || null, "stroke-linecap": "round",
    "stroke-linejoin": "round", opacity: 0.85, "vector-effect": "non-scaling-stroke"}));
  const ring = (at, r, color, fill) => g.appendChild(el("circle", {cx: at[0], cy: -at[1], r: r/ppm, fill: fill || "var(--bg)",
    stroke: color, "stroke-width": 1.4, "vector-effect": "non-scaling-stroke"}));
  const square = (at, s, color) => g.appendChild(el("rect", {x: at[0] - s/ppm, y: -at[1] - s/ppm, width: 2*s/ppm, height: 2*s/ppm,
    fill: "var(--bg)", stroke: color, "stroke-width": 1.2, "vector-effect": "non-scaling-stroke"}));
  const item = (it, color, w, dash) => {
    const p = pieces[it.pi]; if(!p) return;
    if(it.kind === "piece"){ const b = p.bbox; stroke([[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1], [b.x0, b.y0]], color, 1, "4 3"); return; }
    if(it.kind === "point"){ ring(posOf(p, it), w > 2 ? 5 : 4, color); return; }
    const path = p.paths[it.path]; if(!path) return;
    if(it.whole){ for(const s of path.shapes) stroke(sample(s, 0.2), color, w, dash); return; }
    const e = edgesOf(path).find(x => x.a === it.a && x.b === it.b);
    if(e) stroke(e.pts, color, w, dash);
  };

  const p = pieces[ctx.primary];
  if(p) for(const t of targetsFn(ctx)(p).points) if(t.src === "vertex") square(t.at, 2.6, "var(--accent)");
  if(hover && !gesture) item(hover.item, "var(--accent)", 2);
  if(pendingLine && pieces.includes(pendingLine.piece) && pendingLine.piece.paths.includes(pendingLine.path)){
    const path = pendingLine.path;
    stroke(path.pts, "var(--l-notch)", 3, "6 3");
    const end = pointAt(path.shapes[0], pendingLine.end === "start" ? 0 : 1);
    ring([end.x, end.y], 5, "var(--l-notch)", "var(--l-notch)");
  }
  for(const it of sel) item(it, "var(--accent)", 3.5);
  for(const gr of grips(ctx)) ring(gr.at, 2.2, "var(--accent)");
  if(sel.length === 1 && isEdge(sel[0]) && !sel[0].whole && pieces[sel[0].pi]){
    const e = edgePts(pieces[sel[0].pi], sel[0]);
    ring(e.pts[e.pts.length - 1], 3.2, "var(--accent)", "var(--accent)");          // the end that Length and Angle move
  }
  root.appendChild(g);
}

function sync(ctx){
  dock.hidden = !on();
  button.setAttribute("aria-pressed", on());
  button.classList.toggle("on", on());
  if(!on()){ Canvas.status("edit", ""); return; }
  tip.textContent = mode === "trimExtend" && pendingLine
    ? "2 · Bấm đường đích — đầu đánh dấu của đường 1 sẽ cắt / kéo dài tới giao điểm gần nhất · Esc thôi" : TIPS[mode];
  dock.querySelectorAll("[data-mode]").forEach(b => { const a = b.dataset.mode === mode; b.classList.toggle("on", a); b.setAttribute("aria-pressed", a); });
  const edge = sel.length === 1 && isEdge(sel[0]);
  for(const id of ["elen", "eang"]) $(id).disabled = !edge;
  dock.querySelector("[data-act=flip]").disabled = !edge || sel[0].whole;
  dock.querySelector("[data-act=join]").disabled = !(sel.length === 2 && sel.every(isEdge));
  dock.querySelector("[data-act=undo]").disabled = !undo.length;
  /* the boxes show the selected edge as it is — a whole curve too (P8) — until TD types over them */
  if(edge && prefilled !== itemKey(sel[0]) + (sel[0].to || "") && ctx.pieces()[sel[0].pi]){
    let m = null;
    try{ m = edgeMeasure(ctx.pieces()[sel[0].pi], sel[0]); }catch(e){ m = null; }
    if(m){
      lenField.set(m.length); showLen();
      $("eang").value = m.angle === null ? "" : m.angle.toFixed(2); $("eang").removeAttribute("aria-invalid");
    }
    prefilled = itemKey(sel[0]) + (sel[0].to || "");
  }
  Canvas.status("edit", `Edit · ${MODES[mode]} · ${sel.length} chọn` + (undo.length ? ` · ${undo.length} bước` : ""));
}

function readout(ctx){
  if(!on()) return null;
  const L = (v, d, l) => ctx.len(v, d, l);
  const rows = selectionRows(ctx.pieces(), sel.filter(s => ctx.pieces()[s.pi]), L).slice();
  if(mode === "trimExtend") rows.unshift(["Trim / Extend", pendingLine ? "2 · Chọn đường 2 làm đích" : "1 · Chọn đường cần sửa", true]);
  const drag = gesture && gesture.started && gesture.gs.find(x => x.pi === ctx.primary);
  const p = ctx.pieces()[ctx.primary], n = p && relationCounts(p, drag && drag.g.rel);
  if(n) rows.push(["Đường may bám", String(n.follow), true], ["Điểm bám", String(n.attach), true],
                  ["Chạm biên", String(n.reach), true], ["Điểm tự do", String(n.free), true]);
  if(exported) rows.push(["Đã xuất", `${exported.stats.pieces} mảnh · ${exported.stats.sampled} cong → polyline`, true]);
  if(note) rows.push(noteRow(note));
  /* nothing selected, nobody holds the panel: Edit's block is its heading, or what Edit says — "chọn Point · Line …",
     why a Trim was refused — shows nowhere (the readout contract, readout.js headed) */
  return headed({section: "Edit", rows}, ctx.selection.size > 0);
}
