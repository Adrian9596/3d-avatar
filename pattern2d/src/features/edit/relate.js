/* Layer 4 — Constraint: the relations of a piece, read off it as it stands, kept by the solver
   that is already there (spec: edit/edit.md §5).

   Nothing is imposed. At the start of every edit the piece is asked what touches what:
     • a layer-8 line lying within 30 mm of the cut line all along is its SEAM line → `follow`
       (every seam vertex anchored where it is: an uneven allowance stays uneven);
     • a POINT on a line (0.01 mm) rides on it → `attach` — on the cut line first, then on a
       seam line, then on any other line;
     • an open line whose end lies on the cut line, where its own direction crosses it, keeps
       that end there → `reach`; one lying ALONG the cut line rides on it like a seam line.
   Those become a geometry document (geometry/doc.js): the cut line, the lines touching nothing
   and the free points are SOURCE nodes, the rest DERIVED — so an edit sets sources and the
   solver moves what depends on them, each node once, a broken relation failing alone.

   `settle` writes solved values back into the piece and nothing else: a path the edit did not
   reach keeps its very arrays. */
import {createDoc} from "../geometry/doc.js";
import {curve, line, point} from "../geometry/model.js";
import {nearestOn, anchorAt, followAnchors, reachBuild, hostOf, runsWith} from "../geometry/anchor.js";
import {summarize, SEW_LAYERS, SEW_BAND} from "../dxf/model.js";
import {vertsOf, isRing, cornersOf} from "./select.js";

/* SEW_BAND (mm — a seam-layer line this close to the cut line all along is its seam line) and SEW_LAYERS (14, the sew
   line of ASTM D6673 / AAMA, and 8, where Richpeace factories and BLOCK_36C put the seam — edit.md C12, E13) live in
   dxf/model.js: the readout's Sewing line and Edges ask the same question of a piece (edges/edges.md §2) */
export const ON_TOL = 0.01;      // mm — a point, or the end of a line, this close to a line is on it

/* The same kind of shape as `base`, with new vertices — and exactly as many: anchors address
   vertices by index, so a source must not be deduplicated in the middle of an edit. */
export function shapeLike(base, pts){
  for(const q of pts) if(!q || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) throw new Error(`đỉnh không hợp lệ: [${q}]`);
  if(base.kind === "line") return line(point(pts[0][0], pts[0][1]), point(pts[1][0], pts[1][1]));
  return {kind: "curve", pts: pts.map(q => [q[0], q[1]]), closed: !!base.closed};
}

