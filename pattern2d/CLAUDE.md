# CLAUDE.md — `pattern2d/` (tab 2D · Pattern Plotter)

> Quy tắc, quyết định và bẫy đã biết của code 2D trong repo 3d-avatar — để phiên sau không dò lại từ đầu.
> **TD** = technical designer, chủ project (một vai trò). **Từ 2026-09-28 đây là nhà của code 2D**; workspace riêng
> "2D Pattern" (máy của TD, không phải git) giữ pipeline block, thư viện DXF factory, fixture 3380, `BLOCK_36C.dxf` và
> các checker ezdxf (§11). Cập nhật lần cuối: 2026-09-28.

**Số mục giữ như bản gốc** (§0–§12, §5 mục 1–18): ~45 comment và spec trích "CLAUDE.md §5.2 / §5.9 / §5.10 / §5.13 /
§5.16 / §5.17 / §6 / §7 / §8 / §12" — nay trỏ vào file này. Mục chỉ của pipeline để lại dòng giữ chỗ.
- **"INTENT §4.1–4.3"** trong code = **§6**; **"INTENT §8"** = **§8** (bản xuất là bản sửa tay; không gì ghi vào
  `spec/pattern_spec.json`). `INTENT.md` ở workspace riêng.
- **Tham chiếu cũ đã biết:** `src/features/geometry/rules.js:6` trỏ "src/features/geometry/README hoặc CLAUDE.md §13" —
  cả hai không tồn tại; ý là quan hệ một chiều, không solver số (§8 dòng đầu; phần geometry của `src/README.md`).

---

## 0. Đọc theo thứ tự này trước khi động vào bất cứ thứ gì

1. File này.
2. `src/README.md` — cây feature, hợp đồng `ctx`, hook, bảng geometry (trước khi thêm hay dời file).
3. Spec `.md` cạnh code sắp sửa (§2) — spec là requirement (§5.15).
4. `src/features/dxf/open.md` — khởi động, mở file, cầu nối host.
5. `../CLAUDE.md` (root) — chỉ cho trang host, tab, build Pages, CI, luật chung của repo.

**Ưu tiên khi mâu thuẫn:** lời TD / spec > file này > code > suy đoán; trái spec → **dừng, hỏi TD**. STATUS, INTENT,
Action Log, `reference_shapes.md`, `METHOD.md` ở workspace riêng — không cần ở đây.

---

## 1. Project trong 30 giây

- **Xem · đo · sửa · vẽ** rập DXF trên mặt phẳng; **xuất một file mới** `<tên>_edit.dxf`, không bao giờ ghi đè.
- **Tab 2D** của site: `2D · 3D`, 3D mở mặc định, `#2d` / `#3d` chọn tab; app riêng trong iframe cùng origin (host:
  `src/ui/tabs.mjs` ở root); cũng chạy một mình ở `/pattern2d/`.
- **Mở ra trống** (O1). DXF vào bằng Open DXF / kéo thả, hoặc từ tab 3D (**Open in 2D**, thả `.dxf` lên trang host) qua
  ba message (§7). Không file nào nó xuất là deliverable (§8). Ngoài phạm vi: §5.11.
- Tool · phím: Layers · mảnh · bảng số `P` · Fit `F` · Geom `G` · Edges `E` · Straight `M` · Along `L` · Copy (TSV) ·
  Arrange `A` · Simplify `S` · Edit `D` (`T X K J`) · Vẽ `V` (`1–5`, Mảnh `6`, Notch `7`) · Delete · `U` in/cm/mm · Xuất DXF.

---

## 2. Bản đồ file (đúng trong repo)

```
pattern2d/
├── CLAUDE.md · README.md   luật (file này) · giới thiệu (tiếng Anh)
├── index.html              entry thứ hai của Vite: shell, 11 <link> CSS theo cascade cũ, src/app/main.js; không doctype (§7)
├── src/  README.md ★ kiến trúc · app/ (app.js composition root + thứ tự mount + window.PP · main.js entry · app.css) ·
│         shared/ (theme.css dom.js geom.js units.js + units.md) · features/ (dxf canvas readout layers pieces edges
│         measure arrange simplify edit draw geometry export — mỗi cái giữ UI, logic, CSS nếu có, test, spec nếu có)
└── tests/  run.js · harness.js · data.js · engine.js · engine_fixtures.js · fixture3380.js · controller_fixture.js ·
            edit_fixtures.js · dom_fixture.js (mới) · fixtures/engine/ (14 DXF tổng hợp ezdxf + expected.json CHỈ nửa tổng hợp)
```

**Không có trong repo, cố ý** (công khai — chỉ code): fixture 3380 + DXF gốc, `cad_corpus.json`, nửa `lib` của
`expected.json`, `output/` (cả `BLOCK_36C.dxf`), `DXF file/`, `input/`, `spec/`, `scripts/*.py`, `dxf_viewer.html`, DXF mẫu.

**Spec:** `shared/units.md` · `dxf/open.md` · `geometry/` `along_path.md` `point_to_point.md` `simplify.md` `sketch.md` ·
`measure/measure_engine.md` · `edges/edges.md` · `edit/edit.md` · `draw/draw.md` `piece.md` · `pieces/remove.md`.

**Thứ spec/code trích mà nằm ngoài repo** — tất cả ở workspace riêng:

| Được trích | Ghi chú |
|---|---|
| `check_*.py` (measure · simplify · edit · trim_extend · sketch · edges · engine), `cad_corpus.py`, `test_cad_gate.py` | `scripts/`; chạy trên code này theo §5.18 |
| `make_engine_fixtures.py` · `make_fixture.py` · `scan_library.py` | sinh fixture engine, `3380.json`; quét thư viện |
| `output/*.md` (measure_cad_check · simplify_report · measure_engine_report · edit_check · sketch_check · edges_check) | cột "CAD tay" / "CAD Ref" của TD ở bản workspace |
| `output/BLOCK_36C.dxf` · `measure_arc_ref.dxf` · `tests/fixtures/3380.json` · `DXF file/` · nửa `lib` | test đọc qua `PATTERN2D_DATA` |
| `input/research/*.md` (piece_ops · delete_line · seam_allowance · text_angle · grading) | chưa phải requirement; không chép vào repo |
| `reference_shapes.md` · `METHOD.md` · `validation_report.md` · dict `P` · `pattern_spec.json` · `INTENT.md` | pipeline block; app này không đọc, không ghi |
| `STATUS.md` · `status.py` · `check_docs.py` · `build_viewer.py` · `QA_*.md` · `qa/2026-09-2x/` | quản lý workspace; `status.py` đọc "N/N passed" |

---

## 3. Lệnh (từ root repo)

```bash
node pattern2d/tests/run.js [lọc]    # = npm run validate:pattern2d; lọc = chuỗi con đường dẫn: 3380 · path · engine · edit/ · sketch · open
PATTERN2D_DATA="<thư mục 2D Pattern>" node pattern2d/tests/run.js    # đủ bộ
npm run validate:pattern2d-rules     # cuối §5; cần qa/avatar_master/flatten-draft.dxf (validate:dxf-roundtrip), thiếu → BLOCKED, exit 2
npm run build:pages · npm run preview:pages · npm run serve:app    # :8765/digital_bra_fit_model_360.html#2d · /pattern2d/index.html
```

---

## 4. File sinh ra — không sửa tay

