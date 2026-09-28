/* Layers 2 and 3 — Direct Edit and Precise Edit, as operations on one piece
   (spec: edit/edit.md §3–§4). No DOM: the UI (edit.js) calls these and draws what they did.

   A DRAG is a gesture: `beginEdit` reads the piece's relations once (layer 4, relate.js) and
   remembers where everything started; `driveEdit(g, d)` then moves the grabbed things by d from
   that start — never from the last frame, so a long drag cannot creep. Precise Edit is the
   same gesture driven once by a computed d: typing a length and dragging the corner to the
   same place give one geometry (P4).

   Trim · extend · split · join change the structure (a line becomes two, two become one), not
   a position the solver could follow; they write the piece directly, and the relations are
   read afresh by the next edit. `snapPiece` / `restorePiece` are the undo. */
import {point, line, curve, closestPoint, split, pointAt, sample, transform, translation, length} from "../geometry/model.js";
import {trim, extend, trimExtend} from "../geometry/ops.js";
import {deformPath, edgeRange, lengthMove, angleMove, similarity, isStraight, chordAngle} from "../geometry/deform.js";
import {nearestOn, anchorAt, hostOf} from "../geometry/anchor.js";
import {summarize} from "../dxf/model.js";
import {vertsOf, isRing, cornersOf} from "./select.js";
import {relate, settle, shapeLike, writePath, ON_TOL} from "./relate.js";

const copyPath = p => ({...p, pts: p.pts.map(q => [q[0], q[1]]), snap: p.snap ? p.snap.map(q => [q[0], q[1]]) : p.snap,
                        shapes: (p.shapes || []).slice(), pin: p.pin ? p.pin.slice() : undefined, unpin: p.unpin ? p.unpin.slice() : undefined});
const bumped = piece => { summarize(piece); piece.rev = (piece.rev || 0) + 1; return piece; };

/* ── undo ──────────────────────────────────────────────────────────────────── */
export function snapPiece(piece){
  return {paths: piece.paths.map(copyPath), points: piece.points.map(q => ({...q})),
          texts: (piece.texts || []).map(t => ({...t})), ox: piece.ox || 0, oy: piece.oy || 0};
}
/* back to the snapshot — at the place Arrange has put the piece since (its layout is not an
   edit, so undoing an edit must not undo it) */
export function restorePiece(piece, s){
  piece.paths = s.paths.map(copyPath);
  piece.points = s.points.map(q => ({...q}));
  piece.texts = s.texts.map(t => ({...t}));
  const dx = (piece.ox || 0) - s.ox, dy = (piece.oy || 0) - s.oy;
  if(dx || dy) shiftAll(piece, dx, dy);
  return bumped(piece);
}
function shiftSummary(piece, s, d){
  const by = pts => pts && pts.map(q => [q[0] + d[0], q[1] + d[1]]);
  const b = s.bbox;
  Object.assign(piece, {cut: by(s.cut), sew: by(s.sew), cutLen: s.cutLen, sewLen: s.sewLen,
    bbox: b && {x0: b.x0 + d[0], y0: b.y0 + d[1], x1: b.x1 + d[0], y1: b.y1 + d[1], w: b.w, h: b.h}});
}
function shiftAll(piece, dx, dy){
  const m = translation(dx, dy);
  for(const p of piece.paths){
    p.pts = p.pts.map(q => [q[0] + dx, q[1] + dy]);
    if(p.snap) p.snap = p.snap.map(q => [q[0] + dx, q[1] + dy]);
    p.shapes = (p.shapes || []).map(s => transform(s, m));
  }
  for(const q of piece.points){ q.x += dx; q.y += dy; }
  for(const t of piece.texts || []){ t.x += dx; t.y += dy; }
}

/* ── an edge, oriented: from its fixed end to its moving end ─────────────────
   The moving end is the one nearer the click that picked the edge, unless the item says
   (`to: "a" | "b"`, the ⇄ button). */
