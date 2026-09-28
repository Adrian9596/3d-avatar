# Spec — Xoá mảnh DXF: xoá hẳn

> **Requirement (TD, 2026-09-24), nguyên văn:** *"nếu xóa thì sẽ xóa hẳn"* — trả lời câu `input/research/piece_ops.md` §7.4
> (*"Bớt mảnh: **ẩn** (không xuất) hay **xoá thật**?"*). Cùng lúc TD chốt xoá **đường** của file: *"Làm, trừ đường cắt"* —
> phần đó ở `edit/edit.md` §6b.

Nguồn sự thật cho việc bỏ một mảnh của file đang mở ra khỏi bản vẽ. Code: `pieces/remove.js` (thuần: bỏ mảnh ra khỏi mô hình và
đưa lại đúng chỗ), `app/app.js` (`ctx.removePieces` · `ctx.restorePieces` · `ctx.onPieces`), phím Delete ở `arrange/arrange.js`
(hoàn tác chung) và `edit/edit.js` (hoàn tác của Edit).

## 1. Xoá hẳn nghĩa là gì

Mảnh bị xoá **không còn trong bản vẽ đang mở**: không vẽ, không chọn được, không hít được, không có trong bảng mảnh, trong Copy, trong
số đếm layer — và **không có trong file Xuất DXF** (không BLOCK, không INSERT). Không có danh sách "mảnh đã ẩn" để hiện lại. Cách duy
nhất đưa nó về là **⌘Z** ngay trong phiên (xoá nhầm là chuyện thường; file gốc thì không bao giờ bị đụng — `edit.md` X1).

## 2. Bất biến

| # | Khẳng định | Ca |
|---|---|---|
| **R1** | Chọn mảnh (bảng mảnh, bấm trên canvas, marquee của Arrange, ⌘A) rồi **Delete / Backspace** → các mảnh đó xoá hẳn (§1). Khi **Edit** bật: bấm **Piece** (hay lọc Piece), Delete — cùng việc đó; Edit chưa chọn gì mà bảng mảnh đang chọn → xoá các mảnh đó. Khi **Vẽ** bật: Delete chỉ xoá hình vẽ (`draw.md` V9) — không xoá mảnh DXF từ Vẽ. Gõ trong một ô thì Delete là của ô | `remove.test.js` · trình duyệt |
| **R2** | Mảnh còn lại **không đổi một bit** (hình, vị trí Arrange, bản sửa của Edit); file xuất: mọi block còn lại **y hệt** file xuất trước khi xoá — kỳ vọng dựng độc lập: chính file DXF bỏ block đó bằng tay rồi đọc lại | `remove.test.js` · `check_edit.py` |
| **R3** | **⌘Z** đưa mảnh về **đúng chỗ cũ trong danh sách**, đúng hình, đúng vị trí Arrange; file xuất sau hoàn tác = file xuất trước khi xoá. ⌘Z nào: xoá lúc **Edit** bật → hoàn tác của Edit; ngoài ra → hoàn tác chung (cùng ⌘Z của Arrange) | `remove.test.js` · `check_edit.py` · trình duyệt |
| **R4** | Thứ đi theo mảnh: **hình vẽ của Vẽ** trên mảnh đó không vẽ, không xuất, rời lựa chọn — ⌘Z đem về cùng mảnh; **phép đo** Straight / Along có đầu trên mảnh đó biến mất; lựa chọn bỏ mảnh đó; Geom · Simplify · Edges của mảnh đó thôi. Không để đồ mồ côi (Seamly2D #870, `delete_line.md` §1) | `remove.test.js` · `draw.test.js` · trình duyệt |
| **R5** | Thứ đang giữ mảnh theo số thứ tự **không nhầm sang mảnh khác** sau khi xoá hay hoàn tác: hoàn tác của Arrange (dời mảnh 3, xoá mảnh 1, ⌘Z → đúng mảnh đó về chỗ), hoàn tác của Edit (sửa mảnh 3, xoá mảnh 1, ⌘Z sửa → đúng mảnh đó), mảnh của hình Vẽ. Chúng giữ **chính mảnh** (object), không giữ số thứ tự | `arrange.test.js` · `edit.test.js` · `draw.test.js` |
| **R6** | Bản vẽ **không có block** (cả bản vẽ là một "mảnh" — 2938常规L): xoá nó → file xuất chỉ còn các dòng header, không còn hình; ⌘Z đem về | `remove.test.js` |
| **R7** | Câu báo: *đã xoá N mảnh: tên, … — ⌘Z hoàn tác*; bảng Layers đếm lại entity (cả sau mỗi lần Edit sửa) | `remove.test.js` · trình duyệt |

## 3. Cách hiểu đang dùng — giả định

| # | Chỗ requirement để ngỏ | Đang làm | Vì sao |
|---|---|---|---|
| **Q1** | "Xoá hẳn" có cho ⌘Z không | **có**, trong phiên, như mọi thao tác khác của viewer | TD chọn *xoá thật* thay cho *ẩn* — tức không có chỗ để hiện lại; ⌘Z là lưới an toàn thường lệ, và xoá nhầm một mảnh sẽ mất cả hình vẽ, bản sửa đang có trong phiên |
| **Q2** | Phím | **Delete** hoặc **Backspace** | như Vẽ (V9); macOS gọi phím xoá là Backspace |
| **Q3** | ⌘Z của lần xoá nằm ở đâu | ở chỗ đã xoá: Edit bật → của Edit; không thì hoàn tác chung | mỗi tool một lịch sử — quy ước sẵn có (`draw.md` V8, `edit.md`) |