- `dist/` (có `dist/pattern2d/index.html`) ← `npm run build:pages`; gitignored — sửa nguồn.
- `<tên>_edit.dxf` ← Xuất DXF; không commit (`.gitignore` chặn `pattern2d/**/*.dxf`).
- `tests/fixtures/engine/*` ← `make_engine_fixtures.py` của workspace, sha256 ghim; sinh lại thì tách nửa `lib` ra trước.
- Báo cáo checker ← §5.18, ở thư mục tạm, không bao giờ commit.

> Bẫy đã dính (2026-09-22): một tính năng viết thẳng vào file HTML sinh ra, suýt mất ở lần build sau. Trước khi sửa
> **bất kỳ** file nào, kiểm tra nó có nguồn ở chỗ khác không.

---

## 5. Quy tắc bất di bất dịch

> Mục **14–18** là vòng làm việc — nó quy định *cách* làm mọi thứ còn lại. Mâu thuẫn giữa 1–13 và 14–18 thì 14–18 thắng.

1. *(Pipeline — giữ chỗ.)* Hình học block chỉ sửa qua dict `P` của `draft_block.py` (workspace). Ở đây: file xuất từ
   Edit / Vẽ không bao giờ là nguồn của rập.
2. **Đơn vị:** hình học **lưu mm**, đủ độ chính xác. `dxf/write.js` ghi ≤ **6 chữ số thập phân** (không số mũ, không `-0`)
   — không phải "làm tròn 0.01 mm" của pipeline. File **không khai đơn vị** giữ đơn vị bản vẽ: không quy đổi, ghi "đv?"
   (U9), không snap, không xuất. Hiển thị mặc định **inch**, công tắc in · cm · mm (TD chốt 2026-09-23, `units.md`) —
   **không bao giờ** đổi hình học. 1" = 25.4 mm.
3. **Chưa validate thì chưa xong.** Chạy `node pattern2d/tests/run.js`, dán dòng kết quả; đụng kernel · DXF · Edit · Vẽ ·
   Edges · Measure · Simplify thì thêm lượt có dữ liệu và checker DXF thật (§5.18). FAIL thì nói FAIL, kèm số lệch.
4. **Không tự chốt giả định mở** (§9, danh sách giả định của spec): chạy như mặc định, ghi rõ giả định đang dùng và hệ quả
   nếu TD chốt khác.
5. **Số đo luôn kèm đơn vị + tolerance.** "13.5" ± 3/8"" chứ không phải "13.5".
6. *(Pipeline — giữ chỗ: tolerance trong Excel lưu thành ngày tháng.)*
7. *(Pipeline — giữ chỗ: chart hiệu lực của block 36C.)*
8. **Tên mảnh có thể là tiếng Trung** (杯面, 后比). Đọc DXF: **UTF-8 strict trước, fallback GBK** (`dxf/decode.js`).
9. **Seam matching ≤ 1 mm** cho mọi cặp đường ráp, trừ chỗ cố ý ease (ghi rõ bao nhiêu, ở đâu, vì sao). Tool đổi một đường
   ráp (Simplify, Edit, mảnh mới) phải giữ hoặc báo ra độ lệch đó.
10. **Mọi mảnh phải có grainline + notch + tên mảnh + quantity.** Mảnh mới của Vẽ ra đời có canh sợi, tên, SL; Edit xoá
    canh sợi / notch cuối cùng thì câu báo có ⚠ §5.10.
11. **Không tự ý mở rộng phạm vi** sang grading, tech pack, BOM, marker. `input/research/*.md` chưa phải requirement.
12. **Sửa viewer = sửa trong `pattern2d/src/<feature>/`**, rồi test. Build là Vite; không sửa `dist/`, không dependency
    runtime, không `utils/`, chỉ ESM thuần (§7).
13. **Hình học: input → expected output → test tự động, TRƯỚC khi nối vào Canvas.** Mỗi export trong
    `src/features/geometry/` (trừ `geometry.js` — phần nối vào Canvas) phải được gọi tên trong ít nhất một `*.test.js`
    của thư mục đó — **CI canh** (dòng *§5.13* của `validate:pattern2d-rules`; trước là `check_docs.py`). Expected đến từ
    **nguồn khác kernel**: vòng lặp trần, số đo trong `input/reference_shapes.md` (workspace), đường may nhà máy vẽ sẵn —
    đừng lấy kết quả của kernel làm chuẩn cho kernel.

### Vòng làm việc — 14 đến 18

14. **Requirement → Test → Code → Validate.** Đúng thứ tự đó, không đảo.
    Viết code trước rồi mới nghĩ ra test thì test chỉ đang **mô tả lại code**, không kiểm được
    code — nó xanh vì nó chép, không phải vì code đúng. *Requirement* là yêu cầu viết ra thành
    lời (spec của feature, hoặc câu TD đặt hàng); *Validate* là chạy thật và **dán kết
    quả**, không phải "chắc là chạy được" (§5.3 · §11).
15. **Requirement là nguồn sự thật — không tự diễn giải khác đi.**
    Yêu cầu mơ hồ thì **hỏi TD**, không "hiểu lại cho hợp với thứ đang có". Thấy yêu cầu có vấn
    đề thì nói thẳng bằng một hai câu rồi **vẫn làm đúng yêu cầu**, kèm giả định đang dùng —
    không âm thầm thu hẹp, mở rộng hay đổi phạm vi. Làm xong mà chỉ làm được một phần thì nói rõ
    phần nào chưa làm và vì sao (§5.11 · §9).
16. **Test là bằng chứng — không sửa test để code pass.**
    Test đỏ thì sửa **code**. Muốn sửa test thì phải chứng minh kỳ vọng cũ sai bằng một
    **nguồn ngoài kernel** (vòng lặp trần, số đo nhà máy, `input/reference_shapes.md`), rồi ghi
    lý do vào §12. Nới tolerance cho qua cửa là phá hỏng đúng cái thứ dùng để biết mình đúng —
    từ lúc đó mọi con số PASS đều vô nghĩa.
17. **Geometry Engine là nguồn sự thật — đo bằng world coordinate (mm), không đo bằng Canvas.**
    Mọi con số phải tính trong `src/features/geometry/` ở **mm**, độc lập với zoom · pan · px ·
    kích thước cửa sổ. Canvas chỉ làm hai việc: **vẽ** và **nhận chỗ bấm** (đổi px → mm rồi trả
    lại cho engine). `validate:pattern2d-rules` canh (dòng *§5.17*): kernel chỉ import chính nó và `shared/`, không
    Canvas, không `pxPerMM`.
18. **Đạt = cả hai cùng xanh: test tự động VÀ đối chiếu trên DXF thật.** Test tổng hợp che đúng loại lỗi rập thật lộ ra
    (đã dính ba lần một phiên: offset sai phía · đỉnh lặp trong ring · offset tự cắt, §7).
    - **CI công khai** chỉ chạy nửa không dữ liệu: `790/790 passed, 151 skipped` (86 × `tests/fixtures/3380.json`, 54 ×
      `output/BLOCK_36C.dxf`, 7 × `expected.lib`, 3 + 1 × file thư viện DXF). **Skipped không bao giờ là passed**; CI xanh
      chưa phải "đạt" cho thay đổi đụng kernel, DXF hay tool.
    - **Có dữ liệu:** `PATTERN2D_DATA="<thư mục 2D Pattern>"` → `941/941 passed` (933 cũ + 8 của `open.md`). Đã đặt biến
      thì thiếu file là **FAIL** (ENOENT; sai thư mục thì cả lượt dừng, exit 1), sai sha256 là **FAIL** ("fixture cũ").
    - Đọc dữ liệu **lúc nạp module** là FAIL của cả file (`run.js`), kể cả khi không có dữ liệu — đọc trong test.
    - **Nửa DXF thật** = checker ezdxf của workspace, chạy **trên code này** qua thư mục tạm (dưới); không port vào repo,
      không đưa vào `gates.yml`. Không tự sinh lại manifest / fixture / expected để làm test xanh; thiếu/sai nguồn → FAIL.
    - PR ghi dòng kết quả cả hai lượt test, N/N từng checker, `sources_sha256` của biên nhận — **không** dán báo cáo
      (chúng mang tên file thư viện và hash).