export function movingEnd(piece, item){
  if(item.to === "a" || item.to === "b") return item.to;
  const path = piece.paths[item.path], c = item.click;
  if(!c) return "b";
  if(item.whole){
    const s = path.shapes[0], a = pointAt(s, 0), b = pointAt(s, 1);
    return Math.hypot(c[0] - a.x, c[1] - a.y) < Math.hypot(c[0] - b.x, c[1] - b.y) ? "a" : "b";
  }
  const v = vertsOf(path);
  return Math.hypot(c[0] - v[item.a][0], c[1] - v[item.a][1]) < Math.hypot(c[0] - v[item.b][0], c[1] - v[item.b][1]) ? "a" : "b";
}
export function edgePts(piece, item){
  const path = piece.paths[item.path], v = vertsOf(path);
  if(!v) throw new Error("đường cong nguyên khối không có đỉnh để đo theo cạnh");
  const idx = item.a === item.b && isRing(path) ? edgeRange(v.length, true, item.a, (item.a - 1 + v.length) % v.length).concat([item.a])
                                                 : edgeRange(v.length, isRing(path), item.a, item.b);
  const end = movingEnd(piece, item);
  const ordered = end === "b" ? idx : idx.slice().reverse();
  return {idx: ordered, pts: ordered.map(i => v[i]), fixed: ordered[0], moving: ordered[ordered.length - 1]};
}
/* The length and chord direction of an edge as Length and Angle read them (edit.md P7, P8): between
   its corners, from the fixed end to the moving one — or, for an exact curve, the curve's own. A
   closed whole curve has its round for a length and no chord, so no direction: angle null. */
export function edgeMeasure(piece, item){
  const path = piece.paths[item.path];
  if(!path) throw new Error("không còn đường đó");
  let pts, len = 0;
  if(item.whole || !vertsOf(path)){
    const s = path.shapes[0], end = movingEnd(piece, item);
    const A = pointAt(s, end === "b" ? 0 : 1), M = pointAt(s, end === "b" ? 1 : 0);
    pts = [[A.x, A.y], [M.x, M.y]]; len = length(s);
  } else {
    pts = edgePts(piece, item).pts;
    for(let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]);
  }
  const A = pts[0], M = pts[pts.length - 1];
  return {length: len, angle: Math.hypot(M[0] - A[0], M[1] - A[1]) >= 1e-9 ? chordAngle(pts) : null};
}

/* ── a gesture ─────────────────────────────────────────────────────────────── */
export function beginEdit(piece, items){
  const rel = relate(piece);
  const g = {piece, rel, whole: false, vertex: new Map(), follow: new Map(), slide: new Set(), free: new Set(),
             rigid: new Set(), p0: piece.points.map(q => [q.x, q.y]), snap: snapPiece(piece), anchors0: new Map(),
             sum0: {cut: piece.cut, sew: piece.sew, cutLen: piece.cutLen, sewLen: piece.sewLen, bbox: piece.bbox}};
  const add = (map, i, vs) => { if(!map.has(i)) map.set(i, new Set()); for(const v of vs) map.get(i).add(v); };
  for(const it of items){
    if(it.kind === "piece"){ g.whole = true; continue; }
    if(it.kind === "point" && it.src === "entity"){ (rel.attached.has(it.pt) ? g.slide : g.free).add(it.pt); continue; }
    const path = piece.paths[it.path];
    if(!path) throw new Error("không còn đường đó");
    if(it.whole || !vertsOf(path)){ g.rigid.add(it.path); continue; }
    const n = vertsOf(path).length;
    const vs = it.kind === "point" ? [it.v]
             : it.a === it.b && isRing(path) ? [...Array(n).keys()] : edgeRange(n, isRing(path), it.a, it.b);
    if(rel.src.has(it.path)) add(g.vertex, it.path, vs);
    else if(["follow", "ride"].includes(rel.kind.get(it.path))) add(g.follow, it.path, vs);
    else throw new Error("đường này không sửa được từng đỉnh");
  }
  for(const i of g.follow.keys()) g.anchors0.set(i, rel.doc.node(rel.out.get(i)).params.anchors);
  /* points lying on a shape that moves as one piece travel with it (edit.md E9) */
  g.carry = new Set();
  for(const i of g.rigid) piece.points.forEach((q, j) => {
    if(rel.free.has(j) && piece.paths[i].shapes.some(s => closestPoint(s, point(q.x, q.y)).dist <= ON_TOL)) g.carry.add(j);
  });
  return g;
}

