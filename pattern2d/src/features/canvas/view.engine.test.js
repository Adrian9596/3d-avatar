/* Measure Engine · Transform — the view side: zoom · pan · screen resize
   (spec: src/features/measure/measure_engine.md §5).

   The referee is the SVG specification itself (SVG 1.1 §7.8, viewBox + preserveAspectRatio
   "xMidYMid meet"), rewritten below: it says at which pixel the browser PAINTS a world
   point. A click on that pixel must come back as that world point — whatever the zoom, the
   pan or the size of the window — or the tool measures something the user did not click.
   canvas.js sets viewBox = (view.x, −(view.y + view.h), view.w, view.h) and draws (x, −y). */
import {mcase} from "../../../tests/engine.js";
import * as View from "./view.js";
import {point} from "../geometry/model.js";
import {straight, nearestPoint} from "../geometry/straight.js";

const G = "Transform";
/* namespace import: an API that does not exist yet fails its own case, not the whole run */
const {fitBox, zoomAt, worldAt} = View, ppmOf = (v, r) => View.ppmOf(v, r);

function paintedAt(view, rect, x, y){
  const vbx = view.x, vby = -(view.y + view.h), vbw = view.w, vbh = view.h;
  const s = Math.min(rect.width/vbw, rect.height/vbh);                  // meet
  const tx = rect.left + (rect.width - vbw*s)/2 - vbx*s;                 // xMid
  const ty = rect.top + (rect.height - vbh*s)/2 - vby*s;                 // yMid
  return [tx + x*s, ty + (-y)*s];
}
const paintedScale = (view, rect) => Math.min(rect.width/view.w, rect.height/view.h);

const BOX = {x0: 0, y0: 0, x1: 220, y1: 120, w: 220, h: 120};
const N1 = [30.5, 12.25], N2 = [187.75, 96.5], DEFINED = [N1, N2, [0, 0], [220, 0], [220, 120], [0, 120], [110, 60]];
const WANT = Math.hypot(N2[0] - N1[0], N2[1] - N1[1]);
const RECT = {left: 17, top: 43, width: 900, height: 600};
const V0 = fitBox(BOX, RECT.width/RECT.height);

/* click exactly where each notch is painted, snap, measure — returns the worst error */
function roundTrip(views, rects){
  let worst = 0;
  for(const v of views) for(const r of rects){
    const hits = [N1, N2].map(n => {
      const [cx, cy] = paintedAt(v, r, n[0], n[1]);
      const h = nearestPoint(DEFINED, worldAt(v, r, cx, cy), 1e-6);
      if(!h) throw new Error(`bấm vào notch ${n} nhưng không bắt được nó`);
      return h.point;
    });
    worst = Math.max(worst, Math.abs(straight(point(...hits[0]), point(...hits[1])).distance - WANT));
  }
  return worst;
}

mcase({id: "TRF-01", group: G, kind: "N", what: "zoom ×0.1 · ×0.5 · ×2 · ×10: lệch số đo lớn nhất", expect: 0, tol: 1e-9,
       source: "đặc tả SVG"}, () => roundTrip([0.1, 0.5, 2, 10].map(k => zoomAt(V0, 0.3, 0.6, k)), [RECT]));
mcase({id: "TRF-02", group: G, kind: "N", what: "pan ba hướng: lệch số đo lớn nhất", expect: 0, tol: 1e-9,
       source: "đặc tả SVG"}, () => roundTrip([[-500, 0], [0, 750], [123.4, -56.7]].map(([dx, dy]) => ({...V0, x: V0.x + dx, y: V0.y + dy})), [RECT]));
mcase({id: "TRF-03", group: G, kind: "N", what: "đổi kích thước khung (1200×600 · 900×900 · 450×800): lệch số đo", expect: 0, tol: 1e-9,
       source: "đặc tả SVG: meet"}, () => roundTrip([V0], [{left: 0, top: 0, width: 1200, height: 600},
                                                       {left: 5, top: 5, width: 900, height: 900},
                                                       {left: 0, top: 60, width: 450, height: 800}]));
mcase({id: "TRF-04", group: G, kind: "N", what: "px/mm sau khi đổi khung = tỉ lệ SVG thật sự vẽ", expect: [1200, 900, 450].map((w, i) =>
         paintedScale(V0, [{width: 1200, height: 600}, {width: 900, height: 900}, {width: 450, height: 800}][i])), tol: 1e-12,
       source: "đặc tả SVG: min(W/vw, H/vh)"}, () =>
  [{width: 1200, height: 600}, {width: 900, height: 900}, {width: 450, height: 800}].map(r => ppmOf(V0, {left: 0, top: 0, ...r})));
mcase({id: "TRF-05", group: G, kind: "B", what: "zoom cực hạn (kẹp 2 mm · 1e6 mm): điểm dưới con trỏ đứng yên", expect: [0, 0], tol: 1e-9,
       source: "định nghĩa zoomAt"}, () => {
  const cx = RECT.left + RECT.width*0.25, cy = RECT.top + RECT.height*0.75, before = worldAt(V0, RECT, cx, cy);
  return [1e-9, 1e9].map(k => { const w = worldAt(zoomAt(V0, 0.25, 0.75, k), RECT, cx, cy); return Math.hypot(w[0] - before[0], w[1] - before[1]); });
});
mcase({id: "TRF-06", group: G, kind: "B", what: "bấm lệch 5 px ở zoom ×1 và ×4 → cùng bắt notch, cùng số đo", expect: [WANT, WANT], tol: 1e-9,
       source: "point_to_point.md P7: bán kính 12 px"}, () => [1, 0.25].map(k => {
  const v = zoomAt(V0, 0.5, 0.5, k), tol = 12/ppmOf(v, RECT);
  const hits = [N1, N2].map(n => { const [cx, cy] = paintedAt(v, RECT, n[0], n[1]);
                                   return nearestPoint(DEFINED, worldAt(v, RECT, cx + 3, cy + 4), tol).point; });
  return straight(point(...hits[0]), point(...hits[1])).distance;
}));
mcase({id: "TRF-13", group: G, kind: "I", what: "khung rộng 0 px → báo lỗi, không trả NaN/∞", expect: {throws: /không hợp lệ/},
       source: "spec A7"}, () => worldAt(V0, {left: 0, top: 0, width: 0, height: 0}, 10, 10));
mcase({id: "TRF-14", group: G, kind: "I", what: "hệ số zoom NaN → view giữ nguyên, không hỏng", expect: true,
       source: "spec A7"}, () => { const v = zoomAt(V0, 0.5, 0.5, NaN); return v.x === V0.x && v.y === V0.y && v.w === V0.w && v.h === V0.h; });
