# Spec — Tạo & sửa hình: Line · Curve · Rectangle · Circle · Polygon (kernel)

> **Requirement (TD, 2026-09-23), nguyên văn (ảnh bảng):**
>
> | Geometry | Cách tạo | Cách edit |
> |---|---|---|
> | Line | Start → End / nhập Length + Angle | Drag endpoint, nhập số |
> | Curve | Start → End → kéo control point | Drag endpoint/control point |
> | Rectangle | W × H | Drag vị trí, sửa W/H |
> | Circle | Diameter | Drag tâm, sửa Diameter |
> | Polygon | Size + số cạnh | Drag vị trí, sửa Size/Angle |
>
> **Rule cốt lõi**
> 1. **Create:** tạo bằng **kích thước thật**.
> 2. **Drag:** chủ yếu thay đổi **vị trí/hình dạng**, tùy điểm đang kéo.
> 3. **Snap:** bắt vào point/line/curve và dùng cùng unit.
> 4. **Numerical input:** khi cần độ chính xác.
> 5. **Constraint:** giữ quan hệ hình học như Horizontal, Vertical, Tangent, Coincident, Equal…
>
> Kèm lời dặn: *"tạo test, và chứng minh cho phần này trước khi đưa vào tool"*.

**Phạm vi file này = kernel + test + chứng minh trên DXF thật** (CLAUDE.md §5.13–§5.14: input → expected →
test tự động *trước* khi nối Canvas). Kernel được chứng minh trước rồi mới nối: tool **Vẽ** trên canvas
(`features/draw/`, spec `draw.md`) gọi đúng các hàm ở đây, không có luật hình học nào của riêng nó.

Nguồn sự thật cho `geometry/entity.js` (năm loại hình) và `geometry/sketch.js` (tài liệu phác thảo: hình +
quan hệ). Mỗi bất biến ở §3 có ít nhất một test; cột *Ca* ghi test nào khoá nó.

## 1. Ở đâu, dựa vào gì

| | File | Việc |
|---|---|---|
| Năm loại hình | `geometry/entity.js` | tạo từ kích thước thật · tay nắm · kéo · sửa số · đo · ra hình kernel · điểm bắt |
| Phác thảo | `geometry/sketch.js` | giữ hình + 5 quan hệ, giải **một chiều**, kéo có snap, từ chối mâu thuẫn |
| Dựa vào (không đổi) | `model.js` · `spline.js` (Bezier = NURBS bậc 3) · `snap.js` · `corners.js` · `deform.js` · `shared/units.js` | hình chính xác, chiều dài tích phân, snap theo đơn vị bản vẽ, đọc số theo đơn vị hiển thị |

Mọi toạ độ ở **mm**, trục y hướng lên như rập; góc bằng **độ, ngược chiều kim đồng hồ từ +X** (như Edit,
`deform.js`). Kernel không biết px, zoom hay đơn vị hiển thị (§5.17) — ô nhập đổi chữ ra mm bằng
`parseLength` rồi mới gọi kernel.

Quan hệ **một chiều**, đúng quyết định §8 ("dependency graph một chiều, không dùng constraint solver số"):
mỗi quan hệ có **chủ** (đứng yên) và **bên bám** (bị tính ra). Giải một lượt theo thứ tự tôpô, không lặp,
không dò nghiệm — nên luôn kết thúc và kết quả tiên đoán được. Cái giá: một vòng khép kín mà cạnh nào
cũng bị khoá thì bị từ chối (G13).

## 2. Năm loại hình

| Loại | Lưu (mm, độ) | Tay nắm — kéo thì | Sửa số | Hình kernel | Điểm bắt |
|---|---|---|---|---|---|
| **Line** | `a`, `b` | `a`/`b`: **dáng** — đầu đó tới con trỏ, đầu kia đứng yên · `body`: **vị trí** | `length` (giữ Start, giữ góc) · `angle` (xoay quanh Start, giữ dài) | `line` | a, b |
| **Curve** | `p0`, `c1`, `c2`, `p3` — Bezier bậc 3 | `p0`/`p3`: **dáng** — đầu mút tới con trỏ, control point của nó đi theo · `c1`/`c2`: **dáng** — chỉ điểm đó · `body`: **vị trí** | — (vị trí gõ bằng toạ độ / Distance) | `spline` (Bezier chính xác) | p0, p3 |
| **Rectangle** | góc neo `x`, `y` + `w`, `h` | mọi chỗ (`v0…v3`, `body`): **vị trí** | `w` · `h` (giữ góc neo) | polyline kín 4 đỉnh | 4 góc |
| **Circle** | tâm `c` + `d` | `c`, `body`: **vị trí** | `d` (giữ tâm) | `arc` kín (0 → 2π) | tâm |
| **Polygon** | tâm `c` + `size`, `sides`, `angle` | `c`, `v0…`, `body`: **vị trí** | `size` · `angle` (giữ tâm) | polyline kín n đỉnh | tâm + n đỉnh |

