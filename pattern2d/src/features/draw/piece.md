# Spec — Mảnh mới trong tool Vẽ: vẽ một mảnh rập thật, ít thao tác nhất

> **Requirement (TD, 2026-09-23), nguyên văn:** *"Test chức năng vẽ, vẽ pattern piece mới, kiểm tra consistency, chia
> code, nhóm code. Tính toán lại thao tác, làm sao để tiện lợi và ít thao tác nhất. so sánh với các tool apparel hiện
> tai"*.
>
> **Requirement tiếp (TD, 2026-09-23 tối):** *"đồng ý 3 đề xuất bớt thao tác, test trước rồi apply"* — ba đề xuất của §6.2:
> phím 6 / 7 từ bất kỳ đâu (**M13**) · **Thành mảnh** ngay khi vừa vẽ xong hình kín (**M14**) · notch **đúng khoảng cách** từ góc
> (**M15**). Mỗi cái: viết vào đây trước, test viết trước và chạy đỏ, luật cũ chạy trên chính ca thử, rồi mới sửa code.
>
> "Mảnh rập thật" ở đây theo đúng luật của project: **mọi mảnh phải có grainline + notch + tên mảnh + quantity**
> (CLAUDE.md §5.10), khối text `Piece Name` · `SAMPLE SIZE` · `ANNOTATION` · `CATEGORY` · `QUANTITY` (INTENT §4.2), và
> đường cắt layer 1 **là một polyline kín** (ASTM D6673 — `input/research/delete_line.md` §1).

Kernel của hai hình mới (đường viền Path, notch Point) ở `geometry/sketch.md` §7 và `geometry/outline.js`; file này là
phần **tool**: chuột, phím, dock, mảnh, xuất file. Tool vẫn không có luật hình học riêng (draw.md).

## 1. Test tool Vẽ trước khi sửa — cái gì hỏng

Bấm thật trên trình duyệt (BLOCK_36C, cửa sổ 878 × 859) và phát lại bằng macro sự kiện thật (`scratchpad`, cùng thao
tác trên hai bản build phải ra cùng một file). Việc: vẽ một mảnh 4 góc — 2 cạnh thẳng, 2 cạnh cong — trên layer cắt, có
canh sợi, rồi xuất.

| # | Thấy gì | Hậu quả |
|---|---|---|
| **F1** | Chọn layer 7 để vẽ canh sợi **đổi luôn layer của cạnh cong vừa vẽ** — hình vừa vẽ tự được chọn (W4), còn ô Layer đổi layer của hình đang chọn (V10) | đường cắt mất một cạnh, không báo gì; phải bấm Esc + bấm chỗ trống trước (2 thao tác thừa) |
| **F2** | Dung sai snap 0.5 mm ở zoom vừa khung = **0.35 px**. Nối cạnh sau vào đầu cạnh trước phải bấm lại đúng điểm đó: lệch 2 px là hở **3.17 mm** | vòng không khép, trừ khi zoom rất sâu; mỗi góc bấm **hai lần** |
| **F3** | Mọi hình không thuộc mảnh nào dồn vào **một** block `HINH_VE`, không có text nào | hai mảnh mới thành một "mảnh" hai đường cắt; đọc lại: tên `HINH_VE`, SL trống, không `SAMPLE SIZE`/`CATEGORY` |
| **F4** | Hình vẽ trong khung bao của một mảnh có sẵn (hoặc khi đang chọn mảnh đó) **nhập vào mảnh đó** — kể cả hình trên layer 1 | mảnh có sẵn mang **hai đường cắt** (đã thấy: `cup_upper_M` 2 polyline layer 1) |
| **F5** | Đường cắt xuất ra là 2 LINE + 2 POLYLINE hở, không turn point (layer 2), không curve point (layer 3) | CAD theo ASTM không thấy biên mảnh |
| **F6** | Không có cách tạo notch (POINT layer 4), tên mảnh, quantity | vi phạm CLAUDE.md §5.10 |
| **F7** | Chọn xong trong ô Layer, focus **kẹt lại trong ô**: phím `1` (định chuyển Line) đổi layer thành 1, chế độ đứng yên | phải bấm nút bằng chuột |
| **F8** | Gõ số rồi Enter trong ô Length/Angle, focus kẹt lại: phím `2` (định chuyển Curve) thành chữ trong ô | như F7 |

Kết quả: **25 thao tác** cho mảnh 4 góc, **15** cho mảnh chữ nhật 2 × 1 in — và cả hai **không phải mảnh rập**.

## 2. Cách đếm thao tác

Một thao tác = một việc tay làm: một cú bấm (kể cả ⇧ bấm), một cú kéo, một phím, gõ một số vào một ô, một Enter; chọn
trong danh sách = 2 (mở, chọn). Không đếm di chuột, nhìn, nghĩ. Đếm bằng macro sự kiện thật chạy trên bản build — số
trong §6 là số macro đếm, không phải ước lượng.

