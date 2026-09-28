/* Edges: name every edge of the selected piece and print its length, on the canvas
   and in the readout (spec: edges/edges.md). The label sits outside the outline, on the
   normal at the middle of the edge — half its length along it — so it never covers the
   line it measures, nor sits on a corner two edges share. */
import {el, MONO} from "../../shared/dom.js";
import {pointInPoly} from "../../shared/geom.js";
import {Canvas} from "../canvas/canvas.js";
import {Readout} from "../readout/readout.js";
import {Pieces} from "../pieces/pieces.js";
import {segmentEdges, edgeLabelAt, edgeLetter} from "./segment.js";

let on = false, button = null;

/* The line Edges splits (G1): the piece's sewing line while its layer is on, else its cut line while layer 1
   is on, else whichever the piece has — with its name, because the two differ by the allowance at every edge
   and the panel has to say which one it measured. `layersOn` absent: every layer on. */
export function edgeLine(p, layersOn){
  if(!p) return null;
  const shown = layer => !layersOn || layersOn[layer] !== false;
  const sew = p.sew && {pts: p.sew, closed: true, name: "đường may"};
  const cut = p.cut && {pts: p.cut, closed: p.cutClosed !== false, name: "đường cắt"};
  if(sew && shown(p.sewLayer || "8")) return sew;
  if(cut && shown("1")) return cut;
  return sew || cut || null;
}

/* the readout block for a piece, for a length formatter L(mm, d, label) — null when the
   piece has no outline to split */
export function edgeReadout(p, L, layersOn){
  const o = edgeLine(p, layersOn);
  if(!o) return null;
  const segs = segmentEdges(o.pts.slice(), undefined, undefined, undefined, o.closed);
  return {
    section: `Edges · ${o.name}`,
    rows: segs.map((s, j) => [edgeLetter(j), L(s.len), true]),
    total: ["Total", L(segs.reduce((a,s) => a+s.len, 0))]
  };
}

export const Edges = {
  mount(ctx, ui){
    button = document.createElement("button");
    button.className = "btn"; button.id = "edges"; button.textContent = "Edges";
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => Edges.toggle(ctx));
    ui.tools.appendChild(button);

    Canvas.layer((root, ppm, c) => {
      if(!on || c.primary < 0) return;
      const p = c.pieces()[c.primary];
      if(p) drawEdges(root, edgeLine(p, c.layersOn), ppm, (v, d, l) => c.len(v, d, l));
    });
    Readout.section(c => {
      if(!on || c.primary < 0) return null;
      const p = c.pieces()[c.primary];
      return p ? edgeReadout(p, (v, d, l) => c.len(v, d, l), c.layersOn) : null;
    });
    ctx.onLoad(() => { /* selection is reset by the app; the toggle survives a reload */ });
  },

  toggle(ctx){
    on = !on;
    button.setAttribute("aria-pressed", on);
    button.classList.toggle("on", on);
    /* Edges needs a piece to work on — pick the first one rather than show nothing */
    if(on && ctx.primary < 0 && ctx.pieces().length){
      ctx.select([0], 0);
      Canvas.zoomTo(ctx.pieces()[0].bbox);
    }
    ctx.refresh();
  },
  isOn: () => on
};

function drawEdges(root, o, ppm, L){
  if(!o) return;
  const poly = o.pts, segs = segmentEdges(poly.slice(), undefined, undefined, undefined, o.closed);
  const g = el("g", {});
  segs.forEach((s, j) => {
    const {at: mid, dir} = edgeLabelAt(s.pts);
    let nx = dir[1], ny = -dir[0];
    if(pointInPoly(poly, [mid[0]+nx*2, mid[1]+ny*2])){ nx = -nx; ny = -ny; }
    const off = 16, lx = mid[0]+nx*off, ly = mid[1]+ny*off;
    g.appendChild(el("line", {x1:mid[0], y1:-mid[1], x2:lx, y2:-ly,
      stroke:"var(--ink-3)", "stroke-width":1, "vector-effect":"non-scaling-stroke"}));
    g.appendChild(el("circle", {cx:mid[0], cy:-mid[1], r:2.5/ppm, fill:"var(--accent)"}));
    const label = `${edgeLetter(j)} ${L(s.len)}`;
    const fs = 11/ppm, w = label.length*fs*0.62, h = fs*1.55;
    g.appendChild(el("rect", {x:lx-w/2, y:-ly-h/2, width:w, height:h, rx:h*0.2,
      fill:"var(--bg)", stroke:"var(--rule)", "stroke-width":1, "vector-effect":"non-scaling-stroke"}));
    g.appendChild(Object.assign(el("text", {x:lx, y:-ly+fs*0.36, "font-size":fs,
      "text-anchor":"middle", fill:"var(--accent)",
      "font-family":MONO}), {textContent:label}));
  });
  root.appendChild(g);
}
