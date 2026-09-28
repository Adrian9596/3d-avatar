# Spec — Edit DXF theo 4 lớp

> **Requirement (TD, 2026-09-23), nguyên văn:**
>
> tổ chức edit DXF theo 4 lớp:
> 1. Select → chọn Piece / Line / Point / Curve.
> 2. Direct Edit → kéo, move, trim, extend, split, join.
> 3. Precise Edit → nhập Length / Distance / Angle
>
> **TD trả lời thêm cùng ngày** (tin nhắn ghi 4 lớp nhưng mới có 3):
> - Lớp 4 = **Constraint (quan hệ)** — *"sửa một hình thì các hình phụ thuộc tự cập nhật qua solver
>   đang có: đường may bám offset của đường cắt, notch bám cạnh, grainline kéo tới biên."*
> - Kết quả = **xuất DXF mới** (AAMA, METRIC), **không bao giờ ghi đè bản gốc**. Với `BLOCK_36C`, file
>   xuất ra là bản sửa tay, không còn sinh từ dict `P`, nên **không phải deliverable** (INTENT §8).

Nguồn sự thật cho tool **Edit** của viewer (`src/features/edit/`) và cho các phần kernel nó dựa vào.
Mỗi bất biến ở §2–§6 có ít nhất một test; cột *Ca* ghi test nào khoá nó.

## 1. Bốn lớp — lớp trên chỉ dựa vào lớp dưới

| Lớp | Việc | Ở đâu | Không được |
|---|---|---|---|
| 1 · Select | con trỏ đang chỉ vào cái gì: **Piece · Line · Point · Curve** | `edit/select.js` · `geometry/corners.js` | sửa hình |
| 2 · Direct Edit | **kéo · move · trim · extend · split · join** bằng chuột | `geometry/deform.js` · `edit/ops.js` | tự dựng quan hệ |
| 3 · Precise Edit | gõ **Length · Distance · Angle** | `geometry/deform.js` · `edit/ops.js` | đoán đơn vị |
| 4 · Constraint | hình phụ thuộc tự theo: đường may · điểm · grainline | `geometry/rules.js` (`follow` · `attach` · `reach`) · `edit/relate.js` · solver sẵn có | thay hình gốc bằng hình dựng lại |
| Xuất | DXF mới, AAMA, METRIC | `dxf/write.js` | ghi đè |

Lớp 2 và lớp 3 là **hai cách nhập cùng một phép**: mọi thao tác trên một đường, cuối cùng, là "vài
đỉnh góc dời đi một vector" (luật *deform*, §3). Kéo tay tới đúng chỗ và gõ số ra chỗ đó phải cho
**cùng một hình**, từng bit.

Mọi con số ở **mm** trong kernel (CLAUDE.md §5.17). Canvas chỉ đổi chỗ bấm px → mm; bán kính **chọn**
là px trên màn hình (như Geom, Pieces — chọn không phải snap, `shared/units.md` S5), còn **snap** khi
kéo là dung sai của bản vẽ (0.02 in / 0.5 mm, `units.md` §3).

## 2. Lớp 1 — Select

**Định nghĩa**

- **Góc** (corner) của một đường: cùng định nghĩa với Edges — đổi hướng > 26° đo trên cửa sổ 7 mm,
  cạnh ngắn hơn 12 mm nhập vào cạnh kề. Từ nay nằm ở `geometry/corners.js`; `edges/segment.js` gọi nó,
  nên cạnh Edges ghi số và cạnh Edit chọn được là **một**. Đường kín dưới 8 đỉnh: góc = đỉnh đổi hướng > 26° — cả
  với Edges từ 2026-09-24 (trước đó Edges để nguyên một cạnh, dài bằng đường hở — `edges/edges.md` H3). Đường hở: hai đầu mút luôn là góc.
- **Point** = entity POINT của layer đang bật · góc của một đường · đầu mút của đường hở.
  Đỉnh nằm giữa một cạnh cong là điểm lấy mẫu của đường cong, không phải "điểm" của rập — chỉ nắm được
  khi cạnh chứa nó đang được chọn (hiện thành tay nắm nhỏ).
- **Line** = cạnh thẳng: entity LINE, hoặc đoạn giữa hai góc liền nhau mà mọi đỉnh cách dây cung ≤ 0.01 mm.
- **Curve** = cạnh không thẳng; ARC · CIRCLE · SPLINE là một Curve nguyên khối.
- **Piece** = cả mảnh.

| # | Khẳng định | Ca |
|---|---|---|
| **S1** | Bấm → thứ gần nhất trong bán kính chọn (8 px đổi ra mm theo zoom), ưu tiên **Point > Line/Curve > Piece** | `select.test.js` |
| **S2** | Bộ lọc **Tất cả · Piece · Line · Point · Curve** chỉ cho chọn loại đó | `select.test.js` |
| **S3** | Line / Curve phân theo độ thẳng 0.01 mm; LINE luôn là Line; ARC · SPLINE luôn là Curve | `select.test.js` |
| **S4** | ⇧ bấm thêm/bớt; bấm chỗ trống bỏ chọn; chọn không đổi một bit hình học | `select.test.js` |
| **S5** | Góc của đường kín ≥ 8 đỉnh **trùng khít** góc của Edges trên rập thật | `corners.test.js` |

