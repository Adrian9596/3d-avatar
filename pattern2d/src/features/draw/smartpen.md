# Spec — Bút (smart pen) trong tool Vẽ

> **Requirement (TD, 2026-10-04), nguyên văn:** *"theo bạn smart pen là như thế nào"* → câu trả lời dưới → *"ok áp dụng vào
> tool và push sau khi hoàn thành"*.
>
> Câu trả lời TD đã đồng ý — nay là requirement của file này:
> - Smart pen là **智能笔** của Richpeace (phím F; sách hướng dẫn V10 chính hãng, tr. 64–66): **một cây bút làm ~20 việc, ngữ
>   cảnh quyết định việc** — bấm vào đâu (chỗ trống · điểm · đường), bấm kiểu gì (bấm · kéo · khoanh), chuột trái hay phải, có
>   giữ Shift không. Người làm rập vẽ hết một bộ rập mà không phải đổi tool.
> - **"Smart" không nằm ở chỗ nhồi nhiều việc vào một nút, mà ở ba điều:** (1) **cho thấy trước việc sắp làm** — bóng hình +
>   chữ, ví dụ "song song 6 mm"; điểm yếu của cách Richpeace là phải thuộc tổ hợp phím, bấm lệch một chút là ra việc khác, và
>   nó **dựa nhiều vào chuột phải — trên web và trackpad Mac thì khó dùng**; (2) **gõ số được bất cứ lúc nào** — rập là con số,
>   không phải nét tay; (3) **hít điểm theo thứ tự ưu tiên rõ ràng**, mỗi thao tác là **một bước ⌘Z**.
> - Viewer 2D: chức năng nằm rải ở Vẽ và Edit, chưa gộp thành một bút. **Chưa có:** đường song song (nền để làm SA), compa,
>   thước tam giác, các thao tác pen, điểm lệch bằng số.

Kernel của Bút ở `geometry/sketch.md` §8 (đường hở — hình **Đường**) và `geometry/construct.md` (song song · compa · thước ·
điểm lệch · cạnh của một đường). File này là phần **tool**: chuột, phím, dock, cái gì hiện ra trước, cái gì vào bản vẽ. Như cả
tool Vẽ, Bút **không có luật hình học riêng** (draw.md).

## 1. Ngữ pháp — bấm vào đâu, bấm kiểu gì

Chế độ **Bút** của Vẽ: nút **Bút** trong dock, phím **8**; từ tool khác hay khi chưa bật tool nào, **8** mở thẳng Vẽ ở Bút (như
6 · 7, piece.md M13). Chỉ chuột trái, ⇧ và bàn phím — **không chuột phải** (lý do ở requirement).

| Cử chỉ | Bắt đầu ở | Việc | Số gõ |
|---|---|---|---|
| bấm | bất kỳ đâu | đặt **điểm góc** của đường đang vẽ — chưa có đường thì là điểm đầu | **Length + Angle**, Enter = điểm kế tiếp |
| ⇧ bấm | | đặt **điểm cong** — đường cong đi **qua** nó (như bút Mảnh, P1) | ⇧ Enter |
| bấm lại **điểm đầu** (≥ 3 điểm) | | **khép**: layer 1 ra **mảnh mới**, layer khác ra một **đường kín** | |
| **Enter** · **double-click** | | **xong đường hở** (≥ 2 điểm): 2 điểm ra **Line**, nhiều hơn ra **Đường** | |
| kéo | một **cạnh** | **song song** với cạnh đó, về phía con trỏ | **Cách** |
| kéo | một **điểm** | thả lên một **đường** → **compa**: đoạn từ điểm tới đường · thả chỗ khác → **Line** từ điểm tới chỗ thả | **Compa** |
| ⇧ kéo | A → B | **thước tam giác**: các điểm sau của đường đi **song song** hay **vuông góc** AB | Length |
| phím **H** | | **thước ngang** bật / tắt: các điểm sau đi ngang · dọc · 45° | Length |
| ô **dx · dy** có số | | **điểm lệch**: điểm đầu của đường = chỗ bấm (đã hít) + (dx, dy) | dx · dy |
| kéo | chỗ trống | **pan** — như mọi tool | |

