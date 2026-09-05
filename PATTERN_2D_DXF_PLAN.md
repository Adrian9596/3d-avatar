# 2D Pattern Draft & DXF Export — Research Plan

Status: **Phase 1 implemented (engine + gates, no UI); Phases 2–4 proposal for review**. No
shape produced here is an approved pattern, and nothing is wired into either viewer lane
yet. §4–§7 record what a numerical spike found on a real patch of `avatar_master.glb`;
§8–§10 describe what was then built from it — `scripts/flatten_core.mjs`, its independent
port `scripts/flatten.py`, and the two gates whose evidence sits in
`qa/avatar_master/flatten-accuracy.json` and `flatten-parity.json`, both pinned to the
asset SHA below and to the SHA of the shared case list `scripts/flatten_cases.json`.

Phase 1 update (2026-09-05): the spike's LSCM → ARAP → seam-exact pipeline was **not** what
shipped. The seam-exact relaxation alone, started from a hinge unfolding, reaches the same
minimum on every case to 0.01 mm (§8.2) — and the two stages it drops are the only ones that
need a sparse linear solver, which the repo's stdlib-only Python side cannot have.

Written 2026-09-05 against `assets/export/avatar_master.glb`
(SHA-256 `0caa604bab3510e6c40ed699185832b55d68b87668336a53d385a5345ddd71a4`).

---

## 1. Goal

Extend the pen tool from *drafting a line on the body* to *drafting a pattern piece off the
body*: enclose a patch of skin with a closed pen line (or a set of them sharing edges),
flatten that patch to 2D, and export it as DXF a factory CAD system (Gerber, Lectra,
Optitex, …) can open.

The end state, by analogy with `MEASUREMENT_PLAN.md`: draft a closed loop on the avatar,
mark which side is the interior, click *Flatten*, see the 2D piece next to the 3D view with
its distortion disclosed, click *Export DXF*, and find a matching SHA-pinned JSON evidence
file in `qa/avatar_master/` recording exactly what was flattened and how much it cost in
millimetres.

## 2. Non-goals

- **No claim that a flattened patch is a wearable pattern.** A pattern is drawn *smaller*
  than the body by a fabric's negative ease; this pipeline reports the body's own surface
  at 1:1. Turning a shell into a pattern is a grading/ease decision for a pattern maker, not
  a geometry computation — see §11.
- **No automatic seam placement.** Where a cup is cut (one piece, vertical seam, horizontal
  seam) is a construction decision. The tool flattens whatever loop the user drew; it does
  not propose where to cut.
- **No claim of AAMA/ASTM D6673 layer conformance** until validated against a specific
  factory's CAD import. The spike's DXF uses a placeholder layer scheme (§7).
- **No general-purpose UV unwrapping tool.** This is scoped to torso patches reachable from
  a hand-drafted pen loop, not an automatic seam-finder for an arbitrary mesh.
- **No soft-tissue or fabric simulation**, same limit the measurement engine already states:
  the mesh is rigid, and this pipeline flattens the rigid mesh, not a draped garment.

## 3. What already exists (the part that does not need to be built)

From `digital_bra_fit_model_360.html`'s pen tool, already implemented and in production use:

- A shortest-surface-path engine (`scripts/surface_path.mjs`), which is exactly the object a
  pattern seam should be: geodesic, camera-independent, and — critically — its sub-paths are
  themselves shortest paths, so a length does not jump when a segment gains control points.
- Closed draft loops (`line.closed`), hand-correctable control points, and a length that is
  continuous under editing (0.117 mm worst case per the existing `validate:surface-path`
  gate).
- An evidence export (`penExport`) that already writes anchors, control points, and length
  pinned to the asset SHA — the same shape of file this proposal's flatten step would add
  to.

**What was missing was everything between "a closed loop" and "a flat piece":** turning a
loop into a filled patch of triangles, and flattening that patch. At the time of the spike
nothing in the repo did either; Phase 1 (§8, §10) now does both, with no UI in front of it.

## 4. The geometric question: how much curvature must a cup patch shed

Before writing any flattening code, the spike asked the question that decides whether this
is worth building: **is the torso surface anywhere close to flat, or does drafting a cup
patch always cost real distortion?**

