/* A new pattern piece in the Vẽ tool — its rules, as pure functions (spec: draw/piece.md).

   The pen (points placed one click at a time, a turn point or — with ⇧ — a curve point), the moment it
   closes, the record a piece carries (name, quantity, fabric: CLAUDE.md §5.10), its default grainline,
   where a notch lands, the rows of the panel, and every vertex a closed shape is written with. No
   geometry rule lives here: the outline is geometry/outline.js, the shapes are geometry/entity.js.
   Millimetres, degrees counter-clockwise from +X. */
import {createLine, createLinePolar, createPath, entityShape} from "../geometry/entity.js";
import {outlineSample, outlineEdges, outlineLength, outlineChain, outlineTurns, outlineArea} from "../geometry/outline.js";
import {bbox, closestPoint, point, sample, looseBox, boxGap} from "../geometry/model.js";
import {chain} from "../geometry/path.js";
import {cornerIndices, fromCorner} from "../geometry/corners.js";
import {pathGroups, runOf} from "../dxf/model.js";
import {parseLength} from "../../shared/units.js";
import {pieceOffset} from "./flow.js";

/* the layers a piece is written on — the way BLOCK_36C and the house file write theirs (CLAUDE.md §6) */
export const PIECE_LAYER = "1";
export const TURN_LAYER = "2";
export const CURVE_LAYER = "3";
export const NOTCH_LAYER = "4";
export const GRAIN_LAYER = "7";
export const PIECE_TEXT_LAYER = "8";
const CLOSED = new Set(["rect", "circle", "polygon", "path"]);
const EXPORT_TOL = 0.01;                                        // mm — as dxf/write.js samples a curve
const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ── the pen (M1–M3) ───────────────────────────────────────────────────────────── */
/* a click at w closes the pen when it lands on the first point (r: the pick radius, mm) — from three points on */
export const penCloses = (pts, w, r) => pts.length >= 3 && hyp(w, pts[0]) <= r;
/* a double-click (P16): two presses within DBL_MS and DBL_PX on the screen — the canvas redraws on every press, so the browser
   never fires dblclick and the pen counts it itself */
export const DBL_MS = 500;
export const DBL_PX = 5;
/* What a press of the pen does (M2 — TD 2026-09-24: "cho double click để kết thúc đường vẽ"): "close" on the first point, or
   as the second press of a double-click (the first one placed the point); "few" — that double-click with fewer than three
   points, said as Enter says it; "ignore" — the second press of a double-click whose first press closed the piece, which
   must not start a new one; else "add". press, prev: {t (ms), x, y (screen px)}, prev.closed: that press closed the pen */
export function penPress(pts, w, r, press, prev){
  const dbl = !!prev && press.t - prev.t <= DBL_MS && Math.hypot(press.x - prev.x, press.y - prev.y) <= DBL_PX;
  if(dbl && prev.closed) return "ignore";
  if(penCloses(pts, w, r)) return "close";
  if(dbl) return pts.length >= 3 ? "close" : "few";
  return "add";
}
/* the next point of a typed side: Length along Angle from the last one — exactly a typed Line's end */
export const penNext = (last, len, angle) => createLinePolar(last, len, angle).b;
/* what the next click would make: a line from the one point placed, else the closed outline with the
   cursor as its next point (a curve point when ⇧ is held) — null when that cannot be a shape yet */
export function penGhost(pts, kinds, at, asCurve = false){
  if(!pts.length) return null;
  try{
    if(pts.length === 1) return createLine(pts[0], at);
    return createPath([...pts, at], [...kinds, asCurve ? "curve" : "turn"]);
  }catch(e){ return null; }
}