Rectangle · Circle · Polygon lưu **bằng chính kích thước** (không phải bằng toạ độ đỉnh), nên kéo vị trí
không bao giờ đụng tới W/H/D/Size — đúng chữ "Drag vị trí, sửa W/H" của bảng.

## 3. Bất biến

### 3.1 Rule 1 — Create bằng kích thước thật

| # | Khẳng định | Ca |
|---|---|---|
| **T1** | **Line** Start → End: hai đầu đúng hai điểm đó (từng bit). Length + Angle: \|AB\| = L và hướng A→B = Angle (±1e-9 mm, ±1e-9°); góc bội 90° cho đường ngang/dọc **đúng tuyệt đối** (dx hoặc dy = 0) | `entity.test.js` |
| **T2** | **Curve** Start → End: Bezier bậc 3 qua đúng hai đầu (từng bit); chưa kéo thì hai control point nằm trên dây cung ở 1/3 và 2/3 (curve thẳng, dài = dây cung); chiều dài = tích phân độc lập (±1e-9 mm) | `entity.test.js` |
| **T3** | **Rectangle** W × H: 4 cạnh W, H, W, H · 4 góc 90° · chu vi 2(W+H) · diện tích W·H · góc neo đúng điểm đặt (G3) | `entity.test.js` |
| **T4** | **Circle** Diameter: mọi điểm trên hình cách tâm đúng D/2; chu vi πD | `entity.test.js` |
| **T5** | **Polygon** Size + n: n đỉnh cách tâm đúng Size/2 (G4) · n cạnh bằng nhau = Size·sin(π/n) · góc trong (n−2)·180/n · Angle 0 → cạnh đáy nằm ngang | `entity.test.js` |
| **T6** | **Kích thước thật, không phải px**: không hàm nào nhận zoom/px; cùng số mm → cùng hình từng bit, gõ bằng đơn vị nào cũng vậy (5 in = 127 mm = 12.7 cm) | `entity.test.js` |
| **T7** | Kích thước ≤ 0 · NaN · ∞ · số cạnh không nguyên hoặc < 3 · Start trùng End → **từ chối** (ném lỗi), không ra hình | `entity.test.js` |

### 3.2 Rule 2 — Drag: vị trí hay hình dạng, tùy điểm đang kéo

| # | Khẳng định | Ca |
|---|---|---|
| **K1** | Line kéo **đầu** → đầu đó tới đích, đầu kia **không đổi một bit**. Kéo **thân** → tịnh tiến, dài và góc giữ (±1e-9) | `entity.test.js` |
| **K2** | Curve kéo **đầu mút** → đầu đó tới đích, control point của nó đi cùng vector (hướng và độ dài tay nắm giữ nguyên, G2), nửa bên kia không đổi một bit. Kéo **control point** → chỉ điểm đó đổi. Kéo thân → tịnh tiến | `entity.test.js` |
| **K3** | Rectangle · Circle · Polygon kéo ở đâu cũng **chỉ dời vị trí**: W · H · D · Size · Angle · số cạnh **không đổi một bit**; điểm đang nắm tới đúng đích | `entity.test.js` |
| **K4** | Kéo không làm hình suy biến: đầu Line đè lên đầu kia (dài 0) hay hai đầu Curve trùng nhau → **từ chối** bước đó, hình giữ nguyên | `entity.test.js` · `sketch.test.js` |
| **K5** | Không ghi đè: hàm nhận hình, trả hình **mới**; hình cũ không bị sửa (undo = giữ tham chiếu cũ) | `entity.test.js` |

### 3.3 Rule 3 — Snap: point / line / curve, cùng đơn vị

