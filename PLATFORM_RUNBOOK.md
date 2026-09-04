# Platform Runbook — 3D Avatar

## Bootstrap

From `/Users/crossian/Downloads/Web Tools/3D avatar`:

```sh
git lfs install --local
npm ci
npm run validate:bootstrap
```

Only stage project-scoped paths as defined in `REPOSITORY_POLICY.md`. If a binary is not LFS-filtered, stop before staging.

## Local validation

```sh
npm run validate:platform
```

Required platform result is zero `FAIL`. `PASS_WITH_ASSET_BLOCKERS` is acceptable for platform development only and must retain the exact asset blockers. It is not a production decision.

## Build and preview

```sh
npm run build:viewer
npm run preview:viewer
```

Test `http://127.0.0.1:4173/` on desktop and mobile. Confirm the loaded SHA/version, three semantic roles, camera/display controls, disabled missing-feature controls and zero console errors. The tested artifact is `dist/`; do not deploy a fresh unvalidated rebuild.

## Production approval

Production remains blocked until a host is selected, header/cache/base-path checks pass, the final asset contains approved rig/morph/animation/landmark data, and TD/3D/web reviewers approve matching hashes. A green platform validator cannot bypass those gates.

## Rollback

Release the viewer bundle and GLB as one versioned pair. Preserve the immediately previous immutable pair and manifest. To roll back, switch the host pointer to the previous pair, invalidate only the mutable entry document, then verify the loaded viewer version and GLB SHA in diagnostics. Do not mix a previous viewer with a current GLB or vice versa.

## Evidence recovery

Canonical Blender source is the manifest-matched `.blend`; GLBs are derived exports. Restore large binaries through Git LFS or the approved backup, rerun every hash-dependent validator, regenerate reports/screenshots and require renewed human review. Never reuse evidence whose input hash no longer matches.

