# Spec — Tool Vẽ (Line · Curve · Rectangle · Circle · Polygon trên canvas)

> **Requirement (TD, 2026-09-23), nguyên văn:** *"G1 G3 G4 G7 đồng ý, giờ đưa vào tool"* — sau khi kernel của
> bảng Line · Curve · Rectangle · Circle · Polygon và 5 rule cốt lõi đã có test và chứng minh
> (`geometry/sketch.md`, `scripts/check_sketch.py`).
>
> Bảng TD đưa (nhắc lại, là thứ tool phải làm được bằng chuột và bằng số):
>
> | Geometry | Cách tạo | Cách edit |
> |---|---|---|
> | Line | Start → End / nhập Length + Angle | Drag endpoint, nhập số |
> | Curve | Start → End → kéo control point | Drag endpoint/control point |
> | Rectangle | W × H | Drag vị trí, sửa W/H |
> | Circle | Diameter | Drag tâm, sửa Diameter |
> | Polygon | Size + số cạnh | Drag vị trí, sửa Size/Angle |
>
> Rule cốt lõi: Create kích thước thật · Drag đổi vị trí/hình dạng tùy điểm kéo · Snap point/line/curve cùng
> unit · Numerical input khi cần chính xác · Constraint Horizontal · Vertical · Tangent · Coincident · Equal.

Tool **không có luật hình học riêng**: mọi hình, mọi phép kéo, sửa số, snap và quan hệ đi qua đúng các hàm đã
chứng minh — `geometry/entity.js` · `geometry/sketch.js` (quyết định đã chốt G1 · G3 · G4 · G7, giả định còn lại
G2 · G5 · G6 · G8–G15 ở `sketch.md` §4). Phần tool thêm vào chỉ là: nhận chuột và số, chọn hình, vẽ lên canvas,
gắn hình vào mảnh, và đưa hình vào file DXF xuất ra.

| | File | Việc |
|---|---|---|
| Luật của tool (thuần, test được) | `draw/flow.js` | hình từ các cú bấm + số đã gõ · bóng xem trước · phím · mảnh nhận hình (`drawTarget`: layer 1 không bao giờ vào mảnh DXF) · ô Layer nói cho ai (`layerApplies`) · khung toạ độ (Arrange) · nhặt tay nắm · đích snap từ các mảnh (khung file, hoặc chỗ đang hiện) · chữ readout · đọc số cạnh |
| Luật của **mảnh mới** (thuần) | `draw/piece.js` | bút Mảnh (khép, cạnh gõ số, bóng) · bản ghi mảnh + tên block + canh sợi mặc định (`pieceFrom`) · chỗ rơi của notch · dòng readout · đỉnh ghi ra file — spec `piece.md` |
| Ra file (thuần) | `draw/out.js` | hình vẽ vào block của mảnh / `HINH_VE` · mảnh vẽ thành block riêng (`pieceBlock`) — `withDrawings` |
| Giao diện | `draw/draw.js` (bộ điều khiển: hình vẽ, lựa chọn, chuột, phím, undo) · `draw/pieces.js` (phần của mảnh: bản ghi mảnh, bút, notch, kéo · xoá · xuất mảnh — nối vào trạng thái của `draw.js` bằng `PieceTool.bind`) · `draw/dock.js` (dock) · `draw/paint.js` (vẽ lên canvas) · `draw.css` | nút **Vẽ** (phím `V`), dock, con trỏ, lớp vẽ, readout, ⌘Z, Xuất DXF |
| Nối vào chỗ khác | `app/app.js` (`ctx.onExport` · `ctx.exportModel`) · `edit/edit.js` (Xuất DXF dùng `ctx.exportModel()`) | một nút Xuất DXF nào cũng ra cùng một file, có hình vẽ và mảnh vẽ |

## 1. Bất biến

