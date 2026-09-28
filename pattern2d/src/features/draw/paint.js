/* How the Vẽ drawing is painted on the canvas — one SVG group a frame (spec: draw/draw.md V3 · V5 · V10).

   The tool (draw.js) decides WHAT is on screen — which shapes, where Arrange shows them, what is
   selected, grabbed, hovered, the ghost of the next click, the snap mark; this file only turns that
   scene into strokes and dots. Everything arrives in canvas coordinates (file frame + the piece's
   Arrange offset); nothing here reads a model, a selection or the pointer. */
import {el} from "../../shared/dom.js";
import {entityShape} from "../geometry/entity.js";
import {sample} from "../geometry/model.js";

export const closedOf = e => e.type === "rect" || e.type === "polygon" || e.type === "circle" || e.type === "path";

/* scene: {shapes: [{shown, tok, layer}], labels: [{at, text}], on, selected: [{shown, handles, active}], hover,
           ghost, dots: [[x, y]], pen: {pts, kinds, closing} | null, snap: {kind, at} | null} — `shown` is an
           entity as it is shown */
export function paintDrawing(root, ppm, scene){
  const g = el("g", {}), tol = Math.max(0.001, Math.min(1, 0.4/ppm));
  const trace = (s, closed) => { const pts = sample(s, tol); return "M" + pts.map(q => `${q[0]},${-q[1]}`).join("L") + (closed ? "Z" : ""); };
  const stroke = (d, color, w, dash, op = 1) => g.appendChild(el("path", {d, fill: "none", stroke: color, "stroke-width": w,
    "stroke-dasharray": dash || null, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: op, "vector-effect": "non-scaling-stroke"}));
  const dot = (at, r, color, fill, sq) => g.appendChild(sq
    ? el("rect", {x: at[0] - r/ppm, y: -at[1] - r/ppm, width: 2*r/ppm, height: 2*r/ppm, fill: fill || "var(--bg)", stroke: color, "stroke-width": 1.3, "vector-effect": "non-scaling-stroke"})
    : el("circle", {cx: at[0], cy: -at[1], r: r/ppm, fill: fill || "var(--bg)", stroke: color, "stroke-width": 1.3, "vector-effect": "non-scaling-stroke"}));

  /* a notch or a mark: a ring, the same size on screen at any zoom */
  const mark = (at, color, r = 3.2) => g.appendChild(el("circle", {cx: at[0], cy: -at[1], r: r/ppm, fill: "none", stroke: color,
    "stroke-width": 1.6, "vector-effect": "non-scaling-stroke"}));
  for(const s of scene.shapes){
    if(s.shown.type === "point"){ mark(s.shown.p, `var(${s.tok})`); continue; }
    stroke(trace(entityShape(s.shown), closedOf(s.shown)), `var(${s.tok})`, s.layer === "1" ? 1.8 : 1.4, s.layer === "8" ? "5 3" : null);
  }
  for(const l of scene.labels || [])                                                  // a drawn piece's name, in its middle
    g.appendChild(Object.assign(el("text", {x: l.at[0], y: -l.at[1], "font-size": 11/ppm, "text-anchor": "middle", fill: "var(--l-text)",
      "font-family": "inherit", "pointer-events": "none"}), {textContent: l.text}));
  if(scene.on){
    for(const s of scene.selected){
      const e = s.shown;
      if(e.type === "point"){ mark(e.p, "var(--accent)", 4.4); continue; }
      stroke(trace(entityShape(e), closedOf(e)), "var(--accent)", 2.6, null, 0.8);
      if(e.type === "curve"){                                                         // the control arms
        stroke(`M${e.p0[0]},${-e.p0[1]}L${e.c1[0]},${-e.c1[1]}`, "var(--accent)", 1, "3 3", 0.7);
        stroke(`M${e.p3[0]},${-e.p3[1]}L${e.c2[0]},${-e.c2[1]}`, "var(--accent)", 1, "3 3", 0.7);
      }
      for(const h of s.handles){
        if(!h.at) continue;
        const grabbed = s.active === h.name, ctl = h.name === "c1" || h.name === "c2";
        dot(h.at, grabbed ? 4.2 : ctl ? 3.2 : 3, "var(--accent)", grabbed ? "var(--accent)" : null, h.role === "position" && !ctl);
      }
    }
    if(scene.hover){
      if(scene.hover.type === "point") mark(scene.hover.p, "var(--accent)", 4);
      else stroke(trace(entityShape(scene.hover), closedOf(scene.hover)), "var(--accent)", 2, null, 0.6);
    }
    if(scene.ghost) stroke(trace(entityShape(scene.ghost), closedOf(scene.ghost)), "var(--accent)", 1.4, "4 3", 0.9);     // V3
    for(const c of scene.dots) dot(c, 3, "var(--accent)", "var(--accent)");
    if(scene.pen){                                                                    // the piece being drawn: corners square, curve points round
      scene.pen.pts.forEach((p, i) => dot(p, i === 0 && scene.pen.closing ? 5 : 3.2, "var(--accent)", i === 0 && scene.pen.closing ? "var(--accent)" : null,
                                          scene.pen.kinds[i] === "turn"));
    }
    const sn = scene.snap;
    if(sn){
      if(sn.kind === "point") dot(sn.at, 5, "var(--l-notch)", "none");
      else g.appendChild(el("path", {d: `M${sn.at[0] - 5/ppm},${-sn.at[1]}L${sn.at[0]},${-sn.at[1] - 5/ppm}L${sn.at[0] + 5/ppm},${-sn.at[1]}L${sn.at[0]},${-sn.at[1] + 5/ppm}Z`,
        fill: "none", stroke: "var(--l-notch)", "stroke-width": 1.4, "vector-effect": "non-scaling-stroke"}));
    }
  }
  root.appendChild(g);
}
