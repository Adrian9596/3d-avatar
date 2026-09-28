/* Two ways to measure between two points, and they must never be confused.

   **Straight** is AccuMark's *Straight*: pick two defined points on a piece, read the
   distance between them in a straight line (spec: geometry/point_to_point.md).
   **Along Path** reads what a tape measure laid on the seam would read — through every
   Line, Arc, Curve and Spline in between (spec: geometry/along_path.md). On a curved seam
   the two differ by centimetres; the number that has to match the piece sewn next to it is
   the along-path one, and the number that says how wide a piece is, is the straight one.

   A click snaps to the nearest DEFINED point of the piece: the DXF POINT entities —
   turn, curve, notch, grade reference — plus the vertices the drafter placed; with no point
   in reach, to the nearest LINE. The grade point is why POINT entities matter on their own:
   it sits off the outline, so no polyline vertex would ever reach it. "In reach" is the
   drawing's snap tolerance — 0.02 in for an inch file, 0.5 mm for a mm file — a distance in
   the drawing, never pixels (TD 2026-09-23, shared/units.md §3).

   A measurement is held as ANCHORS, not as coordinates: each end remembers the piece it
   snapped to, and is read back through that piece every time it is drawn. Arrange can move
   the piece; the end moves with it and the number is worked out again (measure_engine.md
   A9). The pure functions below are the whole of that logic — the UI only calls them. */
import {el, MONO} from "../../shared/dom.js";
import {plen} from "../../shared/geom.js";
import {Canvas} from "../canvas/canvas.js";
import {Readout, headed, noteRow} from "../readout/readout.js";
import {point, curve, sample, closestPoint, looseBox, boxGap} from "../geometry/model.js";
import {SEW_LAYERS} from "../dxf/model.js";
import {layerMeta} from "../dxf/aama.js";
import {chain, alongPath, components} from "../geometry/path.js";
import {straight} from "../geometry/straight.js";
import {snapTo} from "../geometry/snap.js";

let ends = [], free = [], button = null, alongBtn = null;
let track = null;                  // {piece, layer, paths} — the line Along Path follows
let note = "";                     // why the last click could not start a measurement

const isAlong = () => Canvas.activeTool() === "along";

/* the exact shapes of a path: the importer's when it made them, else its polyline */
const shapesOf = path => path.shapes && path.shapes.length ? path.shapes : [curve(path.pts, !!path.closed)];

/* Every point of a piece a measurement may land on, in mm, as fresh [x, y] VALUES — never
   the piece's own vertex arrays: Arrange moves those in place, and a measured end that is
   secretly a live reference would slide with it while the other end stays put. POINT
   entities come first so that a notch wins over a vertex on top of it. A layer switched off
   is not a target. */
export function definedPoints(pieces, layersOn){
  return ownedPoints(pieces, layersOn).map(o => o.pt);
}
function ownedPoints(pieces, layersOn){
  const out = [];
  for(const p of pieces || []){
    for(const q of p.points || []) if(layersOn[q.layer]) out.push({pt: [q.x, q.y], piece: p});
    for(const path of p.paths || []) if(layersOn[path.layer])
      for(const v of path.snap || path.pts) out.push({pt: [v[0], v[1]], piece: p});
  }
  return out;
}

/* Which path Along Path follows: the visible one, longer than 1 mm, nearest the click —
   nearest to the LINE, not to its vertices. A long straight edge has vertices only at its
   ends; measured by vertices, a click on its middle would pick the grainline instead.
   Lines within SAME_PLACE of the nearest are drawn on one another: then the cut line is
   followed, then a sewing line, then the rest — BiancaBra 11_52_M draws two layer-8 lines
   0.0002 mm off its cut edge, and a click on the edge took one of them by that hair and
   refused it as a duplicate (2026-09-24). Shapes are asked their loose box first, nearest
   box first, and one whose box is beyond the best so far is not measured: a drawing of
   10 000 splines measures a few. */
