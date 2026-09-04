# Requirements — 3D Avatar Platform Foundation

**Status:** REQUIREMENTS READY  
**Created:** 2026-08-14  
**Scope:** reusable local-to-web platform for governed human-avatar authoring, motion, GLB validation, prototype review and later static deployment.

## 1. Outcome and boundaries

The platform must make every avatar version reproducible from approved inputs through Blender authoring, rig/motion QA, GLB export, independent validation and a browser viewer. It must preserve asset provenance, status and evidence across every stage.

Platform readiness does not establish anatomical, measurement, factory or simulation approval for an individual avatar. A draft asset may exercise platform capabilities only when the UI and evidence retain `DRAFT — NOT TD VALIDATED`.

Unity, Unreal, garment simulation services, user accounts and a database are outside the foundation scope. They require separate decisions only when the product needs VR/gameplay, pattern-accurate fabric physics, saved configurations or multi-user data.

## 2. Authority and lifecycle

- The authority hierarchy remains: TD-approved measurements → asset/DoD contracts → current versioned assets and matching evidence → implementation documents → prototype references.
- Every asset must have an ID, semantic version, status, source revision and SHA-256.
- Required lifecycle states are `DRAFT`, `BLOCKED`, `REVISE`, `APPROVED FOR AUTHORING` and `RELEASED`; transition authority must be named.
- Prototype, candidate, approved-master and production-release artifacts must use separate paths or version identities.
- A hash change invalidates geometry-dependent measurement, motion, collision and visual evidence until regeneration.

## 3. Repository and dependency foundation

- The 3D avatar project boundary must be explicit inside the parent `Web Tools` repository so staging or CI cannot accidentally include sibling projects.
- Source code, contracts, manifests and reports use Git; large `.blend`, `.glb`, texture and animation binaries use Git LFS or an approved equivalent.
- `.gitattributes`, ignore rules and binary-retention policy must be documented before the first platform commit.
- Node and Python dependencies must be pinned and reproducible from lock/requirements files.
- Blender, MPFB and graphical asset versions/licenses must be recorded in the asset manifest.
- A clean-clone/bootstrap procedure must recreate the validation environment without relying on undocumented global state.

## 4. Authoring platform

- Blender is the canonical editable source for body, topology, materials, garments, armature, weights, shape keys and animation clips.
- MPFB is a candidate generator, not measurement authority or production approval.
- Authoring scripts must be rerunnable and must fail closed when the expected asset ID, object role or source file is missing.
- Helper geometry, draft generator morphs and other authoring-only data must not silently enter production exports.
- Body, bikini top and bikini brief remain separate semantic objects.
- Master-body fitting and final rig weighting cannot be approved before the TD measurement gate and master-body freeze.

## 5. Rig and motion contract

The minimum rig must provide pelvis, spine, chest, neck, head, clavicle/shoulder, upper arm, elbow and wrist plus the required leg chain on both sides. Bone names and axes must be stable, ASCII and side-qualified.

Required motion states are:

- neutral A-pose with arm separation recorded at 30–45°;
- arms down;
- arms 45°;
- arms 90° lateral;
- arms 120°;
- arms overhead 150–160°;
- arms forward 90°;
- continuous down → overhead → down sweep.

Motion QA must cover shoulder/axilla volume, breast-root/IMF stability, landmark following, left/right symmetry, self-intersection, bikini coverage/collision and return-to-neutral behavior. Final acceptance includes required semantic morph combinations at min/default/max once the six contract morphs exist.

## 6. Asset/export platform

- Runtime delivery format is self-contained GLB/glTF 2.0 using the coordinate, naming and budget rules in `contracts/avatar-asset-contract.md`.
- The exporter must explicitly select export objects and declare policies for helpers, morphs, skins and animations.
- The canonical exporter and any prototype-sanitizing exporter must remain separate and identify their purpose in GLB extras and reports.
- Every export produces a machine-readable inventory and SHA-256.
- Khronos validation, clean-scene round-trip and independent web rendering are distinct mandatory gates.
- Missing required rig, animation, landmark or morph data must be reported as `BLOCKED`, never silently replaced.

## 7. Web viewer platform

- Three.js, GLTFLoader and OrbitControls remain pinned local dependencies; runtime must not depend on a CDN.
- The viewer must use semantic object roles and morph names rather than array indices.
- Required states are loading, ready, blocked-feature and recoverable error/static fallback.
- Required foundation controls are orbit/zoom/reset, camera presets, semantic object visibility, wireframe, draft status and asset diagnostics.
- The motion layer must enumerate GLB animation clips, reject missing required clips and expose pose/playback controls without fabricating motion.
- Shape controls remain unavailable until the six required semantic morphs exist and documented mappings are present.
- Mobile/desktop accessibility, responsive framing and performance budgets are required.
- Migration to Vite is required before the viewer becomes multi-module production code; the single-file prototype may remain as a controlled fixture.

## 8. QA and automation

- One aggregate local command must run platform static checks, asset/hash checks, canonical/prototype glTF validation and non-GUI contract tests.
- Browser validation must cover desktop/mobile framing, loading/error states, camera, visibility, wireframe, motion controls and console/network errors.
- Blender motion QA must generate named pose renders plus machine-readable bone, landmark, collision and deformation reports.
- CI must be scoped to this project, use pinned runtimes and fail on errors, stale hashes, missing evidence or accidental draft-to-release promotion.
- Screenshot comparison may use reviewed baselines, but a visual diff cannot substitute for TD/3D decisions.
- Validation reports must identify exact inputs, tool versions, timestamps and decisions.

## 9. Deployment and operations

- Preview and production environments must be separate; production deployment remains blocked until the asset release gate passes.
- The selected static host must document build command, output directory, base path, cache rules, MIME handling for `.glb` and rollback procedure.
- Immutable/hash-addressed assets are preferred so viewer code cannot unknowingly load a different binary at the same URL.
- Deployment must publish the tested build artifact, not rebuild from unpinned state.
- A runbook must cover local bootstrap, validation, preview deploy, production approval, rollback and asset/evidence recovery.
- Hosting and analytics must not collect body measurements or personal scan data without an explicit privacy/security design and authorization.

## 10. Exit gate

The foundation passes only when local bootstrap, source control/LFS, Blender authoring/export, rig-motion QA, GLB validation, modular viewer build, project-scoped CI, preview deployment, rollback and documentation all pass with current evidence.

Allowed successful decision: `PLATFORM FOUNDATION READY — ASSET APPROVAL REMAINS SEPARATE`.
