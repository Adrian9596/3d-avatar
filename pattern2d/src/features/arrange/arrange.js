/* Arrange: pick pieces up and put them where they belong to each other — aligned,
   evenly spaced, or laid out at a fixed gap. It is a viewer-side layout only: the
   offsets live on the pieces, never in the DXF, and Reset always returns the
   drawing to the file. */
import {$, el, esc, bindLength, isTyping, arrowStep} from "../../shared/dom.js";
import {lengthField} from "../../shared/units.js";
import {unionBox, boxesTouch} from "../../shared/geom.js";
import {Canvas} from "../canvas/canvas.js";
import {Readout} from "../readout/readout.js";
import {Pieces} from "../pieces/pieces.js";
import {removedText} from "../pieces/remove.js";
import {ico, ICO} from "./icons.js";
import {translatePiece, alignPieces, distributePieces, packPieces, snapOffset,
        gapsBetween, snapshot, restore, resetPieces, boxesOf} from "./ops.js";

let button = null, dock = null, bar = null, tip = null;
let undoStack = [], drag = null, marquee = null, guides = null;

const on = () => Canvas.activeTool() === "arrange";
/* the layout gap: held in mm, typed and shown in the display unit (shared/units.md U6) */
export const GAP_FIELD = {mm: 10, min: 0, max: 5000, d: 1};
const gapField = lengthField(GAP_FIELD);
const gapMM = () => gapField.mm;
let showGap = () => {};
const targets = ctx => (ctx.selection.size ? Pieces.selected(ctx) : ctx.pieces());

export const Arrange = {
  mount(ctx, ui){
    button = Canvas.toolButton(ui, {id: "arr", label: "Arrange", tool: "arrange", title: "Arrange pieces (A)"}, ctx);

    buildBar(ctx, ui);
    Canvas.tool("arrange", {onDown, onMove, onUp, onExit: () => { drag = marquee = guides = null; }});
    Canvas.layer((root, ppm, c) => { if(on()) drawChrome(root, ppm, c); });
    Canvas.afterDraw(ctx => sync(ctx));
    Readout.section(groupReadout);
    ctx.onLoad(() => { undoStack = []; });

    ctx.onPieces(() => { drag = marquee = guides = null; });
    /* no tool that claims them (Edit and Vẽ take these keys while on): ⌘Z is the viewer's own undo — a layout, or a delete —
       and Delete deletes the pieces selected, for good (pieces/remove.md R1, R3) */
    addEventListener("keydown", ev => {
      if(isTyping(ev)) return;
      const cmd = ev.metaKey || ev.ctrlKey;
      if(cmd && ev.key.toLowerCase() === "z"){ ev.preventDefault(); undo(ctx); return; }
      if((ev.key === "Delete" || ev.key === "Backspace") && !cmd && ctx.model && ctx.selection.size){
        ev.preventDefault();
        const rec = ctx.removePieces([...ctx.selection]);
        if(rec.removed.length){ push({remove: rec}); say(removedText(rec)); }
        return;
      }
      const d = arrowStep(ev);                            // millimetres, not pixels
      if(!on() || !ctx.selection.size || !d) return;
      ev.preventDefault();
      nudge(ctx, d[0], d[1]);
    });
  },
  toggle(ctx){ Canvas.setTool(on() ? null : "arrange", ctx); }
};

