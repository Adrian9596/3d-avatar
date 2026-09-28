/* Mặt tương tác của ba lớp hình học.

   Bấm "Geom" trên một mảnh: viewer dựng một tài liệu hình học từ chính mảnh đó —
   đường cắt là nút nguồn, còn đường may, vạch notch và grainline là những nút DẪN
   XUẤT. Kéo một đỉnh của đường cắt thì solver kéo phần còn lại theo, ngay trước mắt.
   Không có gì ghi ngược vào DXF: đây là bàn thử quan hệ, không phải trình sửa rập. */
import {$, el, esc, node, bindLength} from "../../shared/dom.js";
import {lengthField} from "../../shared/units.js";
import {Canvas} from "../canvas/canvas.js";
import {Readout} from "../readout/readout.js";
import {Pieces} from "../pieces/pieces.js";
import {segmentEdges} from "../edges/segment.js";
import {point, line, curve, closestPoint, sample, pointAt} from "./model.js";
import {snapTo} from "./snap.js";
import {createDoc} from "./doc.js";

let button = null, dock = null, bar = null;
let doc = null, built = -1, handles = [], drag = null, snap0 = null, report = null;
const ids = {};

const on = () => Canvas.activeTool() === "geometry";
/* the seam allowance: held in mm, typed and shown in the display unit (shared/units.md U6) */
export const SA_FIELD = {mm: 6, min: 0, max: 50, d: 1};
const saField = lengthField(SA_FIELD);
const sa = () => saField.mm;

export const Geometry = {
  mount(ctx, ui){
    button = Canvas.toolButton(ui, {id: "geom", label: "Geom", tool: "geometry", title: "Dựng quan hệ hình học trên mảnh đang chọn (G)"}, ctx);

    buildBar(ctx, ui);
    Canvas.tool("geometry", {onDown, onMove, onUp, onExit(){ drag = null; }});
    Canvas.layer((root, ppm, c) => { if(on()) draw(root, ppm, c); });
    Canvas.afterDraw(ctx => sync(ctx));
    Readout.section(readout);
    ctx.onLoad(() => { doc = null; built = -1; handles = []; report = null; });
    ctx.onEdit(() => { doc = null; built = -1; handles = []; report = null; });
    ctx.onPieces(() => { doc = null; built = -1; handles = []; report = null; drag = null; });   // built for a place in the list
    ctx.key("g", () => Canvas.setTool(on() ? null : "geometry", ctx));
  }
};

/* ── dựng tài liệu từ mảnh đang chọn ────────────────────────────────────── */
function build(ctx){
  const i = ctx.primary;
  const p = ctx.pieces()[i];
  if(!p || !p.cut){ doc = null; built = -1; return; }

  doc = createDoc();
  ids.cut = doc.add(curve(p.cut, true), {name: "đường cắt"});
  ids.sew = doc.derive("offset", [ids.cut], {d: sa(), side: "in"}, {name: "đường may"});

  /* notch thật của mảnh (layer 4): giữ vị trí theo % chiều dài, rồi bám đường cắt */
  ids.ticks = p.points.filter(q => q.layer === "4").slice(0, 12).map((q, k) => {
    const t = closestPoint(doc.get(ids.cut), point(q.x, q.y)).t;
    return doc.derive("perpendicular", [ids.cut], {t, len: 6, side: "out"}, {name: `notch ${k+1}`});
  });

  /* grainline (layer 7) kéo dài hai đầu tới biên mảnh — việc thật của rập */
  const g = p.paths.find(q => q.layer === "7" && q.pts.length > 1);
  if(g){
    const a = point(g.pts[0][0], g.pts[0][1]), b = point(g.pts[g.pts.length-1][0], g.pts[g.pts.length-1][1]);
    ids.grain = doc.add(line(a, b), {name: "grainline"});
    ids.grainFit = doc.derive("extendTo", [doc.derive("extendTo", [ids.grain, ids.cut], {end: "end"},
                                                      {name: "grain ↑"}), ids.cut],
                              {end: "start"}, {name: "grain ↓"});
  } else { ids.grain = null; ids.grainFit = null; }

  report = doc.solve();
  snap0 = doc.snapshot();
  handles = corners(doc.get(ids.cut));
  built = i;
}