## 2. Bất biến

| # | Khẳng định | Ca |
|---|---|---|
| **B1** | **Chế độ · phím**: nút **Bút** (nhóm riêng sau Mảnh · Notch), phím **8** trong Vẽ; **8** từ tool khác / khi chưa bật tool nào mở thẳng Vẽ ở Bút — đang gõ trong ô, hay giữ ⌘ · Ctrl · ⌥: không phải phím này (như M13). **Esc** bỏ việc đang dở (đường, thước tam giác) và về Chọn, như mọi chế độ của Vẽ (V1); đổi chế độ, tắt tool, mở file khác, ⌘Z: bỏ việc đang dở. 8 không trùng phím nào khác của viewer (edit.md D11) | `smart.test.js` · `edit.test.js` · `smartpen.test.js` |
| **B2** | **Điểm của đường**: một cú bấm (không kéo quá `DRAG_PX`) đặt một điểm ở chỗ **nhấn**, **hít** như mọi cú bấm của Vẽ (V4: điểm › đường › tự do, dung sai `ctx.snapTol()`; chỉ hít trong **vùng** của mảnh nhận đường — mảnh của cú bấm đầu, V11; layer 1 hít mọi thứ đang hiện, như bút Mảnh M1); **⇧ bấm**: điểm cong. Điểm trùng điểm vừa đặt (≤ 1e-9 mm) → không đặt, câu báo. **Backspace** bỏ điểm cuối. Đặt điểm chưa đổi bản vẽ — không là một bước ⌘Z | `smartpen.test.js` |
| **B3** | **Xong đường hở**: **Enter**, hoặc **double-click** — cú thứ hai trong 500 ms và 5 px của cú trước (P16) không đặt thêm điểm — khi có ≥ 2 điểm → **một hình, một bước ⌘Z**: 2 điểm → **Line** (`createLine`, từng bit); ≥ 3 điểm → **Đường** (`createPolyline`, sketch.md §8: thẳng tuyệt đối giữa hai góc, cong Catmull–Rom qua điểm cong; hai đầu luôn là góc). < 2 điểm → câu báo, không gì đổi. Đường vào mảnh của cú bấm đầu (V11), trên layer lúc bấm cú đầu (V10 `madeLayer`), được chọn sau khi xong | `smart.test.js` · `smartpen.test.js` |
| **B4** | **Khép**: bấm trong bán kính nhặt (8 px — nhặt, không phải snap) của **điểm đầu** khi có ≥ 3 điểm → hình kín `createPath` (đúng các điểm và loại điểm đã đặt). **Layer 1** → **mảnh mới** như bút Mảnh (M4: đường cắt kín, canh sợi, tên, SL; mảnh không có bên trong → từ chối, bút giữ điểm — M16). Layer khác → một **đường kín** của mảnh nhận đường. Một bước ⌘Z | `smartpen.test.js` |
| **B5** | **Gõ số**: **Length + Angle**, Enter → điểm kế tiếp cách điểm cuối **đúng Length theo Angle** (⇧ Enter: điểm cong); chữ trong ô được chọn sẵn cho cạnh sau (M3). Đang có thước (B9 · B10): hướng là **hướng thước gần con trỏ nhất**, ô Angle không dùng — bảng số nói rõ. Chưa có điểm nào → câu báo | `smartpen.test.js` |
| **B6** | **Song song** (等距线): nhấn trong bán kính nhặt của một **cạnh** — khúc giữa hai góc, đúng cạnh mà **Edges** đánh chữ và **Edit** chọn (`edit/select.js` `edgesOf` cho đường của file; cùng định nghĩa góc `geometry/corners.js` cho hình vẽ, `construct.md` K1); đường không góc: cả đường — mà không có điểm (B7) nào gần hơn, kéo, thả → đường **song song với chính cạnh đó**, về **phía con trỏ**, cách đúng **Cách** nếu ô có số, không thì đúng khoảng từ con trỏ tới cạnh lúc thả. Ra: cạnh thẳng (≤ 0.01 mm) → **Line**; cạnh cong → **Đường**; Circle vẽ → **Circle** đồng tâm (D ± 2·Cách); cung DXF → cung đồng tâm; vòng kín không góc → **đường kín** (`construct.md` K2). Cách = 0, con trỏ nằm trên cạnh (không biết phía nào), hay song song phía trong làm đường co mất (d ≥ bán kính, phía trong một khúc hẹp hơn 2d) → **từ chối**, nói vì sao. Đường mới vào **mảnh của cạnh gốc**, layer theo ô Layer (layer 1: đứng riêng, M6). Một bước ⌘Z. Cạnh gốc không đổi một bit (V14) | `smart.test.js` · `smartpen.test.js` · `construct.test.js` · DXF thật |
| **B7** | **Điểm để kéo**: nhấn trong bán kính nhặt (8 px) của một **điểm có nghĩa** trong vùng: POINT layer **2 · 4 · 5** (turn · notch · grade), **góc** của đường (như Edit), **đầu** đường hở; của hình vẽ: góc theo cùng định nghĩa (đầu Line / Curve / Đường, góc Rect · Polygon · đường kín) và tâm Circle · Polygon. **Không** gồm POINT layer 3 và đỉnh giữa của polyline dày — ở zoom vừa khung chúng phủ kín đường cong, kéo trên đường cong phải ra song song. Có điểm trong bán kính thì **điểm thắng cạnh** (V4) | `smart.test.js` |
| **B8** | **Compa** (圆规): nhấn trên một điểm (B7), kéo, thả **trên một đường** (bán kính nhặt, **cùng vùng**) → **Line** từ điểm đó tới chỗ **vòng tròn tâm điểm, bán kính R** cắt đường ấy — giao điểm **gần chỗ thả nhất**; R = ô **Compa** nếu có số, không thì khoảng từ điểm tới chỗ thả. Không cắt (R ngắn hơn khoảng ngắn nhất từ điểm tới đường, hay dài hơn khoảng xa nhất) → **từ chối**, câu báo có khoảng ngắn nhất. Thả **không trên đường** → Line từ điểm tới chỗ thả (hít như B2); có R thì Line dài **đúng R** theo hướng đó. Đường đích thuộc mảnh khác → từ chối (V4 — mỗi mảnh một vùng). Một bước ⌘Z | `smart.test.js` · `smartpen.test.js` · `construct.test.js` · DXF thật |
| **B9** | **Thước tam giác** (三角板): **⇧ nhấn, kéo** từ A tới B (cả hai đã hít như B2 — mọi thứ đang hiện; một hướng, không phải một điểm hít, nên V4 không áp), thả, \|AB\| > 0 → thước: hướng AB, vẽ nét đứt qua A–B. Tới khi **đường đang vẽ xong** (hay Esc, thước khác, phím H): mỗi điểm sau điểm đầu đi theo một trong bốn hướng **±AB, ±⊥AB** — hướng **gần hướng con trỏ nhất** — cách điểm trước đúng **hình chiếu** của con trỏ lên hướng đó (hay Length, B5). Chưa vẽ gì thì thước dành cho đường kế tiếp. Đặt thước không đổi bản vẽ — không là một bước ⌘Z | `construct.test.js` · `smartpen.test.js` |
| **B10** | **Thước ngang** (丁字尺): phím **H** (trong Bút, không đang gõ, không ⌘ · Ctrl · ⌥) bật / tắt: mỗi điểm sau điểm đầu đi theo một trong **8 hướng ngang · dọc · 45°** gần hướng con trỏ nhất, cách đúng hình chiếu (hay Length). Hướng 0° · 90° · 180° · 270° đúng tuyệt đối (dx hay dy = 0, không phải 6e-15). Bật thước ngang tắt thước tam giác và ngược lại; thước ngang giữ qua các đường tới khi bấm H lại | `construct.test.js` · `smartpen.test.js` |
| **B11** | **Điểm lệch** (偏移点): ô **dx · dy** — theo đơn vị hiển thị, số âm được (`-1/4`), trống = 0 — có số khác 0 thì **điểm đầu** của đường = chỗ bấm đã hít (B2) **+ (dx, dy)**; bóng: vòng ở chỗ hít, chấm ở điểm lệch, nét chấm nối hai điểm. Các điểm sau không lệch. Số hỏng → ô đỏ, bấm không đặt gì. Số giữ cho đường sau tới khi xoá (như Cách góc, P14) | `smart.test.js` · `smartpen.test.js` |
| **B12** | **Cho thấy trước**: trước mỗi cú bấm và suốt lúc kéo, canvas có **bóng** (nét đứt) **đúng hình sẽ ra** và một **nhãn** cạnh con trỏ nói việc sẽ làm — *điểm đầu* · *điểm* · *điểm cong* · *khép → mảnh* · *xong: Enter / double-click* · *song song · 6.00 mm* · *compa · 2.000 in* · *∥ thước* · *⊥ thước* · *ngang* · *lệch …*; rê chuột trên một điểm / cạnh khi chưa vẽ gì thì nhãn nói luôn **kéo** sẽ làm gì (*kéo: song song* · *kéo: compa*). Bóng và cú bấm / lúc thả hỏi **cùng một hàm**, nên bóng đứng đúng chỗ hình rơi. Bảng số có dòng **Sắp làm** (cùng chữ), **Hướng** (tự do · thước ngang · thước tam giác), **Đang vẽ** (n điểm) | `smart.test.js` · `smartpen.test.js` · trình duyệt |
| **B13** | **Một việc một bước ⌘Z**: xong đường, khép, song song, compa — mỗi cái đúng một bước; ⌘Z đưa bản vẽ về **đúng** trước đó. Đặt điểm, thước, ô số không phải bước | `smartpen.test.js` |
| **B14** | **Ra file** (V13): Đường → POLYLINE — điểm đã đặt là đỉnh, **từng bit**; đoạn cong lấy mẫu ≤ 0.01 mm (như O11); Line → LINE; đường kín → POLYLINE kín; vào block của mảnh. Trình đọc DXF của viewer đọc lại: mỗi đỉnh nằm trên hình (≤ 0.01 mm) | `smartpen.test.js` · DXF thật |
| **B15** | Không bao giờ sửa hình của DXF đang mở (V14): song song, compa chỉ **đọc** đường của file | `smartpen.test.js` |

