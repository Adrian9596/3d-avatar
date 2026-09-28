/* Measure Engine · Line Path · Arc · Curve (polyline) · Mixed Path · Topology
   (spec: src/features/measure/measure_engine.md §4, §5).

   Expected values: hand geometry (checked once in Python), or a bare loop written here.
   Topology expectations follow the assumptions A1–A4 and A7 of the spec: when the input
   does not describe one unambiguous path, the engine must refuse or flag — never return a
   clean number for a path it had to invent. */
import {mcase} from "../../../tests/engine.js";
import {point, line, arc, curve, length, reverse, split, trimBetween, pointAt} from "./model.js";
import {chain, chainLength, locate, alongPath} from "./path.js";

const P = (x, y) => point(x, y);
const PI = Math.PI, R2 = Math.SQRT2;
const along = (shapes, a, b, opts) => alongPath(chain(shapes), P(a[0], a[1]), P(b[0], b[1]), opts);
const rawLen = pts => { let s = 0; for(let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]); return s; };
const polar = (c, r, deg) => P(c[0] + r*Math.cos(deg*PI/180), c[1] + r*Math.sin(deg*PI/180));

/* ── Line Path ──────────────────────────────────────────────────────────────── */
let G = "Line Path";
const ZIG = [[0, 0], [100, 0], [100, 50], [200, 50], [200, 100], [300, 100]];
const zigLines = () => ZIG.slice(1).map((q, i) => line(P(...ZIG[i]), P(...q)));

mcase({id: "LINE-01", group: G, kind: "N", what: "1 line 5-12-13 (0,0)→(120,50)", expect: 130, tol: 1e-9,
       source: "tay"}, () => chainLength(chain([line(P(0, 0), P(120, 50))])));
mcase({id: "LINE-02", group: G, kind: "N", what: "1 line, A và B nằm giữa (t = 0.2 → 0.8)", expect: 78, tol: 1e-9,
       source: "tay: 0.6 × 130"}, () => along([line(P(0, 0), P(120, 50))], [24, 10], [96, 40]).distance);
mcase({id: "LINE-03", group: G, kind: "N", what: "5 line zigzag: tổng chiều dài", expect: 400, tol: 1e-9,
       source: "tay: 100+50+100+50+100"}, () => chainLength(chain(zigLines())));
mcase({id: "LINE-04", group: G, kind: "N", what: "5 line: A trên line 1 → B trên line 5", expect: 320, tol: 1e-9,
       source: "tay: 60+50+100+50+60"}, () => along(zigLines(), [40, 0], [260, 100]).distance);
mcase({id: "LINE-05", group: G, kind: "N", what: "5 line vẽ ngược + xáo thứ tự: [tổng, A→B]", expect: [400, 320], tol: 1e-9,
       source: "tay"}, () => {
  const l = zigLines().map(reverse);
  const ch = chain([l[3], l[0], l[4], l[2], l[1]]);
  return [ch.total, alongPath(ch, P(40, 0), P(260, 100)).distance];
});
mcase({id: "LINE-06", group: G, kind: "N", what: "đo ngược B→A = A→B", expect: 320, tol: 1e-9,
       source: "tay"}, () => along(zigLines(), [260, 100], [40, 0]).distance);
mcase({id: "LINE-07", group: G, kind: "N", what: "4 line kín: [kín, chu vi, lối ngắn qua góc, lối dài]",
       expect: [true, 400, 20, 380], tol: 1e-9, source: "tay"}, () => {
  const sq = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]];
  const ch = chain(sq.slice(1).map((q, i) => line(P(...sq[i]), P(...q))));
  return [ch.closed, ch.total, alongPath(ch, P(10, 0), P(0, 10)).distance,
          alongPath(ch, P(10, 0), P(0, 10), {direction: "long"}).distance];
});
mcase({id: "LINE-08", group: G, kind: "B", what: "A = B → 0", expect: 0, tol: 0,
       source: "định nghĩa"}, () => along(zigLines(), [150, 50], [150, 50]).distance);