/* ── the record (M4 · M5) ──────────────────────────────────────────────────────── */
/* the number after the highest one used — a deleted piece's number is not handed out again */
export const nextPieceNumber = pieces => 1 + pieces.reduce((m, p) => Math.max(m, p.n || 0), 0);
export const pieceRecord = n => ({n, name: `Mảnh ${n}`, qty: "1", category: ""});
/* an ASCII block name no block of the file already has (P6) */
export function blockNameFor(n, taken){
  const base = `MANH_${n}`;
  if(!taken.has(base)) return base;
  let k = 2;
  while(taken.has(`${base}_${k}`)) k++;
  return `${base}_${k}`;
}
export const isClosedShape = e => !!e && CLOSED.has(e.type);
/* what was typed into Tên · SL · Vải (M8): the value to store, or why not. SL is a whole number ≥ 1, or R,L —
   two whole numbers ≥ 0, not both 0 — the forms the library writes (1 · 2 · 4 · 1,0 · 1,1) and ASTM's Quantity: R,L */
const wholeNumber = s => s !== "" && [...s].every(c => c >= "0" && c <= "9");
export function readPieceField(key, text){
  const v = String(text).trim();
  if(key === "name") return v ? {ok: true, value: v} : {ok: false, error: "mảnh cần một tên"};
  if(key !== "qty") return {ok: true, value: v};
  const parts = v.split(",").map(x => x.trim());
  if(parts.every(wholeNumber)){
    const n = parts.map(Number);
    if(n.length === 1 && n[0] >= 1) return {ok: true, value: String(n[0])};
    if(n.length === 2 && n[0] + n[1] >= 1) return {ok: true, value: `${n[0]},${n[1]}`};
  }
  return {ok: false, error: `SL "${v}": một số nguyên ≥ 1 (1 · 2) hoặc R,L — số mảnh phải, trái (1,0 · 1,1)`};
}
/* vertical, through the middle of the piece's box, 60 % of its height (P4) */
export function defaultGrain(outline){
  const b = bbox(entityShape(outline)), x = (b.x0 + b.x1)/2, h = b.y1 - b.y0, yc = (b.y0 + b.y1)/2;
  return createLine([x, yc - 0.3*h], [x, yc + 0.3*h]);
}
/* Why a closed shape cannot be a piece (M16), or null: a piece has an inside. Thinner than 0.01 mm — twice its area over
   its length, the width of a strip — is no area: points in a line, a spike folded back on the side just drawn (seen
   2026-09-24: three points in a vertical line made "Mảnh 3"). An outline crossing itself has two insides, or none. A
   Rect, a Circle, a Polygon cannot be either: their sizes are > 0 by construction (entity.js). */
const THIN = 0.01;                                              // mm — as every geometric tolerance of the project
export function outlineProblem(e){
  if(!e || e.type !== "path") return null;
  /* walked with a tolerance of 1e-9 mm, not the CAD gap: its segments meet bit for bit, and at 0.05 mm a strip that
     narrow reads as two edges drawn on one another. A chain that still refuses has no inside to speak of */
  let crossings = null;
  try{ crossings = outlineChain(e.pts, e.kinds, {tol: 1e-9}).crossings; }catch(err){ crossings = null; }
  if(crossings && crossings.length){
    const x = crossings[0];
    return `đường cắt tự cắt ${crossings.length} chỗ (gần ${x.x.toFixed(1)}, ${x.y.toFixed(1)}) — mảnh phải là một vòng không vắt chéo`;
  }
  const total = outlineLength(e.pts, e.kinds);
  if(!(total > 0) || 2*Math.abs(outlineArea(e.pts, e.kinds))/total < THIN) return "mảnh mỏng hơn 0.01 mm (các điểm gần như thẳng hàng) — mảnh phải có diện tích";
  if(crossings === null) return "đường cắt đi lại trên chính nó — mảnh phải là một vòng không vắt chéo";
  return null;
}
/* A closed shape made a piece (M4 · M5): the next number, a block name that neither a block of the file
   (taken) nor a piece already drawn has, the default grainline. The record draw.js keeps, and what
   scripts/check_sketch.py makes the same way. A shape with no inside is refused, with why (M16). */