## 3. Luồng mới

| Việc | Làm thế nào | Thao tác |
|---|---|---|
| Vẽ mảnh bất kỳ | phím **6** (Mảnh) · bấm từng góc (turn point) · **⇧ bấm** điểm trên đường cong (curve point) · bấm lại **điểm đầu**, **double-click** điểm cuối (M2) hay Enter → **mảnh ra ngay**: đường cắt kín, canh sợi, tên, SL | 1 + số điểm + 1 |
| Cạnh đúng kích thước | đang vẽ mảnh: gõ **Length**, **Angle**, Enter → điểm kế tiếp đặt đúng (⇧ Enter: curve point); chữ trong ô được chọn sẵn cho cạnh sau | cạnh đầu 3 (+ bấm vào ô, Tab); cạnh sau 2: Angle · Enter |
| Mảnh chữ nhật / tròn / đa giác | Layer **1** · Rect / Circle / Polygon · gõ số · bấm → **mảnh** | như vẽ hình |
| Hình kín có sẵn thành mảnh | chọn hình · **Thành mảnh** | 2 |
| Notch | phím **7** (Notch) · bấm lên đường cắt (mảnh vẽ hay mảnh DXF) | 1 + 1 mỗi notch |
| Tên · SL · Vải | chọn mảnh · bấm ô Tên · gõ · **Tab** · gõ SL · Tab · gõ Vải · Enter — rời ô (Tab, bấm chỗ khác) cũng là áp | 1 + 2 mỗi ô |
| Sửa dáng | kéo một điểm (notch đi theo) · kéo thân (cả mảnh dời) · **Góc ⇄ Cong** đổi loại điểm đang nắm | 1 |

## 4. Bất biến

