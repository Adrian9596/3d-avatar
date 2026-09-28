/* How a piece appears on the canvas. One selected piece is drawn in full, in its
   layer colours; everything else collapses to a single quiet outline so it reads
   as context instead of competing for attention. */
import {el, MONO} from "../../shared/dom.js";
import {layerMeta} from "../dxf/aama.js";
import {SEW_LAYERS} from "../dxf/model.js";

export const pathD = (pts, closed) => "M" + pts.map(q => `${q[0]},${-q[1]}`).join("L") + (closed ? "Z" : "");

/* weight hierarchy inside a piece: cut line leads, sewing line follows (8, or 14 — ASTM's), the rest is trim */
export const strokeW = (layer, hot) => layer === "1" ? (hot ? 1.9 : 1.5) : SEW_LAYERS.has(layer) ? 1 : 0.9;

/* a piece that is only context — one outline, one quiet colour, no points or text */
export function ghostPiece(p, layersOn){
  const g = el("g", {});
  const main = (layersOn["1"] && p.cut) || (layersOn[p.sewLayer || "8"] && p.sew) || p.cut || p.sew;
  const outlines = main ? [{pts:main, closed:true}] : p.paths.filter(q => layersOn[q.layer]);
  for(const o of outlines)
    g.appendChild(el("path", {d:pathD(o.pts, o.closed), fill:"none", stroke:"var(--ghost)",
      "stroke-width":1, "stroke-linejoin":"round", "vector-effect":"non-scaling-stroke"}));
  return g;
}

/* the highlight: a faint accent wash inside the active outline, under its own strokes */
export function tintPiece(g, p){
  const o = p.cut || p.sew; if(!o) return;
  g.appendChild(el("path", {d:pathD(o, true), fill:"var(--halo)", stroke:"none"}));
}

/* the base draw layer: every piece of the model, at the current zoom */
export function drawModel(root, ppm, ctx){
  const model = ctx.model, layersOn = ctx.layersOn;
  const groups = model.pieces.length ? model.pieces : [model.loose];
  const picked = model.pieces.length ? ctx.selection : new Set();
  const hot = picked.size > 0;

  if(hot)
    groups.forEach((p, i) => { if(!picked.has(i)) root.appendChild(ghostPiece(p, layersOn)); });

  groups.forEach((p, i) => {
    if(hot && !picked.has(i)) return;                 // context is already drawn
    const g = el("g", {});
    if(hot) tintPiece(g, p);                          // the highlight itself
    for(const path of p.paths){
      if(!layersOn[path.layer]) continue;
      const {tok} = layerMeta(path.layer, {lines: true});
      g.appendChild(el("path", {d:pathD(path.pts, path.closed), fill:"none", stroke:`var(${tok})`,
        "stroke-width": strokeW(path.layer, hot),
        "stroke-dasharray": SEW_LAYERS.has(path.layer) ? "5 3" : null,
        "stroke-linejoin":"round", "stroke-linecap":"round",
        "vector-effect":"non-scaling-stroke"}));
    }
    for(const pt of p.points){
      if(!layersOn[pt.layer]) continue;
      const {tok} = layerMeta(pt.layer);
      const rr = (pt.layer === "4" ? 2.6 : pt.layer === "2" ? 2.0 : 1.3)/ppm;
      g.appendChild(el("circle", {cx:pt.x, cy:-pt.y, r:rr, fill:`var(${tok})`}));
    }
    for(const tx of p.texts){
      if(!layersOn[tx.layer]) continue;
      const size = Math.max(tx.h, 3);
      if(size*ppm < 6) continue;
      g.appendChild(Object.assign(el("text", {x:tx.x, y:-tx.y, "font-size":size,
        fill:"var(--l-text)", "font-family":MONO}), {textContent:tx.text}));
    }
    root.appendChild(g);
  });
}