const SAME_PLACE = 0.01;                                          // mm — as ON_TOL: a line this close to another is on it
const rank = layer => layer === "1" ? 0 : SEW_LAYERS.has(layer) ? 1 : 2;
export function pickPath(pieces, layersOn, w){
  const q = point(w[0], w[1]), cands = [];
  for(const p of pieces) for(const path of p.paths){
    if(!layersOn[path.layer] || path.pts.length < 2) continue;
    if(plen(path.pts) < 1) continue;
    const shapes = shapesOf(path);
    cands.push({path, piece: p, shapes, gap: Math.min(...shapes.map(s => boxGap(looseBox(s), w)))});
  }
  cands.sort((a, b) => a.gap - b.gap);
  let min = Infinity;
  const measured = [];
  for(const c of cands){
    if(c.gap > min + SAME_PLACE) break;                          // no shape of this path can come within the window
    let d = Infinity;
    for(const s of c.shapes) if(boxGap(looseBox(s), w) <= Math.min(d, min + SAME_PLACE)) d = Math.min(d, closestPoint(s, q).dist);
    c.d = d; measured.push(c); min = Math.min(min, d);
  }
  const pool = measured.filter(c => c.d <= min + SAME_PLACE).sort((a, b) => rank(a.path.layer) - rank(b.path.layer) || a.d - b.d);
  return pool.length ? {d: pool[0].d, path: pool[0].path, piece: pool[0].piece} : null;
}

/* The line Along Path follows: the picked path plus every path of the same layer and piece
   joined to it end to end — a cut line drawn as LINE + ARC + LINE entities is one line to
   measure along. When those paths do not make one path (a fork, a duplicate), the answer
   is the reason, not a measurement. */
export function trackAt(pieces, layersOn, w){
  const hit = pickPath(pieces, layersOn, w);
  if(!hit) return null;
  const {piece, path} = hit;
  const same = piece.paths.filter(q => q.layer === path.layer && layersOn[q.layer] && q.pts.length >= 2);
  const groups = [], open = [];
  same.forEach(q => (q.closed ? groups.push([q]) : open.push(q)));
  const ends = open.map(q => { const sh = shapesOf(q), a = sh[0], b = sh[sh.length - 1];
                               const pa = sample(a, 0.5)[0], pb = sample(b, 0.5).slice(-1)[0];
                               return [pa, pb]; });
  for(const g of components(ends)) groups.push(g.map(i => open[i]));
  const paths = groups.find(g => g.includes(path));
  try{
    return {piece, layer: path.layer, paths, chain: chain(paths.flatMap(shapesOf))};
  }catch(e){
    return {piece, layer: path.layer, paths, error: e.message};
  }
}

/* one click, snapped within `tol` mm — a defined point first, else a line, else free — with
   the piece it landed on. `tol` is the drawing's snap tolerance; null (a file with no unit)
   snaps nothing. */
export function snapAt(pieces, layersOn, w, tol){
  const own = ownedPoints(pieces, layersOn), lines = [];
  for(const p of pieces || []) for(const path of p.paths || [])
    if(layersOn[path.layer] && path.pts.length >= 2) for(const s of shapesOf(path)) lines.push({s, piece: p});
  const r = snapTo(w, {points: own.map(o => o.pt), shapes: lines.map(l => l.s)}, tol);
  const piece = r.kind === "point" ? own[r.index].piece : r.kind === "line" ? lines[r.index].piece : null;
  return {point: r.point, piece, kind: r.kind, free: r.kind === "free"};
}

/* An Along measurement follows paths of one piece: it is alive while that piece is in the drawing and every path it follows is
   still one of the piece's — a path deleted in Edit (edit.md Z6), or the piece deleted (pieces/remove.md R4), and there is no
   line left to measure along */
export const trackAlive = (track, pieces) => !!track && pieces.includes(track.piece) && track.paths.every(q => track.piece.paths.includes(q));

