# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A digital bra-fit viewer built around a torso avatar (head/hands/legs excluded by design) authored in Blender from a CLO3D export, exported as GLB, and displayed in two Three.js viewer lanes.

**2026-09-04 pivot:** the original Stage-1 MPFB/TD-measurement pipeline (`avatar_36C_master.blend`, the `avatar_36C` GLBs, and the ~18 docs/QA evidence that governed it) has been retired — the source `.blend` for that pipeline no longer exists in this project and the whole TD-measurement gate ladder it depended on is gone with it. The canonical avatar is now:

- **Canonical editable source:** `assets/source/avatar_master.blend` (a checkpoint saved from a CLO3D "Avatarclo1" export; the untouched original sits at `Avatarclo1_half_beautified_3quarter.blend` in the project root).
- **Canonical export:** `assets/export/avatar_master.glb` (baked PBR skin embedded, ~10 MB).
- **Textures:** re-baked set in `Blender/output/textures` (`Mara_body3_*`, `Mara_arm2_*`, 2048²), packed into the `.blend`. The original CLO3D images are gone — they only ever existed on the Windows machine that made the export.
- **Known gap:** no approved measurement record exists for this body. Do not claim it is TD-validated, measured, or production-ready.

## Git boundary

**2026-09-05:** this directory is now its own Git repository — `git init` was run here directly, so this project directory *is* the Git root. There is no parent/sibling boundary to scope pathspecs around any more; ordinary `git add`/`git status`/`git diff` run from here operate only on this project.

