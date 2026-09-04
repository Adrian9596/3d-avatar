# Definition of Done — 3D Avatar Platform Foundation

**Status:** `IN PROGRESS`  
**Requirements:** `PLATFORM_FOUNDATION_REQUIREMENTS.md`  
**Created:** 2026-08-14  
**Rule:** tick only when the named evidence exists and is current. Platform readiness never substitutes for approval of an avatar asset.

## A. Governance and lifecycle

- [x] **PFD-001** Platform requirements and an implementation DoD exist. Evidence: requirements plus this file.
- [x] **PFD-002** Platform readiness is explicitly separated from measurement, anatomy, factory and simulation approval. Evidence: Requirements §1 and §10.
- [x] **PFD-003** Authority hierarchy and draft/release boundaries are documented. Evidence: `PROJECT_CONTEXT.md`.
- [x] **PFD-004** Runtime asset identity, coordinate, naming and budget contract exists. Evidence: `contracts/avatar-asset-contract.md`.
- [x] **PFD-005** Measurement specification contains the required rows, methods, unit and tolerance structure. Evidence: `avatar_36C_measurements.md`.
- [ ] **PFD-006** A TD-approved measurement authority and all numeric values are available. Evidence: approved measurement record.
- [x] **PFD-007** TD, 3D and web review responsibilities and evidence types are documented. Evidence: Stage 1 DoD and project context.
- [x] **PFD-008** Hash-change evidence invalidation and status-transition rules are documented. Evidence: requirements and validation contracts.

## B. Repository and dependency foundation

- [x] **PFD-009** Actual Git root is identified as the parent `Web Tools` directory. Evidence: `git rev-parse --show-toplevel` plus project context.
- [x] **PFD-010** Project-scoped staging/commit boundary prevents accidental inclusion of sibling Web Tools projects. Evidence: `REPOSITORY_POLICY.md` plus scoped `git status` audit.
- [x] **PFD-011** Ignore rules cover local caches, temp renders, Blender crash/backup files and generated dependencies without hiding required evidence. Evidence: `.gitignore` and `git check-ignore` audit.
- [x] **PFD-012** Git LFS or an approved binary store is installed and initialized for this repository. Evidence: Git LFS 3.7.1 plus successful `git lfs env`.
- [x] **PFD-013** `.gitattributes` tracks approved `.blend`, `.glb`, texture and animation binary classes without broad unintended patterns. Evidence: `.gitattributes` plus `git check-attr`; PNG QA evidence remains normal Git.
- [x] **PFD-014** Node dependencies are exact-pinned and `package-lock.json` is current. Evidence: `package.json`, lockfile and clean `npm install --package-lock-only`.
- [x] **PFD-015** Python/tool dependencies outside Blender’s bundled runtime are declared and pinned, or explicitly documented as stdlib-only. Evidence: `DEPENDENCY_INVENTORY.md` and 17/17 bootstrap checks.
- [ ] **PFD-016** A clean-clone/bootstrap run recreates the local validation environment using only documented commands. Evidence: fresh-directory transcript.

## C. Authoring platform

- [x] **PFD-017** Blender version is installed and recorded. Evidence: Blender 5.2.0 LTS reports and manifest.
- [x] **PFD-018** MPFB version/build and candidate-source role are recorded. Evidence: MPFB 2.0.17 build 20260722 reports.
- [x] **PFD-019** Base graphical asset license evidence exists. Evidence: `assets/source/mpfb-base-license-evidence.txt`.
- [x] **PFD-020** Canonical editable master Blend exists with current SHA-256. Evidence: `avatar_36C_master.blend` and manifest.
- [x] **PFD-021** Character creation, presentation, export and inspection operations have rerunnable Blender/Python scripts. Evidence: `scripts/` inventory.
- [x] **PFD-022** BODY, BIKINI_TOP and BIKINI_BRIEF have separate semantic identities. Evidence: GLB structure and browser diagnostics.
- [x] **PFD-023** A prototype-specific export removes MPFB helper geometry and generator morphs without replacing the canonical GLB. Evidence: `scripts/export_prototype_glb.py` and prototype report.
- [ ] **PFD-024** TD-fitted body and bra-fit topology are approved and frozen for final rig authoring. Evidence: completed master-fit DoD and reviewed hash.