Method: weld `Mara:body3` into an indexed mesh (5,825 vertices, 11,288 faces, confirmed
**0 non-manifold edges** — the precondition every unwrapping algorithm needs), compute
geodesic distance from the `BUST_APEX_L` landmark (`qa/avatar_master/measurements.json`) by
Dijkstra over mesh edges, and sum the discrete Gaussian curvature (angle deficit,
`2π − Σ(triangle angles)`) at every vertex strictly inside each geodesic disc. This total is
the angle that **must** be removed — as a dart, a seam, or fabric stretch — for that patch to
lie flat. It is a property of the body's shape, not of any particular flattening algorithm
(Gauss's *Theorema Egregium*: no isometric flattening of curved surface exists).

| Geodesic radius from apex | Patch area | Total curvature to remove |
|---|---|---|
| 40 mm | 35.4 cm² | 39.7° |
| 60 mm | 85.0 cm² | 83.7° |
| **80 mm (roughly one cup)** | **152.8 cm²** | **130.1°** |
| 100 mm | 231.0 cm² | 113.4° |
| 120 mm | 324.4 cm² | 61.1° (drops because the disc now reaches the concave underarm) |

**Conclusion: a one-piece flat cup is not a tooling limitation, it is a geometric
impossibility.** 130° has to go somewhere. This is the same reason every cup in the existing
BOM/construction skills is either cut-and-sew (the angle becomes a seam) or molded (the
angle becomes fabric stretch under heat). The tool's job is to make that unavoidable cost
visible in millimetres per piece, not to make it disappear.

## 5. Flattening method: three candidates, tested on the actual mesh

All three were run on the real 80 mm patch around `BUST_APEX_L`, not a synthetic surface.

**5.1 LSCM (Least-Squares Conformal Maps).** Preserves angles, lets area and length drift.
Standard first pass in UV-unwrapping tools.

**5.2 ARAP (As-Rigid-As-Possible) refinement.** Local/global iteration: fit the best rigid
rotation per triangle to its 3D shape, then one global cotangent-Laplacian solve to
reconcile the pieces. Minimises *local* stretch, which is closer to what fabric resists than
angle preservation is.

**5.3 Seam-exact relaxation.** The pattern-maker's actual objective, which neither of the
above targets: two pieces that share a seam must have **equal seam length**, or they cannot
be sewn together. This pass hard-constrains boundary edge lengths to their measured 3D
length and lets only the interior absorb the curvature — initialized from the ARAP result,
refined by distance-constraint (PBD-style) projection.

| Piece | Method | Seam length error | Worst single edge | Interior distortion (RMS / max) |
|---|---|---|---|---|
| Cup, one piece (r=80mm) | LSCM | +52.2 mm / 423 mm | — | 9.2% rms, 16.1% max |
| Cup, one piece (r=80mm) | ARAP | +43.6 mm / 423 mm | — | 5.7% rms, 30.2% max |
| Cup, one piece (r=80mm) | **seam-exact** | **+22.1 mm** | 0.79 mm | 0.36 mm rms (5.1%), 27.0% max |
| Cup upper panel | seam-exact | **+2.2 mm** / 418mm | 0.10 mm | 0.075 mm rms (1.5%), 5.0% max |
| Cup lower panel | seam-exact | **+2.3 mm** / 414mm | 0.14 mm | 0.119 mm rms (2.0%), 9.3% max |

Two things fall out of the same table:

- **Seam-exact relaxation beats LSCM/ARAP at the one metric that matters for sewing** (seam
  length), by roughly 2×, because it is the only one of the three that optimizes for it
  directly rather than as a side effect of a different objective.
- **Cutting the one-piece patch into two panels along the apex reduces the remaining error
  by roughly 10×** (22.1 mm → 2.2–2.3 mm) — a direct, measured illustration of §4's finding:
  a seam is how the curvature that cannot be flattened gets paid for.

No triangle flip (fold-over) occurred in any of the six runs above.

## 6. The pattern-critical check: do two independently-flattened panels still fit together

Cutting one patch into two pieces only helps a factory if the two pieces, flattened
**independently** (as separate CAD files, the way a pattern maker would actually work), still
agree on the length of the seam that joins them. This was measured directly rather than
assumed:

```
shared boundary edges between the two panels      : 30
seam length measured on the 3D body                : 204.48 mm
  its length in the UPPER panel's own flattening    : 205.04 mm  (+0.56 mm)
  its length in the LOWER panel's own flattening    : 205.50 mm  (+1.02 mm)
  mismatch between the two pieces, as drawn         :   0.46 mm  (0.22%)
```

For reference, a bra seam is conventionally held to about 1/8 in (3.18 mm). 0.46 mm sits
well inside that, **without the two panels being told about each other** — each was solved
against its own 3D geometry only. Constraining them to a literally identical shared boundary
(rather than two independently-measured approximations of it) would remove even that 0.46 mm
by construction, and is the more correct design for a production tool (§9).

## 7. DXF export: verified round-trip, not yet a factory-conformant layer scheme

A minimal ASCII DXF R12 (`POLYLINE`/`VERTEX`/`SEQEND` entities, one polyline per pattern
piece) was written for the two flattened panels above and read back with an independent
parser in the same spike:

```
CUP_UPPER: 56 boundary points, 2D perimeter 420.27 mm
CUP_LOWER: 51 boundary points, 2D perimeter 415.85 mm
wrote cup_panels.dxf (4760 bytes)
  CUP_UPPER: layer "1", 56 verts read back, coordinates match exactly, perimeter 420.27 mm
  CUP_LOWER: layer "1", 51 verts read back, coordinates match exactly, perimeter 415.85 mm
```

DXF itself is the easy part of this project — R12 is old, simple, and every apparel CAD
package reads it. Two things are **not** yet solved and must not be implied as done:

- **Layer/entity convention.** The spike used a placeholder layer name (`"1"`) for every
  piece. Apparel CAD interchange (AAMA DXF / ASTM D6673) has specific conventions for piece
  boundary vs. internal lines vs. notches vs. grainline, on specific layer numbers. This must
  be confirmed against the target factory's actual CAD system before any output is called
  conformant — guessing a layer scheme and calling it "AAMA DXF" would be exactly the kind of
  invented capability CLAUDE.md prohibits.
- **Units.** DXF carries no inherent unit; the writer and the importing CAD must agree
  out-of-band (the spike used millimetres, matching apparel CAD convention, and states so in
  a DXF comment).

## 8. Proposed architecture — following the existing measurement pattern

This repo already has a working answer to "how do we add a new kind of geometry computation
without the two viewer lanes silently diverging": one shared engine, one independent port,
one parity gate. The same shape applies here.

```
scripts/flatten_core.mjs      — (built) shared JS engine: weld, patch extraction from a
                                 closed loop, hinge-unfolding start, seam-exact relaxation,
                                 stats, loop mapping. To be imported by the prototype pen
                                 tool in Phase 4 the way scripts/measure_core.mjs is today.
scripts/flatten.py             — (built) independent Python re-implementation, stdlib only,
                                 gated against the JS engine by validate:flatten-parity —
                                 the relationship measure_avatar.py has to measure_core.mjs.
scripts/flatten_cases.json     — (built) the one list of patches both engines are tested on;
                                 its SHA is recorded in both evidence files.
scripts/flatten_fixtures.mjs   — (built) test scaffolding: analytic cylinder/cone soups and
                                 avatar patches around a landmark of the authority pass.
scripts/dxf_writer.mjs         — (Phase 3) DXF R12 serializer, asset-agnostic, taking only
                                 {pieces:[{layer, points_mm, closed}]}.
```

`validate:lane-parity` already lists the engine's functions (`hingeUnfold`, `relaxSeamExact`,
`extractPatch`) among those neither viewer lane may redefine.

