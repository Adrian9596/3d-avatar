/* Getting a file in: the picker, the drop target, the encoding override, the FILE-unit
   override and the name in the title bar. The bytes are kept so switching encoding or file
   unit re-reads the same file instead of asking for it again.

   Two different units, never to be confused (shared/units.md §1): this file owns the unit
   the FILE's numbers are in — read from its AAMA line, or chosen by TD when it declares
   none, and choosing it re-reads the geometry on purpose. How numbers are SHOWN is the
   in · cm · mm switch of the toolbar, which changes no geometry at all. The badge beside the
   name says what the file declared and why (measure_engine.md A5).

   The workspace starts with nothing open, and a file may also come from the HOST page — the 3D
   tab this one is framed in — as a message; it opens the same way a dropped file does (open.md). */
import {node} from "../../shared/dom.js";
import {decode} from "./decode.js";

let buf = null, name = null, empty = null, enc = null, fileUnit = null, badge = null, text = null;

const reload = ctx => { if(text !== null) ctx.load(text, name.textContent, {unit: fileUnit.value}); };

/* The three messages between the workspace and its host page (open.md O3–O5). Nothing else is
   shared: the host never imports this code, nor this code the host's. */
export const OPEN_DXF = "pattern2d:open-dxf";
export const READY = "pattern2d:ready";
export const OPENED = "pattern2d:opened";

/* the File in a message, when the message is the host's asking to open one — else null (O4) */
export function openedFile(ev, win){
  if(!ev || !win || win.parent === win) return null;
  if(ev.source !== win.parent || ev.origin !== win.location.origin) return null;
  const d = ev.data;
  if(!d || d.type !== OPEN_DXF || typeof Blob === "undefined" || !(d.file instanceof Blob)) return null;
  return typeof d.file.name === "string" ? d.file : null;
}

/* tell the host, when there is one; "/" = this page's own origin only (O5) */
const toHost = data => { if(window.parent !== window) window.parent.postMessage(data, "/"); };

/* the bytes of a file, opened: kept, so Encoding and File unit re-read THIS file. A new file
   starts from what IT declares: a unit chosen by hand for the last file would be a guess about
   this one (measure_engine.md A5) */
export function openBytes(ctx, bytes, fileName){
  buf = bytes; text = decode(new Uint8Array(buf), enc.value);
  name.textContent = fileName; fileUnit.value = "auto"; reload(ctx);
}

/* what the badge shows for a model's units — pure, so it can be read in a test */
export function unitBadge(units, warnings = []){
  if(!units) return {text: "", title: "", warn: false};
  const said = units.unit === null ? "⚠ file: chưa khai đơn vị"
             : `file: ${units.unit}` + (units.source === "chọn tay" ? " (chọn tay)" : "");
  const why = units.source === "AAMA" ? `file khai "Units: ${units.declared}"`
            : units.source === "chọn tay" ? "đơn vị chọn tay" : units.warning || "";
  const notes = [why, units.conflict, ...warnings.slice(0, 8)].filter(Boolean);
  const more = warnings.length ? `  ·  ⚠ ${warnings.length} cảnh báo` : "";
  return {text: said + more, title: notes.join("\n"), warn: units.unit === null || !!units.conflict || warnings.length > 0};
}

export const DxfImport = {
  mount(ctx, ui){
    name = node("b", {id:"fname", textContent:"—"});
    const title = node("h1"); title.appendChild(name);

    enc = node("select", {id:"enc"});
    enc.innerHTML = `<option value="auto">Auto</option><option value="utf-8">UTF-8</option>
      <option value="gbk">GBK</option><option value="big5">Big5</option>`;
    enc.addEventListener("change", () => {
      if(buf){ text = decode(new Uint8Array(buf), enc.value); reload(ctx); }
    });

    fileUnit = node("select", {id:"fileunit", hidden: true,
      title:"File không khai đơn vị: chọn đơn vị CỦA FILE — đọc lại hình theo đơn vị đó. Khác với công tắc in · cm · mm (chỉ đổi cách hiện số)"});
    fileUnit.innerHTML = `<option value="auto">File: Auto</option><option value="mm">File: mm</option><option value="inch">File: inch</option>`;
    fileUnit.addEventListener("change", () => reload(ctx));
    badge = node("span", {id:"ubadge", className:"ubadge mono"});

    const pick = node("input", {id:"pick", type:"file", accept:".dxf,.DXF", hidden:true});
    pick.addEventListener("change", e => { if(e.target.files[0]) read(ctx, e.target.files[0]); });
    const label = node("label", {className:"btn", htmlFor:"pick", textContent:"Open DXF"});

    ui.bar.append(title, badge, fileUnit, enc, label, pick);

    /* nothing open (O1): what to do, on the stage — put FIRST in it, so the toolbar, the readout and
       the docks paint over it while the drawing area underneath stays covered */
    empty = node("div", {className:"empty", id:"empty", hidden:true});
    const box = node("div", {className:"emptybox"});
    box.append(node("b", {textContent:"Chưa mở rập nào"}),
               node("label", {className:"btn", htmlFor:"pick", textContent:"Open DXF"}),
               node("span", {textContent:"hoặc kéo thả file .dxf vào đây"}));
    empty.appendChild(box);
    ui.stage.prepend(empty);

    ["dragenter","dragover"].forEach(t => document.addEventListener(t, e => {
      e.preventDefault(); document.body.classList.add("hot"); }));
    ["dragleave","drop"].forEach(t => document.addEventListener(t, e => {
      e.preventDefault(); document.body.classList.remove("hot"); }));
    document.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if(f) read(ctx, f); });
    addEventListener("message", ev => { const f = openedFile(ev, window); if(f) read(ctx, f); });

    ctx.onLoad(c => {
      name.textContent = c.fileName;
      empty.hidden = c.pieces().length > 0;
      const units = c.model && c.model.units;
      const b = unitBadge(units, (c.model && c.model.warnings) || []);
      badge.textContent = b.text; badge.title = b.title; badge.classList.toggle("warn", b.warn);
      /* the file-unit choice is only offered when the file itself does not say */
      fileUnit.hidden = !!units && units.source === "AAMA";
      toHost({type: OPENED, name: c.fileName, pieces: c.pieces().length});
    });
  },

  /* the last step of start(): nothing is open (the repo carries no sample — open.md O1), and a
     host may now send a file (O5) */
  boot(ctx){
    empty.hidden = false;
    toHost({type: READY});
  }
};

function read(ctx, file){
  const fr = new FileReader();
  fr.onload = () => openBytes(ctx, fr.result, file.name);
  fr.readAsArrayBuffer(file);
}