/* ── the bar ── */
function buildBar(ctx, ui){
  dock = document.createElement("div");
  dock.className = "dock"; dock.id = "dock"; dock.hidden = true;
  const b = (attr, val, label, d) =>
    `<button class="ibtn" data-${attr}="${val}" title="${esc(label)}" aria-label="${esc(label)}">${ico(d)}</button>`;
  dock.innerHTML = `<div class="tip" id="tip" hidden></div><div class="arrangebar" id="arrangebar">` +
    `<span class="grp">` +
      b("align","left","Align left edges", ICO.left) +
      b("align","cx","Align centres, left to right", ICO.cx) +
      b("align","right","Align right edges", ICO.right) +
      b("align","top","Align top edges", ICO.top) +
      b("align","cy","Align centres, top to bottom", ICO.cy) +
      b("align","bottom","Align bottom edges", ICO.bottom) +
    `</span><span class="grp">` +
      b("dist","h","Even gaps across — outermost pieces stay put", ICO.disth) +
      b("dist","v","Even gaps down — outermost pieces stay put", ICO.distv) +
    `</span><span class="grp">` +
      `<span class="gapf"><label for="gap">Gap</label>` +
      `<input id="gap" type="text" inputmode="decimal" autocomplete="off" title="Spacing the layout buttons use, in the display unit — 3/8 or 1 1/4 work too"><span class="utag" id="gapu"></span></span>` +
      b("pack","row","Lay out in a row at that gap, tops aligned", ICO.row) +
      b("pack","col","Stack in a column at that gap, left edges aligned", ICO.col) +
      b("pack","grid","Pack into a block at that gap, tallest first", ICO.grid) +
    `</span><span class="grp">` +
      `<button class="ibtn" id="undo" title="Undo (⌘Z)" aria-label="Undo">${ico(ICO.undo)}</button>` +
      `<button class="btn" id="reset" title="Put the pieces back where the DXF had them">Reset</button>` +
    `</span></div>`;
  ui.stage.appendChild(dock);
  bar = dock.querySelector("#arrangebar"); tip = dock.querySelector("#tip");
  showGap = bindLength(dock.querySelector("#gap"), gapField,
                       {unit: () => ctx.shownUnit(), tag: dock.querySelector("#gapu"), onValue(){}});
  ctx.onUnit(() => showGap()); ctx.onLoad(() => showGap());

  bar.addEventListener("click", ev => {
    const t = ev.target.closest("[data-align],[data-dist],[data-pack]");
    if(!t || t.disabled) return;
    const ps = Pieces.selected(ctx);
    run(ctx, () => t.dataset.align ? alignPieces(ps, t.dataset.align)
                : t.dataset.dist  ? distributePieces(ps, t.dataset.dist)
                :                   packPieces(ps, t.dataset.pack, gapMM(), Canvas.aspect()));
  });
  dock.querySelector("#undo").addEventListener("click", () => undo(ctx));
  dock.querySelector("#reset").addEventListener("click", () =>
    run(ctx, () => resetPieces(targets(ctx))));
}

/* every command that moves a piece goes through here, so undo stays honest */
const push = step => { undoStack.push(step); if(undoStack.length > 80) undoStack.shift(); };
function run(ctx, fn){
  const snap = snapshot(ctx.pieces());
  if(fn() === false) return;
  push(snap);
  ctx.refresh();
}
/* a step is a layout (the offsets) or a delete (the record, put back where it was — R3) */
function undo(ctx){
  const step = undoStack.pop(); if(!step) return;
  if(step.remove){ ctx.restorePieces(step.remove); say(`đã đưa lại ${step.remove.removed.length} mảnh`); return; }
  restore(ctx.pieces(), step);
  ctx.refresh();
}
/* a word in the status bar that goes by itself — the delete has no panel of its own */
let sayTimer = null;
function say(text){
  Canvas.status("remove", text);
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => Canvas.status("remove", ""), 6000);
}
function nudge(ctx, dx, dy){
  const ps = Pieces.selected(ctx); if(!ps.length) return;
  run(ctx, () => { for(const p of ps) translatePiece(p, dx, dy); });
}

function sync(ctx){
  dock.hidden = !on();
  button.setAttribute("aria-pressed", on());
  button.classList.toggle("on", on());
  /* the size in the status bar is Arrange's: left there with the tool off, it spoke of a selection long gone — even of
     a piece of the file open before (bấm thật 2026-09-24) */
  if(!on()){ Canvas.status("selection", ""); return; }
  const n = ctx.selection.size;
  bar.querySelectorAll("[data-align]").forEach(b => b.disabled = n < 2);
  bar.querySelectorAll("[data-dist]").forEach(b => b.disabled = n < 3);
  bar.querySelectorAll("[data-pack]").forEach(b => b.disabled = n < 2);
  $("undo").disabled = !undoStack.length;
  $("reset").disabled = !targets(ctx).some(p => p.ox || p.oy);
  tip.hidden = n > 0;
  tip.textContent = "Click a piece · ⇧ click to add · drag to move · ⌥ drag to pan";
  Canvas.status("selection", n ? selectionText(Pieces.selected(ctx), (v, d, l) => ctx.len(v, d, l)) : "");
}

