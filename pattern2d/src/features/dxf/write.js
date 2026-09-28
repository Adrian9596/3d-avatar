/* Writing a pattern out as a NEW DXF — AAMA, METRIC (spec: edit/edit.md §6).

   The layout is the one BLOCK_36C.dxf and the factory 3380 file use, the one factory CAD
   imports: an empty HEADER, one BLOCK per piece, and in ENTITIES the AAMA header lines plus one
   INSERT per block. Every block is written in world millimetres and inserted at 0,0, so the
   coordinates a reader rebuilds are the ones the model holds — no base point, scale or turn to
   get wrong on the way back (X6).

   What AAMA has no word for is said with what it has: an ARC, a CIRCLE, a SPLINE or a bulged
   polyline becomes a POLYLINE sampled to within 0.01 mm, and `stats.sampled` counts them —
   converted in the open, never in silence (X5). A file that declared no unit is not written at
   all: calling its numbers millimetres would be a guess (X8). An Arrange layout is a way of
   looking, not the pattern, so pieces go out where the file had them (X9); an Edit goes out. */
import {sample} from "../geometry/model.js";

export const EXPORT_TOL = 0.01;       // mm — how far a sampled curve may stray from the exact one

/* <name>_edit.dxf — never the name it came from (X1) */
export function exportName(fileName){
  const s = String(fileName || "").trim();
  const base = s.toLowerCase().endsWith(".dxf") ? s.slice(0, -4) : s;
  return `${base || "untitled"}_edit.dxf`;
}

/* six decimals at most (0.000001 mm), no exponent, no "-0" */
function num(v){
  if(!Number.isFinite(v)) throw new Error(`toạ độ không hợp lệ: ${v}`);
  let s = v.toFixed(6);
  if(s.includes(".")){ while(s.endsWith("0")) s = s.slice(0, -1); if(s.endsWith(".")) s = s.slice(0, -1); }
  return s === "-0" ? "0" : s;
}
const two = n => String(n).padStart(2, "0");
const stamp = d => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
const keyOf = t => t.includes(":") ? t.slice(0, t.indexOf(":")).trim().toLowerCase() : "";

