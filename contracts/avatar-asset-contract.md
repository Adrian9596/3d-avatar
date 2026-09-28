# Contract — `avatar_master.glb`

## Identity and status

- Canonical file name: `avatar_master.glb`
- Canonical editable source: `assets/source/avatar_master.blend` (the exported mesh itself: one object, three material slots, no modifiers)
- Built by `scripts/build_refined_l_avatar.py` from the **refined size-L torso**, `Avatar_CLO3D_ready.blend` (object `Avatar_Torso_sim`, SHA-256 `42f49f7610528763a34280a4bd6cdfe02ef3feae2589b9a54e30143db8345d27`), which lives outside this repository. The build refuses any other file.
- Lineage: CLO3D "AVT L" export (the Mara avatar at size L) → `Avatarclo1_half_beautified_3quarter.blend` (project root, untouched) → trimmed, voxel re-meshed and smoothed into a half torso with short arm stubs → recentred into the CLO3D-ready file → this build.
- Asset ID: `avatar_master`
- Current label: `DRAFT — NO MEASUREMENT RECORD`
- 2026-09-27: replaces the previous `avatar_master.glb` (the same AVT L body cut at the wrists, with a baked PBR skin; SHA-256 `0caa604b…`, still in git history). The body, the frame and the material names are the same; the surface is the smoothed one, the arms are stubs and the skin is flat. Every number in `qa/avatar_master/` was regenerated for it.
- 2026-09-04: the contract before that replaced `avatar_36C.glb` / the MPFB Stage-1 pipeline, which is retired. Do not carry forward morph, landmark, or TD-measurement claims from it — none of them apply to this mesh.

## Shape

- Torso only, by design: neck cut at y = 1.557 m, body cut at y = 1.043 m, arms ending in closed stubs just below the shoulder. No head, hands, legs, eyes, teeth, or hair geometry.
- Single mesh object (`AVT_L_refined`), about 34k triangles, **no UV map**, three material slots:
  - `Mara:body3` — the torso and the registry's measurement surface, about 25k triangles, open at the neck, the base and both armholes (four boundary loops).
  - `Mara:arm2` — the two arm stubs.
  - `Skin_Cut` — the flat neck and base caps.
  The names are the CLO3D source's, kept because the registry and the engines read them; they carry flat factors, not the Mara textures.
- Re-meshed evenly (QuadriFlow, ~6 mm quads, triangulated) with every vertex on the refined surface: 0.035 mm median / 0.32 mm p99 from the 317k-triangle refined torso. The source was a collapse decimation with 22% of its torso triangles narrower than the 2 mm a pen loop is sampled at; here 1.1% are (the previous CLO3D mesh: 2.6%). The build collapses QuadriFlow's short edges and folded triangles at its crease singularities and fails if a triangle still faces against the surface.
- **Exact mirror about x = 0** (the −X half mirrored onto +X): the CLO3D source was a mirrored half, and the smoothing had left up to 11.6 mm of asymmetry in the underarm hollow.
- The armhole is the previous asset's CLO3D `body3`/`arm2` seam (`assets/source/clo3d-armhole-seam.json`), carried onto the refined surface (it lies within 2.4 mm of it), not a plane. `UNDERARM_L/R`, its lowest point, is at y = 1.387 m (previous asset 1.389 m).
- The stubs are refined where the re-mesh cut inside their convex shape (the rim at each stub's end). The slot under each stub — what is left of the original arm cut and its hole fill, not anatomy — is bridged rather than followed, up to 11.6 mm off the refined surface. Nothing measures the stubs.
- No shape keys, no armature, no animation clips.

## Materials

- All three materials are flat PBR factors, no textures: base colour linear `0.7379, 0.5271, 0.4287` (the median of the previous baked `Mara_body3_BaseColor` map, so the skin tone is the one the site showed), roughness 0.455 on `Mara:body3`/`Mara:arm2` (the median of the previous roughness map) and 0.62 on `Skin_Cut`, metallic 0, double-sided.
- There is no normal map, so the skin reads smoother than the previous baked micro-detail. The previous maps cannot be reused: they were baked to the old mesh's UV atlas, and this mesh has neither that topology nor UVs.
- The caps are flat-shaded (their rims are marked sharp); the rest is smooth-shaded. No tangents are exported.

## Coordinates and scale

- Meters, glTF Y-up (`export_yup=True`), body facing +Z, identity node transform.
- **The same frame as the previous asset.** The refinement chain had moved the torso down by 1.043 m and recentred it; the build undoes both, so the registry's scan, the levels' datum and the body grid's heights keep naming the same place on the body. Before re-meshing, the refined surface lies within 0.2 mm (median) of the previous torso surface, 0.8 mm at most over the breasts.
- The torso spans y = 1.043–1.557 m and x = ±0.231 m (stub ends), consistent with the ~1.79 m CLO3D figure standing with its feet at y = 0 (there is no leg geometry to confirm the ground plane against).

## Known gaps (do not claim otherwise)

- **Measurements**: no approved measurement record exists for this body. Nothing in this asset licenses a bust/underbust/cup claim.
- **The surface is a smoothed one.** Girths at a given height agree with the previous asset within 3.2 mm, but landmarks read off extremes moved with the smoothing: the bust apex sits 4 mm nearer the centre front (apex to apex 152.6 mm, was 160.7 mm) and the underbust fold was found 5 mm lower (1.265 m, was 1.270 m; forward reach at those two heights differs by under 0.1 mm on both bodies, so the fold rule's choice between them is a near tie, and the underbust girth jumps 12 mm with it).
- **No hip**: the mesh ends at y = 1.043 m.
- **Arms**: stubs only, with the underarm slot bridged; nothing below the shoulder.
- **Textures**: none. The original CLO3D images were never copied off the Windows machine that made the export and are gone.
- **Morph targets / rig / animation**: none exist. Any UI claiming semantic shape controls, arm poses or motion for this asset must show "Blocked", not fabricate them.

## Consumer obligations

- Viewers must not claim morph or rig capability this asset doesn't have — show a blocked state instead (see `src/features/avatar/avatar_contracts.mjs` for the pattern).
- Treat `assets/source/avatar_master.blend` as the editable source; the GLB is a derived export. To rebuild from the refined source, run `scripts/build_refined_l_avatar.py` (usage in its docstring); it rewrites the `.blend`, the GLB and `qa/avatar_master/prototype-export-report.json`.
- Render with a neutral tone mapper (the app uses `THREE.NeutralToneMapping` plus a `RoomEnvironment` IBL). ACES Filmic desaturates this skin tone to a flat off-white.
- After any re-export: update the SHA-256 in `digital_bra_fit_model_360.html`, run `npm run measure:avatar`, regenerate the pattern-template fixture with `node scripts/build_pattern_template_fixture.mjs` (it is pinned to the asset), run `npm run validate:measurements`, `npm run export:pom-sheet` and `npm run validate:gltf -- assets/export/avatar_master.glb qa/avatar_master/gltf-validator-report.json` (required: zero errors).
