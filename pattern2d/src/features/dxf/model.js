/* Parsed DXF -> the model the viewer works with: a list of pieces, each with its
   paths, points, texts, its cut and sewing outline, bounding box and lengths.

   Everything leaves here in world millimetres — or, when the file declares no unit, in the
   drawing's own units with `units.unit = null` for every reader to see (units.js). INSERT
   placement (base point, scale, rotation), the OCS of 2D entities (extrusion 0,0,−1 mirrors
   them) and the unit are applied ONCE, here, so nothing downstream has to know a DXF existed.

   A path carries three things:
     pts    — the polyline the canvas draws (arcs and splines sampled for the eye only)
     shapes — the exact geometry every measurement uses: a bulge is an arc, an ARC is an
              arc, a SPLINE is a spline (measure_engine.md §5 DXF)
     snap   — the points a click may snap to: what the drafter placed, never the points
              added to draw a curve
   An entity that cannot be turned into exact geometry is left out with a line in
   `warnings` — never approximated in silence (spec A10, A11). */
import {dist, plen, bboxOf} from "../../shared/geom.js";
import {point, line, arc, curve, transform, matrix, sample, pointAt} from "../geometry/model.js";
import {spline} from "../geometry/spline.js";
import {chain, components} from "../geometry/path.js";
import {resolveUnits} from "./units.js";

const RAD = Math.PI/180;
const ID = matrix(1, 0, 0, 1, 0, 0);
/* m1 ∘ m2 — m2 applies first */
const mul = (m1, m2) => matrix(m1.a*m2.a + m1.c*m2.b, m1.b*m2.a + m1.d*m2.b,
                               m1.a*m2.c + m1.c*m2.d, m1.b*m2.c + m1.d*m2.d,
                               m1.a*m2.e + m1.c*m2.f + m1.e, m1.b*m2.e + m1.d*m2.f + m1.f);
const at = (m, x, y) => [m.a*x + m.c*y + m.e, m.b*x + m.d*y + m.f];

/* Arbitrary-axis OCS reduced to what a flat pattern can hold: +Z is the plane itself,
   −Z is the plane seen from behind (x mirrored). Anything else is not in the plane. */
function ocs(ext){
  if(!ext) return ID;
  const [nx, ny, nz] = ext, L = Math.hypot(nx, ny, nz);
  if(L > 0 && Math.abs(nx)/L < 1e-9 && Math.abs(ny)/L < 1e-9) return nz > 0 ? ID : matrix(-1, 0, 0, 1, 0, 0);
  throw new Error(`extrusion (${ext.join(", ")}) không nằm trên mặt phẳng XY — chưa hỗ trợ`);
}

/* where an INSERT puts its block: OCS · move · turn · scale · (− base point) */
function placement(ins, base){
  const r = (ins.rot || 0)*RAD, c = Math.cos(r), s = Math.sin(r);
  const sx = ins.sx ?? 1, sy = ins.sy ?? 1;
  const m = mul(matrix(c, s, -s, c, ins.x || 0, ins.y || 0), matrix(sx, 0, 0, sy, -sx*base[0], -sy*base[1]));
  return mul(ocs(ins.ext), m);
}

/* bulge = tan(θ/4) of the arc from p to q; positive = counter-clockwise */
function bulgeArc(p, q, b){
  const dx = q[0] - p[0], dy = q[1] - p[1], c = Math.hypot(dx, dy);
  const th = 4*Math.atan(b), r = c/(2*Math.sin(th/2)), h = r*Math.cos(th/2);
  const cx = (p[0] + q[0])/2 - h*dy/c, cy = (p[1] + q[1])/2 + h*dx/c;
  const a0 = Math.atan2(p[1] - cy, p[0] - cx);
  return arc(point(cx, cy), Math.abs(r), a0, a0 + th, b > 0);
}

/* one DXF entity -> exact shapes in its own coordinates (the entity's OCS) */
function shapesOf(e){
  switch(e.type){
    case "LINE":
      if(![e.x, e.y, e.x2, e.y2].every(Number.isFinite)) throw new Error("LINE thiếu toạ độ");
      return {shapes: [line(point(e.x, e.y), point(e.x2, e.y2))], closed: false, snap: [[e.x, e.y], [e.x2, e.y2]]};
    case "POLYLINE": {
      const n = e.pts.length;
      if(n < 2) return null;
      if(!e.bulges.some(b => b)) return {shapes: [curve(e.pts, e.closed)], closed: e.closed, snap: e.pts};
      const out = [];
      for(let i = 0; i < (e.closed ? n : n - 1); i++){
        const p = e.pts[i], q = e.pts[(i + 1) % n], b = e.bulges[i];
        if(Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-12) continue;
        out.push(b ? bulgeArc(p, q, b) : line(point(p[0], p[1]), point(q[0], q[1])));
      }
      return {shapes: out, closed: e.closed, snap: e.pts};
    }
    case "ARC": {
      const a = arc(point(e.x, e.y), e.r, (e.a0 ?? 0)*RAD, (e.a1 ?? 360)*RAD, true);
      return {shapes: [a], closed: false, snap: [[pointAt(a, 0).x, pointAt(a, 0).y], [pointAt(a, 1).x, pointAt(a, 1).y]]};
    }
    case "CIRCLE":
      return {shapes: [arc(point(e.x, e.y), e.r, 0, 2*Math.PI, true)], closed: true, snap: [[e.x + e.r, e.y]]};
    case "SPLINE": {
      if(!e.ctrl.length) throw new Error(`SPLINE chỉ có ${e.fit.length} fit point, không có control point — dựng lại từ fit point là một phép nội suy khác, chưa hỗ trợ`);
      const s = spline({degree: e.degree, knots: e.knots, ctrl: e.ctrl, weights: e.weights.length ? e.weights : null});
      const a = pointAt(s, 0), b = pointAt(s, 1);
      return {shapes: [s], closed: Math.hypot(a.x - b.x, a.y - b.y) < 1e-9, snap: [[a.x, a.y], [b.x, b.y]]};
    }
  }
  return null;
}