| # | Khẳng định | Ca |
|---|---|---|
| **V1** | Nút **Vẽ** trên thanh công cụ, phím **V** bật/tắt; bật lên có dock như Edit. Chế độ: **Chọn · Line · Curve · Rect · Circle · Polygon** (nút, hoặc phím **1–5**; **Esc** về Chọn và bỏ thao tác dở) · **Mảnh · Notch** (phím **6 · 7**, `piece.md`). Dock chỉ hiện nhóm ô đúng lúc cần (Quan hệ · Dời khi đang Chọn một hình; Layer trừ khi đang vẽ mảnh/notch) — dock nằm đè lên canvas | trình duyệt |
| **V2** | **Tạo đúng bảng**: Line = bấm Start → bấm End, hoặc bấm Start rồi gõ **Length + Angle**, Enter · Curve = bấm Start → bấm End → curve mới được chọn, hai control point hiện ra để kéo (G1) · Rect = gõ **W × H**, bấm → góc dưới-trái tại chỗ bấm (G3) · Circle = gõ **Diameter**, bấm → tâm · Polygon = gõ **Size + số cạnh** (+ Angle), bấm → tâm (G4). Hình ra từ chính `createLine` · `createLinePolar` · `createCurve` · `createRect` · `createCircle` · `createPolygon` — kích thước thật, từng bit | `draw.test.js` |
| **V3** | Trước cú bấm cuối, **bóng xem trước** (nét đứt) là đúng hình sẽ ra nếu bấm tại con trỏ | `draw.test.js` |
| **V4** | **Snap** mọi cú bấm và mọi điểm kéo: vào POINT, đỉnh, đường của mảnh đang hiện và vào điểm của hình đã vẽ (đầu mút · góc · đỉnh · tâm), dung sai `ctx.snapTol()` — 0.02 in / 0.5 mm theo **file**, file không khai đơn vị thì không snap (units.md §3); dấu hít hiện trên canvas, readout ghi point · line · curve. Control point không hít (G8). Snap chỉ đặt chỗ (G7) — **đích là thứ đang hiện**, đưa về khung của mảnh nhận hình (trừ độ dời Arrange của mảnh đó — `framedTargets`): trước 2026-09-24 mỗi mảnh ở khung file của chính nó, nên hình riêng / hình của mảnh khác không hít được notch của mảnh đã dời ở chỗ đang hiện mà lại hít vào chỗ trống nơi nó từng nằm · **chỉ hít trong mảnh của nó** (TD 2026-09-24: *"không hít vào mảnh khác, trừ khi vẽ tiếp tục trên piece đó, mỗi piece phải có vùng riêng, không lẫn vào nhau"*): hình của mảnh P — đang vẽ hay đang kéo — chỉ hít POINT · đỉnh · đường của mảnh DXF P, hoặc đường viền · notch · canh sợi của mảnh vẽ P, và các hình vẽ của P; **hình riêng** chỉ hít hình riêng. Mảnh của hình là mảnh của cú bấm đầu (V11) — bấm vào mảnh khác là vẽ trên mảnh đó, và hít mảnh đó. Trước 2026-09-24 mọi hình hít mọi mảnh. **Bút Mảnh** (mảnh mới) vẫn hít mọi thứ đang hiện (`piece.md` M1 — TD chỉ chọn hình trong mảnh) | `draw.test.js` · `check_sketch.py` · trình duyệt |
| **V5** | **Kéo** (mọi chế độ): nắm tay nắm của hình đang chọn → kéo theo luật `sketch.drag` (đầu line/curve · control point đổi dáng; hình cứng chỉ dời; quan hệ có tiếng nói). Ở chế độ Chọn: bấm vào một hình → chọn và kéo **vị trí**; ⇧ thêm/bớt; bấm chỗ trống → bỏ chọn, kéo là pan. Tay nắm của hình đang chọn được nhặt trước, rồi tới điểm của mọi hình, rồi tới thân hình (bán kính nhặt 8 px — nhặt không phải snap, units.md S5) · kéo cũng hít vào thứ đang hiện **của mảnh hình đó** (V4): tool đưa các đích đó vào khung của hình đang kéo và `sketch.drag({own: false})` | `draw.test.js` |
| **V6** | **Sửa số**: chọn đúng một hình → ô số hiện kích thước của nó (Line Length/Angle · Rect W/H · Circle D · Polygon Size/Angle), gõ theo đơn vị hiển thị, Enter → `sketch.setDim`; bị quan hệ khoá thì từ chối, nói lý do. **Dời** một đoạn theo hướng (Distance + Hướng). Số hỏng → ô đỏ, hình không đổi | `draw.test.js` · trình duyệt |
| **V7** | **Quan hệ**: **Ngang · Dọc** cho line đang chọn (hoặc control point đang nắm của curve) · **Trùng**: nắm điểm bám (đầu mút, góc, tâm) → bấm Trùng → bấm điểm hay đường làm chủ (hình vẽ hoặc DXF) · **Tiếp tuyến**: line/curve đang chọn, chủ là thứ đầu nối của nó đang bám · **Bằng**: chọn hình bám → bấm Bằng → bấm hình chủ (hình vẽ cùng loại, hoặc đường DXF cho line) · **Gỡ**: bỏ mọi quan hệ mà hình đang chọn là bên bám. Readout liệt kê quan hệ của hình đang chọn · **chủ phải cùng mảnh với hình bám** (V4 — mỗi mảnh một vùng riêng): bấm điểm / đường / hình của mảnh khác làm chủ → **từ chối**, câu báo nói nó thuộc mảnh nào · **Trùng · Tiếp tuyến · Bằng** giữa hai hình vẽ thuộc hai khung Arrange đang bày lệch nhau → **từ chối** (quan hệ giữ theo file, trên màn hình sẽ lệch đúng độ dời — `frameClash`); chủ là điểm/đường DXF: bản chụp ở chỗ đang hiện | `draw.test.js` · trình duyệt |
| **V8** | **⌘Z** khi Vẽ bật hoàn tác một bước của Vẽ (tạo · kéo · sửa số · dời · khai/gỡ quan hệ · xoá · đổi layer), không đụng lịch sử của Edit hay Arrange | trình duyệt |
| **V9** | **Delete / Backspace** xoá hình đang chọn cùng quan hệ của nó; hình bám vào nó đứng yên — và câu báo **nói rõ** hình nào thôi bám, mảnh nào bị xoá cả (`deletedText`; `delete_line.md` §3: nói rõ ai đang dùng) · Vẽ bật mà chưa chọn hình nào: Delete **không** xoá mảnh DXF đang chọn ở bảng mảnh — xoá mảnh DXF là việc của Edit hay khi không tool nào bật (`pieces/remove.md` R1) | `piece.test.js` L1 · trình duyệt |
| **V10** | **Layer**: ô chọn layer (8 mặc định · 1 · 7 · 11); hình mới nhận layer đang chọn; ở chế độ **Chọn**, đổi layer khi đang chọn hình thì đổi layer của hình đó — **đang vẽ thì chỉ đổi layer cho hình sau** (hình vừa vẽ tự được chọn, đổi theo là đổi nhầm: `piece.md` F1, M11); chọn xong focus rời ô. Hình **thuộc một mảnh** (của file hay mảnh vẽ) không đổi sang **layer 1** được — mảnh đó đã có đường cắt (M6; bấm thật 2026-09-24: `cup_upper_M` ra file với hai đường cắt) — `layerRefusal`. Hình vẽ luôn hiện bằng màu của layer (8 nét đứt), trừ khi layer đó đang tắt — layer tắt thì hình của nó không nhặt được và **rời khỏi lựa chọn**: Delete, mũi tên hay quan hệ không bao giờ đụng vào hình không nhìn thấy · hình **đang vẽ dở** (Line · Curve đã bấm Start) giữ layer lúc bấm cú đầu — layer đó đã chọn mảnh cho nó (`madeLayer`; fuzz 2026-09-24: Start ở 8 trong SONASHAPE-MESH_L, đổi 1 trước End → block có hai đường cắt) | `draw.test.js` |
| **V11** | **Gắn vào mảnh — chỗ bấm quyết định** (TD 2026-09-24): hình mới thuộc mảnh có **vùng** chứa cú bấm đầu — vùng = bên trong **đường cắt kín** của mảnh (mảnh DXF: đường cắt viewer dựng, `p.cut`; mảnh vẽ: đường viền của nó; mảnh không có đường cắt kín: khung bao) — **kể cả khi đang chọn mảnh khác**. Vùng chồng nhau (rập lồng nhiều size): mảnh **đang chọn** trong số đó, không thì vùng **nhỏ nhất**. Không vùng nào chứa: cú bấm cách đường cắt của một mảnh ≤ bán kính nhặt (8 px) → mảnh đó (gần nhất); không nữa → mảnh DXF đang chọn, rồi mảnh vẽ đang chọn; không nữa → **hình vẽ riêng** (`joinTarget`, `piece.md` M17). Trước 2026-09-24: mảnh đang chọn luôn thắng, rồi **khung bao** nhỏ nhất — quét thư viện: 3.4 % cú bấm nằm hẳn trong đường cắt một mảnh bị gán sang mảnh khác (SofyLift 12.5 %, VeraLifting 10.5 %). Trừ **layer 1**: không bao giờ vào mảnh nào — hình kín thành **mảnh mới**, hình hở đứng riêng (`piece.md` M5, M6) | `draw.test.js` · `piece.test.js` · `check_sketch.py` |
| **V12** | **Arrange**: hình giữ toạ độ **của file**; hiện tại chỗ mảnh của nó đang được bày (+ ox, oy) — dời mảnh bằng Arrange thì hình đi theo, file xuất không đổi | `draw.test.js` · `check_sketch.py` |
| **V13** | **Xuất DXF** (nút ở dock Vẽ, và nút của Edit) ghi một file MỚI có cả hình vẽ: mỗi hình nằm **trong BLOCK của mảnh nó**, đúng layer của nó; LINE cho Line, POLYLINE cho hình còn lại (Curve · Circle lấy mẫu ≤ 0.01 mm, edit.md X5); hình vẽ riêng vào một block mới **`HINH_VE`**; hình của một mảnh đã **xoá** không ra file (`pieces/remove.md` R4). File gốc không bị đụng; model đang mở không bị đổi | `draw.test.js` · `check_sketch.py` |
| **V14** | Tool không bao giờ sửa hình của DXF đang mở (mảnh, POINT, đường) — chỉ sửa hình của chính nó. Mở file khác → hình vẽ và lịch sử của Vẽ về trống | `draw.test.js` |