| # | Khẳng định | Ca |
|---|---|---|
| **M1** | Chế độ **Mảnh** (nút, phím **6**): bấm → turn point, ⇧ bấm → curve point; mỗi cú bấm snap như mọi cú bấm của Vẽ (V4); bóng xem trước là đường viền tới con trỏ cộng đoạn khép về điểm đầu | `piece.test.js` · trình duyệt |
| **M2** | **Khép**: bấm trong bán kính nhặt (8 px — nhặt, không phải snap, units.md S5) của điểm đầu, hoặc Enter khi đã có ≥ 3 điểm, hoặc **double-click** (TD 2026-09-24: *"cho double click để kết thúc đường vẽ"* → bút Mảnh): cú bấm thứ nhất đặt điểm như thường, cú thứ hai — trong **500 ms** và **5 px** của cú trước (P16) — **khép mảnh** như Enter, không đặt thêm một điểm trùng; dưới 3 điểm → câu báo như Enter, bút giữ điểm; cú thứ nhất đã khép (bấm trúng điểm đầu) → cú thứ hai **không** mở mảnh mới. Trước 2026-09-24 cú thứ hai báo *"điểm này trùng điểm vừa đặt"*, hay đặt một điểm lệch vài px. **Backspace** bỏ điểm cuối, **Esc** bỏ cả mảnh đang vẽ (không tạo gì) | `piece.test.js` · trình duyệt |
| **M3** | Đang vẽ mảnh, ô **Length** + **Angle** + Enter đặt điểm kế tiếp cách điểm cuối đúng Length theo Angle (turn; ⇧ Enter: curve), focus ở lại ô **và chữ trong ô được chọn sẵn** — cạnh sau gõ đè lên, không phải xoá số cũ (§6.2) | `piece.test.js` · trình duyệt |
| **M4** | Khép xong: **một** bước hoàn tác tạo đường viền (Path, layer 1) + canh sợi (Line, layer 7) + bản ghi mảnh (tên `Mảnh N`, SL `1`, vải trống, sample size của file); đường viền được chọn | `piece.test.js` |
| **M5** | Rect · Circle · Polygon vẽ trên **layer 1** ra **mảnh** như M4. Nút **Thành mảnh**: hình kín đang chọn (Rect · Circle · Polygon · Path), layer nào cũng được, thành mảnh (sang layer 1) | `piece.test.js` |
| **M6** | Hình layer 1 **không bao giờ nhập vào mảnh DXF** (mảnh đó đã có đường cắt — F4): hình kín ra mảnh mới (M5), hình hở (Line/Curve) đứng riêng và câu báo khi xuất đếm chúng. **Đổi layer** cũng vậy: hình đã thuộc một mảnh — của file hay mảnh vẽ — không sang layer 1 được (từ chối, nói vì sao; bấm thật 2026-09-24: Line layer 8 trong `cup_upper_M` đổi sang 1 → block ra file có hai đường cắt) | `piece.test.js` |
| **M7** | Chế độ **Notch** (nút, phím **7**): bấm trong bán kính nhặt của một đường cắt — đường viền mảnh vẽ, hay đường layer 1 của mảnh DXF — ra một Point layer 4 **nằm đúng trên đường** (chân vuông góc). Trên mảnh vẽ nó đi theo đường viền (sketch O14); trên mảnh DXF nó vào block của mảnh đó (V11, V13). Mỗi notch một bước hoàn tác; chế độ ở lại · hai đường cắt **cùng một chỗ** (≤ 0.01 mm — hai mảnh chạm mép nhau) → notch vào mảnh mà **vùng** chứa cú bấm (`draw.md` V11 — mỗi mảnh một vùng riêng), không phải đường nào gần hơn một sợi tóc | `piece.test.js` · trình duyệt |
| **M8** | Chọn một mảnh vẽ (đường viền, canh sợi hay notch của nó): dock có ô **Tên · SL · Vải**, **Enter hoặc rời ô** (Tab sang ô sau, bấm chỗ khác) thì áp — một bước hoàn tác, gõ lại đúng giá trị đang có thì không thành bước nào. **SL** nhận số nguyên ≥ 1 (`1` · `2` · `4`) hoặc **R,L** — hai số nguyên ≥ 0, không cùng 0 (`1,0` · `1,1`), cách quanh dấu phẩy bỏ đi: đúng các dạng thư viện dùng (`1` ×257 · `2` ×104 · `1,0` ×70 · `4` ×4 · `1,1` ×3 — 46 file) và ASTM `Quantity: R,L` (piece_ops.md §3); **Tên** không trống; dạng khác bị từ chối — ô đỏ, câu báo, không gì đổi. Readout: tên, SL, vải, chu vi, số góc / điểm cong, số notch, chiều dài từng cạnh (sketch O12) — để so đường ráp (CLAUDE.md §5.9) | `piece.test.js` |
| **M9** | Sửa mảnh vẽ: kéo điểm → đường viền đổi, notch đi theo, canh sợi đứng yên; kéo thân đường viền → **cả mảnh** dời (viền, canh sợi, notch, hình trong mảnh) một bước; **Góc ⇄ Cong** đổi loại điểm đang nắm; Delete khi đường viền đang chọn xoá **cả mảnh** — cùng mọi hình trong mảnh (M17) — và câu báo nói *đã xoá N hình — cả Mảnh k*; hình khác đang bám vào thứ vừa xoá thì câu báo kể tên nó (*… thôi bám*, V9) · **nhích mũi tên / Dời** đường cắt cũng đưa cả mảnh đi (canh sợi, hình trong mảnh; notch theo quan hệ) như kéo — một luật `pieceFollowers` (bấm thật 2026-09-24: trước đó chỉ đường cắt dời) | `piece.test.js` · trình duyệt |
| **M10** | **Xuất**: mỗi mảnh vẽ là **một BLOCK riêng** (`MANH_<n>`, không trùng) gồm **một POLYLINE kín layer 1** (điểm lấy mẫu sketch O11), POINT layer 2 ở mỗi turn point, POINT layer 3 ở mọi đỉnh còn lại (curve point — như BLOCK_36C), POINT layer 4 mỗi notch, LINE layer 7 canh sợi, TEXT layer 8 `Piece Name:` · `SAMPLE SIZE:` · `ANNOTATION:` · `CATEGORY:` · `QUANTITY:` (đúng dạng BLOCK_36C), cộng các hình vẽ vào mảnh đó. Ô trống ghi `KEY:` như `ANNOTATION:` của BLOCK_36C. Trình đọc DXF của viewer đọc lại ra **một mảnh**: đúng tên, SL, vải, sample, đường cắt kín mà mọi đỉnh nằm trên đường viền thật và dây cung lệch nó ≤ 0.01 mm (edit.md X5) — nên chu vi đọc lại là chu vi polyline đó, hụt đường cong thật một chút (đường tròn Ø40: 0.02 mm), canh sợi, notch nằm trên đường cắt | `piece.test.js` · `check_sketch.py` |
| **M11** | Bẫy đã sửa: (a) đang ở chế độ vẽ, ô Layer chỉ đặt layer cho **hình sau**; ở Chọn thì đổi layer hình đang chọn (F1) · (b) chọn xong trong danh sách, focus rời ô (F7) · (c) Enter làm một việc một lần (Line gõ số, sửa kích thước, Dời) xong thì focus rời ô, phím 0–7 lại là phím tắt (F8); ô Length/Angle của Mảnh thì giữ focus (M3) | `piece.test.js` · trình duyệt |
| **M12** | Phím: **6** Mảnh · **7** Notch (W1 thêm hai phím); không phím nào khác đổi | `piece.test.js` |
| **M13** | Phím **6 / 7 mở thẳng Vẽ** ở chế độ **Mảnh / Notch** (và **8** ở **Bút** — `smartpen.md` B1, 2026-10-04) khi tool khác đang bật hay không tool nào bật — một phím thay cho V rồi 6 (§6.2). Đang gõ trong một ô, hay giữ ⌘ · Ctrl · ⌥: không phải phím này. Trong Vẽ 6 / 7 như cũ (M12); **1–5 và 0 vẫn chỉ trong Vẽ**. 6 / 7 / 8 không trùng phím nào khác của viewer (edit.md D11) | `piece.test.js` · `edit.test.js` · trình duyệt |
| **M14** | Nút **Thành mảnh** hiện khi đúng **một hình kín chưa là mảnh** (Rect · Circle · Polygon · Path) đang được chọn — **ở mọi chế độ**, kể cả ngay khi vừa vẽ nó xong trong chế độ Rect / Circle / Polygon (trước đây chỉ ở Chọn: phải về Chọn mới thấy nút). Bấm là thành mảnh như M5, chế độ vẽ giữ nguyên. Các nhóm ô khác của dock không đổi | `piece.test.js` · trình duyệt |
| **M15** | **Notch đúng khoảng cách**: chế độ Notch có ô **Cách góc** (theo đơn vị hiển thị). Ô **trống** = như M7: notch rơi ở chân vuông góc chỗ bấm. Có số **d**: bấm lên một cạnh của đường cắt → notch nằm trên **chính cạnh đó**, cách **góc gần chỗ bấm hơn** đúng **d đo dọc đường cắt** (không phải đường chim bay); bóng xem trước đứng đúng chỗ notch sẽ rơi. Cạnh = khúc giữa hai góc liền nhau: mảnh vẽ — turn point của Path, đỉnh của Rect / Polygon; mảnh DXF — góc như **Edges** đánh chữ (`geometry/corners.js`) trên cả đường cắt (các path layer 1 nối đầu–cuối có chứa chỗ bấm, như Along). d dài hơn cạnh, d âm, hay đường không có góc (hình tròn) → **từ chối**, câu báo nói cạnh dài bao nhiêu, không gì đổi. Số giữ lại cho notch sau — bấm cạnh khác là một notch nữa cùng khoảng cách — tới khi xoá ô. Notch trên mảnh vẽ vẫn đi theo cạnh của nó (O14) | `corners.test.js` · `outline.test.js` · `piece.test.js` · `check_sketch.py` · trình duyệt |

