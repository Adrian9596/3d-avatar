# Spec — Measure Engine: bộ test tìm bug

> **Requirement (TD, 2026-09-23), nguyên văn:**
>
> | Nhóm | Test chính | Phải kiểm tra |
> |---|---|---|
> | P2P | Horizontal / Vertical / Diagonal / Same point | Distance đúng |
> | Line Path | 1 line / nhiều line / reversed | Tổng length đúng |
> | Arc | 90° / 180° / reversed / CW-CCW | Arc length đúng |
> | Curve | Spline/Bezier đơn giản + reversed | Curve length ổn định |
> | Mixed Path | Line + Arc + Curve | Tổng đúng |
> | Topology | Gap / disconnected / duplicate / self-intersection | Không đo sai hoặc tự nối |
> | Units | mm / inch / conversion / missing unit | Scale đúng, không tự đoán |
> | Transform | Zoom / pan / rotate / screen resize | Kết quả không đổi |
> | Editing | Move / trim / extend / split / undo | Measurement cập nhật đúng |
> | DXF | LINE / ARC / SPLINE / POLYLINE + factory DXF | Import và đo đúng |
>
> Mỗi test ghi: **Expected → Actual → CAD Reference → Tolerance → PASS/FAIL**.
> CAD Reference: số đo nhập tay từ Richpeace/AccuMark khi có.
>
> Bug-Finding Rules: expected tính **độc lập** với Measure Engine · không dùng pixel/Canvas để
> tính · không tự đoán unit/scale · mỗi nhóm có **normal + boundary + invalid** · AI không sửa
> test để code PASS · một bug là **FIXED** chỉ khi test gây ra bug PASS **và** toàn bộ regression
> vẫn PASS.

"Measure Engine" ở đây là cả chuỗi mà một con số đi qua trước khi tới mắt TD:
`dxf/parse.js → dxf/model.js (+ units.js) → geometry/model.js · spline.js · path.js · straight.js
→ measure/measure.js → canvas/view.js`. Bug ở khâu nào cũng ra số sai như nhau, nên bộ test
kiểm cả chuỗi chứ không chỉ kernel.

## 1. Chạy

| | Lệnh |
|---|---|
| Chỉ bộ này | `node tests/run.js engine` |
| Bảng Expected → Actual → CAD Ref → Tol → PASS/FAIL | `python3 scripts/check_engine.py` → `output/measure_engine_report.md` |
| Sinh lại DXF mẫu + expected (ezdxf) | `python3 scripts/make_engine_fixtures.py` |

Cột **CAD Ref** trong báo cáo để TD điền số đo tay trong Richpeace/AccuMark (đơn vị mm). Chạy lại
script không xoá cột đó; có số thì script tự tính Δ và PASS/FAIL với tolerance **0.1 mm**
(giới hạn bắt điểm và đọc số bằng tay — cùng mức `along_path.md §4`). Các ca DXF dùng file trong
`tests/fixtures/engine/` — mở thẳng file đó trong CAD là đo được.

## 2. Expected lấy từ đâu (không bao giờ từ kernel)

| Nguồn | Dùng cho |
|---|---|
| Hình học tính tay, đã soát lại bằng Python | 3-4-5, `r·θ`, chu vi sân vận động `400 + 100π`, parabol `25(2√5 + asinh 2)` |
| Vòng lặp trần viết ngay trong test | tổng dây cung polyline, de Casteljau 2¹⁸ đoạn + ngoại suy Richardson cho Bezier |
| Đặc tả SVG (viewBox + `preserveAspectRatio="xMidYMid meet"`) viết lại trong test | điểm world được **vẽ** ở pixel nào — nhóm Transform |
| **ezdxf** + Gauss–Legendre bằng Python (`scripts/make_engine_fixtures.py`) | mọi số của nhóm DXF và Units trên file thật; đóng băng trong `tests/fixtures/engine/expected.json` kèm sha256 từng file |
| Khai báo trong chính file DXF (`Units: ENGLISH`) + định nghĩa 1" = 25.4 mm | nhóm Units |

## 3. Tolerance