/* ordered drawing points of a run of shapes */
function drawn(shapes){
  const out = [];
  for(const s of shapes)
    for(const q of s.kind === "line" ? [[s.a.x, s.a.y], [s.b.x, s.b.y]] : sample(s, 0.05)){
      const last = out[out.length - 1];
      if(!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-9) out.push([q[0], q[1]]);
    }
  return out;
}

export function buildModel(dxf, opts = {}){
  const units = resolveUnits(dxf, opts.unit);
  const U = matrix(units.scale, 0, 0, units.scale, 0, 0);
  const warnings = (dxf.warnings || []).slice();
  const pieces = [], loose = {paths:[], points:[], texts:[]};

  const place = (ents, M, where) => {
    const paths = [], points = [], texts = [];
    const k = Math.sqrt(Math.abs(M.a*M.d - M.b*M.c)) || 1;
    for(const e of ents){
      try{
        if(e.type === "POINT"){
          if(Number.isFinite(e.x)){ const [x, y] = at(M, e.x, e.y || 0); points.push({layer: e.layer || "0", x, y}); }
          continue;
        }
        if(e.type === "TEXT"){
          if(e.text && Number.isFinite(e.x)){ const [x, y] = at(M, e.x, e.y || 0); texts.push({layer: e.layer || "0", x, y, h: (e.h || 5)*k, text: e.text}); }
          continue;
        }
        if(e.type === "INSERT"){ warnings.push(`${where}: INSERT lồng trong block (${e.block}) chưa hỗ trợ — bỏ qua`); continue; }
        const g = shapesOf(e);
        if(!g || !g.shapes.length) continue;
        /* LINE, POINT and SPLINE are world entities; the 2D ones live in their OCS */
        const W = e.type === "LINE" || e.type === "SPLINE" ? M : mul(M, ocs(e.ext));
        const shapes = g.shapes.map(s => transform(s, W));
        /* a plain polyline is drawn with the vertices exactly as the file lists them */
        const pts = e.type === "POLYLINE" && shapes.length === 1 && shapes[0].kind === "curve"
          ? e.pts.map(([x, y]) => at(W, x, y)) : drawn(shapes);
        if(pts.length === 1) pts.push(pts[0].slice());     // zero length (a spline on one spot): keep it, it is in the file
        paths.push({layer: e.layer || "0", closed: g.closed, pts, shapes, snap: g.snap.map(([x, y]) => at(W, x, y))});
      }catch(err){
        const on = e.layer ? " (layer " + e.layer + ")" : "";
        warnings.push(`${where}: ${e.type}${on} bị bỏ — ${err.message}`);
      }
    }
    return {paths, points, texts};
  };

  const inserts = dxf.entities.filter(e => e.type === "INSERT" && dxf.blocks[e.block]);
  for(const ins of inserts){
    const b = dxf.blocks[ins.block];
    let M;
    try{ M = mul(U, placement(ins, b.base || [0, 0])); }
    catch(err){ warnings.push(`INSERT ${ins.block} bị bỏ — ${err.message}`); continue; }
    const g = place(b.ents, M, `block ${b.name}`);
    if(!g.paths.length && !g.points.length) continue;
    pieces.push(Object.assign({name:b.pieceName, vn:b.vn, blockName:b.name, qty:b.qty,
                               category:b.category, sample:b.sample}, g));
  }
  const g = place(dxf.entities.filter(e => e.type !== "INSERT"), U, "modelspace");
  loose.paths = g.paths; loose.points = g.points; loose.texts = g.texts;
  if(!pieces.length && (loose.paths.length || loose.points.length))
    pieces.push({name:"(whole drawing)", blockName:"", qty:"", category:"", sample:"",
                 paths:loose.paths, points:loose.points, texts:loose.texts});
  for(const p of pieces) summarize(p);
  return {pieces, loose, header:dxf.header, blocks:dxf.blocks, units, warnings};
}

/* The layers a seam is drawn on — 14 is the sew line of ASTM D6673 / AAMA (Bianca, SofyLift, the strike-cost files),
   8 is "internal lines" there, yet Richpeace factories (3380) and BLOCK_36C put the seam on it (CLAUDE.md §8) — and
   how near the cut line a seam-layer line lies, all along, to be the piece's seam. Edit reads the same two numbers
   (edit/relate.js, edit.md C12, E13); the readout's Sewing line and Edges read them here (edges/edges.md §2). */