**Cơ chế** (`tests/`): `data.js` — `PATTERN2D_DATA` = gốc workspace, đường dẫn bên trong giữ nguyên; không có biến thì
`dataPath()` ném `NeedsData`, `missing(rel)` là Proxy ném `NeedsData` khi bị chạm. `harness.js` đếm `NeedsData` là
**skipped** (kể cả khi test tự bắt nó), giữ "N/N passed" đầu dòng tổng. `engine.js` `mcase` nhận kỳ vọng dạng **hàm**
(vẫn đọc trước `run()`) và ném lại `NeedsData`. `fixture3380.js` · `engine_fixtures.js` · `controller_fixture.js` đọc qua
`data.js`; thước trọng tài của `fixture3380.js` là code thuần, luôn chạy.

**Chạy checker DXF thật trên code này** (cần ezdxf; mọi thứ ghi ra nằm trong `$T`):

```bash
W="<thư mục 2D Pattern>"; R="<repo>/pattern2d"; T="$(mktemp -d)"     # $T không bao giờ nằm trong repo
cp -R "$W/scripts" "$T/scripts"; mkdir -p "$T/tests" "$T/output"; cp -R "$W/tests/fixtures" "$T/tests/fixtures"
cp "$W/output/BLOCK_36C.dxf" "$W/output/measure_arc_ref.dxf" "$T/output/"
ln -s "$R/src" "$T/src"; for f in "$R"/tests/*.js; do ln -s "$f" "$T/tests/"; done; ln -s "$W/DXF file" "$T/DXF file"
cd "$T" && python3 scripts/check_measure.py && python3 scripts/check_simplify.py && python3 scripts/check_edges.py \
  && python3 scripts/check_sketch.py && python3 scripts/check_edit.py && PATTERN2D_DATA="$W" python3 scripts/check_engine.py
```

Bố cục như bản sao tạm của `test_cad_gate.py`; node đổi symlink về đường thật nên chạy đúng code repo, dữ liệu chỉ từ
`PATTERN2D_DATA`. `check_edit.py` gọi luôn `check_trim_extend.py`. `sources_sha256` băm `src/**/*.js` (trừ test) = code
repo. Lâu nhất: edges ~48 s, sketch ~56 s, edit ~73 s.

**Hợp đồng ổn định với checker** (CI không thấy chỗ gãy): **không đổi tên / dời module, không đổi tên export mà checker
import**; mọi module đó import được bằng node trần, không đụng DOM lúc import. Module: `dxf/` decode · parse · model ·
write — `geometry/` model · path · straight · simplify · deform · corners · sketch · entity — `pieces/remove` · `edit/`
select · ops · relate · edit — `draw/` flow · piece · out — `arrange/ops` · `edges/` segment · edges — `measure/measure` ·
`shared/units` — `tests/run.js` (lọc `engine`, `ENGINE_ROWS`), dòng của `engine.js`, dòng "N/N passed". Tên export cụ
thể: grep `import {…}` và `await import(…)` trong `scripts/check_*.py` của workspace trước khi đổi tên.

### CI canh gì — `npm run validate:pattern2d-rules` (`scripts/test_pattern2d.mjs`)

Chạy trong `gates.yml` sau `validate:pattern2d`, không ghi file bằng chứng. Đủ các dòng:
- **data:** không DXF ngoài fixture engine · không fixture ngoài `tests/fixtures/engine/` · không `output/`, `DXF file/`,
  `input/`, `spec/` · `expected.json` không có nửa thư viện · mỗi fixture đúng byte sha256 ghim, fixture nào cũng được ghim ·
  không file > 128 KB.
- **modules:** chỉ `.js` (không `.mjs`/`.cjs`/`.ts`) · import tương đối resolve được · không import ra ngoài `pattern2d/` ·
  không package (test được dùng `node:`) · feature không import `app/` · app không import `tests/` · không import CSS từ
  JS, không `import.meta.env` · mọi module của app (trừ `app/main.js`, lối vào của trang) nạp được trong node không có
  DOM · không vòng import · `src/` của app 3D không import `pattern2d/`.
- **rules:** §5.13 · §5.17 · feature nào cũng có `*.test.js` · `src/README.md` liệt kê đúng các feature.
- **page:** mỗi stylesheet `<link>` đúng một lần · chạy `src/app/main.js` dạng module · không nhúng mẫu.
- **bridge:** `src/ui/tabs.mjs` và `dxf/import.js` cùng tên ba message · tab 2D frame `pattern2d/index.html` · trang có
  tab, khung 2D, Open in 2D · tab đọc `2D · 3D`, 3D được chọn · `qa/avatar_master/flatten-draft.dxf` (file 3D xuất) mở
  được bằng trình đọc 2D: có mảnh, mm từ chữ AAMA, không cảnh báo.

§5.10, §5.16, §5.18 không máy nào canh — là kỷ luật.

---

## 6. Quy ước DXF

"INTENT §4.1 / §4.2 / §4.3" trong code = ba mục đầu.
- **Header** (text): `Style Name` · `Creation Date/Time` · `Author/PRODUCT/VERSION` · `Sample Size` · `Grade Rule Table` ·
  `Units: METRIC` / `ENGLISH` · `TOLERANCE`. `Units:` là **nguồn đơn vị duy nhất được tin** (CAD nhà máy đọc nó);
  `$INSUNITS` / `$MEASUREMENT` chỉ gợi ý và báo mâu thuẫn (A5, `dxf/units.js`).
- **Khối text mỗi BLOCK:** `Piece Name:` · `SAMPLE SIZE:` · `ANNOTATION:` · `CATEGORY:` · `QUANTITY:`.
- **Layer** (AAMA; số entity của rập 3380 ở INTENT §4.3, `model.3380.test.js` đối chiếu): **1** đường cắt · **2 · 3 · 4 · 5**
  POINT turn · curve · notch · grade (= "điểm trên mảnh") · **7** grainline · **8** *internal lines* + text trong block, nơi
  Richpeace / 3380 / BLOCK_36C đặt đường may · **14** *sew line* (ASTM D6673) khi có đường, chỉ có chữ thì là tên ·
  **13 · 15** annotation / tên mảnh.
- **Đọc:** BLOCK mỗi mảnh + INSERT (scale · xoay · base point); không block thì modelspace. LINE · (LW)POLYLINE (`bulge`)
  · ARC · CIRCLE · SPLINE (NURBS) · POINT · TEXT. Toạ độ đổi sang mm **một lần** trong `buildModel`.
- **Ghi** (`dxf/write.js`, `edit.md` X1–X10): HEADER rỗng · BLOCK mỗi mảnh · INSERT tại 0,0 · `Units: METRIC` · `EDITED:`
  · ARC / CIRCLE / SPLINE / bulge → POLYLINE ≤ 0.01 mm · không ghi vị trí Arrange (X9) · chưa rõ đơn vị thì không xuất ·
  UTF-8 (E10) · mảnh mới `MANH_<n>`, hình riêng `HINH_VE`.