/* tay nắm đặt ở điểm gãy của đường cắt — chính là các góc mà Edges tìm ra */
function corners(c){
  const segs = segmentEdges(c.pts.slice());
  const out = [];
  for(const s of segs){
    const q = s.pts[0];
    const k = c.pts.findIndex(v => v[0] === q[0] && v[1] === q[1]);
    if(k >= 0) out.push(k);
  }
  return out;
}

/* ── vẽ ─────────────────────────────────────────────────────────────────── */
function draw(root, ppm, ctx){
  if(!doc || built !== ctx.primary) build(ctx);
  if(!doc) return;
  const g = el("g", {});
  const path = (s, attrs) => {
    if(!s) return;
    const pts = sample(s, 0.3);
    g.appendChild(el("path", Object.assign({
      d: "M" + pts.map(q => `${q[0]},${-q[1]}`).join("L"), fill: "none",
      "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke"}, attrs)));
  };

  /* đường cắt của tài liệu: trùng khít mảnh DXF cho tới khi bị kéo, rồi tách ra —
     nhìn thấy cả hình gốc lẫn hình đang sửa là chủ ý, không phải lỗi */
  path(doc.get(ids.cut), {stroke: "var(--ink)", "stroke-width": 1.9});
  path(doc.get(ids.sew), {stroke: "var(--accent)", "stroke-width": 1.4, "stroke-dasharray": "6 3"});
  for(const t of ids.ticks) path(doc.get(t), {stroke: "var(--l-notch)", "stroke-width": 1.6});
  path(doc.get(ids.grainFit), {stroke: "var(--l-grain)", "stroke-width": 1.6});

  const cut = doc.get(ids.cut);
  handles.forEach((k, j) => {
    const [x, y] = cut.pts[k];
    const hot = drag && drag.h === j;
    g.appendChild(el("circle", {cx: x, cy: -y, r: (hot ? 5 : 3.5)/ppm,
      fill: hot ? "var(--accent)" : "var(--bg)", stroke: "var(--accent)",
      "stroke-width": 1.4, "vector-effect": "non-scaling-stroke"}));
  });
  root.appendChild(g);
}

/* What a dragged vertex may snap to: every visible POINT of the piece, and every visible path
   that is NOT the cut line being edited — a vertex hitting its own outline would only fold it.
   Pure, so the rule is testable; the tolerance is the drawing's (shared/units.md §3 S5). */
export function dragTargets(p, layersOn){
  const paths = (p.paths || []).filter(q => q.layer !== "1" && layersOn[q.layer] && q.pts.length >= 2);
  return {
    points: (p.points || []).filter(q => layersOn[q.layer]).map(q => [q.x, q.y])
      .concat(paths.flatMap(q => (q.snap || q.pts).map(v => [v[0], v[1]]))),
    shapes: paths.flatMap(q => q.shapes && q.shapes.length ? q.shapes : [curve(q.pts, !!q.closed)])
  };
}