Do not reimplement the geodesic/curvature/flattening maths a second time inside either
viewer lane — the existing `validate:lane-parity` gate's method (grep both lanes for
redefinitions of shared engine functions) extends directly to these new function names.

### 8.1 Patch extraction from a pen loop

A closed pen loop today is a sequence of anchors with surface runs between them — a curve on
the mesh, not a region. Filling it in:

1. Snap the loop's drawn polyline onto the underlying triangle mesh (already available via
   `closestOnMesh` in `surface_path.mjs`).
2. Flood-fill triangles from a user-designated interior seed, stopping at the snapped loop —
   standard breadth-first region growing on the face-adjacency graph, bounded and cheap on a
   mesh this size (11,288 faces).
3. Reject (with a stated reason, not a silent guess) a loop that does not close on the mesh,
   or that bounds more than one connected region.

### 8.2 Flatten

**As built:** hinge unfolding, then seam-exact relaxation — not the three-stage pipeline of
§5. The face nearest the patch centroid is laid flat and every other face is hinged out
rigidly across a shared edge, breadth-first, each vertex taking the mean of its copies. On a
developable surface the copies coincide, so the start already *is* the exact unrolling (the
cylinder and cone gates pass at 0.0000 µm in one iteration); on a dome the copies disagree
only by the curvature between neighbouring paths, so nothing starts folded over — a plane
projection of a 150° cone did fold one triangle, which is why this start replaced it.

