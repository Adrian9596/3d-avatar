/* The piece list and what "selected" means for the whole viewer.
   Pieces are identified by their own silhouette, not by a name: block names are
   long, and the name fields in a DXF are whatever language the drafter used. */
import {esc} from "../../shared/dom.js";
import {Canvas} from "../canvas/canvas.js";
import {Readout} from "../readout/readout.js";
import {drawModel, pathD} from "./draw.js";
import {hitPiece} from "./hit.js";

let list = null, count = null;

export const pieceLabel = (p, i) => p.blockName || p.name || p.vn || ("piece " + (i+1));

/* what the panel and the list say about a piece, for a length formatter L(mm, d, label) —
   the unit is L's, so these read the same piece in inch, cm or mm (shared/units.md U8) */
export function pieceRows(p, L){
  return [
    ["Cut", p.qty ? "×"+p.qty : "—"],
    ["Size", p.bbox ? L(p.bbox.w, 1, false)+" × "+L(p.bbox.h) : "—"],
    ["Cut line", p.cutLen ? L(p.cutLen) : "—"],
    ["Sewing line", p.sewLen ? L(p.sewLen) : "—"]
  ];
}
export const pieceCaption = (p, i, L) => [pieceLabel(p, i), p.qty ? "cut ×"+p.qty : "",
  p.bbox ? L(p.bbox.w, 0, false)+" × "+L(p.bbox.h, 0) : ""].filter(Boolean).join("  ·  ");

export function pieceThumb(p){
  const o = p.cut || p.sew || (p.paths[0] || {}).pts, b = p.bbox;
  if(!o || !b) return `<span class="th"></span>`;
  const pad = Math.max(b.w, b.h)*0.04 + 1;
  return `<svg class="th" viewBox="${b.x0-pad} ${-(b.y1+pad)} ${b.w+pad*2} ${b.h+pad*2}"
      preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path d="${pathD(o, true)}" fill="none" stroke="currentColor" stroke-width="1.25"
      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}

export const Pieces = {
  mount(ctx, ui){
    const panel = document.createElement("details");
    panel.className = "panel"; panel.open = true;
    panel.innerHTML = `<summary>Pieces <span id="pcount" class="mono"></span></summary>
      <div id="pieces" class="pcs"></div>`;
    ui.rail.appendChild(panel);
    list = panel.querySelector("#pieces"); count = panel.querySelector("#pcount");

    Canvas.layer(drawModel);                       // the base layer of every frame
    ctx.onLoad(c => Pieces.render(c));
    Readout.section(ctx => {
      if(ctx.selection.size !== 1 || ctx.primary < 0) return null;
      const p = ctx.pieces()[ctx.primary]; if(!p) return null;
      return {title: pieceLabel(p, ctx.primary), rows: pieceRows(p, (v, d, l) => ctx.len(v, d, l))};
    });
  },

  render(ctx){
    const ps = ctx.pieces();
    count.textContent = ps.length || "";
    list.innerHTML = ps.map((p, i) => {
      const cap = pieceCaption(p, i, (v, d, l) => ctx.len(v, d, l));
      return `<button class="pc" data-i="${i}" aria-pressed="${ctx.selection.has(i)}"
          title="${esc(cap)}" aria-label="${esc(cap)}">${pieceThumb(p)}` +
        (p.qty && +p.qty > 1 ? `<span class="qt mono">×${esc(p.qty)}</span>` : "") + `</button>`;
    }).join("");
    list.querySelectorAll(".pc").forEach(b =>
      b.addEventListener("click", ev => Pieces.pick(ctx, +b.dataset.i, ev, true)));
  },

  /* one place decides what a click means, wherever the click came from */
  pick(ctx, i, ev, fromList){
    if(!ctx.pieces()[i]) return;
    const add = ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey);
    if(add){
      if(ctx.selection.has(i)){
        ctx.selection.delete(i);
        if(ctx.primary === i) ctx.primary = [...ctx.selection].pop() ?? -1;
      } else { ctx.selection.add(i); ctx.primary = i; }
    } else if(ctx.selection.size === 1 && ctx.selection.has(i)){
      ctx.selection.clear(); ctx.primary = -1;            // click again to drop it
    } else {
      ctx.selection.clear(); ctx.selection.add(i); ctx.primary = i;
      if(fromList) Canvas.zoomTo(ctx.pieces()[i].bbox);
    }
    ctx.refresh();
  },
  selectAll(ctx){
    ctx.selection.clear();
    ctx.pieces().forEach((p, i) => ctx.selection.add(i));
    ctx.primary = ctx.pieces().length ? 0 : -1;
    ctx.refresh();
  },
  clear(ctx){ ctx.selection.clear(); ctx.primary = -1; ctx.refresh(); },
  selected: ctx => [...ctx.selection].sort((a,b) => a-b).map(i => ctx.pieces()[i]).filter(p => p && p.bbox),
  hit(ctx, w){ return hitPiece(ctx.pieces(), w, 4/Canvas.pxPerMM()); }
};