| # | Khẳng định | Ca |
|---|---|---|
| **B1** | Hít **điểm** trước (đầu mút, góc, đỉnh, tâm của hình mới; POINT và đỉnh của DXF), rồi tới **line/curve** (chân đường vuông góc), còn lại là điểm tự do. Kết quả nói rõ **point · line · curve · free** | `sketch.test.js` |
| **B2** | Dung sai = **khoảng cách trong bản vẽ**, đúng `shared/units.md` §3: file inch **0.02 in**, file mm **0.5 mm**, ≤ dung sai là hít, quá là không; không đổi theo zoom hay công tắc in · cm · mm; file không khai đơn vị → **không snap** | `sketch.3380.test.js` · `check_sketch.py` |
| **B3** | Hít vào line → điểm nằm **trên** line; vào curve (ARC · SPLINE · polyline cong của rập) → nằm **trên** curve (±1e-9 mm, thước độc lập). Line/curve của polyline phân theo độ thẳng 0.01 mm giữa hai góc — cùng định nghĩa với Edges/Edit | `sketch.test.js` · `sketch.3380.test.js` |
| **B4** | Không hít vào chính mình: tay nắm đang kéo không bắt vào hình của chính nó | `sketch.test.js` |
| **B5** | Kéo **vị trí**: góc · tâm · đỉnh · đầu mút nào của hình lọt vào dung sai của điểm/đường khác thì cả hình dời cho điểm đó **trùng khít** đích | `sketch.test.js` |
| **B6** | Snap chỉ **đặt chỗ**; muốn giữ quan hệ thì khai Coincident — kết quả snap trả sẵn `ref` để khai (G7) | `sketch.test.js` |
| **B7** | Trên DXF thật (BLOCK_36C · 3380 nhà máy · file inch · file ARC · file SPLINE): điểm hít trùng POINT do ezdxf đọc, nằm trên LINE / ARC / SPLINE / polyline do ezdxf + vòng lặp Python đo | `check_sketch.py` |

### 3.4 Rule 4 — Numerical input khi cần độ chính xác

| # | Khẳng định | Ca |
|---|---|---|
| **N1** | Mọi kích thước tạo/sửa **gõ được theo đơn vị hiển thị** qua `parseLength`: `5` (in) · `3/8` · `1 1/4` · `12,7 cm` · hậu tố thắng đơn vị đang chọn; góc bằng độ | `entity.test.js` |
| **N2** | Sửa số: Line **Length** (giữ Start, giữ góc) · **Angle** (xoay quanh Start, giữ dài); Rectangle **W/H** (giữ góc neo); Circle **Diameter** (giữ tâm); Polygon **Size/Angle** (giữ tâm); mọi hình **dời** đúng dx, dy | `entity.test.js` · `sketch.test.js` |
| **N3** | Số hỏng hay ngoài miền → **từ chối**, hình không đổi một bit | `entity.test.js` · `sketch.test.js` |
| **N4** | Gõ toạ độ cho một tay nắm = kéo tay nắm tới đúng toạ độ đó: **cùng một hình, từng bit** (hai lối vào, một phép) | `sketch.test.js` |

### 3.5 Rule 5 — Constraint (một chiều)

Năm quan hệ, **tham số đầu là chủ, tham số sau bám theo**:

| Quan hệ | Áp cho | Bên bám bị tính ra |
|---|---|---|
| **Horizontal** · **Vertical** | một Line · hoặc tay nắm của Curve (`c1` với `p0`, `c2` với `p3` — tiếp tuyến ở đầu đó nằm ngang/dọc) | hướng của đầu chạy |
| **Coincident** | điểm ← điểm (đầu mút, góc, đỉnh, tâm, POINT của DXF) · điểm ← đường (line, curve, circle, rect, polygon, đường DXF) | vị trí điểm bám; hình cứng (rect/circle/polygon) thì cả hình dời theo |
| **Tangent** | Line/Curve bám tại **chỗ nối** lên Line · Curve · Circle · đường DXF (chỗ nối phải được giữ bằng Coincident trước) | hướng của Line, hoặc control point ở đầu nối của Curve |
| **Equal** | Line ← Line / Curve / đường DXF (chiều dài) · Circle ← Circle (D) · Rect ← Rect (W và H) · Polygon ← Polygon (Size) | chiều dài / kích thước |