mcase({id: "LINE-09", group: G, kind: "B", what: "A, B đúng tại mối nối (100,0) → (200,50)", expect: 150, tol: 1e-9,
       source: "tay: 50 + 100"}, () => along(zigLines(), [100, 0], [200, 50]).distance);
mcase({id: "LINE-10", group: G, kind: "B", what: "khe đúng bằng tol 0.05 mm → vẫn nối, khe không tính", expect: 200, tol: 1e-9,
       source: "along_path.md S5"}, () =>
  chainLength(chain([line(P(0, 0), P(100, 0)), line(P(100.05, 0), P(200.05, 0))], {tol: 0.05})));
mcase({id: "LINE-11", group: G, kind: "B", what: "bấm lệch 7 mm: [dọc đường, offPath]", expect: [120, 7], tol: 1e-9,
       source: "tay: chiếu vuông góc"}, () => {
  const r = along([line(P(0, 0), P(200, 0))], [40, -7], [160, -7]);
  return [r.distance, r.offPath];
});
mcase({id: "LINE-12", group: G, kind: "B", what: "line dài 0 giữa path bị bỏ, tổng không đổi", expect: 200, tol: 1e-9,
       source: "tay"}, () => chainLength(chain([line(P(0, 0), P(100, 0)), line(P(100, 0), P(100, 0)), line(P(100, 0), P(200, 0))])));
mcase({id: "LINE-13", group: G, kind: "I", what: "không có hình nào → báo lỗi", expect: {throws: /rỗng/},
       source: "along_path.md S5"}, () => chain([]));
mcase({id: "LINE-14", group: G, kind: "I", what: "line có toạ độ NaN → báo lỗi, không lặng lẽ bỏ", expect: {throws: /không hợp lệ/},
       source: "spec A7"}, () => chainLength(chain([line(P(0, 0), P(100, 0)), line(P(100, 0), P(NaN, 0))])));
mcase({id: "LINE-16", group: G, kind: "I", what: "điểm bấm NaN → báo lỗi, không trả NaN", expect: {throws: /điểm/},
       source: "spec A7"}, () => along(zigLines(), [NaN, 0], [260, 100]).distance);

/* ── Arc ────────────────────────────────────────────────────────────────────── */
G = "Arc";
const Q = () => arc(P(0, 0), 100, 0, PI/2, true);

mcase({id: "ARC-01", group: G, kind: "N", what: "90° CCW r = 100: [chiều dài, dọc đầu→cuối]", expect: [50*PI, 50*PI], tol: 1e-9,
       source: "tay: r·θ"}, () => [length(Q()), along([Q()], [100, 0], [0, 100]).distance]);
mcase({id: "ARC-02", group: G, kind: "N", what: "180° r = 50: [chiều dài, đầu → giữa]", expect: [50*PI, 25*PI], tol: 1e-9,
       source: "tay"}, () => {
  const h = arc(P(0, 0), 50, -PI/2, PI/2, true);
  return [length(h), along([h], [0, -50], [50, 0]).distance];
});
mcase({id: "ARC-03", group: G, kind: "N", what: "cung lật chiều: [chiều dài, dọc (0,100)→(100,0)]", expect: [50*PI, 50*PI], tol: 1e-9,
       source: "tay"}, () => [length(reverse(Q())), along([reverse(Q())], [0, 100], [100, 0]).distance]);
mcase({id: "ARC-04", group: G, kind: "N", what: "CW π/2 → 0: [chiều dài, x, y tại t = 0.5]",
       expect: [50*PI, 100/R2, 100/R2], tol: 1e-9, source: "tay: 45°"}, () => {
  const cw = arc(P(0, 0), 100, PI/2, 0, false), m = pointAt(cw, 0.5);
  return [length(cw), m.x, m.y];
});
mcase({id: "ARC-05", group: G, kind: "N", what: "cùng a0 = 0, a1 = π/2: [CCW, CW]", expect: [50*PI, 150*PI], tol: 1e-9,
       source: "tay: CW đi vòng 270°"}, () => [length(arc(P(0, 0), 100, 0, PI/2, true)), length(arc(P(0, 0), 100, 0, PI/2, false))]);
