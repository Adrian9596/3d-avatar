/* Lớp 2b — thư viện quan hệ: một nút dẫn xuất có thể là những gì.

   Mỗi rule khai báo số đầu vào, hàm tính, và một câu tiếng Việt để UI hiển thị.
   Quan hệ ở đây là MỘT CHIỀU: đường may phụ thuộc đường cắt, không có chiều ngược
   lại. Ràng buộc hai chiều (song song, tiếp tuyến, khoảng cách cố định) cần solver
   số — cố tình để ngoài, xem src/features/geometry/README hoặc CLAUDE.md §13. */
import {point, line, curve, pointAt, normalAt, closestPoint, transform, matrix} from "./model.js";
import {intersect} from "./intersect.js";
import {offset, trim, extend, move, scale} from "./ops.js";
import {hostOf, placeAnchor, followPlace, reachEnds} from "./anchor.js";

const need = (v, msg) => { if(v === null || v === undefined) throw new Error(msg); return v; };
/* describe(params, L) writes lengths through L(mm, d, label) — the viewer hands in its display
   unit; left alone, the kernel speaks its own unit, mm */
const MM = (v, d = 1, label = true) => label ? `${v} mm` : String(v);

export const RULES = {
  lineBetween: {
    arity: 2,
    describe: () => "nối hai điểm",
    compute: ([a, b]) => line(point(a.x, a.y), point(b.x, b.y))
  },
  pointOn: {
    arity: 1,
    describe: p => `tại ${(p.t*100).toFixed(0)}% cạnh`,
    compute: ([s], p) => pointAt(s, p.t ?? 0.5)
  },
  midpoint: {
    arity: 1,
    describe: () => "trung điểm",
    compute: ([s]) => pointAt(s, 0.5)
  },
  endpoint: {
    arity: 1,
    describe: p => `đầu ${p.which === "start" ? "trước" : "sau"}`,
    compute: ([s], p) => pointAt(s, p.which === "start" ? 0 : 1)
  },
  intersection: {
    arity: 2,
    describe: p => `giao điểm${p.index ? " " + (p.index+1) : ""}`,
    compute: ([a, b], p) => {
      const hits = intersect(a, b);
      return point(need(hits[p.index || 0], "hai hình không cắt nhau").x, hits[p.index || 0].y);
    }
  },
  offset: {
    arity: 1,
    describe: (p, L = MM) => `lùi ${L(p.d)}${p.side === "in" ? " vào trong" : p.side === "out" ? " ra ngoài" : ""}`,
    compute: ([s], p) => need(offset(s, p.d, {side: p.side}), "offset làm hình biến mất")
  },
  perpendicular: {
    arity: 1,
    describe: (p, L = MM) => `⟂ ${(p.t*100).toFixed(0)}%, ${L(p.len)}`,
    compute: ([s], p) => {
      const q = pointAt(s, p.t ?? 0.5), n = normalAt(s, p.t ?? 0.5), k = p.side === "out" ? -1 : 1;
      return line(q, point(q.x + n.x*p.len*k, q.y + n.y*p.len*k));
    }
  },
  mirror: {
    arity: 2,
    describe: () => "gương qua trục",
    compute: ([s, axis]) => {
      const d = {x: axis.b.x - axis.a.x, y: axis.b.y - axis.a.y};
      const L = Math.hypot(d.x, d.y) || 1, ux = d.x/L, uy = d.y/L;
      const a = ux*ux - uy*uy, b = 2*ux*uy;                       /* ma trận phản chiếu */
      const ox = axis.a.x, oy = axis.a.y;
      const m = matrix(a, b, b, -a, ox - a*ox - b*oy, oy - b*ox + a*oy);
      return transform(s, m);
    }
  },
  extendTo: {
    arity: 2,
    describe: p => `tới biên (${p.end === "start" ? "trước" : "sau"})`,
    compute: ([s, boundary], p) => extend(s, [boundary], p.end || "end")
  },
  trimTo: {
    arity: 2,
    describe: () => "cắt trong biên",
    compute: ([s, boundary], p) => {
      const r = trim(s, [boundary], point(p.at?.[0] ?? 0, p.at?.[1] ?? 0));
      return need(r.kept[0], "trim không còn lại gì");
    }
  },
  moved: {
    arity: 1,
    describe: (p, L = MM) => `dời ${L(p.dx || 0, 1, false)}, ${L(p.dy || 0)}`,
    compute: ([s], p) => move(s, p.dx || 0, p.dy || 0)
  },
  scaled: {
    arity: 1,
    describe: p => `phóng ×${p.k}`,
    compute: ([s], p) => scale(s, p.k, point(p.ox || 0, p.oy || 0))
  },
  curveThrough: {
    arity: "n",
    describe: p => `gấp khúc qua điểm${p.closed ? ", kín" : ""}`,
    compute: (pts, p) => curve(pts.map(q => [q.x, q.y]), !!p.closed)
  },
  projectOn: {
    arity: 2,
    describe: () => "chiếu vuông góc",
    compute: ([p, s]) => closestPoint(s, p).point
  },

  /* The three relations Edit reads off a piece (edit/edit.md §5, anchor.js). `follow` keeps the
     vertex count of the seam line it was built from, on purpose: points anchored on the seam
     (BLOCK_36C puts its turn and curve points there) address its segments by index, and a
     dedupe in the middle of a drag would move every one of them to the wrong segment. */
  follow: {
    arity: "n",
    describe: () => "bám đường cắt, giữ khoảng lùi từng chỗ",
    compute: (hosts, p) => {
      const pts = followPlace(hosts.map(hostOf), p.anchors);
      if(!pts.every(q => Number.isFinite(q[0]) && Number.isFinite(q[1]))) throw new Error("đường may ra toạ độ không hợp lệ");
      return {kind: "curve", pts, closed: !!p.closed};
    }
  },
  attach: {
    arity: "n",
    describe: () => "bám đường",
    compute: (hosts, p) => { const q = placeAnchor(hosts.map(hostOf), p.anchor); return point(q[0], q[1]); }
  },
  reach: {
    arity: "n",
    describe: p => `chạm biên (${(p.ends || []).map(e => e.end === "start" ? "đầu" : "cuối").join(", ")})`,
    compute: ([s, ...boundary], p) => reachEnds(s, boundary, p)
  }
};

export const ruleNames = () => Object.keys(RULES);
