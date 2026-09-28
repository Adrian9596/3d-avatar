# src/ — how the viewer is put together

*The 2D tab of the 3d-avatar site (`pattern2d/`). Rules: `pattern2d/CLAUDE.md`; how it opens and talks to the
host page: `features/dxf/open.md`.*

One rule decides where code goes: **a feature owns its UI, its logic, its CSS and its test.**
`shared/` holds only what two or more features genuinely need. There is no `utils/`.

```
src/
├── app/            composition root — shell markup, shell CSS, mount order, shared state
├── shared/         theme tokens · DOM helpers (keys · nudge · download) · plane geometry · display units +
│                   angles   (nothing feature-specific)
└── features/
    ├── dxf/        read a DXF: layer vocabulary, decoder, units, parser, model (exact shapes), file picker, the
    │               empty start and a file sent by the host page (open.md) — and write one back (write.js: AAMA,
    │               METRIC, a NEW file)
    ├── canvas/     view box, render loop, pointer, status bar
    ├── readout/    the panel features write their numbers into
    ├── layers/     layer visibility + legend
    ├── pieces/     piece list, thumbnails, selection, hit test, how a piece is drawn; remove.js: a piece deleted for good (remove.md)
    ├── edges/      split an outline into edges and label their lengths — the sewing line when there is one, else the cut
    │               line, and it says which (edges.md)
    ├── measure/    two-point distance: Straight (AccuMark) or along the pattern line
    ├── arrange/    align · distribute · lay out · drag with snapping · undo
    ├── simplify/   drop redundant vertices, keep the meaningful ones, never overwrite
    ├── edit/       Edit in 4 layers: select · direct · precise · constraint — exports a new DXF (edit.md)
    ├── draw/       Vẽ: Line · Curve · Rect · Circle · Polygon at real size — snap, numbers, relations — and a NEW
    │               PIECE with the pen (turn / curve points, notches, name · qty); drives geometry/sketch.js;
    │               shapes and pieces go out with Xuất DXF (draw.md · piece.md). flow.js · piece.js · out.js are
    │               its pure rules, draw.js the controller of the drawing, pieces.js of the pieces drawn
    │               (bound to draw.js's state), dock.js · paint.js what it shows
    ├── geometry/   Point/Line/Arc/Curve · quan hệ phụ thuộc · solver · trim/extend/offset/measure
    └── export/     the piece table as TSV
```

## The contract between features

Features never import `app/`. They receive the same `ctx` at `mount(ctx, ui)`:

| `ctx` | |
|---|---|
| `model` `fileName` `counts` | the loaded DXF |
| `layersOn` `selection` `primary` | shared view state |
| `unit` `setUnit(u)` `onUnit(fn)` | the display unit — inch · cm · mm, default inch (`shared/units.md`); changes how numbers are written, never geometry |
| `len(mm, d, label)` `shownUnit()` | every length a feature shows goes through `len`; `shownUnit()` is `null` when the file declared no unit (then nothing is converted) |
| `snap` `snapTol()` | the snap tolerance, a distance in the drawing held in mm (`shared/units.md` §3): 0.02 in for an inch file, 0.5 mm for a mm file, reset on every load, editable in the status bar. Tools ask `snapTol()`, which is `null` when the file declared no unit — then nothing snaps. Never a pixel count |
| `pieces()` | the piece array (empty when nothing is loaded) |
| `draw()` `refresh()` | redraw the canvas · re-render the piece list and redraw |
| `select(indices, primary)` `load(text, name)` | |
| `onLoad(fn)` `key(char, fn)` | hooks: run after every load · bind a shortcut |
| `onEdit(fn)` `edited(i)` | Edit changed piece `i`: a feature holding something worked out from it (an Along measurement, a Geom document, a Simplify result) drops it |
| `removePieces(indices)` `restorePieces(rec)` `onPieces(fn)` | pieces deleted for good and put back by ⌘Z (pieces/remove.md): the model loses them, the selection goes, `fn(ctx, {kind, rec})` hears of it. **What keeps a piece over time keeps the piece object, never its index** (R5) — an index names another piece after a delete |
| `onExport(fn)` `exportModel()` | what Xuất DXF writes, whichever tool's button: `exportModel()` is the open model passed through every `onExport` hook in mount order. A hook returns a NEW model (Vẽ adds its shapes, `draw/draw.md` V13) — the open model is never changed |

`ui` is the shell: `{bar, rail, stage, tools, status, svg}`. A feature appends its own
controls — that is why the toolbar reads in mount order.

Canvas is the only feature others build on:

