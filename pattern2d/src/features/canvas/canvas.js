/* The drawing surface: it owns the view box, the render loop and the pointer.
   It knows nothing about pieces, edges or arranging — features push a draw layer
   into it and, if they need the pointer, register a tool. Whatever no tool claims
   is a pan, which is why panning keeps working in every mode. */
import {$, el} from "../../shared/dom.js";
import {fitBox, zoomAt, zoomCentre, worldAt, ppmOf, fractionAt, fillRect} from "./view.js";
import {formatPoint, pxPer, niceScale} from "../../shared/units.js";
import {Readout} from "../readout/readout.js";

/* Choosing is not snapping (shared/units.md S5): which handle or line a click takes is a question
   about the SCREEN, so it is pixels whatever the zoom. PICK_PX is how near a click must be to take
   a handle or a line (Edit and Vẽ); DRAG_PX how far a press must travel before it is a drag. */
export const PICK_PX = 8;
export const DRAG_PX = 3;

let svg = null, view = null;
const layers = [];                 // draw(root, ppm, ctx) — in mount order
const after = [];                  // run(ctx) after every draw
const tools = new Map();
let active = null, drag = null;
const bits = new Map();            // status bar slots, in insertion order

export const Canvas = {
  mount(ctx, ui){
    svg = ui.svg;

    ui.tools.append(
      btn("fit", "Fit", () => { ctx.select([], -1); Canvas.fit(ctx); Canvas.draw(ctx); }),
      btn("zout", "−", () => { if(!view) return; view = zoomCentre(view, 1.25); Canvas.draw(ctx); }),
      btn("zin", "+", () => { if(!view) return; view = zoomCentre(view, 0.8); Canvas.draw(ctx); })
    );

    const cursor = el2("span", "mono"), zoom = el2("span", "mono");
    const bar = document.createElement("span");
    bar.className = "sb";
    bar.innerHTML = `<i id="sbar"></i><span class="mono" id="sbarlbl">—</span>`;
    cursor.textContent = zoom.textContent = "—";
    bits.set("cursor", cursor); bits.set("zoom", zoom);
    ui.status.append(cursor, zoom);
    Canvas.tail = bar;             // the scale bar always sits last, pushed right
    ui.status.append(bar);

    /* no file open, no view: nothing to pan, zoom or point at (dxf/open.md O2) */
    svg.addEventListener("pointerdown", ev => {
      if(!view) return;
      const w = Canvas.toWorld(ev);
      svg.setPointerCapture(ev.pointerId);
      const t = active && tools.get(active);
      if(t && t.onDown && t.onDown(ev, w, ctx)) return;
      drag = {x:ev.clientX, y:ev.clientY, vx:view.x, vy:view.y};
      svg.classList.add("grabbing");
    });
    svg.addEventListener("pointermove", ev => {
      if(!view) return;
      const w = Canvas.toWorld(ev);
      bits.get("cursor").textContent = formatPoint(w, ctx.shownUnit());   // where a snap will land, in the display unit
      if(drag){
        const s = ppmOf(view, box());          // the painted scale, the same on both axes
        view.x = drag.vx - (ev.clientX-drag.x)/s;
        view.y = drag.vy + (ev.clientY-drag.y)/s;
        Canvas.draw(ctx); return;
      }
      const t = active && tools.get(active);
      if(t && t.onMove) t.onMove(ev, w, ctx);
    });
    const end = ev => {
      drag = null; svg.classList.remove("grabbing");
      const t = active && tools.get(active);
      if(t && t.onUp) t.onUp(ev, ctx);
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("wheel", ev => {
      ev.preventDefault();
      if(!view) return;
      const [fx, fy] = fractionAt(view, box(), ev.clientX, ev.clientY);
      view = zoomAt(view, fx, fy, Math.exp(ev.deltaY*0.0016));
      Canvas.draw(ctx);
    }, {passive:false});

    addEventListener("resize", () => { if(ctx.model) Canvas.draw(ctx); });
  },

  /* features contribute to the frame */
  layer(fn){ layers.push(fn); },
  afterDraw(fn){ after.push(fn); },
  status(key, text){
    let s = bits.get(key);
    if(!s){ s = el2("span", "mono"); bits.set(key, s); Canvas.tail.before(s); }
    s.textContent = text;
  },

  /* features that want the pointer register a tool; only one is ever active */
  tool(name, handlers){ tools.set(name, handlers); },
  setTool(name, ctx){
    if(active === name) return;
    const prev = active && tools.get(active);
    active = name;
    if(prev && prev.onExit) prev.onExit(ctx);
    svg.className.baseVal = "";
    const t = name && tools.get(name);
    if(t && t.cursor) svg.classList.add(t.cursor);
    Canvas.draw(ctx);
  },
  activeTool: () => active,
  cursor(cls, on){ svg.classList.toggle(cls, !!on); },
  /* the toolbar button of a tool: pressed while the tool is on, a click turns it on or off — every
     tool's button is this one, so they read and behave alike */
  toolButton(ui, {id, label, title, tool}, ctx){
    const b = document.createElement("button");
    b.className = "btn"; b.id = id; b.textContent = label;
    if(title) b.title = title;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => Canvas.setTool(active === tool ? null : tool, ctx));
    ui.tools.appendChild(b);
    return b;
  },

  view: () => view,
  pxPerMM(){ return ppmOf(view, box()); },
  /* PICK_PX and DRAG_PX as millimetres at the zoom of this frame */
  pickMM(){ return PICK_PX/Canvas.pxPerMM(); },
  dragged(w0, w){ return Math.hypot(w[0] - w0[0], w[1] - w0[1]) >= DRAG_PX/Canvas.pxPerMM(); },
  toWorld(ev){ return worldAt(view, box(), ev.clientX, ev.clientY); },
  zoomTo(b, pad = 0.12){
    if(!b) return;
    const r = svg.getBoundingClientRect();
    view = fitBox(b, (r.width||900)/(r.height||600), pad);
  },
  aspect(){ const r = svg.getBoundingClientRect(); return (r.width||900)/(r.height||600); },
  fit(ctx){ Canvas.zoomTo(worldBox(ctx), 0.05); },

  draw(ctx){
    if(!ctx.model || !view) return;
    /* the element may have changed size since the view was made (window resize, the rail
       folding away): re-fill it at the same scale, so what is painted and what a click
       maps to never disagree */
    if(svg.getBoundingClientRect().width > 0) view = fillRect(view, box());
    svg.setAttribute("viewBox", `${view.x} ${-(view.y+view.h)} ${view.w} ${view.h}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    while(svg.firstChild) svg.removeChild(svg.firstChild);
    const root = el("g", {"shape-rendering":"geometricPrecision"});
    svg.appendChild(root);
    const ppm = Canvas.pxPerMM();
    for(const fn of layers) fn(root, ppm, ctx);
    updateScale(ppm, ctx.shownUnit());
    Readout.render(ctx);
    for(const fn of after) fn(ctx);
  }
};

/* the element's box; a hidden one (width 0) falls back to the size the layout assumes */
function box(){
  const r = svg.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : {left: r.left || 0, top: r.top || 0, width: 900, height: 600};
}

function worldBox(ctx){
  const pts = [];
  for(const p of ctx.pieces()){
    for(const q of p.paths) pts.push(...q.pts);
    for(const q of p.points) pts.push([q.x, q.y]);
  }
  if(!pts.length && ctx.model) for(const q of ctx.model.loose.paths) pts.push(...q.pts);
  if(!pts.length) return null;
  let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
  for(const [x,y] of pts){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
  return {x0, y0, x1, y1, w:x1-x0, h:y1-y0};
}

/* the scale bar speaks the display unit — round numbers of it, fractions of an inch — or an
   honest "đv?" when the file declared none (shared/units.md U9, U10) */
function updateScale(ppm, unit){
  bits.get("zoom").textContent = pxPer(ppm, unit);
  const s = niceScale(ppm, unit);
  $("sbar").style.width = (s.mm*ppm)+"px";
  $("sbarlbl").textContent = s.label;
}

const el2 = (tag, cls) => { const e = document.createElement(tag); e.className = cls; return e; };
function btn(id, label, onClick){
  const b = document.createElement("button");
  b.className = "btn"; b.id = id; b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
