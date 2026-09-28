/* DXF group-code reader: pairs of (code, value) lines, sectioned into HEADER, BLOCKS and
   ENTITIES. Only what a pattern uses is kept — and what it uses is now everything a
   pattern CAD writes: LINE · LWPOLYLINE / POLYLINE with bulges · ARC · CIRCLE · SPLINE ·
   POINT · TEXT · INSERT (scale, rotation, block base point) — see measure_engine.md §5 DXF.

   The reader never repairs a number. A value that should be a number and is not makes the
   whole entity go, with its line number in `warnings`: a polyline with one vertex quietly
   dropped (or set to 0) measures as a different piece, and nobody would know (spec A8).
   Coordinates stay exactly as written — OCS, units, INSERT placement are model.js's job. */

/* a whole value that is a number, and nothing else ("12abc" is not 12) */
const NUM_HEAD = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*/;
const isNum = v => { const m = NUM_HEAD.exec(v); return !!m && m[0].length === v.length; };
/* the numeric group codes this reader actually uses — the others may hold anything */
const USED = new Set(["10", "20", "11", "21", "40", "41", "42", "50", "51", "70", "71", "72", "73", "74", "210", "220", "230"]);
const KEEP = new Set(["LINE", "POINT", "TEXT", "INSERT", "POLYLINE", "ARC", "CIRCLE", "SPLINE"]);

