/* The piece side of the Vẽ controller (spec: draw/piece.md) — the pieces drawn here, and the pen that draws them.

   draw.js keeps the drawing itself — the sketch, what each shape is, the selection, undo — and binds this file to
   it once (`PieceTool.bind(env)`: a window on that state, with getters and setters). What lives here is what only a
   piece has: its record (name, quantity, fabric, block name, which shapes are its cut line and grainline), the
   points of the pen before it closes, notches, and how a piece is moved, reshaped, deleted and written out. The
   rules themselves are the pure functions of piece.js; the geometry is the kernel's. */
import {createPath, createPoint, entityShape, setPathKind} from "../geometry/entity.js";
import {bbox} from "../geometry/model.js";
import {Canvas} from "../canvas/canvas.js";
import {pieceOffset, toFile, zoneAt} from "./flow.js";
import {pieceFrom, isClosedShape, drawnPieceRows, readPieceField, notchPlace, drawnCutLine, fileCutLine, outlineProblem, toPieceShift, pieceFollowers,
        outlineOf} from "./piece.js";

let E = null;                                                     // draw.js's state, bound once
let pieces = new Map();                                           // pid → {n, name, qty, category, blockName, outline, grain}
let pen = {pts: [], kinds: []};                                   // the piece being drawn: its points so far (canvas = its file frame)

const copy = m => new Map([...m].map(([k, v]) => [k, {...v}]));
/* a file piece's cut lines, worked out once per layout of the piece (Arrange moves it in place, Edit bumps rev) —
   the ghost of a notch placed from a corner asks for one every time the pointer moves (M15) */
const cutMemo = new WeakMap();
function fileCut(pc, k){
  const sig = `${pc.rev || 0}:${pc.ox || 0}:${pc.oy || 0}`;
  let m = cutMemo.get(pc);
  if(!m || m.sig !== sig){ m = {sig, lines: new Map()}; cutMemo.set(pc, m); }
  if(!m.lines.has(k)){ try{ m.lines.set(k, {line: fileCutLine(pc, k)}); }catch(e){ m.lines.set(k, {err: e}); } }
  const r = m.lines.get(k);
  if(r.err) throw r.err;
  return r.line;
}
/* a drawn piece's zone: the ring of its outline (draw.md V11) — an outline is a value, so worked out once per shape */
const ringMemo = new WeakMap();
function ringOf(e){
  if(!ringMemo.has(e)){ let r = null; try{ r = outlineOf(e).pts; }catch(err){ r = null; } ringMemo.set(e, r); }
  return ringMemo.get(e);
}
const say = (ctx, text) => { E.note = text; ctx.draw(); };
const refuse = (ctx, error) => { say(ctx, error); return {ok: false, error}; };
const FIELD_NAME = {name: "Tên", qty: "SL", category: "Vải"};

