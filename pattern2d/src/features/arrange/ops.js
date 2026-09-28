/* Every arrange command, as arithmetic on pieces and their boxes.
   A piece keeps the geometry the DXF gave it: arranging translates it in place and
   records how far it has travelled (ox/oy), so any layout can be undone and reset
   back to the file. No DOM here — this is the part worth testing. */
import {unionBox, cxOf, cyOf} from "../../shared/geom.js";
import {transform, translation} from "../geometry/model.js";

/* the one primitive every command is built from. The exact shapes and the snap points
   travel with the drawn polyline: a measurement reads the shapes, and a piece whose outline
   moved while its geometry stayed would be measured where it no longer is. The cut and
   sewing outlines too: one drawn as a single polyline IS that path's array and has just
   moved; one chained from several entities is an array of its own, and left behind it
   kept Edges' labels, the highlight and the click that picks the piece where the piece had
   been (edges/edges.md G6 — 262 of 711 library pieces). */
export function translatePiece(p, dx, dy){
  if(!p || (!dx && !dy)) return;
  const m = translation(dx, dy);
  for(const path of p.paths){
    for(const q of path.pts){ q[0] += dx; q[1] += dy; }
    if(path.shapes) path.shapes = path.shapes.map(s => transform(s, m));
    if(path.snap) path.snap = path.snap.map(([x, y]) => [x + dx, y + dy]);
  }
  const own = new Set(p.paths.map(path => path.pts));
  for(const k of ["cut", "sew"]) if(p[k] && !own.has(p[k])) p[k] = p[k].map(([x, y]) => [x + dx, y + dy]);
  for(const q of p.points){ q.x += dx; q.y += dy; }
  for(const t of p.texts){ t.x += dx; t.y += dy; }
  p.ox = (p.ox||0) + dx; p.oy = (p.oy||0) + dy;
  const b = p.bbox;
  if(b){ b.x0 += dx; b.x1 += dx; b.y0 += dy; b.y1 += dy; }   // size is unchanged
}

export const boxesOf = pieces => pieces.map(p => p.bbox);

/* align — the union box of the selection is the reference edge */
export function alignPieces(pieces, mode){
  if(pieces.length < 2) return false;
  const u = unionBox(boxesOf(pieces));
  for(const p of pieces){
    const b = p.bbox;
    const d = mode === "left"   ? [u.x0-b.x0, 0]
            : mode === "right"  ? [u.x1-b.x1, 0]
            : mode === "cx"     ? [cxOf(u)-cxOf(b), 0]
            : mode === "top"    ? [0, u.y1-b.y1]
            : mode === "bottom" ? [0, u.y0-b.y0]
            :                     [0, cyOf(u)-cyOf(b)];
    translatePiece(p, d[0], d[1]);
  }
  return true;
}

/* distribute — equal gaps, the two outermost pieces pinned where they are */
export function distributePieces(pieces, axis){
  if(pieces.length < 3) return false;
  const h = axis === "h";
  const lo = p => h ? p.bbox.x0 : p.bbox.y0, hi = p => h ? p.bbox.x1 : p.bbox.y1;
  const size = p => h ? p.bbox.w : p.bbox.h;
  const row = pieces.slice().sort((a,b) => lo(a)-lo(b));
  const span = hi(row[row.length-1]) - lo(row[0]);
  const gap = (span - row.reduce((t,p) => t+size(p), 0)) / (row.length-1);
  let at = lo(row[0]);
  for(const p of row){
    const d = at - lo(p);
    translatePiece(p, h ? d : 0, h ? 0 : d);
    at += size(p) + gap;
  }
  return true;
}