## 2. Cách hiểu đang dùng — **giả định, chờ TD chốt**

| # | Chỗ requirement để ngỏ | Đang làm | Vì sao |
|---|---|---|---|
| W1 | Tên, phím | nút **Vẽ**, phím **V**; trong tool: **1–5** chọn loại hình, **6** Mảnh, **7** Notch (6 / 7 từ tool khác cũng mở thẳng Vẽ ở Mảnh / Notch — piece.md M13), **Esc** về Chọn, **Delete** xoá, **⌘Z** hoàn tác (giữ 80 bước, như Edit và Arrange) | V chưa phím nào dùng; số không trùng phím nào của viewer |
| W2 | Hình mới thuộc mảnh nào | **TD chốt 2026-09-24 — V11**: chỗ bấm quyết định (vùng = bên trong đường cắt), mảnh đang chọn chỉ khi bấm ngoài mọi mảnh hay giữa các vùng chồng nhau → hình vẽ riêng (block `HINH_VE` khi xuất) | — |
| W3 | Layer | mặc định **8** (đường trong/đường may theo từ vựng layer của viewer), chọn được **1 · 7 · 11**; hình kín trên **1** là mảnh mới (`piece.md` M5) | layer 8 là đường trong của AAMA; đường cắt · canh sợi · lỗ khoan là ba thứ hay vẽ thêm |
| W4 | Vẽ xong một hình thì sao | hình mới **được chọn**, tool **ở lại** loại hình đó để vẽ tiếp | lối của CAD; Esc hay Chọn để thôi |
| W5 | Số mặc định cho hình mới | W 2 in × H 1 in · D 3/8 in · Size 1 in · 6 cạnh · Angle 0 · Length 2 in · Angle line 0 — giữ số vừa gõ cho hình sau, mở file mới không đổi | cỡ hay dùng trên rập; gõ lại là đổi |
| W6 | Trùng · Bằng chọn chủ thế nào | **chọn bên bám → bấm quan hệ → bấm chủ**; bán kính bấm chủ là bán kính nhặt (8 px), không phải dung sai snap | 0.5 mm ≈ 1 px ở zoom vừa khung — không bấm trúng được |
| W7 | Tiếp tuyến với cái gì | với thứ mà đầu nối của hình đang **bám** (Coincident đã khai); hai đầu cùng bám thì đầu đang nắm | Tangent chỉ tại chỗ nối (G11) |
| W8 | Gỡ bỏ quan hệ nào | mọi quan hệ mà hình đang chọn là **bên bám**; quan hệ của hình khác bám vào nó giữ nguyên | "gỡ quan hệ của hình này" |
| W9 | Quan hệ với hình DXF khi DXF bị Edit sửa sau đó | hình vẽ giữ chỗ **như lúc khai** (chủ DXF là bản chụp); không đi theo | Edit và Vẽ không sửa đồ của nhau; muốn theo thì khai lại |
| W10 | Measure · Edit có thấy hình vẽ không | **không** — hình vẽ thành hình của DXF khi xuất ra; đo hình vẽ bằng readout của Vẽ | hai tool không giẫm lên nhau (Edit đọc quan hệ từ mảnh, sẽ kéo cả hình vẽ đi) |
| W11 | Hình vẽ khi tool tắt | vẫn **hiện**, không nhặt được | là một phần của bản vẽ sẽ xuất |