| # | Khẳng định | Ca |
|---|---|---|
| **R1** | Khai báo xong là quan hệ **đúng ngay**: vị trí ±1e-9 mm, góc ±1e-9° — đo bằng thước trong test, không bằng hàm của kernel | `sketch.test.js` |
| **R2** | Khai báo làm bên bám dời **ít nhất có thể**: Horizontal/Vertical/Tangent **xoay quanh gốc, giữ chiều dài** (G10); Coincident dời điểm lên chủ (lên đường thì tới chân đường vuông góc); Equal đổi chiều dài dọc hướng đang có | `sketch.test.js` |
| **R3** | Sau **mọi** thao tác được nhận (kéo · dời · sửa số · khai · gỡ), **mọi** quan hệ vẫn đúng | `sketch.test.js` · `sketch.3380.test.js` |
| **R4** | **Một chiều**: chủ không bao giờ bị bên bám kéo theo | `sketch.test.js` |
| **R5** | Kéo phần bị khoá thì bị **chiếu lên phần còn tự do**: đầu Line Horizontal trượt ngang · Line bị Equal quay quanh đầu kia · tay nắm Tangent chỉ đổi độ dài · điểm bám đường trượt dọc đường · hình cứng bám đường trượt dọc đường. Phần khoá hết (điểm trùng điểm) thì **không đi**, kết quả nói nó đang bám gì | `sketch.test.js` |
| **R6** | Chỉ phần phụ thuộc mới đổi: hình không dính quan hệ với thứ vừa sửa **không đổi một bit** | `sketch.test.js` |
| **R7** | Khai báo **mâu thuẫn** bị từ chối, hình không đổi: hai quan hệ cùng ghi một bậc tự do (H + V · H + Tangent · hai Equal vào một Line · điểm đã bám rồi) · Line đã bám cả hai đầu mà còn khoá hướng/chiều dài · khai lên chính nó · sai loại (Equal Circle với Line, Tangent không có chỗ nối, H cho Circle…) | `sketch.test.js` |
| **R8** | **Vòng lặp** phụ thuộc bị từ chối lúc khai báo | `sketch.test.js` |
| **R9** | Thao tác mà quan hệ không giữ nổi (tay nắm Tangent kéo lùi qua chỗ nối, đầu Line bị kéo đè lên gốc…) → **cả thao tác bị từ chối**, mọi hình giữ trạng thái trước, kết quả nói lý do | `sketch.test.js` |
| **R10** | Gỡ quan hệ: hình **đứng yên** (không nhảy), từ đó tự do | `sketch.test.js` |
| **R11** | Chủ là hình **DXF thật** (POINT, đường cắt, đường may): cố định, không bao giờ bị sửa; hình mới bám lên nó đúng như bám lên hình mới | `sketch.3380.test.js` · `check_sketch.py` |

## 4. Cách hiểu của những chỗ requirement để ngỏ

**TD chốt 2026-09-23** (*"G1 G3 G4 G7 đồng ý, giờ đưa vào tool"*):

| # | Chỗ requirement để ngỏ | Đã chốt | Vì sao |
|---|---|---|---|
| G1 | "Curve … kéo control point" — curve loại nào | **Bezier bậc 3**, hai control point kéo riêng; mới tạo thì nằm trên dây cung ở 1/3 · 2/3 | chuẩn của mọi phần mềm vẽ/CAD; một control point (bậc 2) là trường hợp riêng; tiếp tuyến ở **hai** đầu cần hai tay nắm |
| G3 | Rectangle đặt ở đâu, sửa W/H thì phía nào đứng yên | điểm đặt = **góc dưới-trái**, mở sang +X +Y; sửa W/H giữ góc đó; **không xoay** | bảng không có Angle cho Rectangle; góc neo cố định là lối của Gerber/AutoCAD |
| G4 | Polygon "Size" là gì | **đường kính đường tròn ngoại tiếp** (tâm → đỉnh × 2); Angle 0 = **cạnh đáy nằm ngang**, Angle quay ngược KĐH; n = 3…1000; n **không sửa** sau khi tạo | cùng nghĩa với Diameter của Circle; Illustrator/AutoCAD đo theo vòng ngoại tiếp |
| G7 | Snap có tự tạo quan hệ không | **không** — snap đặt chỗ, Coincident phải khai | tách hai rule như TD viết |