| **M16** | Mảnh phải có **bên trong** (TD 2026-09-24: *"test và fix bug … vẽ pattern"* — bấm thật: ba điểm thẳng hàng dọc ra *"Mảnh 3"*, nơ bướm ra mảnh vắt chéo, ba điểm thẳng hàng ngang báo *"đường dài 0: Start trùng End"*). Khép bút hay **Thành mảnh** một đường viền **mỏng hơn 0.01 mm** (hai lần diện tích chia chu vi — bề rộng của một dải) hay **tự cắt** → từ chối, câu báo nói vì sao, bút giữ nguyên các điểm để sửa (Backspace). Mảnh đã có mà bị kéo thành như thế: readout của mảnh có dòng ⚠, câu báo khi Xuất DXF kể tên nó (`outlineProblem`) | `piece.test.js` · `check_sketch.py` · trình duyệt |
| **M17** | **Hình vẽ vào mảnh vẽ**: Line · Curve · Rect · Circle · Polygon (layer khác 1) vẽ khi mảnh vẽ **đang được chọn**, hoặc cú bấm đầu nằm trong **khung** của mảnh vẽ (khung nhỏ nhất thắng, xét chung với khung các mảnh DXF — W2) thì **thuộc mảnh đó**: kéo thân đường viền thì đi theo, Delete đường viền thì đi cùng, Xuất DXF thì nằm trong block `MANH_n` (M9, M10). Mảnh DXF đang chọn ở bảng mảnh vẫn đi trước. Trước 2026-09-24 hình đó là *"hình vẽ riêng"* — đứng lại khi kéo mảnh, ra file trong `HINH_VE` (`joinTarget`). Hình kín thuộc mảnh vẽ vẫn **Thành mảnh** được — nó rời mảnh cũ thành mảnh riêng | `piece.test.js` · `check_sketch.py` · trình duyệt |
| **M18** | **Thành mảnh giữ hình đúng chỗ đang hiện**: hình thuộc mảnh DXF mà Arrange đã dời nằm ở toạ độ file của mảnh đó (hiện + độ dời, V12); mảnh vẽ ở khung canvas — nên hình được dời đúng độ dời đó khi thành mảnh (bấm thật 2026-09-24: trước đó nhảy lệch 50 mm). Hình có quan hệ với hình khác trên mảnh đã dời thì **từ chối** — dời nó sẽ kéo theo hình ở khung khác; gỡ quan hệ trước (`toPieceShift`) | `piece.test.js` · `check_sketch.py` · trình duyệt |