## 3. Cách hiểu đang dùng — **giả định, chờ TD chốt**

| # | Chỗ requirement để ngỏ | Đang làm | Vì sao |
|---|---|---|---|
| **Q1** | Phím | **8** cho Bút; 8 từ tool khác mở thẳng Vẽ ở Bút; **H** thước ngang | 1–7 đã dùng; 8 nối tiếp; H chưa phím nào dùng |
| **Q2** | Kéo trên đường song song với cái gì | **một cạnh** (giữa hai góc như Edges), không phải cả đường; vòng không góc thì cả vòng | rập 36C để SA **từng đường** (TBC-06); cạnh là thứ Edges / Edit đã đánh chữ |
| **Q3** | Khoảng song song khi ô Cách trống | khoảng từ con trỏ tới cạnh lúc thả, **không hít, không làm tròn** | muốn số tròn thì gõ Cách |
| **Q4** | Đường song song khi cạnh gốc đổi sau đó | **bản chụp** — đứng yên | như W9 · P9: Vẽ và Edit không sửa đồ của nhau |
| **Q5** | Đầu đường song song | **tự do**: vuông góc với cạnh gốc ở hai đầu | chạm hai đường bên cạnh là N3 |
| **Q6** | Kéo từ điểm, thả không trên đường | **Line** tới chỗ thả (Compa có số: dài đúng số) | kéo từ một điểm ra một đoạn là ý tự nhiên nhất |
| **Q7** | Thước tam giác sống bao lâu | tới hết **đường đang vẽ** (chưa vẽ: đường kế tiếp) | 三角板 của Richpeace là việc một lần |
| **Q8** | Ô Cách · Compa · dx · dy qua các đường, qua mở file | **giữ số** tới khi xoá | như Cách góc (P14) |
| **Q9** | Đường dày (song song của cạnh cong: hàng trăm đỉnh) khi chọn | chỉ hiện và nắm **tay nắm cách nhau ≥ 2 bán kính nhặt** (16 px), luôn có hai đầu | trăm chấm chồng nhau không bấm được; kéo một đỉnh của đường song song ít khi có nghĩa |
| **Q10** | Double-click trong Bút | **xong đường hở** (như Enter); khép là bấm điểm đầu | Bút vẽ cả đường hở; bút Mảnh (M2) thì mọi đường đều kín nên double-click khép |
| **Q11** | Điểm có nghĩa để kéo (B7) | không gồm POINT layer 3 và đỉnh giữa của polyline | xem B7 |

