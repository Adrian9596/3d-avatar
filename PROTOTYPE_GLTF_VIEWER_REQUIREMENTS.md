# Requirements — Draft GLB Prototype Viewer

**Status:** READY FOR PROTOTYPE IMPLEMENTATION  
**Created:** 2026-08-14  
**Prototype entry:** `digital_bra_fit_model_360.html`  
**Asset:** `assets/export/avatar_36C_prototype.glb`

## 1. Objective and release boundary

The prototype must load the current GLB so interaction, visual presentation and asset structure can be evaluated before the TD measurement/master-body gate is complete.

Prototype integration is allowed only when the interface continuously identifies the asset as `DRAFT — NOT TD VALIDATED`. It does not authorize production replacement, measurement accuracy, fit decisions, factory readiness, simulation readiness or multi-size readiness.

## 2. Asset contract

- Load the separate local `assets/export/avatar_36C_prototype.glb` through localhost; do not modify or replace the canonical Stage 1 GLB.
- Bake the currently evaluated body shape, remove MPFB helper geometry and exclude generator morph targets from the prototype export.
- Pin the Three.js dependency locally; the viewer must not require a CDN at runtime.
- Identify the expected asset version and SHA-256 in code and validation evidence.
- Preserve body, bikini top and bikini brief as independently visible GLB objects.
- Do not map the seven MPFB generator targets to user-facing shape controls.
- Do not claim a rig is available; the current asset contains no armature.

## 3. Primary interaction

The prototype must support pointer/touch orbit, wheel/pinch zoom with bounded distance, Front/45°/Side/Back presets, Reset to initial Front framing, responsive canvas resizing and damped camera movement without automatic body deformation.

## 4. Display and status UI

- The draft status must be visible without opening a panel.
- A loading state must remain visible until the GLB succeeds or fails.
- Asset version and mesh count must be visible after load.
- Display controls must toggle body, bikini top, bikini brief and wireframe independently.
- Measurement UI must show `TBC — TD source` rather than invented values.
- The six semantic morph names may be listed as the future contract, but controls must be unavailable until the actual exported names exist.
- Base-pose bikini limitations must be stated in the display UI.

## 5. Exception and recovery behavior

- If WebGL or GLB loading fails, show an explicit error and a static draft render.
- Opening the file through `file://` is unsupported; quickstart instructions must use localhost.
- A missing display role must not crash the viewer; its toggle may remain harmless while diagnostic state records an empty role list.
- Runtime status and diagnostic data must be exposed through `window.__avatarPrototype` for test evidence.

## 6. Non-functional requirements

- The page must have no uncaught runtime errors in the supported browser test.
- The GLB must reach `READY` within 10 seconds on the local validation machine.
- Initial canvas framing must show the complete body without clipping at desktop and mobile viewport sizes.
- Controls must use semantic buttons, accessible names and `aria-pressed`/`aria-expanded` state where applicable.
- Device pixel ratio must be capped at 2 to protect prototype performance.
- The implementation remains one HTML entry plus local dependencies/assets; no build step is required.

## 7. Evidence and exit decision

Evidence must include static contract-validator output, browser runtime state, Front/45°/Side/Back screenshots, interaction evidence, the GLB validator result, exact asset SHA and a completed prototype DoD.

The only successful decision is `PROTOTYPE READY FOR USER TEST — DRAFT ASSET`. This decision does not change Stage 1 from `BLOCKED`.