## 5. Cách hiểu đang dùng — **giả định, chờ TD chốt**

| # | Chỗ requirement để ngỏ | Đang làm | Vì sao |
|---|---|---|---|
| **P1** | Đường cong của mảnh vẽ thế nào | **curve point nằm trên đường cong** (spline Catmull–Rom centripetal qua các điểm), góc là turn point | nghĩa của layer 2/3 AAMA; lối Gerber/Lectra/Richpeace; một cạnh cong = **1** cú ⇧ bấm thay cho 2 cú kéo tay nắm |
| **P2** | Đặt curve point bằng gì | **⇧ bấm** (bấm thường = góc) | không cần đổi chế độ giữa chừng |
| **P3** | Khép mảnh | bấm lại điểm đầu (8 px) · Enter · **double-click** (TD chốt 2026-09-24, M2) | lối CLO / Illustrator (bấm điểm đầu), lối gõ phím, lối double-click của TD |
| **P4** | Canh sợi mặc định | **dọc** (90°), qua tâm khung bao, dài 60 % chiều cao khung | có ngay (CLAUDE.md §5.10); đổi bằng kéo đầu hay ô Angle |
| **P5** | Tên · SL · vải · sample mặc định | `Mảnh N` · `1` · trống · sample của file (dòng `Sample Size`, không thì của mảnh đầu) | đổi được một bước |
| **P6** | Tên block | `MANH_<n>` (ASCII) — tên người đọc nằm ở `Piece Name:` | tên block ASCII không vướng mã hoá khi CAD đọc (edit.md E10) |
| **P7** | Seam allowance | **không có**: layer 1 là mép thành phẩm (dạng "không SA" của ASTM) | tool tạo SA đang chờ TD (`input/research/seam_allowance.md` §5); ASTM khuyên gửi bản không SA khi chưa rõ CAD bên nhận |
| **P8** | Mảnh vẽ ở đâu trước khi xuất | **trong Vẽ** tới khi Xuất DXF (như W10): Edit · Measure · Arrange · Copy chưa thấy; mở file đã xuất thì nó là mảnh của file | cho mảnh vào bản vẽ ngay thì phải chốt cách **xoá mảnh** (`piece_ops.md` §7.4) — mọi lịch sử đang giữ mảnh theo số thứ tự |
| **P9** | Notch trên mảnh DXF khi Edit sửa mảnh đó | đứng yên như lúc đặt (bản chụp, như W9) | Edit và Vẽ không sửa đồ của nhau |
| **P10** | Line/Curve vẽ trên layer 1 | đứng riêng (không vào mảnh DXF), câu báo khi xuất đếm chúng | đường cắt hở một mình không phải mảnh (M6) |
| **P11** | Text của mảnh | layer 8, cao 6 mm, xếp phía trên mảnh | đúng chỗ BLOCK_36C đặt |
| **P12** | "Góc gần hơn" của M15 | đo **dọc cạnh** từ chân vuông góc chỗ bấm tới hai góc của cạnh; bằng nhau thì lấy góc **đầu cạnh** (theo chiều của đường) | lối CLO · Richpeace: bấm cạnh gần góc nào thì đo từ góc đó (§6.2) |
| **P13** | Notch đặt theo khoảng cách, rồi sửa dáng cạnh của nó | giữ **tỉ lệ trên cạnh** như mọi notch vẽ (sketch O14) — **không** giữ khoảng cách | khoảng cách là cách *đặt*; giữ khoảng cách khi cạnh đổi dài là một quan hệ mới — chờ TD |
| **P14** | Ô Cách góc khi mở file khác, khi đổi chế độ | giữ số (như các ô số khác của Vẽ) | một khoảng cách notch thường dùng lại cho nhiều mảnh |
| **P15** | Mảnh DXF có đường may (layer 8 / 14): khoảng cách đo trên đường nào | trên **đường cắt**, từ góc của đường cắt — notch nằm trên đường cắt (M7) | CLO đặt notch trên đường thành phẩm rồi chiếu ra mép SA; muốn thế thì là một cách đo khác — chờ TD |
| **P16** | Double-click là gì (M2) | hai cú bấm cách nhau ≤ **500 ms** và ≤ **5 px** trên màn hình | canvas vẽ lại cả SVG ở mỗi cú bấm, nên trình duyệt không bao giờ bắn `dblclick` — tool tự đếm; 500 ms là mặc định của hệ điều hành, 5 px ≈ độ xê dịch tay của trình duyệt — hai điểm cố ý đặt gần hơn thế trong nửa giây thì hiếm |

## 6. Số thao tác — trước · sau · các tool khác

