# Definition of Done — Draft GLB Prototype Viewer

**Status:** `PASS`  
**Requirements:** `PROTOTYPE_GLTF_VIEWER_REQUIREMENTS.md`  
**Entry:** `digital_bra_fit_model_360.html`  
**Rule:** tick only with evidence from the current HTML and GLB hash. Prototype completion does not change Stage 1 approval.

## A. Scope and truthful status

- [x] **PVD-001** Prototype lane is explicitly separated from production viewer release. Evidence: requirements §1.
- [x] **PVD-002** `DRAFT — NOT TD VALIDATED` is visible in the default UI. Evidence: viewer header.
- [x] **PVD-003** Measurement values are `TBC — TD source`; no old demo measurements remain. Evidence: Measurement panel and static validator.
- [x] **PVD-004** Shape controls identify the six future semantic morphs but stay unavailable. Evidence: Shape Contract panel.
- [x] **PVD-005** UI does not claim that the current asset has a rig. Evidence: requirement/UI audit.

## B. Asset and dependency integration

- [x] **PVD-006** Viewer points to separate local `assets/export/avatar_36C_prototype.glb`; canonical Stage 1 GLB is untouched. Evidence: HTML asset constant and export report.
- [x] **PVD-007** Three.js is pinned in `package.json` and served locally without CDN. Evidence: dependency and import map.
- [x] **PVD-008** Expected GLB version and SHA-256 are recorded in viewer diagnostics. Evidence: HTML constants.
- [x] **PVD-009** GLB reaches runtime status `READY` within 10 seconds. Evidence: browser runtime capture.
- [x] **PVD-010** Runtime reports exactly three meshes and expected BODY/BIKINI_TOP/BIKINI_BRIEF roles. Evidence: `window.__avatarPrototype`.
- [x] **PVD-011** Runtime reports no armature and does not expose MPFB targets as semantic UI controls. Evidence: diagnostics and Shape Contract panel.
- [x] **PVD-012** glTF validator remains at zero errors and zero warnings for the integrated GLB. Evidence: `qa/avatar_36C/prototype-gltf-validator-report.json`.

## C. Camera and navigation

- [x] **PVD-013** Initial Front view frames the complete avatar without clipping. Evidence: Front screenshot.
- [x] **PVD-014** 45° preset produces the intended three-quarter view. Evidence: 45° screenshot.
- [x] **PVD-015** Side preset produces a full-body side view. Evidence: Side screenshot.
- [x] **PVD-016** Back preset produces a full-body back view. Evidence: Back screenshot.
- [x] **PVD-017** Reset returns to the initial Front framing. Evidence: camera-state comparison.
- [x] **PVD-018** Pointer drag changes orbit and clears the selected preset state. Evidence: interaction capture.
- [x] **PVD-019** Wheel zoom changes camera distance while preserving bounds. Evidence: before/after camera data.
- [x] **PVD-020** Viewer resizes without clipping at a mobile viewport. Evidence: mobile screenshot.

## D. Display controls

- [x] **PVD-021** Body toggle hides/shows only BODY role meshes. Evidence: runtime visibility state.
- [x] **PVD-022** Bikini top toggle hides/shows only BIKINI_TOP role meshes. Evidence: runtime visibility state.
- [x] **PVD-023** Bikini brief toggle hides/shows only BIKINI_BRIEF role meshes. Evidence: runtime visibility state.
- [x] **PVD-024** Wireframe toggle updates all three meshes and restores solid display. Evidence: material state.
- [x] **PVD-025** Display panel states use synchronized `aria-pressed` values and labels. Evidence: DOM state.
- [x] **PVD-026** Measurement, Display and Shape panels open/close without obstructing core navigation. Evidence: browser walkthrough.

## E. Loading, fallback and accessibility

- [x] **PVD-027** Loading state is visible before READY and removed afterward. Evidence: browser state/timing.
- [x] **PVD-028** GLB/WebGL failure path is implemented with explicit error text and static draft fallback. Evidence: HTML code and validator.
- [x] **PVD-029** Static fallback asset exists locally. Evidence: `qa/avatar_36C/bikini/clothed-front.png`.
- [x] **PVD-030** Quickstart states that localhost is required. Evidence: `quickstart.md`.
- [x] **PVD-031** No uncaught error or failed network request occurs in the supported browser run. Evidence: browser console/network capture.
- [x] **PVD-032** All icon, close, toggle and camera controls have accessible names or visible labels. Evidence: accessibility snapshot.
- [x] **PVD-033** Renderer caps device pixel ratio at 2. Evidence: viewer code.

## F. Evidence and decision

- [x] **PVD-034** Static prototype contract validator passes. Evidence: `npm run validate:prototype`.
- [x] **PVD-035** Browser evidence records the tested HTML path and GLB SHA. Evidence: validation report.
- [x] **PVD-036** Front, 45°, Side, Back and mobile screenshots exist under `qa/avatar_36C/prototype/`. Evidence: image set.
- [x] **PVD-037** Runtime interaction evidence covers camera, toggles, wireframe and panels. Evidence: validation report.
- [x] **PVD-038** `TASK_TRACKER.md` records prototype integration and browser validation status. Evidence: tracker.
- [x] **PVD-039** Known limitations list missing TD authority, semantic morphs, rig and final pose validation. Evidence: validation report.
- [x] **PVD-040** Final decision is `PROTOTYPE READY FOR USER TEST — DRAFT ASSET`. Evidence: completed checklist and report.

**Progress:** `40 / 40`  
**Current decision:** `PROTOTYPE READY FOR USER TEST — DRAFT ASSET`
