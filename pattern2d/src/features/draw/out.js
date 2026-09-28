/* What Xuất DXF writes of the Vẽ drawing (spec: draw/draw.md V13 · draw/piece.md M10) — the drawing put
   into the open model as a NEW model; the open one is never touched (V14).

   A shape drawn into a piece of the file goes into that piece's block, on its layer. A shape of its own
   goes into one block, HINH_VE. A PIECE drawn in Vẽ is a block of its own, made the way BLOCK_36C's are:
   one closed cut line, its turn and curve points, notches, the grainline and the AAMA text block. */
import {entityShape} from "../geometry/entity.js";
import {transform, translation, curve} from "../geometry/model.js";
import {bboxOf} from "../../shared/geom.js";
import {pieceOffset} from "./flow.js";
import {PIECE_LAYER, TURN_LAYER, CURVE_LAYER, NOTCH_LAYER, GRAIN_LAYER, PIECE_TEXT_LAYER, outlineOf, sampleSizeOf, blockNameFor} from "./piece.js";

/* the block shapes that belong to no piece go into, when written out (V13) */
export const HINH_VE = "HINH_VE";

const TEXT_H = 6, TEXT_STEP = 8.4, TEXT_GAP = 10;               // mm — the text block of BLOCK_36C (P11)
const moved = (s, off) => off[0] || off[1] ? transform(s, translation(off[0], off[1])) : s;
/* ── Xuất DXF (V13) ───────────────────────────────────────────────────────────────
   a drawn shape as a path of its piece, in canvas coordinates (+ off): write.js takes the piece's
   Arrange offset back out, so what lands in the file is the file frame. A Line is written as a LINE, a
   Rectangle or Polygon as its vertices, a Curve or Circle as its exact shape — write.js samples it */
export function drawnPath(entity, layer, off){
  const s = moved(entityShape(entity), off);
  const pts = s.kind === "line" ? [[s.a.x, s.a.y], [s.b.x, s.b.y]] : s.kind === "curve" ? s.pts.map(q => q.slice()) : [];
  return {layer, closed: entity.type === "rect" || entity.type === "polygon" || entity.type === "circle" || entity.type === "path", pts, shapes: [s], snap: [], drawn: true};
}
/* a drawn Point (a notch, a mark) is a POINT of the file, not a path */
const drawnPoint = (entity, layer, off) => ({layer, x: entity.p[0] + off[0], y: entity.p[1] + off[1]});
const isPoint = d => d.entity.type === "point";
/* the model with the drawing in it — a new object; the open model is not touched (V14). drawn:
   [{entity, pi, layer}], pi = -1 for a shape of its own (block HINH_VE); drawnPieces: the pieces drawn in
   Vẽ, each [{n, name, qty, category, blockName, outline, grain, notches, shapes}] (piece.md M10) */
export function withDrawings(model, drawn, drawnPieces = []){
  if((!drawn || !drawn.length) && !drawnPieces.length) return model;
  drawn = drawn || [];
  const pieces = model.pieces.slice(), own = [];
  const byPiece = new Map();
  for(const d of drawn){
    if(d.pi >= 0 && pieces[d.pi]){ if(!byPiece.has(d.pi)) byPiece.set(d.pi, []); byPiece.get(d.pi).push(d); }
    else own.push(d);
  }
  for(const [pi, list] of byPiece){
    const p = pieces[pi], off = pieceOffset(p);
    const paths = list.filter(d => !isPoint(d)).map(d => drawnPath(d.entity, d.layer, off));
    const points = list.filter(isPoint).map(d => drawnPoint(d.entity, d.layer, off));
    /* a drawing with no block is written from its one piece (write.js), so the shapes go into that piece like any other */
    pieces[pi] = {...p, paths: [...p.paths, ...paths], points: [...(p.points || []), ...points]};
  }
  const taken = new Set(pieces.map(p => p.blockName).filter(Boolean));
  if(own.length){
    let name = HINH_VE, k = 2;
    while(taken.has(name)) name = `${HINH_VE}_${k++}`;
    taken.add(name);
    pieces.push({name: "Hình vẽ", blockName: name, qty: "1", category: "", sample: "", ox: 0, oy: 0, texts: [],
                 points: own.filter(isPoint).map(d => drawnPoint(d.entity, d.layer, [0, 0])),
                 paths: own.filter(d => !isPoint(d)).map(d => drawnPath(d.entity, d.layer, [0, 0]))});
  }
  if(drawnPieces.length){
    const sample = sampleSizeOf(model);
    for(const dp of drawnPieces){
      const blockName = !dp.blockName || taken.has(dp.blockName) ? blockNameFor(dp.n, taken) : dp.blockName;   // never a file's block name
      taken.add(blockName);
      pieces.push(pieceBlock({...dp, blockName}, sample));
    }
  }
  return {...model, pieces};
}

/* A piece drawn in Vẽ as a block (M10): ONE closed polyline on layer 1 — the outline's own samples,
   written as they are — a POINT on layer 2 at every turn point and on layer 3 at every other vertex (as
   BLOCK_36C does), a POINT on layer 4 per notch, the grainline on layer 7, the shapes drawn into it, and
   the AAMA text block on layer 8 above it. Canvas and file are one frame for it: Arrange never moves it. */
export function pieceBlock(p, sample){
  const o = outlineOf(p.outline), ring = o.pts.map(q => q.slice());
  const paths = [{layer: PIECE_LAYER, closed: true, pts: ring, shapes: [curve(ring, true)], snap: ring.map(q => q.slice()), drawn: true}];
  if(p.grain) paths.push(drawnPath(p.grain, GRAIN_LAYER, [0, 0]));
  const shapes = p.shapes || [];
  for(const d of shapes) if(!isPoint(d)) paths.push(drawnPath(d.entity, d.layer, [0, 0]));
  const points = ring.map((q, i) => ({layer: o.turn[i] ? TURN_LAYER : CURVE_LAYER, x: q[0], y: q[1]}));
  for(const n of p.notches || []) points.push({layer: NOTCH_LAYER, x: n.p[0], y: n.p[1]});
  for(const d of shapes) if(isPoint(d)) points.push(drawnPoint(d.entity, d.layer, [0, 0]));
  const b = bboxOf(ring), field = (k, v) => v ? `${k}: ${v}` : `${k}:`;
  const lines = [field("Piece Name", p.name), field("SAMPLE SIZE", sample), "ANNOTATION:", field("CATEGORY", p.category), field("QUANTITY", p.qty)];
  const texts = lines.map((text, i) => ({layer: PIECE_TEXT_LAYER, x: b.x0, y: b.y1 + TEXT_GAP + TEXT_STEP*i, h: TEXT_H, text}));
  return {name: p.name, blockName: p.blockName, qty: p.qty, category: p.category, sample, ox: 0, oy: 0, texts, points, paths, drawn: true};
}
