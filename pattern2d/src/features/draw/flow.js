/* The Vẽ tool's own rules, as pure functions (spec: draw/draw.md) — what a click makes, what the ghost
   shows, which piece a new shape joins, which frame it lives in, what the pointer picks, what a click may
   snap to, and how the drawing goes into the file Xuất DXF writes.

   No geometry rule lives here: shapes come from geometry/entity.js and move by geometry/sketch.js. What
   is added is bookkeeping around them — and one thing only a tool knows: Arrange. A piece TD has laid
   out somewhere else on the canvas has moved its data by (ox, oy) but not its place in the file, so a
   drawn shape keeps the FILE's coordinates and is shown at + (ox, oy); the export writes file
   coordinates, whatever the layout. Millimetres, degrees counter-clockwise from +X. */
import {createLine, createLinePolar, createCurve, createRect, createCircle, createPolygon,
        entityHandles, entityShape, entitySnap, entityDims, moveEntity} from "../geometry/entity.js";
import {closestPoint, point, transform, translation} from "../geometry/model.js";
import {MM_PER} from "../../shared/units.js";
import {isTyping} from "../../shared/dom.js";
import {pointInPoly} from "../../shared/geom.js";

export const DRAW_MODES = ["select", "line", "curve", "rect", "circle", "polygon"];
/* the two modes a new piece is made with (piece.md): the pen of its outline, and its notches */
export const PIECE_MODES = ["piece", "notch"];
/* the layers a drawn shape may go on, the default first (W3) — layer 8 is the viewer's inner/sewing line */
export const DRAW_LAYERS = ["8", "1", "7", "11"];
/* what a new shape starts from until TD types something else (W5): 2 × 1 in, Ø 3/8 in, Size 1 in, 6 sides —
   worked out the way parseLength reads "3/8" in inches, so typing a default back changes no bit */
const IN = MM_PER.inch;
export const DRAW_NUMS = {len: 2*IN, lineAngle: 0, w: 2*IN, h: 1*IN, d: 3/8*IN, size: 1*IN, sides: 6, angle: 0};

export const clicksNeeded = mode => mode === "line" || mode === "curve" ? 2 : 1;

/* ── what a click makes (V2) ───────────────────────────────────────────────────
   clicks are in the file frame of the piece the shape will join; `typed` means a Line made from its
   Start and the Length + Angle boxes. null = not enough clicks yet; a bad number throws, with why */
export function shapeFrom(mode, clicks, nums, {typed = false} = {}){
  if(!DRAW_MODES.includes(mode) || mode === "select") throw new Error(`chế độ "${mode}" không vẽ hình`);
  if(mode === "line"){
    if(clicks.length >= 2) return createLine(clicks[0], clicks[1]);
    return clicks.length === 1 && typed ? createLinePolar(clicks[0], nums.len, nums.lineAngle) : null;
  }
  if(mode === "curve") return clicks.length >= 2 ? createCurve(clicks[0], clicks[1]) : null;
  if(!clicks.length) return null;
  if(mode === "rect") return createRect(clicks[0], nums.w, nums.h);
  if(mode === "circle") return createCircle(clicks[0], nums.d);
  return createPolygon(clicks[0], nums.size, nums.sides, nums.angle);
}
/* the shape a click at `at` would make — drawn dashed before the click (V3); never throws */
export function ghostOf(mode, clicks, at, nums){
  if(mode === "select" || ((mode === "line" || mode === "curve") && !clicks.length)) return null;
  try{ return shapeFrom(mode, [...clicks, at], nums); }catch(e){ return null; }
}

/* the Vẽ keys (W1, M12): 1–5 a shape, 6 the piece pen, 7 a notch, 0 / Esc back to Chọn — not with ⌘ · Ctrl ·
   ⌥, not while typing */