mcase({id: "ARC-06", group: G, kind: "N", what: "trong lòng cung r = 80: 30° → 75°", expect: 20*PI, tol: 1e-9,
       source: "tay: 80·45°"}, () => {
  const a = arc(P(0, 0), 80, 0, PI, true);
  return alongPath(chain([a]), polar([0, 0], 80, 30), polar([0, 0], 80, 75)).distance;
});
mcase({id: "ARC-07", group: G, kind: "N", what: "CCW qua ±180° (170° → 190°): [chiều dài, s tại 180°]",
       expect: [100*20*PI/180, 100*10*PI/180], tol: 1e-9, source: "tay"}, () => {
  const a = arc(P(0, 0), 100, 170*PI/180, 190*PI/180, true);
  return [length(a), locate(chain([a]), P(-100, 0)).s];
});
mcase({id: "ARC-08", group: G, kind: "B", what: "đường tròn 360° r = 30: [kín, chu vi, lối ngắn 350°→10°]",
       expect: [true, 60*PI, 30*20*PI/180], tol: 1e-9, source: "tay"}, () => {
  const ch = chain([arc(P(0, 0), 30, 0, 2*PI, true)]);
  return [ch.closed, ch.total, alongPath(ch, polar([0, 0], 30, 350), polar([0, 0], 30, 10)).distance];
});
mcase({id: "ARC-09", group: G, kind: "B", what: "cung quét 1e-6 rad, r = 100", expect: 1e-4, tol: 1e-12,
       source: "tay"}, () => length(arc(P(0, 0), 100, 0.3, 0.3 + 1e-6, true)));
mcase({id: "ARC-10", group: G, kind: "B", what: "cắt giữa hai tham số bằng nhau → dài 0 (như line, curve)", expect: [0, 0, 0], tol: 1e-9,
       source: "định nghĩa; ezdxf: start = end → span 0"}, () =>
  [length(trimBetween(Q(), 0.4, 0.4)), length(trimBetween(line(P(0, 0), P(10, 0)), 0.4, 0.4)),
   length(trimBetween(curve([[0, 0], [10, 0], [10, 10]]), 0.4, 0.4))]);
mcase({id: "ARC-11", group: G, kind: "B", what: "split tại t = 0.3: [mảnh 1, tổng hai mảnh]", expect: [0.3*50*PI, 50*PI], tol: 1e-9,
       source: "tay"}, () => { const [a, b] = split(Q(), 0.3); return [length(a), length(a) + length(b)]; });
mcase({id: "ARC-12", group: G, kind: "I", what: "bán kính âm → báo lỗi, không ra chiều dài âm", expect: {throws: /không hợp lệ/},
       source: "spec A7"}, () => chainLength(chain([arc(P(0, 0), -5, 0, 1, true)])));
mcase({id: "ARC-13", group: G, kind: "I", what: "góc NaN → báo lỗi", expect: {throws: /không hợp lệ/},
       source: "spec A7"}, () => chainLength(chain([arc(P(0, 0), 10, NaN, 1, true)])));
mcase({id: "ARC-14", group: G, kind: "B", what: "CW qua ±180° (190° → 170°): [chiều dài, s tại 180°]",
       expect: [100*20*PI/180, 100*10*PI/180], tol: 1e-9, source: "tay"}, () => {
  const a = arc(P(0, 0), 100, 190*PI/180, 170*PI/180, false);
  return [length(a), locate(chain([a]), P(-100, 0)).s];
});