/* move what the gesture holds by d = [dx, dy] from where it began */
export function driveEdit(g, d){
  if(!Array.isArray(d) || !Number.isFinite(d[0]) || !Number.isFinite(d[1])) throw new Error(`độ dời không hợp lệ: [${d}]`);
  const {piece, rel} = g, doc = rel.doc, set = new Set();
  const moveBy = q => [q[0] + d[0], q[1] + d[1]];
  if(g.whole){
    for(const [i, id] of rel.src){ const b = rel.base.get(i); doc.set(id, shapeLike(b, hostOf(b).pts.map(moveBy))); set.add(id); }
    for(const j of rel.free){ const q = moveBy(g.p0[j]); doc.set(rel.pts.get(j), point(q[0], q[1])); set.add(rel.pts.get(j)); }
    piece.paths.forEach((p, i) => { if(!vertsOf(p)) g.rigid.add(i); });
    piece.texts = g.snap.texts.map(t => ({...t, x: t.x + d[0], y: t.y + d[1]}));
  } else {
    for(const [i, vs] of g.vertex){
      const b = rel.base.get(i), h = hostOf(b);
      const moves = new Map([...vs].map(v => [v, d]));
      doc.set(rel.src.get(i), shapeLike(b, deformPath(h.pts, h.closed, rel.corners.get(i), moves)));
      set.add(rel.src.get(i));
    }
    /* a seam vertex moved by hand: its anchor moves, so the allowance there changes */
    for(const [i, vs] of g.follow){
      const id = rel.out.get(i), hosts = doc.node(id).inputs.map(n => hostOf(doc.get(n)));
      const pts = hostOf(rel.base.get(i)).pts, anchors = g.anchors0.get(i).slice();
      for(const v of vs) anchors[v] = anchorAt(hosts, moveBy(pts[v]));
      doc.setParams(id, {anchors});
    }
    /* a point on a line slides along it: anchored where the line is nearest, ON the line */
    for(const j of g.slide){
      const id = rel.pts.get(j), host = hostOf(doc.get(doc.node(id).inputs[0]));
      const r = nearestOn([host], moveBy(g.p0[j]));
      if(r) doc.setParams(id, {anchor: anchorAt([host], r.foot, r, {vertexTol: ON_TOL})});
    }
    for(const j of new Set([...g.free, ...g.carry])){ const q = moveBy(g.p0[j]); doc.set(rel.pts.get(j), point(q[0], q[1])); set.add(rel.pts.get(j)); }
  }
  for(const i of g.rigid){
    const s0 = g.snap.paths[i], m = translation(d[0], d[1]);
    Object.assign(piece.paths[i], {pts: s0.pts.map(moveBy), snap: s0.snap && s0.snap.map(moveBy), shapes: s0.shapes.map(s => transform(s, m))});
  }
  const report = doc.solve();
  const touched = settle(piece, rel, new Set([...set, ...report.updated]), {sum: !g.whole});
  /* A whole piece moved by d: its outline, lengths and box are the ones it began with, moved by d —
     not measured again, so no length changes in its last digit while TD drags (C5), and a drawing
     of 10 000 splines is not re-chained every frame. Otherwise settle has summed the piece up when
     it wrote anything (the rigid paths were moved before it); once a frame is enough. */
  if(g.whole){ shiftSummary(piece, g.sum0, d); piece.rev = (piece.rev || 0) + 1; }
  else if(g.rigid.size && !touched.paths.length && !touched.points.length) bumped(piece);
  return {report, touched};
}

export const applyMove = (piece, items, d) => driveEdit(beginEdit(piece, items), d);