| Loại | Tol | Vì sao |
|---|---|---|
| Line · Arc · polyline, công thức đóng | **1e-9 mm** | số học, không phải phép đo (`along_path.md §3`) |
| Spline/Bezier (tích phân số) | **1e-6 mm** | cầu phương hội tụ; vẫn nhỏ hơn 10 000 lần mức CAD 0.01 mm |
| DXF ↔ ezdxf | **1e-6 mm** | cùng một file, hai bộ đọc; riêng tổng chiều dài cả file spline: **1e-3 mm** |
| CAD tay (cột CAD Ref) | **0.1 mm** | giới hạn bắt điểm bằng tay |
| Hành vi (ném lỗi, cờ, đơn vị) | — | đúng hoặc sai, không có dung sai |

## 4. Hành vi mong đợi ở các chỗ requirement để ngỏ — **giả định, chờ TD chốt**

Requirement nói *"không đo sai hoặc tự nối"* và *"không tự đoán"*, không nói cụ thể phải làm gì.
Bảng dưới là cách hiểu đang dùng; mỗi dòng có test khoá lại, nên TD chốt khác thì sửa **spec + test**
trước rồi mới sửa code.

| # | Tình huống | Hành vi đang dùng | Lý do |
|---|---|---|---|
| A1 | Hai hình **trùng nhau** (cùng chiều hoặc ngược chiều) | `chain()` **ném lỗi** "trùng" | nối vào sẽ ra path dài gấp đôi và giả làm ring kín |
| A2 | **Phân nhánh** — một đầu mút có ≥ 3 hình chạm vào | **ném lỗi** "phân nhánh" | đo dọc theo nhánh nào là đoán |
| A3 | Path **tự cắt** (một polyline vắt chéo qua chính nó) | vẫn đo **dọc theo nét vẽ** (không đi tắt qua chỗ cắt), nhưng kết quả mang cờ `crossings`; bấm đúng chỗ cắt → cờ `ambiguous` | nét vẽ là liên tục nên đo được; nhưng TD phải thấy cảnh báo |
| A4 | Một hình **hở** mà đầu trùng cuối (≤ tol) — polyline cờ hở, cung 360° | coi là **path kín** | đúng luật của nhiều hình (`chain` đã coi đầu-cuối chạm nhau là kín); 4 mảnh `CBXO172001-DES.dxf` vẽ như vậy |
| A5 | File **không khai** `Units:` (AAMA) | `units.unit = null`, **không đổi toạ độ**, viewer ghi "đơn vị?" và cho chọn tay | không tự đoán; `$INSUNITS` chỉ ghi lại làm gợi ý, **không áp**: đó là biến chèn-block của AutoCAD mà phần mềm ghi file tự điền mặc định — ezdxf ghi `$INSUNITS=6` (mét) vào mọi file nó tạo, kể cả các fixture **mm** của chính bộ test này. Trong thư viện `DXF file/`, `$INSUNITS` chỉ có ở 12/46 file, luôn = 4 và đều đúng; 4 file SPLINE (2938 ×2, 2999, 3004) chỉ khai bằng nó nên mở ra "đơn vị?" — **TD chốt**: có muốn tin `$INSUNITS` = 1/4 khi thiếu AAMA không |
| A6 | `Units:` AAMA mâu thuẫn `$INSUNITS` | theo **AAMA**, ghi `conflict` | AAMA là thứ CAD nhà máy đọc (INTENT §4.1) |
| A7 | Đầu vào không hợp lệ (NaN, ∞, thiếu toạ độ, bán kính âm, knot sai) | **ném lỗi** có chữ "không hợp lệ" / "điểm" | không bao giờ trả NaN, không bao giờ lặng lẽ bỏ một đỉnh |
| A8 | Số hỏng trong DXF (`10\nabc`) | bỏ **cả entity**, ghi vào `warnings` kèm số dòng | không "sửa" thành 0, không bỏ riêng một đỉnh |
| A9 | Sau khi dời mảnh (Arrange) | đầu đo **đi theo mảnh** nó bắt vào, số đo tính lại | "Measurement cập nhật đúng"; điểm tự do đứng yên |
| A10 | Spline chỉ có fit point, không có control point | bỏ entity đó, ghi `warnings` "chưa hỗ trợ" | nội suy fit point là một phép dựng khác, làm sai còn tệ hơn không làm |
| A12 | Bấm Along ở chỗ **nhiều đường vẽ đè nhau** (cách nhau ≤ 0.01 mm — một vạch layer 8 vẽ đè lên mép cắt, một bản sao đường cắt ở layer 84) | bám **đường cắt**, rồi đường may (8, 14), rồi đường khác; đường gần hơn rõ ràng (> 0.01 mm) vẫn thắng; bảng Along có dòng **Bám** ghi layer đang theo (2026-09-24) | quét thư viện: BiancaBra 11_52_M bám nhầm vạch layer 8 đè lên mép (lệch 0.0002 mm) rồi báo "hình trùng nhau" |
| A11 | INSERT phóng **lệch trục** chứa ARC | bỏ cung đó, ghi `warnings` "lệch trục" | cung thành ellipse; không có kiểu ellipse, không xấp xỉ âm thầm |

