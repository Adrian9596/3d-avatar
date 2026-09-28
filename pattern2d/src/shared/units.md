# Spec — Đơn vị hiển thị (display unit)

> **Requirement (TD, 2026-09-23), nguyên văn:**
>
> 1. Default unit: inch.
> 2. Switch: cho phép chuyển inch, cm, mm.
> 3. Display only: đổi unit không được thay đổi geometry.
> 4. Global consistency: Measure, Snap, và input số đều dùng cùng unit.

Nguồn sự thật cho `shared/units.js` và cho mọi chỗ viewer **hiện** hoặc **nhận** một độ dài. Mỗi dòng ở §2
có một ca test (`shared/units.engine.test.js`, `measure/display.engine.test.js`), nằm trong nhóm **Units**
của bảng Measure Engine (`python3 scripts/check_engine.py`).

## 1. Hai thứ tên "đơn vị", không được lẫn

| | Đơn vị **hiển thị** (spec này) | Đơn vị **của file** (`dxf/units.js`, `measure_engine.md` A5) |
|---|---|---|
| Là gì | mm trong kernel được **viết ra** và **gõ vào** bằng đơn vị nào | số trong file DXF nghĩa là inch hay mm |
| Đổi thì | chỉ đổi chữ số trên màn hình — **hình không đổi** | đọc lại file → toạ độ đổi (×25.4) — **hình đổi**, có chủ đích |
| Ở đâu | công tắc **in · cm · mm** cuối thanh công cụ (phím `U`) | ô "File:" — **chỉ hiện khi file không khai đơn vị** |

Kernel vẫn và luôn lưu **mm** (CLAUDE.md §5.2). Đơn vị hiển thị là một phép **định dạng**, không phải dữ liệu.

## 2. Bất biến

| # | Khẳng định | Ca |
|---|---|---|
| **U1** | Mở viewer là **inch**; công tắc có đúng ba lựa chọn **inch · cm · mm**; không nhớ lựa chọn sang lần mở sau (đọc sát chữ "default") | UNIT-20 |
| **U2** | Quy đổi đúng định nghĩa: 1 in = **25.4** mm, 1 cm = **10** mm | UNIT-21 |
| **U3** | Đơn vị lạ bị **từ chối**, không lặng lẽ rơi về mm | UNIT-27 |
| **U4** | **Display only**: đổi đơn vị không đổi một bit nào của hình học — `pts` · `shapes` · `snap` · POINT · bbox · chu vi · đầu đo · view · tài liệu Geom — và không đổi số đo (mm) | UNIT-30 |
| **U5** | Độ chính xác cố định theo đơn vị (độ dài): **mm 0.1 · cm 0.01 · in 0.001**; số nhỏ (Lệch, deviation) thêm chữ số theo cùng luật; mọi chuỗi độ dài **mang nhãn đơn vị** (§5.5); không bao giờ in "−0" | UNIT-22, 23 |
| **U6** | **Input số** đọc theo đơn vị đang hiển thị; nhận `0.25` · `0,25` · `3/8` · `1 1/4` · hậu tố `mm` `cm` `in` `"` (hậu tố thắng đơn vị đang chọn); chữ hỏng → **từ chối**, giữ nguyên giá trị cũ, ô báo đỏ; giới hạn kiểm bằng mm | UNIT-25, 26, 33, 36 |
| **U7** | Đổi đơn vị qua lại bao nhiêu lần cũng **không trôi**: giá trị lưu (mm) giữ nguyên từng bit, vì ô chỉ vẽ lại từ mm, không đọc lại chữ | UNIT-24, 33 |
| **U8** | **Global**: cùng một đơn vị cho — *Measure* (Straight, Along, nhãn trên canvas) · *Snap* (toạ độ con trỏ, "Lệch" của điểm bấm) · *input số* (Gap, Đường may, Tolerance) · và mọi số độ dài khác (Pieces, Edges, Arrange, Simplify, quan hệ Geom, thước tỉ lệ, px/đơn vị, Copy TSV) | UNIT-31, 32, 34, 37 |
| **U9** | File **không khai** đơn vị: số là đơn vị bản vẽ, nên mọi chỗ ghi **"đv?"** và **không quy đổi** dù công tắc đang ở inch/cm/mm — quy đổi lúc đó là đoán | UNIT-28, 35 |
| **U10** | Thước tỉ lệ chọn mốc tròn **theo đơn vị hiển thị** (1/16 · 1/8 · 1/4 · 1/2 · 1 · 2 · 5 in; 0.1 · 0.2 · 0.5 · 1 · 2 · 5 cm; 1 · 2 · 5 · 10 · 20 · 50 mm…) | UNIT-29 |

