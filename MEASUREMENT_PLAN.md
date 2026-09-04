# Measurement & Annotation Plan — `avatar_master`

Status: **proposal for review**. Nothing here is an approved measurement record.
Written 2026-09-04 against `assets/export/avatar_master.glb`
(SHA-256 `0caa604bab3510e6c40ed699185832b55d68b87668336a53d385a5345ddd71a4`).

---

## 1. Goal

Turn the avatar from *a shape you can look at* into **a measurable body of record**: a
system where every number shown next to the avatar is

1. **defined** — traceable to a written point-of-measure definition, not to whatever the
   code happened to do;
2. **reproducible** — the same mesh always yields the same number, and two independent
   implementations agree to a stated tolerance;
3. **visible** — you can see exactly where the tape sat, so a wrong landmark is caught by
   eye instead of shipping into a tech pack;
4. **exportable** — the numbers leave the tool in the house POM format (cm + inch
   fractions) and can feed a measurement sheet;
5. **honest** — a mesh reading is labelled as a mesh reading, never as an approved spec.

The end state: open the viewer, see the measurement table, click any row to see its tape
drawn on the body, click *Export* to get a POM sheet, and find a matching SHA-pinned JSON
evidence file in `qa/avatar_master/` that a reviewer can audit later.

## 2. Non-goals

These are out of scope and must not be implied by the UI:

- **No size grading or cup-size verdict.** The tool reports body dimensions. Turning those
  into "36C" is a sizing decision that belongs to the measurement standard and TD, not here.
- **No soft-tissue simulation.** The mesh is rigid; a tape pulled snug compresses tissue and
  reads smaller (most of all at the underbust, where band size is taken firmly). We measure
  the surface as modelled.
- **No garment fit calculation.** Draping/pressure analysis is a different pipeline.
- **No claim of anthropometric authority for this avatar.** It is a CLO3D avatar of unknown
  provenance; measuring it precisely does not make it a validated fit model.

## 3. What already exists (Phase 0, done)

Implemented and verified in `digital_bra_fit_model_360.html`:

- Live measurement engine in-browser: horizontal section → convex hull → perimeter.
- Purely geometric landmark detection for four points.
- Measurement panel (English) top-left, collapsible via the ⌁ button or its ×, with the
  open/closed choice remembered per browser. Columns: point, height, cm, inch (nearest ⅛).
- **Tape lines drawn on the body in red, with a show/hide toggle.** All four are shown at
  once; selecting a row in the table draws that one heavier plus a faint see-through copy
  of its hidden half.
- Lines render as `Line2` (screen-space width) rather than `THREE.Line` — WebGL ignores
  `gl.lineWidth`, so plain lines were an unreadable 1px hairline.
- **Pen tool: drafting measured lines on the body**, in the manner of drafting a pattern on
  a form. Click the body to pin an anchor, drag an anchor to correct it, right-click (or
  select + Delete) to remove one, Enter to finish the line, click the first anchor again to
  close a loop. Lines are listed with their length in cm and inch fractions; each line's
  measurement can be shown or hidden as a label on the body (◉/◎), and each line can be
  selected or deleted. Undo removes the last point, then the last line.
- Results mirrored into `window.__avatarPrototype.measurements` / `.draftLines` for
  automated checks.

**How a run between two anchors is found — and why it is camera-independent.** For anchors
A and B, build the plane containing both that "stands up" on the surface: its normal is
`cross(B−A, average surface normal)`. Intersecting the mesh with that plane yields a curve
lying on the skin through both anchors; the section is welded into a graph and walked with
Dijkstra, so the result is the shorter arc between them — the path a tape would take. A
plane that also clips an arm simply has no route through that disconnected loop.

