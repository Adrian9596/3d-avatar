# Spec — Edges: đo từng cạnh của mảnh, hiện số đo từng đường

> **Requirement:** CLAUDE.md §7 — *"Edges (tự tách cạnh theo điểm gãy hướng, ghi chiều dài từng cạnh)"*; và TD,
> 2026-09-24: *"test và fix bug cho phần: đo từng đường, hiện số đo các đường"*.
>
> Nguồn sự thật cho tool **Edges** (`src/features/edges/`, phím `E`) và cho dòng **Sewing line** của bảng số mảnh
> (`pieces/pieces.js`, cột *Sew* của Copy). Mỗi bất biến có test cạnh code (`edges.test.js`, `dxf/dxf.test.js`,
> `arrange/arrange.test.js`) và một phép kiểm trên cả thư viện DXF thật (`scripts/check_edges.py` →
> `output/edges_check.md`).

## 1. Test trước khi sửa — cái gì hỏng (2026-09-24)

Bấm thật trên trình duyệt + quét 47 file (714 mảnh) bằng trình đọc của viewer:

| # | Thấy gì | Bao nhiêu |
|---|---|---|
| **H1** | Edges đo **một đường trong** (layer 8 hở — vạch vị trí, đường đặt ren…) thay vì viền mảnh: SONASHAPE-BACK ghi `A 2.920 in`, viền thật 26.471 in. Dòng *Sewing line* và cột *Sew* của Copy cũng là đường đó | **370/714** mảnh |
| **H2** | Đường may **layer 14** (ASTM D6673 — CLAUDE.md §8) không được coi là đường may: *Sewing line* trống hoặc là một đường trong | 486 mảnh có vòng may kín chỉ ở layer 14 |
| **H3** | Vòng kín **dưới 8 đỉnh** (dây vai, đỉa, chữ nhật 4 đỉnh): một cạnh duy nhất, dài bằng đường **hở** — thiếu cạnh khép. Dây vai 3087: `A 12.126 in`, chu vi 20.945 in | 113 mảnh |
| **H4** | Vòng có **đúng một góc** (giọt nước, vòng 2938): một cạnh dài **0** | 8 vòng |
| **H5** | Arrange dời mảnh có đường cắt **nhiều entity**: đường Edges đo (và vùng tô, chỗ bấm chọn mảnh) **nằm lại chỗ cũ** | 262/711 mảnh |
| **H6** | Nhãn cạnh đặt ở **đỉnh giữa theo chỉ số**: cạnh thẳng hai đỉnh → nhãn nằm ngay **góc**, lẫn với cạnh kề | 649/1934 cạnh |
| **H7** | Bảng không nói đang đo **đường nào** (đường may hay đường cắt, chênh vài mm mỗi cạnh); đường ở layer đang tắt vẫn bị đo | — |
| **H8** | Bảng Layers gọi **layer 14** là *Name* (chữ) theo quy ước 3380 — ở file ASTM đó là **đường may**: muốn đo đường cắt phải tắt một chip tên *Name* (nay: *Sew 14*, nét đứt, khi layer 14 có đường) | 486 mảnh |

## 2. Định nghĩa

- **Đường may của mảnh** (*Sewing line*): một đường **kín** trên layer may (**8** hoặc **14** — CLAUDE.md §8) —
  một path hay nhiều path nối đầu–cuối — nằm **trong 30 mm** quanh đường cắt suốt dọc nó, và dài **ít nhất một nửa**
  đường cắt. Nhiều đường như thế thì lấy đường **dài nhất**. Không có thì mảnh **không có** đường may (`—`). Đường hở,
  vòng nhỏ trên layer 8/14 là hình vẽ trên mảnh (vạch vị trí, viền mút, vạch bấm), không phải đường may. Đây đúng là
  luật Edit dùng cho một vòng (`edit/edit.md` C11, C12, E13 — cùng hai con số `SEW_LAYERS`, `SEW_BAND`, ở
  `dxf/model.js`). Mảnh không có đường cắt: vòng kín dài nhất trên layer 8/14.
- **Cạnh**: khúc giữa hai **góc** liền nhau — góc theo `geometry/corners.js`, định nghĩa Edit chọn cạnh (`edit.md` §2).

## 3. Bất biến

| # | Khẳng định | Ca |
|---|---|---|
| **G1** | Edges đo **đường may** của mảnh khi layer của nó đang bật, không thì **đường cắt** (layer 1 đang bật), không thì đường nào mảnh có. Tiêu đề khối ghi rõ: **`Edges · đường may`** / **`Edges · đường cắt`** | `edges.test.js` |
| **G2** | Đường may của mảnh đúng như §2 — cả ở dòng *Sewing line*, cột *Sew* của Copy | `dxf.test.js` · `check_edges.py` |
| **G3** | Cạnh: một cạnh giữa mỗi cặp góc liền nhau. Vòng **dưới 8 đỉnh**: góc là mọi đỉnh đổi hướng > 26° (đỉnh lặp, đỉnh đầu lặp ở cuối không tính hai lần). Vòng có **một góc**: một cạnh chạy trọn vòng. Không góc nào: một cạnh là cả vòng. Đường **hở**: hai đầu mút luôn là góc, không có cạnh khép | `edges.test.js` |
| **G4** | **Tổng** các cạnh = chiều dài của đường được đo, **vòng khép kín** (≤ 0.01 mm so với dòng *Cut line* / *Sewing line*); cạnh nối tiếp nhau, phủ vòng đúng một lần | `edges.test.js` · `check_edges.py` |
| **G5** | Nhãn cạnh nằm ở **nửa chiều dài** của cạnh, đo dọc cạnh, phía ngoài đường viền; tên cạnh A … Z, rồi AA, AB … | `edges.test.js` · `check_edges.py` |
| **G6** | Arrange dời mảnh thì đường cắt, đường may mà Edges đo **đi theo** — kể cả đường vẽ bằng nhiều entity | `arrange.test.js` · `check_edges.py` |

`check_edges.py` kiểm thêm trên từng mảnh của thư viện, bằng đúng cách tool nhận hai cú bấm (`measure.js` `snapAt` · `trackAt`):
**A1** Along bấm sát một đỉnh đường cắt → bám **đường cắt**, đo tới đỉnh khác = vòng lặp trần (lối ngắn), cả đường = chu vi ·
**A2** đo điểm bấm cách đỉnh 0.3 × dung sai → bắt được (điểm hay đường).

## 4. Ngoài phạm vi

Đo cạnh của **mảnh vẽ** trong tool Vẽ (readout của Vẽ đã ghi `Cạnh` — `draw/piece.md` M8) · đo mọi đường trong của
mảnh (đo từng đường bất kỳ: chọn nó trong **Edit** — readout ghi `Dài`; đo khúc bất kỳ: **Along**) · ghi gì ngược vào
DXF hay `spec/pattern_spec.json`.