- **Hai phương ngữ, cố ý:** app 3D ghi theo `src/features/pattern/dxf_writer.mjs` + `contracts/dxf-astm-d6673.md` (R12,
  Gerber AccuMark, text hệ thống trên layer 1); writer 2D kiểu Richpeace (text layer 8, UTF-8). Đừng gộp; trình đọc 2D
  **phải** đọc được file của 3D (rules gate).

---

## 7. Viewer "Pattern Plotter" — kiến trúc và quy ước

**Build:** Vite build `index.html` (entry thứ hai của `vite.config.mjs`) ra `dist/pattern2d/index.html`; `app/main.js` gọi
`start()` (tách khỏi `app.js` để test import mà không chạy gì). CSS `<link>` theo cascade cũ: shared, shell, feature.
**Không doctype, cố ý** — luôn chạy quirks mode; doctype đổi chữ bảng readout 16 → 11.5 px, là quyết định trên màn hình
(§9). Không còn `build_viewer.py`, `dxf_viewer.html`, DXF mẫu hay `<script id="sample-dxf">`.

**ESM thuần mà node chạy thẳng** (suite và checker import chính các module): `import {a} from "./x.js"` có đuôi · không
package · không import CSS từ JS · không `import.meta.env` · không đụng DOM lúc import · không vòng import · không `.mjs`
(`package.json` root có `"type": "module"`). **Bẫy của bundle cũ nay hết:** trùng tên export, `export const A = …, B = …`,
`$` trong regex (comment `entity.js:244` còn nhắc — vô hại). Import tên không được export thì Rollup và node đều chặn.
**Còn hở:** dùng một tên mà **quên import** chỉ vỡ lúc chạy tới — bundle cũ bắt được, Vite thì không; test phải đi qua nhánh đó.

### Luật chia code (đọc `src/README.md` trước khi thêm file)
- **Một feature tự chứa UI + logic + CSS + test** (`*.test.js` cạnh code). `shared/` **chỉ** chứa thứ ≥ 2 feature thật sự
  cần. **Không `utils/`.** Feature **không bao giờ import `app/`**; nhận cùng một `ctx` ở `mount(ctx, ui)`.
- Ghép bằng hook, không gọi chéo: `Canvas.layer(fn)` · `Canvas.tool(name, handlers)` (`onDown` trả `true` để giành drag —
  không giành thì là pan) · `Readout.section(fn)` (`{title, rows}` · `{section, rows, total}` · `null`).
- Thứ tự mount trong `app/app.js` quyết định thứ tự nút toolbar **và** thứ tự lớp vẽ.
- Thứ ≥ 2 tool dùng như nhau ở **một chỗ**: `Canvas.toolButton` · `PICK_PX` / `Canvas.pickMM()` · `Canvas.dragged` ·
  `isTyping` · `arrowStep` (1 / ⇧ 10 mm) · `onEnter` · `downloadText` (`shared/dom.js`) · `parseAngle` (`shared/units.js`)
  · `noteRow` · `headed` (`readout.js`). Đừng viết bản riêng.
- **`headed`:** bảng số chỉ hiện khi có provider giữ tiêu đề (Pieces: một mảnh; Arrange: ≥ 2). Tool trả khối số thì bọc
  `headed(khối, ctx.selection.size > 0)` (Measure · Edit · Vẽ).
- `window.PP` là tay cầm debug cố ý (`PP.ctx.pieces()[0].bbox`, `PP.Edit.exportText(PP.ctx)`; `Draw.shapes()` không kèm
  ctx thì dùng `window.PP.ctx`). Biến CSS ở `:root`; comment nói **vì sao**.

### Hệ hình học (`src/features/geometry/`) — ba lớp
1 · **Model** (`model` `spline` `intersect` `ops` `path` `straight` `snap` `simplify` `corners` `deform` `anchor` `entity`
`outline`): hình ở mm, `t` theo chiều dài cung · 2 · **Relationship** (`graph` `rules`): đồ thị phụ thuộc nút nguồn ↔
dẫn xuất, cờ bẩn, chặn vòng · 3 · **Solver** (`solver`; `sketch` cho hình vẽ): tính lại chỉ phần bẩn, tôpô, mỗi nút một
lần; rule gãy → `failed`, nhánh dưới → `blocked` · API `doc.js`. **Sửa nút nguồn, đừng sửa nút dẫn xuất** — `doc.set`
trên nút dẫn xuất ném lỗi (EDIT-11); Undo chỉ chụp nút nguồn.

### Quy ước ai sửa sau phải giữ (chi tiết, bằng chứng ở spec)
- **Độ dài** hiện ra / gõ vào đi qua `ctx.len()` / `lengthField` + `bindLength` — không `fmt(x)+" mm"`, không `parseFloat`
  ô độ dài; readout là hàm thuần nhận formatter `L(mm, d, label)`; UNIT-32 quét mã nguồn tìm `mm`/`cm` tự viết.
- **Snap** = khoảng cách trong bản vẽ (0.02 in / 0.5 mm / không khai: không snap), điểm trước rồi đường; một hàm
  `geometry/snap.js` `snapTo`, dung sai `ctx.snapTol()`. Bán kính **chọn** (px) là chọn, không phải snap.
- **Path** mang `pts` + `shapes` + `snap`; dời mảnh dời cả ba (`translatePiece`, cả `p.cut` / `p.sew` riêng). `chain()`
  ném lỗi khi trùng · phân nhánh · NaN. Along = Straight chỉ trên cạnh thẳng — lẫn hai số là lẫn "mảnh rộng bao nhiêu"
  với "đường ráp dài bao nhiêu".
- **Đường may của mảnh:** vòng kín layer 8 / 14 (`SEW_LAYERS`), trong `SEW_BAND` 30 mm quanh đường cắt, ≥ ½ chu vi cắt,
  dài nhất (`dxf/model.js`). Góc: **một định nghĩa** `geometry/corners.js` cho Edges và Edit.
- **Xoá:** thứ giữ một mảnh qua thời gian (hoàn tác, hình vẽ, phép đo) giữ **object mảnh, không giữ chỉ số** (R5); thứ theo
  chỉ số nghe `ctx.onPieces(fn)` rồi bỏ; `ctx.removePieces` / `restorePieces`.
- **Edit:** quan hệ đọc từ mảnh đầu mỗi thao tác; đường may giữ khoảng lùi từng chỗ (E6, C1 từng bit); `ctx.edited(i)` /
  `onEdit` để Along · Geom · Simplify bỏ kết quả cũ; ⌘Z của Edit bắt ở pha capture, không đụng lịch sử Arrange.
- **Tạo hình / Vẽ:** mỗi thao tác là **một giao dịch** (đo lại mọi quan hệ ≤ 1e-9 mm, gãy thì từ chối cả, R9); hình DXF
  làm chủ không bao giờ bị sửa (R11); snap không tự tạo quan hệ (G7). Vẽ **không có luật hình học riêng** (đi qua
  `entity.js` · `sketch.js`); hình vẽ giữ toạ độ file, hiện ở chỗ Arrange bày mảnh (V12); layer tắt thì không nhặt (V10).
  Xuất DXF của Edit hay Vẽ ra **cùng một file** (`ctx.exportModel()` qua các hook `onExport`); model mở không đổi (V14).
- **Mảnh mới:** cạnh cong = curve point trên đường cong (Catmull–Rom centripetal), góc = turn point; điểm bám viền giữ
  (cạnh, tỉ lệ trên cạnh) (O14); notch cách góc đo dọc đường cắt (`notchPlace`); mỗi mảnh một vùng (V11 `zoneTargets`);
  ghép mảng đích hít bằng `concat`, không `push(...)` (quá nhiều đối số ở file 10 000 spline).
