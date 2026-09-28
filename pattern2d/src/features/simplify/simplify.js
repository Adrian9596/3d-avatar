/* The Simplify tool: show what a pattern would look like with the redundant vertices
   gone, beside what it looks like now — and never touch the original.

   A factory DXF states curves as polylines, so the 3380 pattern arrives as 810 vertices
   describing 22 real edges. This tool is where you decide how many of them you can drop:
   pick a tolerance, see the line that comes out, and read how far it moved. The original
   outline stays on screen underneath in grey the whole time, because a simplification you
   cannot compare against the source is a simplification nobody should trust
   (spec: geometry/simplify.md §1.5). Nothing here writes to the DXF or the spec. */
import {$, el, node, bindLength} from "../../shared/dom.js";
import {lengthField} from "../../shared/units.js";
import {Canvas} from "../canvas/canvas.js";
import {Readout} from "../readout/readout.js";
import {simplify, validateSimplify, detect} from "../geometry/simplify.js";

let button = null, bar = null, cache = null;

const on = () => Canvas.activeTool() === "simplify";
/* the tolerance: held in mm, typed and shown in the display unit (shared/units.md U6) */
export const TOL_FIELD = {mm: 0.1, min: 0.01, max: 5, d: 2};
const tolField = lengthField(TOL_FIELD);
const tol = () => tolField.mm;

/* Points a piece may not lose: notches, grade references, turn points — whatever the
   drafter marked. Pure so the rule is testable; the kernel decides what to do with it. */
export function marksOf(piece){
  if(!piece) return [];
  return (piece.points || [])
    .filter(q => ["2", "4", "5"].includes(q.layer))
    .map(q => [q.x, q.y]);
}

export const Simplify = {
  mount(ctx, ui){
    button = Canvas.toolButton(ui, {id: "simp", label: "Simplify", tool: "simplify",
      title: "Rút gọn số điểm của mảnh đang chọn (S) — chỉ để xem, không ghi vào DXF"}, ctx);

    bar = node("div", {className: "gbar", id: "simpbar", hidden: true,
      innerHTML: `<label>Tolerance <input id="simptol" type="text" inputmode="decimal" autocomplete="off"
                  title="Độ lệch cho phép, theo đơn vị hiển thị"><span class="utag" id="simptolu"></span></label><span class="ghint">bản gốc luôn giữ nguyên</span>`});
    ui.stage.appendChild(bar);
    const showTol = bindLength(bar.querySelector("#simptol"), tolField, {unit: () => ctx.shownUnit(),
      tag: bar.querySelector("#simptolu"), onValue(){ cache = null; ctx.draw(); }});
    ctx.onUnit(() => showTol()); ctx.onLoad(() => showTol());

    Canvas.tool("simplify", {onExit(){ cache = null; }});
    Canvas.layer((root, ppm, c) => { if(on()) draw(root, ppm, c); });
    Canvas.afterDraw(c => {
      button.setAttribute("aria-pressed", on());
      button.classList.toggle("on", on());
      bar.hidden = !on();
    });
    Readout.section(c => on() ? rows(c) : null);
    ctx.onLoad(() => { cache = null; });
    ctx.onEdit(() => { cache = null; });
    ctx.onPieces(() => { cache = null; });             // worked out for a place in the list (pieces/remove.md R5)
    ctx.key("s", () => Canvas.setTool(on() ? null : "simplify", ctx));
  }
};

/* recomputed only when the piece or the tolerance changes — RDP on 155 points is cheap,
   but the validation walks every vertex against every segment, which is not */
function result(ctx){
  const i = ctx.primary;
  const p = ctx.pieces()[i];
  if(!p || !p.cut) return null;
  const t = tol();
  if(cache && cache.i === i && cache.tol === t) return cache;
  const keep = marksOf(p);
  const r = simplify(p.cut, {closed: true, tol: t, keep});
  const v = validateSimplify(p.cut, r.pts, {closed: true, tol: t, keep});
  cache = {i, tol: t, piece: p, r, v, d: detect(p.cut, {closed: true, tol: t})};
  return cache;
}

function draw(root, ppm, ctx){
  const c = result(ctx);
  if(!c) return;
  const g = el("g", {});
  const d = pts => pts.map(([x, y], k) => `${k ? "L" : "M"}${x} ${-y}`).join("") + "Z";
  /* original underneath, always — this is the "keep original" rule made visible */
  g.appendChild(el("path", {d: d(c.piece.cut), fill: "none", stroke: "var(--ink-3)",
    "stroke-width": 1, "stroke-dasharray": "4 3", "vector-effect": "non-scaling-stroke"}));
  g.appendChild(el("path", {d: d(c.r.pts), fill: "none", stroke: "var(--accent)",
    "stroke-width": 1.8, "vector-effect": "non-scaling-stroke"}));
  for(const [x, y] of c.r.pts)
    g.appendChild(el("circle", {cx: x, cy: -y, r: 2.2/ppm, fill: "var(--accent)"}));
  root.appendChild(g);
}

function rows(ctx){
  const c = result(ctx);
  return c ? simplifyRows(c, (v, d, l) => ctx.len(v, d, l)) : null;
}
/* the readout of one simplification, for a length formatter L(mm, d, label) */
export function simplifyRows(c, L){
  const {r, v, d} = c;
  return {section: "Simplify", rows: [
    ["Tolerance", L(r.tol, 2), true],
    ["Đỉnh", `${r.before} → ${r.after}`, true],
    ["Bỏ được", `${r.removed} (${(r.ratio*100).toFixed(0)}%)`, true],
    ["Thẳng hàng", String(d.collinear.length), true],
    ["Lệch max", L(v.maxDeviation, 3), true],
    ["Chu vi Δ", `${v.perimeter.delta >= 0 ? "+" : ""}${L(v.perimeter.delta, 2)}`, true],
    ["Mốc giữ", `${v.markers.onOutline - v.markers.lost}/${v.markers.onOutline}`, true],
    ["Kết", v.ok ? "đạt" : "KHÔNG đạt", true]
  ], total: ["Gốc", "giữ nguyên"]};
}