## 3. Lớp 2 — Direct Edit

**Luật deform** — nền của mọi thao tác trên đường (`geometry/deform.js`). Cho độ dời của một số góc;
mỗi cạnh giữa hai góc liền nhau A → B, với độ dời dA, dB:

- dA = dB → cạnh **tịnh tiến** dA;
- dA ≠ dB → cạnh chịu **phép đồng dạng** T (xoay + phóng đều + dời) với T(A) = A + dA, T(B) = B + dB.
  Cạnh thẳng vẫn thẳng; cạnh cong **giữ dáng**, co giãn quanh góc kia;
- cạnh không có góc nào dời: **không đổi một bit**.

| Thao tác | Làm gì |
|---|---|
| **kéo** | nắm một Point → dời tới con trỏ, snap theo dung sai bản vẽ (không snap vào chính đường đang sửa). Góc: hai cạnh kề theo luật deform. POINT tự do: dời thẳng. POINT đang bám một đường: **trượt dọc đường đó**. Đỉnh giữa cạnh cong (cạnh đang chọn): chỉ đỉnh đó |
| **move** | kéo trên thứ đang chọn → tịnh tiến tất cả (Line · Curve · Piece, một hay nhiều); cạnh không chọn nối vào theo luật deform. Mũi tên: 1 mm, ⇧ 10 mm |
| **Trim / Extend** | một nút (phím **T** hoặc **X**): bấm **đường 1 cần sửa** trước, gần đầu muốn sửa; bấm **đường 2 làm đích** sau. Tự rút ngắn hoặc kéo dài đúng đầu đã chọn tới giao điểm gần nhất, đầu kia đứng yên. Xong một cặp thì chờ đường 1 của cặp tiếp theo — D14–D20 |
| **split** | chế độ Split (phím **K**): bấm lên Line/Curve (điểm bấm có snap) → đường hở: thành **hai entity**; đường kín: thêm đỉnh (nếu chưa có) và **một góc mới** — cạnh tách đôi, hình không đổi |
| **join** | chọn hai Line/Curve (⇧) rồi Join (phím **J**) → hai đường hở chạm đầu (≤ dung sai snap) thành **một** (hai LINE thẳng hàng → một LINE, còn lại → POLYLINE); hai cạnh liền nhau của cùng một đường → **bỏ góc** giữa chúng |

| # | Khẳng định | Ca |
|---|---|---|
| **D1** | Deform giữ đường **liền**: đỉnh chung của hai cạnh kề luôn trùng nhau | `deform.test.js` |
| **D2** | Cạnh không có góc nào dời không đổi một bit | `deform.test.js` |
| **D3** | Tịnh tiến giữ chiều dài mọi cạnh; kéo góc: cạnh thẳng vẫn thẳng, cạnh cong đồng dạng (tỉ số chiều dài = tỉ số dây cung) | `deform.test.js` |
| **D4** | Split không đổi hình (chu vi, diện tích, mọi đỉnh cũ); Join không đổi hình | `ops.test.js` |
| **D5** | Trim/extend cho đúng số của `ops.trim`/`ops.extend` (EDIT-03…06); đường **kín** → từ chối, nói lý do | `ops.test.js` |
| **D6** | Không có gì để cắt / chặn / nối → không đổi gì, nói lý do | `ops.test.js` |
| **D7** | Undo trả mảnh về **từng bit** như trước thao tác | `ops.test.js` |
| **D8** | Đường 2 là **cả entity được bấm**; nếu bấm đường cắt layer 1 thì là **cả đường cắt của mảnh** (mọi entity layer 1). Đường 1 không bao giờ tự làm đích. Bấm một cạnh của đường 1 chọn đầu mút của **cả đường hở**, không chỉ đầu cạnh con | `ops.test.js` · `trim-extend.test.js` |
| **D9** | Mỗi cặp bấm sửa **đường 1 rồi đường 2**. Thành công → bỏ trạng thái chờ, sẵn sàng cặp mới; không giữ đường 2 cho lần sửa sau. Thất bại → giữ đường 1 để chọn lại đích. Esc/đổi chế độ/đổi file/xoá mảnh/Undo huỷ trạng thái chờ | `trim-extend-controller.test.js` |
| **D10** | Extend một đầu **đã nằm trên** vật chặn (≤ 0.01 mm) → từ chối, nói lý do, hình không đổi — không nhảy qua phần ngoài mảnh tới một khúc khác của đường cắt | `ops.test.js` · `check_edit.py` |
| **D12** | Một đường hở mà **hai đầu trùng nhau** (vẽ như một vòng — lỗ khoan layer 11 của DM1192, vòng layer 14 của SN1252) là đường **kín** với Trim · Extend → từ chối, nói lý do. Trước đây bấm vào "một đầu" thì đầu kia chạy: hai đầu ở cùng một chỗ, chọn đầu nào là tuỳ | `ops.test.js` · `check_edit.py` |
| **D13** | Khúc vật cắt mà chính đường đang sửa **nằm chồng lên** (đường vẽ trùng lên mép — layer 84 của SONASHAPE, DM1192 chép lại đúng các đỉnh của đường cắt) **không phải chỗ cắt**: chỉ tính chỗ đường ấy thật sự cắt hay chạm vật cắt. Trước đây mỗi đỉnh chung là một "giao điểm" — trim bỏ một khúc giữa hai đỉnh | `ops.test.js` · `check_edit.py` |
| **D11** | Phím **T** và **X** cùng mở **Trim / Extend**; bấm lại một trong hai khi đang ở chế độ đó → Kéo. **K** Split, **J** Join giữ nguyên. Phím kèm ⌘/Ctrl/⌥ hoặc đang gõ input không kích hoạt | `edit.test.js` |