- **Arrange** chỉ để nhìn (§8); mỗi mảnh nhớ `ox/oy`, Reset về toạ độ DXF.

### Cầu nối với trang host (`dxf/open.md`)
O1 mở trống: tiêu đề `—`, stage có **Open DXF** + "hoặc kéo thả file .dxf vào đây", toolbar vẫn bấm được · O2 chưa có file
thì canvas không làm gì (pointer, wheel, − / +) · O3 file host gửi mở như file thả (giữ bytes, File unit về Auto) · O4 chỉ
nhận từ `window.parent`, cùng origin, `type: "pattern2d:open-dxf"`, `file` là File · O5 trong frame báo `pattern2d:ready`
rồi `pattern2d:opened` (name, pieces) sau mỗi file, chỉ tới origin của chính trang; đứng một mình không gửi gì · O6 trong
frame thanh tiêu đề chừa chỗ cho tab host (`html.framed`, `app/app.css`). Host: `src/ui/tabs.mjs`; **hai bên không import
code của nhau**; tên message ở `dxf/import.js` và `tabs.mjs`, CI so. Test: `open.test.js` (7) + `canvas.test.js` (1) trên
`dom_fixture.js`; **O6 chỉ là CSS**, kiểm bằng trình duyệt.

### Bẫy chỉ rập thật mới lộ (đã sửa, mỗi cái có test)
Ring nhà máy quay cùng chiều kim đồng hồ (offset khai `{side}` theo `isCCW`) · ring lặp đỉnh đầu ở cuối · offset tự cắt ở
góc lõm (`prune`) · mốc layer 2 lệch ngoài viền là annotation · tên block GBK · thiếu `Units:` · layer 14 vs 8 · đường cắt
nhiều entity · polyline một đỉnh · đường hở hai đầu trùng · đường chồng mép · góc cắt vát · SA không đều (tính chất của
rập, không phải sai số kernel). Bộ `*.3380.test.js` (`run.js 3380`) đọc toạ độ đóng băng `3380.json` (`make_fixture.py`,
parser riêng); expected từ vòng lặp trần, bảng INTENT §4.3, đường may nhà máy.

### Tính năng (nguyên văn từ workspace — `edges.md` và spec khác trích "CLAUDE.md §7 — …" ở đây)
Bật/tắt layer (kèm legend) · danh sách mảnh có thumbnail · Fit/zoom/pan · **Geom** (dựng quan
hệ trên mảnh đang chọn: đường may = offset đường cắt, notch bám cạnh, grainline kéo tới biên;
kéo một đỉnh — đỉnh hít vào POINT và đường của lớp khác — thì solver cập nhật phần còn lại) ·
**Edges** (tự tách cạnh theo điểm gãy hướng, ghi chiều dài từng cạnh — của đường may hay đường cắt, tiêu đề nói rõ) · **Measure** (2 điểm, snap
vào điểm rồi tới đường) ·
**Along Path** (đo dọc đường rập từ A tới B, tự bám đường gần chỗ bấm, tô khúc đo được,
⇧ lấy lối dài trên đường kín) · **Copy**
(TSV: tên, SL, chất liệu, W, H, cut, sew, X, Y) · **Arrange** (chọn nhiều mảnh bằng click/⇧click/
marquee/⌘A, align 6 hướng, distribute đều khoảng hở, Row/Col/Grid theo `Gap` mm, kéo có snap vào
cạnh & tâm, mũi tên nhích 1 mm (⇧ = 10 mm), ⌘Z undo, Reset) · **Edit** (chọn Point/Line/Curve/Piece, kéo · move ·
trim · extend · split · join — phím T · X · K · J, vật cắt là cả đường được bấm —, Length/Angle/Distance — Length nhận số
gia `+1/4` · `-3mm` —, đường may · notch · grainline tự theo, ⌘Z, **Xuất DXF** mới) · **Vẽ** (Line · Curve ·
Rectangle · Circle · Polygon bằng kích thước thật, snap, nhập số, Ngang · Dọc · Trùng · Tiếp tuyến · Bằng, layer, ⌘Z; hình vẽ đi
theo Xuất DXF; **Mảnh** — bút góc · ⇧ điểm cong, khép (điểm đầu · double-click · Enter) là ra mảnh có canh sợi, tên, SL; **Notch**;
Tên · SL · Vải; Thành mảnh; hình chỉ hít trong mảnh của nó) · **Delete** xoá hẳn mảnh DXF đang chọn (⌘Z đưa lại) · Edit: Delete xoá đường,
POINT — trừ đường cắt.

---

## 8. Quyết định đã chốt — đừng hỏi lại, đừng làm lại

| Quyết định | Ngày |
|---|---|
| Hệ hình học: **graph một chiều**, không constraint solver số | 2026-09-22 |
| Geom là bàn thử quan hệ, Along là thước đo, Simplify chỉ để xem — **không ghi ngược**, không ghi đè; DXF gốc là nguồn rollback | 2026-09-22 |
| Along khoá bằng spec + test + đối chiếu ezdxf trên DXF thật; Point-to-Point = *Straight* của AccuMark (hai điểm, không bám đường) | 2026-09-22 |
| Arrange chỉ để nhìn / so; Xuất DXF **không ghi vị trí Arrange** (X9), dời bằng Edit thì ghi. Snap khi kéo: quan hệ gần nhất trong 9 cặp cạnh/tâm | 2026-09-22 |
| Rập cradle 3380 **đối xứng hoàn toàn** (sai số gương 0.00 mm); bản ghi "lệch 17 mm" trước đó sai (`path.3380.test.js`) | 2026-09-22 |
| Hiển thị mặc định **inch**, in · cm · mm chỉ đổi cách viết số; snap = khoảng cách trong bản vẽ **0.02 in** / **0.5 mm**, không theo zoom (`units.md` §3) | 2026-09-23 |
| Edit **4 lớp** Select · Direct · Precise · **Constraint**; Edit / Vẽ **xuất DXF mới**, không ghi đè — **bản sửa tay, không phải deliverable** (= "INTENT §8") | 2026-09-23 |
| Đường may = **layer 14** (*sew line*, ASTM D6673) **và layer 8** (Richpeace, 3380, BLOCK_36C); cùng một luật hình học (E13) | 2026-09-23 |
| Tạo hình **G1** Curve = Bezier bậc 3 · **G3** Rectangle từ góc dưới-trái, không xoay · **G4** Polygon Size = đường kính vòng qua đỉnh, Angle 0 = đáy ngang · **G7** snap không tự tạo Coincident; tạo hình nằm trong tool **Vẽ**, đi theo Xuất DXF chung với Edit | 2026-09-23 |
| Bớt mảnh = **xoá hẳn**, không ẩn (`remove.md`); Edit xoá đường của file, **trừ đường cắt layer 1** (`edit.md` §6b) | 2026-09-24 |
| **Double-click khép bút Mảnh**; Line · Curve giữ 2 cú bấm (M2) | 2026-09-24 |
| Vẽ: **mỗi mảnh một vùng** — chỗ bấm đầu quyết định mảnh nhận hình; hình trong mảnh chỉ hít trong mảnh đó; bút Mảnh, Edit, Straight không đổi (V4 · V7 · V11). Straight đã chọn một mảnh chỉ bắt điểm mảnh đó | 2026-09-24 |
| **Trim / Extend một nút**: bấm đường cần sửa → bấm đường đích (D14–D20) | 2026-09-27 |
| Repo công khai **chỉ code** (không DXF factory, không fixture từ file factory, không cả BLOCK_36C); tab 2D **mở trống**; là tab `2D · 3D` (3D mặc định) trong iframe, nối bằng ba message | 2026-09-28 |

