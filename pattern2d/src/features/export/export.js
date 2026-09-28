/* Copy: the piece table as TSV, ready to paste into the spec sheet the factory reads.
   X/Y are the piece's position in the drawing, so a layout arranged in the viewer
   can be checked against the file it came from.

   The numbers are in the display unit and the header SAYS which — a pasted table has to
   carry its own unit (shared/units.md D2). No thousands separator: a spreadsheet would read
   "1,316.7" as something else. */
import {pieceLabel} from "../pieces/pieces.js";
import {formatLength, mmPer, UNIT_LABEL} from "../../shared/units.js";

export const COLUMNS = ["Piece","Qty","Material","Width","Height","Cut","Sew","X","Y"];
const LENGTHS = new Set(["Width","Height","Cut","Sew","X","Y"]);

/* unit: "inch" | "cm" | "mm", or null when the file declared none (then "đv?") */
export function tsv(pieces, unit){
  const tag = unit === null ? "đv?" : (mmPer(unit), UNIT_LABEL[unit]);
  const n = v => formatLength(v, unit, {label: false, plain: true});
  const head = COLUMNS.map(c => LENGTHS.has(c) ? `${c} (${tag})` : c);
  const body = pieces.map((p, i) => [pieceLabel(p, i), p.qty||"", p.category||"",
    n(p.bbox.w), n(p.bbox.h), n(p.cutLen), n(p.sewLen), n(p.bbox.x0), n(p.bbox.y0)].join("\t"));
  return [head.join("\t")].concat(body).join("\n");
}

export const Exporter = {
  mount(ctx, ui){
    const b = document.createElement("button");
    b.className = "btn"; b.id = "copy"; b.textContent = "Copy";
    b.addEventListener("click", async () => {
      try{ await navigator.clipboard.writeText(tsv(ctx.pieces(), ctx.shownUnit())); b.textContent = "Copied"; }
      catch(err){ b.textContent = "Failed"; }
      setTimeout(() => b.textContent = "Copy", 1400);
    });
    ui.tools.appendChild(b);
  }
};
