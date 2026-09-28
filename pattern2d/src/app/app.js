/* Composition root: it owns the shared state, hands every feature the same context
   object and decides the mount order — which is also the order the toolbar reads
   and the order draw layers stack in. Features never import this file. */
import {$, node, bindLength} from "../shared/dom.js";
import {DEFAULT_UNIT, DISPLAY_UNITS, UNIT_LABEL, mmPer, shownUnit, formatLength,
        snapDefault, SNAP_FIELD, lengthField} from "../shared/units.js";
import {parseDXF} from "../features/dxf/parse.js";
import {buildModel} from "../features/dxf/model.js";
import {DxfImport} from "../features/dxf/import.js";
import {Readout} from "../features/readout/readout.js";
import {Canvas} from "../features/canvas/canvas.js";
import {Layers} from "../features/layers/layers.js";
import {Pieces} from "../features/pieces/pieces.js";
import {removePieces, restorePieces} from "../features/pieces/remove.js";
import {Edges} from "../features/edges/edges.js";
import {Measure} from "../features/measure/measure.js";
import {Arrange} from "../features/arrange/arrange.js";
import {Geometry} from "../features/geometry/geometry.js";
import {Simplify} from "../features/simplify/simplify.js";
import {Edit} from "../features/edit/edit.js";
import {Draw} from "../features/draw/draw.js";
import {Exporter} from "../features/export/export.js";

export function start(){
  const ui = {bar:$("bar"), rail:$("rail"), stage:$("stage"), tools:$("tools"),
              status:$("status"), svg:$("svg")};
  /* framed by the 3D page (the 2D tab): its 2D · 3D tabs sit over our top-left corner (dxf/open.md O6) */
  document.documentElement.classList.toggle("framed", window.parent !== window);
  const loaded = [], keys = new Map(), unitHooks = [], editHooks = [], exportHooks = [], pieceHooks = [];

  const ctx = {
    model: null, fileName: "", counts: {}, layersOn: {},
    selection: new Set(), primary: -1,

    /* The display unit (spec: shared/units.md). Every length a feature shows or reads goes
       through len()/shownUnit(), so one switch changes all of them and none of the geometry.
       Starts as inch on every open — "default" read literally, nothing remembered (D3). */
    unit: DEFAULT_UNIT,
    setUnit(u){
      mmPer(u);                                  // an unknown unit is refused, not defaulted
      if(u === ctx.unit) return;
      ctx.unit = u;
      for(const fn of unitHooks) fn(ctx);        // inputs re-write their millimetres
      ctx.refresh();
    },
    onUnit(fn){ unitHooks.push(fn); },
    /* null when the file declared no unit: then nothing may be converted (U9) */
    shownUnit(){ return shownUnit(ctx.model && ctx.model.units, ctx.unit); },
    len(mm, d = 1, label = true){ return formatLength(mm, ctx.shownUnit(), {d, label}); },

    /* The snap tolerance, in mm: a distance in the DRAWING's unit — 0.02 in for an inch file,
       0.5 mm for a mm file (TD 2026-09-23, shared/units.md §3). Reset from the file on every
       load; null when the file declares no unit, and then nothing snaps. Measure, Arrange and
       Geom all ask here — none of them measures a snap in pixels. */
    snap: null,
    snapTol(){ return ctx.model && ctx.model.units && ctx.model.units.unit ? ctx.snap : null; },

    pieces(){ return this.model ? this.model.pieces : []; },
    draw(){ Canvas.draw(ctx); },
    refresh(){ Pieces.render(ctx); Canvas.draw(ctx); },
    select(indices, primary){
      ctx.selection.clear();
      indices.forEach(i => ctx.selection.add(i));
      ctx.primary = primary ?? (indices.length ? indices[indices.length-1] : -1);
      ctx.refresh();
    },
    /* opts.unit: "mm" | "inch" chosen by hand, or "auto" to read the file's declaration */
    load(text, fileName, opts = {}){
      ctx.model = buildModel(parseDXF(text), opts);
      ctx.snap = snapDefault(ctx.model.units.unit);
      ctx.fileName = fileName;
      ctx.selection.clear(); ctx.primary = -1;
      for(const fn of loaded) fn(ctx);        // features reset themselves
      Canvas.fit(ctx); Canvas.draw(ctx);
    },
    onLoad(fn){ loaded.push(fn); },
    /* Edit changed piece i: whatever a feature worked out from it (an Along measurement, a Geom
       document, a Simplify result) is stale — edit/edit.md */
    onEdit(fn){ editHooks.push(fn); },
    edited(i){ for(const fn of editHooks) fn(ctx, i); },
    /* Pieces deleted for good, and put back by ⌘Z (spec: pieces/remove.md). The model loses them; the selection goes; a
       feature that worked something out from a piece hears of it (onPieces) — what holds a piece holds the piece itself,
       never its place in the list (R5). The record is the tool's undo step. */
    removePieces(indices){
      const rec = removePieces(ctx.model, indices);
      if(!rec.removed.length) return rec;
      ctx.selection.clear(); ctx.primary = -1;
      for(const fn of pieceHooks) fn(ctx, {kind: "remove", rec});
      ctx.refresh();
      return rec;
    },
    restorePieces(rec){
      restorePieces(ctx.model, rec);
      ctx.selection.clear();
      rec.removed.forEach(r => ctx.selection.add(ctx.pieces().indexOf(r.piece)));
      ctx.primary = rec.removed.length ? ctx.pieces().indexOf(rec.removed[rec.removed.length - 1].piece) : -1;
      for(const fn of pieceHooks) fn(ctx, {kind: "restore", rec});
      ctx.refresh();
    },
    onPieces(fn){ pieceHooks.push(fn); },
    /* What Xuất DXF writes: the open model, with whatever a feature adds to it on the way out — Vẽ adds
       its shapes (draw/draw.md V13). A hook returns a NEW model; the open one is never changed. */
    onExport(fn){ exportHooks.push(fn); },
    exportModel(){ return exportHooks.reduce((m, fn) => fn(m), ctx.model); },
    key(k, fn){ keys.set(k, fn); }
  };

  /* the rail toggle belongs to the shell, so it is the first button in the bar */
  const rail = node("button", {className:"btn", id:"rail", innerHTML:"&#9776;",
                               title:"Show / hide the panel (P)"});
  /* show it when it is hidden, hide it when it is shown */
  rail.addEventListener("click", () => setRail(ctx, document.body.classList.contains("norail")));
  ui.tools.appendChild(rail);

  Readout.mount(ctx, ui);       // the panel other features write into
  Canvas.mount(ctx, ui);        // view, render loop, pointer
  Layers.mount(ctx, ui);
  Pieces.mount(ctx, ui);        // registers the base draw layer — must precede overlays
  Edges.mount(ctx, ui);
  Measure.mount(ctx, ui);
  Arrange.mount(ctx, ui);
  Geometry.mount(ctx, ui);
  Simplify.mount(ctx, ui);
  Edit.mount(ctx, ui);           // the editor: select · direct · precise · constraint, writes a new DXF
  Draw.mount(ctx, ui);           // Line · Curve · Rect · Circle · Polygon at real size, on top of what Edit draws
  Exporter.mount(ctx, ui);
  DxfImport.mount(ctx, ui);
  ui.tools.appendChild(unitSwitch(ctx));        // last in the toolbar: it speaks for every tool
  Canvas.tail.before(snapBox(ctx));             // the snap tolerance sits by the cursor readout

  ctx.key("p", () => rail.click());
  ctx.key("f", () => { ctx.select([], -1); Canvas.fit(ctx); Canvas.draw(ctx); });
  ctx.key("e", () => Edges.toggle(ctx));
  ctx.key("m", () => Canvas.setTool(Canvas.activeTool() === "measure" ? null : "measure", ctx));
  ctx.key("a", () => Arrange.toggle(ctx));
  ctx.key("u", () => ctx.setUnit(DISPLAY_UNITS[(DISPLAY_UNITS.indexOf(ctx.unit) + 1) % DISPLAY_UNITS.length]));

  addEventListener("keydown", ev => {
    if(ev.target.matches("input,select,textarea")) return;
    const cmd = ev.metaKey || ev.ctrlKey;
    if(cmd && ev.key.toLowerCase() === "a" && ctx.model){ ev.preventDefault(); Pieces.selectAll(ctx); return; }
    if(ev.key === "Escape"){ Pieces.clear(ctx); return; }
    if(cmd) return;
    const fn = keys.get(ev.key.toLowerCase());
    if(fn) fn(ev);                            // the key's own check may need it (Vẽ's 6 / 7 refuse ⌥)
  });

  try{ if(localStorage.getItem("pp-rail") === "0") document.body.classList.add("norail"); }catch(e){}

  /* the build hides everything in one scope; this handle is how a layout can be
     checked from the console — window.PP.ctx.pieces()[0].bbox and the like */
  window.PP = {ctx, Canvas, Pieces, Arrange, Edges, Geometry, Simplify, Edit, Draw};

  DxfImport.boot(ctx);
}

