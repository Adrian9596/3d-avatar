## 1. Visual Quality
- [ ] Nhìn tổng thể giống **digital fit model**, không giống mannequin thô
- [ ] Body proportion tự nhiên
- [ ] Silhouette sạch ở Front / 45° / Side / Back
- [ ] Shoulder → axilla → breast → waist transition mượt
- [ ] Không có vùng body bị phồng, lõm hoặc gãy bất thường
- [ ] Pose trung tính, chuyên nghiệp

## 2. Breast Quality
- [ ] Breast không giống sphere gắn lên torso
- [ ] Breast root tự nhiên
- [ ] Projection hợp lý
- [ ] Spacing cân đối
- [ ] Upper / lower fullness tự nhiên
- [ ] IMF rõ nhưng không sắc hoặc gãy
- [ ] Side breast transition mượt
- [ ] Breast → chest transition mượt
- [ ] Left / right symmetry tốt
- [ ] Shape đủ tốt để làm **36C Master Fit Model**

## 3. Upper Torso
- [ ] Ribcage nhìn tự nhiên
- [ ] Underbust contour hợp lý
- [ ] Axilla không bị lõm/gãy
- [ ] Shoulder slope tự nhiên
- [ ] Upper back tự nhiên
- [ ] Side torso đủ tốt để kiểm tra bra wing
- [ ] Không có collision hoặc surface lỗi rõ ràng

## 4. Mesh Quality
- [ ] Mesh clean và liền mạch
- [ ] Không có hole
- [ ] Không duplicate vertices/faces
- [ ] Không self-intersection
- [ ] Normals đúng
- [ ] Surface smooth
- [ ] Không polygon stretch nghiêm trọng
- [ ] Topology đủ tốt quanh breast / IMF / axilla
- [ ] Vertex order được giữ ổn định trước khi freeze Master

## 5. Skin & Appearance
- [ ] Skin nhìn mềm và tự nhiên
- [ ] Không bóng như plastic
- [ ] Roughness hợp lý
- [ ] Skin tone neutral
- [ ] Lighting studio mềm
- [ ] Soft shadow
- [ ] Background trắng/xám sạch
- [ ] Không cần makeup hoặc hair phức tạp

## 6. Privacy / Identity
- [ ] Avatar có **generic identity**
- [ ] Không giống một người thật cụ thể
- [ ] Face neutral
- [ ] Mặc định mặc neutral bra + brief
- [ ] Không hiển thị chi tiết cơ thể nhạy cảm không cần thiết
- [ ] Không chứa tên, ảnh mặt hoặc dữ liệu nhận dạng cá nhân
- [ ] Nếu dùng body scan thật, dữ liệu phải anonymized
- [ ] Measurement data và identity data được tách riêng
- [ ] Có thể xóa dữ liệu nguồn nếu cần

## 7. Pose
- [ ] Neutral A-pose
- [ ] Shoulder relaxed
- [ ] Arms hơi cách torso
- [ ] Elbow tự nhiên
- [ ] Body đứng cân bằng
- [ ] Head neutral
- [ ] Pose phù hợp để mặc bra và kiểm tra fit

## 8. 360° Quality Check
- [ ] Front view đẹp
- [ ] 45° view đẹp
- [ ] Side view đẹp
- [ ] Back view đẹp
- [ ] Top-down view không có lỗi rõ ràng
- [ ] Bottom-up view không có lỗi rõ ràng
- [ ] Khi xoay 360° không xuất hiện vùng mesh lỗi bất ngờ

## 9. Master 36C Readiness
- [ ] Measurement authority đã được xác định
- [ ] Actual body measurements đã được chốt
- [ ] Body geometry khớp measurement trong tolerance
- [ ] 36C chỉ là label, không phải measurement source
- [ ] Master topology đã được lock
- [ ] Master proportions đã được lock
- [ ] Master body đã được freeze/version
- [ ] Không chỉnh trực tiếp Master sau khi freeze

## Final Acceptance

Avatar chỉ được coi là **DONE** khi:

- [ ] Nhìn giống một **professional digital bra fit model**
- [ ] Không còn cảm giác mannequin procedural
- [ ] Upper torso và breast là vùng có chất lượng cao nhất
- [ ] Đẹp ở mọi góc 360°
- [ ] Privacy-safe và anonymous
- [ ] Geometry đủ sạch để làm Master Body
- [ ] Sẵn sàng cho bước tiếp theo: **Breast Morph + Measurement + Bra Simulation**

**Target style:** `Realistic + Clean + Neutral + Anonymous + Bra-fit focused`