## 5. Danh sách ca — mỗi dòng một test trong `*.engine.test.js`

Loại: **N** normal · **B** boundary · **I** invalid.

### P2P — `geometry/straight.engine.test.js`

| ID | Loại | Ca | Expected (nguồn) |
|---|---|---|---|
| P2P-01 | N | ngang (12.5, −7) → (212.5, −7) | 200 (tay) |
| P2P-02 | N | dọc (40, 10) → (40, 160.25) | 150.25 |
| P2P-03 | N | chéo 3-4-5 | 500 |
| P2P-04 | N | chéo 45° (−50, −50) → (50, 50) | 100√2 |
| P2P-05 | N | chéo góc phần tư II (10, 20) → (−50, 100) | 100 |
| P2P-06 | N | đối xứng A→B = B→A, dx đổi dấu | |
| P2P-07 | B | cùng một điểm | 0, không NaN, không −0 |
| P2P-08 | B | cách nhau 1e-6 mm ở toạ độ 1000 | 1e-6 |
| P2P-09 | B | toạ độ 1e6 mm | 500 |
| P2P-10 | B | cả hai điểm âm | 500 |
| P2P-11…15 | I | NaN · ∞ · thiếu y · null · mảng `[x, y]` thay cho điểm | ném lỗi "điểm" |
| P2P-16 | N | bấm lệch cạnh hai notch → đo đúng notch–notch | hypot hai notch |
| P2P-17 | B | bán kính bắt điểm đúng bằng khoảng cách → vẫn bắt | |

### Line Path · Arc · Curve (polyline) · Mixed · Topology — `geometry/path.engine.test.js`

Line: 1 line (LINE-01/02) · 5 line zigzag (03/04) · lật + xáo (05) · đo ngược B→A (06) · 4 line kín
(07) · A = B (08) · đúng mối nối (09) · khe = tol (10) · bấm lệch 7 mm (11) · line dài 0 (12) ·
rỗng (13) · NaN (14) · NaN ở điểm bấm (16). Tool Along chọn đúng đường khi bấm giữa cạnh dài
(LINE-15/17, `measure/measure.engine.test.js`).

Arc: 90° (ARC-01) · 180° (02) · lật (03) · CW (04) · cùng a0/a1 khác chiều (05) · trong lòng cung
(06) · qua ±180° (07, 14) · **360°** (08) · 1e-6 rad (09) · cắt dài 0 (10) · split (11) · r âm (12) ·
góc NaN (13).

Curve (polyline): CURVE-01…04. Mixed: MIX-01…09 (MIX-05 có Bezier, nằm ở `spline.engine.test.js`).
Topology: TOPO-01…20 — xem §4 A1–A4, A7.

### Curve (Spline/Bezier) — `geometry/spline.engine.test.js`

| ID | Loại | Ca | Expected (nguồn) |
|---|---|---|---|
| SPL-01 | N | Bezier bậc 3, 4 điểm thẳng hàng cách đều | 300 (tay) |
| SPL-02 | N | Bezier bậc 2 (0,0)(50,100)(100,0) | `25(2√5 + asinh 2)` (tay) |
| SPL-03 | N | NURBS hữu tỉ bậc 2 — ¼ đường tròn r = 100 | 50π; mọi điểm cách tâm 100 |
| SPL-04 | N | NURBS 9 điểm — đường tròn r = 40 | 80π, path kín |
| SPL-05 | N | Bezier bậc 3 tổng quát | de Casteljau 2¹⁸ đoạn + Richardson (trong test) |
| SPL-06 | N | lật chiều control point | cùng chiều dài |
| SPL-07 | N | cắt tại t = 0.37, cộng lại | = toàn bộ; điểm cắt đúng 37 % chiều dài |
| SPL-08 | N | Along Path giữa u = 0.2 và 0.7 | brute force |
| SPL-09 | N | "chuỗi Bezier" (knot bội p+1, như thư viện 2938) | tổng hai Bezier |
| SPL-10 | B | spline bậc 1 = polyline | tổng dây cung |
| SPL-11 | B | xoay + tịnh tiến | chiều dài không đổi |
| SPL-12 | B | Bezier có điểm lùi (P0 = P1) | brute force |
| SPL-13…16 | I | knot sai số lượng · knot giảm · control NaN · weight ≤ 0 | ném lỗi |