export function drawKey(ev){
  if(ev.metaKey || ev.ctrlKey || ev.altKey) return null;
  if(isTyping(ev)) return null;
  return {"1": "line", "2": "curve", "3": "rect", "4": "circle", "5": "polygon", "6": "piece", "7": "notch",
          "0": "select", "Escape": "select"}[ev.key] || null;
}
/* The groups of boxes the dock shows — only what the moment needs: the dock sits over the canvas, and every row
   it saves is drawing room (piece.md M11). A piece's cut line and notches keep their layers and take no relation,
   so neither box shows for them. v: mode · kind, type (what the boxes speak for: "create" the next shape of the
   mode, "edit" the one shape selected, "none") · count (shapes selected) · closed, piece, role (of the one shape
   selected: a closed shape, part of a drawn piece, its role in it). */
export function dockGroups({mode, kind, type, count = 0, closed = false, piece = false, role = null}){
  const one = count === 1, g = new Set();
  if(mode === "line" || mode === "piece" || (kind === "edit" && type === "line")) g.add("line");
  if(["rect", "circle", "polygon"].includes(type)) g.add(type);
  if(one && piece) g.add("piece");
  if(one && closed && role !== "outline") g.add("topiece");              // in every mode, right after drawing it too (M14) —
                                                                          // a closed shape drawn inside a drawn piece too (M17)
  const fixed = one && (role === "outline" || role === "notch");
  if(mode !== "piece" && mode !== "notch" && !(mode === "select" && fixed)) g.add("layer");
  if(mode === "select" && one && !fixed) g.add("rel");
  if(mode === "select" && count) g.add("move");
  if(mode === "notch") g.add("notch");                                    // Cách góc (piece.md M15)
  return g;
}
/* 6 / 7 while another tool is on, or none: Vẽ opens straight in Mảnh / Notch — one key instead of V then 6
   (piece.md M13). They pick the same modes as inside Vẽ; 1–5 and 0 stay Vẽ's own. null: not such a key */
const OPEN_KEYS = ["6", "7"];
export const openKey = ev => OPEN_KEYS.includes(ev.key) ? drawKey(ev) : null;
/* the piece of the file a new shape joins (V11), except that a shape on the cut layer never joins a piece: that
   piece has its cut line already, and a second one would make it two pieces (piece.md M6, F4) */
export const drawTarget = (layer, pieces, primary, w) => joinTarget(layer, pieces, primary, w).pi;

/* ── each piece its own zone (TD 2026-09-24: "mỗi piece phải có vùng riêng, không lẫn vào nhau") ─────────────
   A piece's ZONE is the inside of its closed cut line — the one dxf/model.js builds (p.cut), or a drawn piece's outline
   (ring) — and the box of a piece that has none. Its box is not its zone: an L-shaped piece's box is empty in the corner,
   where the next piece sits — before 2026-09-24 the smallest box took the click, and 3.4 % of the clicks inside exactly one
   cut line of the library went to another piece (SofyLift 12.5 %, VeraLifting 10.5 %). */
const inBox = (b, q) => !!b && q[0] >= b.x0 && q[0] <= b.x1 && q[1] >= b.y0 && q[1] <= b.y1;
const ringArea = pts => Math.abs(pts.reduce((s, q, i) => { const r = pts[(i + 1) % pts.length]; return s + q[0]*r[1] - r[0]*q[1]; }, 0))/2;
function ringDist(pts, w){
  let best = Infinity;
  for(let i = 0; i < pts.length; i++){
    const a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1], dd = dx*dx + dy*dy;
    const t = dd ? Math.max(0, Math.min(1, ((w[0] - a[0])*dx + (w[1] - a[1])*dy)/dd)) : 0;
    best = Math.min(best, Math.hypot(w[0] - a[0] - dx*t, w[1] - a[1] - dy*t));
  }
  return best;
}
function zonesOf(pieces, drawn, primary){
  const zs = [];
  pieces.forEach((p, i) => { if(p && p.bbox) zs.push({t: {pi: i, pid: null}, ring: p.cutClosed && p.cut && p.cut.length >= 3 ? p.cut : null,
                                                       bbox: p.bbox, selected: i === primary}); });
  for(const d of drawn) if(d.bbox) zs.push({t: {pi: -1, pid: d.pid}, ring: d.ring && d.ring.length >= 3 ? d.ring : null, bbox: d.bbox, selected: !!d.selected});
  return zs;
}
const zoneSize = z => z.ring ? ringArea(z.ring) : (z.bbox.x1 - z.bbox.x0)*(z.bbox.y1 - z.bbox.y0);
/* The zone holding w — {pi, pid} — or null when none does. Zones overlap only where pieces lie on one another (a nest of
   sizes, a piece drawn over another): then the selected one among them, else the smallest */