/* lay out — rebuild the block from its own top-left corner at a fixed gap */
export function packPieces(pieces, kind, gap, aspect = 1){
  if(pieces.length < 2) return false;
  const u = unionBox(boxesOf(pieces));
  if(kind === "row"){                                   // one row, tops aligned
    let x = u.x0;
    for(const p of pieces.slice().sort((a,b) => a.bbox.x0-b.bbox.x0)){
      translatePiece(p, x-p.bbox.x0, u.y1-p.bbox.y1);
      x += p.bbox.w + gap;
    }
  } else if(kind === "col"){                            // one column, left edges aligned
    let y = u.y1;
    for(const p of pieces.slice().sort((a,b) => b.bbox.y1-a.bbox.y1)){
      translatePiece(p, u.x0-p.bbox.x0, y-p.bbox.y1);
      y -= p.bbox.h + gap;
    }
  } else {                                              // shelves: tallest first, rows of a
    const items = pieces.slice().sort((a,b) => b.bbox.h-a.bbox.h);   // roughly stage-shaped block
    const area = items.reduce((t,p) => t + (p.bbox.w+gap)*(p.bbox.h+gap), 0);
    const wide = Math.max(Math.sqrt(area*aspect)*1.15, ...items.map(p => p.bbox.w));
    let x = u.x0, y = u.y1, rowH = 0;
    for(const p of items){
      if(x > u.x0 && (x - u.x0) + p.bbox.w > wide){ x = u.x0; y -= rowH + gap; rowH = 0; }
      translatePiece(p, x-p.bbox.x0, y-p.bbox.y1);
      x += p.bbox.w + gap; rowH = Math.max(rowH, p.bbox.h);
    }
  }
  return true;
}

/* snapping — while dragging, the moving block's edges and centres look for the same
   lines on the pieces that stay put: the guide drawn is the relation being held. `tol` is the
   drawing's snap tolerance in mm (shared/units.md §3); null — a file with no unit — snaps
   nothing, rather than snapping by a guessed distance */
export function snapOffset(u0, dx, dy, others, tol){
  if(tol === null || tol === undefined) return {dx, dy, guides: []};
  const xs = [u0.x0+dx, cxOf(u0)+dx, u0.x1+dx], ys = [u0.y0+dy, cyOf(u0)+dy, u0.y1+dy];
  let bx = null, by = null;
  for(const b of others){
    if(!b) continue;
    for(const t of [b.x0, cxOf(b), b.x1]) for(const v of xs){
      const d = t-v; if(Math.abs(d) <= tol && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = {d, at:t, b};
    }
    for(const t of [b.y0, cyOf(b), b.y1]) for(const v of ys){
      const d = t-v; if(Math.abs(d) <= tol && (!by || Math.abs(d) < Math.abs(by.d))) by = {d, at:t, b};
    }
  }
  const ox = dx + (bx ? bx.d : 0), oy = dy + (by ? by.d : 0);
  const guides = [];
  if(bx) guides.push({x:bx.at, a:Math.min(bx.b.y0, u0.y0+oy), b:Math.max(bx.b.y1, u0.y1+oy)});
  if(by) guides.push({y:by.at, a:Math.min(by.b.x0, u0.x0+ox), b:Math.max(by.b.x1, u0.x1+ox)});
  return {dx:ox, dy:oy, guides};
}

/* the gaps between neighbours, in reading order — what the readout reports */
export function gapsBetween(pieces, axis){
  const h = axis === "h";
  const row = pieces.slice().sort((a,b) => h ? a.bbox.x0-b.bbox.x0 : b.bbox.y1-a.bbox.y1);
  const gaps = [];
  for(let i = 1; i < row.length; i++){
    const a = row[i-1].bbox, b = row[i].bbox;
    gaps.push(h ? b.x0-a.x1 : a.y0-b.y1);
  }
  return gaps;
}

/* undo keeps only the offsets — the cheapest complete description of a layout — each with the piece itself, not its place
   in the list: a piece deleted since is skipped, the ones after it are found where they are now, and one put back by ⌘Z
   goes home too (pieces/remove.md R5) */
export const snapshot = pieces => pieces.map(p => [p, p.ox||0, p.oy||0]);
export function restore(pieces, snap){
  const here = new Set(pieces);
  for(const [p, ox, oy] of snap) if(here.has(p)) translatePiece(p, ox-(p.ox||0), oy-(p.oy||0));
}
export function resetPieces(pieces){
  const moved = pieces.filter(p => p.ox || p.oy);
  for(const p of moved) translatePiece(p, -(p.ox||0), -(p.oy||0));
  return moved.length > 0;
}