**Còn là giả định, chờ TD chốt** — đang chạy như mặc định, cả trong tool Vẽ (`features/draw/draw.md`):

| # | Chỗ requirement để ngỏ | Đang làm | Vì sao |
|---|---|---|---|
| G2 | Kéo đầu mút Curve thì control point của nó ra sao | **đi theo** cùng vector | như Illustrator/CLO: hướng rời đầu mút không đổi khi dời đầu mút |
| G5 | Rectangle/Circle/Polygon kéo được gì | **chỉ vị trí**; đổi kích thước bằng số | đọc sát bảng: "Drag vị trí, sửa W/H" — kéo tay không làm lệch kích thước thật |
| G6 | Line kéo thân | **dời cả đường** | Rule 2 "tùy điểm đang kéo": đầu → dáng, thân → vị trí |
| G8 | Điểm bắt của hình mới | đầu mút · góc · đỉnh · tâm; **không** trung điểm, **không** control point (control point cũng không hít khi kéo) | control point không nằm trên hình; trung điểm không có trong requirement |
| G9 | Line không đầu nào bám mà có khoá hướng/dài — kéo đầu nào thì sao | **đầu đang kéo là đầu chạy**, đầu kia đứng yên; không kéo gì thì Start là gốc | đối xứng, giống bật ortho: kéo đầu nào đầu đó trượt |
| G10 | Line có hướng bị khoá khi gốc dời hay hướng xoay | **giữ chiều dài**: gốc dời thì cả đường dời theo, hướng đổi thì xoay quanh gốc. Chỉ khoá dài (Equal) thì đầu chạy **trượt trên vòng tròn** quanh gốc, đi ít nhất | chiếu vuông góc sẽ làm đường ngắn dần tới 0 khi hướng xoay nhiều lần — không ổn định |
| G11 | Tangent ở đâu, chiều nào | chỉ tại **chỗ nối**: một đầu hình bám bằng Coincident lên hình kia; chiều (tiếp tục hay quay đầu) chọn theo hướng **gần hướng đang có** lúc khai, rồi cố định | tiếp tuyến tại một điểm tự do trên hình là bài toán hai chiều (solver số) |
| G12 | Equal với Curve | Curve chỉ làm **chủ** (Line bằng chiều dài Curve — khớp đường ráp); Curve không bị co giãn theo Equal. Polygon Equal = cùng **Size** (n, Angle riêng) | chưa có luật co giãn một curve mà không đổi dáng TD muốn |
| G13 | Vòng khép kín bằng Line có khoá | **một cạnh phải để tự do** — khoá hết là vòng lặp, bị từ chối | giới hạn của một chiều; khung chữ nhật thì dùng Rectangle |
| G14 | Điểm bám đường khi đường đổi | giữ **tỉ lệ chiều dài t** trên đường chủ | như notch bám cạnh (`pointOn`); tiên đoán được |
| G15 | "…" sau năm quan hệ | **chưa làm**: Parallel · Perpendicular · Concentric · Midpoint · Symmetric · Fixed · Distance · Angle | requirement chỉ nêu tên năm; TD chọn cái nào cần thì thêm, mỗi cái một bậc tự do |

## 5. Ngoài phạm vi của kernel

Canvas / nút trên thanh công cụ / phím tắt (đó là tool Vẽ, `features/draw/draw.md`) · ghi hình mới vào `spec/pattern_spec.json`
(rập thật vẫn chỉ sinh từ dict `P`, INTENT §8) · xoay Rectangle · sửa số cạnh Polygon · solver số hai
chiều (§8) · các quan hệ ở G15.

## 6. Chứng minh — hai thứ cùng xanh (§5.18)

| | Ở đâu | Chạy |
|---|---|---|
| Test tự động | `entity.test.js` (rule 1 · 2 · 4 trên từng loại hình) · `sketch.test.js` (rule 3 · 5 và thao tác chồng lên nhau) · `sketch.3380.test.js` (snap + quan hệ trên rập nhà máy 3380 và file ARC/SPLINE/inch thật) | `node tests/run.js entity` · `node tests/run.js sketch` |
| Trên DXF thật | `scripts/check_sketch.py` → `output/sketch_check.md`: kernel tạo · kéo · khai quan hệ lên 5 file thật rồi **ghi DXF mới**; **ezdxf** đọc lại cả file gốc lẫn file ghi, **vòng lặp Python** đo kích thước, khoảng cách tới POINT/LINE/ARC/SPLINE, góc tiếp tuyến | `python3 scripts/check_sketch.py` |

