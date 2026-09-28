/* Measure Engine · the tool itself — which line Along follows, and what a measurement does
   when the piece under it moves (spec: measure_engine.md §4 A9, §5).

   The pieces here are plain data, the same shape dxf/model.js produces; Arrange moves them
   with the very function the viewer uses (arrange/ops.js translatePiece). Expected values
   are hand geometry on those rectangles. */
import {mcase} from "../../../tests/engine.js";
import * as M from "./measure.js";
import {translatePiece} from "../arrange/ops.js";
import {point} from "../geometry/model.js";
import {straight} from "../geometry/straight.js";
import {alongPath} from "../geometry/path.js";

/* namespace import: the functions this suite asks for may not exist yet — each case that
   needs one fails on its own instead of taking the whole run down */
const {definedPoints, pickPath} = M;
const snapAt = (...a) => M.snapAt(...a), anchor = (...a) => M.anchor(...a);
const resolve = (...a) => M.resolve(...a), trackAt = (...a) => M.trackAt(...a);

const P = (x, y) => point(x, y);
const ON = {"1": true, "4": true, "7": true, "8": true};
function rectPiece(x0 = 0, y0 = 0){
  return {name: "rect", ox: 0, oy: 0, paths: [
    {layer: "1", closed: true,  pts: [[x0, y0], [x0 + 100, y0], [x0 + 100, y0 + 50], [x0, y0 + 50]]},
    {layer: "8", closed: true,  pts: [[x0 + 6, y0 + 6], [x0 + 94, y0 + 6], [x0 + 94, y0 + 44], [x0 + 6, y0 + 44]]},
    {layer: "7", closed: false, pts: [[x0 + 50, y0 + 10], [x0 + 50, y0 + 40]]}
  ], points: [{layer: "4", x: x0 + 30, y: y0}], texts: [],
     bbox: {x0, y0, x1: x0 + 100, y1: y0 + 50, w: 100, h: 50}};
}

/* ── Line Path: which line the Along tool follows ───────────────────────────── */
mcase({id: "LINE-15", group: "Line Path", kind: "B", what: "bấm giữa cạnh dài (không có đỉnh gần) → bám đúng đường cắt", expect: "1",
       source: "tay: điểm bấm cách đường cắt 0.5 mm, cách đường may 5.5 mm"}, () => pickPath([rectPiece()], ON, [50, 0.5]).path.layer);
mcase({id: "LINE-17", group: "Line Path", kind: "B", what: "bấm sát cạnh đường may → bám đường may", expect: "8",
       source: "tay: cách đường may 0.5 mm, đường cắt 5.5 mm"}, () => pickPath([rectPiece()], ON, [50, 5.5]).path.layer);

/* ── Editing: the measurement after the piece under it moves ────────────────── */
const G = "Editing";
mcase({id: "EDIT-V1", group: G, kind: "B", what: "điểm bắt được là GIÁ TRỊ, không đổi khi mảnh bị dời sau đó", expect: [100, 0], tol: 0,
       source: "model.js: kết quả là object bất biến"}, () => {
  const pc = rectPiece(), v = definedPoints([pc], ON).find(q => q[0] === 100 && q[1] === 0);
  translatePiece(pc, 10, 0);
  return v;
});
mcase({id: "EDIT-V2", group: G, kind: "N", what: "dời mảnh (25, 40): đầu đo theo mảnh [Straight, Ax, Ay]", expect: [70, 125, 40], tol: 1e-9,
       source: "tay: dời cứng không đổi khoảng cách"}, () => {
  const pcs = [rectPiece()];
  const a = anchor(snapAt(pcs, ON, [99, 1], 3), pcs), b = anchor(snapAt(pcs, ON, [31, 1], 3), pcs);
  translatePiece(pcs[0], 25, 40);
  const A = resolve(a, pcs), B = resolve(b, pcs);
  return [straight(P(...A), P(...B)).distance, A[0], A[1]];
});
mcase({id: "EDIT-V3", group: G, kind: "N", what: "đo chéo hai mảnh, dời mảnh 2 lên 40 mm", expect: Math.hypot(300, 40), tol: 1e-9,
       source: "tay"}, () => {
  const pcs = [rectPiece(), rectPiece(300, 0)];
  const a = anchor(snapAt(pcs, ON, [1, 1], 3), pcs), b = anchor(snapAt(pcs, ON, [301, 1], 3), pcs);
  translatePiece(pcs[1], 0, 40);
  return straight(P(...resolve(a, pcs)), P(...resolve(b, pcs))).distance;
});
mcase({id: "EDIT-V4", group: G, kind: "N", what: "Along sau khi dời mảnh: [trước, sau]", expect: [20, 20], tol: 1e-9,
       source: "tay: (0,10) → góc → (10,0)"}, () => {
  const pcs = [rectPiece()];
  const t = trackAt(pcs, ON, [0, 10]);
  const a = anchor({point: [0, 10], piece: t.piece}, pcs), b = anchor({point: [10, 0], piece: t.piece}, pcs);
  const before = alongPath(t.chain, P(...resolve(a, pcs)), P(...resolve(b, pcs))).distance;
  translatePiece(pcs[0], 33, -12);
  const t2 = trackAt(pcs, ON, resolve(a, pcs));
  return [before, alongPath(t2.chain, P(...resolve(a, pcs)), P(...resolve(b, pcs))).distance];
});
mcase({id: "EDIT-V5", group: G, kind: "N", what: "undo (dời ngược lại) → đầu đo về đúng chỗ cũ", expect: [100, 0], tol: 0,
       source: "tay"}, () => {
  const pcs = [rectPiece()], a = anchor(snapAt(pcs, ON, [99, 1], 3), pcs);
  translatePiece(pcs[0], 25, 40); translatePiece(pcs[0], -25, -40);
  return resolve(a, pcs);
});
mcase({id: "EDIT-V6", group: G, kind: "I", what: "mảnh của đầu đo không còn (nạp file khác) → không đo", expect: null,
       source: "spec: không đo sai"}, () => {
  const pcs = [rectPiece()], a = anchor(snapAt(pcs, ON, [99, 1], 3), pcs);
  return resolve(a, []);
});
mcase({id: "EDIT-V7", group: G, kind: "B", what: "điểm tự do (không bắt gì) đứng yên khi mảnh dời", expect: [250, 250], tol: 0,
       source: "spec A9"}, () => {
  const pcs = [rectPiece()], a = anchor(snapAt(pcs, ON, [250, 250], 3), pcs);
  translatePiece(pcs[0], 25, 40);
  return resolve(a, pcs);
});