## 4. Chưa làm — và vì sao

| # | Việc | Vì sao chưa |
|---|---|---|
| **N1** | **Thao tác pen** — 转省 xoay pen · 收省 thu pen · 加省山 đầu pen | chúng **sửa đường cắt** của mảnh có sẵn — việc của Edit (V14: Vẽ không sửa hình của file); cần TD chốt xoay quanh đỉnh nào, phần nào đi theo, đường may đi theo ra sao |
| **N2** | **Compa đôi** (双圆规: hai điểm, hai độ dài → điểm thứ ba) | cần chọn phía và hai ô số — đề xuất bước sau |
| **N3** | **Song song chạm hai đường** (相交等距线: đầu cắt / kéo tới hai đường bên cạnh) | phía trong (đường trong mảnh) và phía ngoài (SA — góc là giao của hai đường song song) cần hai luật khác nhau; chờ TD |
| **N4** | Sửa đường của file bằng Bút — 靠边 trim / extend · 剪断 / 连接 tách / nối · 调整 sửa dáng | đã có ở **Edit** (T X K J); gộp Vẽ và Sửa một chế độ TD chưa chọn (2026-09-30) |
| **N5** | Chuột phải | không dùng — requirement |
| **N6** | Kéo trên chỗ trống ra chữ nhật (Richpeace) | ở đây kéo chỗ trống là **pan**, để kéo màn hình được ở mọi chế độ (canvas.js); chữ nhật: Rect (3) |
| **N7** | Hít hướng tự động khi gần ngang / dọc | thay bằng **thước ngang bật tắt** (B10) — dễ đoán hơn một luật hít ngầm |

## 5. Chứng minh

| | Ở đâu | Chạy |
|---|---|---|
| Test tự động — kernel | `geometry/construct.test.js` (K1–K6) · `outline.test.js` · `entity.test.js` · `sketch.test.js` (+ Đường, sketch.md §8) — kỳ vọng từ hình học tay và vòng lặp trần | `node tests/run.js construct` · `outline` · `entity` · `sketch` |
| Test tự động — tool | `draw/smart.test.js` (luật thuần) · `draw/smartpen.test.js` (controller thật trên mảnh dựng tay, không đọc dữ liệu riêng) — viết trước, đỏ trước | `node tests/run.js smart` |
| Trên DXF thật | checker tạm (ezdxf, thư mục tạm — không commit, §5.18): song song từng cạnh thật của thư viện — mọi đỉnh cách cạnh gốc đúng d theo **thước Python riêng**; compa — giao điểm cách tâm đúng R và nằm trên đường; xuất rồi đọc lại bằng ezdxf | PR ghi N/N |
| Bấm thật | trình duyệt (Chrome headless, sự kiện chuột thật): mọi dòng của §1, ⌘Z, xuất | — |