### Units — `dxf/units.engine.test.js` — xem §4 A5, A6

*(Từ 2026-09-23 nhóm này có thêm **UNIT-20…40** về **đơn vị hiển thị** — mặc định inch, công tắc
in · cm · mm, display only, global: `shared/units.engine.test.js` + `measure/display.engine.test.js`,
spec `src/shared/units.md` — và **UNIT-41…54** về **snap theo đơn vị bản vẽ** (0.02 in / 0.5 mm, TD
làm rõ cùng ngày): `geometry/snap.engine.test.js` + `measure/snaptools.engine.test.js`, spec
`units.md` §3.)*

UNIT-01…05, 18 quy đổi (1" = 25.4 mm đúng tuyệt đối, khứ hồi, đơn vị lạ / thiếu → lỗi) · 06–14, 19 DXF
tổng hợp (METRIC · ENGLISH · `UNITS:` viết hoa · không khai + cảnh báo · `$INSUNITS=6` · mâu thuẫn ·
khai bậy · chọn tay) · 15–17 file thật (DM1195 ENGLISH · 2875 LiftyChic ENGLISH không biến header ·
2938 không khai AAMA).

### Transform — `canvas/view.engine.test.js` + `geometry/edit.engine.test.js`

TRF-01…06, 13, 14: world → pixel (đặc tả SVG, trong test) → `worldAt` → bắt điểm → Straight; đổi zoom,
pan, **kích thước khung** (resize), zoom cực hạn; `ppmOf` = tỉ lệ thật SVG đang vẽ; khung 0 px, zoom NaN.
TRF-07…12: xoay · gương · tịnh tiến ring hỗn hợp, đường tròn đủ vòng, spline → số đo không đổi.

### Editing — `geometry/edit.engine.test.js` + `measure/measure.engine.test.js` — xem §4 A9

EDIT-01…12 trên `doc.js`/`ops.js`: move · trim một đầu · **trim giữa** (phải còn đủ hai mảnh) ·
extend line/cung · split cung/ring · undo · scale · sửa nút dẫn xuất → lỗi · offset cập nhật.
EDIT-V1…V7 trên tool Measure: điểm bắt được là **giá trị** (không phải tham chiếu sống vào mảnh) ·
dời mảnh thì đầu đo theo · đo chéo hai mảnh · Along sau khi dời · undo · mảnh không còn → không đo ·
điểm tự do đứng yên.

### DXF — `dxf/dxf.engine.test.js` — xem §4 A8, A10, A11

DXF-01…20, 26 trên file tổng hợp do ezdxf viết (`tests/fixtures/engine/*.dxf`): LINE · ARC · ARC
extrusion −Z · CIRCLE · POLYLINE cũ · LWPOLYLINE bulge · POLYLINE bulge · SPLINE (NURBS ¼ tròn, tròn
9 điểm, Bezier, chuỗi Bezier, bậc 1, chỉ fit point) · INSERT scale/rotation/base point · INSERT lệch
trục · polyline hở đầu trùng cuối · số hỏng · đường cắt phân nhánh.
DXF-21…25 trên file thật của thư viện `DXF file/`: CBXO172001-DES (ring hở) · 2938常规L (730 SPLINE,
hai ca) · DM1195 (ENGLISH) · 2875 LiftyChic (CIRCLE, inch).

## 6. Bug tìm thấy (2026-09-23)

Lần chạy đầu: **76/175 đạt, 99 FAIL** (báo cáo lúc đó: bản sao ở thư mục tạm của phiên). Bảng dưới gom
99 dòng đó theo nguyên nhân. *Trước khi sửa* là Actual đúng như bộ test ghi lại — hoặc, với ca bị chặn
bởi API chưa có, là số chạy lại trên code cũ. **FIXED** theo luật của TD: test đó PASS **và** toàn bộ
regression PASS — `node tests/run.js` 479/479 · `check_measure.py` 38/38 · `check_simplify.py` 54/54 ·
`check_engine.py` 175/175 · viewer thử bằng click thật trên trình duyệt.

| # | Bug | Test bắt được | Trước khi sửa | Nguyên nhân → cách sửa |
|---|---|---|---|---|
| B01 | **File inch đo như mm** — 19/46 file thư viện khai `Units: ENGLISH` | UNIT-07/08/15 · DXF-24 | wing DM1195 rộng **10.9** "mm" (thật 278.1); đường chéo 4"×2" = 4.47 | `Units:` đọc vào `header` rồi bỏ đó → `units.js`; `buildModel` đổi toạ độ sang mm |
| B02 | File không khai đơn vị vẫn ghi "mm" | UNIT-10/11/13/17/19 | không có thông tin đơn vị nào | `units.unit = null` + cảnh báo; viewer ghi "đơn vị?", thước ghi "đv?", ô chọn tay |
| B03 | **ARC / CIRCLE bị bỏ** khi import | DXF-03…06 | đường cắt LINE + ARC: chu vi **400** (thật 714.16), cung không hiện | `parse.js` không đọc ARC/CIRCLE → đọc cả extrusion (OCS lật trục) |
| B04 | **Bulge bị bỏ** — cung trong polyline đo thành dây cung | DXF-08…10 · check_measure #38 | hình chữ D chu vi **400** (thật 457.08); cung 90°: 160 (thật 171.07) | mã 42 bị ghi đè vào `sy` → `bulgeArc()` dựng cung thật |
| B05 | **SPLINE bị bỏ; kernel không có kiểu spline** | DXF-11…16/22/23 · SPL-01…16 · MIX-05 · TRF-11 | 2938常规L: **0/730** spline, mở ra trống; `splines.dxf`: 0 mảnh | → `geometry/spline.js`: NURBS de Boor, chiều dài Gauss–Legendre thích nghi, trim/đảo/xoay chính xác |
| B06 | **INSERT scale / xoay / base point bị bỏ** | DXF-17 | bbox (510,110)–(610,160), chu vi **300** (thật (400,100)–(500,300), 600) | chỉ cộng điểm chèn → ma trận đủ: OCS · dời · xoay · scale · (− base point) |
| B07 | Along không đi qua đường vẽ bằng **nhiều entity**; bảng Pieces sai chu vi | DXF-01/02/03 | chữ nhật 4 LINE: "Cut line" **240** (thật 400) | chỉ bám một entity; `cutLen` = LINE dài nhất × 2 → `components()` + `trackAt()` + `outline()` |
| B08 | **Along bám nhầm đường** | LINE-15/17 | bấm lên cạnh đường cắt → bám **grainline** (layer 7) | chọn theo đỉnh gần nhất → chọn theo khoảng cách tới đường |
| B09 | Ring vẽ bằng **một hình hở** không được coi là kín | ARC-08 · TRF-10 · TOPO-17/18 · DXF-19/21 | đường tròn 350°→10°: **178.0** (thật 10.5); CBXO Piece01 qua mối: **597.8** (thật 232.2) | `closed` chỉ xét khi ≥ 2 hình → xét đầu-cuối cho mọi số hình (A4) |
| B10 | **Hình trùng** nối thành ring giả dài gấp đôi | TOPO-05/06 | line 100 mm hai lần → **200**, "kín" | → `duplicates()` ném lỗi (A1) |
| B11 | **Phân nhánh** bị đi đại một lối | TOPO-16 · DXF-26 | trả **341.4** cho đường rẽ ba | → `branches()` ném lỗi (A2) |
| B12 | NaN / ∞ **lặng lẽ bị bỏ hoặc trả ra** | P2P-11…15 · LINE-14/16 · TOPO-19 · ARC-12/13 | line NaN bị bỏ → trả **100**; điểm NaN → **NaN**; r âm → "path rỗng" | → `checkPoint` / `checkShape`; `curve()`, `arc()` từ chối ngay khi dựng (A7) |
| B13 | Cung góc quét 0 thành **đường tròn** | ARC-10 | `trimBetween(cung, t, t)` = **628.3** mm (thật 0) | `sweep()` coi a0 = a1 là 2π → 0, như ezdxf; `transform` giữ góc quét |
| B14 | Path **tự cắt** không báo; bấm đúng chỗ cắt không báo mơ hồ | TOPO-11/12/13 | không có thông tin nào | → `ch.crossings`, `ambiguous`; panel hiện "⚠ Tự cắt", "⚠ mơ hồ" (A3) |
| B15 | **Đổi kích thước khung → click lệch khỏi chỗ bấm**; px/mm sai | TRF-03/04/06 | bấm đúng notch đang vẽ mà **không bắt được** notch | `worldAt` kéo giãn, SVG vẽ kiểu *meet* → nghịch đảo đúng phép *meet*; `ppmOf`; tự khớp view khi vẽ; pan, zoom bánh xe theo tỉ lệ thật |
| B16 | Khung 0 px / zoom NaN làm hỏng view | TRF-13/14 | trả **[∞, −∞]**; zoom NaN làm view NaN | kiểm đầu vào |
| B17 | **Điểm đo là tham chiếu sống vào mảnh**; dời mảnh thì số đo lệch | EDIT-V1…V7 | dời mảnh 10 mm: đầu bắt vào đỉnh trôi theo (**110**), đầu bắt POINT đứng yên | `definedPoints` trả mảng gốc → trả giá trị; đầu đo là *anchor* theo mảnh, Along tính lại (A9) |
| B18 | `doc.trim` cắt giữa **làm mất nửa sau** | EDIT-04 | còn 30 / 60 mm | nửa sau thành nút nguồn mới, trả `ids` |
| B19 | **Số hỏng trong DXF bị "sửa"** | DXF-20 | polyline có `abc` vào model thiếu một đỉnh, không cảnh báo | → bỏ cả entity, `warnings` ghi số dòng (A8) |
| B20 | Entity không dựng được **biến mất im lặng** | DXF-16/18 | SPLINE chỉ có fit point, ARC trong INSERT lệch trục: mất, không một lời | → `warnings` (A10, A11) |
| B21 | Spline dài 0 bị bỏ im lặng *(lộ ra khi sửa B05)* | DXF-22 | 728/730 | giữ lại path |
| B22 | Chiếu điểm lên spline chỉ chính xác ~1e-6 mm *(lộ ra ở unit test mới)* | `spline.test.js` | 70.71067746 (thật 70.71067812) | golden-section chỉ đạt √ε → tìm nghiệm (C − p)·C′ = 0 |
| B23 | *(ngoài 10 nhóm)* Nút ☰ / phím P không bao giờ ẩn được thanh bên | thử resize trên trình duyệt | bấm không có tác dụng | điều kiện bị đảo trong `app.js` |
| B24 | Đơn vị chọn tay **dính sang file mở sau** — tự đoán hộ file khác | thử trên trình duyệt | mở file inch sau khi ép "mm" → sẽ đo như mm | mở file mới thì ô đơn vị về Auto |

### Test đã sửa — kèm bằng chứng ngoài kernel (CLAUDE.md §5.16)

| Test | Kỳ vọng cũ | Bằng chứng kỳ vọng cũ sai | Nay |
|---|---|---|---|
| UNIT-16 | LiftyChic có `$INSUNITS=6` mâu thuẫn `Units: ENGLISH` | đọc byte thô: file **không có biến header nào**; số 6 là mặc định ezdxf tự điền khi đọc | ENGLISH, không mâu thuẫn; `make_engine_fixtures.py` đọc biến header từ văn bản thô |
| `components` khe = tol | 10.05 − 10 ≤ 0.05 | IEEE-754: 10.05 − 10 = **0.05000000000000071** > 0.05 | dùng số nhị phân chính xác (8.0625 − 8 = 0.0625) |

Cùng lúc đó **giả định A5** được viết lại cho đúng: chứng cứ ban đầu ("`$INSUNITS=6` trong file Richpeace")
cũng đến từ mặc định của ezdxf, không phải từ file. Hành vi giữ nguyên (không áp `$INSUNITS`) — nhưng
đó là việc TD chốt, xem §4.