### Trim / Extend — requirement TD 2026-09-26

“tạo lại logic cho trim và extend thành một nút duy nhất. Click vào đường muốn trim hoặc extend,
click đường thứ 2 mà đường thẳng đó sẽ giao, sau đó 1 sẽ trim hoặc extend đến đường 2.”

| # | Hợp đồng thao tác và hình học |
|---|---|
| **D14** | Chỉ một nút **Trim / Extend**. Click 1 chỉ chọn, không đổi geometry/history; hiện cả đường và đầu mút sẽ sửa, hướng dẫn click đường 2. |
| **D15** | Đầu mút gần click 1 là đầu di chuyển (bằng nhau → đầu cuối). Đầu còn lại giữ nguyên. Toạ độ/giao điểm tính trong Geometry Engine, mm. |
| **D16** | Tìm giao điểm trên đường 2 **hữu hạn**, dọc đường 1 hiện có và phần kéo dài đầu đã chọn. Chọn giao điểm có đoạn sửa ngắn nhất, đo dọc đường 1; trong đường → trim, phía kéo dài → extend. Nếu bằng nhau ưu tiên trim. Không vượt qua đầu cố định, không làm đường dài 0, không cắt một khúc giữa thành hai entity. Đây là cách hiểu mặc định của trường hợp nhiều giao điểm, đã hỏi TD. |
| **D17** | Đường 2 không đổi. Chỉ một đầu đường 1 thay đổi, phần còn giữ dáng theo phép cắt/kéo dài cũ; một bước Undo khôi phục geometry trước cả cặp bấm. Giữ layer, không thay đường 2 hay entity khác. |
| **D18** | Song song, trùng đường, không chạm được theo hướng đã chọn, hoặc đầu đó đã trên đích (≤ 0.01 mm) → từ chối và nói lý do, không geometry/history. Đường kín hoặc layer 1 làm đường 1 vẫn từ chối; có thể làm đường 2. |
| **D19** | Click chỗ trống không mất đường 1 đang chờ; click chính đường 1 không sửa nó; cho chọn lại đường 2 sau lỗi. Không dùng selection cũ làm click 1. |
| **D20** | Kiểm từng nhánh trim/extend ở cả hai đầu, nhiều giao điểm, hướng không hợp lệ, đường kín, đích nhiều entity, thao tác liên tiếp, hủy, Undo, xuất/mở DXF. DXF thật phải được oracle độc lập đối chiếu. |

Các hàm trim/extend riêng của kernel vẫn giữ để kiểm hình học và dùng bởi Geom; luồng UI cũ được thay bởi D14–D20.


## 4. Lớp 3 — Precise Edit

Một cạnh A → M: **A đứng yên, M chạy**. M là đầu **gần chỗ bấm** lúc chọn cạnh (nút ⇄ đổi đầu).

| Ô | Chọn | Làm gì |
|---|---|---|
| **Length** L | Line · Curve | M' = A + k·(M − A), k = L / chiều dài cạnh — thẳng: trượt dọc; cong: phóng đồng dạng quanh A. Chiều dài cạnh sau = **L** |
| **Angle** θ | Line · Curve | xoay quanh A để dây cung A → M có hướng θ |
| **Distance** d + **Angle** θ | Point · Piece | dời một đoạn d theo hướng θ |

Góc: **độ, ngược chiều kim đồng hồ từ trục +X** (hướng 3 giờ). Ô độ dài theo **đơn vị hiển thị**
(inch mặc định) — gõ `3/8`, `1 1/4`, hậu tố `mm` `cm` `in` `"` như mọi ô khác (`units.md` U6); ô góc
nhận `30`, `30°`, `-45`. Chữ hỏng → ô đỏ, không làm gì. File không khai đơn vị: độ dài là đơn vị bản vẽ.

