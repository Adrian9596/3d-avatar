/* The handful of DOM helpers every feature needs.
   Deliberately tiny: anything only one feature uses belongs in that feature. */
import {UNIT_LABEL} from "./units.js";

export const NS = "http://www.w3.org/2000/svg";
export const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

export const $ = id => document.getElementById(id);

/* SVG element with attributes; null/undefined attributes are skipped */
export const el = (tag, attrs) => {
  const e = document.createElementNS(NS, tag);
  for(const k in attrs) if(attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
  return e;
};

/* HTML element — used by features that build their own controls */
export const node = (tag, props) => Object.assign(document.createElement(tag), props || {});

export const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

export const fmt = (v, d = 1) =>
  v.toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d});

/* a key pressed while TD types into a box is text, not a shortcut */
export const isTyping = ev => !!ev.target && typeof ev.target.matches === "function" && ev.target.matches("input,select,textarea");

/* An arrow key as a nudge, in millimetres: 1 mm, ⇧ 10 mm (shared/units.md D4) — the same step in
   Arrange, Edit and Vẽ. null for any other key. */
export function arrowStep(ev){
  if(!ev.key || !ev.key.startsWith("Arrow")) return null;
  const k = ev.shiftKey ? 10 : 1;
  return [ev.key === "ArrowLeft" ? -k : ev.key === "ArrowRight" ? k : 0, ev.key === "ArrowDown" ? -k : ev.key === "ArrowUp" ? k : 0];
}

/* Enter in a box runs fn(input, ev) — ev says whether ⇧ was held */
export const onEnter = (input, fn) => input.addEventListener("keydown", ev => { if(ev.key === "Enter") fn(input, ev); });

/* A cached last-valid value is not permission to act on an invalid box. Each
   command checks all of its inputs, regardless of which one received Enter. */
export function inputError(...inputs){
  const bad = inputs.find(input => input && input.getAttribute("aria-invalid") === "true");
  return bad ? bad.title || "số không hợp lệ — sửa ô đang báo lỗi trước" : null;
}

/* hand TD a file: the browser downloads `text` as `name` — nothing on disk is touched */
export function downloadText(text, name, type = "application/dxf"){
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = node("a", {href: url, download: name});
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* A text box that holds a LENGTH (a lengthField of shared/units.js): it writes the field's
   millimetres in the current unit and reads what TD types back through the field. A refused
   text turns the box red, says why in its tooltip and changes nothing. Returns `show`, to be
   called when the unit changes — it re-writes from millimetres, never from the old text. */
export function bindLength(input, field, {unit, tag, onValue}){
  const base = input.title;
  const show = () => {
    const u = unit();
    input.value = field.text(u);
    input.removeAttribute("aria-invalid"); input.title = base;
    if(tag) tag.textContent = u === null ? "đv?" : UNIT_LABEL[u];
  };
  input.addEventListener("input", () => {
    const r = field.read(input.value, unit());
    if(r.ok){ input.removeAttribute("aria-invalid"); input.title = base; onValue(r.mm); }
    else { input.setAttribute("aria-invalid", "true"); input.title = r.error; }
  });
  /* committing (Enter, or leaving the box) rewrites what was typed — "3/8" becomes 0.375 */
  const commit = () => { if(!input.hasAttribute("aria-invalid")) show(); };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", ev => { if(ev.key === "Enter") commit(); });
  show();
  return show;
}