### 6.1 Viewer, trước và sau (macro sự kiện thật trên bản build, khung 1280 × 860, cùng cách đếm §2)

Đếm theo §2: gõ một ô = 1, không đếm cú bấm vào ô; Xuất DXF = 1. Bảng 6.2 đếm lại theo luật của khảo sát các tool khác.

| Việc | Trước (tool Vẽ cũ) | Sau | Ra cái gì |
|---|---|---|---|
| **T1** mảnh chữ nhật 2 × 1 in, gõ số | 15: V · layer 1 (2) · Rect · W · H · bấm · Esc + bấm trống (tránh F1) · layer 7 (2) · Line · 2 bấm canh sợi · Xuất | **8**: V · 3 · layer 1 (2) · W · H · bấm · Xuất | cũ: polyline + line rời trong `HINH_VE`, không tên/SL · mới: block `MANH_1` — 1 đường cắt kín, 4 turn point, canh sợi, khối text |
| **T2** mảnh 4 góc, 2 cạnh thẳng + 2 cạnh cong, canh sợi | 25: V · layer 1 (2) · Line · 4 bấm · Curve · 4 bấm · 4 kéo tay nắm · Esc + bấm trống · layer 7 (2) · Line · 2 bấm · Xuất — **mỗi góc bấm hai lần**, và ở zoom vừa khung hai lần bấm lệch nhau vài mm (F2) | **10**: V · 6 · 3 góc · ⇧ điểm cong · góc · ⇧ điểm cong · bấm lại điểm đầu · Xuất | cũ: 2 LINE + 2 POLYLINE hở, không phải mảnh · mới: mảnh thật (152 curve point trên đường cắt) |
| **T3** T2 + 2 notch | không làm được | **13** (+ 7 · 2 bấm) | notch nằm đúng trên đường cắt, đi theo cạnh của nó |
| **T4** T2 + tên + SL trái/phải | không làm được | **14** (+ gõ tên · Enter · gõ SL · Enter) | `Piece Name: Nẹp thử` · `QUANTITY: 1,1` |
| **T5** hình vuông 3 × 3 in bằng bút, gõ từng cạnh | không làm được (mỗi cạnh phải bấm lại Start) | **12** (Length một lần, rồi mỗi cạnh chỉ Angle + Enter) — Rect vẫn rẻ hơn: 8 | vuông đúng 76.2 mm |

**Sau ba đề xuất (M13–M15, cùng cách đếm, macro trên bản build):** T1 **7** (V · 3 · W · H · bấm · **Thành mảnh** · Xuất — nút
hiện ngay khi Rect vừa vẽ xong) · T2 **9** (phím **6** từ chỗ chưa bật tool nào · 7 bấm · Xuất) · T3 **12** · T4 **13** · T5 **11** ·
mới — T3 với hai notch **cách góc 1/2 in**: **13** (6 · 7 bấm · 7 · gõ Cách góc · 2 bấm · Xuất; gõ xong bấm luôn lên canvas, không
cần Enter — bấm thật đã thử). Notch rơi đúng (12.7, −150) và (180, −52.7) mm, tính tay.

Thứ tiết kiệm được, theo thứ tự lớn → nhỏ: không bấm lại góc (bút nối cạnh sau vào cạnh trước) · khép vòng là ra mảnh (không
khai 4 quan hệ Trùng, không chọn layer, không vẽ canh sợi) · một cú ⇧ bấm thay hai cú kéo tay nắm cho một cạnh cong · ô Layer
không còn đổi nhầm hình vừa vẽ (bỏ 2 thao tác "Esc + bấm trống") · focus rời ô sau khi chọn/Enter (phím tắt dùng được ngay).

### 6.2 So với các tool apparel hiện có (khảo sát tài liệu, 2026-09-23)

**Nguồn và độ tin.** Hai agent đọc tài liệu của hãng — **không chạy phần mềm nào**. Đọc đủ: CLO (bài help qua API), Richpeace
(sách hướng dẫn V10 · V8 chính hãng), Seamly2D (mã nguồn), AccuMark (help). Đọc một phần: Browzwear · Style3D (help), Optitex
(help hiện đòi đăng nhập — chỉ bản lưu Wayback của wiki 2007–2011 và trang 2018/2025). Modaris: tài liệu hãng nằm sau MyLectra,
chỉ có giáo trình bên thứ ba (V5–V8) và release note V8R5. TUKAcad: không đếm được gì (chỉ có video, khoá học trả tiền); Boke
gần như không; ET một phần chỉ là đoạn trích.

**Luật đếm của khảo sát** (dùng cho cả viewer ở bảng này): một cú bấm · phím · tổ hợp phím · kéo · gõ một giá trị · Enter · mỗi
cấp menu · OK = 1; hộp thoại tự mở = 0; **đưa focus vào một ô không tự focus = 1**; không đếm Xuất. Nên số của viewer ở đây
khác §6.1: bấm vào ô được tính, Xuất không tính, T1 gồm cả tên mảnh.