/* an end of a measurement: where it is on its piece (a free end is fixed in the world) */
export function anchor(hit, pieces){
  const p = hit.piece && pieces.includes(hit.piece) ? hit.piece : null;
  return {piece: p, at: [hit.point[0], hit.point[1]], o: p ? [p.ox || 0, p.oy || 0] : [0, 0], free: !!hit.free};
}
/* where that end is NOW — null when its piece is gone (another file was loaded) */
export function resolve(a, pieces){
  if(!a.piece) return [a.at[0], a.at[1]];
  if(!pieces.includes(a.piece)) return null;
  return [a.at[0] + (a.piece.ox || 0) - a.o[0], a.at[1] + (a.piece.oy || 0) - a.o[1]];
}

export const Measure = {
  mount(ctx, ui){
    button = Canvas.toolButton(ui, {id: "meas", label: "Straight", tool: "measure",
      title: "Khoảng cách thẳng giữa hai điểm trên mảnh (M) — AccuMark: Straight"}, ctx);
    alongBtn = Canvas.toolButton(ui, {id: "along", label: "Along", tool: "along",
      title: "Đo dọc theo đường rập từ A tới B (L) — ⇧ ở điểm thứ hai lấy lối dài"}, ctx);

    Canvas.tool("measure", {
      cursor: "measuring",
      onDown(ev, w, c){
        if(ends.length >= 2) reset();
        take(c, w, null);
        c.draw();
        return true;                       // measuring owns the click; no pan
      },
      onExit(){ reset(); }
    });

    Canvas.tool("along", {
      cursor: "measuring",
      onDown(ev, w, c){
        if(ends.length >= 2) reset();
        if(!ends.length){
          const q = take(c, w, null);
          const t = trackAt(visible(c), c.layersOn, q.point);
          if(!t){ reset(); note = "không có đường nào để bám"; c.draw(); return true; }
          if(t.error){ reset(); note = t.error; c.draw(); return true; }
          track = {piece: t.piece, layer: t.layer, paths: t.paths, long: false};
          ends[0] = anchor({...q, piece: t.piece}, c.pieces());
        } else {
          const q = take(c, w, track.piece);
          ends[1] = anchor({...q, piece: track.piece}, c.pieces());
          track.long = ev.shiftKey;
        }
        c.draw();
        return true;
      },
      onExit(){ reset(); }
    });

    Canvas.afterDraw(() => {
      for(const [b, name] of [[button, "measure"], [alongBtn, "along"]]){
        const on = Canvas.activeTool() === name;
        b.setAttribute("aria-pressed", on);
        b.classList.toggle("on", on);
      }
    });
    Canvas.layer((root, ppm, c) => { if(ends.length) draw(root, ppm, c); });
    /* with no piece selected nobody else claims the panel: the measurement is its heading (P8) */
    Readout.section(c => measureBlock(ends.length === 2 ? (isAlong() ? alongRows(c) : straightRows(c)) : null,
                                      ends.length === 2 ? "" : note, c.selection.size > 0));
    ctx.onLoad(() => reset());
    ctx.onEdit(() => { memo = {key: "", shot: null}; if(track && !trackAlive(track, ctx.pieces())) reset(); });  // walk it again — unless it is gone (Z6)
    /* a piece deleted: a measurement with an end on it goes with it (pieces/remove.md R4) */
    ctx.onPieces(c => { if(ends.some(a => a.piece && !c.pieces().includes(a.piece)) || (track && !trackAlive(track, c.pieces()))) reset(); });
    ctx.key("l", () => Canvas.setTool(isAlong() ? null : "along", ctx));
  }
};


const reset = () => { ends = []; free = []; track = null; note = ""; memo = {key: "", shot: null}; };

/* record one click, snapped when something is within the drawing's snap tolerance; the end
   of an Along measurement may only snap to the piece being followed */