export function zoneAt(pieces, w, drawn = [], primary = -1){
  const inside = zonesOf(pieces, drawn, primary).filter(z => inBox(z.bbox, w) && (!z.ring || pointInPoly(z.ring, w)));
  if(!inside.length) return null;
  const chosen = inside.find(z => z.selected);
  if(chosen) return chosen.t;
  return inside.reduce((a, z) => zoneSize(z) < zoneSize(a) ? z : a).t;
}
/* The piece a new shape joins (V11 — TD 2026-09-24: "chỗ bấm quyết định"), of the file or DRAWN in Vẽ (piece.md M17): the zone
   holding the first click, even with another piece selected; outside every zone, the cut line within `near` mm (the pick
   radius — a click on a notch at the very edge); else the piece of the file selected, then the drawn piece selected (one of
   its shapes is in the selection); else none, a shape of its own. Layer 1 joins nothing (M6). drawn: [{pid, bbox, ring,
   selected}]. → {pi: file piece index or -1, pid: drawn piece id or null} */
export function joinTarget(layer, pieces, primary, w, drawn = [], near = 0){
  const none = {pi: -1, pid: null};
  if(layer === "1") return none;
  const z = zoneAt(pieces, w, drawn, primary);
  if(z) return z;
  if(near > 0){
    let best = null, d = near;
    for(const q of zonesOf(pieces, drawn, primary)){
      if(!q.ring || w[0] < q.bbox.x0 - near || w[0] > q.bbox.x1 + near || w[1] < q.bbox.y0 - near || w[1] > q.bbox.y1 + near) continue;
      const e = ringDist(q.ring, w);
      if(e <= d){ d = e; best = q.t; }
    }
    if(best) return best;
  }
  if(Number.isInteger(primary) && primary >= 0 && primary < pieces.length) return {pi: primary, pid: null};
  const chosen = drawn.find(d => d.selected);
  return chosen ? {pi: -1, pid: chosen.pid} : none;
}
/* two shapes in one zone: one piece of the file, one drawn piece, or both of their own (V4, V7) */
export const sameZone = (a, b) => !!a && !!b && a.pi === b.pi && (a.pid || null) === (b.pid || null);
/* The drawn shapes in the drawing now (pieces/remove.md R4 · R5), each with its piece where it is NOW: a shape holds its piece
   of the file itself (m.pc), never a place in the list — one whose piece was deleted is not placed (not drawn, picked, snapped
   to or written), and ⌘Z bringing the piece back brings it back. meta: Map id → {pc, piece, layer, role}.
   → [{id, pi, pid, layer, role, m}] */
export function placedShapes(meta, pieces){
  const out = [];
  for(const [id, m] of meta){
    const pi = m.pc ? pieces.indexOf(m.pc) : -1;
    if(m.pc && pi < 0) continue;
    out.push({id, pi, pid: m.piece || null, layer: m.layer, role: m.role || null, m});
  }
  return out;
}
/* what the Layer list speaks for (M11, F1): the selection while choosing — the next shape while drawing */
export const layerApplies = (mode, sel) => mode === "select" && sel.length ? "selection" : "next";
/* the layer of the shape being made (V10, M11): the one it was started on, when a click was already given — that layer chose
   its piece (layer 1 joins none, M6); a layer picked before its last click is the next shape's. clicks: how many so far */