export function pieceFrom(outline, pieces, taken){
  if(!isClosedShape(outline)) throw new Error(`${outline && outline.type} không phải hình kín — không làm mảnh được`);
  const why = outlineProblem(outline);
  if(why) throw new Error(why);
  const n = nextPieceNumber(pieces), names = new Set([...taken, ...pieces.map(p => p.blockName)]);
  return {...pieceRecord(n), blockName: blockNameFor(n, names), grain: defaultGrain(outline)};
}
/* Thành mảnh keeps a shape where it is shown (M18). A shape of a file piece lives in that piece's FILE frame and is
   shown at + its Arrange offset; a drawn piece lives in the canvas frame — so the shape moves by that offset, or it
   jumps (seen 2026-09-24: 50 mm). With relations it would pull what is tied to it, in another frame: refused.
   m: the shape's record {pi}; related: it takes part in a relation. → {d: [dx, dy]} | {error} */
export function toPieceShift(m, pieces, related){
  const off = pieceOffset(!m ? null : m.pc ? m.pc : m.pi >= 0 ? pieces[m.pi] : null);
  if(!off[0] && !off[1]) return {d: [0, 0]};
  if(related) return {error: "hình này có quan hệ với hình khác trên một mảnh Arrange đã dời — gỡ quan hệ (Gỡ) rồi hãy Thành mảnh"};
  return {d: off};
}
/* the sample size a new piece is written with: the file's own (its "Sample Size" line), else its first
   piece's, else none (P5) */
export function sampleSizeOf(model){
  const h = model && model.header ? model.header : {};
  const k = Object.keys(h).find(x => x.toLowerCase() === "sample size");
  if(k && h[k]) return h[k];
  const p = model && model.pieces ? model.pieces.find(q => q.sample) : null;
  return p ? p.sample : "";
}

/* ── what a closed shape is written as (M10) ──────────────────────────────────── */
/* every vertex of its cut line and which of them are turn points: an outline by its own samples (sketch
   O11), a rectangle or polygon by its corners, a circle by samples within 0.01 mm and no corner */
export function outlineOf(e){
  if(!isClosedShape(e)) throw new Error(`${e && e.type} không phải hình kín — không làm đường cắt của mảnh được`);
  if(e.type === "path") return outlineSample(e.pts, e.kinds, EXPORT_TOL);
  const s = entityShape(e);
  if(e.type === "circle"){
    const pts = sample(s, EXPORT_TOL);
    if(pts.length > 1 && hyp(pts[0], pts[pts.length - 1]) <= 1e-9) pts.pop();
    return {pts: pts.map(q => [q[0], q[1]]), turn: pts.map(() => false)};
  }
  return {pts: s.pts.map(q => [q[0], q[1]]), turn: s.pts.map(() => true)};
}

/* What goes with a drawn piece's cut line when it moves — dragged by its body, nudged with an arrow, Dời (M9): the piece's
   shapes no relation holds (its grainline, the shapes drawn into it — M17), less those moving already by their own
   selection. A notch rides on the cut line by its relation. Before 2026-09-24 a nudge or Dời moved the cut line alone */
export const pieceFollowers = (outlineId, members, isDriven, moving = []) =>
  members.filter(id => id !== outlineId && !isDriven(id) && !moving.includes(id));

/* ── notches (M7) ──────────────────────────────────────────────────────────────── */
/* candidates: [{ref, shape}] — the cut lines a notch may go on, as shown; the nearest one within r takes
   it, at its foot. null when nothing is that near. Two cut lines in ONE place (≤ 0.01 mm — two pieces touching edge to edge):
   the one of the piece whose zone holds the click, inZone(ref, w) (draw.md V11), not whichever is nearer by a hair */
const SAME_PLACE = 0.01;                                        // mm — as a line this close to another is on it
export function notchTarget(candidates, w, r, inZone = null){
  let best = null;
  const near = [];
  candidates.forEach((c, index) => {
    if(boxGap(looseBox(c.shape), w) > r) return;                   // its box is out of reach: so is the line
    const q = closestPoint(c.shape, point(w[0], w[1]));
    if(q.dist > r) return;
    const h = {ref: c.ref, point: [q.point.x, q.point.y], dist: q.dist, t: q.t, index};
    near.push(h);
    if(!best || q.dist < best.dist) best = h;
  });
  if(!best || !inZone) return best;
  return near.find(h => h.dist <= best.dist + SAME_PLACE && inZone(h.ref, w)) || best;
}