| Việc | **Viewer** | CLO | AccuMark | Optitex | Modaris | Richpeace | Browzwear | Style3D | Seamly2D |
|---|---|---|---|---|---|---|---|---|---|
| **T1** chữ nhật 2 × 1 in, canh sợi, tên | **11**: V · 3 · W (2) · Tab · H · bấm · **Thành mảnh** · Tên (3) — trước M14 là 12 (qua layer 1); số mặc định đúng 2 × 1 in thì 7 | 11 (+1) | ≈10 + category | 9, canh sợi vẽ tay → ≈17 | ≈20–24 | 12 | 11–13 | ≈12 | 25 |
| **T2** 4 góc, 2 cạnh cong, khép ra mảnh | **8**: **6** · 7 bấm — trước M13 là 9 (V · 6) | 8 | ≈25 (vẽ rồi Trace) | 9 (có hỏi Yes) | ≈14–15 (vẽ rồi Extract) | ≈14 (vẽ rồi cắt) | 6 (+2 chưa rõ) | 8 | 26 |
| **T3** điểm kế tiếp theo Length + Angle | **5** cạnh đầu · **2** cạnh sau | 3 — chỉ Length, hướng theo chuột | 5 — chỉ X/Y | ≈6 | ≈8–10 | 3 ngang/dọc/45° · ≈8 góc bất kỳ | không gõ được khi đang vẽ | 5 | 9 |
| **T4** SA đều cả mảnh | **không có** (P7 · TBC-06) | 2–5 | ≈6–8 | 5 | ≈7–9 | 4 (0 nếu bật tự SA) | 8–9 | 0 (tự) / 2 | 0 (mặc định bật) |
| **T5** 2 notch · đúng khoảng cách | **3** · **4** (7 · bấm ô Cách góc · gõ · bấm; notch sau cùng khoảng +1; trước M15 không có) | 3 · 7 | 3 · 9 | 3–4 · +2 | 3–4 · ≈8–9 | 3 · 7 | ≈7 mỗi cái | ≈8–10 | 9 |
| **T6** tên · SL (trái/phải) · vải | **7** (trước phiên này 9) | ≈12 | ≥ 10 (Model Editor riêng) | ≈8 | ≈16–21 (bảng Variant) | ≈9 | không có ô SL | không có ô SL | 8, không có ô vải |
| **T7** canh sợi · đổi góc | **tự có** · 4 | tự có · 5 | 0–1 | vẽ tay ≈8 | vẽ tay ≈6 | tự có | tự có · 5 | tự có · ≈5 | tự có |

Còn lại, không đếm cho viewer được hoặc viewer chưa có:
- **T8** mảnh từ đường / mảnh có sẵn: viewer chỉ một hình kín (**Thành mảnh**, 2); chưa ghép nhiều Line/Curve, chưa trace mảnh
  DXF. CLO 3–4 · Richpeace 3 · Browzwear 3 · Modaris 4 · AccuMark 5–8.
- **T9** dời một góc: viewer 2 (bấm đường viền · kéo); **dời một đỉnh bằng số: chưa có** (Dời đi cả lựa chọn; Edit không thấy
  hình vẽ — W10). CLO 2, gõ số 5 · Optitex 2 · AccuMark 3 · Modaris 3 · Richpeace 4.
- **T10** snap: mọi tool có ghi dung sai đều ghi bằng **px màn hình** (Richpeace 5–15 px · Optitex "Snap Distance In Pixels" ·
  Browzwear 3–5 px); CLO · AccuMark · Modaris không ghi; Seamly2D không có snap. Viewer đo bằng **đơn vị bản vẽ** (0.02 in /
  0.5 mm — TD chốt, CLAUDE.md §8) — chưa tool nào trong khảo sát làm vậy; đây là dữ kiện cho giả định **D7** (0.5 mm ≈ 1 px ở zoom
  vừa khung). Khép bút và đặt notch của viewer dùng bán kính nhặt 8 px.
- **T11** layer DXF: chỉ Seamly2D công bố bảng layer (L1 đường cắt — là đường SA khi bật SA · L8 đường may, không phải L14 · L4
  notch chỉ khi bật SA · L7 canh sợi · L11 cắt trong; không có L2/L3; xuất ASTM bị tắt trong mã). Các tool khác chỉ có lựa chọn
  AAMA/ASTM, không bảng. Viewer ghi L1 polyline kín · L2 · L3 · L4 · L7 · L8 text như BLOCK_36C (M10).