Ô **Length** còn nhận **số gia**: chữ bắt đầu bằng `+` hay `-` là **cộng / trừ** vào chiều dài cạnh đang có —
`+1/4` (đang hiển thị inch) là dài thêm 1/4 in, `-3mm` là ngắn đi 3 mm; không dấu là **đặt** chiều dài. Một cạnh
dài âm là vô nghĩa, nên dấu trừ không có nghĩa nào khác.

| # | Khẳng định | Ca |
|---|---|---|
| **P1** | Length: chiều dài cạnh sau = L (±1e-9 mm); A không dời | `deform.test.js` · `ops.test.js` |
| **P2** | Angle: hướng dây cung sau = θ (±1e-9°); chiều dài cạnh không đổi | `deform.test.js` · `ops.test.js` |
| **P3** | Distance: \|P' − P\| = d và hướng θ | `ops.test.js` |
| **P4** | Gõ số = kéo tay tới đúng chỗ đó: hai đường ra cùng một hình | `ops.test.js` |
| **P5** | Ô số đọc theo đơn vị hiển thị: gõ `1` khi đang inch = 25.4 mm | `ops.test.js` |
| **P6** | Số âm / 0 cho Length, chữ hỏng → từ chối, hình không đổi | `ops.test.js` |
| **P7** | Length **số gia**: `+d` / `-d` → chiều dài sau = chiều dài **lúc đó** ± d (±1e-9 mm), d đọc như mọi ô độ dài (phân số, hỗn số, hậu tố); `+0.25` khi đang inch là **dài thêm** 0.25 in — trước đây là *đặt* dài 0.25 in. Kết quả không > 0, hai dấu, dấu đứng một mình, chưa chọn cạnh → từ chối, giữ số cũ, hình không đổi | `edit.test.js` · `check_edit.py` |
| **P8** | Ô Length · Angle và readout luôn là số **của chính cạnh đang chọn** — kể cả cạnh cong nguyên khối (ARC · SPLINE): chiều dài đúng của nó, hướng dây cung từ đầu đứng yên tới đầu chạy. Trước đây ô giữ số của cạnh chọn trước — Enter là đặt cạnh này theo số của cạnh kia | `edit.test.js` |
| **P9** | Length · Angle trên một đường **kín nguyên khối** (CIRCLE, SPLINE kín — hai đầu trùng nhau, không có đầu chạy) → từ chối, nói lý do, hình không đổi. Trước đây Length báo "đã đặt chiều dài" mà không đổi gì | `ops.test.js` · `check_edit.py` |

## 5. Lớp 4 — Constraint

Đầu mỗi thao tác (một lần kéo, một lần áp số, một trim/extend/split/join), quan hệ được **đọc từ chính
mảnh** như nó đang là — không áp một hình dựng sẵn — rồi dựng thành tài liệu hình học (`doc.js`) cho
solver sẵn có chạy: **nút nguồn** = đường cắt, đường trong không chạm biên, điểm tự do; **nút dẫn
xuất** = đường may, điểm bám, đường chạm biên.

