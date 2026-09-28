# Spec — Along Path

> Đo chiều dài **thật** từ A tới B dọc theo đường rập, thay vì đường chim bay.
> Nguồn sự thật cho `path.js`. Mỗi khẳng định dưới đây có một test khoá lại
> (`path.test.js`, `path.3380.test.js`) và một phép đối chiếu CAD
> (`scripts/check_measure.py` → `output/measure_cad_check.md`). Bộ test tìm bug của cả
> Measure Engine ở [`measure/measure_engine.md`](../measure/measure_engine.md).

## 1. Định nghĩa

**Along Path(A, B) = chiều dài cung của khúc path nối A và B** — tổng chiều dài
chính xác của toàn bộ các geometry mà khúc đó đi qua, kể cả phần bị cắt dở ở hai đầu.

Vị trí trên path đo bằng **s = chiều dài cung tính từ đầu path, đơn vị mm**.
`s` là hệ toạ độ duy nhất của phép đo này; chỉ số đỉnh không dùng tới, vì A và B
gần như luôn rơi vào **giữa** hai đỉnh.

## 2. Chiều dài từng geometry — công thức đóng, không lấy mẫu

| Kiểu | Chiều dài | Ghi chú |
|---|---|---|
| `line` | `hypot(b−a)` | |
| `arc` | `r · |góc quét|` | **không** dùng dây cung, **không** chia nhỏ rồi cộng |
| `curve` | `Σ` dây cung giữa các đỉnh liên tiếp | polyline **chính là** các đỉnh của nó — tổng này là đúng, không phải xấp xỉ |
| `spline` | `∫ |C′(u)| du`, Gauss–Legendre 16 điểm trên từng khoảng knot, chia đôi tới khi tổng đứng yên | NURBS/Bezier (entity `SPLINE`) — kiểu duy nhất không có công thức đóng; hội tụ ~1e-12 mm, tolerance test **1e-6 mm** (`spline.js`, từ 2026-09-23) |
| `point` | 0 | bị loại khỏi path lúc dựng chain |

Cắt dở một geometry thì chiều dài tỉ lệ đúng theo `t`, vì `t` của cả bốn kiểu chạy
theo chiều dài cung (`model.js`). Nửa cung 90° của bán kính 100 dài đúng
`100·π/4`, không phải nửa dây cung.

## 3. Bất biến (mỗi dòng = một test)

| # | Khẳng định | Khoá bằng |
|---|---|---|
| **S1** | Chiều dài từng kiểu đúng công thức đóng ở §2 | `path.test.js` — số kỳ vọng tính tay: 3-4-5, `100·π/2`, tổng dây cung viết bằng vòng lặp trần |
| **S2** | `alongPath().distance == Σ parts[].length` | cộng lại trong test; không hụt ở mối nối, không đếm hai lần |
| **S3** | `chainLength(ch) == Σ` chiều dài từng geometry | tính lại từ `parts`, không đọc `total` |
| **S4** | Xâu path **không phụ thuộc thứ tự đưa vào và chiều vẽ** của từng hình | xáo thứ tự + lật chiều → cùng một tổng |
| **S5** | Path đứt đoạn (khe > `tol`, mặc định 0.05 mm) → **ném lỗi**, không trả số | đo thiếu một đoạn mà vẫn ra số đẹp là kiểu sai nguy hiểm nhất |
| **S6** | Path kín: `forward + backward == total`, `short ≤ long` | ring rập thật 3380 |
| **S7** | A, B chiếu lên **điểm gần nhất trên path** (không chỉ đỉnh); độ lệch trả ra ở `offPath` | click giữa hai đỉnh vẫn đo đúng |
| **S8** | `Along ≥ direct`; bằng nhau khi và chỉ khi khúc đi qua là một đoạn thẳng | cung phần tư r=100: 157.08 so với 141.42 |
| **S9** | `Σ length(subPath(a,b)) == alongPath(a,b).distance`; `subPath` trọn path hở = `chainLength` | khúc vẽ trên canvas đúng bằng khúc được đo |
| **S10** | Trên rập thật, chu vi ring cắt = perimeter đo bằng parser độc lập | `path.3380.test.js` + fixture `measured` |

Sai số cho phép của mọi bất biến trên: **1e-9 mm** (đây là số học, không phải phép đo); path có
spline: **1e-6 mm** (tích phân số).

Path không phải một đường duy nhất thì **không đo**: hình trùng nhau, phân nhánh, đầu vào NaN đều ném
lỗi; path tự cắt vẫn đo theo nét vẽ nhưng mang cờ `crossings` / `ambiguous`. Một hình hở mà đầu trùng
cuối (đường tròn, polyline cờ hở) là path kín — như nhiều hình (`measure_engine.md` §4 A1–A4, A7).

**Tool chọn đường để bám** (`measure.js` `pickPath`, không phải kernel): đường gần chỗ bấm nhất; các đường cách nhau ≤ 0.01 mm
là vẽ đè nhau — lấy đường cắt, rồi đường may, rồi đường khác (`measure_engine.md` A12). Bảng Along ghi **Bám**: layer đang theo.

## 4. Đối chiếu CAD

Con số của kernel phải khớp với con số CAD đọc từ **cùng một file DXF**:

| Đối chiếu | Tolerance | Vì sao |
|---|---|---|
| Kernel ↔ ezdxf (kernel DXF độc lập, đọc thẳng file gốc) | **≤ 0.01 mm** | cùng hình học, khác hoàn toàn cách đọc và cách tính |
| Kernel ↔ Richpeace / Gerber / Optitex (đo tay trong CAD) | **≤ 0.1 mm** | giới hạn của thao tác bắt điểm và đọc số trên màn hình |

Chạy: `python3 scripts/check_measure.py` → `output/measure_cad_check.md`.
Phép đo ngược lại — đo thẳng hai điểm — là [Point-to-Point](point_to_point.md).
Cột **CAD (tay)** trong báo cáo để trống cho TD điền số đo từ Richpeace; script
tự tính lệch và PASS/FAIL khi cột đó có số.

## 5. Ngoài phạm vi

Không dựng spline từ fit point (chỉ đo spline có control point — `measure_engine.md` A10) ·
không đo trên nhiều mảnh cùng lúc · không ghi ngược vào `spec/pattern_spec.json` hay DXF —
Along Path là **thước đo**, không phải công cụ dựng rập.