export function relate(piece){
  const doc = createDoc();
  const rel = {doc, src: new Map(), out: new Map(), kind: new Map(), base: new Map(), corners: new Map(),
               pts: new Map(), attached: new Map(), free: new Set(), report: null};
  const paths = piece.paths || [];
  const verts = paths.map(p => vertsOf(p));

  /* the cut line: every polyline / LINE of layer 1 — the hosts everything else rides on */
  const cut = [];
  paths.forEach((p, i) => {
    if(!verts[i]) return;
    rel.base.set(i, p.shapes[0]);
    rel.corners.set(i, cornersOf(p));
    if(p.layer !== "1") return;
    const id = doc.add(p.shapes[0], {name: `cắt ${i}`});
    rel.src.set(i, id); rel.out.set(i, id); rel.kind.set(i, "cut"); cut.push(i);
  });
  const hosts = cut.map(i => hostOf(rel.base.get(i)));
  const cutIds = cut.map(i => rel.src.get(i)), cutShapes = cut.map(i => rel.base.get(i));

  /* seam lines: a layer-8 line lying in the band all along that also runs WITH the cut line — a ring
     going round the piece (at least half as long as the cut ring it lies in), an open line with some
     part running along it. Anything else layer 8 holds is a shape drawn on the piece: a small ring
     inside (VeraLifting's pad placement), a tick across an edge (SofyLift), a mark of length 0
     (MHG568). Anchored vertex by vertex to whichever cut segment is nearest, a shape would come apart
     when a corner moves; it stays put, or reaches the boundary like any line (edit.md §5, C10, C11) */
  const plen = (pts, closed) => { let s = 0; for(let k = 1; k < pts.length + (closed ? 1 : 0); k++) s += Math.hypot(pts[k % pts.length][0] - pts[k - 1][0], pts[k % pts.length][1] - pts[k - 1][1]); return s; };
  const seamLike = (pts, ring) => {
    if(!(plen(pts, ring) > 1e-9)) return false;
    if(!ring) return runsWith(hosts, pts, false).share > 0;
    const around = hosts[nearestOn(hosts, pts[0]).k];
    return plen(pts, true) >= 0.5*plen(around.pts, around.closed);
  };
  paths.forEach((p, i) => {
    if(!verts[i] || !SEW_LAYERS.has(p.layer) || !cut.length || rel.kind.has(i)) return;
    const pts = verts[i];
    if(!pts.every(q => { const r = nearestOn(hosts, q); return r && r.dist <= SEW_BAND; }) || !seamLike(pts, isRing(p))) return;
    const id = doc.derive("follow", cutIds, {anchors: followAnchors(hosts, pts, isRing(p)), closed: isRing(p)}, {name: `may ${i}`});
    rel.out.set(i, id); rel.kind.set(i, "follow");
  });

  /* an open line lying ALONG the cut line (every vertex and the middle of every segment on it —
     BLOCK_36C draws the wing's and the cradle's grainline on the band's bottom edge) rides on
     it by the seam rule, as a seam line of allowance 0 would */
  const onCut = q => { const r = nearestOn(hosts, q); return !!r && r.dist <= ON_TOL; };
  paths.forEach((p, i) => {
    if(!verts[i] || rel.kind.has(i) || isRing(p) || !cut.length) return;
    const pts = verts[i];
    if(!pts.every(onCut) || !pts.slice(1).every((q, k) => onCut([(q[0] + pts[k][0])/2, (q[1] + pts[k][1])/2]))) return;
    const id = doc.derive("follow", cutIds, {anchors: followAnchors(hosts, pts, false), closed: false}, {name: `nằm trên biên ${i}`});
    rel.out.set(i, id); rel.kind.set(i, "ride");
  });

  /* every other line: a source; the open ones touching the cut line also reach it. A line of one
     vertex (a drill mark drawn as a ring that closes on itself — MHG568) has no end to reach with:
     it stays put, like anything touching nothing (edit.md C10) */
  paths.forEach((p, i) => {
    if(!verts[i] || rel.kind.has(i)) return;
    const id = doc.add(p.shapes[0], {name: `đường ${i}`});
    rel.src.set(i, id); rel.out.set(i, id); rel.kind.set(i, "line");
    if(isRing(p) || !cut.length || verts[i].length < 2) return;
    const ends = reachBuild(p.shapes[0], cutShapes, {tol: ON_TOL});
    if(!ends.length) return;
    rel.out.set(i, doc.derive("reach", [id, ...cutIds], {ends}, {name: `chạm biên ${i}`}));
    rel.kind.set(i, "reach");
  });

  /* points: on the cut line first, then a seam line, then any other line — else free */
  const byKind = k => [...rel.kind].filter(([, v]) => k.includes(v)).map(([i]) => i);
  const groups = [cut, byKind(["follow"]), byKind(["line", "reach", "ride"])];
  (piece.points || []).forEach((q, j) => {
    const at = [q.x, q.y];
    for(const g of groups){
      let best = null;
      for(const i of g){
        const r = nearestOn([hostOf(rel.base.get(i))], at);
        if(r && (!best || r.dist < best.r.dist)) best = {i, r};
      }
      if(best && best.r.dist <= ON_TOL){
        const anchor = anchorAt([hostOf(rel.base.get(best.i))], at, best.r, {vertexTol: ON_TOL});
        rel.pts.set(j, doc.derive("attach", [rel.out.get(best.i)], {anchor}, {name: `điểm ${j}`}));
        rel.attached.set(j, {host: best.i});
        return;
      }
    }
    rel.pts.set(j, doc.add(point(q.x, q.y), {name: `điểm ${j}`}));
    rel.free.add(j);
  });

  rel.report = doc.solve();
  return rel;
}

/* write the solved values of `ids` (every node when null) back into the piece; a failed
   node keeps the line it had. `sum: false` leaves summing the piece up to the caller — a whole
   piece moved by one vector is summed up by moving its summary (ops.js) */
export function settle(piece, rel, ids, {sum = true} = {}){
  const touched = {paths: [], points: []};
  for(const [i, id] of rel.out){
    if(ids && !ids.has(id)) continue;
    const v = rel.doc.get(id);
    if(!v) continue;
    writePath(piece.paths[i], v);
    touched.paths.push(i);
  }
  for(const [j, id] of rel.pts){
    if(ids && !ids.has(id)) continue;
    const v = rel.doc.get(id);
    if(!v) continue;
    piece.points[j].x = v.x; piece.points[j].y = v.y;
    touched.points.push(j);
  }
  if(touched.paths.length || touched.points.length){ if(sum) summarize(piece); piece.rev = (piece.rev || 0) + 1; }
  return touched;
}

/* the path the importer would have made of these vertices: drawn points, exact shape, snaps */
export function writePath(path, v){
  const pts = hostOf(v).pts.map(q => [q[0], q[1]]);
  const wasLine = path.shapes && path.shapes.length === 1 && path.shapes[0].kind === "line";
  path.pts = pts;
  path.snap = pts.map(q => [q[0], q[1]]);
  /* a LINE entity stays a LINE even when a rule hands back its two vertices as a polyline */
  path.shapes = [v.kind === "line" ? v : wasLine && pts.length === 2 ? line(point(...pts[0]), point(...pts[1])) : curve(pts, !!v.closed)];
}
