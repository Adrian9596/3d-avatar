/* The view box, as pure arithmetic: no DOM, no state. Millimetres in, millimetres out.
   Y is flipped only when drawing (SVG grows downward, patterns grow upward).

   The SVG paints the view box with preserveAspectRatio="xMidYMid meet": scaled uniformly
   until it fits, then centred. Whenever the element's ratio differs from the view's — every
   window resize, until the next Fit — the drawing is letterboxed. Every conversion below
   inverts THAT transform; a stretched mapping would put a click millimetres away from the
   notch it landed on (measure_engine.md, TRF-03). */

const finite = v => typeof v === "number" && Number.isFinite(v);
function checkView(view, rect){
  if(!view || !(view.w > 0) || !(view.h > 0) || ![view.x, view.y, view.w, view.h].every(finite))
    throw new Error("view không hợp lệ: cần x, y hữu hạn và w, h > 0 (mm)");
  if(!rect || !(rect.width > 0) || !(rect.height > 0) || ![rect.left ?? 0, rect.top ?? 0, rect.width, rect.height].every(finite))
    throw new Error("khung vẽ không hợp lệ: cần rộng và cao > 0 px");
}

/* the box that shows `b` inside a viewport of ratio `ar`, with `pad` slack all round */
export function fitBox(b, ar, pad = 0.12){
  let w = Math.max(b.w, 1)*(1+pad*2), h = Math.max(b.h, 1)*(1+pad*2);
  if(w/h < ar) w = h*ar; else h = w/ar;
  return {x:(b.x0+b.x1)/2 - w/2, y:(b.y0+b.y1)/2 - h/2, w, h};
}

/* zoom by k around a point given in fractions of the view box (0..1 from top-left);
   a factor that is not a positive number leaves the view as it was */
export function zoomAt(view, fx, fy, k){
  if(!(k > 0) || !finite(k) || !finite(fx) || !finite(fy)) return view;
  const nw = Math.min(Math.max(view.w*k, 2), 1e6), nh = nw*(view.h/view.w);
  return {x:view.x + (view.w-nw)*fx, y:view.y + (view.h-nh)*(1-fy), w:nw, h:nh};
}

export function zoomCentre(view, k){
  if(!(k > 0) || !finite(k)) return view;
  const cx = view.x+view.w/2, cy = view.y+view.h/2;
  const w = view.w*k, h = view.h*k;
  return {x:cx-w/2, y:cy-h/2, w, h};
}

/* pixels per millimetre as painted: the smaller of the two fits (that is what "meet" means) */
export function ppmOf(view, rect){
  checkView(view, rect);
  return Math.min(rect.width/view.w, rect.height/view.h);
}

/* where the painted view box starts on screen, and its scale */
function painted(view, rect){
  const s = ppmOf(view, rect);
  return {s, ox: (rect.left ?? 0) + (rect.width - view.w*s)/2, oy: (rect.top ?? 0) + (rect.height - view.h*s)/2};
}

/* client pixel -> world millimetre, given the element rect */
export function worldAt(view, rect, clientX, clientY){
  if(!finite(clientX) || !finite(clientY)) throw new Error("toạ độ con trỏ không hợp lệ");
  const {s, ox, oy} = painted(view, rect);
  return [view.x + (clientX - ox)/s, (view.y + view.h) - (clientY - oy)/s];
}

/* client pixel -> fractions of the painted view box, the coordinates zoomAt pins */
export function fractionAt(view, rect, clientX, clientY){
  const {s, ox, oy} = painted(view, rect);
  return [(clientX - ox)/(view.w*s), (clientY - oy)/(view.h*s)];
}

/* After a resize: same scale, same centre, and a box that fills the element again —
   the letterbox disappears instead of the drawing jumping. */
export function fillRect(view, rect){
  const s = ppmOf(view, rect), cx = view.x + view.w/2, cy = view.y + view.h/2;
  const w = rect.width/s, h = rect.height/s;
  return {x: cx - w/2, y: cy - h/2, w, h};
}