/* ── Precise Edit ──────────────────────────────────────────────────────────── */
function preciseEdge(piece, item, target){
  const path = piece.paths[item.path];
  if(!path) throw new Error("không còn đường đó");
  if(item.whole || !vertsOf(path)){
    /* an exact curve: one similarity about its fixed end, which keeps an arc an arc. A closed one has
       its two ends in one place — nothing to run: the similarity would be the identity, and Length
       would answer "done" having done nothing (P9) */
    const s = path.shapes[0], end = movingEnd(piece, item);
    const A = pointAt(s, end === "b" ? 0 : 1), M = pointAt(s, end === "b" ? 1 : 0);
    if(Math.hypot(M.x - A.x, M.y - A.y) < 1e-9)
      throw new Error("đường kín nguyên khối — hai đầu trùng nhau, không có đầu nào để chạy; Length và Angle chỉ đổi được đường có hai đầu");
    const M2 = target({pts: [[A.x, A.y], ...sample(s, 0.05).slice(1, -1), [M.x, M.y]], exactLength: length(s)});
    const m = similarity([A.x, A.y], [M.x, M.y], [A.x, A.y], M2);
    const shapes = path.shapes.map(q => transform(q, m));
    Object.assign(path, {shapes, pts: shapes.flatMap(q => sample(q, 0.05)), snap: [[pointAt(shapes[0], 0).x, pointAt(shapes[0], 0).y], [pointAt(shapes[0], 1).x, pointAt(shapes[0], 1).y]]});
    bumped(piece);
    return {report: null};
  }
  const rel0 = relate(piece);
  if(rel0.kind.get(item.path) === "follow") throw new Error("đường may bám đường cắt — đổi chiều dài hay góc trên đường cắt");
  if(rel0.kind.get(item.path) === "ride") throw new Error("đường này nằm trên đường cắt — đổi chiều dài hay góc trên đường cắt");
  const e = edgePts(piece, item), M = e.pts[e.pts.length - 1], M2 = target({pts: e.pts});
  const g = beginEdit(piece, [{kind: "point", src: "vertex", path: item.path, v: e.moving}]);
  return driveEdit(g, [M2[0] - M[0], M2[1] - M[1]]);
}
/* Length: the edge from its fixed end, exactly L mm long (P1) */
export function applyLength(piece, item, L){
  if(!Number.isFinite(L) || L <= 0) throw new Error(`chiều dài không hợp lệ: ${L} — cần một số > 0`);
  return preciseEdge(piece, item, e => {
    if(e.exactLength === undefined) return lengthMove(e.pts, L);
    const A = e.pts[0], M = e.pts[e.pts.length - 1], k = L/e.exactLength;
    return [A[0] + k*(M[0] - A[0]), A[1] + k*(M[1] - A[1])];
  });
}
/* Angle: the chord from the fixed end pointing at `deg`, counter-clockwise from +X (P2) */
export function applyAngle(piece, item, deg){
  if(!Number.isFinite(deg)) throw new Error(`góc không hợp lệ: ${deg}`);
  return preciseEdge(piece, item, e => angleMove(e.pts, deg));
}

/* ── structure: trim · extend · split · join ─────────────────────────────── */
const refuse = message => ({ok: false, message});

/* Delete (edit.md §6b — TD 2026-09-24: "Làm, trừ đường cắt"): the items selected on one piece. A Line or a Curve takes its whole
   path — an inner line has no half to leave behind; a POINT entity goes. A cut line (layer 1) is refused: the piece must keep one
   closed ring (ASTM) — deleting it is deleting the piece (Z2). A corner of a path is not a thing of its own (Z3). All or
   nothing: a refused item leaves the piece as it was. The last grainline or notch may go, with a warning (Z4, CLAUDE.md §5.10) */
