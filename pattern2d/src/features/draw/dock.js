/* The Vẽ dock — the controls under the canvas (spec: draw/draw.md V1 · V6 · V7 · V10, draw/piece.md M1–M12).

   Only markup and wiring: every button and box hands what TD did to the tool (draw.js) through
   `on`, and `sync` / `fill` write back what the tool says is true. Nothing here keeps a shape, a
   selection or a rule — so the dock can be rebuilt or restyled without touching what Vẽ does. */
import {$, node, esc, bindLength, onEnter, inputError} from "../../shared/dom.js";
import {lengthField, parseAngle, formatLength, UNIT_LABEL} from "../../shared/units.js";
import {layerMeta} from "../dxf/aama.js";
import {DRAW_MODES, PIECE_MODES, PEN_MODES, DRAW_LAYERS, readSides} from "./flow.js";
import {readNotchDistance} from "./piece.js";
import {readOptLength} from "./smart.js";

export const MODE_NAME = {select: "Chọn", line: "Line", curve: "Curve", rect: "Rect", circle: "Circle", polygon: "Polygon",
                          piece: "Mảnh", notch: "Notch", pen: "Bút"};
export const RELS = {horizontal: "Ngang", vertical: "Dọc", coincident: "Trùng", tangent: "Tiếp tuyến", equal: "Bằng"};
const TIPS = {
  select: "Chọn: bấm hình để chọn · kéo đầu mút / control point để sửa dáng · kéo thân để dời · ⇧ thêm · Delete xoá · 1–7 vẽ · ⌘Z",
  line: "Line: bấm Start → bấm End (snap) — hoặc bấm Start rồi gõ Length + Angle, Enter · Esc thôi",
  curve: "Curve: bấm Start → bấm End → kéo control point của curve vừa vẽ · Esc thôi",
  rect: "Rect: gõ W × H rồi bấm — góc dưới-trái tại chỗ bấm · layer 1 = mảnh mới · Esc thôi",
  circle: "Circle: gõ D rồi bấm — tâm tại chỗ bấm · layer 1 = mảnh mới · Esc thôi",
  polygon: "Polygon: gõ Size + số cạnh (+ Angle) rồi bấm — tâm tại chỗ bấm · layer 1 = mảnh mới · Esc thôi",
  piece: "Mảnh: bấm từng góc · ⇧ bấm điểm trên đường cong · bấm lại điểm đầu, double-click hay Enter là xong mảnh · gõ Length + Angle, Enter = cạnh đúng số · Backspace bỏ điểm cuối · Esc thôi",
  notch: "Notch: bấm lên đường cắt — của mảnh vẽ hay mảnh DXF — notch nằm đúng trên đường; gõ Cách góc thì notch cách góc gần chỗ bấm đúng khoảng đó, đo dọc đường · Esc thôi",
  pen: "Bút: bấm = điểm · ⇧ bấm = điểm cong · Enter / double-click = xong · bấm điểm đầu = khép · kéo trên đường = song song · kéo từ điểm = compa · ⇧ kéo A→B = thước tam giác · H = thước ngang · Esc thôi"
};
/* the Bút's boxes (smartpen.md B6 · B8 · B11): [id, key, label, title, signed] — empty means "from the pointer" / no offset */
const PEN_BOXES = [["pdist", "dist", "Cách", "Đường song song cách đúng khoảng này — trống: cách đúng chỗ thả chuột", false],
                   ["prad", "radius", "Compa", "Bán kính compa / chiều dài đoạn kéo từ một điểm — trống: theo chỗ thả chuột", false],
                   ["pdx", "dx", "dx", "Điểm đầu của đường lệch từ chỗ bấm theo x (số âm: sang trái) — trống: không lệch", true],
                   ["pdy", "dy", "dy", "Điểm đầu của đường lệch từ chỗ bấm theo y (số âm: xuống) — trống: không lệch", true]];