/* ── a notch at a distance from a corner (M15) ─────────────────────────────────── */
/* what was typed into Cách góc: empty is "at the click" (null); else a length ≥ 0, read as every length box reads
   one (1/2 · 3mm · 12,7). {ok, mm} or {ok: false, error} */
export function readNotchDistance(text, unit){
  const t = String(text ?? "").trim();
  if(!t) return {ok: true, mm: null};
  try{
    const v = parseLength(t, unit);
    return v >= 0 ? {ok: true, mm: v} : {ok: false, error: `khoảng cách không hợp lệ: "${t}" — cần một độ dài ≥ 0`};
  }catch(e){ return {ok: false, error: e.message}; }
}
/* a drawn piece's cut line as the kernel measures along it: a Path by its segments, cornered at its turn points;
   a Rect or Polygon by its sides, cornered at every vertex; a Circle has no corner. {ch, corners} */
export function drawnCutLine(e){
  if(e.type === "path") return {ch: outlineChain(e.pts, e.kinds), corners: outlineTurns(e.kinds).map(k => e.pts[k])};
  const s = entityShape(e);
  return {ch: chain([s]), corners: e.type === "circle" ? [] : s.pts.map(q => [q[0], q[1]])};
}
/* a file piece's cut line: the run of its layer-1 paths, touching end to end, that holds path k — the run a cut
   line is (dxf/model.js runOf), cornered by Edges' definition (geometry/corners.js) on the same vertices */
export function fileCutLine(piece, k){
  const mine = piece.paths.map((q, i) => ({q, i})).filter(x => x.q.layer === PIECE_LAYER);
  const g = pathGroups(mine.map(x => x.q)).find(gr => gr.some(j => mine[j].i === k));
  if(!g) throw new Error("đường này không phải đường cắt (layer 1) của mảnh");
  const run = runOf(g.map(j => mine[j].q));
  return {ch: run.ch, corners: cornerIndices(run.pts, run.closed).map(i => run.pts[i])};
}
/* Where a notch goes for a click at w (M7 · M15): the nearest cut line within r takes it — at the foot of the
   click when d is null, else d along that line from the nearer corner of the edge clicked (kernel fromCorner).
   lines: [{ref, shape, cut}], cut() that line as {ch, corners}; inZone as notchTarget's. {ref, point} · {ref, error,
   edgeLength?} · null */
export function notchPlace(lines, w, r, d, inZone = null){
  const hit = notchTarget(lines, w, r, inZone);
  if(!hit || d === null || d === undefined) return hit;
  try{
    const line = lines[hit.index].cut(), f = fromCorner(line.ch, line.corners, hit.point, d);
    return {ref: hit.ref, index: hit.index, point: f.point, corner: f.corner, edgeLength: f.length};
  }catch(e){ return {ref: hit.ref, index: hit.index, error: e.message, edgeLength: e.edgeLength}; }
}

/* ── the panel (M8) ────────────────────────────────────────────────────────────── */
/* L(mm, d, label) writes a length in the display unit */
export function drawnPieceRows(p, outline, notches, L){
  const rows = [["Mảnh", p.name, false], ["SL", p.qty || "—", false], ["Vải", p.category || "—", false]];
  if(outline.type === "path"){
    const turns = outline.kinds.filter(k => k === "turn").length;
    rows.push(["Chu vi", L(outlineLength(outline.pts, outline.kinds)), false],
              ["Điểm", `${turns} góc · ${outline.pts.length - turns} cong`, false],
              ["Cạnh", outlineEdges(outline.pts, outline.kinds).map(x => L(x.length)).join(" · "), false]);
  } else rows.push(["Chu vi", L(outlineLengthOf(outline)), false]);
  rows.push(["Notch", String(notches), false]);
  const why = outlineProblem(outline);                          // a drag left it with no inside (M16)
  if(why) rows.push(["⚠", why, false]);
  return rows;
}
const outlineLengthOf = e => { const o = outlineOf(e); return o.pts.reduce((s, q, i) => s + hyp(q, o.pts[(i + 1) % o.pts.length]), 0); };
