## 1. Project Goal
- [ ] Avatar là **3D thật**, xoay được 360°
- [ ] Hình thể nhìn tự nhiên, không giống mannequin procedural
- [ ] Có preset ban đầu **36C**
- [ ] Phù hợp để phát triển thành **bra fit model**
- [ ] UI tối giản, avatar là phần nổi bật nhất
- [ ] Có thể mở rộng sang các size khác sau này

## 2. Base 3D Model
- [ ] Chọn một **realistic female base mesh**
- [ ] Kiểm tra license cho mục đích sử dụng
- [ ] Full body mesh liền mạch
- [ ] Neutral standing / A-pose
- [ ] Shoulder tự nhiên
- [ ] Axilla / underarm tự nhiên
- [ ] Ribcage rõ nhưng không quá cơ bắp
- [ ] Waist / hip transition mượt
- [ ] Back torso đủ chính xác để kiểm tra bra wing
- [ ] Breast không bị dính vào torso như một khối sphere

## 3. Mesh Quality
- [ ] Clean quad topology
- [ ] Không có triangle dài bất thường
- [ ] Không có self-intersection
- [ ] Không có duplicate vertices
- [ ] Normals đúng
- [ ] Symmetry trái/phải hợp lý
- [ ] Mesh density cao hơn tại breast / IMF / axilla
- [ ] Mesh vẫn đủ nhẹ để chạy realtime trên web
- [ ] Test silhouette ở Front
- [ ] Test silhouette ở 45°
- [ ] Test silhouette ở Side
- [ ] Test silhouette ở Back

## 4. 36C Master Body Specification
- [ ] Height
- [ ] Full bust
- [ ] Underbust
- [ ] High bust
- [ ] Waist
- [ ] Hip
- [ ] Shoulder width
- [ ] Across front
- [ ] Across back
- [ ] Torso length
- [ ] Bust point spacing
- [ ] Bust point height
- [ ] Breast root width
- [ ] Breast root height
- [ ] Breast projection
- [ ] Breast arc
- [ ] Inner breast spacing
- [ ] Breast root perimeter
- [ ] Side breast position
- [ ] Underarm depth

## 5. Breast Shape System
- [ ] Breast Volume
- [ ] Projection
- [ ] Root Width
- [ ] Root Height
- [ ] Breast Spacing
- [ ] Apex Position X
- [ ] Apex Position Y
- [ ] Upper Fullness
- [ ] Lower Fullness
- [ ] Inner Fullness
- [ ] Outer Fullness
- [ ] Ptosis
- [ ] Breast Orientation
- [ ] Left/right symmetry control

## 6. Morph Targets
- [ ] Tạo `Base 36C`
- [ ] Projection morph
- [ ] Wide Root morph
- [ ] Narrow Root morph
- [ ] Root Height morph
- [ ] Wide Spacing morph
- [ ] Close-set morph
- [ ] Upper Full morph
- [ ] Lower Full morph
- [ ] Ptosis morph
- [ ] Bust Apex Up/Down morph
- [ ] Underbust / ribcage morph
- [ ] Kiểm tra morph không làm mesh bị méo
- [ ] Kiểm tra khi blend nhiều morph cùng lúc

## 7. Anatomical Landmarks
- [ ] Left Bust Point
- [ ] Right Bust Point
- [ ] CF
- [ ] CB
- [ ] Underbust CF
- [ ] Breast Root Top
- [ ] Breast Root Inner
- [ ] Breast Root Bottom
- [ ] Breast Root Outer
- [ ] Underarm
- [ ] Shoulder Point
- [ ] Side Seam
- [ ] Waist
- [ ] Back Bust
- [ ] Landmarks tự di chuyển theo morph

## 8. Rig / Pose
- [ ] Basic skeleton
- [ ] Pelvis
- [ ] Spine
- [ ] Chest
- [ ] Neck
- [ ] Head
- [ ] Shoulder L/R
- [ ] Arm L/R
- [ ] Elbow L/R
- [ ] Wrist L/R
- [ ] Hip / knee / ankle
- [ ] Neutral pose
- [ ] A-pose
- [ ] Arms 45°
- [ ] Arms 90°
- [ ] Rig không làm biến dạng breast bất thường

## 9. Skin Material
- [ ] Base skin texture
- [ ] Roughness map
- [ ] Normal map nhẹ
- [ ] Không quá bóng
- [ ] Không tạo cảm giác plastic
- [ ] Tone da neutral
- [ ] Da vẫn đẹp ở Front / Side / Back
- [ ] Material nhẹ để realtime