---

## 9. Còn mở — phải nhắc TD, không tự quyết

Chạy như mặc định, **chưa chốt** (§5.4); hệ quả ở spec được trỏ.
- **Tốc độ file cực lớn** (~10 000 spline): rê chuột trong Vẽ ~120 ms vì canvas vẽ lại cả khung — cần giữ lớp nền.
- Q1 xoá hẳn vẫn cho ⌘Z trong phiên · P16 (≤ 500 ms, ≤ 5 px) · bút Mảnh vẫn hít mảnh có sẵn · Edit kéo điểm vẫn hít mảnh
  khác · Straight chưa chọn mảnh vẫn đo giữa hai mảnh.
- **Lỗi đọc có sẵn:** 18 tên block trong 7 file thư viện định nghĩa 2–3 lần — viewer giữ một định nghĩa cho mọi INSERT
  cùng tên; hợp lý là INSERT thứ i ↔ định nghĩa thứ i — chờ TD. Viewer **bỏ góc xoay TEXT** (`text_angle.md`).
- Edges G1 hiện cả đường may và đường cắt? · M16 ngưỡng 0.01 mm.
- Nghiên cứu CAD (`input/research/`): xoay/lật để bố trí hay để sửa · xoá đường có phụ thuộc · tool tạo SA · grading.
- `sketch.md` §4: G9/G10 · G13 · G15 cần nhất · `piece.md` §5: P1 · P7 (không SA) · P8 cần nhất; D7 (snap theo px như tool
  CAD khác, hay đơn vị bản vẽ) · `draw.md` §2: W3 · W9 · W10 · `units.md` §4: D6 · D7 · `edit.md` §7: E5 · E3 · E7 · E9 ·
  E10 (GBK) · E8, rồi E13–E19; Trim/Extend nhiều giao điểm: gần nhất dọc đường từ đầu đã chọn, hoà thì trim ·
  `measure_engine.md` §4: A5 (tin `$INSUNITS` khi thiếu `Units:`?).
- **Đã thấy, chưa sửa:** dock Edit có dải trống chặn bấm canvas (Vẽ đã sửa bằng `pointer-events`, `draw.css`).
- **Mới 2026-09-28:** doctype hay quirks mode (§7) · CI chạy **Node 22**, máy làm việc v25.5.0 — built-in mới chỉ vỡ ở CI
  · tên file thư viện / mã style trong tên test, comment, spec đang công khai như code, và **một ít số đo** lấy từ rập
  3380 / thư viện nằm trong assertion và spec (vài chu vi, bề rộng, khoảng notch, một cặp đỉnh ở `sketch.3380.test.js`,
  số entity; `measure_engine.md` · `edges.md` · `edit.md` trích số thư viện) — không phải mảnh, không phải file. Trung
  tính hoá (đọc số qua `PATTERN2D_DATA` thay vì viết thẳng) là việc TD quyết; đó là đổi test theo §5.16, không tự làm.

---

## 10. Môi trường & vận hành

- Repo **công khai** `Adrian9596/3d-avatar`; GitHub Pages deploy khi push lên `main`. Site đang chạy → **mọi thay đổi qua
  nhánh + PR preview, không bao giờ push thẳng `main`**.
- CI `gates.yml` (PR và push `main`): **Node 22**, Python 3.12; chạy `validate:pattern2d`, `validate:pattern2d-rules`,
  `build:pages`, `validate:pages-layout` cùng các cửa của app 3D. Code 2D không dependency; Vite chỉ để build.
- **ezdxf chỉ cho checker cục bộ** (ở lại workspace — lời hứa "Python chỉ thư viện chuẩn" của repo vẫn đúng). Workspace
  nằm trong Google Drive, không phải git: chỉ đọc nó; checker chạy trong thư mục tạm.
- Nói với TD bằng **tiếng Việt**. Comment / docstring mới bằng **tiếng Anh** (vài comment cũ còn tiếng Việt — không dịch
  cho có). Thứ đến tay TD vẫn **tiếng Việt**: UI, câu báo, console (harness: "bỏ qua", "cần dữ liệu ngoài repo"), tên
  mảnh / text vào DXF. Đừng dịch chuỗi mà test hay script so khớp.

---

## 11. Quản lý context — ai giữ sự thật gì

**Một sự thật, một chỗ.** Không chép số liệu sang file khác: trỏ đường dẫn — bản sao lệch âm thầm.

| Câu hỏi | Trả lời ở | Ai sửa |
|---|---|---|
| Tool phải làm gì | spec cạnh code; lời TD | TD đặt; AI viết spec **trước** code (§5.14) |
| Quy tắc, quyết định, bẫy | file này §5–§9 | AI, ngay khi có quyết định |
| Kiến trúc · mở trống, cầu nối | `src/README.md` · `dxf/open.md` (+ `src/ui/tabs.mjs`) | AI, khi đổi |
| Trang host, tab, build, CI, luật repo | `../CLAUDE.md` | theo luật root |
| Lịch sử | §12 | AI **thêm** dòng, không sửa dòng cũ |
| Bằng chứng DXF thật | chạy cục bộ, thư mục tạm; PR ghi N/N + `sources_sha256` | không commit báo cáo |
| Backlog, STATUS, INTENT, nghiên cứu, pipeline, thư viện, nhật ký cũ | workspace riêng | TD giữ |

- **`src/` trong thư mục 2D Pattern là bản chụp đóng băng tại 2026-09-28; đừng sửa nó cho workspace này — sửa
  `pattern2d/` ở đây.** Tài liệu và script ở đó (`CLAUDE.md`, `AGENTS.md`, `STATUS.md`, `status.py`, `build_viewer.py` …)
  còn gọi `src/` của nó là nguồn của viewer — sai về điểm đó; 933/933 và biên nhận CAD ở đó chứng nhận bản chụp.
- **Đóng phiên:** test (dán dòng kết quả) · checker khi đụng kernel / DXF / tool · rules gate · quyết định mới → một dòng
  §12 (chốt cứng thì cả §8) · kiến trúc đổi → `src/README.md` · mở PR.
- **Không ghi vào đâu:** thử nghiệm đã bỏ, suy đoán chưa kiểm chứng, chi tiết chỉ đúng trong một phiên.

---

## 12. Nhật ký quyết định (ghi tiếp vào đây, mới nhất ở trên)

Nhật ký mới, chỉ thêm dòng. Mọi dòng trước 2026-09-28 (kể cả pipeline) ở §12 `CLAUDE.md` của workspace riêng.

