# 3D Avatar — Digital Bra-Fit Viewer

A torso avatar (head/hands/legs excluded by design) authored in Blender from a CLO3D
export, exported as a single GLB, and displayed in two Three.js viewer lanes for
visual bra-fit review.

> **Status: `DRAFT — NO MEASUREMENT RECORD`.** This body has not been TD-validated,
> measured, or approved for production/factory use. A green glTF validator run or a
> working viewer is not anatomical or fit approval. See
> [Status & known gaps](#status--known-gaps) before using any number this app shows.

## Live demo

Both lanes auto-deploy to GitHub Pages on every push to `main` (see [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)) — open these directly, no local setup needed to just look:

- **Production viewer:** https://adrian9596.github.io/3d-avatar/
- **Authoring/prototype lane:** https://adrian9596.github.io/3d-avatar/prototype/digital_bra_fit_model_360.html

The authoring lane's Save buttons trigger a browser file download (`landmarks.manual.json` / `draft-lines.json`) — there's no backend, so anything saved on the live site has to be manually downloaded and placed into `qa/avatar_master/` in a clone, then committed, for it to actually count as project evidence.

## What's in this repo

- **Canonical editable source:** [`assets/source/avatar_master.blend`](assets/source/avatar_master.blend) — a checkpoint saved from a CLO3D "Avatarclo1" export. The untouched original sits at [`Avatarclo1_half_beautified_3quarter.blend`](Avatarclo1_half_beautified_3quarter.blend) in the project root.
- **Canonical export:** [`assets/export/avatar_master.glb`](assets/export/avatar_master.glb) — baked PBR skin embedded, ~10 MB.
- **Two viewer lanes that cannot disagree** (enforced by a parity test, see below):
  - [`digital_bra_fit_model_360.html`](digital_bra_fit_model_360.html) — the **authoring** lane: pen tool, hand-placed landmarks, live cross-section. Single self-contained HTML file (Three.js via an import map over `node_modules`).
  - [`viewer/`](viewer) — the **production** lane: read-only presentation. A Vite app (`viewer/src/main.js`, `measurements.js`, `contracts.js`, `animation-controller.js`).
  - Both import the same measurement engine ([`scripts/measure_core.mjs`](scripts/measure_core.mjs)) and read the same registry ([`contracts/measurement-registry.json`](contracts/measurement-registry.json)), so there is one place to correct a measurement rule, not two.
- **Independent Python re-implementation** ([`scripts/measure_avatar.py`](scripts/measure_avatar.py)) that a parity gate checks against the JS engine — a second opinion, not a duplicate to clean up.

## Status & known gaps

From [`contracts/avatar-asset-contract.md`](contracts/avatar-asset-contract.md):

- **No approved measurement record** exists for this body. Nothing in this asset licenses a bust/underbust/cup claim.
- **No morph targets, no rig, no animation clips.** The viewer correctly shows "Blocked" for shape/motion controls instead of faking capability — this is intentional, not a missing feature.
- **Torso only:** neck cut at the base of the head, arms cut at the wrist, body cut at the waist/hip. No head, hands, legs, eyes, teeth, or hair geometry.
- **Original CLO3D textures are gone** — they only ever existed on the Windows machine that made the export. The current skin comes from a re-baked `Mara_body3_*` / `Mara_arm2_*` set (2048², packed into the `.blend`).
- Two measurements are deliberately withheld rather than guessed: **HPS** (`manual_only` — an earlier automatic rule was deleted for returning whatever sat on its own made-up cutoff) and **cup volume** (uses a closed-surface integral, not the older projection method, which was 7% light on an overhanging mound).

## Prerequisites

Observed on the reference workstation — pin close to these, exact versions aren't required except where noted:

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 25.5.0 | viewer, glTF validation, JS measurement engine |
| npm | 11.8.0 | dependency install (lockfile-pinned) |
| Python | 3.9.6 (3.9+) | measurement/validation scripts — standard library only, no `pip` install needed |
| Git | 2.x | source and evidence history |
| **Git LFS** | any recent | **required** — `assets/source/avatar_master.blend`, `assets/export/avatar_master.glb`, and the root `.blend` are stored as LFS objects |

Blender is **not** required to run or test anything in this repo — it's only needed if you're re-authoring the source `.blend` itself.

## Setup

```sh
git lfs install          # one-time per machine, if you haven't already
git clone https://github.com/Adrian9596/3d-avatar.git
cd 3d-avatar
npm install
```

If `git lfs install` wasn't run before cloning, `assets/**/*.blend` and `assets/**/*.glb` will be tiny pointer-text files instead of real binaries — run `git lfs pull` afterwards to fix that.

## Running the viewers

**Production lane (Vite):**

```sh
npm run dev:viewer       # sync:registry runs automatically first (predev:viewer hook)
```

`vite.config.mjs` honours `PORT`, and `.claude/launch.json` sets `autoPort`, so a free port is taken automatically if `4173` is busy.

```sh
npm run build:viewer     # production build
npm run preview:viewer   # serve the build
```

**Prototype/authoring lane:**

```sh
npm run serve:prototype
```

Then open `http://127.0.0.1:8765/digital_bra_fit_model_360.html`. **Never open it via `file://`** — ES modules and GLB loading require `localhost`.

## Validation / testing

```sh
# glTF structural validity (required: zero errors)
npm run validate:gltf -- assets/export/avatar_master.glb qa/avatar_master/gltf-validator-report.json

# viewer's morph/animation contract tests (asset-agnostic)
npm run validate:viewer-contracts

# full measurement chain: sync registry → measure → 8 accuracy/parity gates
npm run validate:measurements
```

`validate:measurements` chains, in order: `sync:registry`, `measure:avatar` (Python authority pass, writes SHA-pinned evidence to `qa/avatar_master/measurements.json`), then eight gates —
`validate:measure-parity` (JS vs Python agree within 0.5mm), `validate:surface-path` (pen's shortest-path routine vs. an analytic cylinder geodesic, plus a continuity check), `validate:cup-volume` (closed-surface volume vs. analytic spherical caps), `validate:lane-parity` (the two viewer lanes can't disagree — shared registry, shared engine, no hardcoded material/scan-range in production), and the 2D pattern-draft gates `validate:flatten-accuracy` (flattening vs. surfaces that unroll exactly), `validate:flatten-parity` (JS vs Python flattening agree to 1µm), `validate:seam-closure` (two panels flattened together agree on their shared seam to 1/8in) `validate:dxf-roundtrip` (the ASTM D6673-10 / Gerber DXF reads back with an independent parser), and the interaction gates `validate:pen-snap` (where a pen anchor snaps: nearest within the radius, priority on ties, held constraints first, mirror residual recorded), `validate:view-geometry` (footprint, incidence, facing pose and turntable against analytic answers) and `validate:keymap` (one conflict-free keyboard map for both lanes, with the plan's tables regenerated from the code). See `PATTERN_2D_DXF_PLAN.md` and `AUTHORING_UX_PLAN.md`.

Every gate is pinned to the current asset/registry SHA and refuses to run against stale evidence — if you see a SHA-mismatch failure, rerun the pass rather than trying to relax the check.

Also useful:

```sh
npm run export:pom-sheet   # builds qa/avatar_master/pom-sheet.csv + .json from the SHA-pinned evidence
```

## A note on legacy scripts

`package.json` and `quickstart.md` still contain scripts and instructions from **before the 2026-09-04 pivot** (`validate:stage1`, `export:prototype`, `measure:draft`, `validate:ground-alignment`, `audit:mesh`, `build:bikini-top`, and others invoking Blender against `avatar_36C_master.blend`). That source file no longer exists in this project — those commands will fail until repointed or removed. The commands listed above under [Running the viewers](#running-the-viewers) and [Validation / testing](#validation--testing) are the current, working set. See `CLAUDE.md` for the full list of what's retired.

## Asset provenance & licensing

- The body is CLO3D-derived (see [Status & known gaps](#status--known-gaps)); [`assets/source/mpfb-base-license-evidence.txt`](assets/source/mpfb-base-license-evidence.txt) records CC0 licensing evidence for the MPFB/MakeHuman `hm08` base mesh present earlier in this project's lineage. That evidence clears the core basemesh only — it does not, by itself, license the current baked skin/textures.
- This is internal tooling for Crossian's bra product development. The repo is **public** so the team can clone/test it without needing individual collaborator invites, but it stays proprietary: see [`LICENSE`](LICENSE) — all rights reserved, no reuse permitted beyond viewing/cloning to test.
- `main` is branch-protected (PR + 1 review required, no force-push, no deletion) so public visibility doesn't translate into anyone else being able to push changes.

## Further reading

- [`CLAUDE.md`](CLAUDE.md) — full architecture notes, non-negotiable boundaries, measurement-rule rationale.
- [`REPOSITORY_POLICY.md`](REPOSITORY_POLICY.md) — Git/LFS/binary policy for this repo.
- [`MEASUREMENT_PLAN.md`](MEASUREMENT_PLAN.md) — the measurement registry's design and tolerances.
- [`AUTHORING_UX_PLAN.md`](AUTHORING_UX_PLAN.md) — orbit-while-drafting, the grazing guard and the shared keyboard map (Phase A) and the snapping pen with undo, nudge, loupe and mirror (Phase B), both built; landmark placement that records how well a point was placed and template drafts from landmarks (Phases C–D, planned).
- [`contracts/avatar-asset-contract.md`](contracts/avatar-asset-contract.md) — the current asset's identity, coordinate convention, and consumer obligations.