This is the *plane-constrained surface path* of §4.6, and it means **rotating the view never
changes a measurement**. Verified: a 3-anchor line reading 34.1 cm (13 1/2") from the front
reads 34.1 cm at 45°, and `on_surface: true` confirms it followed the mesh rather than
falling back. If the plane genuinely cannot connect two anchors, the run degrades to a
straight chord and is flagged `·straight` on the label and in the row tooltip — never a
silent fallback.

Remaining limit: the plane path still dips through a concavity where a real tape would
bridge it. Sound for drafting runs across the torso; the hull tape (§4.1) remains the right
model for a full girth.

Readings (torso mesh, arms excluded, 5mm scan step, 16ms total):

| Point | Height | Girth (hull) |
|---|---|---|
| Waist | y = 1.195 m | 76.9 cm |
| Underbust (fold) | y = 1.270 m | 83.1 cm |
| Bust apex | y = 1.330 m | 101.3 cm |
| Full bust (max girth) | y = 1.350 m | 102.4 cm |

Bust − underbust = **19.4 cm (7.6 in)**.

**Cross-implementation agreement, already demonstrated.** The same four points computed
independently in Blender/Python and in the browser/JS:

| Point | Python (10mm step) | JS (5mm step) | Δ |
|---|---|---|---|
| Underbust | 830.9 mm | 830.9 mm | **0.0 mm** |
| Bust apex girth | 1013.5 mm | 1013.5 mm | **0.0 mm** |
| Full bust | 1024.5 mm | 1024.5 mm | **0.0 mm** |
| Waist | 768.7 mm @ 1.200 | 768.5 mm @ 1.195 | 0.2 mm (finer step found a better minimum) |

**Algorithmic calibration.** Slicing a cylinder of exactly known girth: true 628.32 mm,
measured 628.21 mm → **−0.11 mm (−0.017 %)**, which is the expected inscribed-polygon
error for a 96-facet section. The method is not the limiting factor; landmark definition is.

### 3a. Control points, and one path model

Each segment carries **two control points**, parked at a third and two thirds of arc length
along its run. Dragging one reshapes the run; right-clicking one re-centres both onto a
freshly measured run. Handles are teal, with thin guides back to their anchors.

**The number must not move unless you move something.** An earlier build failed this. It had
*two* path models — a plane-constrained section for a straight run and a projected cubic
Bézier for a bent one — so the instant a segment became "curved" the reading shifted from
15.5 cm to 15.0 cm before anything had been shaped. Two legitimate curves, but different
curves between the same two points.

The fix is not a tuned tolerance, it is a change of definition. There is now exactly **one**
path model — *the shortest path along the surface* — chosen for the one property no other
model has:

> a sub-path of a shortest path is itself a shortest path.

So placing control points **on** the A→B run makes A→h1→h2→B measure the same as A→B. There
is no mode to switch and nothing to disclose; the reading responds only to an actual edit.
Verified in the browser: a **1 px** handle drag leaves 15.0 cm at 15.0 cm, where the old
build jumped 0.5 cm. Larger drags move it proportionately — 18.9 cm, then 32.4 cm.

**How it is computed** (`scripts/surface_path.mjs`): seed with the plane-section walk, which
is already on the surface and a good first guess, then relax — repeatedly move each interior
point to the midpoint of its neighbours and snap it back to the nearest surface point, with
the endpoints pinned. Fixed resampling and a fixed iteration count keep it deterministic,
which is what makes a reading reproducible.

**Convergence is what buys continuity**, and it needed a multigrid schedule. Midpoint
relaxation is diffusive: information travels about one sample per pass, so a flat pass costs
O(N²). A flat 8 mm / 512-iteration pass took 88 ms and still measured 222.02 mm on a
front-to-side run; the coarse-to-fine schedule `[32 mm ×40, 16 mm ×40, 8 mm ×40]` reaches
221.60 mm in **11 ms** — better converged and eight times faster. Under-convergence was
exactly what caused the residual jump: with a flat 8-pass relaxation, splitting a run at two
waypoints moved the reading by up to **8.8 mm**; with the schedule the worst case is
**0.12 mm**.

Nearest-surface queries run against a uniform spatial grid built once per session (20 mm
cells, 3 540 cells over 21 492 triangles). Only the dragged segment recomputes, not the line.

Pins and control points are picked in **screen space within a 15 px radius**, not by
raycasting their spheres: a 3.8 mm control point is under 6 px across at normal viewing
distance, so ray picking demanded pixel-perfect aim and the drag fell through to the camera.

#### Both properties are gated, not asserted

`npm run validate:surface-path` (`scripts/test_surface_path.mjs`) enforces two things:

| Gate | Method | Budget | Measured |
|---|---|---|---|
| **Accuracy** | on a cylinder the shortest surface path is a helix of length √((Rθ)² + Δy²) — an analytic answer, no reference implementation to trust | 2 mm | **0.057 mm** worst of three cases (0.028 %) |
| **Continuity** | measure A→B, park control points on it, measure A→h1→h2→B, compare | 0.2 mm | **0.117 mm** worst of four runs across the torso |
| Determinism | the same run measured twice | bit-identical | identical |

The continuity budget is a fifth of the 1 mm reporting digit, so a jump at this scale cannot
change a displayed value. The observed 0.12 mm is a discretisation floor — resampling the
parent run at 8 mm versus resampling each leg independently — and tripling the iterations
does not move it, so tightening the schedule further would only cost time.

Finding this required fixing a bug in the test itself: the helper that snapped hand-picked
probes onto the mesh went through a zero-length run, which returns the probe unchanged, so
two endpoints were left floating off the surface. The relaxation pins its endpoints, so the
run and its legs disagreed and the gate reported a 0.56 mm jump that was the test's fault.

Remaining limit, unchanged: a shortest surface path still follows a concavity where a real
tape would bridge it. Right for point-to-point runs; the hull tape (§4.1) remains the model
for a full girth.

### 3b. Phase 3: inspecting and correcting what was detected

**Landmark markers.** The five landmarks are drawn on the body (amber) and listed in the
panel with their value and a provenance badge. A level landmark is a height, not a point, so
it is marked where a fitter would read it — the front-most place on that section.

**Live section tool.** A vertical slider drives a section at any height, drawing an amber
ring and reporting girth, height, and the hull-vs-contour gap live. That last figure makes
§4.1 tangible: **19.4 mm at the bust, 2.4 mm at the waist** — the tape model matters where
the body is concave and barely matters where it is round.

**Landmark override, round-tripped.** Select a landmark, click the body, and it moves;
dependent POMs recompute instantly because the scan is reused and only landmark-dependent
work re-runs. The correction is not cosmetic:

- The viewer writes `qa/avatar_master/landmarks.manual.json`, pinned to the asset SHA.
- `scripts/measure_avatar.py` **reads that same file**, so corrected landmarks produce
  corrected evidence.
- Provenance is tracked per landmark (`auto` / `manual` / `derived_from_manual`) and per POM,
  so the evidence says exactly which numbers a person influenced. The table marks those rows
  with ✎.
- The parity gate reads the override file too — otherwise it would fail for the wrong reason
  and stop checking what it exists to check.

Demonstrated end to end: moving the underbust fold from y = 1.270 to y = 1.235 changed
`BODY_UNDERBUST_GIRTH` from 83.1 cm to **78.5 cm** in the viewer, in the Python evidence, and
in the parity comparison (Δ 0.022 mm), with the row recorded as `landmark_source: manual`.

An override file recorded against a different asset is **rejected**, not applied quietly:
tested by corrupting its `asset_sha256`, which fails the authority pass with a message naming
both hashes.

**Named, exportable draft lines.** Each drafted line can be renamed and exported to
`draft-lines.json` with its anchors, control points, per-segment lengths, the path model, the
asset SHA and its `declared_limits` — so a hand-drafted measurement leaves the tool as
evidence rather than as a screenshot.

### 3c. Phase 4: measuring along the surface

Four POMs now measure *along* the body rather than around a section, all using the one path
model (§3a), so a reading here is comparable with a line drafted by the pen:

| POM | Value | Status |
|---|---|---|
| `BODY_UNDERBUST_TO_APEX_L/R` — cup depth | **8.2 cm (3 1/4")** each side | auto |
| `BODY_HPS_TO_APEX_L/R` | — | blocked until HPS is placed by hand |

Cup depth runs from the point on the underbust-fold section directly below the apex up to the
apex. The two sides come out identical, consistent with the mirror-symmetric apex pair.

**The routine was ported to Python.** `scripts/surface_path.py` is an independent
re-implementation of `surface_path.mjs`; without it the authority pass could not produce
these POMs and the parity gate would have had nothing to check. The port agrees with the
JavaScript to **0.048 mm** on cup depth and **0.011 mm** on HPS→apex — which is the evidence
that the port is correct, and the reason the exercise was worth doing.

#### An automatic rule that had to be thrown away

HPS normally sits at the neck base on the shoulder. This mesh has no head and the neck is cut
off, so there is no neck-base curve to detect against. A rule was written anyway — *the
highest surface point outboard of the neck stump* — and it produced a confident-looking
32.9 cm.

Testing its sensitivity killed it. The detected point lands **exactly on the rule's own inner
cutoff**, every time:

| cutoff | HPS x | HPS height |
|---|---|---|
| 35 mm | −37.4 mm | 1593.1 mm |
| 45 mm | −45.2 mm | 1589.2 mm |
| 55 mm | −55.6 mm | 1563.5 mm |
| 90 mm | −95.9 mm | 1534.9 mm |

A 58 mm spread in height, driven entirely by a parameter with no anatomical basis. The rule
was reading itself back, not the body. That is false precision, and a number like that is
worse than no number, so the automatic rule was **deleted from both engines** and HPS is
declared `manual_only`.

The POMs that need it get a new status, **`blocked_until_manual`**: measurable in principle,
but yielding no value until a person places the landmark. In the table they appear greyed
with ⊘ and the reason on hover — visible absence, not silent omission. Placing HPS L in the
viewer unblocked that side alone (24.0 cm) and left the right side blocked, and the value is
recorded as `manual`. This is what the Phase 3 override machinery was built for.

### 3d. Phase 5: the POM sheet

`npm run export:pom-sheet` builds `qa/avatar_master/pom-sheet.csv` and `pom-sheet.json`.
Three rules shape it:

**It exports evidence, never live state.** The sheet is generated from the SHA-pinned
authority pass, so every number traces back to the run that produced it. There is
deliberately **no second sheet generator in the viewer** — one generator cannot disagree with
itself. The viewer instead warns, when hand-placed landmarks exist, that they are not in the
sheet until saved and re-measured.

**A missing POM is stated, not omitted.** The sheet has three sections — `MEASURED`,
`DIAGNOSTIC — not points of measure`, and `NOT MEASURED — stated, not omitted` — the last
carrying each absent POM with its reason in full. A factory sheet that quietly drops a
measurement is worse than one that says why it is absent. Six POMs are currently measured,
two are diagnostics, five are stated as absent.

**It refuses to invent a code.** `house_code` is a field in the registry and is null until
the canonical house code set is confirmed (open decision 2). The sheet falls back to the
internal id and stamps the header `Codes: PROVISIONAL`, so a sheet can never quietly carry an
invented code. Mapping to house codes later is a data edit, not a code change.

The header carries the asset SHA, the registry SHA, when the measurement ran, when the sheet
was generated, the unit convention, whether hand-placed landmarks were applied, and every
`declared_limit` — so the caveats travel with the numbers instead of living in a document
nobody opens.

**Staleness is a failure, not a footnote.** The exporter refuses to build a sheet from
evidence whose asset or registry SHA no longer matches what is on disk; tested by touching the
registry, which fails with `rerun npm run measure:avatar`.

### 3e. Phase 6: wire length, asymmetry, and a volume that is not shipped

**Breast root arc (wire length).** `BREAST_ROOT_ARC_L/R` runs inner end → bottom → outer end
along the surface. The bottom is derived (the fold point below the apex, the same one cup
depth starts from); the two ends are `manual_only`, because where a wire sits at the inner and
outer ends is a TD decision, not something to read off a mesh. With ends placed for a trial:
**16.1 cm (6 3/8")** per side, Python↔JS parity Δ 0.020 mm.

**Asymmetry report.** Every mirrored pair — cup depth, HPS→apex, root arc, and the apex pair
itself — is compared and written into the evidence, flagged past 5 mm. On this avatar every
delta is **0.0 mm**: the CLO3D body is perfectly mirror-symmetric, which is worth knowing
before anyone reads meaning into a left/right difference. A flagged pair is reported for a
person to judge, never averaged away.

**Cup volume: rebuilt with the divergence theorem, and now emitted.**

The projection method was replaced. `enclosed_volume_closed` in `scripts/cup_volume.py` builds
an actual closed surface and integrates it: mark the triangles the root loop passes through as
a barrier, flood fill from the apex across edge adjacency, collar the patch boundary out to the
drawn loop, fan the loop to its centroid, then
V = (1/6)·Σ a·(b×c) over the whole closed surface. Overhang is handled exactly, because nothing
is projected.

| Case | Analytic | Closed surface | Superseded projection |
|---|---|---|---|
| Hemisphere, r = 75 mm | 759.214 ml | **−0.056 %** | −0.06 % |
| Cap, 60° | 225.001 ml | **−0.052 %** | −0.05 % |
| **Cap, 120° — overhanging** | 1371.462 ml | **−0.064 %** | **−7.27 %** |
| Flat disc | 0 | encloses nothing | — |

Two things made this work, and both came from checks rather than from reasoning:

* **A watertight assertion.** Every edge of a closed surface is used exactly once in each
  direction; the routine asserts that on the surface it builds. The first attempt failed it
  with 193 unmatched edges — which turned out to be **degenerate triangles at the sphere's pole
  in my own test mesh**, where a quad welds two corners into one. Without the assertion that
  would have shipped as a plausible number. Degenerate faces are now dropped on weld, and the
  test mesh emits a proper fan at the pole.
* **A collar to the drawn loop.** Capping at the mesh boundary the flood fill happened to stop
  on biased every volume **+2 %**, because including the barrier ring pushes the closure a
  triangle outward. Sealing instead to the nearest point on the drawn loop removed the bias;
  `rim_gap_mean_mm` / `rim_gap_max_mm` report how far that gap was (4.2 mm mean, 13.4 mm worst
  on this avatar).

**The result on the avatar: 235.5 ml per side** — with a closed root loop placed by hand,
inner → bottom → outer → top → inner, each leg a shortest surface path.

**What actually limits this number is the loop, not the maths.** Measured sensitivity: moving
`ROOT_TOP` across a 3 cm range swings the volume from 192.9 ml to 271.2 ml, about **±18 %**,
while the routine itself is accurate to 0.064 %. That figure is recorded on the POM and travels
into the sheet's Notes column, so nobody reads 235.5 ml as a hard number without owning where
the root was drawn.

`CUP_VOLUME_L/R` are therefore `blocked_until_manual`, not automatic, and declared
`parity: analytic_only` — computed in the Python authority pass only, validated against
analytic caps rather than by cross-implementation parity. The parity gate skips them **by
declaration, with the reason printed**, which is auditable; skipping by accident is not.

---

*Superseded, kept for the record:*

**The projection method that was replaced.**

The routine (`scripts/cup_volume.py`) reconstructs the hidden chest wall as the plane of the
root loop and integrates the prism between the mound and that plane. Against answers that are
arithmetic rather than another implementation:

| Case | Analytic | Measured | Error |
|---|---|---|---|
| Hemisphere, r = 75 mm | 883.573 ml | 883.085 ml | **−0.055 %** |
| Spherical cap, 60° | 276.117 ml | 275.976 ml | **−0.051 %** |
| Flat disc | 0 | 0 | encloses nothing |
| **Cap, 120° — outside the envelope** | 1491.029 ml | 1269.508 ml | **−14.86 %** |

The last row is the reason no `CUP_VOLUME_*` value is produced. A mound that bulges wider than
its own root loop projects partly outside it and is never counted. Two attempts to detect that
automatically both failed:

1. A normal-sign test flagged everything, because the sign it read was the mesh's winding, not
   the surface turning back.
2. A projected-winding test flagged nothing, because the missing triangles are excluded by the
   point-in-polygon filter *before* any test sees them.

And the failure is undetectable in principle from the projection alone on a real body: a torso
legitimately continues outside the root loop and above its plane, so "surface outside the loop"
is diagnostic on a sphere and meaningless here. Shipping a number that can be 15 % light with
no warning is exactly the failure mode this project keeps rejecting, so `CUP_VOLUME_L/R` stay
`planned` with the finding recorded, and `npm run validate:cup-volume` keeps a regression check
on the −14.86 % figure so the validity note cannot go stale unnoticed.

Unblocking it needs a closed-surface method: select the patch by surface connectivity bounded
by the root loop, cap the loop, and integrate by the divergence theorem — which handles
overhang exactly and does not depend on projection at all.

### 3f. Phase 7: the second lane, without a second source of truth

The production viewer (`viewer/`) now shows the same measurement table and the same red tape
lines as the prototype. The point of the phase was not to add a panel — it was to add it
**without creating a way for the two lanes to disagree**.

**One engine.** `viewer/src/measurements.js` imports the same `scripts/measure_core.mjs` and
`surface_path.mjs` the prototype and the Node parity test use. Only the DOM and the three.js
drawing are local, because the two shells differ. No maths is copied.

**One registry, copied not forked.** `npm run sync:registry` copies
`contracts/measurement-registry.json` into `viewer/public/`, and it runs automatically before
`dev:viewer` and `build:viewer`. The viewer fetches it at runtime rather than bundling an
import, so what it shows comes from a file that can be compared against the source.

**The lanes differ in role, deliberately.** The prototype is the authoring lane — pen,
hand-placed landmarks, live section. The production lane is read-only presentation, and says
so in the panel: *corrections are made in the prototype lane; the record comes from
`npm run validate:measurements`*. Correcting a landmark in two places is how two records start
to differ, so there is only one place to do it.

**No silent default.** Without the registry the production lane reports nothing and explains
why. The prototype keeps a documented fallback so it still shows something when served without
one — and the drift guard checks that the fallback is the *only* place it names a material.

#### The claim is structural, so it is checked structurally

`npm run validate:lane-parity` is a static check — no browser, runs in CI — and it fails the
build on the cheap ways to make the lanes disagree:

| Check | Why it exists |
|---|---|
| the served registry is byte-identical to `contracts/` | a forked copy is the obvious drift |
| both lanes import `measure_core.mjs` | pasted maths is the other obvious drift |
| neither lane redefines `convexHull`, `sectionSegments`, `ringPerimeter`, `findLandmarks`, `computePoms` | catches a paste that kept the import |
| the engine names no material or asset | the engine must stay asset-agnostic |
| the production lane hardcodes no material name and no scan range | those belong to the registry |
| the production lane refuses to measure without a registry | no invented defaults |
| the prototype names its material only inside `loadRegistry()` | the fallback is allowed; leaking it is not |

All 11 pass. Negative-tested two ways: forking the served registry fails the first check, and
adding a hardcoded `Mara:body3` to the production lane fails the material check.

Verified in the browser: the production lane reads Waist 76.9, Underbust 83.1, Bust 101.3, Max
girth 102.4, Cup depth 8.2/8.2 — identical to the prototype — with the four
awaiting-a-landmark POMs greyed and marked ⊘, and the tapes drawn on the body.

### 3g. Landmarks a bra fitting actually needs

Six landmarks were added, all detected automatically and all **threshold-free** — the answer
does not track a number someone chose, which is the test the rejected HPS rule failed:

| Landmark | Rule | On this avatar |
|---|---|---|
| `CF_UNDERBUST` — the gore point | on the fold section, nearest the centre line, front-most | y 127.0, x −0.0 |
| `CB_UNDERBUST` — band closure | same, back-most | y 127.0, x −0.0 |
| `SIDE_UNDERBUST_L/R` — where the wire ends and the wing starts | on the fold section, the extreme x per side | y 127.0, x ±14.5 |
| `UNDERARM_L/R` | the lowest point of the armhole | y 138.9, x ±17.1 |

The underarm rule is worth spelling out. The torso surface is **open at the armhole**, so its
boundary loops are a real geometric feature: there are exactly four — of these the highest is
the neck, the lowest is the waist, and the two that remain are the armholes. No threshold
appears anywhere in that reasoning. The authority pass fails loudly if the count is not four,
and the parity gate checks it too.

Four POMs follow from them:

| POM | Value | Method |
|---|---|---|
| `BODY_BAND_FRONT_L/R` — centre front to the side point | **20.0 cm (7 7/8")** | `section_arc` |
| `BODY_UNDERARM_TO_FOLD_L/R` — wing height | **13.7 cm (5 3/8")** | shortest surface path |

Band front uses a **new method, `section_arc`**: the arc of the underbust section itself, not a
free shortest path. A band follows the underbust line, so the section's own arc is the right
model — a shortest path would cut a chord across it. Both engines implement it and the parity
gate covers it (Δ 0.025 mm).

**Hand placement is back**, and now covers every landmark, grouped in the panel: *Bust*,
*Band and wing*, and *Place by hand* — the last holding the ones with no honest automatic rule
(HPS, and the three root points per side), badged `needed` until placed. Click a row, click the
body; automatic landmarks can be corrected the same way and are badged `manual` once moved.
Save writes `qa/avatar_master/landmarks.manual.json`, the file the authority pass reads.

## 4. Method decisions, each with its evidence

### 4.1 Girth = convex hull of the section, never the raw contour

A tape measure spans concavities — it bridges the cleavage gap and the spinal groove
instead of sinking into them. The correct model of a tape is therefore the **2D convex hull
of the cross-section**, not the section outline.

Measured on this body:

| Section | Hull (tape) | Raw contour | Error if raw is used |
|---|---|---|---|
| Full bust, y=1.35 | 1024.5 mm | 1045.0 mm | **+20.5 mm (+0.81 in)** |
| Underbust, y=1.27 | 830.9 mm | 832.1 mm | +1.2 mm |
| Waist, y=1.20 | 768.7 mm | 770.7 mm | +2.0 mm |

+20.5 mm at the bust is over ¾ inch — enough to shift a size in grading. This single
decision matters more than any amount of numerical polish.

*Known refinement, deferred:* strictly, a tape is a **partial** hull — it follows the breast
contour where the breast is convex and bridges only the inter-breast gap. Full hull and
partial hull coincide on this body because the section is convex everywhere except the
cleavage and the spine. Re-examine if a future avatar has strong asymmetry or posture lean.

### 4.2 Arms must be excluded, and can be exactly

A horizontal plane at bust height cuts **both arms** as well as the torso: 184–200 arm
segments at y = 1.30–1.40. Including them corrupts every girth.

The arms are a separate glTF primitive with material `Mara:arm2`, the torso is
`Mara:body3`. Filtering by material name is exact and needs no geometric heuristic. **This
is a property of the current asset and must be re-verified after any re-export** — if a
future bake merges materials, the filter silently stops working. The registry records the
expected material name so a check can fail loudly instead.

### 4.3 There is a ceiling on plane-section measurements at y ≈ 1.39 m

Above the armpit the torso surface is **open** (torso and arms are separate surfaces meeting
at an armhole seam), so a horizontal section is no longer a closed loop. Symptom already
observed: above y = 1.39 the contour length collapses below the hull length
(y=1.40: hull 995 mm vs contour 800 mm) because the section is an open polyline.

Consequence: **across-chest, across-back, shoulder and upper-bust POMs cannot use plane
sections.** They need either surface (geodesic) paths, or a stitched torso+arm surface built
for measurement only. Plan: geodesic (§4.6); do not silently report a hull number there.

### 4.4 Landmark rules (automatic, purely geometric)

All four are derived from two scan profiles — girth(y) and forward-reach(y):

| Landmark | Rule | Why it works here |
|---|---|---|
| Bust apex | section reaching furthest forward (max +Z) | clean single maximum at y=1.330, 139.9 mm forward |
| Underbust (fold) | below the apex, the section reaching **least** far forward | the inframammary fold is a local minimum: 101.7 mm at y=1.270 |
| Full bust | largest girth near the apex | 1024.5 mm at y=1.350 |
| Waist | below the fold, the smallest girth | 768.5 mm at y=1.195 |

Left/right apex should be detected **separately** (currently the section maximum is used,
which is whichever breast protrudes more). Per-side apex gives apex-to-apex, bust span, and
an asymmetry QC figure. Planned for Phase 1.

### 4.5 The "full bust" definition trap — needs your decision

Drawing the tape exposed a real problem. The **maximum-girth** section sits at y = 1.350,
**20 mm above the apex** at y = 1.330, because the ribcage keeps broadening toward the
armpits: total girth peaks above the point of maximum breast protrusion.

- "girth at the apex level" → **101.3 cm**
- "largest girth found" → **102.4 cm**

A 1.1 cm spread from wording alone. ISO 8559-1 defines bust girth *at the level of the bust
points*, so the defensible number is **101.3 cm**, with max-girth kept as a diagnostic. The
registry must state this explicitly, and the "max girth" row should be labelled as a
diagnostic rather than as the bust POM. **Open decision #1 in §13.**

### 4.6 Surface (geodesic) measurements

Several bra POMs are *over the body*, not around it or straight through it:
HPS→apex, underbust→apex (cup depth), across-chest, breast root arc (wire length).

Approach, in order of increasing cost:

1. **MVP — Dijkstra on the mesh edge graph.** Shortest path along edges between two
   landmark vertices. Simple, deterministic, but systematically **over-estimates**
   (a staircase along edges is longer than the true surface geodesic); on a ~21k-tri torso
   expect a few percent. Usable for relative comparison, not for spec numbers.
2. **Edge-crossing refinement.** Allow paths to cross triangle interiors
   (Chen–Han / MMP style, or iterative straightening of the Dijkstra path). Brings error
   down to well under 1 mm. This is the target for released numbers.
3. **Plane-constrained surface path.** For POMs defined as "over the surface in a given
   plane" (e.g. cup depth in the vertical plane through the apex), intersect the mesh with
   that plane and take the arc length between landmarks on the resulting curve. Cheap,
   exact for this class, and it matches how a tape is actually laid. **Preferred wherever
   the POM is planar** — likely covers most bra POMs.

Decision: implement (3) first for planar POMs, (1) as a labelled-approximate fallback for
non-planar ones, and only build (2) if a POM genuinely needs a free geodesic.

**Status: (3) is implemented** and is what the pen's anchor-to-anchor runs use (§3). The
same routine can be pointed at named landmarks to produce the planned `surface_path` POMs in
Phase 4 — cup depth and HPS→apex need only the landmark pair and a plane rule, not new maths.

### 4.7 Body measurement vs band measurement

The mesh gives a loose-tape *body* dimension. A bra band is measured **snug**, compressing
tissue by a few millimetres to over a centimetre at the underbust depending on tissue.
The registry therefore carries a `tape_tension` field with values
`loose_body` (what the mesh gives) or `snug_band` (requires a compression allowance).
The tool reports `loose_body` only, and states so. Any conversion to band size is a
sizing-standard decision recorded outside this tool. Never quietly subtract an allowance.

## 5. The POM registry

One machine-readable file is the contract for everything else:
**`contracts/measurement-registry.json`**.

```jsonc
{
  "schema_version": 1,
  "asset_id": "avatar_master",
  "expected_materials": { "torso": "Mara:body3", "arms": "Mara:arm2" },
  "scan": { "from_m": 1.05, "to_m": 1.56, "step_m": 0.005 },
  "poms": [
    {
      "id": "BODY_UNDERBUST_GIRTH",
      "label_en": "Underbust girth",
      "label_vi": "Vòng chân ngực",
      "standard": "ISO 8559-1:2017 §underbust girth",
      "method": "plane_section",
      "tape_model": "convex_hull",
      "tape_tension": "loose_body",
      "landmark": "UNDERBUST_FOLD",
      "surface": "torso",
      "report_precision_mm": 1,
      "tolerance_mm": 1.0,
      "status": "auto",
      "notes": "Fold detected as the local minimum of forward reach below the apex."
    },
    {
      "id": "BODY_BUST_GIRTH",
      "label_en": "Bust girth",
      "method": "plane_section",
      "tape_model": "convex_hull",
      "landmark": "BUST_APEX",
      "landmark_level": "apex_height",
      "status": "needs_review",
      "notes": "Measured at apex level per ISO, NOT at maximum girth. See plan §4.5."
    },
    {
      "id": "DIAG_MAX_TORSO_GIRTH",
      "label_en": "Maximum torso girth (diagnostic)",
      "method": "plane_section",
      "status": "diagnostic"
    },
    {
      "id": "BODY_APEX_TO_APEX",
      "label_en": "Bust point to bust point",
      "method": "euclidean",
      "landmarks": ["BUST_APEX_L", "BUST_APEX_R"],
      "status": "planned"
    },
    {
      "id": "BODY_UNDERBUST_TO_APEX",
      "label_en": "Cup depth (underbust to apex)",
      "method": "surface_path_in_plane",
      "plane": "vertical_through_apex",
      "status": "planned"
    },
    {
      "id": "BREAST_ROOT_ARC",
      "label_en": "Breast root arc (wire length)",
      "method": "surface_path",
      "status": "planned"
    },
    {
      "id": "BODY_ACROSS_BACK",
      "label_en": "Across back",
      "method": "surface_path",
      "status": "blocked",
      "blocked_reason": "Crosses the armpit; torso surface is open above y≈1.39m (plan §4.3)."
    },
    {
      "id": "BODY_HIP_GIRTH",
      "label_en": "Hip girth",
      "status": "blocked",
      "blocked_reason": "Mesh ends at y=0.995m; no hip geometry exists."
    }
  ]
}
```

Rules this file enforces:

- A POM with `status: "blocked"` **must not** produce a number anywhere in the UI or export.
- A POM with `status: "needs_review"` renders with a review marker until signed off.
- `status: "diagnostic"` values may be shown but never exported as POMs.
- If `expected_materials` no longer match the loaded asset, the whole measurement pass
  fails loudly rather than measuring the wrong surface.

## 6. Architecture — three layers plus a cross-check

```
contracts/measurement-registry.json          ← the definitions (human-authored)
            │
            ├─► scripts/measure_avatar.py    ← authority pass, PURE PYTHON over the GLB
            │        └─► qa/avatar_master/measurements.json      (SHA-pinned evidence)
            │
            └─► scripts/measure_core.mjs     ← the one JavaScript engine
                     ├─► digital_bra_fit_model_360.html  (live, in-browser)
                     └─► scripts/test_measurement_parity.mjs
                              └─► qa/avatar_master/measurement-parity.json
```

**Why both, and why they are shared this way.** The Python pass writes durable evidence; the
browser pass makes measuring interactive, which is what makes the tool useful in a fitting
discussion. The two are *deliberately independent implementations* — that is what gives the
parity test teeth. But the browser and the parity test import the **same** `measure_core.mjs`,
so "the viewer agrees with the test" holds by construction rather than by copy-paste. Three
independent GLB parsers (three.js, `glb_reader.mjs`, the Python reader) is not duplication
either: it is part of what the gate actually verifies.

**Deviation from the original plan:** the authority pass measures the **GLB in pure Python**
rather than the `.blend` in headless Blender. The GLB is what the viewer loads, so both
passes measure the same triangles, and the gate runs anywhere including CI with no Blender
install. The `.blend` remains the editable source.

**Measured result.** `npm run validate:measurements` runs the authority pass and then the
gate. Worst disagreement across all six measurable POMs and all five landmarks is
**0.048 mm** against the registry's **0.5 mm** tolerance — and the residual is only the
evidence file's 0.1 mm rounding, not real divergence. Read against the browser at reporting
precision the two are identical:

| POM | Python evidence | Browser, live | Δ |
|---|---|---|---|
| BODY_WAIST_GIRTH | 768.5 mm | 768.5 mm | 0.0 |
| BODY_UNDERBUST_GIRTH | 830.9 mm | 830.9 mm | 0.0 |
| BODY_BUST_GIRTH | 1013.5 mm | 1013.5 mm | 0.0 |
| BODY_APEX_TO_APEX | 160.7 mm | 160.7 mm | 0.0 |
| DIAG_MAX_TORSO_GIRTH | 1024.5 mm | 1024.5 mm | 0.0 |
| BODY_BUST_POINT_HEIGHT | 1330.0 mm | 1330.0 mm | 0.0 |

The gate was negative-tested: tightening the tolerance to 0.001 mm makes it fail 8 checks,
so it is genuinely load-bearing rather than a test that cannot fail. It also refuses to
compare evidence whose asset or registry SHA no longer matches what is on disk, so stale
evidence is a failure and not a silent pass.

**New reading from per-side apex detection:** `BODY_APEX_TO_APEX` = **16.1 cm (6 3/8")**, and
the two apexes come out mirror-symmetric (x = ±80.4 mm, identical height and projection),
which is itself a useful mesh-symmetry QC signal.

## 7. Drawing on the avatar

What gets drawn, and why each one earns its place:

| Annotation | Geometry | Purpose |
|---|---|---|
| **Tape band** (done) | the hull ring at the POM's height, red, toggleable | shows exactly where the tape sat — the single most effective way to catch a bad landmark |
| **Draft line** (done) | anchor pins + plane-constrained surface runs, ink blue | drafting a measurement by hand where no POM exists yet, and a sanity check on any automatic number |
| **Control point** (done) | two per segment, teal, with guides back to their anchors | bends a run into a curve that still lies on the skin, the way a pattern line is shaped |
| **Length label** (done) | HTML pill re-projected each frame, lifted 20px clear of the curve | shows a line's measurement on the body, per line, on demand, with its path model disclosed |
| **Landmark marker** | small sphere/disc at apex L/R, fold, HPS | makes the detected points inspectable |
| **Caliper line** | straight segment between two landmarks | for `euclidean` POMs (apex-to-apex) — visually distinct from a tape so the two are never confused |
| **Surface path** | polyline following the mesh | for `surface_path` POMs (cup depth, root arc) |
| **Section plane** | translucent quad at the scan height | only while a live slider is being dragged |
| **Leader + label** | 2D HTML label anchored to a projected 3D point | the value, placed next to its own annotation |

Rendering rules:

- Offset every annotation 1.5 mm clear of the skin along the outward normal to avoid
  z-fighting (already implemented for the tape).
- Draw each annotation twice: solid where visible, ~22 % opacity with `depthTest:false`
  where occluded, so a loop that wraps behind the body still reads as one loop
  (already implemented).
- Line rendering uses `Line2`/`LineMaterial` at 2–3.2 px screen width (done); every material's
  `resolution` is re-synced on canvas resize or the width drifts.
- Colour by measurement kind, not by POM: **tape = red** (done), **pen = ink blue** (done),
  caliper and surface path to follow. Consistency beats decoration.
- Every annotation carries `userData.pomId` so a screenshot can be traced back to a POM.

## 8. Traceability and evidence

`qa/avatar_master/measurements.json`, one file per pass:

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-09-04T17:10:00Z",
  "asset": { "file": "assets/export/avatar_master.glb",
             "sha256": "0caa604b…", "unit": "meter", "up_axis": "Y", "front_axis": "+Z" },
  "registry_sha256": "…",
  "tool": { "blender": "5.2.0 LTS", "script": "scripts/measure_avatar.py@<git-sha>" },
  "calibration": { "cylinder_true_mm": 628.32, "cylinder_measured_mm": 628.21, "error_mm": -0.11 },
  "landmarks": {
    "BUST_APEX_L": { "xyz_m": [-0.071, 1.330, 0.139], "source": "auto", "rule": "max_forward_reach" },
    "UNDERBUST_FOLD": { "y_m": 1.270, "source": "auto", "rule": "min_forward_reach_below_apex" }
  },
  "poms": [
    { "id": "BODY_UNDERBUST_GIRTH", "value_mm": 830.9, "value_cm": 83.1, "value_in": "32 3/4",
      "method": "plane_section/convex_hull", "at_y_m": 1.270,
      "hull_vs_contour_mm": 1.2, "status": "auto" }
  ],
  "qc": { "left_right_apex_delta_mm": null, "watertight": null, "scan_step_mm": 5 },
  "declared_limits": ["no compression allowance", "no hip geometry", "sections invalid above y=1.39m"]
}
```

Non-negotiables:

- **The asset SHA is part of the record.** A new GLB invalidates the file; the parity test
  refuses to compare evidence whose SHA does not match the asset on disk.
- **Landmark provenance per point**: `auto` (with the rule name) or `manual` (with who and
  when). A number derived from a hand-placed landmark must say so.
- **Report at 1 mm.** The algorithm resolves ~0.1 mm but the *definitions* are worth about a
  millimetre; publishing 0.01 mm would be false precision.
- **`declared_limits` travels with the numbers**, so an exported sheet cannot be read
  without its caveats.

## 9. Validation plan and tolerances

| Check | Method | Gate |
|---|---|---|
| Algorithmic accuracy | slice primitives of exactly known girth (cylinder, sphere) | ≤ 0.5 mm; currently 0.11 mm |
| Cross-implementation parity | Blender vs browser on every POM | ≤ 0.5 mm; currently ≤ 0.2 mm |
| Determinism | run twice, byte-compare (excluding timestamp) | identical |
| Scan-step sensitivity | re-run at 10 / 5 / 2 mm steps | landmark height shift ≤ 5 mm, girth shift ≤ 1 mm |
| Left/right symmetry | per-side apex and half-girth | report; flag > 5 mm as a mesh QC finding |
| Mesh integrity | non-manifold edges, duplicate verts, degenerate tris | report before trusting any number |
| Material contract | `expected_materials` present in the asset | hard fail if missing |
| **External ground truth** | compare against CLO3D's own avatar measurement panel for "Mara" | investigate any delta > 5 mm |

That last row is the strongest validation available and costs almost nothing: the avatar came
from CLO3D, which publishes its own measurements for its avatars. If our underbust and bust
land within a few millimetres of CLO's figures, the whole chain is corroborated by an
independent implementation. **This needs the original CLO3D file — worth locating.**

## 10. UI specification

**Measurement panel** (implemented, to be extended):

- Columns: `Point · Height · Girth (hull)`. Add `± / status` once `needs_review` exists.
- Row states: normal, `needs_review` (marker), `diagnostic` (dimmed), `blocked`
  (shown greyed with the reason on hover — visible absence beats silent omission).
- Click a row → draw that annotation, fly the camera to a view where it is legible.
- Unit toggle cm ⇄ inch fractions (⅛ resolution, factory convention).
- Footer: bust−underbust difference, computation time, and the "mesh geometry only" caveat.

**Live section tool** (Phase 3): a vertical slider that drives an arbitrary section plane;
shows girth, hull-vs-contour delta and height as it moves. This is what makes the tool feel
like a measuring instrument rather than a report.

**Landmark override** (Phase 3): click on the mesh → raycast → snap to nearest vertex →
reassign the landmark → all dependent POMs recompute and the annotation redraws. Saves to
`qa/avatar_master/landmarks.manual.json` with author and timestamp, and flips affected POMs
to `source: manual`. Automatic for speed, human-confirmable for accountability.

**Export** (Phase 5): POM sheet as CSV/JSON in house format, cm and inch fractions, with the
asset SHA, the registry SHA and `declared_limits` embedded in the header.

## 11. Phases

| Phase | Deliverable | State |
|---|---|---|
| 0 | Spike + live 4-point panel + Python/JS agreement | **done** |
| 0b | Collapsible panel, inch column, red toggleable tape lines, Line2 rendering | **done** |
| 0c | Pen as an anchor-based drafting tool: pin/drag/delete points, plane-constrained surface runs, closable loops, per-line length labels | **done** |
| 0d | Two control points per segment, screen-space handle picking, real-time recompute | **done** |
| 0e | Single path model (shortest surface path) replacing the earlier two, multigrid relaxation, `validate:surface-path` gating analytic accuracy and continuity | **done** |
| 1 | `contracts/measurement-registry.json`; `scripts/measure_avatar.py` writing SHA-pinned evidence; per-side apex; registry-driven viewer table; `npm run measure:avatar` | **done** |
| 2 | `scripts/measure_core.mjs` shared engine; `scripts/test_measurement_parity.mjs`; `npm run validate:measure-parity` / `validate:measurements` (0.5 mm gate) | **done** |
| 3 | Landmark markers, live section tool, landmark override round-tripped through the authority pass, named/exportable draft lines | **done** |
| 4 | Surface-path POMs: cup depth per side, HPS→apex per side; the routine ported to Python so the parity gate covers it | **done** |
| 5 | POM sheet export: `npm run export:pom-sheet` writing CSV + JSON from the SHA-pinned evidence | **done** |
| 6 | Breast root arc; asymmetry report; cup volume by closed-surface divergence, emitted | **done** |
| 7 | Measurements in the production viewer, sharing one engine and one registry, with a static drift guard | **done** |

Phases 1–2 are the ones that convert Phase 0 from a demo into something citable; I would not
export anything to a factory before Phase 2 exists.

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Re-bake merges materials | arm filter silently fails, every girth wrong | `expected_materials` hard check |
| Mesh edited without re-measuring | evidence describes a body that no longer exists | SHA-pinned evidence; parity test refuses mismatched SHA |
| Auto landmark lands wrong on a future avatar | plausible but wrong numbers | tape drawing makes it visible; manual override + `needs_review` |
| Geodesic over-estimation via Dijkstra | cup depth reads long | prefer planar surface paths; label approximate methods |
| Reading mesh girth as band size | wrong bra size | `tape_tension` field; caveat in panel and export |
| **This avatar may not be a 36C** | every downstream assumption | bust−underbust is 19.4 cm ≈ 7.6 in, far past a C cup; verify against CLO3D before using it for any style |
| False precision creeping into docs | unjustified confidence | fixed 1 mm reporting precision |

## 13. Open decisions — I need your call

1. **Bust girth definition.** At apex level (101.3 cm, ISO-consistent) or largest girth
   found (102.4 cm)? I recommend **apex level**, with max girth kept as a diagnostic.
2. **POM vocabulary.** Should POM ids and labels follow the house measurement standard
   (`Measurement_standard.xlsx` / the POM sheet codes) so avatar readings drop straight into
   an existing sheet? I recommend yes — tell me which code set is canonical.
3. **Export units.** Inch fractions to ⅛ or ¹⁄₁₆? cm to 0.1?
4. **Compression allowance.** Keep it entirely out of the tool (my recommendation), or carry
   a documented allowance per POM?
5. **Sign-off model.** Do auto-detected landmarks need a human tick before a POM can be
   exported, or is auto sufficient for internal use with `needs_review` markers?
6. **Hip.** Do you want hip/low-hip measurements? That requires an avatar with legs — a
   different export from CLO3D, not something this mesh can give.
7. **CLO3D ground truth.** Can you locate the original CLO3D file for the "Mara" avatar so
   we can validate against its published measurements? This is the highest-value
   verification available.

8. ~~**Path model for curved POMs.**~~ **Resolved by construction.** There is now one model,
   the shortest surface path (§3a), gated against an analytic geodesic at 0.057 mm and for
   continuity at 0.117 mm. Phase 4's cup depth and root arc will declare `surface_path` and
   use the same routine, so no choice remains to be made.
