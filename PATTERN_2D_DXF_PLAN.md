# 2D Pattern Draft & DXF Export — Research Plan

Status: **Phases 1–4 implemented** — engine, loop-as-seam, joint multi-panel solve, ASTM/Gerber DXF export, four gates, and the pen-tool UI in the authoring lane. Ease/grading (§11) remains deliberately out of scope. No
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

Phase 4 update (2026-09-05): the pen tool drafts pieces. In `digital_bra_fit_model_360.html`
a "2D pattern draft" block appears once a closed loop exists: pick the outline, optionally an
open line whose ends sit on it as the seam, Flatten, read the pieces' seam errors and the
shared-seam mismatch next to a preview, Export DXF. It imports the very engine and writer
the gates run (`validate:lane-parity` checks that, and that the production lane carries
neither). Verified in the browser with a 12-anchor pen loop and a 3-anchor seam through the
apex: two panels, 0 fold-overs, 2 349 sweeps in ~1 s, shared-seam mismatch 0.45 mm; the
exported DXF passes all 24 structural checks of `validate:dxf-roundtrip` in check-only mode.

Phase 3 update (2026-09-05): target CAD decided — **Gerber AccuMark**. The export is ASTM
D6673-10 in the dialect Gerber's parser accepts, with the layer numbers and system-text
syntax looked up (`contracts/dxf-astm-d6673.md` cites the sources) rather than remembered, and
gated by an independent read-back (§7, §10). What no gate here can do is open the file in
AccuMark; the evidence says `import_verified: false` until someone does.

Phase 2 update (2026-09-05): a drawn loop is now the piece's **seam**, held to length through
barycentric chord constraints on the faces it crosses (no remeshing), and pieces that share a
run of pen line are solved **together** so the shared seam agrees in both — §8.2, §10. Getting
the joint solve to converge exposed two real solver defects (rigid drift; fold-over invisible
to distance constraints) and fixed them; the disc numbers of Phase 1 are unchanged to 0.001 mm.

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
against its own 3D geometry only. Phase 2 (§8.2) pulls the shared chords to a common length in
both pieces; on the loop-cut panels that halves the mismatch (1.01 → 0.55 mm) and
`validate:seam-closure` gates it. The spike's hope of removing it "by construction" was
too strong: a shared *length* can be coupled, but two separately flattened pieces cannot be
welded, so agreement is to solver tolerance and is measured, not assumed.

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
package reads it. The spike left two things open; Phase 3 closed both once the target CAD
was named (Gerber AccuMark):

- **Layer/entity convention — now sourced.** ASTM D6673-10 numbers its layers; the writer
  uses 1 (system text, net boundary), 2/3 (turn/curve points), 7 (grain), 15 (annotation) and
  84 (the mandatory validation copy of the boundary), one BLOCK per piece, Style and Piece
  System Text in the standard's exact case-sensitive syntax. Gerber's parser additionally
  demands an empty HEADER, no TABLES section and no `$MODEL_SPACE`/`$PAPER_SPACE` blocks
  (documented by ezdxf's `gerber_D6673` add-on, which exists to strip exactly these).
  `contracts/dxf-astm-d6673.md` records the whole scheme with its sources.
- **Units — declared in-band.** `Units: METRIC` in the Style System Text, coordinates in mm
  to two decimals as the standard defines; the rounding loss is measured (≤ 5 µm per vertex,
  ≤ 0.004 mm on a 298 mm perimeter) and recorded, not assumed.

Still true, and stated in the evidence: nobody has yet opened the file in AccuMark.

## 8. Proposed architecture — following the existing measurement pattern

This repo already has a working answer to "how do we add a new kind of geometry computation
without the two viewer lanes silently diverging": one shared engine, one independent port,
one parity gate. The same shape applies here.

```
scripts/flatten_core.mjs       — barrel: the one import the lanes and gates use
  flatten_mesh.mjs             — weld, edges, face adjacency, edge geodesics, sub-meshes,
                                 boundary loops/components
  flatten_patch.mjs            — loop → samples (canonical resampling), flood fill,
                                 chord constraints, loopCentroidSeed, splitLoopBySeam
  flatten_solver.mjs           — DEFAULT_SOLVER, hingeUnfold, relaxPieces (per-sweep
                                 helpers: constraints, Jacobi move, drift removal,
                                 Chebyshev step), flattenPatch, flattenPieces
  flatten_report.mjs           — patchStats, chordReport, mapLoopToFlat
scripts/flatten_{mesh,patch,solver,report}.py
                               — the Python port, file for file, stdlib only
scripts/flatten_fixtures.{mjs,py} — the test patches, built identically on both sides
scripts/flatten.py             — Python CLI the parity gate runs
scripts/flatten_cases.json     — the one list of patches both engines are tested on
scripts/pattern_draft.mjs      — pen lines → pieces → reports → DXF + evidence (no DOM);
                                 what the authoring lane's pattern block calls
scripts/dxf_pieces.mjs         — flattened piece → DXF record (outline, turn points,
                                 default grain, annotation)
scripts/dxf_writer.mjs         — ASTM D6673-10 / Gerber-dialect serializer
scripts/gate_report.mjs        — shared plumbing of the flatten-family gates
```

Every module carries a header saying what it owns; a change to one side of the
JS/Python pair belongs in the twin file, and the parity gate is what catches a miss.

`validate:lane-parity` lists the engine's functions (`hingeUnfold`, `relaxPieces`,
`flattenPieces`, `extractPatch`, `loopChords`) among those neither viewer lane may redefine,
and checks that the authoring lane reaches the engine only through `pattern_draft.mjs` while
the production lane reaches none of it.

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
Python rules out. One start, one objective; the parity gate is what keeps it that way.