| Quan hệ | Nhận ra khi | Rule | Theo thế nào |
|---|---|---|---|
| **Đường may bám đường cắt** | đường **layer 14** (đường may theo ASTM D6673 / AAMA — Bianca, SofyLift, strike cost…) hay **layer 8** (nhà máy Richpeace, 3380, BLOCK_36C đặt đường may ở đó; theo chuẩn layer 8 là *đường bên trong*) nằm trọn trong 30 mm quanh đường cắt **và chạy theo nó**: vòng kín thì dài ít nhất **nửa** vòng cắt nó nằm trong (đi quanh mảnh — đường may thật của thư viện dài 88–99 %); đường hở thì **có đoạn** chạy song song (±20°) với đoạn cắt gần nhất. Không thế thì là **hình vẽ trên mảnh** — vòng nhỏ bên trong (VeraLifting 11_64: vị trí đệm, 7–12 % vòng cắt, cách mép 14–24 mm), vạch cắt ngang mép (SofyLift, 468 đường 2 đỉnh của thư viện): nó đứng yên (C7), đầu chạm biên thì theo luật chạm biên (C11) | `follow` | mỗi đỉnh may neo vào đoạn cắt **gần nhất trong số các đoạn chạy song song với đường may ở đó** (±20°) — chỉ "gần nhất" thì sai ở góc SA không đều: 3380 后比 để 7 mm cạnh bên, 1.6 mm cạnh trên, đỉnh may sát góc gần đường của cạnh trên hơn cạnh của chính nó. Neo = chân neo (§ *luật chân neo*) + độ lệch dọc/ngang trong hệ trục đoạn đó. Đỉnh may **là góc** (bẻ > 10°) → giữ bởi **hai cạnh** chạy theo hai nhánh của nó, kề nhau hay không (góc cắt vẽ vát), ở đúng khoảng lùi tới từng cạnh. **Đoạn song song chỉ được chọn khi nó không xa hơn khoảng lùi lớn nhất mà chính đường ấy có ở chỗ nó chạy song song với đường cắt, cộng 1 mm** (*khoảng lùi thật* — đo ở trung điểm từng đoạn của đường ấy, tới đoạn cắt gần nhất khi đoạn cắt đó song song ±20°); xa hơn thế → đoạn gần nhất. Một đường layer 8 không phải đường may — đường viền ren của 3380 杯口 chạy 3–5 mm dưới mép thẳng — có đỉnh "song song" với mép cong bên kia mảnh, cách 20–29 mm: nó bám mép nó nằm cạnh (C8) |
| **Notch / điểm bám đường** | POINT cách một đường của mảnh ≤ 0.01 mm (ưu tiên đường cắt, rồi đường may) | `attach` | theo chân neo trên đoạn đó |
| **Đường chạm biên** (grainline, đường trong) | đầu mút một đường hở nằm trên đường cắt ≤ 0.01 mm, **đúng chỗ** chính đường ấy cắt đường cắt | `reach` | đầu đó đi dọc hướng của chính đường ấy tới chỗ đường ấy cắt **chính phần đường cắt nó đang nằm trên** (đoạn đó, hoặc đoạn gần nhất quanh nó mà đường ấy cắt — như notch bám đoạn của nó; "giao điểm gần chỗ cũ nhất" sai khi sửa dời mép quá nửa bề ngang: dây 8 mm dịch 4.2 mm thì mép bên kia gần hơn, viền 6 mm nâng mép trên 8 mm thì mép dưới gần hơn). Biên lùi vào **quá đỉnh kề** của đầu đó (đường gấp khúc có đoạn cuối ngắn — VeraLifting, Bianca để 1 mm) → đầu đó **lùi dọc theo chính đường ấy** tới chỗ đường ấy cắt biên mới; các đỉnh bị vượt qua dồn về đó (C9). Không bao giờ gập ngược đoạn cuối |
| **Đường nằm trên biên** | mọi đỉnh và trung điểm từng đoạn của một đường hở nằm trên đường cắt ≤ 0.01 mm — BLOCK_36C vẽ grainline của wing và cradle ngay trên mép đáy band | `follow` | đi theo đường cắt như một đường may SA 0; LINE vẫn là LINE |

**Luật chân neo** — một điểm nằm trên đoạn A → B cách A một đoạn dA và cách B một đoạn dB: sau thao tác,
nếu chỉ B dời thì giữ **dA** (giữ khoảng cách tới đầu đứng yên); chỉ A dời thì giữ **dB**; cả hai dời thì
theo **tỉ lệ**; không đầu nào dời thì đứng yên.

