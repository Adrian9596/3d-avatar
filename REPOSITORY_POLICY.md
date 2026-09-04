# Repository Policy — 3D Avatar

**Git root:** this directory (`3D avatar/`, initialized 2026-09-05)
**Policy status:** active for all platform work

## Git root

This project directory is its own Git repository — there is no parent or sibling project sharing this history, so no pathspec boundary is needed. Ordinary commands run from here are already scoped correctly:

```sh
git status --short
git diff
git add <explicit-file-or-directory>
```

Prefer explicit paths over `git add -A` when staging new or unfamiliar changes — not because of a shared parent repo (there isn't one), but as routine hygiene against accidentally staging a stray local file. Before committing, audit the staged set:

```sh
git diff --cached --name-only
git diff --cached --check
```

A commit message must not claim TD, anatomical, simulation or factory approval unless the corresponding human approval evidence exists in `qa/`.

**Historical note:** an older, unrelated repository at `/Users/crossian/Downloads/Web Tools` holds a prior copy of this project (path `3D avatar/`) from before the 2026-09-04 pivot, tied to the now-retired `avatar_36C_master.blend` / MPFB pipeline, on branch `3d-avatar/fix-ground-alignment`. That repo is a separate, stale lineage, not an ancestor of this one.

## Generated and evidence files

- `node_modules/`, Vite build output (`dist/`, `.vite/`), Python caches/venvs, OS/editor cruft, and local Claude Code session state (`.claude/settings.local.json`, `.claude/scheduled_tasks.lock`, `.claude/worktrees/`) are ignored.
- Reviewed reports under `qa/avatar_master/` (measurements, parity/validator reports, the POM sheet) are evidence and are **not** ignored — they are pinned to the asset SHA and are part of the record.
- The canonical `assets/source/avatar_master.blend`, the untouched `Avatarclo1_half_beautified_3quarter.blend`, and the canonical `assets/export/avatar_master.glb` are versioned through Git LFS.
- `.blend1`/`.blend2` Blender backups and the `backups/` directory are recoverable local snapshots, not canonical sources, and remain ignored.

## Binary policy

`.gitattributes` applies LFS only to authored 3D formats (`.blend`, `.glb`, `.gltf`, `.fbx`, `.abc`) and large texture containers (`.exr`, `.hdr`, `.ktx2`). Normal PNG/JPEG screenshots (e.g. `assets/export/avatar_master_reference_render.png`) stay in plain Git so review tools can display the QA record inline. Before staging a binary, verify:

```sh
git lfs track
git check-attr filter diff merge -- "assets/source/avatar_master.blend" "assets/export/avatar_master.glb"
git lfs ls-files
```

If Git LFS is unavailable, do not stage the `.blend` or GLB files — run `git lfs install` first.

## Recovery and source of truth

The canonical editable source is `assets/source/avatar_master.blend`; `assets/export/avatar_master.glb` is its derived export. Hash changes invalidate matching validation evidence in `qa/avatar_master/` and require the gates in `npm run validate:measurements` to be rerun. Repository versioning is not a substitute for an external backup of source assets. No approved measurement record exists for this body yet — do not describe it as TD-validated or production-ready in commit messages or docs.