**Phase 2 additions, as built.**

- *The loop is the seam.* `extractPatch` resamples the drawn loop at 2 mm and snaps each sample
  to the mesh, recording the face and barycentric coordinates. `loopChords` turns consecutive
  samples into distance constraints between two barycentric points, spread over the vertices
  of their faces by the barycentric weights — so the pen line is held to its measured length
  without cutting the mesh. The ring of faces the loop crosses stays in the piece as
  scaffolding at interior weight; the outline is the loop's image (`mapLoopToFlat`), never
  the mesh boundary. Segments are resampled in a canonical direction, so two loops that share
  a run of pen line produce bit-identical samples and the shared chords are recognised by
  key, without a tolerance.
- *Shared seams are solved together.* `flattenPieces` relaxes several pieces in one sweep; a
  chord present in more than one piece gets, besides its pull to the 3D length, a pull with
  `couple_weight` (4.0) towards the mean of its current lengths across pieces. One constraint
  towards rest at 1.0 and one towards the mean at 4.0 add up to a single constraint towards
  their blend at weight 5.0 — so the seam's stiffness against the *body* is unchanged and only
  the two pieces' disagreement is stiffened. Measured: mismatch 1.014 mm apart → 0.550 mm
  together on the 116 mm shared seam.
- *Rigid drift removed.* No constraint can see a translation or rotation of a piece, and
  per-vertex weighting does not conserve momentum; with chord constraints the residual drift
  was ~60 nm per sweep forever, so the shape had settled but the convergence test never
  fired. The mean translation and mean rotation of each sweep are now subtracted.
- *Fold-over caught by area, one-sided.* A mirrored triangle has exactly the edge lengths of
  the right one, so distance constraints are blind to a flip, and one scaffold face at a loop
  corner did flip. A reflection-based push fixed it but was impulsive and made the
  acceleration diverge; a two-sided signed-area constraint was stable but moved the cup's
  seam error from 22.11 to 23.43 mm because area and length cannot both be preserved on a
  curved patch. The one-sided form — active only when a face's flat area falls below 25 % of
  its 3D area — is inactive on every sound face, so the Phase 1 numbers are unchanged to
  0.001 mm, and no fold-over survives on any case.
- *Chebyshev acceleration.* Wang (2015)'s semi-iterative scheme over the Jacobi sweep, ρ =
  0.999, γ = 0.75, 10-sweep delay: the same fixed point, 10–20× fewer sweeps (7 694 → 541 on
  the lower cup panel; the whole Python case list now runs in 7 s). A fixed fallback ladder
  (0.99, 0.9, 0) restarts every piece from its unfolding if a sweep blows up; forcing ρ =
  0.999999 exercises it, and both ports take the same restart at the same sweep. Multiple patches sharing an edge (e.g. two cup panels split
by an internal pen line) should be solved with that shared edge held to one common measured
length, not to two independently-approximated ones — removing even the 0.46 mm of §6 by
construction rather than by coincidence.

### 8.3 Export (built)