## D. Rig and motion foundation

- [ ] **PFD-025** Minimum bilateral armature bone inventory and stable naming contract pass. Evidence: rig inventory report.
- [ ] **PFD-026** Neutral A-pose rest angle is recorded between 30–45° and skeleton axes/transforms are clean. Evidence: rest-pose report.
- [ ] **PFD-027** Skin weights avoid shoulder, axilla, breast and torso collapse at neutral. Evidence: weight heatmap and neutral renders.
- [ ] **PFD-028** Required pose states exist: down, 45°, 90°, 120°, overhead 150–160° and forward 90°. Evidence: named pose/action inventory.
- [ ] **PFD-029** Continuous down → overhead → down sweep has no snap, discontinuity or failure to return to neutral. Evidence: animation clip plus sampled report.
- [ ] **PFD-030** Breast root, IMF and apex remain chest-driven rather than upper-arm-driven. Evidence: local landmark deltas and Front/Side views.
- [ ] **PFD-031** Required landmarks follow body deformation in every pose. Evidence: landmark-parent/follow report.
- [ ] **PFD-032** Body and bikini have no critical self-intersection, penetration, z-fighting or sensitive-area exposure throughout motion. Evidence: collision/coverage sweep report.
- [ ] **PFD-033** Required pose matrix passes at min/default/max for all six semantic morphs. Evidence: combined-state matrix.
- [ ] **PFD-034** Rig, weights, animations, landmarks and semantic morphs survive clean GLB re-import. Evidence: final round-trip report.

## E. Asset and export pipeline

- [x] **PFD-035** Canonical self-contained draft GLB export exists with version/hash evidence. Evidence: `assets/export/avatar_36C.glb` and manifest.
- [x] **PFD-036** Browser-safe prototype GLB is a separate artifact with its own version/hash. Evidence: `assets/export/avatar_36C_prototype.glb`.
- [x] **PFD-037** Export scripts produce machine-readable object, material, geometry and SHA reports. Evidence: canonical/prototype export reports.
- [x] **PFD-038** Canonical GLB passes Khronos validation with zero errors and warnings. Evidence: `qa/avatar_36C/gltf-validator-report.json`.
- [x] **PFD-039** Prototype GLB passes Khronos validation with zero errors and warnings. Evidence: `qa/avatar_36C/prototype-gltf-validator-report.json`.
- [x] **PFD-040** Canonical GLB has a clean-scene Blender round-trip report. Evidence: `qa/avatar_36C/blender-roundtrip-report.json`.
- [x] **PFD-041** File-size, triangle, texture, first-frame and FPS budgets are defined. Evidence: asset contract.
- [x] **PFD-042** Prototype runtime has current browser load/framing evidence. Evidence: `qa/avatar_36C/prototype-validation.md`.
- [ ] **PFD-043** Final canonical GLB contains and validates the approved rig, animations, landmarks and six semantic morphs. Evidence: final structure/validator/round-trip reports.

## F. Web viewer foundation

- [x] **PFD-044** Three.js is exact-pinned locally; no runtime CDN is required. Evidence: package files and import map.
- [x] **PFD-045** Viewer uses GLTFLoader/OrbitControls with local GLB loading, orbit, zoom, reset and camera presets. Evidence: viewer code and browser validation.
- [x] **PFD-046** Loading, ready, draft-blocked and recoverable fallback states are implemented. Evidence: prototype viewer and validator.
- [x] **PFD-047** Semantic BODY/top/brief visibility and wireframe controls use role data rather than mesh array order. Evidence: runtime diagnostics.
- [x] **PFD-048** Desktop/mobile framing and named accessible controls pass browser review. Evidence: five screenshots and DOM snapshot.
- [x] **PFD-049** Runtime diagnostics expose asset version, SHA, roles, mesh counts, feature availability, camera and load timing. Evidence: `prototypeDiagnostics`.
- [x] **PFD-050** Viewer maps exactly six approved morph names and blocks missing/duplicate mappings. Evidence: `viewer/src/contracts.js` and `qa/avatar_36C/viewer-contract-test.json`; current asset remains blocked.
- [x] **PFD-051** Viewer enumerates required animation clips and provides truthful pose/playback controls. Evidence: animation controller/contract test and browser-disabled missing controls.
- [x] **PFD-052** Production viewer is modularized and built with Vite while the single-file prototype remains a fixture. Evidence: `viewer/`, Vite 8.2.1 build and local preview QA.

