# Spec — Geometry Simplification + Semantic Preservation

> **Requirement (TD, 2026-09-22):** DXF apparel chứa rất nhiều segment/point vì đường cong
> được xuất thành polyline → geometry phức tạp, file lớn, thao tác chậm. Phương pháp năm bước:
> **Detect → Simplify → Preserve → Validate → Keep Original**, dùng Ramer–Douglas–Peucker (RDP)
> để giảm điểm, **không được xoá điểm mang ý nghĩa rập** (corner · notch · endpoint · seam
> junction), phải kiểm deviation/shape/topology trước–sau, và **DXF gốc luôn giữ lại** để
> rollback/đối chiếu.
>
> Nguồn sự thật cho `simplify.js`. Mỗi khẳng định dưới đây có một test khoá lại
> (`simplify.test.js`, `simplify.3380.test.js`) và một lần chạy trên DXF thật
> (`scripts/check_simplify.py` → `output/simplify_report.md`).

## 0. Số liệu xuất phát (đo được, không phải phỏng đoán)

| Rập | Đỉnh polyline | Cạnh thật | POINT (turn · curve · notch) |
|---|---|---|---|
| 3380 `后比` | cut 72 · sew 73 | 6 | 17 · 130 · 0 |
| 3380 `杯面` | cut 132 · sew 119 | 4 | 13 · 240 · 0 |
| 3380 `前下摆` | cut 155 · sew 145 | 8 | 26 · 276 · 4 |
| 3380 `杯口` | cut 58 · sew 56 | 4 | 30 · 203 · 4 |
| `BLOCK_36C.dxf` | cut 399 (5 mảnh) — lúc `n_quarter = 60`; nay 219 | — | — |

**810 đỉnh cho 4 mảnh** trong khi hình thật chỉ có **22 cạnh**. Đó là chỗ để giảm.

## 1. Năm bước

### 1 · Detect — tìm điểm dư
| Loại | Định nghĩa | Mặc định |
|---|---|---|
| duplicate | trùng đỉnh liền trước trong `EPS` | 1e-9 mm |
| near-duplicate | cách đỉnh liền trước < `dmin` | 0.05 mm |
| collinear | lệch khỏi đoạn nối hai đỉnh kề < `tol` | 0.1 mm |

Detect **chỉ báo cáo**, không xoá — bước này để nhìn trước khi động vào.

### 2 · Simplify — RDP theo tolerance
RDP giữ nguyên bảo đảm của chính nó: **mọi điểm bị bỏ đều nằm trong `tol` của đường giữ lại**.
Tolerance mặc định **0.1 mm** — dưới ngưỡng đọc số bằng tay trong CAD (0.1 mm,
`point_to_point.md` §4) và **thấp hơn 10 lần** luật khớp đường ráp 1 mm (`CLAUDE.md §5.9`).

### 3 · Preserve — điểm không bao giờ được xoá
- **corner** — điểm gãy hướng, lấy từ chính `edges/segment.js` (thứ đang vẽ nhãn cạnh)
- **notch** — POINT layer 4, và mọi điểm rập chiếu lên đường trong `snap` mm
- **endpoint** — hai đầu của đường hở
- **seam junction** — điểm giáp hai đường ráp (mate), lấy từ mốc bên ngoài truyền vào

Cách bảo đảm: **RDP chạy TỪNG KHÚC giữa hai điểm được bảo vệ**, không chạy một lần trên cả
ring. Nhờ vậy điểm bảo vệ không thể bị bỏ, và một góc nhọn không thể bị cắt ngang — đây cũng
là cách chặn đúng cái bẫy topology mà RDP trần hay dính.

### 4 · Validate — đo lại trước/sau, không tin vào lý thuyết
| Kiểm | Ngưỡng |
|---|---|
| deviation hai chiều (gốc→mới và mới→gốc) | **≤ tol** |
| chu vi | báo `Δ` mm và % |
| diện tích | báo `Δ` mm² và % |
| ring kín vẫn kín · chiều quay (CW/CCW) không đổi | bắt buộc |
| không sinh tự cắt | bắt buộc |
| mọi điểm bảo vệ **từng nằm trên đường** còn nguyên, đúng toạ độ | bắt buộc |

> **Mốc nằm ngoài đường viền không tính.** Rập 3380 vẽ 10/17 điểm layer 2 lệch ra ngoài
> đường cắt 7–25 mm — đó là vạch annotation, không phải đỉnh của đường. Đòi giữ chúng
> *trong* đường là đòi một thứ chưa bao giờ đúng, và sẽ làm mọi mảnh thật FAIL.

### 5 · Keep Original — không bao giờ ghi đè
Simplify **trả về hình mới**, không sửa tại chỗ, **không ghi vào** `spec/pattern_spec.json`
hay DXF. Viewer hiện bản gốc và bản rút gọn chồng lên nhau để so; DXF gốc là nguồn duy nhất
để rollback. Cùng luật với Geom và Arrange (`CLAUDE.md §8`).

## 2. Bất biến (mỗi dòng = một test)

| # | Khẳng định | Khoá bằng |
|---|---|---|
| **G1** | Detect đếm đúng duplicate · near-duplicate · collinear | `simplify.test.js` — hình dựng tay |
| **G2** | RDP: đường thẳng nhiều điểm → còn đúng 2 đầu; mọi điểm bị bỏ nằm trong `tol` | so bằng vòng lặp trần |
| **G3** | Điểm được bảo vệ **không bao giờ** bị xoá, kể cả khi nó thẳng hàng | đặt điểm bảo vệ giữa một đoạn thẳng |
| **G4** | Deviation hai chiều ≤ `tol` | đo lại trên rập thật 3380 |
| **G5** | Ring kín vẫn kín, chiều quay không đổi, ≥ 3 đỉnh | |
| **G6** | Không sinh đoạn tự cắt | dùng `intersect.js`, không tự viết lại |
| **G7** | Notch và turn point nhà máy còn nguyên sau khi rút gọn | rập 3380 |
| **G8** | Chu vi lệch < 0.1 % ở `tol` = 0.1 mm | rập 3380 |
| **G9** | Xác định: cùng input + cùng tol → cùng output, từng byte | |
| **G10** | Luỹ đẳng: rút gọn lần hai không bỏ thêm điểm nào | |
| **G11** | Hàm không sửa mảng đầu vào (Keep Original ở mức code) | so sánh input trước/sau lời gọi |

## 3. Ngoài phạm vi

Không làm trơn (smoothing) · không đổi polyline thành spline/bezier · không ghi DXF rút gọn
(nếu sau này cần, đó là việc riêng của `build_dxf.py` và phải có quyết định của TD).