## 10. Neutral Underwear
- [ ] Neutral bra
- [ ] Neutral brief
- [ ] Màu gray / nude
- [ ] Không lace hoặc chi tiết gây nhiễu
- [ ] Không che breast silhouette quá nhiều
- [ ] Có tùy chọn hide/show underwear
- [ ] Có nude collision body riêng

## 11. Lighting
- [ ] Studio Key Light
- [ ] Fill Light
- [ ] Soft Rim Light
- [ ] Soft floor shadow
- [ ] Background trắng/xám rất nhẹ
- [ ] Không highlight quá mạnh trên breast
- [ ] Side view vẫn thấy volume rõ
- [ ] Back view vẫn đọc được silhouette

## 12. 3D Viewer
- [ ] Import GLB
- [ ] Orbit 360°
- [ ] Rotate bằng drag
- [ ] Zoom bằng mouse wheel
- [ ] Pan nếu cần
- [ ] Front preset
- [ ] 45° preset
- [ ] Side preset
- [ ] Back preset
- [ ] Reset camera
- [ ] Fullscreen

## 13. Minimal UI
- [ ] Avatar chiếm phần lớn màn hình
- [ ] Không có sidebar lớn mặc định
- [ ] `36C` preset ở top bar
- [ ] Unit `inch / cm`
- [ ] `Edit Shape` mở panel khi cần
- [ ] Measurement mở bằng icon
- [ ] Display mở bằng icon
- [ ] Front / 45° / Side / Back ở dưới
- [ ] Không hiển thị quá nhiều text
- [ ] Không dùng dashboard layout
- [ ] Không để panel che breast khi edit

## 14. Edit Shape Panel
Chỉ hiển thị mặc định:
- [ ] Underbust
- [ ] Projection
- [ ] Root Width
- [ ] Spacing
- [ ] Upper Fullness
- [ ] Ptosis

Advanced:
- [ ] Height
- [ ] Shoulder
- [ ] Waist
- [ ] Hip
- [ ] Root Height
- [ ] Bust Point Height
- [ ] Torso Length

## 15. Measurement Engine
- [ ] Full Bust
- [ ] Underbust
- [ ] High Bust
- [ ] Root Width
- [ ] Root Height
- [ ] Projection
- [ ] Breast Arc
- [ ] BP to BP
- [ ] BP to Underbust
- [ ] CF Breast Gap
- [ ] Measurement update khi morph thay đổi
- [ ] Inch / cm conversion chính xác

## 16. File / Export
- [ ] Master Blender file
- [ ] GLB export
- [ ] FBX export
- [ ] OBJ export
- [ ] Morph targets giữ nguyên khi export GLB
- [ ] Skeleton giữ nguyên
- [ ] Material giữ nguyên
- [ ] Scale/unit đúng
- [ ] Coordinate system đúng

## 17. Performance
- [ ] Avatar load nhanh
- [ ] Orbit mượt
- [ ] Morph realtime
- [ ] Không lag khi thay slider
- [ ] File GLB được optimize
- [ ] Texture được compress
- [ ] Test Chrome
- [ ] Test Edge
- [ ] Test Safari
- [ ] Test laptop không có GPU mạnh

## 18. Bra-Fit Specific QA
- [ ] IMF rõ ràng
- [ ] Breast root hợp lý
- [ ] Side breast không quá phẳng
- [ ] Breast spacing đúng
- [ ] Apex position đúng
- [ ] Underbust/ribcage không bị tròn đều như cylinder
- [ ] Axilla có hình học tự nhiên
- [ ] Back wing area đủ chính xác
- [ ] Shoulder slope hợp lý
- [ ] Bra strap path hợp lý
- [ ] Wire line có thể đặt quanh breast root
- [ ] Cup có thể ôm breast không bị collision bất thường

## 19. Acceptance Criteria — V1
- [ ] Khi mở tool, người dùng cảm nhận ngay đây là **realistic 3D female fit model**
- [ ] Không còn cảm giác avatar ghép từ sphere/cylinder
- [ ] Model xoay 360° mượt
- [ ] Front / Side / Back đều tự nhiên
- [ ] 36C có measurement specification rõ ràng
- [ ] Breast morph hoạt động mượt
- [ ] UI đủ tối giản
- [ ] Không cần mở panel để xem model
- [ ] Model phù hợp để mặc bra 3D ở bước tiếp theo

## 20. Definition of Done
- [ ] Real 3D female mesh hoàn chỉnh
- [ ] Realistic material + lighting
- [ ] 360° viewer
- [ ] 36C validated master avatar
- [ ] Breast morph system
- [ ] Anatomical landmarks
- [ ] Measurement engine cơ bản
- [ ] Minimal UI approved
- [ ] GLB/FBX export tested
- [ ] Avatar sẵn sàng cho **Bra Simulation Phase**