The relaxation is a Jacobi distance solve: every edge is a constraint to its 3D length,
boundary edges at weight 1.0, interior at 0.25, corrections accumulated over a sweep and
applied together so the result does not depend on edge order and the Python port can match
it bit for bit. Stopping rule: no vertex moved more than 5 nm in a sweep, cap 10 000.

Why LSCM/ARAP were dropped: on the six avatar patches the relaxation alone lands within
0.01 mm of the spike's LSCM→ARAP→seam-exact result (22.113 vs 22.1 mm one-piece seam error,
2.207 / 2.339 vs 2.2 / 2.3 mm for the panels), because the seam-exact step dominates the
minimum regardless of how it is started. The two dropped stages are the only ones needing a
sparse linear solver, which `DEPENDENCY_INVENTORY.md`'s stdlib-only rule for project-side
Python rules out. One start, one objective; the parity gate is what keeps it that way. Multiple patches sharing an edge (e.g. two cup panels split
by an internal pen line) should be solved with that shared edge held to one common measured
length, not to two independently-approximated ones — removing even the 0.46 mm of §6 by
construction rather than by coincidence.

### 8.3 Export

Feed the flattened 2D pieces (plus whatever seam-allowance/notch data the user supplies —
out of scope for the geometry engine, §2) to `dxf_writer.mjs`.

## 9. Evidence and traceability