/* ── Curve (polyline) ───────────────────────────────────────────────────────── */
G = "Curve";
const WAVY = [[0, 0], [20, 12], [40, 3], [60, 25], [80, 8], [100, 30], [120, 11], [140, 36], [160, 14], [180, 41], [200, 17], [220, 45]];
mcase({id: "CURVE-01", group: G, kind: "N", what: "polyline 12 đỉnh: tổng = vòng lặp trần", expect: rawLen(WAVY), tol: 1e-9,
       source: "vòng lặp trần"}, () => chainLength(chain([curve(WAVY)])));
mcase({id: "CURVE-02", group: G, kind: "N", what: "polyline lật chiều: cùng số đo giữa hai đỉnh", expect: rawLen(WAVY.slice(2, 9)), tol: 1e-9,
       source: "vòng lặp trần"}, () => alongPath(chain([curve(WAVY.slice().reverse())]), P(...WAVY[2]), P(...WAVY[8])).distance);
mcase({id: "CURVE-03", group: G, kind: "B", what: "A, B cùng nằm trong một đoạn = |AB|", expect: Math.hypot(10, 6), tol: 1e-9,
       source: "tay: nửa đoạn (0,0)→(20,12)"}, () => alongPath(chain([curve(WAVY)]), P(0, 0), P(10, 6)).distance);
mcase({id: "CURVE-04", group: G, kind: "I", what: "polyline chỉ có 1 điểm → báo lỗi", expect: {throws: /rỗng/},
       source: "along_path.md S5"}, () => chain([curve([[5, 5]])]));

/* ── Mixed Path ─────────────────────────────────────────────────────────────── */
G = "Mixed Path";
const ML = () => line(P(0, 0), P(100, 0));
const MA = () => arc(P(100, 50), 50, -PI/2, 0, true);                 // (100,0) → (150,50)
const MC = () => curve([[150, 50], [150, 110], [190, 140]]);          // 60 + 50
const MIX = () => [ML(), MA(), MC()];

mcase({id: "MIX-01", group: G, kind: "N", what: "line + arc + curve: tổng", expect: 210 + 25*PI, tol: 1e-9,
       source: "tay: 100 + 25π + 110"}, () => chainLength(chain(MIX())));
mcase({id: "MIX-02", group: G, kind: "N", what: "xáo thứ tự + lật chiều: tổng", expect: 210 + 25*PI, tol: 1e-9,
       source: "tay"}, () => chainLength(chain([reverse(MC()), ML(), reverse(MA())])));
mcase({id: "MIX-03", group: G, kind: "N", what: "A trên line → B trên curve", expect: 145 + 25*PI, tol: 1e-9,
       source: "tay: 60 + 25π + 60 + 25"}, () => along(MIX(), [40, 0], [170, 125]).distance);
mcase({id: "MIX-04", group: G, kind: "N", what: "sân vận động kín: [kín, chu vi, lối ngắn (50,0)→(50,100)]",
       expect: [true, 400 + 100*PI, 100 + 50*PI], tol: 1e-9, source: "tay"}, () => {
  const ch = chain([line(P(0, 0), P(200, 0)), arc(P(200, 50), 50, -PI/2, PI/2, true),
                    line(P(200, 100), P(0, 100)), arc(P(0, 50), 50, PI/2, 3*PI/2, true)]);
  return [ch.closed, ch.total, alongPath(ch, P(50, 0), P(50, 100)).distance];
});
mcase({id: "MIX-06", group: G, kind: "B", what: "A đúng tại mối nối arc/curve", expect: 85, tol: 1e-9,
       source: "tay: 60 + 25"}, () => along(MIX(), [150, 50], [170, 125]).distance);
mcase({id: "MIX-07", group: G, kind: "B", what: "Σ parts[].length − distance", expect: 0, tol: 1e-9,
       source: "along_path.md S2"}, () => { const r = along(MIX(), [40, 0], [170, 125]); return r.parts.reduce((s, p) => s + p.length, 0) - r.distance; });