export function writeDXF(model, {source = "", date = new Date(), tol = EXPORT_TOL} = {}){
  if(!model) throw new Error("chưa có bản vẽ nào để xuất");
  if(!model.units || model.units.unit === null)
    throw new Error("file chưa khai đơn vị — chọn đơn vị của file (ô File:) rồi xuất lại; ghi METRIC lúc này là đoán");
  const out = [];
  const g = (code, value) => { out.push(String(code), String(value)); };
  const stats = {pieces: 0, polylines: 0, lines: 0, points: 0, texts: 0, sampled: 0, renamed: [],
                 dropped: (model.warnings || []).length};

  /* a path on one spot (a SPLINE of length 0, a drill mark drawn as a one-vertex ring) goes out as two
     vertices on that spot: a POLYLINE of one vertex is not read back by anyone, ours included (X10) */
  const polyline = (pts, closed, layer, dx, dy) => {
    g(0, "POLYLINE"); g(8, layer); g(66, 1); g(70, closed ? 1 : 0); g(10, 0); g(20, 0); g(30, 0);
    for(const [x, y] of pts.length === 1 ? [pts[0], pts[0]] : pts){ g(0, "VERTEX"); g(8, layer); g(10, num(x + dx)); g(20, num(y + dy)); g(30, 0); }
    g(0, "SEQEND"); g(8, layer);
    stats.polylines++;
  };
  const path = (p, dx, dy) => {
    const sh = p.shapes || [], layer = p.layer || "0";
    if(sh.length === 1 && sh[0].kind === "line"){
      const {a, b} = sh[0];
      g(0, "LINE"); g(8, layer); g(10, num(a.x + dx)); g(20, num(a.y + dy)); g(30, 0);
      g(11, num(b.x + dx)); g(21, num(b.y + dy)); g(31, 0);
      stats.lines++; return;
    }
    if(!sh.length || (sh.length === 1 && sh[0].kind === "curve")){ polyline(p.pts, p.closed, layer, dx, dy); return; }
    /* an arc's sampling bound is exact (the sagitta); a spline's is a midpoint test, so it
       is sampled twice as fine to stay inside the tolerance */
    const pts = [];
    for(const s of sh) for(const q of sample(s, s.kind === "spline" ? tol/2 : tol)){
      const last = pts[pts.length - 1];
      if(!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-9) pts.push([q[0], q[1]]);
    }
    if(p.closed && pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-9) pts.pop();
    polyline(pts, p.closed, layer, dx, dy);
    stats.sampled++;
  };
  const pointE = (q, dx, dy) => { g(0, "POINT"); g(8, q.layer || "0"); g(10, num(q.x + dx)); g(20, num(q.y + dy)); g(30, 0); stats.points++; };
  const textE = (t, dx, dy, text = t.text) => {
    g(0, "TEXT"); g(8, t.layer || "0"); g(10, num(t.x + dx)); g(20, num(t.y + dy)); g(30, 0); g(40, num(t.h)); g(1, text);
    stats.texts++;
  };
  const content = (p, dx, dy, texts = true) => {
    for(const q of p.paths || []) path(q, dx, dy);
    for(const q of p.points || []) pointE(q, dx, dy);
    if(texts) for(const t of p.texts || []) textE(t, dx, dy);
  };

  g(0, "SECTION"); g(2, "HEADER"); g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "BLOCKS");
  const used = new Set(), names = [];
  for(const p of model.pieces.filter(q => q.blockName)){
    let name = p.blockName, k = 2;
    while(used.has(name)) name = `${p.blockName}_${k++}`;
    if(name !== p.blockName) stats.renamed.push([p.blockName, name]);
    used.add(name); names.push(name);
    g(0, "BLOCK"); g(8, "0"); g(2, name); g(70, 0); g(10, 0); g(20, 0); g(30, 0); g(3, name); g(1, "");
    content(p, -(p.ox || 0), -(p.oy || 0));
    g(0, "ENDBLK"); g(8, "0");
    stats.pieces++;
  }
  g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "ENTITIES");
  const loose = model.loose || {paths: [], points: [], texts: []};
  const whole = model.pieces.find(q => !q.blockName);          // a drawing without blocks IS modelspace
  const dx = whole ? -(whole.ox || 0) : 0, dy = whole ? -(whole.oy || 0) : 0;
  let low = null, hadUnits = false;
  for(const t of loose.texts || []){
    const isUnits = keyOf(t.text) === "units";
    hadUnits = hadUnits || isUnits;
    textE(t, dx, dy, isUnits ? "Units: METRIC" : t.text);
    if(t.text.includes(":") && (!low || t.y < low.y)) low = t;
  }
  /* new header lines go under the lowest one, in its column and size */
  const h = low ? low.h : 6;
  let x = low ? low.x + dx : 0, y = low ? low.y + dy : -20;
  const line = text => { y -= h*1.4; textE({layer: low ? low.layer : "0", x, y, h}, 0, 0, text); };
  if(!hadUnits) line("Units: METRIC");
  line(`EDITED: ${stamp(date)} · from ${source || "?"}`);
  /* a drawing without blocks goes out as its one piece is NOW: an edit undone puts copies in the piece, and the loose arrays it
     was read into still hold the edit (seen 2026-09-24) */
  content(whole ? {paths: whole.paths, points: whole.points} : {paths: loose.paths, points: loose.points}, dx, dy, false);
  if(whole) stats.pieces++;
  for(const name of names){ g(0, "INSERT"); g(8, "0"); g(2, name); g(10, 0); g(20, 0); g(30, 0); }
  g(0, "ENDSEC");
  g(0, "EOF");
  return {text: out.join("\n") + "\n", stats};
}