/* ── the pointer ── move what is picked up, or sweep a marquee over what is not ── */
function onDown(ev, w, ctx){
  if(ev.button === 1 || ev.altKey) return false;          // hand the drag back for a pan
  const i = Pieces.hit(ctx, w), add = ev.shiftKey || ev.metaKey || ev.ctrlKey;
  if(i >= 0){
    if(add || !ctx.selection.has(i)) Pieces.pick(ctx, i, ev);
    if(ctx.selection.has(i)){
      const ps = Pieces.selected(ctx);
      drag = {mode:"move", w0:w, u0:unionBox(boxesOf(ps)), ps,
              skip:new Set(ctx.selection), dx:0, dy:0, moved:false};
      Canvas.cursor("moving", true);
    }
  } else {
    if(!add) Pieces.clear(ctx);
    drag = {mode:"marquee", base:new Set(ctx.selection)};
    marquee = {x0:w[0], y0:w[1], x1:w[0], y1:w[1]};
  }
  ctx.draw();
  return true;
}
function onMove(ev, w, ctx){
  if(!drag) return;
  if(drag.mode === "marquee"){
    marquee.x1 = w[0]; marquee.y1 = w[1];
    const r = {x0:Math.min(marquee.x0, marquee.x1), x1:Math.max(marquee.x0, marquee.x1),
               y0:Math.min(marquee.y0, marquee.y1), y1:Math.max(marquee.y0, marquee.y1)};
    ctx.selection.clear(); drag.base.forEach(i => ctx.selection.add(i));
    ctx.pieces().forEach((p, i) => { if(boxesTouch(p.bbox, r)) ctx.selection.add(i); });
    ctx.primary = ctx.selection.size ? [...ctx.selection].pop() : -1;
    ctx.draw(); return;
  }
  if(!drag.moved){ push(snapshot(ctx.pieces())); drag.moved = true; }  // one step per drag
  const others = ctx.pieces().filter((p, i) => !drag.skip.has(i)).map(p => p.bbox);
  const s = snapOffset(drag.u0, w[0]-drag.w0[0], w[1]-drag.w0[1], others, ctx.snapTol());   // drawing units, not px
  guides = s.guides;
  for(const p of drag.ps) translatePiece(p, s.dx-drag.dx, s.dy-drag.dy);
  drag.dx = s.dx; drag.dy = s.dy;
  ctx.draw();
}
function onUp(ev, ctx){
  const was = drag;
  drag = null; marquee = null; guides = null;
  Canvas.cursor("moving", false);
  if(was) ctx.refresh();
}

/* ── chrome ── selection boxes, snap guides, marquee: all drawn in world units ── */
function drawChrome(root, ppm, ctx){
  const g = el("g", {}), ps = Pieces.selected(ctx);
  for(const p of ps)
    g.appendChild(el("rect", {x:p.bbox.x0, y:-p.bbox.y1,
      width:Math.max(p.bbox.w, 1e-3), height:Math.max(p.bbox.h, 1e-3), fill:"none",
      stroke:"var(--accent)", "stroke-width":1, "stroke-dasharray":"4 3",
      "vector-effect":"non-scaling-stroke"}));
  if(ps.length > 1){
    const u = unionBox(boxesOf(ps)), m = 4/ppm;
    g.appendChild(el("rect", {x:u.x0-m, y:-(u.y1+m), width:u.w+m*2, height:u.h+m*2, fill:"none",
      stroke:"var(--accent)", "stroke-width":1, "stroke-opacity":.45,
      "vector-effect":"non-scaling-stroke"}));
  }
  for(const gd of (guides || [])){
    const line = gd.x !== undefined ? {x1:gd.x, x2:gd.x, y1:-gd.a, y2:-gd.b}
                                    : {x1:gd.a, x2:gd.b, y1:-gd.y, y2:-gd.y};
    g.appendChild(el("line", Object.assign(line, {stroke:"var(--l-notch)", "stroke-width":1,
      "stroke-dasharray":"3 3", "vector-effect":"non-scaling-stroke"})));
  }
  if(marquee)
    g.appendChild(el("rect", {x:Math.min(marquee.x0, marquee.x1), y:-Math.max(marquee.y0, marquee.y1),
      width:Math.abs(marquee.x1-marquee.x0), height:Math.abs(marquee.y1-marquee.y0),
      fill:"var(--halo)", stroke:"var(--accent)", "stroke-width":1, "stroke-dasharray":"4 3",
      "vector-effect":"non-scaling-stroke"}));
  root.appendChild(g);
}

/* What the readout and the status bar say about a group: its extent, and whether its gaps
   are even — pure, for a length formatter L(mm, d, label), so they read in any unit. */
export function groupRows(ps, L){
  const u = unionBox(boxesOf(ps));
  const show = axis => {
    const gs = gapsBetween(ps, axis);
    if(!gs.length) return "—";
    const lo = Math.min(...gs), hi = Math.max(...gs);
    return hi-lo < 0.05 ? L(lo) : L(lo, 1, false)+" … "+L(hi);
  };
  return {title: `${ps.length} pieces`, rows: [
    ["Pieces", String(ps.length)],
    ["Extent", u ? L(u.w, 1, false)+" × "+L(u.h) : "—"],
    ["Gap across", show("h")],
    ["Gap down", show("v")]
  ]};
}
export function selectionText(ps, L){
  const u = unionBox(boxesOf(ps));
  return ps.length + (ps.length > 1 ? " pieces" : " piece") + (u ? "  ·  " + L(u.w, 1, false) + " × " + L(u.h) : "");
}
function groupReadout(ctx){
  if(ctx.selection.size < 2) return null;
  return groupRows(Pieces.selected(ctx), (v, d, l) => ctx.len(v, d, l));
}
