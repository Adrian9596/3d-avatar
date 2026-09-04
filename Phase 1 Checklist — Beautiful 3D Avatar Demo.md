## Goal
- [ ] Có **female avatar đẹp, tự nhiên**
- [ ] Xoay được **360°**
- [ ] Zoom được
- [ ] Có Front / 45° / Side / Back
- [ ] Giao diện cực tối giản
- [ ] Chạy miễn phí, không cần CLO3D

## Free Tools
- [ ] **Blender** — chỉnh model, material, lighting, export GLB
- [ ] **MakeHuman / MPFB** — tạo female base model nhanh
- [ ] **Three.js** — hiển thị model 3D trên HTML

MakeHuman/MPFB hiện vẫn đang được phát triển; MPFB có bản phát hành mới trong tháng 7/2026 và hỗ trợ workflow tạo character trong Blender. Three.js cung cấp viewer/tooling cho 3D trên web.

## 1. Create Base Avatar
- [ ] Tạo female model bằng MakeHuman/MPFB
- [ ] Body proportion tự nhiên
- [ ] Neutral A-pose
- [ ] Không cần tóc phức tạp
- [ ] Không cần makeup
- [ ] Chọn body gần **36C** nhất có thể
- [ ] Export sang Blender

## 2. Make Avatar Look Better
- [ ] Chỉnh shoulder tự nhiên
- [ ] Chỉnh waist/hip nhẹ
- [ ] Chỉnh breast shape đẹp hơn
- [ ] Breast không giống sphere
- [ ] Side breast tự nhiên
- [ ] Back silhouette tự nhiên
- [ ] Kiểm tra Front / Side / Back

## 3. Simple Outfit
- [ ] Neutral bra
- [ ] Neutral brief
- [ ] Màu gray hoặc nude
- [ ] Không lace
- [ ] Không pattern
- [ ] Không chi tiết gây rối

## 4. Skin + Lighting
- [ ] Dùng skin material có sẵn
- [ ] Da không quá bóng
- [ ] Studio lighting mềm
- [ ] Background trắng/xám
- [ ] Soft floor shadow
- [ ] Model nhìn đẹp ở cả Front và Side

## 5. Export
- [ ] Export thành **GLB**
- [ ] Giữ material
- [ ] Giữ skeleton nếu có
- [ ] Optimize file
- [ ] Test mở lại GLB

## 6. HTML Viewer
- [ ] Load GLB bằng Three.js
- [ ] Drag để xoay 360°
- [ ] Scroll để zoom
- [ ] Front button
- [ ] 45° button
- [ ] Side button
- [ ] Back button
- [ ] Reset camera
- [ ] Soft studio lighting trong viewer

## 7. Minimal UI
Màn hình mặc định chỉ cần:

- [ ] Avatar ở giữa
- [ ] `36C` ở góc trên
- [ ] `INCH / CM`
- [ ] `Edit Shape`
- [ ] Measurement icon
- [ ] Display icon
- [ ] Front / 45° / Side / Back phía dưới

**Không làm trong Phase 1:**
- [ ] Không dashboard
- [ ] Không bảng measurement lớn
- [ ] Không pressure map
- [ ] Không bra simulation
- [ ] Không grading size
- [ ] Không soft-body breast
- [ ] Không AI
- [ ] Không quá nhiều slider

## 8. Shape Controls — chỉ demo
Chỉ cần 4–6 slider:

- [ ] Underbust
- [ ] Projection
- [ ] Root Width
- [ ] Spacing
- [ ] Upper Fullness
- [ ] Ptosis

Phase 1 **chưa cần chính xác tuyệt đối**. Chỉ cần chứng minh UI + avatar + morph workflow hoạt động.

## Definition of Done
- [ ] Mở HTML → thấy ngay avatar đẹp
- [ ] Không có cảm giác mannequin
- [ ] Xoay 360° mượt
- [ ] Zoom mượt
- [ ] Front / Side / Back đều đẹp
- [ ] Có neutral bra + brief
- [ ] Background và lighting sạch
- [ ] UI rất tối giản
- [ ] File GLB load ổn định
- [ ] Toàn bộ workflow dùng công cụ miễn phí

### Phase 1 output

**1 file `avatar_36C.glb` + 1 HTML viewer tối giản.**

Đạt được hai file này là đủ để kết thúc Phase 1. Không nên thêm feature trước khi **avatar nhìn đủ đẹp và xoay 360° đủ tốt**.