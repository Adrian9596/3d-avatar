/* How a length is SHOWN and TYPED — never how it is stored (spec: shared/units.md).

   The kernel keeps millimetres, always (CLAUDE.md §5.2). The display unit is only a way of
   writing those millimetres down and of reading a typed number back into them, so switching
   it cannot move a single vertex: nothing here touches geometry, and nothing re-reads a
   displayed string to get a value back — that is how display rounding would creep into data.

   `null` as a unit means the file declared none (dxf/units.js): the numbers are drawing
   units, and writing them as inches or centimetres would be a guess, so they are written as
   they are and labelled "đv?". Pure functions only — the current unit lives in ctx. */

export const MM_PER = {mm: 1, cm: 10, inch: 25.4};                 // exact by definition
export const DISPLAY_UNITS = ["inch", "cm", "mm"];                 // the order of the switch
export const DEFAULT_UNIT = "inch";
export const UNIT_LABEL = {inch: "in", cm: "cm", mm: "mm"};
const UNKNOWN = "đv?";
const EXTRA = {mm: 0, cm: 1, inch: 2};                             // 0.1 mm ≈ 0.01 cm ≈ 0.001 in

export function mmPer(unit){
  const k = MM_PER[unit];
  if(!k) throw new Error(`đơn vị không hợp lệ: "${unit}" — chỉ có ${DISPLAY_UNITS.join(" · ")}`);
  return k;
}
export const toUnit = (mm, unit) => mm/mmPer(unit);
export const fromUnit = (v, unit) => v*mmPer(unit);
const labelOf = unit => unit === null ? UNKNOWN : (mmPer(unit), UNIT_LABEL[unit]);

/* `d` is the number of decimals in mm; the other units add what keeps the same resolution */
export function formatLength(mm, unit, {d = 1, label = true, plain = false} = {}){
  const v = unit === null ? mm : toUnit(mm, unit), n = d + (unit === null ? 0 : EXTRA[unit]);
  let s = plain ? v.toFixed(n) : v.toLocaleString("en-US", {minimumFractionDigits: n, maximumFractionDigits: n});
  if(s[0] === "-" && Number(s.replace(/,/g, "")) === 0) s = s.slice(1);   // never "−0.0"
  return label ? `${s} ${labelOf(unit)}` : s;
}
/* one formatter per unit, the signature every feature takes: L(mm, d = 1, label = true) */
export const lengthFormatter = unit => (mm, d = 1, label = true) => formatLength(mm, unit, {d, label});
export const formatPoint = (p, unit) => `${formatLength(p[0], unit, {label: false})} , ${formatLength(p[1], unit)}`;
export const pxPer = (ppm, unit) =>
  `${(ppm*(unit === null ? 1 : mmPer(unit))).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})} px/${labelOf(unit)}`;
/* the unit a model's numbers can honestly be shown in: the chosen one, or none at all */
export const shownUnit = (units, unit) => units && units.unit === null ? null : unit;

/* ── reading a typed number ─────────────────────────────────────────────────
   In the display unit, unless the text names its own (mm · cm · in · "), which then wins —
   naming it is declaring it. "0,25" is a decimal (the Vietnamese way); "1,316.7" is how the
   readout writes a thousand. Anything else is refused, never half-read. */