mcase({id: "MIX-08", group: G, kind: "B", what: "khúc đo được giữ đúng kiểu từng geometry", expect: "line,arc,curve",
       source: "along_path.md S3"}, () => along(MIX(), [40, 0], [170, 125]).parts.map(p => p.kind).join(","));
mcase({id: "MIX-09", group: G, kind: "I", what: "ring kín xâu chung với line → báo lỗi", expect: {throws: /ring kín/},
       source: "along_path.md"}, () => chain([curve([[0, 0], [10, 0], [10, 10]], true), line(P(10, 10), P(20, 20))]));

/* ── Topology ───────────────────────────────────────────────────────────────── */
G = "Topology";
const FIG8 = [[0, 0], [100, 100], [100, 0], [0, 100]];            // crosses itself at (50, 50)
const lollipop = () => [line(P(0, 0), P(100, 0)), line(P(100, 0), P(200, 0)), curve([[100, 0], [50, 50], [0, 0]])];

mcase({id: "TOPO-01", group: G, kind: "I", what: "khe 0.2 mm > tol → báo đứt đoạn", expect: {throws: /đứt đoạn/},
       source: "along_path.md S5"}, () => chain([line(P(0, 0), P(100, 0)), line(P(100.2, 0), P(200, 0))]));
mcase({id: "TOPO-02", group: G, kind: "B", what: "khe 0.03 mm ≤ tol → nối, tổng = Σ", expect: 200, tol: 1e-9,
       source: "along_path.md S5"}, () => chainLength(chain([line(P(0, 0), P(100, 0)), line(P(100.03, 0), P(200.03, 0))])));
mcase({id: "TOPO-03", group: G, kind: "I", what: "hai ring rời nhau → báo lỗi", expect: {throws: /ring kín/},
       source: "along_path.md"}, () => chain([curve([[0, 0], [10, 0], [10, 10]], true), curve([[50, 0], [60, 0], [60, 10]], true)]));
mcase({id: "TOPO-04", group: G, kind: "I", what: "hai polyline hở cách xa → báo đứt đoạn", expect: {throws: /đứt đoạn/},
       source: "along_path.md S5"}, () => chain([curve([[0, 0], [50, 0]]), curve([[200, 0], [300, 0]])]));
mcase({id: "TOPO-05", group: G, kind: "I", what: "cùng một line hai lần → báo trùng (không ra 2×)", expect: {throws: /trùng/},
       source: "spec A1"}, () => chainLength(chain([line(P(0, 0), P(100, 0)), line(P(0, 0), P(100, 0))])));
mcase({id: "TOPO-06", group: G, kind: "I", what: "line trùng nhưng vẽ ngược chiều → báo trùng", expect: {throws: /trùng/},
       source: "spec A1"}, () => chainLength(chain([line(P(0, 0), P(100, 0)), line(P(100, 0), P(0, 0))])));
mcase({id: "TOPO-07", group: G, kind: "B", what: "đỉnh lặp liền nhau trong polyline → bỏ, tổng không đổi", expect: 250, tol: 1e-9,
       source: "tay: 100 + 50 + 100"}, () => chainLength(chain([curve([[0, 0], [100, 0], [100, 0], [100, 50], [100, 50], [0, 50]])])));
mcase({id: "TOPO-08", group: G, kind: "B", what: "ring lặp đỉnh đầu ở cuối (kiểu 3380) → chu vi đúng", expect: 300, tol: 1e-9,
       source: "tay"}, () => chainLength(chain([curve([[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]], true)])));
mcase({id: "TOPO-09", group: G, kind: "N", what: "hình số 8 tự cắt: tổng theo nét vẽ", expect: rawLen(FIG8), tol: 1e-9,
       source: "vòng lặp trần"}, () => chainLength(chain([curve(FIG8)])));