export const madeLayer = ({clicks, first, now}) => clicks > 0 ? first : now;
/* why a shape may not move to `layer` (M6): a shape of a piece — of the file or drawn — never goes onto the cut layer,
   the piece has its cut line; seen 2026-09-24: a layer-8 line switched to 1 in cup_upper_M wrote that block with two
   cut lines. m: the shape's record {pi, layer, piece?}. null = it may */
export function layerRefusal(m, layer){
  if(layer !== "1" || !m || m.layer === "1") return null;
  if(m.pc || m.pi >= 0 || m.piece) return "layer 1 không vào mảnh có sẵn — mảnh đó đã có đường cắt (M6); hình kín: Thành mảnh · đường hở: vẽ lại ngoài mảnh trên layer 1";
  return null;
}
/* what Delete says (V9, M9, delete_line.md §3 — say who was using it): how many shapes, the pieces that went whole, a
   piece left without its grainline, the shapes that hung on what was deleted and now stand where they are */
export function deletedText({count, pieces = [], lost = [], freed = []}){
  return `đã xoá ${count} hình` + (pieces.length ? ` — cả ${pieces.join(", ")}` : "") +
         (lost.length ? ` — ${lost.join(", ")} không còn canh sợi (CLAUDE.md §5.10)` : "") +
         (freed.length ? ` · ${freed.join(", ")} thôi bám (đứng yên)` : "");
}

/* ── which piece, which frame (V11, V12) ─────────────────────────────────────── */
export const pieceOffset = p => p ? [p.ox || 0, p.oy || 0] : [0, 0];
export const toFile = (w, off) => [w[0] - off[0], w[1] - off[1]];
export const toShown = (p, off) => [p[0] + off[0], p[1] + off[1]];
export const shownEntity = (e, off) => off[0] || off[1] ? moveEntity(e, off[0], off[1]) : e;
const moved = (s, off) => off[0] || off[1] ? transform(s, translation(off[0], off[1])) : s;

/* a shape whose layer is off is not there for the hand: it leaves the selection, so Delete, a nudge or a
   relation never touches what the eye cannot see (V10); a layer the file never had is on */
export const shownSel = (sel, meta, layersOn) => sel.filter(id => meta.has(id) && layersOn[meta.get(id).layer] !== false);

/* ── what the pointer picks (V5) ─────────────────────────────────────────────────
   items: [{id, entity, off}], w in canvas coordinates, r the pick radius in mm. The handles of the
   shapes selected come first — control points too — then the points of every shape (ends, corners,
   vertices, centres), then the shapes themselves ("body"). null = nothing within r */
export function pickDrawn(items, w, r, selected = []){
  const near = (list) => {
    let best = null;
    for(const c of list){ const d = Math.hypot(c.at[0] - w[0], c.at[1] - w[1]); if(d <= r && (!best || d < best.dist)) best = {id: c.id, handle: c.handle, dist: d}; }
    return best;
  };
  const sel = new Set(selected);
  const mine = items.filter(it => sel.has(it.id)).flatMap(it =>
    entityHandles(it.entity).filter(h => h.at).map(h => ({id: it.id, handle: h.name, at: [h.at[0] + it.off[0], h.at[1] + it.off[1]]})));
  const hit = near(mine);
  if(hit) return hit;
  const points = items.flatMap(it => { const s = entitySnap(it.entity);
    return s.points.map((p, k) => ({id: it.id, handle: s.handles[k], at: [p[0] + it.off[0], p[1] + it.off[1]]})); });
  const pt = near(points);
  if(pt) return pt;
  let best = null;
  for(const it of items){
    const d = closestPoint(entityShape(it.entity), point(w[0] - it.off[0], w[1] - it.off[1])).dist;
    if(d <= r && (!best || d < best.dist)) best = {id: it.id, handle: "body", dist: d};
  }
  return best;
}

/* ── what a click may snap to (V4) ───────────────────────────────────────────────
   every visible POINT, vertex and line of the pieces, each piece brought back to its file frame. A
   piece Arrange never moved hands over its own shape objects, so a relation declared on one of them
   (a Coincident, then the Tangent that stands on it) keeps pointing at the same thing */