**Viewer đứng ở đâu** (sau M13–M15). T2 **bằng** tool ít thao tác nhất (CLO · Style3D 8) — trước đó chênh đúng phím V mở tool.
T1 11 ngang CLO (11–12), ít hơn Richpeace · Browzwear · Style3D, AccuMark (thêm category), Optitex (canh sợi vẽ tay), Modaris,
Seamly2D. T5 notch đúng khoảng cách **4** — ít nhất (CLO · Richpeace 7, AccuMark 9). T3 cạnh sau rẻ nhất (2, góc bất kỳ), cạnh đầu
bằng Style3D. T6 ít nhất trong các tool có ghi (7). T7 ngang (tự có). Thiếu: **SA** (T4) · **mảnh từ nhiều đường / trace** (T8) ·
**dời một đỉnh bằng số** (T9).

**Cách tiết kiệm thao tác viewer đã dùng** (khảo sát thấy ở tool khác): khép vòng ra mảnh (CLO · Browzwear · Style3D) · canh
sợi tự có · ⇧ bấm = curve point (Optitex · Modaris · Richpeace; CLO · Style3D dùng Ctrl) · ô số nằm sẵn trên dock, gõ giữa lúc
vẽ (kiểu ET) · notch một cú bấm · một chỗ cho tên / SL / vải (kiểu Optitex · Richpeace). Hai chỗ khảo sát làm lộ và **đã sửa
trong phiên này**: gõ cạnh sau phải xoá số cũ (nay chữ được chọn sẵn, M3) · ô Tên · SL · Vải phải bấm và Enter từng ô, bấm ra
ngoài là mất chữ (nay Tab / rời ô là áp, M8).

**Ba đề xuất đã làm** (TD, 2026-09-23 tối: *"đồng ý 3 đề xuất bớt thao tác, test trước rồi apply"*): phím **6 / 7** từ bất kỳ
đâu (M13) · **Thành mảnh** hiện ngay khi vừa vẽ xong hình kín (M14) · notch **đúng khoảng cách** từ góc gần chỗ bấm, đo dọc đường
cắt (M15). Một đánh đổi của M14: ở khung rộng 1280 px, lúc có hình kín đang được chọn nút này làm dock **thêm một hàng** (89 → 120 px);
bấm thật cho thấy canvas ngang hàng dock vẫn nhận cú bấm. **Còn để ngỏ:** dung sai snap theo px như mọi tool có ghi, hay giữ theo
đơn vị bản vẽ — D7.

**Nguồn chính** (đọc toàn văn trừ khi ghi khác): CLO — support.clo3d.com bài 115000511208 · 115012226887 · 115000511168 ·
115013215727 · 115013214287 · 37494551581593 · 59635504938777 · 115000393188 · 115000493067. AccuMark —
help.gerbertechnology.com/AccuMark/PDS: Group_Piece_Rectangle_Create_Tab1 · Group_Line_Tab_Create_Digitized ·
Group_Piece_Trace_Create_Tab · Function_Create_Piece_Draft · Function_Defineseam · General_Notch_Standard · Preferences_General ·
File_Export_Tab_File; AccuMark_3D/Model_Editor. Optitex — bản Wayback của optitex.com/Help (PDS:Draft_Tool ·
Create_A_Rectangular_Piece · Make_Grainline · Notch_Tool · Move_Point_Dialog) và help.optitex.com (Seam_Tool 2025 ·
Piece_Properties 2025). Modaris — giáo trình Đại học Wollo 2020 (eopcw.com/find/downloadFiles/209) · "Modaris niveau 1" Lycée
Flora Tristan 2016 · congnghemay.info (menu F1–F4, Variant) · release note V8R5 của Lectra. Richpeace —
download.richpeace.cn/CADsoft/fzcad/20190906RP-CAD-V10.pdf và bản V8. Browzwear — help.browzwear.com + support.browzwear.cn.
Style3D — help.style3d.com/studio. Seamly2D — mã nguồn nhánh `develop` (github.com/FashionFreedom/Seamly2D), mặc định kiểm trong
`vcommonsettings.cpp`. **Chưa kiểm được:** focus mặc định trong hộp thoại CLO · Browzwear; AccuMark Rectangle có tự tạo canh sợi
không; Browzwear làm cong cạnh khép thế nào; Optitex tên ô Notch Properties; mọi bảng layer trừ Seamly2D. Nguồn lệch nhau: CLO
bản tiếng Anh và tiếng Nhật về SA (kéo khung); wiki và mã nguồn Seamly2D (dùng mã nguồn); Richpeace sách nói Shift đổi thẳng/cong,
một blog nói chuột phải.

## 7. Ngoài phạm vi

SA (P7) · xoá / chèn điểm trên đường viền · ghép Line/Curve rời thành mảnh · mảnh nửa (mirror line) · xoay · cho mảnh
vẽ vào bản vẽ ngay (P8) · ghi vào `spec/pattern_spec.json` (INTENT §8).