- `Canvas.toolButton(ui, {id, label, title, tool}, ctx)` — the toolbar button of a tool (pressed while it is on);
  `PICK_PX` · `DRAG_PX` and `Canvas.pickMM()` · `Canvas.dragged(w0, w)` — how near a click must be to take a handle,
  how far a press must travel to be a drag, in px whatever the zoom (units.md S5).
- `Canvas.layer(fn)` — `fn(root, ppm, ctx)` draws one layer of every frame, in mount order.
- `Canvas.tool(name, {cursor, onDown, onMove, onUp, onExit})` — `onDown` returns `true` to claim
  the drag; anything it does not claim is a pan, which is why panning works in every mode.
- `Canvas.afterDraw(fn)` · `Canvas.status(key, text)` · `Canvas.zoomTo(box)` · `Canvas.pxPerMM()`.
- `Readout.section(fn)` — return `{title, rows}` to own the panel heading, `{section, rows, total}`
  to append a block, or `null` to stay quiet. `noteRow(note)` is a tool's last word as the last row;
  `headed(block, ctx.selection.size > 0)` makes a tool's block the heading when nothing is selected — else nobody
  holds the panel and the block shows nowhere (Measure · Edit · Vẽ).

`shared/` holds what several features use the same way: `isTyping(ev)` (a key typed into a box is text),
`arrowStep(ev)` (the 1 mm / ⇧ 10 mm nudge of Arrange · Edit · Vẽ), `onEnter`, `downloadText` (Xuất DXF),
`parseAngle` next to `parseLength`.

## geometry/ — ba lớp, đọc từ dưới lên

| File | Lớp | Việc |
|---|---|---|
| `model.js` · `intersect.js` | 1 · Geometry Model | Point · Line · Arc · Curve · Spline, toạ độ mm, t theo chiều dài cung; cổng `checkPoint`/`checkShape`; giao điểm từng cặp |
| `spline.js` | 1 · NURBS | SPLINE/Bezier chính xác: de Boor, chiều dài Gauss–Legendre, trim · đảo · biến đổi không xấp xỉ |
| `path.js` | 1 · Along Path | xâu hình rời thành path liên tục (từ chối trùng · phân nhánh · NaN, báo tự cắt), `components` nhóm hình chạm đầu-cuối, đo chiều dài thật từ A tới B — spec: `along_path.md` |
| `straight.js` | 1 · Point-to-Point | khoảng cách thẳng giữa hai điểm + bắt điểm đã định nghĩa — spec: `point_to_point.md` |
| `corners.js` | 1 · Corners | where one edge ends and the next begins — the one definition Edges prints and Edit selects by (spec: `edit/edit.md` §2) |
| `deform.js` | 1 · Deform | corners move → each edge translates or follows by a similarity; Length · Angle · Distance targets (spec: `edit/edit.md` §3–§4) |
| `anchor.js` | 1 · Anchors | how a point rides on its line: foot rule, seam corners (a tip in a narrow V held by both sides), a line's end kept on the boundary (on the part of it it was on, walking back along itself rather than folding), how much of a line runs with the cut line, a line between two edges kept in one piece (spec: `edit/edit.md` §5) |
| `snap.js` | 1 · Snap | một điểm hít vào điểm nào, rồi đường nào, trong dung sai (mm, theo đơn vị bản vẽ); `null` = không snap. Measure · Arrange · Geom dùng chung — spec: `shared/units.md` §3 |
| `simplify.js` | 1 · Simplification | detect · RDP từng khúc giữ mốc · validate deviation/topology — spec: `simplify.md` |
| `ops.js` | 1 · phép biến đổi | move · scale · rotate · offset · trim · extend · measure — thuần tuý, không trạng thái |
| `graph.js` · `rules.js` | 2 · Relationship Engine | đồ thị phụ thuộc (nút nguồn / nút dẫn xuất, cờ bẩn, chặn vòng lặp) + 14 quan hệ |
| `solver.js` | 3 · Geometry Solver | tính lại phần bẩn theo thứ tự tôpô, mỗi nút một lần, lỗi không lan ra cả đồ thị |
| `doc.js` | API | ráp ba lớp: `add` · `derive` · `set` · `setParams` · `trim` · `extend` · `solve` · `snapshot`/`restore` |
| `entity.js` | 1 · Năm loại hình + hai của mảnh | Line · Curve (Bezier bậc 3) · Rectangle · Circle · Polygon tạo từ kích thước thật; hình cứng lưu bằng chính W·H / D / Size·Angle; tay nắm "shape"/"position", kéo, sửa số — và **Path** (đường viền mảnh mới) · **Point** (notch) — spec: `sketch.md` §2, §7 |
| `outline.js` | 1 · Đường viền mảnh | turn point + curve point → đoạn thẳng tuyệt đối giữa hai góc, spline Catmull–Rom centripetal qua các điểm cong (Bezier từng khúc); cạnh giữa hai góc, chu vi, diện tích, lấy mẫu để xuất, một điểm ↔ (cạnh, tỉ lệ trên cạnh) — spec: `sketch.md` §7 |
| `sketch.js` | 2–3 · Phác thảo | hình mới + Horizontal · Vertical · Coincident · Tangent · Equal, **một chiều**, giải theo điểm/kích thước, mỗi thao tác là giao dịch (đo lại mọi quan hệ, gãy thì từ chối cả thao tác); kéo có snap point · line · curve; điểm bám đường viền mảnh đi theo **cạnh** của nó. Tool **Vẽ** (`features/draw/`) gọi nó — spec: `sketch.md` |
| `geometry.js` · `.css` | UI | tool "Geom": dựng quan hệ từ mảnh đang chọn, kéo đỉnh, xem solver chạy |

