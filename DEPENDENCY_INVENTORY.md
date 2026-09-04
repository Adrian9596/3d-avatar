# Dependency Inventory — 3D Avatar Platform

**Recorded:** 2026-08-14  
**Scope:** authoring, export, validation and browser prototype

## Host tools

| Tool | Required version/policy | Purpose |
|---|---|---|
| macOS | current project workstation | Blender authoring and local browser QA |
| Git | 2.50.1 observed; Git 2.x required | source and evidence history |
| Git LFS | installed and repository-local initialization required | `.blend`, `.glb` and approved binary classes |
| Blender | 5.2.0 LTS | canonical authoring, rendering and export |
| MPFB | 2.0.17 build 20260722 | candidate base generation only |
| Node.js | 25.5.0 observed; CI version is declared by the project workflow | Three.js viewer and glTF validation |
| npm | 11.8.0 observed; lockfile installation required | exact JavaScript dependency reproduction |
| Python | 3.9.6 observed; Python 3.9+ | project validators and orchestration |

## JavaScript dependencies

`package.json` and `package-lock.json` are the authoritative exact dependency record. Use `npm ci`; do not replace the lockfile with an unlocked install in validation or CI.

- `three@0.179.1`: viewer runtime, GLTFLoader and OrbitControls.
- `gltf-validator@2.0.0-dev.3.10`: Khronos glTF validation wrapper.
- `vite@8.2.1`: exact-pinned modular viewer development and production build.

## Python and Blender dependencies

Project-side Python validators use only the Python standard library. There is no project `pip` dependency to install at this stage.

Blender automation imports `bpy`, which is supplied by Blender's bundled Python runtime and must be run with the Blender executable. MPFB is a Blender extension and is recorded in the asset reports; it is not a pip dependency.

The GitHub Actions workflow is a non-GUI contract/build lane on Linux and macOS; it does not author or re-export Blender geometry. Blender availability is therefore reported as `SKIP` only when the standard `CI` environment flag is present. Local workstation bootstrap still fails if Blender is absent.

## Reproduction commands

```sh
git lfs install --local
npm ci
python3 scripts/check_bootstrap.py
npm run validate:platform
```

The platform validator may report the avatar asset gate as `BLOCKED` while TD measurement authority, final rig and semantic morphs remain unavailable. It must still fail on missing dependencies, missing critical files, hash drift or glTF errors.