export function deleteItems(piece, items){
  const paths = new Set(), pts = new Set();
  for(const it of items){
    if(it.kind === "piece") return refuse("chọn Piece là xoá cả mảnh (pieces/remove.md)");
    if(it.kind === "point"){
      if(it.src !== "entity") return refuse("đỉnh của một đường không xoá riêng được (chưa có xoá đỉnh) — muốn xoá cả đường thì chọn Line / Curve của nó");
      pts.add(it.pt);
      continue;
    }
    const path = piece.paths[it.path];
    if(!path) return refuse("không còn đường đó");
    if(path.layer === "1") return refuse("đường cắt (layer 1) không xoá lẻ — mảnh phải còn một vòng kín (ASTM); muốn bỏ thì xoá cả mảnh: chọn Piece rồi Delete");
    paths.add(it.path);
  }
  const hadGrain = piece.paths.some(q => q.layer === "7"), hadNotch = (piece.points || []).some(q => q.layer === "4");
  piece.paths = piece.paths.filter((q, i) => !paths.has(i));
  piece.points = (piece.points || []).filter((q, j) => !pts.has(j));
  bumped(piece);
  const lost = [];
  if(hadGrain && !piece.paths.some(q => q.layer === "7")) lost.push("không còn canh sợi");
  if(hadNotch && !piece.points.some(q => q.layer === "4")) lost.push("không còn notch");
  const what = [paths.size ? `${paths.size} đường` : "", pts.size ? `${pts.size} điểm` : ""].filter(Boolean).join(", ");
  return {ok: true, message: `đã xoá ${what}` + (lost.length ? ` — ⚠ ${piece.blockName || piece.name || "mảnh"} ${lost.join(", ")} (CLAUDE.md §5.10)` : "")};
}

/* an undo step's pieces where they are NOW: each held by the piece itself, not its place in the list — a piece deleted since is
   skipped, one after it is found where it moved to (pieces/remove.md R5) */
export const stepPieces = (step, pieces) => step.map(s => ({...s, index: pieces.indexOf(s.piece)})).filter(s => s.index >= 0);

/* What a click names as the cutter (Trim) or the boundary (Extend): the WHOLE line clicked, not the
   edge between two of its corners — and a click anywhere on the cut line names the whole cut line of
   the piece, every layer-1 entity of it, as layer 4 reads it (edit.md D8, E16). Held by a mark on the
   path, not by its index — a trim that cuts a line in two renumbers every path after it — nor by the
   object — a refused click puts the piece back from its snapshot, every path a copy (copyPath keeps
   the mark): the next click must still cut against the same thing (D9). The cut line is looked up
   afresh each time, so an entity of it that an edit replaced still counts. */
let marks = 0;
export function holdBoundary(piece, i){
  const path = piece.paths[i];
  if(!path) return null;
  if(path.layer === "1") return {cut: true};
  if(path.held === undefined) path.held = ++marks;
  return {mark: path.held};
}
/* the lines held, as they are now — never the one being edited (`not`, an index in the same piece) */
export function boundaryPaths(piece, held, not = -1){
  if(!held) return [];
  const own = piece.paths[not];
  const paths = held.cut ? piece.paths.filter(q => q.layer === "1") : piece.paths.filter(q => q.held === held.mark);
  return paths.filter(q => q !== own);
}
export const boundaryShapes = (piece, held, not = -1) => boundaryPaths(piece, held, not).flatMap(q => q.shapes);

/* the vertices of a LINE or a polyline shape; an arc or a spline has none to compare */
const shapeVerts = s => s.kind === "line" ? [[s.a.x, s.a.y], [s.b.x, s.b.y]] : s.kind === "curve" ? s.pts : null;
/* an open line that comes back to where it began is a loop (D12): both its ends are one point */
const isLoop = s => { const v = shapeVerts(s); return !!v && v.length > 2 && Math.hypot(v[0][0] - v[v.length - 1][0], v[0][1] - v[v.length - 1][1]) <= 1e-9; };
/* The cutters as the edited line meets them (D13): a stretch of a cutter the line lies ALONG — a line drawn
   over the edge shares the edge's vertices, and each of them would read as a crossing — is not a place it
   crosses. A cutter segment is lain along when both its ends and its middle are on the line (≤ ON_TOL);
   what is left of a polyline cutter goes on as open runs, so the places the line joins or leaves the edge
   still count. */
