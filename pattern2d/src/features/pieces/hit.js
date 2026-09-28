/* Which piece is under a point: an outline hit wins, then the smallest box.
   Pure so the rule can be tested without a canvas. */
import {pointInPoly} from "../../shared/geom.js";

export function hitPiece(pieces, w, pad = 0){
  let best = -1, rank = Infinity;
  pieces.forEach((p, i) => {
    const b = p.bbox; if(!b) return;
    if(w[0] < b.x0-pad || w[0] > b.x1+pad || w[1] < b.y0-pad || w[1] > b.y1+pad) return;
    const o = p.cut || p.sew;
    const r = Math.max(b.w*b.h, 1) * (!o || pointInPoly(o, w) ? 1 : 1e6);
    if(r < rank){ rank = r; best = i; }
  });
  return best;
}