## G. QA and CI foundation

- [x] **PFD-053** Static, prototype, canonical glTF and Stage 1 validation commands are documented and runnable. Evidence: package scripts and quickstart.
- [x] **PFD-054** Real browser walkthrough covers load, desktop/mobile framing, camera, panels, semantic toggles and console errors. Evidence: prototype validation report.
- [x] **PFD-055** Named Front, 45°, Side, Back and mobile screenshot evidence exists. Evidence: `qa/avatar_36C/prototype/`.
- [x] **PFD-056** One aggregate project command runs the complete local platform validation suite and emits a summary. Evidence: `npm run validate:platform` and platform validation JSON.
- [ ] **PFD-057** CI workflow is scoped to `3D avatar`, installs the correct dependencies and calls only available project commands. Evidence: successful project CI run.
- [ ] **PFD-058** Reviewed screenshot baselines and a non-authoritative visual regression lane exist. Evidence: baseline manifest and diff report.
- [ ] **PFD-059** Clean Linux/macOS CI or documented platform matrix proves reproducibility outside the author workstation. Evidence: CI matrix results.
- [x] **PFD-060** Automated validation fails on prototype/canonical hash drift and missing critical artifacts. Evidence: prototype and Stage 1 validators.

## H. Deployment, operations and privacy

- [ ] **PFD-061** A static hosting provider and ownership/cost decision are recorded. Evidence: deployment decision record.
- [ ] **PFD-062** Preview deployment uses a tested build artifact and a distinct non-production URL. Evidence: preview deployment report.
- [ ] **PFD-063** Production deployment is technically configured but gated behind final asset/release approval. Evidence: protected deployment configuration.
- [ ] **PFD-064** `.glb` MIME, CORS, cache-control and base-path behavior pass on the selected host. Evidence: response-header audit.
- [ ] **PFD-065** Viewer references immutable/versioned asset URLs or verifies hashes before accepting updates. Evidence: deployment asset manifest.
- [ ] **PFD-066** Rollback restores the previous viewer and GLB pair without stale-cache mismatch. Evidence: rollback rehearsal.
- [x] **PFD-067** Runbook covers bootstrap, validation, preview, production approval, rollback and evidence recovery. Evidence: `PLATFORM_RUNBOOK.md`.
- [ ] **PFD-068** Complete software/graphical license inventory and privacy boundary are reviewed before public deployment. Evidence: license/privacy record.

## I. Handoff and final decision

- [x] **PFD-069** Platform work is represented in `TASK_TRACKER.md` with dependencies and evidence. Evidence: platform-foundation lane.
- [x] **PFD-070** One platform validation report links all current evidence and unresolved limitations. Evidence: `qa/avatar_36C/platform-foundation-validation.json`.
- [ ] **PFD-071** TD, 3D and web/platform reviewers sign the exact foundation version and relevant asset hashes. Evidence: approval table.
- [ ] **PFD-072** Final decision is `PLATFORM FOUNDATION READY — ASSET APPROVAL REMAINS SEPARATE`. Evidence: completed 72/72 checklist.

## Progress and execution order

**Progress:** `46 / 72`  
**Current decision:** `IN PROGRESS`

Execution order:

1. commit/bootstrap the project boundary and obtain a clean-clone transcript;
2. run the project-scoped Linux/macOS CI matrix;
3. obtain TD authority and freeze the fitted master geometry;
4. author the final rig, poses/motion, landmarks and combined morph QA;
5. complete the final GLB contract;
6. select preview hosting, audit headers/cache/base path and rehearse rollback;
7. obtain three-role foundation approval.

Draft harness and viewer architecture may proceed before TD approval. Final body fitting, rig weighting and release approval may not.