/* the length boxes: [id, key of the next shape's number] — "ddist" is the Dời distance, no shape's */
const LENGTH_BOXES = [["dlen", "len"], ["dw", "w"], ["dh", "h"], ["dd", "d"], ["dsize", "size"], ["ddist", null]];
const PIECE_FIELDS = [["pname", "name", "Tên", "Tên mảnh — ghi vào Piece Name khi xuất"],
                      ["pqty", "qty", "SL", "Số lượng cắt: 2, hoặc R,L = số mảnh phải, trái — 1,0 · 1,1 (như thư viện, ASTM)"],
                      ["pcat", "category", "Vải", "Vải / chất liệu — ghi vào CATEGORY"]];

/* on: {mode(m), rel(kind), act(name), layer(value), typedLine(input, ev), typedDim(input, dim), moveBy(input),
        typed(key, value), pieceField(key, value, outline) → {ok, value} | {ok: false, error}, notchDist(mm | null)}
        — typed() is a number for the next shape, as it is typed; notchDist() the Cách góc of the notches to come */
export function buildDock(ctx, ui, nums, on){
  const dock = node("div", {className: "dock drawdock", id: "drawdock", hidden: true});
  const box = (id, label, title, unit = true) =>
    `<span class="gapf"><label for="${id}">${label}</label><input id="${id}" type="text" inputmode="decimal" autocomplete="off" title="${title}">` +
    `<span class="utag"${unit ? ` id="${id}u"` : ""}>${unit ? "" : "°"}</span></span>`;
  const modeButtons = ms => ms.map(m => { const k = m === "select" ? "Esc" : [...DRAW_MODES, ...PIECE_MODES, ...PEN_MODES].indexOf(m);
    return `<button class="btn" data-mode="${m}" title="${MODE_NAME[m]} (${k})">${MODE_NAME[m]}</button>`; }).join("");
  dock.innerHTML =
    `<div class="tip" id="drawtip"></div>` +
    `<div class="arrangebar">` +
      `<span class="grp">` + modeButtons(DRAW_MODES) + `</span>` +
      `<span class="grp">` + modeButtons(PIECE_MODES) + `</span>` +
      `<span class="grp">` + modeButtons(PEN_MODES) + `</span>` +
      `<span class="grp" data-g="line">` + box("dlen", "Length", "Chiều dài — Enter: vẽ từ Start đã bấm (Mảnh: cạnh kế tiếp), hoặc đặt cho line đang chọn") +
        box("dang", "Angle", "Hướng, độ ngược chiều kim đồng hồ từ +X — Enter (Mảnh: ⇧ Enter = curve point)", false) + `</span>` +
      `<span class="grp" data-g="rect">` + box("dw", "W", "Rộng — Enter đặt cho rect đang chọn") + box("dh", "H", "Cao — Enter đặt cho rect đang chọn") + `</span>` +
      `<span class="grp" data-g="circle">` + box("dd", "D", "Đường kính — Enter đặt cho circle đang chọn") + `</span>` +
      `<span class="grp" data-g="polygon">` + box("dsize", "Size", "Đường kính vòng qua các đỉnh (G4) — Enter đặt cho polygon đang chọn") +
        `<span class="gapf"><label for="dsides">Cạnh</label><input id="dsides" type="text" inputmode="numeric" autocomplete="off" title="Số cạnh 3–1000 — chỉ cho hình mới (G4)"></span>` +
        box("dpang", "Angle", "Xoay quanh tâm, độ — 0 = đáy nằm ngang", false) + `</span>` +
      `<span class="grp" data-g="piece">` + PIECE_FIELDS.map(([id, , label, title]) =>
        `<span class="gapf"><label for="${id}">${label}</label><input id="${id}" class="ptext" type="text" autocomplete="off" title="${esc(title)} — Enter hoặc rời ô"></span>`).join("") +
        `<button class="btn" data-act="kind" title="Đổi điểm đang nắm: góc ⇄ điểm trên đường cong">Góc ⇄ Cong</button></span>` +
      `<span class="grp" data-g="notch"><span class="gapf"><label for="dcorner">Cách góc</label><input id="dcorner" type="text" inputmode="decimal" autocomplete="off" placeholder="—" title="Notch cách góc gần chỗ bấm đúng khoảng này, đo dọc đường cắt — để trống: notch rơi đúng chỗ bấm"><span class="utag" id="dcorneru"></span></span></span>` +
      `<span class="grp" data-g="pen">` + PEN_BOXES.map(([id, , label, title]) =>
        `<span class="gapf"><label for="${id}">${label}</label><input id="${id}" type="text" inputmode="decimal" autocomplete="off" placeholder="—" title="${esc(title)}"><span class="utag" id="${id}u"></span></span>`).join("") + `</span>` +
      `<span class="grp" data-g="topiece"><button class="btn" data-act="piece" title="Hình kín đang chọn thành một mảnh: đường cắt, canh sợi, tên, SL">Thành mảnh</button></span>` +
      `<span class="grp" data-g="layer"><span class="gapf"><label for="dlayer">Layer</label><select id="dlayer" title="Layer — đang vẽ: của hình sau · đang Chọn: đổi layer hình đang chọn">` +
        DRAW_LAYERS.map(l => `<option value="${l}">${l} · ${layerMeta(l).short}</option>`).join("") + `</select></span></span>` +
      `<span class="grp" data-g="rel">` + Object.entries(RELS).map(([k, v]) => `<button class="btn" data-rel="${k}">${v}</button>`).join("") +
        `<button class="btn" data-act="free" title="Gỡ mọi quan hệ mà hình đang chọn bám theo">Gỡ</button></span>` +
      `<span class="grp" data-g="move">` + box("ddist", "Dời", "Dời hình đang chọn một đoạn — Enter") + box("ddir", "Hướng", "Hướng dời, độ ngược chiều kim đồng hồ từ +X", false) +
        `<button class="btn" data-act="move">Dời</button></span>` +
      `<span class="grp"><button class="btn" data-act="undo" title="Hoàn tác (⌘Z)">↶</button>` +
        `<button class="btn" data-act="delete" title="Xoá hình đang chọn — đường cắt của mảnh: xoá cả mảnh (Delete)">Xoá</button>` +
        `<button class="btn" data-act="export" title="Tải về một file DXF MỚI có cả hình vẽ và mảnh vẽ (AAMA, METRIC) — file gốc không bị đụng tới">Xuất DXF</button></span>` +
    `</div>`;
  ui.stage.appendChild(dock);
  const tip = dock.querySelector("#drawtip");
  $("ddir").value = "0";

  const F = {};                                                    // the length boxes: lengthFields + their `show`
  const unit = () => ctx.shownUnit();
  for(const [id, key] of LENGTH_BOXES){
    const field = lengthField({mm: key ? nums[key] : 0, min: key ? 0.001 : 0, max: 100000, d: 2});
    const show = bindLength($(id), field, {unit, tag: $(id + "u"), onValue: v => { if(key) on.typed(key, v); }});
    F[id] = {field, show, key};
  }
  /* Cách góc (piece.md M15): a length that may be left empty — empty is "at the click". Kept in mm, written in the
     display unit, read as every length box reads one */
  let cornerMM = null;
  const cbox = $("dcorner"), cbase = cbox.title;
  const showCorner = () => {
    const u = unit();
    cbox.value = cornerMM === null ? "" : formatLength(cornerMM, u, {d: 2, label: false, plain: true});
    cbox.removeAttribute("aria-invalid"); cbox.title = cbase;
    $("dcorneru").textContent = u === null ? "đv?" : UNIT_LABEL[u];
  };
  cbox.addEventListener("input", () => {
    const r = readNotchDistance(cbox.value, unit());
    if(!r.ok){ cbox.setAttribute("aria-invalid", "true"); cbox.title = r.error; ctx.draw(); return; }
    cornerMM = r.mm; cbox.removeAttribute("aria-invalid"); cbox.title = cbase; on.notchDist(r.mm);
  });
  cbox.addEventListener("change", () => { if(!cbox.hasAttribute("aria-invalid")) showCorner(); });
  onEnter(cbox, () => { if(!cbox.hasAttribute("aria-invalid")){ showCorner(); cbox.blur(); } });   // done: 0–7 are shortcuts again (M11)
  showCorner();
  /* the Bút's boxes: kept in mm, written in the display unit, read as every length box reads one — a bad one turns red and the
     pen does nothing with it (smartpen.md B11) */
  const penMM = {};
  const showPen = (id, key) => {
    const b = $(id), u = unit();
    b.value = penMM[key] === undefined || penMM[key] === null ? "" : formatLength(penMM[key], u, {d: 2, label: false, plain: true});
    b.removeAttribute("aria-invalid"); b.title = b.dataset.title;
    $(id + "u").textContent = u === null ? "đv?" : UNIT_LABEL[u];
  };
  for(const [id, key, , , signed] of PEN_BOXES){
    const b = $(id);
    b.dataset.title = b.title;
    b.addEventListener("input", () => {
      const r = readOptLength(b.value, unit(), {signed});
      if(!r.ok){ b.setAttribute("aria-invalid", "true"); b.title = r.error; ctx.draw(); return; }
      penMM[key] = r.mm; b.removeAttribute("aria-invalid"); b.title = b.dataset.title; on.penBox(key, r.mm);
    });
    b.addEventListener("change", () => { if(!b.hasAttribute("aria-invalid")) showPen(id, key); });
    onEnter(b, () => { if(!b.hasAttribute("aria-invalid")){ showPen(id, key); b.blur(); } });
    showPen(id, key);
    on.penBox(key, null);                                          // the boxes are what the pen uses: empty at the start
  }
  ctx.onUnit(() => { for(const f of Object.values(F)) f.show(); showCorner(); for(const [id, key] of PEN_BOXES) showPen(id, key); });
  /* the angle and side boxes: typed numbers for the next shape, checked as they are typed */
  const typedBox = (id, key, read) => $(id).addEventListener("input", ev => {
    try{ const v = read(ev.target.value); ev.target.removeAttribute("aria-invalid"); on.typed(key, v); }
    catch(e){ ev.target.setAttribute("aria-invalid", "true"); ev.target.title = e.message; }
  });
  typedBox("dang", "lineAngle", parseAngle); typedBox("dpang", "angle", parseAngle); typedBox("dsides", "sides", readSides);

  dock.addEventListener("click", ev => {
    const t = ev.target.closest("[data-mode],[data-act],[data-rel]");
    if(!t || t.disabled) return;
    if(t.dataset.mode) return on.mode(t.dataset.mode);
    if(t.dataset.rel) return on.rel(t.dataset.rel);
    on.act(t.dataset.act);
  });
  /* a list chosen from gives the keys back at once: 0–7 are Vẽ's again, not the list's (piece.md M11, F7) */
  $("dlayer").addEventListener("change", ev => { on.layer(ev.target.value); ev.target.blur(); });
  onEnter($("dlen"), on.typedLine); onEnter($("dang"), on.typedLine);
  for(const [id, dim] of [["dw", "w"], ["dh", "h"], ["dd", "d"], ["dsize", "size"], ["dpang", "angle"]]) onEnter($(id), input => on.typedDim(input, dim));
  onEnter($("ddist"), on.moveBy); onEnter($("ddir"), on.moveBy);
  /* Tên · SL · Vải: Enter or leaving the box (Tab to the next one, a click elsewhere) stores it (M8). What is typed
     belongs to the piece the box showed at the first keystroke — a click on the canvas selects BEFORE the box loses
     focus, so the selection when it is stored may be another piece. (Not taken at focus: a focus given while the
     window is not focused fires no focus event.) */
  let shownPiece = null, shownRecord = null;
  const plain = input => { input.removeAttribute("aria-invalid"); input.title = input.dataset.title; };
  const commitField = (input, key, enter) => {
    const piece = input.dataset.piece || shownPiece || "";
    delete input.dataset.piece;
    const r = on.pieceField(key, input.value, piece);
    /* left by selecting another piece: what was typed went to its own piece; the box now shows the new one */
    if(piece !== (shownPiece || "")){ input.value = shownRecord ? shownRecord[key] || "" : ""; plain(input); return; }
    if(!r.ok){ input.setAttribute("aria-invalid", "true"); input.title = r.error; return; }
    input.value = r.value; plain(input);                          // as stored: " 1 , 1 " is 1,1
    if(enter) input.blur();                                       // Enter did its one thing: 0–7 are shortcuts again (M11)
  };
  for(const [id, key] of PIECE_FIELDS){
    const input = $(id);
    input.dataset.title = input.title;
    input.addEventListener("input", () => { if(!input.dataset.piece) input.dataset.piece = shownPiece || ""; });
    onEnter(input, () => commitField(input, key, true));
    input.addEventListener("change", () => commitField(input, key, false));
  }

  /* what the boxes show: the next shape's numbers, or the one shape selected. c = {kind: "create" |
     "edit" | "none", type, dims} — dims are the selected shape's (entityDims); piece: its record or null */
  const fill = (c, nums, piece) => {
    const put = (id, mm) => { F[id].field.set(mm); F[id].show(); };
    const deg = (id, v) => { $(id).value = String(+v.toFixed(4)); $(id).removeAttribute("aria-invalid"); };
    if(c.kind === "create"){
      put("dlen", nums.len); put("dw", nums.w); put("dh", nums.h); put("dd", nums.d); put("dsize", nums.size);
      deg("dang", nums.lineAngle); deg("dpang", nums.angle); $("dsides").value = String(nums.sides); $("dsides").disabled = false;
    } else if(c.kind === "edit"){
      const d = c.dims;
      if(c.type === "line"){ put("dlen", d.length); deg("dang", d.angle); }
      if(c.type === "rect"){ put("dw", d.w); put("dh", d.h); }
      if(c.type === "circle") put("dd", d.d);
      if(c.type === "polygon"){ put("dsize", d.size); deg("dpang", d.angle); $("dsides").value = String(d.sides); $("dsides").disabled = true; }
    }
    shownPiece = piece ? piece.outline : null; shownRecord = piece;
    /* the box being typed in is not written over — what is typed there goes to its own piece when it is left */
    if(piece) for(const [id, key] of PIECE_FIELDS) if(document.activeElement !== $(id)){ $(id).value = piece[key] || ""; plain($(id)); }
  };
  /* v = {on, mode, pending, groups (the groups of boxes shown), one, selCount, undoCount, layer, canKind} */
  const sync = v => {
    dock.hidden = !v.on;
    if(!v.on) return;
    tip.textContent = v.pending ? `${RELS[v.pending.kind]}: bấm ${v.pending.kind === "coincident" ? "điểm hay đường" : "hình"} làm chủ · Esc thôi` : TIPS[v.mode];
    dock.querySelectorAll("[data-mode]").forEach(b => { const a = b.dataset.mode === v.mode; b.classList.toggle("on", a); b.setAttribute("aria-pressed", a); });
    dock.querySelectorAll("[data-g]").forEach(gp => { gp.hidden = !v.groups.has(gp.dataset.g); });
    dock.querySelectorAll("[data-rel]").forEach(b => { b.disabled = !v.one; b.classList.toggle("on", !!v.pending && v.pending.kind === b.dataset.rel); });
    dock.querySelector("[data-act=free]").disabled = !v.one;
    dock.querySelector("[data-act=move]").disabled = !v.selCount;
    dock.querySelector("[data-act=delete]").disabled = !v.selCount;
    dock.querySelector("[data-act=undo]").disabled = !v.undoCount;
    dock.querySelector("[data-act=kind]").disabled = !v.canKind;
    $("dlayer").value = v.layer;
  };
  return {F, fill, sync, error: (...ids) => inputError(...ids.map(id => $(id)))};
}