## 3. Ngoài phạm vi

Ghi hình vẽ vào `spec/pattern_spec.json` (rập thật chỉ sinh từ dict `P`, INTENT §8) · cho Edit/Measure sửa hay đo
hình vẽ trước khi xuất (W10) · lưu hình vẽ qua lần mở sau · các quan hệ ở G15.

## 4. Chứng minh

| | Ở đâu | Chạy |
|---|---|---|
| Test tự động | `draw.test.js` — luật của tool trong `flow.js`, expected từ hình học tay và từ trình đọc DXF của viewer đọc lại file ghi ra | `node tests/run.js draw` |
| Trên DXF thật | `scripts/check_sketch.py` — phần "tool Vẽ", trên cả 5 file thật của phần kernel (METRIC · inch · GBK · toàn SPLINE, một bản vẽ không có block): Arrange dời mảnh, bấm năm hình ở chỗ mảnh **đang hiện** (Circle bấm sát một POINT thật), kéo control point, bấm một hình ngoài mọi mảnh, xuất như nút Xuất DXF; ezdxf đọc lại: hình nằm đúng block (hay modelspace khi bản vẽ không có block), đúng layer, đúng toạ độ **của file** dựng lại từ POINT của file gốc; hình rời vào `HINH_VE`; phần còn lại của mảnh ghi y như khi chưa dời | `python3 scripts/check_sketch.py` |
| Bấm thật | trình duyệt: từng loại hình bằng chuột và bằng số, kéo, snap, 5 quan hệ, ⌘Z, xoá, layer, xuất rồi đọc lại | — |