export const PieceTool = {
  bind(env){ E = env; },
  reset(){ pieces = new Map(); pen = {pts: [], kinds: []}; },
  /* undo: draw.js keeps these beside its own snapshot */
  snapshot: () => copy(pieces),
  restore(s){ pieces = copy(s); },

  records: () => [...pieces],
  count: () => pieces.size,
  ofShape(id){ const m = E.meta.get(id); return m && m.piece ? pieces.get(m.piece) : null; },
  members: pid => [...E.meta].filter(([id, m]) => m.piece === pid && E.sk.get(id)).map(([id]) => id),
  isDriven: id => E.sk.constraints().some(c => c.driven && c.driven.id === id),
  /* a piece with no grainline of its own and no line drawn into it on layer 7 (M17) — said at Xuất DXF (§5.10) */
  missingGrain: () => [...pieces].filter(([pid, p]) => !p.grain && !PieceTool.members(pid).some(id => E.meta.get(id).layer === "7")).map(([, p]) => p.name),
  name: pid => (pieces.get(pid) || {}).name,
  /* the drawn pieces a new shape may join (M17): each one's zone — its outline's ring — and box, and whether one of its shapes
     is selected (V11) */
  targets(){
    const out = [];
    for(const [pid, p] of pieces){
      const e = E.sk.get(p.outline);
      if(e) out.push({pid, bbox: bbox(entityShape(e)), ring: ringOf(e), selected: E.sel.some(id => (E.meta.get(id) || {}).piece === pid)});
    }
    return out;
  },
  /* the pieces a drag has left with no inside — crossing itself, or thinner than 0.01 mm (M16): said at Xuất DXF */
  problems(){
    const out = [];
    for(const p of pieces.values()){ const why = outlineProblem(E.sk.get(p.outline)); if(why) out.push(`${p.name}: ${why}`); }
    return out;
  },

  /* ── the pen (M1–M3) ── */
  pen: () => pen,
  clearPen(){ pen = {pts: [], kinds: []}; },
  addPoint(ctx, p, asCurve){
    const last = pen.pts[pen.pts.length - 1];
    if(last && Math.hypot(p[0] - last[0], p[1] - last[1]) <= 1e-9) return say(ctx, "điểm này trùng điểm vừa đặt");
    pen = {pts: [...pen.pts, p], kinds: [...pen.kinds, asCurve ? "curve" : "turn"]};
    say(ctx, "");
  },
  pop(ctx){
    pen = {pts: pen.pts.slice(0, -1), kinds: pen.kinds.slice(0, -1)};
    say(ctx, pen.pts.length ? `bỏ điểm cuối — còn ${pen.pts.length} điểm` : "đã bỏ hết điểm");
  },
  /* the piece as it would close now — what the ghost shows when the pointer is on the first point */
  closed(){ try{ return createPath(pen.pts, pen.kinds); }catch(e){ return null; } },
  close(ctx){
    if(pen.pts.length < 3) return say(ctx, "mảnh cần ít nhất 3 điểm");
    const kept = pen;
    pen = {pts: [], kinds: []}; E.lastAt = null;                    // before the frame act() draws: the panel must not show the pen
    const r = E.act(ctx, () => PieceTool.make(ctx, createPath(kept.pts, kept.kinds)));
    if(r && r.ok === false){ pen = kept; ctx.draw(); }
  },

  /* ── a piece (M4 · M5 · M8 · M9) ──
     a closed shape becomes a piece: the cut line (layer 1), a grainline, a record — run inside act(), so it is one
     undo step with what called it. fromId: a shape already drawn (Thành mảnh), else the entity is added */
  make(ctx, entity, fromId){
    const {grain, ...rec} = pieceFrom(entity, [...pieces.values()], new Set(Object.keys((ctx.model && ctx.model.blocks) || {})));
    const pid = `P${rec.n}`, oid = fromId || E.nextId(entity.type);
    if(!fromId) E.sk.add(entity, {id: oid});
    E.meta.set(oid, {pc: null, layer: "1", piece: pid, role: "outline"});
    const gid = E.nextId("grain");
    E.sk.add(grain, {id: gid});
    E.meta.set(gid, {pc: null, layer: "7", piece: pid, role: "grain"});
    pieces.set(pid, {...rec, outline: oid, grain: gid});
    E.sel = [oid]; E.active = null; E.filled = "";
    return {ok: true, message: `đã tạo ${rec.name} — đường cắt kín, canh sợi, SL ${rec.qty}; gõ Tên · SL · Vải nếu cần, 7 = notch`};
  },
  /* Thành mảnh: the one closed shape selected becomes a piece (M5) — where it is shown (M18): a shape of a file piece
     Arrange has moved comes into the canvas frame by that move. A closed shape drawn inside a drawn piece leaves it
     for a piece of its own */
  toPiece(ctx){
    const id = E.sel.length === 1 ? E.sel[0] : null, e = id && E.sk.get(id), m = id && E.meta.get(id);
    if(!e || !isClosedShape(e)) return say(ctx, "Thành mảnh: chọn một hình kín — Rect · Circle · Polygon");
    if(m.role === "outline") return say(ctx, `${PieceTool.ofShape(id).name} đã là mảnh`);
    if(PieceTool.isDriven(id)) return say(ctx, "hình này đang bám quan hệ — gỡ (Gỡ) rồi hãy thành mảnh");
    const related = E.sk.constraints().some(c => [c.on, c.master, c.driven].some(r => r && r.id === id));
    const shift = toPieceShift(m, ctx.pieces(), related);
    if(shift.error) return say(ctx, shift.error);
    E.act(ctx, () => {
      if(shift.d[0] || shift.d[1]){ const r = E.sk.move(id, shift.d[0], shift.d[1]); if(!r.ok) return r; }
      return PieceTool.make(ctx, E.sk.get(id), id);
    });
  },
  /* Góc ⇄ Cong: the point of an outline being held turns from corner to curve point, or back (M9) */
  toggleKind(ctx){
    const a = E.active, id = a && a.id, e = id && E.sk.get(id), k = a && a.handle && a.handle[0] === "v" ? Number(a.handle.slice(1)) : NaN;
    if(!e || e.type !== "path" || !Number.isInteger(k)) return say(ctx, "Góc ⇄ Cong: nắm một điểm của đường cắt mảnh trước");
    E.act(ctx, () => { const r = E.sk.reshape(id, setPathKind(e, k, e.kinds[k] === "turn" ? "curve" : "turn"));
                       return r.ok ? {ok: true, message: `điểm ${k}: ${e.kinds[k] === "turn" ? "điểm cong" : "góc"}`} : r; });
  },
  /* Tên · SL · Vải (M8): outline is the cut line of the piece the box was showing when it was entered — not the
     selection now: a click on the canvas selects before the box loses focus. A value equal to the stored one is
     not a step. Returns {ok, value} (the value as stored) or {ok: false, error} */
  setField(ctx, key, value, outline){
    const m = outline && E.meta.get(outline), pid = m && m.role === "outline" ? m.piece : null;
    if(!pid || !pieces.get(pid)) return refuse(ctx, "chọn một mảnh vẽ trước");
    const r = readPieceField(key, value);
    if(!r.ok) return refuse(ctx, r.error);
    if(r.value !== pieces.get(pid)[key]){
      E.filled = "";                                              // the boxes are written again from the record
      E.act(ctx, () => { pieces.set(pid, {...pieces.get(pid), [key]: r.value}); return {ok: true, message: `${FIELD_NAME[key]}: ${r.value || "—"}`}; });
    }
    return r;
  },
  /* Delete: a piece's cut line takes the whole piece with it; a grainline alone leaves the piece without one (M9).
     Returned for what Delete says (flow.js deletedText): the pieces gone whole, and the shapes that hung on something
     gone and now stand where they are (V9) */
  remove(ids){
    const gone = new Set(ids), whole = [];
    for(const id of ids){ const m = E.meta.get(id); if(m && m.role === "outline"){ whole.push(pieces.get(m.piece).name); for(const x of PieceTool.members(m.piece)) gone.add(x); } }
    const freed = [...new Set(E.sk.constraints().filter(c => c.master && gone.has(c.master.id) && c.driven && !gone.has(c.driven.id)).map(c => c.driven.id))];
    const lost = [];
    for(const id of gone){
      const m = E.meta.get(id);
      if(m && m.role === "outline") pieces.delete(m.piece);
      else if(m && m.role === "grain" && pieces.get(m.piece)){ pieces.set(m.piece, {...pieces.get(m.piece), grain: null}); lost.push(pieces.get(m.piece).name); }
      E.sk.remove(id); E.meta.delete(id);
    }
    return {count: gone.size, lost, pieces: whole, freed};
  },
  /* dragging the body of a drawn piece's cut line moves the whole piece: what rides on the line follows it by its
     relation, the grainline and the free shapes in it move by the same step (M9) */
  carry(id, base){
    const m = E.meta.get(id);
    if(!m || m.role !== "outline" || !base) return {ok: true};
    const b0 = bbox(entityShape(base.sk.entities.find(([k]) => k === id)[1])), b1 = bbox(entityShape(E.sk.get(id)));
    return PieceTool.carryBy(id, [b1.x0 - b0.x0, b1.y0 - b0.y0]);
  },
  /* the cut line `id` has just moved by d: the rest of its piece goes the same way (pieceFollowers) — `moving` are the
     shapes that move by their own selection this step */
  carryBy(id, d, moving = []){
    const m = E.meta.get(id);
    if(!m || m.role !== "outline" || (!d[0] && !d[1])) return {ok: true};
    for(const x of pieceFollowers(id, PieceTool.members(m.piece), PieceTool.isDriven, moving)){
      const r = E.sk.move(x, d[0], d[1]);
      if(!r.ok) return r;
    }
    return {ok: true};
  },

  /* ── notches (M7 · M15) ── the cut lines a notch may go on, as shown: a drawn piece's outline or a piece of the
     file's layer 1 — each with how to see it whole and cornered, for a notch placed from a corner */
  notchCandidates(ctx){
    const cands = [];
    if(!E.visible(ctx, "1")) return cands;
    for(const [pid, p] of pieces){ const e = E.sk.get(p.outline); if(e) cands.push({ref: {pid, id: p.outline}, shape: entityShape(e), cut: () => drawnCutLine(e)}); }
    ctx.pieces().forEach((pc, pi) => (pc.paths || []).forEach((path, k) => {
      if(path.layer === "1") for(const s of path.shapes || []) cands.push({ref: {pi}, shape: s, cut: () => fileCut(pc, k)});
    }));
    return cands;
  },
  /* where a notch would go for a press at w — at its foot, or E.notchDist from the nearer corner (M15); the ghost
     and the press ask the same question, so the ghost stands where the notch lands */
  notchAt(ctx, w){
    /* two cut lines in one place (pieces touching): the piece whose zone holds the press takes the notch (M7, V11) */
    const z = zoneAt(ctx.pieces(), w, PieceTool.targets());
    const inZone = ref => !!z && (ref.pid ? ref.pid === z.pid : !z.pid && ref.pi === z.pi);
    return notchPlace(PieceTool.notchCandidates(ctx), w, Canvas.pickMM(), E.notchDist, inZone);
  },
  /* why a notch from a corner cannot go where it was asked, in the display unit */
  notchRefusal(ctx, hit){
    return hit.edgeLength !== undefined ? `Notch: cạnh này chỉ dài ${ctx.len(hit.edgeLength)} — ngắn hơn ${ctx.len(E.notchDist)} cách góc` : `Notch: ${hit.error}`;
  },
  /* a drawn piece's notch rides on its outline, a file piece's goes into its block */
  placeNotch(ctx, w){
    const hit = PieceTool.notchAt(ctx, w);
    if(!hit) return say(ctx, "Notch: bấm sát đường cắt hơn (trong 8 px)");
    if(hit.error) return say(ctx, PieceTool.notchRefusal(ctx, hit));
    E.act(ctx, () => {
      const id = E.nextId("point");
      if(hit.ref.pid){
        E.sk.add(createPoint(hit.point), {id});
        E.meta.set(id, {pc: null, layer: "4", piece: hit.ref.pid, role: "notch"});
        const r = E.sk.constrain("coincident", {id: hit.ref.id}, {id, handle: "p"});
        if(!r.ok) return {ok: false, reason: r.reason};
        return {ok: true, message: `notch trên ${pieces.get(hit.ref.pid).name} — đi theo đường cắt`};
      }
      const pc = ctx.pieces()[hit.ref.pi], off = pieceOffset(pc);
      E.sk.add(createPoint(toFile(hit.point, off)), {id});
      E.meta.set(id, {pc, layer: "4"});                           // the piece itself, not its place in the list (remove.md R5)
      return {ok: true, message: `notch trên ${pc.blockName || pc.name || "mảnh " + (hit.ref.pi + 1)}`};
    });
  },

  /* ── out: the pieces as out.js writes them (M10), their names on the canvas, their rows in the panel ── */
  out(){
    return [...pieces].map(([pid, p]) => {
      const ms = PieceTool.members(pid), roleOf = id => E.meta.get(id).role;
      return {...p, outline: E.sk.get(p.outline), grain: p.grain && E.sk.get(p.grain) ? E.sk.get(p.grain) : null,
              notches: ms.filter(id => roleOf(id) === "notch").map(id => E.sk.get(id)),
              shapes: ms.filter(id => !roleOf(id)).map(id => ({entity: E.sk.get(id), layer: E.meta.get(id).layer}))};
    }).filter(p => p.outline);
  },
  labels(ctx){
    const out = [];
    if(!E.visible(ctx, "1")) return out;
    for(const p of pieces.values()){
      const e = E.sk.get(p.outline);
      if(!e) continue;
      const b = bbox(entityShape(e));
      out.push({at: [(b.x0 + b.x1)/2, (b.y0 + b.y1)/2 + 0.08*(b.y1 - b.y0)], text: p.name});
    }
    return out;
  },
  rows(id, L){
    const m = E.meta.get(id), p = PieceTool.ofShape(id);
    const notches = PieceTool.members(m.piece).filter(x => E.meta.get(x).role === "notch").length;
    return drawnPieceRows(p, E.sk.get(p.outline), notches, L);
  }
};
