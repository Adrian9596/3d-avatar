/* Layer panel and legend in one control: the swatch draws the same mark the layer
   draws on the canvas — a solid line, a dashed line, a run of points or a glyph —
   so the list doubles as the key to the drawing. */
import {esc} from "../../shared/dom.js";
import {layerMeta} from "../dxf/aama.js";

let grid = null, count = null;

/* which layers a fresh file shows: everything except the two point clouds that
   would bury the outline (turn points and curve points) */
export function defaultVisibility(counts){
  const on = {};
  Object.keys(counts).forEach(k => { on[k] = (k !== "3" && k !== "2"); });
  if(!Object.keys(counts).some(k => on[k])) Object.keys(counts).forEach(k => on[k] = true);
  return on;
}

export function countEntities(model){
  const seen = {};
  for(const p of model.pieces.concat([model.loose]))
    for(const q of (p.paths||[]).concat(p.points||[], p.texts||[]))
      seen[q.layer] = (seen[q.layer]||0)+1;
  return seen;
}

/* the layers that hold a line — layer 14 holding one is a sewing line, not the piece name (dxf/aama.js) */
export function lineLayers(model){
  const out = new Set();
  for(const p of model.pieces.concat([model.loose])) for(const q of p.paths || []) out.add(q.layer);
  return out;
}

export function layerSwatch(m){
  const col = `var(${m.tok})`;
  const inner =
    m.kind === "point" ? [3,8,13].map(x => `<circle cx="${x}" cy="5" r="1.6" fill="${col}"/>`).join("")
  : m.kind === "text"  ? `<text x="8" y="8.5" font-size="9" text-anchor="middle" fill="${col}" font-family="monospace">T</text>`
  : `<line x1="1" y1="5" x2="15" y2="5" stroke="${col}" stroke-linecap="round"
       stroke-width="${m.kind === "dash" ? 1.6 : 2}"${m.kind === "dash" ? ' stroke-dasharray="4 2.5"' : ""}/>`;
  return `<svg class="sw" viewBox="0 0 16 10" aria-hidden="true">${inner}</svg>`;
}

export const Layers = {
  mount(ctx, ui){
    const panel = document.createElement("details");
    panel.className = "panel"; panel.open = true;
    panel.innerHTML = `<summary>Layers <span id="lcount" class="mono"></span></summary>
      <div id="layers" class="lays"></div>`;
    ui.rail.appendChild(panel);
    grid = panel.querySelector("#layers"); count = panel.querySelector("#lcount");
    ctx.onLoad(c => {
      c.counts = countEntities(c.model);
      c.lineLayers = lineLayers(c.model);
      c.layersOn = defaultVisibility(c.counts);
      Layers.render(c);
    });
    /* a piece deleted or put back, a line deleted in Edit: the counts are of what is there now — the layers keep their
       on/off (pieces/remove.md R7) */
    const recount = c => { c.counts = countEntities(c.model); c.lineLayers = lineLayers(c.model); Layers.render(c); };
    ctx.onPieces(recount);
    ctx.onEdit(recount);
  },
  render(ctx){
    const counts = ctx.counts || {};
    const ids = Object.keys(counts).sort((a,b) => (+a||999)-(+b||999));
    grid.innerHTML = ids.map(id => {
      const m = layerMeta(id, {lines: !!ctx.lineLayers && ctx.lineLayers.has(id)});
      const cap = `${m.name}  ·  layer ${id}  ·  ${counts[id]} entities`;
      return `<button class="lay" data-layer="${esc(id)}" aria-pressed="${!!ctx.layersOn[id]}"
          title="${esc(cap)}" aria-label="${esc(cap)}">${layerSwatch(m)}` +
        `<span class="n">${esc(m.short)}</span></button>`;
    }).join("");
    count.textContent = ids.length;
    grid.querySelectorAll(".lay").forEach(b => b.addEventListener("click", () => {
      const on = !ctx.layersOn[b.dataset.layer];
      ctx.layersOn[b.dataset.layer] = on;
      b.setAttribute("aria-pressed", on);
      ctx.draw();
    }));
  }
};