| Ngày | Việc | Ghi chú |
|---|---|---|
| 2026-09-28 | **Chuyển code 2D vào repo** (`pattern2d/`, nhánh `feature/pattern2d-tab`): `src/` + `tests/*.js` của workspace "2D Pattern" ở trạng thái **933/933** (2026-09-27). **Ở lại workspace:** pipeline block, thư viện DXF factory, fixture 3380, `cad_corpus.json`, nửa `lib` của `expected.json`, `BLOCK_36C.dxf`, checker ezdxf, `make_*fixture*.py`, `status.py` / `check_docs.py` / `build_viewer.py`, STATUS / INTENT / nghiên cứu. **Dữ liệu (TD):** chỉ code — không DXF factory, không fixture dẫn từ file factory, không cả `BLOCK_36C.dxf`; chỉ 14 DXF tổng hợp + nửa tổng hợp của `expected.json`. **Mới** (`open.md`, viết trước): mở trống, Open DXF trên stage (O1); canvas chặn khi chưa có file (O2); file từ host (O3, O4); `ready` / `opened` (O5); thanh tiêu đề chừa chỗ cho tab (O6); build Vite thay `build_viewer.py`. **Test:** `data.js` / `NeedsData`, harness đếm skipped, `run.js` FAIL khi đọc dữ liệu lúc nạp, `mcase` nhận kỳ vọng dạng hàm, `dom_fixture.js`; 8 test mới (`open.test.js` 7, `canvas.test.js` 1). | **Không phải sửa kỳ vọng (§5.16):** năm file test chỉ đổi **chỗ đọc** dữ liệu (`remove` · `write` · `relate.test.js` → `data.js`) hoặc bọc kỳ vọng thư viện thành **hàm** (`dxf.engine.test.js` DXF-21…25, `units.engine.test.js` UNIT-15 / 17) — không số kỳ vọng, dung sai, tên test nào đổi, không test nào bị bỏ; thiếu dữ liệu thì skipped, không bao giờ passed. Kết quả (Node v25.5.0): `790/790 passed, 151 skipped`; có dữ liệu `941/941 passed`; rules gate `PATTERN2D_OK`; checker trên bản repo: đo 38/38 · rút gọn 54/54 · Engine 210/210 · Edges 7157/7157 · Vẽ 225/225 · Edit 98/98, `sources_sha256` 66c693ee…. |

### Dòng §5.16 chép từ nhật ký của workspace (nguyên văn)

Biện minh cho kỳ vọng của các test đã chuyển sang đây (`corners.test.js:7`, `units.engine.test.js:77` trỏ tới chúng).
Nguyên văn; `⟨…⟩` = tên file thư viện đã thay bằng mô tả chung; hai dòng đầu chỉ trích phần §5.16.