| # | Khẳng định | Ca |
|---|---|---|
| **C1** | Chưa sửa gì → dựng quan hệ rồi giải lại cho **đúng từng đỉnh** (±1e-9 mm) | `relate.test.js` |
| **C2** | Sau kéo góc · Length · Angle · move cạnh: mọi đỉnh may giữ đúng **khoảng lùi cũ của chính nó** (±0.01 mm) — SA không đều của nhà máy (1.6–7.1 mm) và SA 0 mm mép thun của BLOCK_36C được giữ, không bị thay bằng một offset đều. *Khoảng lùi của một đỉnh may* = khoảng cách tới phần đường cắt **chạy song song với đường may ở đó** (±20°): ở góc cắt vẽ vát, điểm gần nhất của đường cắt là đoạn vát chứ không phải cạnh mà đường may lùi từ đó. Toàn thư viện (`check_edit.py`): vòng đường may kín, ở mọi đỉnh mà đoạn cắt gần nhất chạy song song — thước độc lập đó chính xác tới **0.05 mm** trên cạnh cong bị phóng (đoạn gần nhất có khi chuyển sang đoạn kề), kernel giữ khoảng lùi tới chính đoạn neo tới 1e-12 mm | `relate.test.js` · `check_edit.py` |
| **C3** | Notch còn trên đường cắt (≤ 0.01 mm); cạnh chỉ dời một đầu → notch giữ khoảng cách tới đầu đứng yên | `relate.test.js` |
| **C4** | Grainline chạm biên vẫn chạm biên (≤ 0.01 mm) và **không đổi hướng**; đường nằm trên biên vẫn nằm trên biên | `relate.test.js` |
| **C5** | Dời cả mảnh: mọi thứ dời đúng một vector, không méo; chiều dài đường cắt · đường may, khung bao giữ **từng bit** trong lúc kéo (dời theo, không đo lại — 3380 杯面 đo lại lệch 2.3e-13 mm mỗi khung) | `relate.test.js` · `ops.test.js` · `check_edit.py` |
| **C6** | Quan hệ gãy (grainline hết cắt biên) → nút đó `failed`, giữ hình cũ, readout nói rõ; phần còn lại vẫn cập nhật | `relate.test.js` |
| **C7** | Điểm và đường không chạm gì: **đứng yên** khi sửa đường khác | `relate.test.js` |
| **C8** | Một đường layer 8 nằm dọc một cạnh bám **chính cạnh đó**: 3380 杯口, kéo góc không chạm mép thẳng → cả 107 đỉnh của đường viền ren (đỉnh nào cũng gần mép thẳng nhất) **không nhúc nhích**; đường may thật vẫn giữ SA không đều ở góc (C2) | `relate.test.js` · `anchor.test.js` · `check_edit.py` |
| **C9** | Đường chạm biên **không bao giờ gập ngược**: đầu chạm biên luôn nằm phía trước đỉnh kề của nó theo hướng cũ, hoặc — khi biên lùi qua đỉnh kề — trên chính đường ấy, chỗ nó cắt biên mới, các đỉnh bị vượt dồn về đó. Biên lùi qua **cả** đường → `failed` (C6) | `anchor.test.js` · `check_edit.py` |
| **C10** | Đường **suy biến** (polyline một đỉnh, LINE dài 0 — lỗ khoan / dấu vẽ bằng đường: MHG568, DM7549) không làm hỏng việc đọc quan hệ: nó đứng yên như C7, **cả mảnh vẫn sửa được** | `relate.test.js` · `check_edit.py` |
| **C11** | Hình vẽ trên mảnh không bị **méo** khi sửa đường cắt: vòng nhỏ layer 8 bên trong đứng yên từng bit; vạch layer 8 cắt ngang mép giữ đầu trên mép và giữ hướng (luật chạm biên) — không neo từng đỉnh vào những đoạn cắt khác nhau | `relate.test.js` · `anchor.test.js` · `check_edit.py` |
| **C12** | Đường may **layer 14** (ASTM D6673: *sew line*) bám đường cắt như đường may layer 8: kéo góc → mỗi đỉnh giữ SA của chính nó; vòng nhỏ layer 14 bên trong vẫn đứng yên (cùng luật C11). Trước đây chỉ layer 8 được đọc là đường may — 33/48 file thư viện đặt đường may ở layer 14, sửa mép thì đường may đứng yên | `relate.test.js` · `check_edit.py` |
| **C13** | Mũi đường may trong một **khe chữ V hẹp** của đường cắt (hai nhánh chạy theo hai mép khe, hai mép lệch nhau < 20° — LiftyBliss P18-LACE, mũi cách hai mép ~5 mm) được giữ bởi **cả hai mép**, mỗi nhánh với mép nó chạy theo: dời một mép → mũi giữ đúng khoảng lùi tới cả hai. Trước đây hai nhánh, hỏi từ chính mũi, cùng chọn một mép — mép kia dời vào thì SA hụt 0.33–0.56 mm | `anchor.test.js` · `check_edit.py` |
| **C14** | Một đường may **không bị xé**: đỉnh nào cách **gần bằng nhau** (chênh ≤ 1 mm) tới hai phần xa nhau của đường cắt — đường chạy giữa một khúc hẹp, cách đều hai mép (SN1252 đường 6: khúc rộng 24 mm, cách hai mép 12 mm) — bám **cùng phía với các đỉnh kề nó**. Dời một mép → cả khúc đi theo một mép, không có đỉnh nào nhảy riêng. Chỗ đường rõ ràng gần một mép hơn (chênh > 1 mm) vẫn theo mép đó. Trước đây đỉnh 35–37 bám mép bên kia, dời 3.6 mm, hai đỉnh kề đứng yên. Chỗ đường cắt tự chồng lên chính nó (E19) không phán được | `anchor.test.js` · `check_edit.py` |

## 6. Xuất DXF