export const SEW_LAYERS = new Set(["8", "14"]);
export const SEW_BAND = 30;      // mm

/* What every reader asks of a piece — its cut and sewing outline, their lengths, its box —
   worked out from its paths. Run once after reading, and again after every Edit (edit.md). */
export function summarize(p){
  const cut = outline(p.paths, "1"), sew = sewRing(p.paths, cut);
  p.cut = cut ? cut.pts : null; p.sew = sew ? sew.pts : null;
  p.cutLen = cut ? cut.len : 0;
  p.sewLen = sew ? sew.len : 0;
  p.cutClosed = !!(cut && cut.closed);
  p.sewLayer = sew ? sew.layer : null;
  const all = p.paths.flatMap(q => q.pts).concat(p.points.map(q => [q.x,q.y]));
  p.bbox = bboxOf(all);
  return p;
}

/* A piece's SEWING line (edges/edges.md §2, G2): a closed run on a seam layer that goes round the piece — within
   SEW_BAND of the cut line all along, at least half as long as it — the longest such run. An open line or a small
   ring on those layers is a shape drawn on the piece (a placement mark, a pad outline, a tick): taken as the sewing
   line, it made Edges and the Sewing line row measure something else on 370 of 714 library pieces (2026-09-24).
   With no cut line to go round, the longest closed run. */
function sewRing(paths, cut){
  const ring = cut && cut.closed ? cut.pts : null, rb = ring && bboxOf(ring);
  const near = q => q[0] >= rb.x0 - SEW_BAND && q[0] <= rb.x1 + SEW_BAND && q[1] >= rb.y0 - SEW_BAND && q[1] <= rb.y1 + SEW_BAND
                    && toRing(q, ring) <= SEW_BAND;
  let best = null;
  for(const layer of SEW_LAYERS){
    const mine = paths.filter(q => q.layer === layer);
    if(!mine.length) continue;
    for(const group of pathGroups(mine)){
      let run;
      try{ run = runOf(group.map(i => mine[i])); }catch(e){ continue; }
      if(!run.closed || !(run.len > 0)) continue;
      if(ring && !(run.len >= 0.5*cut.len && run.pts.every(near))) continue;
      if(!best || run.len > best.len) best = {...run, layer};
    }
  }
  return best;
}
/* distance from q to a closed ring of vertices — a plain loop over its segments */
function toRing(q, pts){
  let best = Infinity;
  for(let i = 0, n = pts.length; i < n; i++){
    const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], dd = dx*dx + dy*dy;
    const t = dd ? Math.max(0, Math.min(1, ((q[0] - a[0])*dx + (q[1] - a[1])*dy)/dd)) : 0;
    best = Math.min(best, Math.hypot(q[0] - a[0] - dx*t, q[1] - a[1] - dy*t));
  }
  return best;
}

/* Paths that touch end to end, as groups of indices. A closed path is a group of its own:
   a ring has no ends, and a notch starting on its first vertex does not make it a fork. */
export function pathGroups(paths){
  const open = [], groups = [];
  paths.forEach((q, i) => (q.closed ? groups.push([i]) : open.push(i)));
  const ends = open.map(i => { const sh = paths[i].shapes, a = pointAt(sh[0], 0), b = pointAt(sh[sh.length - 1], 1);
                               return [[a.x, a.y], [b.x, b.y]]; });
  for(const g of components(ends)) groups.push(g.map(k => open[k]));
  return groups;
}

/* A piece's cut (or sewing) line: the longest run of that layer's paths that chains into
   one path — a closed one if there is any. Built from the exact shapes, so a cut line of
   LINE + ARC entities measures 400 + 100π, not the length of its longest LINE doubled. */
/* Paths that chain into one, as that path: its chain (the exact shapes) and the vertices it is drawn with —
   what a piece's cut line is (below), and what a notch placed from a corner measures along (draw/piece.md M15).
   Throws when the paths do not chain. */
export function runOf(members){
  const ch = chain(members.flatMap(q => q.shapes));
  const pts = members.length === 1 && members[0].shapes.length === 1 && members[0].shapes[0].kind === "curve"
    ? members[0].pts : drawn(ch.parts.map(part => part.shape));
  return {ch, pts, len: ch.total, closed: ch.closed};
}
function outline(paths, layer){
  const mine = paths.filter(q => q.layer === layer);
  if(!mine.length) return null;
  let best = null;
  for(const group of pathGroups(mine)){
    let cand = null;
    try{ cand = runOf(group.map(i => mine[i])); }catch(e){ continue; }
    if(!best || (cand.closed && !best.closed) || (cand.closed === best.closed && cand.len > best.len)) best = cand;
  }
  if(best) return best;
  const longest = mine.slice().sort((a, b) => plen(b.pts) - plen(a.pts))[0];     // nothing chains: say what is drawn
  return {pts: longest.pts, len: plen(longest.pts), closed: false};
}