function take(ctx, w, onlyPiece){
  const pieces = onlyPiece ? [onlyPiece] : visible(ctx);
  const hit = ctx.pieces().length ? snapAt(pieces, ctx.layersOn, w, ctx.snapTol())
                                  : {point: [w[0], w[1]], piece: null, kind: "free", free: true};
  free = free.concat([hit.kind]);
  if(!onlyPiece) ends = ends.concat([anchor(hit, ctx.pieces())]);
  return hit;
}

const visible = ctx => ctx.primary >= 0 ? [ctx.pieces()[ctx.primary]] : ctx.pieces();

/* both ends where they are now; null once a piece they hang on is gone */
function now(ctx){
  const pts = ends.map(a => resolve(a, ctx.pieces()));
  return pts.every(Boolean) ? pts : null;
}
/* the Along measurement, worked out again from the piece as it is now — the same paths the
   first click chose, read through their current shapes; kept until the piece moves */
let memo = {key: "", shot: null};
function walk(ctx){
  const pts = now(ctx);
  if(!pts || !track) return null;
  const key = JSON.stringify([pts, track.long, track.piece.ox || 0, track.piece.oy || 0]);
  if(memo.key !== key){
    let shot = null;
    try{ shot = alongPath(chain(track.paths.flatMap(shapesOf)), point(...pts[0]), point(...pts[1]),
                          {direction: track.long ? "long" : "short"}); }catch(e){ shot = null; }
    memo = {key, shot};
  }
  return memo.shot;
}

/* The readouts, as pure functions of a result and a length formatter L(mm, d, label) —
   the unit is L's business, so the same result reads in inch, cm or mm and no number here
   is ever computed twice (shared/units.md U8). Labels stay short; a value may wrap. */
/* how an end was taken: a snap kind ("point" · "line" · "free"), or the older true = free */
const took = k => k === "point" ? "bắt điểm" : k === "line" ? "bắt đường" : k === "free" || k === true ? "tự do" : "bắt";
export function straightReadout(r, ends, L){
  return {section: "Straight", rows: [
    ["Khoảng cách", L(r.distance), true],
    ["dx", L(r.dx), true],
    ["dy", L(r.dy), true],
    ["Điểm A", took(ends[0]), true],
    ["Điểm B", took(ends[1]), true]
  ], total: ["A → B", L(r.distance)]};
}
export function alongReadout(r, L, layer){
  const rows = [
    ...(layer ? [["Bám", `${layer} · ${layerMeta(layer, {lines: true}).name}`, true]] : []),   // which line — the number is ITS length
    ["Dọc đường", L(r.distance), true],
    ["Chim bay", L(r.direct), true],
    ["Chênh", L(r.distance - r.direct), true],
    ["Lối", r.closed ? (r.distance <= r.total/2 ? "ngắn" : "dài") : "một lối", true],
    ["Số đoạn", String(r.parts.length), true],
    ["Lệch", L(r.offPath, 2), true],
    ["Cả đường", L(r.total), true]
  ];
  if(r.crossings.length) rows.push(["⚠ Tự cắt", `${r.crossings.length} chỗ`, true]);
  if(r.ambiguous) rows.push(["⚠ Điểm bấm", "mơ hồ", true]);
  return {section: "Along Path", rows, total: ["A → B", L(r.distance)]};
}

const L = ctx => (mm, d, label) => ctx.len(mm, d, label);
function straightRows(ctx){
  const pts = now(ctx);
  return pts ? straightReadout(straight(point(...pts[0]), point(...pts[1])), free, L(ctx)) : null;
}
function alongRows(ctx){
  const r = walk(ctx);
  return r ? alongReadout(r, L(ctx), track && track.layer) : null;
}

/* a click that could not start a measurement says why, instead of doing nothing — in full: the panel wraps a value,
   and a reason cut at 60 characters lost the part that says what to do ("…xoá bớt một cái rồi đo") */