function crossable(s, cutters){
  const tv = shapeVerts(s);
  if(!tv) return cutters;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for(const q of tv){ x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  const on = q => {
    if(q[0] < x0 - ON_TOL || q[0] > x1 + ON_TOL || q[1] < y0 - ON_TOL || q[1] > y1 + ON_TOL) return false;
    for(let k = 1; k < tv.length; k++){
      const a = tv[k - 1], b = tv[k], dx = b[0] - a[0], dy = b[1] - a[1], dd = dx*dx + dy*dy;
      const t = dd ? Math.max(0, Math.min(1, ((q[0] - a[0])*dx + (q[1] - a[1])*dy)/dd)) : 0;
      if(Math.hypot(q[0] - a[0] - dx*t, q[1] - a[1] - dy*t) <= ON_TOL) return true;
    }
    return false;
  };
  const out = [];
  for(const c of cutters){
    const cv = shapeVerts(c);
    if(!cv){ out.push(c); continue; }
    const n = cv.length, closed = c.kind === "curve" && !!c.closed, m = closed ? n : n - 1;
    const along = Array.from({length: m}, (_, k) => { const a = cv[k], b = cv[(k + 1) % n]; return on(a) && on(b) && on([(a[0] + b[0])/2, (a[1] + b[1])/2]); });
    if(!along.some(Boolean)){ out.push(c); continue; }
    /* the runs of segments left, a ring's starting just after one lain along so that none wraps across it */
    const first = along.indexOf(true), order = Array.from({length: m}, (_, j) => closed ? (first + 1 + j) % m : j);
    let run = null;
    const flush = () => { if(run) out.push(run.length === 2 ? line(point(...run[0]), point(...run[1])) : curve(run, false)); run = null; };
    for(const k of order){
      if(along[k]){ flush(); continue; }
      if(!run) run = [cv[k]];
      run.push(cv[(k + 1) % n]);
    }
    flush();
  }
  return out;
}
/* a path of one exact shape, laid out the way the importer lays one out */
function pathOf(layer, s){
  if(s.kind === "line" || s.kind === "curve"){
    const p = {layer, closed: s.kind === "curve" && !!s.closed};
    writePath(p, s);
    return p;
  }
  const a = pointAt(s, 0), b = pointAt(s, 1);
  return {layer, closed: false, shapes: [s], pts: sample(s, 0.05), snap: [[a.x, a.y], [b.x, b.y]]};
}
const shapeOf = path => {
  if(!path) throw new Error("không còn đường đó");
  if(path.shapes.length !== 1) throw new Error("đường nhiều đoạn cung (bulge) — chưa sửa được từng khúc");
  return path.shapes[0];
};

/* cut away the part of an open line around `at`, between its two nearest crossings */
export function trimLine(piece, i, cutters, at){
  const path = piece.paths[i];
  if(!path) return refuse("không còn đường đó");
  if(path.closed) return refuse("đường kín — trim sẽ làm hở nó; dùng split rồi kéo");
  let s; try{ s = shapeOf(path); }catch(e){ return refuse(e.message); }
  if(isLoop(s)) return refuse("đường khép kín (hai đầu trùng nhau) — trim sẽ làm hở nó; dùng split rồi kéo");
  const r = trim(s, crossable(s, cutters), point(at[0], at[1]));
  if(!r.removed) return refuse("đường này không có giao điểm nào với vật cắt");
  if(!r.kept.length) return refuse("trim sẽ xoá cả đường — không làm");
  piece.paths.splice(i, 1, ...r.kept.map(k => pathOf(path.layer, k)));
  bumped(piece);
  return {ok: true, message: r.kept.length > 1 ? "cắt khúc giữa — còn lại hai đường" : "đã cắt"};
}

/* reach the end of an open line nearer `at` out to the nearest crossing with the boundary */
export function extendLine(piece, i, boundary, at){
  const path = piece.paths[i];
  if(!path) return refuse("không còn đường đó");
  if(path.closed) return refuse("đường kín — không có đầu nào để kéo dài");
  let s; try{ s = shapeOf(path); }catch(e){ return refuse(e.message); }
  if(s.kind === "spline") return refuse("spline chưa kéo dài được");
  if(isLoop(s)) return refuse("đường khép kín (hai đầu trùng nhau) — không có đầu nào để kéo dài");
  const a = pointAt(s, 0), b = pointAt(s, 1);
  const end = Math.hypot(at[0] - a.x, at[1] - a.y) <= Math.hypot(at[0] - b.x, at[1] - b.y) ? "start" : "end";
  /* an end already on the boundary has reached it: on from there, the next crossing lies across the
     outside of the piece — the far wall of a notch, another stretch of the cut line (D10) */
  const E = end === "start" ? a : b;
  if(boundary.some(c => closestPoint(c, E).dist <= ON_TOL)) return refuse("đầu này đã nằm trên vật chặn — không còn gì để kéo tới");
  const e = extend(s, crossable(s, boundary), end);
  if(e === s || Math.abs(length(e) - length(s)) < 1e-9) return refuse("kéo theo hướng đó không chạm vật chặn nào");
  piece.paths[i] = {...pathOf(path.layer, e), pin: path.pin, unpin: path.unpin};
  bumped(piece);
  return {ok: true, message: "đã kéo dài"};
}

/* First click: validate and choose an endpoint without touching the model. */
export function trimExtendSource(path, at){
  if(!path) return refuse("không còn đường đó");
  if(path.layer === "1" || path.closed) return refuse("đường cắt / đường kín không sửa đầu; chọn một đường hở");
  let s; try{ s = shapeOf(path); }catch(e){ return refuse(e.message); }
  const a = pointAt(s, 0), b = pointAt(s, 1);
  if(Math.hypot(a.x - b.x, a.y - b.y) <= 1e-9) return refuse("đường kín hoặc dài 0 — không có đầu để sửa");
  const end = Math.hypot(at[0] - a.x, at[1] - a.y) < Math.hypot(at[0] - b.x, at[1] - b.y) ? "start" : "end";
  return {ok: true, end};
}

/* Second click: one new path in the same slot. No middle split and no target mutation. */
export function trimExtendLine(piece, i, boundary, end){
  const path = piece.paths[i];
  if(!path || path.layer === "1" || path.closed) return refuse("chọn một đường hở, không phải đường cắt");
  let s; try{ s = shapeOf(path); }catch(e){ return refuse(e.message); }
  const r = trimExtend(s, crossable(s, boundary), end);
  if(!r.ok) return r;
  // Structural trimming changes vertex indices: old explicit corner indices no longer apply.
  piece.paths[i] = pathOf(path.layer, r.shape);
  bumped(piece);
  return {ok: true, action: r.action, message: r.action === "trim" ? "đã cắt đường 1 tới đường 2" : "đã kéo dài đường 1 tới đường 2"};
}

/* split a line at the point of it nearest q (split changes no geometry, D4) */
export function splitAt(piece, item, q){
  const i = item.path, path = piece.paths[i];
  if(!path) return refuse("không còn đường đó");
  const v = vertsOf(path);
  if(!v){
    let s; try{ s = shapeOf(path); }catch(e){ return refuse(e.message); }
    if(path.closed) return refuse("đường tròn kín — chưa tách được");
    const t = closestPoint(s, point(q[0], q[1])).t;
    const parts = split(s, t);
    if(parts.length < 2) return refuse("điểm tách trùng đầu đường");
    piece.paths.splice(i, 1, ...parts.map(k => pathOf(path.layer, k)));
    bumped(piece);
    return {ok: true, message: "đã tách thành hai"};
  }
  const ring = isRing(path), r = nearestOn([{pts: v, closed: ring}], q);
  let k, pts = v.map(x => [x[0], x[1]]), inserted = false;
  const near = (x, y) => Math.hypot(x[0] - y[0], x[1] - y[1]) <= 1e-9;
  if(near(r.foot, v[r.i])) k = r.i;
  else if(near(r.foot, v[(r.i + 1) % v.length])) k = (r.i + 1) % v.length;
  else { k = r.i + 1; pts.splice(k, 0, [r.foot[0], r.foot[1]]); inserted = true; }
  if(ring){
    const shift = xs => (xs || []).map(x => inserted && x >= k ? x + 1 : x);
    const pin = new Set(shift(path.pin)), unpin = new Set(shift(path.unpin));
    pin.add(k); unpin.delete(k);
    writePath(path, {kind: "curve", pts, closed: true});
    path.pin = [...pin]; path.unpin = [...unpin];
    bumped(piece);
    return {ok: true, message: "thêm một góc — cạnh tách làm hai"};
  }
  if(k === 0 || k === pts.length - 1) return refuse("điểm tách trùng đầu đường");
  const kind = path.shapes[0].kind, A = pts.slice(0, k + 1), B = pts.slice(k);
  const make = ps => kind === "line" ? line(point(...ps[0]), point(...ps[1])) : curve(ps, false);
  piece.paths.splice(i, 1, pathOf(path.layer, make(A)), pathOf(path.layer, make(B)));
  bumped(piece);
  return {ok: true, message: "đã tách thành hai"};
}

/* join two edges: neighbours on one line lose the corner between them; two open lines that
   meet end to end (within tol mm) become one */
export function joinEdges(piece, a, b, tol){
  if(!a || !b) return refuse("chọn hai cạnh để nối");
  if(a.path === b.path && !a.whole && !b.whole){
    const path = piece.paths[a.path];
    const c = a.b === b.a ? a.b : a.a === b.b ? a.a : null;
    if(c === null) return refuse("hai cạnh không liền nhau");
    if(!isRing(path) && (c === 0 || c === vertsOf(path).length - 1)) return refuse("đầu đường hở không bỏ được");
    const pin = new Set(path.pin || []), unpin = new Set(path.unpin || []);
    pin.delete(c);
    path.pin = [...pin];
    if(cornersOf(path).includes(c)) unpin.add(c);
    path.unpin = [...unpin];
    bumped(piece);
    return {ok: true, message: "bỏ góc — hai cạnh thành một"};
  }
  const pa = piece.paths[a.path], pb = piece.paths[b.path];
  const va = vertsOf(pa), vb = vertsOf(pb);
  if(!va || !vb) return refuse("chỉ nối được polyline và LINE");
  if(isRing(pa) || isRing(pb)) return refuse("đường kín không có đầu để nối");
  const t = tol ?? 1e-6, d = (x, y) => Math.hypot(x[0] - y[0], x[1] - y[1]);
  const A0 = va[0], A1 = va[va.length - 1], B0 = vb[0], B1 = vb[vb.length - 1];
  const ways = [[d(A1, B0), () => va.concat(vb.slice(1))], [d(A1, B1), () => va.concat(vb.slice(0, -1).reverse())],
                [d(A0, B1), () => vb.concat(va.slice(1))], [d(A0, B0), () => vb.slice().reverse().concat(va.slice(1))]];
  const best = ways.sort((x, y) => x[0] - y[0])[0];
  if(best[0] > t) return refuse(`hai đường không chạm đầu nhau (cách ${best[0].toFixed(3)} mm)`);
  let pts = best[1]().map(q => [q[0], q[1]]);
  const closed = pts.length > 3 && d(pts[0], pts[pts.length - 1]) <= t;
  if(closed) pts = pts.slice(0, -1);
  const bothLines = pa.shapes[0].kind === "line" && pb.shapes[0].kind === "line";
  const shape = !closed && bothLines && isStraight(pts, 1e-9)
    ? line(point(...pts[0]), point(...pts[pts.length - 1])) : curve(pts, closed);
  piece.paths[a.path] = pathOf(pa.layer, shape);
  piece.paths.splice(b.path, 1);
  bumped(piece);
  return {ok: true, message: closed ? "nối thành một đường kín" : "nối thành một đường"};
}