Expected value luôn đến từ **nguồn khác kernel** (§5.13): công thức đóng viết lại trong test (cạnh lục
giác = bán kính, chu vi πD…), vòng lặp trần trên toạ độ, bộ tính Bezier de Casteljau + tích phân Simpson
riêng của test, toạ độ nhà máy đóng băng trong `tests/fixtures/3380.json`, số đo ezdxf trong
`tests/fixtures/engine/expected.json`.

## 7. Hai loại hình của mảnh mới — Path (đường viền) · Point (notch)

> **Requirement (TD, 2026-09-23), nguyên văn:** *"Test chức năng vẽ, vẽ pattern piece mới, kiểm tra consistency, chia
> code, nhóm code. Tính toán lại thao tác, làm sao để tiện lợi và ít thao tác nhất. so sánh với các tool apparel hiện
> tai"*. Test tool Vẽ lộ ra: nó **không vẽ được một mảnh rập** — một vòng kín thành 4 entity rời, không có notch
> (`features/draw/piece.md` §1). Tool cần hai hình mà bảng năm hình (§2) không có. Chúng là kernel, nên đi đúng luật §5.13:
> spec → test → code, trước khi tool dùng.

Năm hình của bảng giữ nguyên `ENTITY_TYPES`; hai hình này là `PIECE_ENTITY_TYPES = ["path", "point"]`, sketch nhận cả bảy.

| Loại | Lưu (mm) | Tay nắm — kéo thì | Hình kernel | Điểm bắt |
|---|---|---|---|---|
| **Path** — đường viền kín của một mảnh | `pts` (n ≥ 3 điểm) + `kinds` (mỗi điểm `"turn"` hoặc `"curve"`) | `v0…v(n−1)`: **dáng** — đúng điểm đó tới đích, mọi điểm khác không đổi một bit · `body`: **vị trí** | toàn `turn` → polyline kín (như Rect/Polygon); có `curve` → một NURBS bậc 3 ghép từ các đoạn Bezier | n điểm; cạnh thẳng là **line**, đoạn cong là **curve** |
| **Point** — notch, mốc | `p` | `p`, `body`: **vị trí** | điểm | chính nó |

**Luật đường cong của Path (giả định P1, chờ TD):** như rập AAMA/Gerber/Lectra — người vẽ đặt **turn point** (góc) và
**curve point** (điểm mà đường cong đi **qua**), không kéo tay nắm Bezier. Đoạn giữa hai turn point liền nhau là **đường
thẳng tuyệt đối**. Một dãy curve point giữa hai turn point là **một đoạn cong trơn đi qua từng điểm**: spline
Catmull–Rom **centripetal** (α = 0.5 — không tự thắt nút, không vọt lố khi điểm thưa dày khác nhau), đổi ra Bezier bậc 3
từng khúc; ở turn point đầu/cuối đoạn cong, tiếp tuyến lấy theo điểm phản chiếu (đường cong rời góc hướng về curve point
kề). Vòng toàn curve point (không góc nào) là spline khép kín tuần hoàn. Đây cũng là nghĩa của layer 3 *curve point*
trong file AAMA: điểm **nằm trên** đường cong.