`scripts/dxf_pieces.mjs` turns a flattened piece into a record — outline (the loop's image
for a loop-cut piece, the ordered boundary for a face-set piece, counter-clockwise, in mm),
turn points where the outline turns more than 30°, a default grain line (the flat image of
the body's vertical through the face nearest the piece centre) and annotation stating what
the piece is not — and `scripts/dxf_writer.mjs` serialises it. The writer refuses (throws)
rather than truncating: names over Gerber's 20 characters, non-ASCII text, an outline that
repeats its first point, a piece without a grain line. Seam allowance and notches remain out
of scope (§2); when a boundary *with* allowance is drawn, the net line moves to layer 14.

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

Four gates, mirroring `validate:measurements`'s structure. All four exist and run in the
chain.

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
- **`validate:seam-closure`** (built) — the one-cup loop cut through the apex into two panels
  and flattened together; the shared seam (65 chords, 116.47 mm on the body) measures
  119.46 mm in one flat piece and 118.91 mm in the other, a mismatch of 0.55 mm against the
  3.175 mm (1/8 in) tolerance — stated in one place as a factory reference pending TD
  confirmation. The gate also records the independent solve (1.01 mm) and requires the joint
  solve to beat it. Negative-tested: with coupling disabled that check fails. Each panel's own
  seam error against the body (7.17 / 4.90 mm) is recorded, not budgeted — it is curvature.
- **`validate:dxf-roundtrip`** (built) — writes the two cup panels to
  `qa/avatar_master/flatten-draft.dxf` and reads the file back with a parser written
  independently of the writer. Gated: 7-bit ASCII; empty HEADER, no TABLES, no layout blocks;
  one BLOCK per piece and one INSERT per block; Style System Text with all nine required keys
  and Piece System Text with `Piece Name`/`Quantity`, exact case, names ≤ 20 characters;
  exactly one closed boundary on layer 1 and a byte-identical validation copy on 84; a grain
  line on 7; every boundary vertex marked on 2 or 3 (2 turn + 159/165 curve points); annotation
  on 15; coordinates within the 0.01 mm the metric convention writes (observed 5 µm worst) and
  perimeters within 0.004 mm. Negative-tested four ways (TABLES injected, validation copy
  moved to layer 85, a non-ASCII character, grain line moved off layer 7): each fails.

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

1. ~~**Target CAD system**~~ — **decided: Gerber AccuMark** (2026-09-05). The convention it
   fixed is in `contracts/dxf-astm-d6673.md`. Still open within it: the AccuMark version that
   actually accepts the file, to be recorded in `qa/avatar_master/dxf-roundtrip.json` when
   someone imports it.
2. **Where ease is applied** — inside the flatten engine (as a per-piece shrink parameter,
   which risks quietly becoming an invented "this is the right ease" claim) vs. as an
   explicit, disclosed post-processing step on the exported flat shell (recommended: keeps
   the geometry engine honest about measuring the body, and puts the ease decision — and its
   evidence trail — where a human made it).
3. **Scope of the first shipped piece** — net seam line only (matches what the pen tool
   already produces) vs. seam allowance + notches + grainline from the first release. The
   spike only validates the net-line case; allowance/notch generation is unstarted design
   work, not benchmarked here.
4. ~~**Template drafts vs. "no automatic seam placement" (§2).**~~ — **built 2026-09-05**
   (`AUTHORING_UX_PLAN.md` §8, §15 D): `contracts/pattern-templates.json` declares conventional
   cuts as landmarks, each `status: proposal`; they are drafted as ordinary pen lines and
   flattened by this engine, and reported with their cost per panel. That is a proposal shown, not
   a seam placed — §2 stands. Still open within it: a TD confirming the list of four cuts, which
   is a data edit to the contract.

## 13. Phases (proposed)

- **Phase 1 — patch extraction + flatten, no UI. Done 2026-09-05.** `flatten_core.mjs` +
  `flatten.py`, `validate:flatten-accuracy` and `validate:flatten-parity` passing and wired
  into `npm run validate:measurements`. Declared limits carried in the evidence: the
  loop-extracted patch overshoots the drawn loop by up to one triangle and the loop itself is
  mapped through the flattening but not yet held to length (289.4 mm on the body, 306.7 mm
  flat on the 60 mm test loop) — closed in Phase 2, which made the loop the seam: the same
  loop now flattens to 305.9 mm, a 16.5 mm residual that is the disc's curvature (the 60 mm
  face-set disc carries 10.0 mm on a 333 mm boundary), not a missing constraint.
- **Phase 2 — loop-as-seam, multi-panel solve, seam-closure gate. Done 2026-09-05.** The
  Phase 1 limit (the loop mapped but not held to length) is closed: the loop is the seam. The
  scaffold ring the loop crosses remains in the piece (declared; its outer boundary is
  reported separately) and the residual seam error per piece remains the body's curvature.
  `validate:seam-closure` runs in the chain.
- **Phase 3 — DXF export + round-trip gate. Done 2026-09-05** for Gerber AccuMark (§7,
  §8.3, §10). Remaining manual step: import `qa/avatar_master/flatten-draft.dxf` into AccuMark
  once and record the version in the evidence.
- **Phase 4 — pen-tool UI. Done 2026-09-05.** Outline = closed pen loop; seam = open pen line
  with both ends on the outline (`splitLoopBySeam` projects them on and splits, so the two
  panels share bit-identical samples); the interior seed is the loop centroid snapped to the
  skin, with the flood fill's reach checked so an escaped fill is refused rather than exported.
  The result block shows per-piece seam 3D/flat/Δ, interior rms, fold-overs, the shared-seam
  mismatch, and a preview with the shared run highlighted; Export DXF downloads the ASTM/Gerber
  file plus a SHA-pinned JSON record (`import_verified: false`) for `qa/avatar_master/`.

Ease/grading (§11) is explicitly out of these four phases and should be scoped separately
once a target garment and fabric are named.