const SUFFIXES = [["inches", "inch"], ["inch", "inch"], ["mm", "mm"], ["cm", "cm"], ["in", "inch"], ['"', "inch"]];
/* a pattern that must cover the WHOLE text, not a prefix of it */
const whole = (re, s) => { const m = re.exec(s); return m && m[0].length === s.length ? m : null; };
export function parseLength(text, unit){
  const bad = why => { throw new Error(`số không hợp lệ: "${text}" — ${why}`); };
  let s = String(text ?? "").trim(), u = unit;
  if(!s) bad("ô trống");
  const hit = SUFFIXES.find(([w]) => s.toLowerCase().endsWith(w));
  if(hit){
    if(unit === null) throw new Error(`file chưa khai đơn vị — không đổi được "${hit[0]}" sang đơn vị bản vẽ; chọn đơn vị của file trước`);
    u = hit[1];
    s = s.slice(0, s.length - hit[0].length).trim();
  }
  if(u !== null) mmPer(u);
  const frac = (w, n, den) => { if(den === 0) bad("mẫu số bằng 0"); return w + n/den; };
  let r, v;
  if((r = whole(/^(\d+)(?:\s+|-)(\d+)\s*\/\s*(\d+)/, s))) v = frac(+r[1], +r[2], +r[3]);
  else if((r = whole(/^(\d+)\s*\/\s*(\d+)/, s))) v = frac(0, +r[1], +r[2]);
  else if(whole(/^[+-]?(\d+([.,]\d*)?|[.,]\d+)/, s)) v = parseFloat(s.replace(",", "."));
  else if(whole(/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?/, s)) v = parseFloat(s.replace(/,/g, ""));
  else bad("cần số, phân số (3/8) hoặc hỗn số (1 1/4)");
  return u === null ? v : fromUnit(v, u);
}
/* An angle typed in degrees, counter-clockwise from +X: 30 · 30° · -45 · 12,5 — anything else is
   refused, never half-read. Edit and Vẽ both take angles, so they share one reader: the two tools can
   never disagree on what "12,5" means. Degrees are the same in every display unit. */
export function parseAngle(text){
  let s = String(text ?? "").trim().replace(",", ".");
  if(s.endsWith("°")) s = s.slice(0, -1).trim();
  const m = /^[+-]?(\d+(\.\d*)?|\.\d+)/.exec(s);
  if(!m || m[0].length !== s.length) throw new Error(`góc không hợp lệ: "${text}" — cần số độ, ví dụ 30 hoặc -45°`);
  return parseFloat(s);
}

/* A length a feature lets TD type (Gap, Đường may, Tolerance): it holds millimetres and only
   ever WRITES them in the current unit — switching back and forth cannot drift the value,
   because the value is never read back from its own display (spec U7). Bounds are in mm. */
export function lengthField({mm, min = 0, max = Infinity, d = 1}){
  let value = mm;
  return {
    get mm(){ return value; },
    set(v){ value = v; },                           // a new default (another file), not something typed
    text: unit => formatLength(value, unit, {d, label: false, plain: true}),
    read(text, unit){
      try{
        const v = parseLength(text, unit);
        if(!(v >= min && v <= max))
          throw new Error(`số không hợp lệ: "${text}" — ngoài khoảng ${formatLength(min, unit, {d})}` +
                          (max < Infinity ? ` … ${formatLength(max, unit, {d})}` : " trở lên"));
        value = v;
        return {ok: true, mm: v, error: null};
      }catch(e){ return {ok: false, mm: value, error: e.message}; }
    }
  };
}

/* ── snap tolerance ─────────────────────────────────────────────────────────
   TD 2026-09-23 (units.md §3): a distance in the DRAWING's unit — 0.02 in for a file that
   declares inches, 0.5 mm for one that declares millimetres, nothing for one that declares
   neither (then nothing snaps). Returned in mm, the kernel's unit. The display switch is not
   an argument on purpose: changing how numbers are written must not change what snaps (S3). */
const SNAP_DRAWING = {inch: 0.02, mm: 0.5};
export const snapDefault = fileUnit => fileUnit in SNAP_DRAWING ? fromUnit(SNAP_DRAWING[fileUnit], fileUnit) : null;
/* the status-bar box that shows and takes it: 0 is allowed (snap only on an exact hit) */
export const SNAP_FIELD = {min: 0, max: 100, d: 2};

/* the scale bar: the first round number, in the display unit, longer than 60 px */
const NICE = {mm: [1, 2, 5, 10, 20, 50, 100, 200, 500], cm: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50],
              inch: [1/16, 1/8, 1/4, 1/2, 1, 2, 5, 10, 20, 50]};
const FRACTION = new Map([[1/16, "1/16"], [1/8, "1/8"], [1/4, "1/4"], [1/2, "1/2"]]);
export function niceScale(ppm, unit){
  const k = unit === null ? 1 : mmPer(unit), list = NICE[unit === null ? "mm" : unit];
  const v = list.find(x => x*k*ppm > 60) ?? list[list.length - 1];
  const shown = unit === "inch" && FRACTION.has(v) ? FRACTION.get(v) : String(v);
  return {mm: v*k, value: v, label: `${shown} ${labelOf(unit)}`};
}