| # | Khẳng định | Ca |
|---|---|---|
| **O1** | `createPath(pts, kinds)`: ≥ 3 điểm hữu hạn, hai điểm liền nhau (kể cả cuối → đầu) cách nhau > 1e-9 mm, mỗi `kind` là `turn`/`curve` — sai thì **từ chối**, không ra hình. Không ghi đè mảng của người gọi | `outline.test.js` |
| **O2** | Cạnh giữa hai **turn** liền nhau là **đoạn thẳng tuyệt đối**: mọi điểm lấy mẫu nằm trên dây (≤ 1e-9 mm), chiều dài = khoảng cách hai đầu (±1e-9) | `outline.test.js` |
| **O3** | Đường viền đi **qua đúng** mọi điểm đã đặt, turn lẫn curve (≤ 1e-9 mm, thước độc lập) | `outline.test.js` |
| **O4** | Tại mỗi curve point đường viền **trơn** (G1): hai tay Bezier hai bên thẳng hàng với điểm và ngược chiều | `outline.test.js` |
| **O5** | Tại turn point giữa hai cạnh thẳng, góc giữ **đúng** góc của hai cạnh (không bo) | `outline.test.js` |
| **O6** | Mỗi khúc cong **trùng** spline Catmull–Rom centripetal tính bằng tháp Barry–Goldman riêng của test (≤ 1e-9 mm tại cùng tham số) | `outline.test.js` |
| **O7** | Chu vi = tổng các khúc (thẳng: khoảng cách; cong: Simpson riêng của test, ±1e-6 mm) · diện tích = shoelace của mẫu dày riêng của test (±1e-4 mm²) · chiều quay theo dấu diện tích | `outline.test.js` |
| **O8** | Vòng toàn curve point: tuần hoàn, trơn cả ở chỗ nối đầu–cuối | `outline.test.js` |
| **O9** | Kéo `v_k`: chỉ điểm k đổi; khúc nào không dựa vào điểm k (Catmull–Rom: hai điểm mỗi bên) **không đổi một bit** | `outline.test.js` |
| **O10** | Dời cả path: mọi điểm dời đúng dx, dy; chu vi không đổi (±1e-9) | `outline.test.js` |
| **O11** | Lấy mẫu để **xuất**: mọi điểm đã đặt là một đỉnh của polyline, đúng từng bit; cạnh thẳng chỉ ra hai đầu; đỉnh lấy mẫu lệch đường cong thật ≤ 0.01 mm (thước dày riêng của test); cờ đỉnh nào là turn point | `outline.test.js` |
| **O12** | **Cạnh** của path = khúc giữa hai turn point liền nhau (hay cả vòng khi không có turn nào), kèm chiều dài — để so đường ráp (CLAUDE.md §5.9) | `outline.test.js` |
| **O13** | **Point**: `createPoint(p)` đúng từng bit; kéo / dời chỉ đổi vị trí; bắt vào được; không có kích thước | `entity.test.js` |
| **O14** | Trong sketch: Point **bám lên** Path (Coincident điểm–đường) và **bám theo cạnh của nó** (khúc giữa hai turn point, O12): giữ **tỉ lệ trên cạnh đó** — sửa cạnh khác thì nó **không đổi một bit**; cạnh của nó bị tách/gộp (thêm, bớt góc) thì nó ở điểm của đường viền mới **gần chỗ cũ nhất**. (Bản đầu giữ tỉ lệ t trên *cả vòng* như G14 — bấm thật thấy notch cạnh đáy trượt 1.4 mm khi kéo điểm cong cạnh trên; notch là mốc ráp của một đường may nên phải theo cạnh của nó.) Vòng lặp, Equal, Tangent, Ngang/Dọc lên Path hay Point bị **từ chối** nói lý do; Path không bao giờ là bên bám | `sketch.test.js` |
| **O15** | Hình bắt vào đỉnh / cạnh Path như vào hình khác (B1–B6); kéo đỉnh Path có snap như kéo đầu Line | `sketch.test.js` |
| **O16** | Một điểm trên đường viền ↔ **(cạnh from → to, tỉ lệ trên chiều dài cạnh)**: `outlineLocate` ra chân vuông góc, cạnh và tỉ lệ; `outlineAt` ra lại đúng điểm đó (≤ 1e-9 mm; cạnh thẳng một khúc: đúng từng bit); cạnh không còn → từ chối | `outline.test.js` |
| **O17** | **Điểm cách góc** (notch đúng khoảng cách, piece.md M15): trên một path (`path.js` `chain`) có các góc cho trước, `fromCorner(ch, góc, p, d)` ra điểm nằm trên **cạnh chứa chân vuông góc của p** — khúc giữa hai góc liền nhau; path kín thì khúc vắt qua đầu path cũng là một cạnh, một góc duy nhất thì cả vòng là cạnh; path hở thì hai đầu luôn là góc — cách **góc gần hơn** (đo dọc cạnh; bằng nhau thì góc đầu cạnh) đúng **d đo dọc path**. Không góc, d âm hay không phải số, d dài hơn cạnh → từ chối, câu báo có chiều dài cạnh. `outlineChain(pts, kinds)` là đường viền Path dưới dạng path (mỗi khúc một Line / Bezier, như `outlineSegments`) — góc của nó là các turn point | `corners.test.js` · `outline.test.js` |
