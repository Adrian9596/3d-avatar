# Research — Stage 1 Toolchain and Asset Source

**Research date:** 2026-08-14

## Decision 1 — Use Blender as the master authoring tool

**Decision:** Use a stable Blender release compatible with MPFB; record the installed exact version in the manifest.

**Rationale:** Blender provides editable master files, shape keys, armatures, PBR materials and official glTF import/export support. Blender documentation states that glTF export supports shape keys and armature data.

**Primary sources:**

- https://www.blender.org/download/releases/
- https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html

**Alternatives considered:** hand-generated geometry in JavaScript. Rejected for the master asset because it cannot meet realistic anatomy/topology requirements.

## Decision 2 — Use MPFB for the first base-body candidate

**Decision:** Use MPFB inside Blender rather than requiring a separate MakeHuman application.

**Rationale:** MPFB is a human character generator for Blender, supports creating a human from scratch and adding a standard rig. Official documentation requires Blender 4.2 or newer and states MakeHuman is optional.

**Primary sources:**

- https://static.makehumancommunity.org/mpfb/docs/getting_started.html
- https://static.makehumancommunity.org/mpfb/index.html

**Alternatives considered:** MakeHuman standalone export. Still viable, but adds another application and a one-way export step. A commercial base mesh may offer better realism but cannot be selected without budget/license approval.

## Decision 3 — Limit accepted assets to confirmed licenses

**Decision:** Use MPFB/MakeHuman core assets documented as CC0. Treat every community-contributed asset as a separate license decision.

**Rationale:** MakeHuman Community describes the graphics/core assets as CC0, while community asset packs may mix CC0 and CC-BY. A tool-level license statement does not automatically clear every optional asset.

**Primary sources:**

- https://static.makehumancommunity.org/about/license.html
- https://static.makehumancommunity.org/makehuman/faq/can_i_sell_models_created_with_makehuman.html
- https://static.makehumancommunity.org/assets/assetpacks.html

## Decision 4 — Validate GLB with Khronos tooling

**Decision:** Use the Khronos glTF Validator as the format gate and retain its machine-readable report.

**Rationale:** Khronos lists the validator as an official glTF validation resource. Format validity remains separate from anatomy and visual approval.

**Primary sources:**

- https://www.khronos.org/gltf/
- https://github.khronos.org/glTF-Validator/

## Unresolved decision — 36C authority

`36C` is not enough to derive height, waist, hip, shoulder, breast-root geometry and other required full-body dimensions. A TD-approved standard, scan or fit-model measurement record is required. No source currently in the project has this authority.

**Status:** BLOCKED. Do not substitute generic retail size charts without explicit TD approval.