export const noteBlock = note => note ? {section: "Along Path", rows: [noteRow(note)]} : null;
/* What the panel shows of a measurement (point_to_point.md P8): its block — or why a click could not start one — as a
   section under the heading of the piece selected, or as the heading itself when nothing is selected. Before
   2026-09-24 a measurement with nothing selected showed only its label on the canvas: no dx, dy, no snap kind. */
export const measureBlock = (result, why, claimed) => headed(result || noteBlock(why), claimed);

/* ── drawing ────────────────────────────────────────────────────────────── */
function draw(root, ppm, ctx){
  const g = el("g", {});
  const colour = isAlong() ? "var(--accent)" : "var(--l-notch)";
  const pts = ends.map(a => resolve(a, ctx.pieces())).filter(Boolean);
  const shot = ends.length === 2 && isAlong() ? walk(ctx) : null;

  if(shot) for(const s of shot.shapes){
    const d = sample(s, 0.2).map(([x, y], i) => `${i ? "L" : "M"}${x} ${-y}`).join("");
    g.appendChild(el("path", {d, fill: "none", stroke: colour, "stroke-width": 3.5,
      "stroke-linecap": "round", opacity: 0.55, "vector-effect": "non-scaling-stroke"}));
  }
  /* a free point is drawn hollow-dashed, so "I clicked next to the notch, not on it"
     is visible on the canvas and not only in the panel */
  pts.forEach((p, i) => g.appendChild(el("circle", {cx: p[0], cy: -p[1], r: 3.5/ppm,
    fill: "none", stroke: colour, "stroke-width": 1.6,
    "stroke-dasharray": free[i] === "free" ? "2 2" : null, "vector-effect": "non-scaling-stroke"})));

  if(pts.length === 2){
    const [a, b] = pts;
    if(!isAlong())
      g.appendChild(el("line", {x1: a[0], y1: -a[1], x2: b[0], y2: -b[1], stroke: colour,
        "stroke-width": 1.4, "vector-effect": "non-scaling-stroke"}));
    const value = isAlong() ? (shot ? shot.distance : null) : straight(point(...a), point(...b)).distance;
    if(value !== null) label(g, ppm, mid(shot, a, b), ctx.len(value), colour);
  }
  root.appendChild(g);
}

/* the label sits in the middle of WHAT WAS MEASURED, not between the two clicks: on a
   curve those are far apart, and a label off the measured run reads as another piece */
function mid(r, a, b){
  return (r && runMiddle(r.shapes)) || [(a[0]+b[0])/2, (a[1]+b[1])/2];
}
/* the point half the run's length along it — not its middle sample by index: a straight run is sampled as its two
   ends, so the label sat on B (2026-09-24). null for an empty run */
export function runMiddle(shapes){
  const pts = [];
  for(const s of shapes || []) for(const q of sample(s, 0.5)) pts.push(q);
  let total = 0;
  for(let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]);
  if(!pts.length) return null;
  let acc = 0;
  for(let i = 1; i < pts.length; i++){
    const a = pts[i-1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if(d > 0 && acc + d >= total/2){ const t = (total/2 - acc)/d; return [a[0] + (b[0] - a[0])*t, a[1] + (b[1] - a[1])*t]; }
    acc += d;
  }
  return [pts[0][0], pts[0][1]];
}

function label(g, ppm, at, text, colour){
  const fs = 12/ppm, w = text.length*fs*0.68, h = fs*1.55;
  g.appendChild(el("rect", {x: at[0]-w/2, y: -at[1]-h/2-fs, width: w, height: h, rx: h*0.2,
    fill: "var(--bg)", stroke: colour, "stroke-width": 1, "vector-effect": "non-scaling-stroke"}));
  g.appendChild(Object.assign(el("text", {x: at[0], y: -at[1]+fs*0.36-fs, "font-size": fs,
    "text-anchor": "middle", fill: colour, "font-family": MONO}), {textContent: text}));
}
