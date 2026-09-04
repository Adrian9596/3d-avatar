# Quickstart — Reproducing Stage 1 Validation

## Platform foundation

Install exact dependencies and verify the repository/toolchain boundary:

```sh
git lfs install --local
npm ci
npm run validate:bootstrap
npm run validate:requirements
npm run validate:platform
```

`validate:requirements` verifies all PFQ001–PFQ036 definitions and their cross-document traceability. It evaluates requirements quality only; it does not approve the current avatar or replace the implementation DoD.

Build and preview the modular production viewer:

```sh
npm run build:viewer
npm run preview:viewer
```

Open `http://127.0.0.1:4173/`. The modular viewer exposes the required morph and animation contracts but keeps those controls disabled while the draft GLB has no final rig, clips or approved semantic morphs. The original `digital_bra_fit_model_360.html` remains the controlled single-file prototype fixture.

## Prototype viewer — draft asset only

The current GLB can be tested in the browser before Stage 1 approval. This does not change its status from `DRAFT — NOT TD VALIDATED`.

```sh
npm install
npm run export:prototype
npm run validate:prototype
npm run validate:prototype:gltf
npm run serve:prototype
```

Then open `http://127.0.0.1:8765/digital_bra_fit_model_360.html`. Do not open the HTML with `file://`; ES modules and GLB loading require localhost.

Prototype completion is governed by `Definition of Done — Draft GLB Prototype Viewer.md`. It is not permission to replace production geometry or use draft measurements for fit decisions.

## Prerequisites

- Stable Blender compatible with the recorded MPFB version.
- MPFB and the exact system asset pack versions from the manifest.
- Approved `avatar_36C_measurements.md`.
- Node.js for local validation scripts and browser viewer checks.

## 1. Identify the asset under test

Record the version and hashes:

```sh
shasum -a 256 avatar_36C_master.blend assets/export/avatar_36C.glb
```

The output must match `avatar_36C_asset_manifest.md` and `qa/avatar_36C/validation.md`.

## 2. Run project validation

```sh
python3 scripts/validate_stage1.py
```

Expected result before final approval: machine-checkable items are reported individually; missing asset or authority files remain `BLOCKED`, never silently pass.

## 3. Run glTF validation

Install the pinned local validator once, then run it against the current GLB:

```sh
npm install
npm run validate:gltf
```

The JSON report is saved to:

```text
qa/avatar_36C/gltf-validator-report.json
```

Required result: zero errors; warnings must be listed and approved in the validation report.

## 4. Round-trip check

Run the scripted empty-scene import:

```sh
blender --background --python scripts/roundtrip_validate_glb.py --python-exit-code 1
```

Review `qa/avatar_36C/blender-roundtrip-report.json` for:

- scale and orientation;
- object/material names;
- six morph names;
- armature and skin weights;
- landmark representation.

Record the result in `qa/avatar_36C/validation.md`.

## 5. Visual QA

Generate the standardized draft views:

```sh
blender --background avatar_36C_master.blend --python scripts/render_draft_qa.py --python-exit-code 1
```

Front, 45°, Side and Back are written under `qa/avatar_36C/`. Wireframe, measurement overlay and reviewer scores remain required before final approval.

## 6. Final gate

Only change Stage 1 to `PASS` when:

- every DOD-001 through DOD-102 has a PASS evidence record;
- no `FAIL`, `BLOCKED` or `TBC` remains;
- TD, 3D and web roles approve the exact same version/SHA.