export function pieceTargets(pieces, layersOn, {shown = false} = {}){
  const out = {points: [], shapes: [], refs: {points: [], shapes: []}};
  const add = p => { out.points.push(p); out.refs.points.push({point: p}); };
  for(const pc of pieces){
    /* shown: where the piece is on screen — what the piece pen and the notch aim at (a new piece has no
       Arrange offset: its file frame IS the canvas) */
    const off = shown ? [0, 0] : pieceOffset(pc), back = [-off[0], -off[1]];
    for(const q of pc.points || []) if(layersOn[q.layer]) add([q.x - off[0], q.y - off[1]]);
    for(const path of pc.paths || []){
      if(!layersOn[path.layer]) continue;
      for(const v of path.snap || path.pts) add([v[0] - off[0], v[1] - off[1]]);
      for(const s of path.shapes || []){ const f = moved(s, back); out.shapes.push(f); out.refs.shapes.push({shape: f}); }
    }
  }
  return out;
}

/* Snap targets for a shape of `zone` ({pi, pid} of its piece — or null: everything, for the piece pen, M1) as SHOWN (V4 — TD
   2026-09-24: "không hít vào mảnh khác, trừ khi vẽ tiếp tục trên piece đó"): the drawn shapes of that zone and, for a piece
   of the file, its own POINTs, vertices and lines. A shape of its own snaps to shapes of its own. The drawn shapes come first:
   where a drawn end sits on a DXF point, a tie goes to the drawn one — a curve joined to the line just drawn should follow
   that line (and may be tangent to it), not the notch under it. drawn: [{id, shown, pi, pid}] — the visible ones, each where
   it is shown; except: the shape being dragged; snapsOf(piece): its targets as shown (the caller may keep them) */
export function zoneTargets(drawn, pieces, layersOn, zone, except = null, snapsOf = p => pieceTargets([p], layersOn, {shown: true})){
  const t = {points: [], shapes: [], refs: {points: [], shapes: []}};
  for(const d of drawn){
    if(d.id === except || (zone && !sameZone({pi: d.pi, pid: d.pid}, zone))) continue;
    const s = entitySnap(d.shown);
    s.points.forEach((p, i) => { t.points.push(p); t.refs.points.push({id: d.id, handle: s.handles[i]}); });
    s.shapes.forEach(sh => { t.shapes.push(sh); t.refs.shapes.push({id: d.id}); });
  }
  const ps = !zone ? pieces : zone.pi >= 0 && pieces[zone.pi] ? [pieces[zone.pi]] : [];
  let out = t;
  for(const pc of ps){                                          // concat, not push(...): a piece of 10 000 splines has more
    const b = snapsOf(pc);                                    // points than a call may take arguments
    out = {points: out.points.concat(b.points), shapes: out.shapes.concat(b.shapes),
           refs: {points: out.refs.points.concat(b.refs.points), shapes: out.refs.shapes.concat(b.refs.shapes)}};
  }
  return out;
}
/* Snap targets as SHOWN — the pieces where Arrange laid them, the drawn shapes where their pieces are — brought into the
   frame of the shape drawn or dragged: its piece's file frame, − that piece's Arrange offset (V4, V12). A click snaps to
   what is on screen and the shape keeps its piece's coordinates. Before 2026-09-24 each piece's targets were in ITS OWN
   file frame: a shape of another piece, or of none, missed a moved piece's notch where it was shown and snapped to the
   empty spot where it had been. off 0 — the canvas: a shape of its own, a drawn piece, a piece never moved — hands back
   the very same targets, so a relation declared on a DXF shape keeps pointing at it (a Tangent stands on it) */
export const framedRef = (r, off) => !off[0] && !off[1] ? r
  : r.point ? {point: [r.point[0] - off[0], r.point[1] - off[1]]} : r.shape ? {shape: moved(r.shape, [-off[0], -off[1]])} : r;