export function parseDXF(text){
  const raw = text.split(/\r\n|\r|\n/);
  const blocks = {}, entities = [], header = {}, vars = {}, warnings = [];
  let section = null, target = null, varName = null;
  let cur = null, poly = null;

  const on = e => e.layer ? " (layer " + e.layer + ")" : "";
  const reject = (e, why) => warnings.push(`${e.type}${on(e)} bị bỏ — ${why}`);
  const flush = () => {
    if(!cur) return;
    const e = cur;
    cur = null;
    if(e.type === "BLOCK"){
      const name = e.name ?? "";
      blocks[name] = {name, ents: [], texts: [], base: [e.x || 0, e.y || 0]};
      target = blocks[name].ents;
      return;
    }
    if(e.type === "VERTEX"){
      if(!poly) return;
      if(e.bad) poly.bad = poly.bad || e.bad;
      else if(!Number.isFinite(e.x) || !Number.isFinite(e.y)) poly.bad = poly.bad || `dòng ${e.line}: VERTEX thiếu toạ độ`;
      else if(!(e.flags & (16 | 128))){ poly.pts.push([e.x, e.y]); poly.bulges.push(e.bulge || 0); }  // 16 spline frame · 128 mesh face: not on the curve
      return;
    }
    if(e.type === "SEQEND" || !KEEP.has(e.type) || !target) return;
    if(e.type === "POLYLINE" && !e.lw){ poly = e; target.push(e); return; }  // vertices still to come; checked at SEQEND
    if(e.bad){ reject(e, e.bad); return; }
    if(e.lw && e.px !== undefined){ reject(e, `dòng ${e.line}: đỉnh có x mà thiếu y`); return; }
    target.push(e);
  };

  for(let i = 0; i + 1 < raw.length; i += 2){
    const code = raw[i].trim(), val = raw[i + 1];
    const at = i + 2;                                  // 1-based line of the value, for warnings
    if(code === "0"){
      flush();
      const t = val.trim();
      if(t === "SECTION"){ section = "?"; continue; }
      if(t === "ENDSEC"){ section = null; target = null; continue; }
      if(t === "EOF") break;
      if(t === "ENDBLK"){ target = section === "BLOCKS" ? null : target; continue; }
      if(t === "SEQEND" && poly){
        if(poly.bad){ reject(poly, poly.bad); if(target) target.splice(target.indexOf(poly), 1); }
        poly = null;
      }
      cur = {type: t, line: at};
      if(t === "POLYLINE") Object.assign(cur, {pts: [], bulges: [], closed: false, lw: false});
      if(t === "LWPOLYLINE") Object.assign(cur, {type: "POLYLINE", pts: [], bulges: [], closed: false, lw: true});
      if(t === "SPLINE") Object.assign(cur, {knots: [], weights: [], ctrl: [], fit: []});
      continue;
    }
    if(!cur){
      if(code === "2" && section === "?"){ section = val.trim(); if(section === "ENTITIES") target = entities; continue; }
      if(section === "HEADER"){
        if(code === "9") varName = val.trim();
        else if(varName){ vars[varName] = isNum(val) ? parseFloat(val) : val.trim(); varName = null; }
      }
      continue;
    }
    if(USED.has(code) && !isNum(val)){
      const why = `dòng ${at}: "${val.trim()}" không phải số (mã ${code})`;
      cur.bad = cur.bad || why;
      if(cur.type === "VERTEX" && poly) poly.bad = poly.bad || why;
      continue;
    }
    const n = parseFloat(val);
    const t = cur.type;
    switch(code){
      case "8": cur.layer = val.trim(); break;
      case "2":
        if(t === "BLOCK") cur.name = val.trim();
        else if(t === "INSERT") cur.block = val.trim();
        break;
      case "1": cur.text = val; break;
      case "10":
        if(t === "SPLINE") cur.ctrl.push([n, NaN]);
        else if(cur.lw){ if(cur.px !== undefined) cur.bad = cur.bad || `dòng ${at}: đỉnh có x mà thiếu y`; cur.px = n; }
        else cur.x = n;
        break;
      case "20":
        if(t === "SPLINE"){ if(cur.ctrl.length) cur.ctrl[cur.ctrl.length - 1][1] = n; }
        else if(cur.lw){
          if(cur.px === undefined){ cur.bad = cur.bad || `dòng ${at}: đỉnh có y mà thiếu x`; break; }
          cur.pts.push([cur.px, n]); cur.bulges.push(0); cur.px = undefined;
        }
        else cur.y = n;
        break;
      case "11": if(t === "SPLINE") cur.fit.push([n, NaN]); else cur.x2 = n; break;
      case "21": if(t === "SPLINE"){ if(cur.fit.length) cur.fit[cur.fit.length - 1][1] = n; } else cur.y2 = n; break;
      case "40":
        if(t === "SPLINE") cur.knots.push(n);
        else if(t === "ARC" || t === "CIRCLE") cur.r = n;
        else cur.h = n;
        break;
      case "41": if(t === "SPLINE") cur.weights.push(n); else cur.sx = n; break;
      case "42":
        if(cur.lw){ if(cur.bulges.length) cur.bulges[cur.bulges.length - 1] = n; }
        else if(t === "VERTEX") cur.bulge = n;
        else if(t === "INSERT") cur.sy = n;
        break;
      case "50": if(t === "ARC") cur.a0 = n; else cur.rot = n; break;
      case "51": if(t === "ARC") cur.a1 = n; break;
      case "70":
        if(t === "POLYLINE") cur.closed = (n & 1) === 1;
        else if(t === "VERTEX" || t === "SPLINE") cur.flags = n;
        break;
      case "71": if(t === "SPLINE") cur.degree = n; break;
      case "210": (cur.ext = cur.ext || [0, 0, 1])[0] = n; break;
      case "220": (cur.ext = cur.ext || [0, 0, 1])[1] = n; break;
      case "230": (cur.ext = cur.ext || [0, 0, 1])[2] = n; break;
    }
  }
  flush();

  // block text fields: Piece Name / QUANTITY / CATEGORY / SAMPLE SIZE
  for(const b of Object.values(blocks)){
    b.texts = b.ents.filter(e => e.type === "TEXT" && e.text);
    const grab = k => {
      const t = b.texts.find(e => e.text.toUpperCase().startsWith(k));
      return t ? t.text.slice(t.text.indexOf(":") + 1).trim() : "";
    };
    b.pieceName = grab("PIECE NAME") || b.name;
    b.vn        = grab("VN");
    b.qty       = grab("QUANTITY");
    b.category  = grab("CATEGORY");
    b.sample    = grab("SAMPLE SIZE");
  }
  for(const e of entities){
    if(e.type === "TEXT" && e.text && e.text.includes(":")){
      const k = e.text.slice(0, e.text.indexOf(":")).trim();
      header[k] = e.text.slice(e.text.indexOf(":") + 1).trim();
    }
  }
  return {blocks, entities, header, vars, warnings};
}