Following `MEASUREMENT_PLAN.md` §8's shape, every flatten run writes
`qa/avatar_master/pattern-flatten.json`, pinned to the asset SHA:

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-09-05T02:00:00Z",
  "asset": { "file": "assets/export/avatar_master.glb",
             "sha256": "0caa604b…", "unit": "meter" },
  "declared_limits": [
    "Flattened shell of the rigid mesh at 1:1. Not a pattern: no negative ease applied.",
    "No AAMA/ASTM D6673 layer conformance verified for the exported DXF.",
    "Seam allowance and notches, if present, were supplied by the user, not computed."
  ],
  "pieces": [
    {
      "name": "CUP_UPPER",
      "loop_source": "draft-lines.json#Line 2",
      "method": "lscm+arap+seam_exact",
      "vertex_count": 233,
      "boundary_point_count": 56,
      "boundary_length_3d_mm": 418.1,
      "boundary_length_flat_mm": 420.3,
      "boundary_error_mm": 2.2,
      "interior_distortion_rms_pct": 1.5,
      "interior_distortion_max_pct": 5.0,
      "triangle_flips": 0,
      "shared_seams": [
        { "with": "CUP_LOWER", "edge_count": 30,
          "length_3d_mm": 204.48, "length_here_mm": 205.04, "mismatch_mm": 0.0 }
      ]
    }
  ]
}
```

Non-negotiables carried over from the measurement plan's own rules:

- The asset SHA invalidates the record on a re-export, exactly as `measurements.json` does.
- `declared_limits` travels with the file — same rule CLAUDE.md states for measurements: a
  wrong-but-plausible number is worse than a stated inability.
- A shared-seam mismatch is recorded per pair of pieces, not silently accepted — this is the
  number a reviewer needs to trust that two DXF pieces will actually sew together.

## 10. Validation plan

Four gates, mirroring `validate:measurements`'s structure. The first two exist and run in
the chain; the last two are Phase 2–3.

- **`validate:flatten-accuracy`** (built) — a 120° cylinder patch must unroll to its analytic
  rectangle (209.3731 × 200 mm, chord sum × height) and a 150° cone frustum's two straight
  sides must meet at the analytic fan angle (55.693362°), every edge kept to its 3D length
  within 1 µm; observed 0.0000 µm on both. On the avatar it gates soundness — 0 fold-overs,
  Euler characteristic 1 with one boundary loop, convergence — and one finding: the seam
  error of each cup panel must be below the one-piece cup's (2.21 / 2.34 mm vs 22.11 mm).
  The seam errors themselves are recorded, not budgeted: they are the body's curvature, and
  a threshold is how they would stop being looked at. For the loop-extracted patch it also
  gates that the flood fill did not leak (reach 50.8 mm from the seed against a 134.6 mm
  limit) and that all 168 loop samples map through. Negative-tested: cutting the solver to
  one iteration fails six checks. This is the flattening analogue of
  `validate:surface-path`'s cylinder-geodesic check.
- **`validate:flatten-parity`** (built) — runs `scripts/flatten.py` on `flatten_cases.json`
  and compares layouts vertex by vertex with `flatten_core.mjs`, tolerance 1 µm. Observed:
  0 on every case, identical iteration counts (2080 / 2735 / 4371 / 4266 / 7694 / 3714).
  Negative-tested: an interior weight of 0.30 on one side moves vertices by 0.29 mm, 290×
  the tolerance. Both evidence files refuse landmarks measured on a different asset SHA
  (`BLOCKED`, naming both hashes) rather than flattening around a stale apex.
- **`validate:seam-closure`** — for every pair of pieces declared adjacent, the shared-seam
  mismatch (§6, §9) is below a stated tolerance (proposed: the 3.18 mm / 1/8 in factory
  reference from §6, pending TD confirmation). This is the gate that actually decides whether
  an exported DXF is usable, and should fail the build the way a stale-evidence check does
  elsewhere in this repo.
- **`validate:dxf-roundtrip`** — write, then read back with an independent parser, and assert
  coordinates match exactly (§7's spike check, promoted to a gate).

## 11. What this explicitly is not: ease and grading

A flattened shell is the body's own surface. A pattern is smaller than the body by the
fabric's negative ease, and a size run is that pattern graded across sizes. Both of those are
decisions a pattern maker makes, informed by fabric behavior this pipeline has no way to
measure. Per §2 and CLAUDE.md's "do not invent capabilities" rule, this pipeline's output
must be labelled a **flattened shell**, never a **pattern**, until an ease/grading step —
almost certainly a separate, human-driven stage rather than a geometry computation — sits on
top of it. `anthropic-skills:bra-grading` already exists for size-run grading once a sample
spec exists; this pipeline would feed that at most a sample-size reference shell, not a
finished spec.

## 12. Open decisions

1. **Target CAD system** (Gerber / Lectra / Optitex / other) — decides the DXF layer/entity
   convention in §7 and §8.3. Left unguessed in the spike on purpose.
2. **Where ease is applied** — inside the flatten engine (as a per-piece shrink parameter,
   which risks quietly becoming an invented "this is the right ease" claim) vs. as an
   explicit, disclosed post-processing step on the exported flat shell (recommended: keeps
   the geometry engine honest about measuring the body, and puts the ease decision — and its
   evidence trail — where a human made it).
3. **Scope of the first shipped piece** — net seam line only (matches what the pen tool
   already produces) vs. seam allowance + notches + grainline from the first release. The
   spike only validates the net-line case; allowance/notch generation is unstarted design
   work, not benchmarked here.

## 13. Phases (proposed)

- **Phase 1 — patch extraction + flatten, no UI. Done 2026-09-05.** `flatten_core.mjs` +
  `flatten.py`, `validate:flatten-accuracy` and `validate:flatten-parity` passing and wired
  into `npm run validate:measurements`. Declared limits carried in the evidence: the
  loop-extracted patch overshoots the drawn loop by up to one triangle and the loop itself is
  mapped through the flattening but not yet held to length (289.4 mm on the body, 306.7 mm
  flat on the 60 mm test loop) — Phase 2's shared-edge constraint is the place to fix that,
  by making the loop a real seam rather than a curve inside the piece.
- **Phase 2 — seam-closure gate + multi-panel solve.** Shared-edge-constrained flattening
  for adjacent panels (§8.2), `validate:seam-closure` passing on the cup upper/lower case
  measured in §6.
- **Phase 3 — DXF export + round-trip gate**, with layer scheme confirmed against a named
  target CAD system (§12.1).
- **Phase 4 — pen-tool UI**: draft a closed loop, designate interior, flatten, preview
  distortion inline (in the manner §7 of `MEASUREMENT_PLAN.md` already does for measurement
  annotations), export.

Ease/grading (§11) is explicitly out of these four phases and should be scoped separately
once a target garment and fabric are named.