Quan hệ ở đây **một chiều**: đường may phụ thuộc đường cắt, không có chiều ngược lại.
Ràng buộc hai chiều (song song, tiếp tuyến, khoảng cách cố định) cần solver số — cố tình
để ngoài, vì nó đổi hẳn tính chất: có thể không hội tụ và kết quả khó đoán.

## Build & test

This is the **2D tab** of the 3d-avatar site (`pattern2d/` in the repo; the host page and its tabs are the 3D
app's `src/ui/tabs.mjs`, and the only link between the two is the three messages of `features/dxf/open.md`).

- **Build:** Vite, as part of the repo's `npm run build:pages` — `pattern2d/index.html` is its second entry and
  lands at `dist/pattern2d/index.html`. The page `<link>`s the stylesheets in the old cascade order (shared,
  shell, then the features) and starts `app/main.js`. There is no build_viewer.py and no single-file
  dxf_viewer.html any more, and no sample: the workspace opens empty (`open.md` O1). Served unbuilt (any static
  server over the repo root) it runs as the same plain ES modules.
- **Plain ESM, on purpose:** node runs these modules as they are — the suite and the private real-DXF checkers
  import them. So: `import {a} from "./x.js"` with the extension, no package, no CSS imported from JS, no
  `import.meta.env`, nothing touching the DOM at import time, no cycle. `npm run validate:pattern2d-rules`
  (scripts/test_pattern2d.mjs) checks these, and that features never import `app/`.
- `node pattern2d/tests/run.js` (= `npm run validate:pattern2d`) runs every `*.test.js` next to the code it
  tests; `node pattern2d/tests/run.js <lọc>` chạy riêng một bộ (ví dụ `3380`, `model.3380`, `open`).
- **Private data:** the repo is public and carries no pattern. Tests on the factory 3380 fixture, BLOCK_36C and
  the DXF library read it from `PATTERN2D_DATA` (a local copy of the 2D Pattern workspace, `tests/data.js`).
  Without it they are **skipped and counted** — `790/790 passed, 151 skipped` — never passed; with it every test
  runs (`941/941 passed`), and a missing file is a failure, not a skip.
- Hai phép đo có spec riêng (`features/geometry/along_path.md`, `point_to_point.md`), rút gọn hình học có
  `simplify.md`, tạo hình + quan hệ (`entity.js` · `sketch.js`) có `sketch.md`: each is also checked against real
  DXF by an ezdxf script of the private 2D workspace (check_measure.py, check_simplify.py, check_sketch.py …),
  run locally against this code — never in the public CI (pattern2d/CLAUDE.md §5.18).
- **Measure Engine — bộ test tìm bug** (`features/measure/measure_engine.md`): 210 ca `*.engine.test.js`
  rải cạnh code, 10 nhóm × normal/boundary/invalid, chạy riêng bằng `node pattern2d/tests/run.js engine`
  (10 of them need the library, so 200 run without data). The synthetic DXFs under `tests/fixtures/engine/`
  were written by ezdxf from hand-made shapes (the workspace's make_engine_fixtures.py); their
  `expected.json` here is that half only — the library half stays with the data.
- `dxf/model.js` dựng mỗi path thành `pts` (để vẽ) + `shapes` (hình chính xác để đo) + `snap` (điểm
  được bắt); ai dời mảnh phải dời cả ba (`arrange/ops.js translatePiece`).
- Hình học có thêm **ba bộ test trên rập factory thật** (`*.3380.test.js`) đọc từ `tests/fixtures/3380.json`
  of the data folder; expected value lấy từ nguồn ngoài kernel — xem CLAUDE.md §7. Every feature carries one;
  `app/` does not, because it is wiring — what it wires is what the feature tests cover.