| # | Khẳng định | Ca |
|---|---|---|
| **X1** | Nút **Xuất DXF** tải về một file **mới** `<tên gốc>_edit.dxf` — không trùng tên gốc, không ghi vào `output/` hay đè file nào | `write.test.js` |
| **X2** | Cấu trúc AAMA như `BLOCK_36C.dxf` / 3380: HEADER rỗng · BLOCKS (mỗi mảnh một BLOCK, **giữ tên block**) · ENTITIES (text header + INSERT tại 0,0) | `write.test.js` · `check_edit.py` |
| **X3** | **METRIC**: toạ độ mm (file inch đã đổi lúc đọc), dòng `Units: METRIC` (thay dòng cũ hoặc thêm); thêm dòng `EDITED:` ghi ngày và file gốc | `write.test.js` |
| **X4** | Giữ layer, tên mảnh, mọi TEXT (Piece Name, QUANTITY, …), mọi POINT, header text khác | `write.test.js` · `check_edit.py` |
| **X5** | LINE → LINE; polyline → POLYLINE + VERTEX (giữ cờ kín); ARC · CIRCLE · SPLINE · bulge → **POLYLINE lấy mẫu, lệch ≤ 0.01 mm** (AAMA chỉ có POLYLINE) — đếm và báo trong kết quả xuất, không âm thầm | `write.test.js` · `check_edit.py` |
| **X6** | Đọc lại file xuất bằng chính viewer ra **đúng mô hình đã sửa** (±1e-6 mm); không sửa gì → đúng mô hình gốc | `write.test.js` |
| **X7** | Đọc file xuất bằng **ezdxf** (kernel DXF độc lập) ra đúng hình học của kernel, trên DXF thật | `check_edit.py` |
| **X8** | File **không khai đơn vị** → không xuất (METRIC lúc đó là đoán), nói cách bật lại (chọn đơn vị file) | `write.test.js` |
| **X9** | Vị trí xếp bằng **Arrange không ghi** (Arrange chỉ để nhìn, CLAUDE.md §8); dời bằng Edit thì ghi | `write.test.js` |
| **X10** | Đường **dài 0** (SPLINE nằm trên một chỗ — 2938常规L có 2, 2938#齐码 có 1) vẫn ra file: POLYLINE hai đỉnh trùng nhau — đọc lại **đủ số đường** như file gốc | `write.test.js` · `check_edit.py` |

Số ghi tối đa 6 chữ số thập phân (0.000001 mm). File ghi **UTF-8**.

## 6b. Xoá — đường, điểm, mảnh

> **Requirement (TD, 2026-09-24):** xoá đường của file DXF — *"Làm, trừ đường cắt"*: xoá hẳn đường trong · đường may · canh sợi ·
> notch; đường cắt layer 1 **không xoá lẻ** (mảnh phải còn một vòng kín — ASTM, `input/research/delete_line.md` §1); muốn bỏ thì
> xoá cả mảnh. Và *"nếu xóa thì sẽ xóa hẳn"* — mảnh: `pieces/remove.md`.

| # | Khẳng định | Ca |
|---|---|---|
| **Z1** | Edit bật, có lựa chọn, **Delete / Backspace**: **Line / Curve** → xoá **cả đường** (entity) chứa cạnh đó — một đường trong không có "nửa đường" để còn lại; **Point** là entity POINT (notch, turn, curve, grade, lỗ khoan) → xoá POINT đó; **Piece** → xoá hẳn mảnh (`remove.md`). Một bước hoàn tác cho cả lựa chọn | `ops.test.js` · `check_edit.py` |
| **Z2** | Cạnh của một đường **layer 1** (đường cắt) → **từ chối cả lựa chọn**, câu báo nói vì sao và cách: xoá cả mảnh (chọn Piece). Hình không đổi một bit | `ops.test.js` · `check_edit.py` |
| **Z3** | **Góc / đầu mút** của một đường (không phải entity POINT) → từ chối: xoá đỉnh chưa có (§8); xoá cả đường thì chọn Line / Curve | `ops.test.js` |
| **Z4** | Xoá xong mà mảnh không còn **canh sợi** (đường layer 7) hay **notch** (POINT layer 4) → vẫn xoá, câu báo ⚠ nói mảnh nào thiếu gì (CLAUDE.md §5.10) | `ops.test.js` |
| **Z5** | File xuất: thứ đã xoá không còn; **mọi entity khác y nguyên**; ⌘Z → file như trước khi xoá | `check_edit.py` |
| **Z6** | Thứ đang bám vào đường vừa xoá: quan hệ lớp 4 đọc lại từ mảnh mỗi thao tác (§5) — không còn đường thì không còn quan hệ, không lỗi; phép đo **Along** đang bám đường đó bị bỏ (không đo một đường đã xoá) | `edit.test.js` · trình duyệt |

## 7. Cách hiểu đang dùng — **giả định, chờ TD chốt**

| # | Chỗ requirement để ngỏ | Đang làm | Vì sao |
|---|---|---|---|
| E1 | "Line / Curve" trên một polyline nhiều đỉnh | cạnh giữa hai góc theo định nghĩa của Edges | cạnh Edges ghi số và cạnh Edit chọn được phải là một |
| E2 | Kéo góc thì cạnh cong ra sao | đồng dạng quanh góc kia — giữ dáng, không nắn lại | tiên đoán được, không đổi dáng cong mà TD không đụng tới |
| E3 | Length: đầu nào chạy; cạnh cong đổi chiều dài thế nào | đầu gần chỗ bấm chọn (⇄ đổi); cong → phóng đồng dạng | hỏi đầu nào mỗi lần là thừa; phóng đồng dạng là cách duy nhất ra đúng L mà không đổi dáng |
| E4 | Angle đo thế nào | độ, ngược chiều kim đồng hồ từ +X | quy ước toán học, như AccuMark |
| E5 | "Distance" | dời một đoạn theo hướng Angle (toạ độ cực) | chưa có "đặt khoảng cách giữa hai điểm có sẵn" — nếu TD cần thì là một ô nữa |
| E6 | "Đường may bám offset của đường cắt" | giữ **khoảng lùi từng chỗ** như file đang có | offset đều sẽ đổi cả mảnh TD không sửa (SA nhà máy 1.6–7.1 mm, mép thun 0 mm); đổi SA vẫn làm ở pipeline (`P['sa']`) |
| E7 | Notch trên cạnh bị đổi chiều dài | giữ khoảng cách tới đầu đứng yên; cả hai đầu dời → tỉ lệ | notch là mốc ráp, đo từ đầu cạnh không đổi |
| E8 | Trim/extend trên đường kín | từ chối — dùng split + kéo | cắt một đường cắt kín là làm hở mảnh |
| E9 | ARC · CIRCLE · SPLINE | chọn, move, **Length và Angle** (một phép đồng dạng quanh đầu cố định — cung vẫn là cung), split, trim; extend cho cung (spline chưa); **không kéo từng đỉnh**; xuất thành POLYLINE | kéo từng đỉnh của cung/spline là dựng lại hình — chưa làm |
| E10 | Mã hoá file xuất | UTF-8 | trình duyệt chỉ ghi UTF-8 không cần thư viện; CAD đòi GBK thì chưa hỗ trợ |
| E11 | Vị trí Arrange | không ghi | giữ đúng quyết định Arrange chỉ để nhìn |
| E12 | Join: "chạm nhau" là bao gần | trong dung sai snap của bản vẽ | cùng thước với snap (TD 2026-09-23) |
| E13 | Đường layer 8 / 14 nào là **đường may** (TD 2026-09-23: đồng ý; layer 14 thêm theo ASTM D6673) | nằm trong 30 mm **và** chạy theo đường cắt: vòng kín ≥ nửa vòng cắt; đường hở có đoạn song song ±20° | dữ liệu 46 file tách bạch: đường may thật dài 88–99 % vòng cắt, hình bên trong 7–12 %; 468 vạch 2 đỉnh không đoạn nào song song mép. Hai ngưỡng này là cách hiểu, không phải con số TD đưa |
| E14 | Đầu chạm biên theo phần mép nào | **chính đoạn mép nó nằm trên** (hoặc đoạn gần nhất quanh đó mà đường ấy cắt) | tiên đoán được như notch; không bị mép bên kia "gần hơn" lôi đi |
| E15 | **Vạch bấm vẽ bằng đường ngắn** (≤ 10 mm, một đầu trên mép — 148 đường trong thư viện, phần lớn VeraLifting, SofyLift) | là đường chạm biên: đầu trượt dọc chính nó; mép lùi qua cả vạch → quan hệ gãy, vạch giữ chỗ cũ, readout báo | muốn vạch **đi theo mép** như notch (dời và xoay theo đoạn) là một quan hệ mới — chờ TD |
| E16 | "Cả đường" làm vật cắt / vật chặn (D8), với đường **không phải** đường cắt | **một entity** — bấm entity nào là entity đó; chỉ đường cắt mới gom mọi entity layer 1 của mảnh | đường cắt của một mảnh là một (lớp 4 cũng coi mọi entity layer 1 là một đường cắt); gom các đường khác theo chỗ chạm đầu–cuối là đoán |
| E17 | Số gia (P7) ở ô nào | chỉ ô **Length**; Angle vẫn là **đặt** hướng (`-45` là một hướng, không phải "quay −45°"), Distance vốn đã là một đoạn dời | dấu trừ của góc đã có nghĩa; "quay thêm" cần một cách gõ khác — chờ TD |
| E18 | Đường cách **đều** hai mép (đường giữa dây, đường giữa khúc hẹp) theo mép nào | mép mà các đỉnh kề nó bám — liền một mạch (C14) | cách đều thì hai mép đúng như nhau, chỉ có xé đường là chắc chắn sai; muốn khác (đường giữa dây **đứng yên**, hay đi theo **đường giữa** hai mép) — chờ TD |
| E19 | Đường cắt **tự chồng lên chính nó** — chạy ra rồi chạy về đúng một chỗ, một khe rộng 0 (SN1252 cỡ L, 3XL: các đỉnh 155–166 nằm trên đoạn 154) | để nguyên: đường may sát đó bám bờ nào của khe là tuỳ; kéo một góc của khe thì hai bờ tách ra. `check_edit.py` không đo SA và không phán "xé" ở những đỉnh đó — đếm và ghi số | đây là **dữ liệu lạ của đường cắt**, không phải của đường may: hoặc là khe cắt thật (hai bờ phải đi cùng nhau), hoặc là vẽ trùng — chờ TD |

## 8. Ngoài phạm vi

Grading · cắt mảnh theo một đường (split piece) · nắn cong (smooth) · thêm/xoá đỉnh tuỳ ý · xoá lẻ đường cắt
(§6b Z2) · xoá / sửa chữ · ghi GBK · kích thước liên kết (dimension) · ghi ngược vào dict `P` / `spec/pattern_spec.json`.
Tool **Geom** giữ nguyên như bàn thử quan hệ (offset đều, notch vạch ⟂) — không phải trình sửa.
