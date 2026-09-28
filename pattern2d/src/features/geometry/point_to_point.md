# Spec — Point-to-Point (Straight)

> **Requirement (TD, 2026-09-22):** *"Measure Point-to-Point = đo khoảng cách thẳng giữa hai
> điểm được chọn, không đi theo đường pattern. Theo AccuMark định nghĩa chức năng Straight:
> chọn 2 điểm trên piece và đo straight distance."*
>
> Nguồn sự thật cho `straight.js` và tool **Straight** trong viewer. Mỗi khẳng định dưới đây
> có một test khoá lại (`straight.test.js`, `straight.3380.test.js`) và một phép đối chiếu CAD
> (`scripts/check_measure.py` → `output/measure_cad_check.md`).
>
> Đây là phép đo **ngược lại** với [Along Path](along_path.md): cùng hai điểm, một bên đi
> đường chim bay, một bên đi dọc đường rập. Cả hai đều cần, và **không được lẫn**.

## 1. Định nghĩa

**Straight(A, B) = |AB| — khoảng cách Euclid giữa hai điểm được chọn, tính bằng mm.**

Phép đo này **không biết** đường rập tồn tại: không bám path, không đi qua geometry nào,
không quan tâm A và B có nằm trên cùng một đường hay không. Đó là toàn bộ điểm khác biệt
với Along Path.

```
distance = sqrt(dx² + dy²)      dx = Bx − Ax      dy = By − Ay
```

## 2. "Điểm trên piece" là những điểm nào

AccuMark cho chọn **điểm đã được định nghĩa** của mảnh, không phải một chỗ bất kỳ. Trong
DXF AAMA (`CLAUDE.md §6`), đó là các entity `POINT`:

| Layer | Điểm | Vì sao cần đo tới nó |
|---|---|---|
| 2 | turn point | góc gãy — hai đầu của một cạnh |
| 3 | curve point | điểm trên đường cong |
| 4 | **notch** | mốc ráp — phần lớn POM đo từ notch tới notch |
| 5 | **grade reference** | điểm mốc grading; **không nằm trên đường viền** nên đỉnh polyline không với tới |

Cộng thêm **đỉnh của polyline** đang hiện, vì nhiều mốc của nhà máy chỉ tồn tại dưới dạng đỉnh.

## 3. Bất biến (mỗi dòng = một test)

| # | Khẳng định | Khoá bằng |
|---|---|---|
| **P1** | `distance = sqrt(dx² + dy²)`, đúng công thức đóng | `straight.test.js` — 3-4-5, số tính tay |
| **P2** | Đối xứng: `Straight(A,B) == Straight(B,A)` | đo hai chiều trên rập thật |
| **P3** | `A == B` → `0`, không âm, không NaN | |
| **P4** | **Không đi theo đường**: A và B không cần nằm trên cùng một đường, một mảnh — vẫn ra số | phân biệt hẳn với Along Path, vốn ném lỗi khi path đứt |
| **P5** | `Straight ≤ AlongPath` cho hai điểm trên cùng một đường; bằng nhau ⟺ khúc đi qua là đoạn thẳng | so trực tiếp hai engine trên rập 3380 |
| **P6** | Bấm vào đâu thì bắt **điểm đã định nghĩa gần nhất** trong dung sai snap: POINT layer 2·3·4·5 + đỉnh polyline; không có điểm thì bắt **đường** gần nhất (chân đường vuông góc); **layer đang tắt không phải mục tiêu**; không có gì trong dung sai thì lấy đúng chỗ bấm và **nói rõ là điểm tự do** | `measure.test.js` + `straight.test.js` + UNIT-41…53 |
| **P7** | Dung sai snap là **khoảng cách trong đơn vị bản vẽ** — 0.02 in cho file inch, 0.5 mm cho file mm (TD chốt 2026-09-23, `shared/units.md` §3) — không phải px; nên cả điểm được bắt lẫn con số đo ra (**mm world**) đều không đổi theo zoom (`CLAUDE.md §5.17`) | UNIT-46 |
| **P8** | Báo cả `dx`, `dy` cạnh `distance` — trên bảng số, **kể cả khi chưa chọn mảnh nào**: khi đó không ai giữ tiêu đề bảng, nên khối *Straight* / *Along Path* là tiêu đề (`readout.js` `headed`); câu báo vì sao không đo được hiện đủ (tới 160 ký tự). Nhãn trên canvas nằm ở **nửa chiều dài** khúc được đo (Along) — trên khúc thẳng cũng vậy, không phải ở B | dx/dy là thứ dùng để kiểm mảnh có vuông không · `measure.test.js` · `readout.test.js` — bấm thật 2026-09-24: trước đó đo mà không chọn mảnh thì bảng không hiện, chỉ có nhãn |

Sai số cho phép của P1–P5: **1e-9 mm** (số học, không phải phép đo).

## 4. Đối chiếu CAD

Cùng các cặp A/B mà Along Path dùng, đo thẳng thay vì đo dọc:

| Đối chiếu | Tolerance |
|---|---|
| Kernel ↔ ezdxf (đọc thẳng file DXF, `math.dist` trong Python) | **≤ 0.01 mm** |
| Kernel ↔ AccuMark / Richpeace / Gerber (đo tay, chức năng *Straight*) | **≤ 0.1 mm** |

Chạy: `python3 scripts/check_measure.py` → `output/measure_cad_check.md`.

## 5. Ngoài phạm vi

Không đo góc · không đo vuông góc tới một đường · không cộng chuỗi nhiều điểm
(AccuMark có *Point to Line* và *Add* riêng — chưa làm, chưa hứa).
