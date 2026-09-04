# Contract — `avatar_master.glb`

## Identity and status

- Canonical file name: `avatar_master.glb`
- Canonical editable source: `assets/source/avatar_master.blend`
- Original untouched export: `Avatarclo1_half_beautified_3quarter.blend` (project root), authored in CLO3D
- Asset ID: `avatar_master`
- Current label: `DRAFT — NO MEASUREMENT RECORD`
- 2026-09-04: this contract replaces `avatar_36C.glb` / the MPFB Stage-1 pipeline, which is retired. Do not carry forward morph, landmark, or TD-measurement claims from the previous contract — none of them apply to this mesh.

## Shape

- Torso only, by design: neck cut at the base of the head, arms cut at the wrist, body cut at the waist/hip. No head, hands, legs, eyes, teeth, or hair geometry.
- Single mesh object, ~20.8k triangles, one UV set (`UVMap`), three material slots: `Mara:body3` (torso), `Mara:arm2` (arms), `Skin_Cut` (the four open cut faces).
- Triangulated on export (a Triangulate modifier on the source; the `.blend` keeps its quads/n-gons).
- No shape keys, no armature, no animation clips.

## Materials and textures

- Baked PBR set from `Blender/output/textures`, packed into the `.blend` and embedded in the GLB: `Mara_body3_{BaseColor,Roughness,Normal}.png` and `Mara_arm2_{...}.png`, all 2048×2048.
- Normal maps are wired through a Normal Map node at **strength 0.3** — the bake carries strong micro-detail that reads as stucco at 1.0.
- The UV atlas is multi-tile (torso u 0–1.9, arms u 2–3) and its unbaked background is black. The four open cut faces (neck, waist, both wrists) have arbitrary UVs that stray into that black area, so they are on the untextured `Skin_Cut` material (flat linear `0.863, 0.738, 0.673`, roughness 0.62) and flat-shaded. **Any future re-bake must re-check this** — a textured cut face renders as black holes.
- No tangents are exported: two wrist-cap vertices have degenerate UVs that produce zero-length tangents, which is a glTF spec error. Three.js derives tangents in-shader instead.

## Coordinates and scale

- Source CLO3D/OBJ data was authored in millimeters; the Blender checkpoint applies a 0.001 scale + rotation bake so `assets/source/avatar_master.blend` and the exported GLB are both in real meters.
- Exported GLB uses glTF's Y-up convention (`export_yup=True`); world position places the torso at roughly Y = 0.99–1.60 m, consistent with a ~1.6 m tall figure standing with feet at Y=0 (there is no leg geometry to confirm the ground plane against).
- Object transform is baked/applied (identity rotation and scale on the exported node).

## Known gaps (do not claim otherwise)

- **Measurements**: no approved measurement record exists for this body. Nothing in this asset licenses a bust/underbust/cup claim.
- **Original CLO3D textures**: the 14 images the original export referenced (`C:\Users\Crossian\...`, including face/eye/eyelash/tooth) were never copied off the Windows machine and are gone. The current look comes from the re-baked `body3`/`arm2` set instead; there is no baked map for the former `face2` material (26 neck-cap polygons, now folded into `Skin_Cut`).
- **Morph targets / landmarks**: none exist. Any UI claiming semantic shape controls or measurement-derived fit for this asset is wrong until a real rig/measurement pipeline is built for it.
- **Rig / animation**: none exist. Arm-pose and motion UI should show "Blocked", not fabricate movement.

## Consumer obligations

- Viewers must not claim morph or rig capability this asset doesn't have — show a blocked state instead (see `viewer/src/contracts.js` for the pattern).
- Treat `assets/source/avatar_master.blend` as the editable source; the GLB is a derived export.
- Render with a neutral tone mapper (both viewers use `THREE.NeutralToneMapping` plus a `RoomEnvironment` IBL). ACES Filmic desaturates this skin tone to a flat off-white.
- After any re-export: rerun `npm run validate:gltf -- assets/export/avatar_master.glb qa/avatar_master/gltf-validator-report.json` (required: zero errors) and update the SHA-256 in both `digital_bra_fit_model_360.html` and `viewer/src/main.js`.