export function framedTargets(t, off){
  if(!off[0] && !off[1]) return t;
  const shapes = t.shapes.map(s => moved(s, [-off[0], -off[1]])), at = new Map(t.shapes.map((s, i) => [s, shapes[i]]));
  return {points: t.points.map(p => [p[0] - off[0], p[1] - off[1]]), shapes,
          refs: t.refs && {points: t.refs.points.map(r => framedRef(r, off)),
                           shapes: t.refs.shapes.map(r => r.shape && at.has(r.shape) ? {shape: at.get(r.shape)} : framedRef(r, off))}};
}
/* A LIVE relation between two drawn shapes keeps their coordinates together — one point in the FILE. Pieces laid out apart by
   Arrange show that point in two places: "Trùng" would be declared of two points far apart on screen (bấm thật 2026-09-24:
   30 mm). true = refused (V7). A DXF master (null here) is a snapshot taken where it is shown: never apart */
const offsetOfMeta = (m, pieces) => !m ? [0, 0] : m.pc ? pieceOffset(m.pc) : m.pi >= 0 ? pieceOffset(pieces[m.pi]) : [0, 0];
export function frameClash(mDriven, mMaster, pieces){
  if(!mMaster) return false;
  const a = offsetOfMeta(mDriven, pieces), b = offsetOfMeta(mMaster, pieces);
  return Math.abs(a[0] - b[0]) > 1e-9 || Math.abs(a[1] - b[1]) > 1e-9;
}

/* ── words for the readout ─────────────────────────────────────────────────────── */
const NAME = {line: "Line", curve: "Curve", rect: "Rectangle", circle: "Circle", polygon: "Polygon"};
/* L(mm, d, label) writes a length in the display unit (shared/units.js) */
export function drawnRows(e, L){
  const d = entityDims(e), deg = v => v.toFixed(2) + "°";
  const head = [["Hình", NAME[e.type], false]];
  if(e.type === "line") return head.concat([["Dài", L(d.length), false], ["Góc", deg(d.angle), false]]);
  if(e.type === "curve") return head.concat([["Dài", L(d.length), false], ["Dây cung", L(d.chord), false]]);
  if(e.type === "rect") return head.concat([["W", L(d.w), false], ["H", L(d.h), false]]);
  if(e.type === "circle") return head.concat([["D", L(d.d), false]]);
  return head.concat([["Size", L(d.size), false], ["Cạnh", String(d.sides), false], ["Angle", deg(d.angle), false]]);
}
const who = r => !r ? "?" : r.point ? "điểm DXF" : r.shape ? "đường DXF" : r.handle !== undefined ? `${r.id}.${r.handle}` : String(r.id);
export function relationText(c){
  if(c.type === "horizontal" || c.type === "vertical")
    return (c.type === "horizontal" ? "Ngang" : "Dọc") + (c.on.handle ? ` (tay nắm ${c.on.handle})` : "");
  if(c.type === "coincident")
    return `${c.driven.handle} ` + (c.master.point || c.master.handle !== undefined ? `trùng ${who(c.master)}` : `nằm trên ${who(c.master)}`);
  if(c.type === "tangent") return `Tiếp tuyến ${who(c.master)} tại ${c.end}`;
  return `Bằng ${who(c.master)}`;
}
/* what the ends of a line or curve are held on — the masters a Tangent may stand on (W7) */
const ENDS = new Set(["a", "b", "p0", "p3"]);
export function junctionOf(constraints, id, end){
  return constraints.filter(c => c.type === "coincident" && c.driven.id === id && ENDS.has(c.driven.handle) && (!end || c.driven.handle === end))
                    .map(c => ({master: c.master, end: c.driven.handle}));
}

/* ── typed numbers that are not lengths (an angle: shared/units.js parseAngle) ──── */
/* a polygon's number of sides: a whole number from 3 to 1000 (G4) */
export function readSides(text){
  const s = String(text ?? "").trim();
  const n = /^\d+/.exec(s);
  const v = n && n[0].length === s.length ? parseInt(s, 10) : NaN;
  if(!(v >= 3 && v <= 1000)) throw new Error(`số cạnh không hợp lệ: "${text}" — cần số nguyên từ 3 tới 1000`);
  return v;
}