/* ── kéo một đỉnh: sửa nút nguồn rồi để solver làm phần còn lại ─────────── */
function onDown(ev, w, ctx){
  if(ev.button === 1 || ev.altKey || !doc) return false;
  const tol = 9/Canvas.pxPerMM();
  const cut = doc.get(ids.cut);
  let best = -1, bd = tol;
  handles.forEach((k, j) => {
    const d = Math.hypot(cut.pts[k][0]-w[0], cut.pts[k][1]-w[1]);
    if(d < bd){ bd = d; best = j; }
  });
  if(best < 0) return false;                       // không trúng tay nắm → nhường cho pan
  drag = {h: best, k: handles[best], w0: w, snap: doc.snapshot()};
  ctx.draw();
  return true;
}
function onMove(ev, w, ctx){
  if(!drag || !doc) return;
  const cut = doc.get(ids.cut);
  const pts = cut.pts.map(q => q.slice());
  const p = ctx.pieces()[built];
  pts[drag.k] = p ? snapTo(w, dragTargets(p, ctx.layersOn), ctx.snapTol()).point : [w[0], w[1]];
  doc.set(ids.cut, curve(pts, cut.closed));
  report = doc.solve();
  ctx.draw();
}
function onUp(ev, ctx){ if(drag){ drag = null; ctx.draw(); } }

/* ── thanh lệnh ─────────────────────────────────────────────────────────── */
function buildBar(ctx, ui){
  dock = node("div", {className: "dock geom", id: "geomdock", hidden: true});
  dock.innerHTML =
    `<div class="tip" id="geomtip"></div>` +
    `<div class="arrangebar">` +
      `<span class="grp"><span class="gapf"><label for="sa">Đường may</label>` +
      `<input id="sa" type="text" inputmode="decimal" autocomplete="off" title="Khoảng lùi của đường may, theo đơn vị hiển thị — gõ được 1/4, 1 1/4"><span class="utag" id="sau"></span></span></span>` +
      `<span class="grp">` +
        `<button class="btn" data-act="extend">Grainline chạm biên</button>` +
        `<button class="btn" data-act="trim">Cắt trong biên</button>` +
      `</span>` +
      `<span class="grp"><button class="btn" data-act="reset">Về hình gốc</button></span>` +
    `</div>`;
  ui.stage.appendChild(dock);
  bar = dock.querySelector(".arrangebar");

  const showSa = bindLength(dock.querySelector("#sa"), saField, {unit: () => ctx.shownUnit(), tag: dock.querySelector("#sau"),
    onValue(){
      if(!doc) return;
      doc.setParams(ids.sew, {d: sa()});
      report = doc.solve();
      ctx.draw();
    }});
  ctx.onUnit(() => showSa()); ctx.onLoad(() => showSa());
  bar.addEventListener("click", ev => {
    const act = ev.target.closest("[data-act]")?.dataset.act;
    if(!act || !doc) return;
    if(act === "reset"){ doc.restore(snap0); report = doc.solve(); }
    if(act === "extend" && ids.grain){
      doc.extend(ids.grain, [ids.cut], "end"); doc.extend(ids.grain, [ids.cut], "start");
      report = doc.solve();
    }
    if(act === "trim" && ids.grain){
      const g = doc.get(ids.grain);
      doc.trim(ids.grain, [ids.cut], pointAt(g, 0.5));
      report = doc.solve();
    }
    ctx.draw();
  });
}

function sync(ctx){
  dock.hidden = !on();
  button.setAttribute("aria-pressed", on());
  button.classList.toggle("on", on());
  if(!on()) return;
  const tip = $("geomtip");
  if(!doc){
    tip.textContent = "Chọn một mảnh rồi bấm Geom — đường may, notch và grainline sẽ bám theo đường cắt";
    Canvas.status("geom", "");
    return;
  }
  tip.textContent = "Kéo một tay nắm trên đường cắt · ⌥ kéo để pan";
  const n = doc.ids().length, d = doc.relations().length;
  Canvas.status("geom", report
    ? `${n} nút · ${d} quan hệ · cập nhật ${report.updated.length} trong ${report.ms} ms`
    : `${n} nút · ${d} quan hệ`);
}

function readout(ctx){
  if(!on() || !doc) return null;
  const rows = doc.relations((v, d, l) => ctx.len(v, d, l)).map(r => [r.name, r.error ? "gãy" : r.text]);
  return {section: "Quan hệ", rows,
          total: ["Nút nguồn", String(doc.ids().filter(id => doc.isSource(id)).length)]};
}