mcase({id: "TOPO-10", group: G, kind: "N", what: "số 8: A→B đi theo nét, không đi tắt qua chỗ cắt", expect: 100 + 150*R2, tol: 1e-9,
       source: "tay: 75√2 + 100 + 75√2"}, () => along([curve(FIG8)], [25, 25], [25, 75]).distance);
mcase({id: "TOPO-11", group: G, kind: "N", what: "số 8: path báo có 1 chỗ tự cắt", expect: 1,
       source: "spec A3"}, () => chain([curve(FIG8)]).crossings.length);
mcase({id: "TOPO-12", group: G, kind: "N", what: "số 8: chỗ tự cắt ở (50, 50)", expect: [50, 50], tol: 1e-9,
       source: "tay"}, () => { const c = chain([curve(FIG8)]).crossings[0]; return [c.x, c.y]; });
mcase({id: "TOPO-13", group: G, kind: "B", what: "bấm đúng chỗ tự cắt → cờ ambiguous", expect: true,
       source: "spec A3"}, () => along([curve(FIG8)], [50, 50], [0, 100]).ambiguous);
mcase({id: "TOPO-14", group: G, kind: "I", what: "hai line cắt chéo nhau (chữ X) → không tự nối tại chỗ cắt", expect: {throws: /đứt đoạn/},
       source: "spec: không tự nối"}, () => chain([line(P(0, 0), P(100, 100)), line(P(0, 100), P(100, 0))]));
mcase({id: "TOPO-15", group: G, kind: "I", what: "chữ T (đầu line chạm giữa line khác) → không tự nối", expect: {throws: /đứt đoạn/},
       source: "spec: không tự nối"}, () => chain([line(P(0, 0), P(100, 0)), line(P(50, 0), P(50, 80))]));
mcase({id: "TOPO-16", group: G, kind: "I", what: "phân nhánh (3 hình chung một đầu) → báo lỗi", expect: {throws: /phân nhánh/},
       source: "spec A2"}, () => chainLength(chain(lollipop())));
mcase({id: "TOPO-17", group: G, kind: "B", what: "1 polyline hở, đỉnh cuối = đỉnh đầu → ring: [kín, lối ngắn qua mối]",
       expect: [true, 20], tol: 1e-9, source: "spec A4; CBXO172001-DES"}, () => {
  const ch = chain([curve([[0, 0], [100, 0], [100, 60], [0, 60], [0, 0]], false)]);
  return [ch.closed, alongPath(ch, P(0, 10), P(10, 0)).distance];
});
mcase({id: "TOPO-18", group: G, kind: "B", what: "cùng một ring vẽ 1 · 2 · 4 khúc → cùng kín, cùng chu vi",
       expect: [true, true, true, 320, 320, 320], tol: 1e-9, source: "spec A4 + along_path.md S4"}, () => {
  const R = [[0, 0], [100, 0], [100, 60], [0, 60], [0, 0]];
  const one = chain([curve(R)]);
  const two = chain([curve(R.slice(0, 3)), curve(R.slice(2))]);
  const four = chain(R.slice(1).map((q, i) => line(P(...R[i]), P(...q))));
  return [one.closed, two.closed, four.closed, one.total, two.total, four.total];
});
mcase({id: "TOPO-19", group: G, kind: "I", what: "đỉnh NaN trong polyline → báo lỗi, không lặng lẽ bỏ đỉnh", expect: {throws: /không hợp lệ/},
       source: "spec A7"}, () => chainLength(chain([curve([[0, 0], [50, NaN], [100, 0]])])));
mcase({id: "TOPO-20", group: G, kind: "B", what: "ring nơ tự cắt: forward + backward − chu vi", expect: 0, tol: 1e-9,
       source: "along_path.md S6"}, () => {
  const ch = chain([curve([[0, 0], [100, 100], [100, 0], [0, 100]], true)]);
  const r = alongPath(ch, P(25, 25), P(100, 50));
  return r.forward + r.backward - ch.total;
});