(Historical note: an older, unrelated repo at `/Users/crossian/Downloads/Web Tools` contains a prior copy of this project under `3D avatar/`, tied to the now-retired `avatar_36C` pipeline, on branch `3d-avatar/fix-ground-alignment`. That repo is a separate, stale lineage — not the ancestor of this one — and this project's history starts fresh here.)

`.blend` and GLB files go through Git LFS (`.gitattributes`); if LFS is unavailable, do not stage them (`git lfs install` must have run once, locally, first). Blender `.blend1`/`.blend2` backups and the `backups/` directory stay ignored — they are recoverable local snapshots, not canonical sources. Full rules: `REPOSITORY_POLICY.md`.

## Commands

Validation (Node/Python, no Blender required):
- `npm run validate:gltf -- assets/export/avatar_master.glb qa/avatar_master/gltf-validator-report.json` — Khronos glTF validator (required: zero errors)
- `npm run validate:viewer-contracts` — the viewer's morph/animation contract tests (asset-agnostic; reports `Blocked` when an asset has no morphs/clips instead of failing silently)

Measurement (see `MEASUREMENT_PLAN.md`):
- `npm run measure:avatar` — authority pass: measures the GLB per `contracts/measurement-registry.json`, writes SHA-pinned evidence to `qa/avatar_master/measurements.json`. Pure Python, no Blender.
- `npm run validate:measure-parity` — asserts the Python authority pass and the JavaScript engine the viewer uses agree within the registry tolerance (0.5mm; currently 0.048mm worst case). Fails the build on drift or on stale evidence.
- `npm run validate:surface-path` — the pen's shortest-surface-path routine, gated two ways: accuracy against an analytic cylinder geodesic (0.057mm worst) and **continuity** — parking control points on a run must not change its length (0.117mm worst, budget 0.2mm).
- `npm run validate:cup-volume` — the closed-surface cup-volume routine against analytic spherical caps, **including a 120° cap that overhangs its own boundary** (0.064% worst). Each case also records what the superseded projection method would have said (7.27% worst), so the reason it was replaced stays visible.
- `npm run validate:lane-parity` — static guard that the prototype and production viewer lanes cannot disagree: the served registry must be byte-identical to `contracts/`, both lanes must import the shared engine and must not reimplement it, and the production lane must hardcode no material name or scan range.
- `npm run sync:registry` — copies the registry into `viewer/public/`; runs automatically before `dev:viewer` and `build:viewer`.
- `npm run validate:measurements` — chains all of the above in order (sync, measure, then the four gates). Run it after any re-export. Each gate is also its own npm script, so run one alone when iterating.
- `npm run export:pom-sheet` — builds `qa/avatar_master/pom-sheet.csv` and `.json` from the SHA-pinned evidence. Refuses stale evidence. There is deliberately no second sheet generator in the viewer: one generator cannot disagree with itself. `house_code` in the registry is null until the house POM codes are confirmed, so the sheet stamps `Codes: PROVISIONAL` and falls back to internal ids rather than inventing one.

Viewers:
- `npm run dev:viewer` / `npm run build:viewer` / `npm run preview:viewer` — modular Vite viewer (`viewer/`). `vite.config.mjs` honours `PORT`, and `.claude/launch.json` sets `autoPort`, so a free port is taken automatically when 4173 is busy — an unrelated app on this machine often holds it. Do not kill whatever owns 4173.
- `npm run serve:prototype` then open `http://127.0.0.1:8765/digital_bra_fit_model_360.html` — single-file prototype. Never open it via `file://`; ES modules and GLB loading require localhost.
- `npm run build:pages` — builds what GitHub Pages serves: **the prototype is the landing page** (`/`) and the production viewer sits under `/viewer/`. It wipes `dist/` first, since the prototype build runs with `emptyOutDir:false` so it cannot delete the viewer built before it.
- `npm run build:prototype` — the prototype half alone (`vite.prototype.config.mjs`).

The old Blender-headless MPFB scripts in `scripts/` (`create_mpfb_draft.py`, `measure_master_body.py`, `build_bikini_top.py`, etc.) and their `npm run export:prototype` / `measure:draft` / `validate:ground-alignment` / `audit:mesh` / `build:bikini-top` entries in `package.json` all target the now-nonexistent `avatar_36C_master.blend` and will fail until repointed or removed.

## Architecture

Pipeline flow: `assets/source/avatar_master.blend` (canonical editable source, CLO3D-derived) → `assets/export/avatar_master.glb` → two viewer lanes → `npm run validate:gltf` writing evidence into `qa/avatar_master/`.

- **The two lanes differ in what they may CHANGE, not in maths.** Both import `scripts/measure_core.mjs`, `scripts/surface_path.mjs` and `scripts/pen_tool.mjs`, and read the same registry, so they cannot disagree about a number — `npm run validate:lane-parity` enforces all of that, including that neither lane reimplements the pen.
  Both lanes have the pen: it draws ad-hoc measured lines, touches no POM and no landmark file, and exports separately to `draft-lines.json`, so it creates no second source of truth. **Hand-placed landmarks stay in the prototype lane only** — they are an input to the authority pass and change measured values, so there must be one place to correct them and one record. Do not add landmark editing to `viewer/`.
  The prototype is a single self-contained HTML file (Three.js via an importmap over `node_modules`) **as authored and served locally** — for deployment it is bundled by `vite.prototype.config.mjs` into one hashed `.js`, because a deployed site must serve **no `.mjs`**: static hosts disagree on its MIME type (nginx says `application/octet-stream`, Apache says nothing) and a browser refuses to run a module that is not labelled JavaScript. Bundling also drops ~39 MB of vendored three.js. The deploy workflow fails if any `.mjs` reaches `dist/`. Do not switch the deploy back to copying the raw file plus `node_modules`. The production lane is a Vite app (`viewer/src/main.js`, `measurements.js`, `contracts.js`, `animation-controller.js`). Both point at the same asset — there is no draft/production gate any more, since the Stage-1 apparatus that defined it was retired.
- **Contracts stay honest by construction:** `viewer/src/contracts.js` and `animation-controller.js` check for six named semantic morphs and specific animation clips; `avatar_master.glb` has neither, so both come back `BLOCKED`. The panels that displayed those notices were removed — they were permanently blocked and told a reader nothing — but **the check itself still runs** into `window.__avatarPlatform`, and `npm run validate:viewer-contracts` asserts it reports BLOCKED rather than inventing substitute controls. Do not delete the check along with its UI, and do not add shape or motion controls back without morphs and clips to drive them.
- **One path model, for a reason.** `scripts/surface_path.mjs` computes the shortest path along the surface and nothing else. Do not reintroduce a second path model (a plane-constrained run, a projected Bézier) for the same measurement: only the shortest path has the property that a sub-path of it is also a shortest path, which is what keeps a reading from jumping when a segment gains control points. An earlier build with two models shifted by 3% on a mode switch. Convergence needs the multigrid schedule in that file — a flat relaxation reintroduces jumps up to 8.8mm.
  The one exception is `section_arc`, used only by the band POMs: a band follows the underbust line, so the arc of that section is the right model there and a free shortest path would cut a chord across it. It is a different measurement, not a second model for the same one.
- **Three GLB parsers, on purpose.** three.js in the browser, `scripts/glb_reader.mjs` in Node, and a reader inside `scripts/measure_avatar.py`. That is not duplication to clean up — it is part of what the parity gate verifies.
- **Measurement is registry-driven and cross-checked.** `contracts/measurement-registry.json` declares every POM, its landmark, its tape model and its status; nothing is measured or displayed that it does not declare, and a `blocked` POM never yields a number. `scripts/measure_core.mjs` is the one JavaScript engine, imported by both `digital_bra_fit_model_360.html` and the parity test, so what the viewer shows is what the test checks. `scripts/measure_avatar.py` is a deliberately independent Python re-implementation; `scripts/test_measurement_parity.mjs` gates their agreement. Girth is always the convex hull of a section, never the raw contour — the difference is ~20mm at the bust.
### Measurement rules that are easy to break

Surface-path POMs (cup depth, HPS→apex, breast root arc, wing height) use `scripts/surface_path.mjs` and its independent Python port `scripts/surface_path.py`. Keep the two algorithms identical — same seed, same resampling, same multigrid schedule — or the parity gate fails; the code is deliberately separate so the gate can catch a mistake.

`CUP_VOLUME_L/R` use `enclosed_volume_closed` — a closed-surface divergence integral, accurate to 0.064% against analytic spherical caps including an overhanging one. Do not go back to the projection method in the same file (`enclosed_volume`): it is 7% light on an overhanging mound and cannot detect that. The routine asserts its sealed surface is watertight; if that assertion ever fires, suspect degenerate triangles before suspecting the maths. The value is dominated by where the root loop is placed — ±18% across a 3cm move of `ROOT_TOP` — so it is `blocked_until_manual` and its sensitivity travels with it into the sheet.

**The test a landmark rule has to pass: its answer must not track a number someone chose.**
`UNDERARM_L/R` passes — the torso is open at the armhole, so its four boundary loops are a real
feature (highest = neck, lowest = waist, the two left over are the armholes), and no threshold
appears anywhere. `CF_UNDERBUST`, `CB_UNDERBUST` and `SIDE_UNDERBUST_L/R` pass the same way,
being extremes along the fold section. `HPS` failed it and was deleted.

`HPS_L` / `HPS_R` are **manual_only**. Do not add an automatic HPS rule: one was tried and deleted because it returned whatever sat on its own inner cutoff (a 58mm spread in height from a parameter with no anatomical basis). POMs needing it carry status `blocked_until_manual` and yield no value until someone places the landmark.

Hand-placed landmarks: the viewer's Landmarks panel writes `qa/avatar_master/landmarks.manual.json`, which `measure_avatar.py` reads as an **input**. It is pinned to the asset SHA and rejected if it was recorded against a different body. Provenance is recorded per landmark and per POM (`auto` / `manual` / `derived_from_manual`), so evidence always says which numbers a person influenced. Delete the file to return to automatic detection.

- **Rendering:** both viewers use `THREE.NeutralToneMapping` at exposure 1.0 plus a `RoomEnvironment` IBL. Do not switch back to ACES Filmic — it desaturates this skin to a flat off-white. The four open cut faces (neck/waist/wrists) sit on an untextured `Skin_Cut` material because their UVs fall in the atlas's unbaked black background.
- **`contracts/avatar-asset-contract.md`** describes the current asset's identity, coordinate convention (mm authored in CLO3D, converted to meters on export) and known gaps — no morphs, no rig, and no approved measurement record. The skin *is* textured; do not reintroduce the old "no textures" wording.

## Evidence

Everything measurable writes a report into `qa/avatar_master/`, each pinned to the asset SHA:
`measurements.json` (the authority pass), `measurement-parity.json`, `surface-path-test.json`,
`cup-volume-test.json`, `lane-parity.json`, `gltf-validator-report.json`, and the exported
`pom-sheet.csv` / `.json`. `landmarks.manual.json` is the one file in there that is an **input**
rather than an output.

Every gate refuses stale evidence rather than comparing against it: if the asset SHA, the
registry SHA or the override file's SHA no longer matches what is on disk, the run fails and
names both hashes. When a gate fails that way the fix is to rerun the pass, never to relax the
check.

## Non-negotiable boundaries

- Do not invent measurements, textures, or capabilities this avatar doesn't have. If a claim (textured, rigged, TD-approved, morph-driven) isn't backed by evidence in `qa/`, don't make it in UI copy, docs, or commit messages.
- A successful GLB export or a green glTF validator run is not visual, anatomical, or TD approval.
- Do not label the asset factory-ready, simulation-ready, or multi-size-ready.
- Prefer a stated inability to a plausible number. Two measurements were withheld for this reason (HPS, and cup volume before the method was replaced), and in both cases the wrong number would have looked entirely reasonable. When a rule's output is dominated by a parameter with no basis, delete the rule.
- When adding a POM, add it to the registry first, implement it in **both** engines, and check the parity gate covers it — a POM that only one side computes silently stops being verified.
