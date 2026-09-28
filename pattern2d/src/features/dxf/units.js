/* Which unit a DXF's numbers are in — decided from what the file DECLARES, never guessed.

   A pattern DXF declares its unit the AAMA way, as a text line "Units: METRIC" (mm) or
   "Units: ENGLISH" (inch); that is the line factory CAD reads (INTENT §4.1). The AutoCAD
   header variables are not trusted with it: $INSUNITS is a block-insertion setting that
   writers fill with their own default — ezdxf puts 6 (metres) into every file it creates,
   mm drawings included — and $MEASUREMENT only picks hatch and linetype files. So they are
   kept as hints and reported, never applied (measure_engine.md A5–A6). In TD's library
   $INSUNITS is present in 12/46 files, always 4, always right; whether to trust it when the
   AAMA line is missing is TD's call, not the reader's.

   No declaration → the unit is null. Coordinates stay as drawn, and every reader of the
   model can see that "mm" would be a guess. */

import {MM_PER} from "../../shared/units.js";

/* the units a FILE can declare (AAMA has METRIC and ENGLISH only); the factors are the one
   table shared/units.js keeps for the display too, so 25.4 is written down once */
export const UNIT_MM = {mm: MM_PER.mm, inch: MM_PER.inch};
const INSUNITS = {0: "không đơn vị", 1: "inch", 2: "feet", 4: "mm", 5: "cm", 6: "m"};
const AAMA = {METRIC: "mm", ENGLISH: "inch"};

function factor(unit){
  const k = UNIT_MM[unit];
  if(!k) throw new Error(`đơn vị không hợp lệ: "${unit}" — chỉ nhận ${Object.keys(UNIT_MM).join(" hoặc ")}, không tự đoán`);
  return k;
}
export const toMM = (v, unit) => v*factor(unit);
export const fromMM = (v, unit) => v/factor(unit);

/* the AAMA "Units:" text, whatever case the CAD wrote the key in (Units / UNITS) */
function declared(header){
  for(const [k, v] of Object.entries(header || {})) if(k.trim().toLowerCase() === "units") return String(v).trim();
  return null;
}

/* override: "mm" | "inch" chosen by hand in the viewer, or "auto"/undefined to read the file */
export function resolveUnits(dxf, override){
  const hints = {};
  for(const k of ["$INSUNITS", "$MEASUREMENT"]) if(dxf.vars && k in dxf.vars) hints[k] = dxf.vars[k];
  const said = declared(dxf.header);
  let unit = null, source = null, warning = null, conflict = null;
  if(override && override !== "auto"){
    factor(override);
    unit = override; source = "chọn tay";
  } else if(said !== null){
    unit = AAMA[said.toUpperCase()] || null;
    source = unit ? "AAMA" : null;
    if(!unit) warning = `file khai "Units: ${said}" — không phải METRIC hay ENGLISH, không tự đoán đơn vị`;
  } else {
    warning = "file không khai đơn vị (thiếu dòng Units: của AAMA) — số đo là đơn vị bản vẽ, chưa chắc là mm";
  }
  const hinted = INSUNITS[hints.$INSUNITS];
  if(unit && hinted && hints.$INSUNITS !== 0 && hinted !== unit){
    const who = source === "AAMA" ? "Units: " + said : "đơn vị chọn tay";
    conflict = "$INSUNITS=" + hints.$INSUNITS + ` (${hinted}) trái với ${who} — theo ${source === "AAMA" ? "AAMA" : "lựa chọn tay"}`;
  }
  return {unit, scale: unit ? UNIT_MM[unit] : 1, source, declared: said, hints, warning, conflict};
}