| Ngày | Việc | Ghi chú |
|---|---|---|
| 2026-09-27 | **Gộp Trim / Extend thành một nút** (trích) | **§5.16:** D11 test phím đổi theo yêu cầu mới; test mới của đầu di chuyển sửa so từng bit thành 1e-9 mm theo P1 vì −40.00000000000001 và −40 lệch 7e-15 mm, đầu cố định vẫn từng bit, không nới test cũ. |
| 2026-09-26 | **Sửa riêng B01–B05** (trích) | Chỉnh nhầm trong **test mới trước khi sửa code** (§5.16): B03 Undo so file hình học thay toàn model vì `rev` là cache tăng khi Undo; B04 tên theo X1 `_edit.dxf`, không phải `_edited.dxf`. |
| 2026-09-24 | Sửa **test / phép kiểm** trong phiên trên (§5.16), mỗi chỗ vì **requirement đổi** (TD chốt), không để code qua cửa: (a) `piece.test.js` M17 — *"mảnh của file đang chọn (bảng mảnh) đi trước — W2"* → bấm trong mảnh vẽ P1 khi mảnh của file đang chọn ra **P1**: TD chọn *"chỗ bấm quyết định … kể cả khi đang chọn mảnh khác"* (W2 → V11, `draw.md` sửa trước) · (b) `draw.test.js`: test V11 cũ của `targetPiece` ("mảnh đang chọn thắng") bỏ **cùng hàm** `targetPiece` — hàm không ai gọi từ đợt 1 (`joinTarget` thay), mã hoá luật W2 cũ; thay bằng 3 test V11 mới · (c) `check_sketch.py` V4: dòng *"hình riêng bấm cách POINT → hít đúng POINT"* thành *"→ không hít"* (TD: hình riêng chỉ hít hình riêng), đích hít nay lấy từ chính `zoneTargets` của tool thay cho `pieceTargets` của mọi mảnh, thêm dòng "hình của mảnh khác không hít" và dòng "mọi vùng (bút Mảnh) hít" · (d) `check_edit.py`: thêm phần Xoá, không đổi dòng cũ | Thước tự sai và sửa trước khi xanh: phần vùng mảnh của `check_sketch.py` lúc đầu báo 342 cú bấm "sai" ở ⟨một file thư viện⟩ — tool đúng, thước ghép nhầm: file có **tên block định nghĩa hai lần**, viewer giữ một định nghĩa còn ezdxf gộp cả hai (vòng to hơn 10 mm, lệch chỗ 383 mm) → loại các mảnh đó khỏi phép so, đếm và ghi trong báo cáo. Bấm thử: ba cú bấm của mình trúng **bảng số** / nút Vẽ chứ không trúng canvas — làm lại ở vùng trống |
| 2026-09-24 | Sửa **test / đầu vào phép kiểm** trong phiên trên, mỗi chỗ có bằng chứng ngoài kernel (§5.16): (a) `edges.test.js` "a shape with too few points stays in one piece" → "a triangle of three vertices: three sides — 10, 10, 10√2": tam giác kín có ba cạnh, chu vi 34.14 (hình học tay) — luật cũ cho *một* cạnh dài 20 = đường **hở**; mô tả Edges của CLAUDE.md (tách theo điểm gãy hướng) và định nghĩa góc chung với Edit (`corners.test` "a triangle of 3 vertices: three corners") đều ra ba cạnh; `edit.md` §2 ghi "(Edges để nguyên một cạnh)" là mô tả hành vi cũ — đã sửa câu đó. (b) `relate.test.js` chỉ **dời chỗ import** `SEW_BAND` sang `dxf/model.js`, kỳ vọng `eq(SEW_BAND, 30)` giữ nguyên. (c) `check_sketch.py`: mảnh thử của bút có điểm cong cuối ở (40, −62) so với P — nằm **bên kia** cạnh đầu P → (70, −90), cạnh (60, −30) → (40, −62) cắt nó tại (43.66, −56.1) (tính tay): mảnh thử **tự cắt** từ đầu, code cũ nhận im lặng, M16 nay từ chối → đổi điểm đó thành (20, −15); mọi kỳ vọng, ngưỡng giữ nguyên | Không nới dung sai nào của kernel. `check_edges.py` (mới) tự sai bốn lần trước khi xanh — ghi ở §7 mục Edges |
| 2026-09-23 | Sửa **test** trong phiên trên (§5.16): (a) `edit.test.js` D11 — danh sách phím toàn cục của viewer thêm **6 · 7**: requirement đổi (M13), `edit.md` D11 sửa trước; test vẫn kiểm đúng điều cũ (T · X · K · J không trùng phím nào). (b) Kỳ vọng **tôi viết sai trong test mới, sửa trước khi có code** (không phải chép theo kernel): O17 path hở — bấm ở s = 60 của path dài 150 thì gần đầu hơn → (10, 0), không phải (90, 0); nửa đĩa — bấm x = 10 gần (50, 0) chứ không phải (−50, 0); M15 — hai ca có d trùng đúng khoảng cách chỗ bấm (không phân biệt được "đặt theo d" với "đặt tại chỗ bấm") → đổi d; ca hình tròn bấm ngoài bán kính nhặt → sửa chỗ bấm; `corners.test.js` thiếu import `near` | Thước `check_sketch.py` phần M15 tự sửa ba lần trước khi xanh (không nới ngưỡng nào): chỗ bấm thử ở BLOCK_36C rơi gần đường cắt **mảnh bên cạnh** hơn (0.365 < 0.6 mm, sau khi Arrange dời) — notch vào mảnh kia là đúng luật M7, nay chọn cạnh mà cả hai cú bấm chỉ gần chính mảnh đó; đường cắt **một góc** (2938: vòng 33 mm) — cả vòng là cạnh, thước cũ tính 0; chọn cạnh độc lập với hàm đang kiểm (dòng trên) |
| 2026-09-23 | Sửa **test/spec** trong phiên trên, mỗi chỗ có bằng chứng ngoài kernel (§5.16): (a) `outline.test` diện tích: đa giác 2000 dây/khúc **hụt** phần cong theo 1/N² (N×4 → khoảng hở ÷16: 2.2e-3 → 1.3e-4 → 8.4e-6) → thước mới là tích phân Green bằng Simpson của test, khớp kernel 3.6e-12, dung sai **chặt hơn** 1e-4 → 1e-6 · (b) vòng 6 curve point "gần đường tròn trong 2 mm" là kỳ vọng tôi tự đặt: chính tháp Barry–Goldman cho 310.14 mm (kém 2πr 4.02) → so với chiều dài của tháp · (c) O16: dời điểm bấm (0.5, 0.5) tuỳ hướng thì chân vuông góc không phải q → dời theo pháp tuyến · (d) `piece.test` text ô trống: tôi viết `"SAMPLE SIZE: "` (dấu cách thừa) trong khi spec theo BLOCK_36C (`ANNOTATION:`) · (e) chu vi đường tròn "≤ 0.01 mm" sai hình học — lấy mẫu lệch ≤ 0.01 thì dây cung hụt cung θ²/6 (Ø40: 0.02 mm) → kỳ vọng n·D·sin(π/n), spec M10 sửa theo · (f) **requirement đổi** O14: notch giữ tỉ lệ trên *cạnh*, không trên cả vòng (bấm thật) → 2 kỳ vọng của `sketch.test` đổi theo spec mới · (g) `check_sketch` tool Vẽ: Rect trên layer 1 nay là **mảnh mới** (M5/M6) → hai Rect thử "vào block mảnh" / "hình riêng" dùng layer 8 · (h) chỉ **dời chỗ import** (kỳ vọng giữ nguyên): `parseAngle`/`readAngle` → `shared/units.js`, `PICK_PX` → `canvas.js`, `drawKey` → `flow.js`, `withDrawings`/`drawnPath`/`HINH_VE` → `out.js` | Không nới dung sai nào của kernel. Tool Vẽ giữ 80 bước hoàn tác (trước 100) như Edit và Arrange. `status.py`: dòng *Tạo hình* biết cũ khi `outline.js` · `piece.js` · `out.js` đổi |
| 2026-09-23 | Sửa **1 test** vì requirement đổi, không phải để code qua cửa (§5.16): `edit.test.js` D11 liệt kê cứng mọi phím của viewer (D · M · L · S · G · E · A · F · P · U) để chắc T · X · K · J không trùng — tool Vẽ thêm phím **V** (draw.md W1), nên danh sách thêm `"v"`; `edit.md` D11 sửa cùng câu | Test vẫn kiểm đúng điều cũ (bốn phím của Edit không trùng phím nào khác); chỉ danh sách phím của viewer dài thêm một. Ghi vào spec trước khi sửa test |
| 2026-09-23 | Sửa **phép kiểm C2 của `check_edit.py`**: "đường may" để kiểm là **vòng may kín** của mảnh, không còn là "đường layer 8 bám đầu tiên" | Bằng chứng (§5.16): định nghĩa đường may mới trong spec (edit.md §5, E13) viết trước khi sửa. Ở DM1195 (rập strike cost, không có vòng may kín) phép kiểm cũ chọn một **vạch ngang 2 điểm** SA 15–16 mm — theo spec mới không phải đường may; sau khi đổi phân loại nó chọn một đường trong chạy từ mép xuống, thước SA không áp được (lệch 7.85 mm). Dòng C2 của DM1195 nay ghi rõ "file không có vòng đường may kín"; C2 trên 13 381 đỉnh may của cả thư viện chạy ở phần mới. Không test nào bị nới: C2 ±0.01 mm giữ nguyên ở `relate.test.js` và 4 file kia; dòng toàn thư viện dùng 0.05 mm, lý do ghi ngay trong báo cáo (thước độc lập chuyển đoạn trên cạnh cong bị phóng, ⟨một mảnh thư viện⟩ 0.027–0.029 mm; kernel giữ 1e-12 mm) |
| 2026-09-23 | Sửa **3 test** trong lúc làm Edit, có bằng chứng ngoài kernel (§5.16): (1) `solver.test.js` đếm cứng 14 quan hệ → 17, vì yêu cầu lớp 4 thêm đúng `follow` · `attach` · `reach` (test nay kiểm cả 3 tên); (2) `ops.test.js` "P1 Length trên Curve" ghi đầu cố định `[100, 60]` — chính hình dựng trong test cho `99.99999999999997` (cos/atan2), code giữ nguyên nó từng bit → so với giá trị trước thao tác; (3) `relate.test.js` C2 đo SA bằng khoảng cách tới điểm gần nhất của đường cắt → nay tới đoạn cắt **chạy song song với đường may** ở đó (`rawSeamAllowance`, vòng lặp trần) | Bằng chứng cho (3): góc đầu của 3380 后比 là góc **vát** (đỉnh 0 bẻ 24°, đỉnh 1 bẻ 78.6°) còn đường may chỉ một góc (102°) — điểm gần nhất của đường cắt tới góc may là đoạn vát 7 mm, không phải cạnh nào mà đường may lùi từ đó; thước cũ chỉ đạt nhờ cách neo cũ (sai) tình cờ khớp. Kỳ vọng mới ghi vào spec C2 trước khi đổi test |
| 2026-09-23 | Tách phần tìm góc của Edges ra `geometry/corners.js` (Edges và Edit dùng chung một định nghĩa); `segmentEdges` nay gọi nó | Chứng minh không đổi: chạy Edges trên **1182 đường thật** trước và sau, so từng điểm → 1182/1182 giống hệt. Lần đầu lệch 1 đường (⟨một đường thư viện⟩): viết `acos·(180/π)` thay vì `acos·180/π` làm hai góc gần bằng nhau đổi chỗ "sắc nhất" — đã viết lại đúng biểu thức cũ |
| 2026-09-23 | Cập nhật **2 test mã hoá yêu cầu cũ**, vì yêu cầu đổi chứ không phải để code qua cửa (§5.16): `export.test.js` (bảng Copy trước luôn mm, tiêu đề không đơn vị → nay theo đơn vị hiển thị, tiêu đề ghi đơn vị — D2) · `import.test.js` (badge "inch → mm" đọc như "đang hiện mm" khi có công tắc in/cm/mm → nay "file: inch") | Kỳ vọng mới ghi trong spec `units.md` trước khi sửa code |
| 2026-09-23 | Sửa **2 test** của bộ trên, có bằng chứng ngoài kernel (§5.16): **UNIT-16** kỳ vọng file 2875 LiftyChic có `$INSUNITS=6` — đọc byte thô thì file không có biến header nào, số 6 là mặc định ezdxf tự điền; test `components` "khe = tol" dùng 10.05 − 10 = 0.05000000000000071 > 0.05 trong IEEE-754 → đổi sang số nhị phân chính xác | Cùng lỗi chứng cứ đó làm sai lý do của giả định A5 — đã viết lại; hành vi giữ nguyên, chờ TD chốt. `make_engine_fixtures.py` nay đọc biến header từ văn bản thô |