## 3. Snap — **TD chốt 2026-09-23**

> *"Snap dùng cùng unit" nghĩa đơn giản là: khi kéo một điểm/đường và Snap vào một đối tượng khác,
> khoảng cách Snap được tính bằng chính đơn vị của bản vẽ. Ví dụ DXF đang dùng inch: Snap tolerance =
> 0.02 in · điểm A cách đường B 0.01 in → Snap vào B · cách 0.05 in → không Snap. Nếu bản vẽ dùng mm:
> Snap tolerance = 0.5 mm · cách 0.3 mm → Snap · cách 1 mm → không Snap.*

| # | Khẳng định | Ca |
|---|---|---|
| **S1** | Dung sai snap là một **khoảng cách trong bản vẽ**, mặc định theo đơn vị của **file**: `Units: ENGLISH` → **0.02 in** (0.508 mm) · `METRIC` → **0.5 mm** | UNIT-41 |
| **S2** | Snap khi **khoảng cách ≤ dung sai** — đúng bằng dung sai vẫn snap; quá một chút là không | UNIT-42, 43, 44, 45 |
| **S3** | Không phụ thuộc zoom, cỡ cửa sổ, **cũng không phụ thuộc công tắc in · cm · mm** — đổi đơn vị hiển thị chỉ đổi cách *viết* dung sai (yêu cầu 3) | UNIT-46 |
| **S4** | Hít vào **điểm** (POINT, đỉnh) trước, rồi tới **đường** (chân đường vuông góc), còn lại là điểm tự do | UNIT-42, 47, 53 |
| **S5** | Áp cho mọi chỗ *snap vào đối tượng khác*: bấm điểm của **Measure**, kéo mảnh của **Arrange** (cạnh/tâm hít cạnh/tâm), kéo đỉnh của **Geom** (hít vào POINT và đường của lớp khác). Không áp cho việc **chọn** (nắm tay cầm Geom, bấm chọn mảnh) — đó vẫn là px trên màn hình | UNIT-48, 49, 52 |
| **S6** | Dung sai hiện ở thanh trạng thái và **gõ được**, theo đơn vị hiển thị; mở file mới thì về mặc định của file đó | UNIT-46, 51 |
| **S7** | File **không khai** đơn vị: không có "đơn vị của bản vẽ" → **không snap** (điểm bấm là điểm tự do), thanh trạng thái nói lý do; chọn đơn vị file là bật lại | UNIT-50 |

## 4. Cách hiểu đang dùng — **giả định, chờ TD chốt**

| # | Chỗ requirement để ngỏ | Đang làm | Vì sao |
|---|---|---|---|
| D1 | ~~"Snap dùng cùng unit"~~ | **đã chốt** — §3 | |
| D6 | "Đơn vị của bản vẽ" là đơn vị của **file**, không phải công tắc hiển thị | theo `Units:` của file (hoặc ô "File:" khi file không khai) | TD viết "DXF đang dùng inch"; chỉ nêu inch và mm (file chỉ khai được hai thứ đó, không có cm); và yêu cầu 3 — đổi hiển thị không được đổi hành vi. Hai mặc định gần như bằng nhau (0.508 và 0.5 mm) |
| D7 | 0.5 mm rất nhỏ trên màn hình | giữ đúng số TD đưa; ô Snap ở thanh trạng thái để tăng khi cần | ở zoom vừa khung (~2.4 px/mm) 0.5 mm ≈ **1.2 px**: bấm tay gần như chỉ hít được khi đã zoom vào |
| D2 | Copy (TSV) | theo đơn vị hiển thị, **tiêu đề cột ghi đơn vị** (`Width (in)`), số không có dấu phân nghìn | bảng dán ra ngoài phải tự nói đơn vị của nó |
| D3 | "Default" | mỗi lần mở là inch, không nhớ lựa chọn cũ | đọc sát chữ; muốn nhớ thì một dòng `localStorage` |
| D4 | Phím mũi tên nhích mảnh (Arrange) | giữ **1 mm** (⇧ 10 mm) | đó là thao tác sửa, không phải số hiển thị; UI không ghi con số này ở đâu |
| D5 | Inch dạng thập phân hay phân số | **thập phân** 0.001 in; phân số chỉ ở thước tỉ lệ và ở ô nhập (gõ `3/8` được) | thập phân không làm tròn mất 1.6 mm như bậc 1/16" |

## 5. Ngoài phạm vi

Không đổi đơn vị lưu của kernel (mm) · không đổi file DXF xuất ra (METRIC) · không đổi báo cáo POM
(`validation_report.md` vẫn inch như chart nhà) · không thêm snap lưới / snap theo bước.