/* in · cm · mm — changes how numbers are written, never the geometry (shared/units.md) */
function unitSwitch(ctx){
  const box = node("span", {className: "unitsw", id: "unitsw", role: "group",
                            title: "Đơn vị hiển thị (U) — chỉ đổi cách viết số, không đổi hình"});
  const buttons = DISPLAY_UNITS.map(u => {
    const b = node("button", {className: "btn", textContent: UNIT_LABEL[u]});
    b.dataset.unit = u;
    b.addEventListener("click", () => ctx.setUnit(u));
    box.appendChild(b);
    return b;
  });
  const sync = () => buttons.forEach(b => {
    const on = b.dataset.unit === ctx.unit;
    b.setAttribute("aria-pressed", on); b.classList.toggle("on", on);
  });
  ctx.onUnit(sync); sync();
  return box;
}

/* "Snap 0.0200 in": the drawing's snap tolerance, written and typed in the display unit */
function snapBox(ctx){
  const box = node("span", {className: "snapbox mono", title: "Dung sai snap — khoảng cách trong bản vẽ: 0.02 in cho file inch, 0.5 mm cho file mm"});
  const input = node("input", {id: "snaptol", type: "text", inputMode: "decimal", autocomplete: "off",
                               title: "Dung sai snap, theo đơn vị hiển thị"});
  const tag = node("span", {className: "utag"});
  box.append("Snap ", input, tag);
  const field = lengthField({...SNAP_FIELD, mm: 0});
  const show = bindLength(input, field, {unit: () => ctx.shownUnit(), tag, onValue: mm => { ctx.snap = mm; }});
  const sync = () => {
    const off = ctx.snapTol() === null;
    input.disabled = off;
    if(off){ input.value = "tắt"; tag.textContent = ""; input.title = "File chưa khai đơn vị — chọn đơn vị file để bật snap"; return; }
    field.set(ctx.snap); show();
  };
  ctx.onLoad(sync); ctx.onUnit(sync); sync();    // nothing open yet: "tắt", not an editable 0
  return box;
}

function setRail(ctx, show){
  document.body.classList.toggle("norail", !show);
  try{ localStorage.setItem("pp-rail", show ? "1" : "0"); }catch(e){}
  requestAnimationFrame(() => { if(ctx.model) ctx.draw(); });
}
