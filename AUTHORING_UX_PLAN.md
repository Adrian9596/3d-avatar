# Authoring-lane usability & accuracy — Research Plan

Orbit while drafting · a pen that snaps · landmark placement that says how well it was placed ·
template drafts from landmarks.

Status: **research; nothing built.** Written 2026-09-05 against `assets/export/avatar_master.glb`
(SHA-256 `0caa604bab3510e6c40ed699185832b55d68b87668336a53d385a5345ddd71a4`). §4 records what a
numerical spike found on that body; §5–§8 propose what to build from it, §10–§11 how it will be
gated, §14 the keyboard and pointer map, and §15 the concrete work plan, phase by phase. Companion to `MEASUREMENT_PLAN.md` (landmarks, POMs) and `PATTERN_2D_DXF_PLAN.md`
(flattening, DXF), neither of which this plan changes in substance — it changes how a person
*drives* them.

---

## 1. Goal

Two words in the brief, each with a definition this plan can be held to:

- **Easy to use** — fewer mode switches and fewer clicks per *correct* point. Today drawing a line
  around the body takes: pen off → orbit → pen on → click, repeated once per side of the body. The
  target is: never leave the pen to look around, and never place a point twice because the first
  landed a few millimetres off.
- **Accurate** — a placed point lands where the person meant to within what the screen can resolve,
  and the tool tells them, before they click, when the screen cannot resolve it. Accuracy here is
  not about the maths (the shortest-path and flattening engines are already gated to sub-millimetre)
  but about the *input*: where a click lands on a curved surface seen at an angle, and whether a
  suggestion (mirror, template) is recorded as a suggestion.

Everything proposed keeps the project's standing rules: one path model, landmarks corrected in one
place, nothing invented, every number a person influenced says so.

## 2. Non-goals

- **No automatic HPS, and no snapping HPS to the neck opening.** The rule was deleted once for
  reading its own parameter back (`MEASUREMENT_PLAN.md` §3c). The neck opening of this mesh is where
  CLO3D cut the torso, not anatomy, so snapping to it would be an automatic rule wearing a snap's
  clothes. HPS stays a point a person puts down by eye.
- **No second path model.** Snapping decides *where an anchor goes*; the run between two anchors
  stays the shortest surface path. A "level" snap sets an anchor's height; it does not turn the
  segment into a section arc.
- **No template becomes evidence by itself.** A template (§8) proposes pen lines. They appear in the
  same list as hand-drawn lines, editable, deletable, and flattened through the same pipeline; the
  export records that they came from a template and from which landmarks. The tool does not decide
  where a cup is cut — it shows the person what two or three conventional cuts would cost, in
  millimetres, and they choose.
- **No production-lane editing.** Landmark placement and template drafts stay in the prototype
  (CLAUDE.md: one place to correct, one record). The pen improvements land in the shared
  `scripts/pen_tool.mjs`, so both lanes get orbit-while-drafting and snapping to their own lines.
- **No ease, allowance or grading** — unchanged from `PATTERN_2D_DXF_PLAN.md` §11.

## 3. What exists, and where it hurts

Read from the code, not from memory; line references are to `scripts/pen_tool.mjs` (P) and
`digital_bra_fit_model_360.html` (H) at commit `ad6c4af`.

| Area | Today | Where it hurts |
|---|---|---|
| Orbit vs pen | `setEnabled(on)` sets `controls.enabled = !on` (P 502). The 5-px "that was an orbit, not a click" test in `onPointerUp` (P 379) is therefore dead code while the pen is on. | Every look-around is three clicks. The back of the body is unreachable without leaving the pen. |
| Pen hit surface | `surfaceHit` raycasts `root` (all meshes: torso, arms, `Skin_Cut` faces); `collectTriangles` builds the path grid from the same set (P 59, 101). | The pattern draft flattens the registry's **measurement surface** (torso only). A loop that clips an arm is refused by the leak check with "could not find the inside of this loop" — correct, but the person is told after the fact and not why. |
| Pen picking | Screen-space pick, 15 px radius; closing a loop = click the first anchor within 15 px (P 37, 389). | Good. The pattern for snapping already exists in miniature — but only for one target. |
| Editing | `undoPoint` only; drag anchor / control point; right-click deletes or re-centres. | No redo, no fine nudge, no way to place a point more precisely than one click at the current zoom. |
| Landmark placement | Click a row, click the body once (`surfaceHitForLandmark`, H 806, raycasts all meshes). Level landmarks take the click's height from wherever the click lands. Recompute is instant (scan reused). | Click-only: no drag, no preview of where the tape will sit until after the click. Can land on the arm. Nothing records how far away or at what angle the point was placed. |
| Camera | OrbitControls with damping; four presets and an animated `cameraGoal` (H 927); polar clamp 0.35 rad. | Nothing frames the *thing being placed*. For ROOT_INNER_L the person orbits and zooms by hand every time. |
| Seam ends | `splitLoopBySeam` snaps a seam end to the outline within 15 mm (`flatten_patch.mjs` 145). | The snap happens at Flatten time; while drawing, the person cannot see that an end is on the outline. |
| Touch | `touch-action:none` on the canvas; pointer events throughout. | Tap pins a point, but there is no two-finger orbit while the pen is on, for the same `controls.enabled` reason. |

## 4. Findings from the spike

Node, on the torso soup the measurement engine uses (`scripts/flatten_fixtures.loadAvatarContext`),
with the viewer's camera (28° vertical FOV, framing distance = 1.3 × fit) and a 1400 × 900 pane.
Script: `scripts/spike_authoring_ux.mjs` (`node scripts/spike_authoring_ux.mjs`); every number below is reproducible from the engines in
`scripts/`.

### 4.1 What one pixel is worth on the skin

| Situation | mm per pixel |
|---|---|
| Default framing (camera 1.575 m from the body), surface facing the camera | 0.87 |
| Zoomed to 0.35 m, facing | 0.19 |
| Default framing, surface at 60° incidence | 1.74 |
| … at 75° | 3.37 |
| … at 85° | 10.0 |

A click has a footprint of `mm_per_px / cos(incidence)`. Fifteen pixels of pick radius is 13 mm on a
facing surface at default framing and 50 mm at 75°. **Incidence, not zoom, is the dominant error
term**: zooming in 4.5× buys the same as turning the body 60°.

How much of what is clickable is at a bad angle (area-weighted, torso only):

| View | of clickable torso area at > 60° incidence | at > 75° |
|---|---|---|
| Front | 26.7 % | 14.6 % |
| Three-quarter | 36.3 % | 16.4 % |
| Side | 56.4 % | 37.5 % |

So from the front, one click in seven lands where a pixel is worth more than 3 mm — and those are
exactly the places a bra pattern cares about (the side of the cup, the root's outer end, the wing).
This is the case for the grazing guard (§5.3) and for framing a point along its normal (§5.2).

### 4.2 The body is an exact mirror

1 883 vertices of the left torso mirrored through x → −x land on the surface to **0.000 mm**
(mean, p95 and max). The source `.blend` is a mirrored half (`Avatarclo1_half_beautified…`), so on
this asset a mirrored line or landmark is exact. A scanned body will not be, which is why §6.4
snaps the mirror to the surface, records the residual, and flags it past the same 5 mm asymmetry
threshold the authority pass already uses.

### 4.3 A template draft from landmarks works, and is cheap enough to be live

Cup outline built the way the pen builds a line — four anchors, each leg the shortest path with its
two control points parked at ⅓ and ⅔ — through the left apex's ROOT_TOP, ROOT_OUTER, ROOT_BOTTOM,
ROOT_INNER (**the three manual-only roots were synthesised for the spike**; on the real body a
person places them). Outline 329.6 mm, 12 legs, 36 ms to build. Then `draftPieces` + `flattenDraft`:

| Template | Pieces | Seam error per piece (mm) | Shared-seam mismatch (mm) | Sweeps | Time |
|---|---|---|---|---|---|
| One piece | 1 | 19.5 | — | 602 | 21 ms |
| Vertical seam through the apex | 2 | 7.6 / 2.5 | 1.05 | 1 578 | 49 ms |
| Horizontal seam through the apex | 2 | 3.9 / 2.2 | 0.59 | 2 615 | 62 ms |

All sound (0 fold-overs, converged, no restarts). Three things follow. A template needs nothing the
pen and flatten engines do not already have. Its result is a *comparison* — here the horizontal
seam sheds curvature better than the vertical on this body and this root placement — which is
useful to show and wrong to decide on the person's behalf. And at ~50 ms a template can re-run
every time a landmark is dragged, so the pieces update live under the hand placing the root.

### 4.4 Cost of a live preview

One shortest-path leg on the torso grid: **3.5 ms**. A pen segment is three legs; the segment
being drawn is the only one that changes on hover, so a ghost of "where the line would go if you
clicked here" costs ~10 ms per pointer move. Feasible at frame rate; the pen already recomputes
exactly one segment during a control-point drag for the same reason.

## 5. Orbit while drafting

### 5.1 Pointer grammar

One rule, stated once and the same in both lanes:

| Input | Pen off | Pen on |
|---|---|---|
| Left click (< 5 px, < 300 ms) | — | pin an anchor / pick an anchor or control point |
| Left drag from empty skin | orbit | **orbit** |
| Left drag from an anchor or control point | — | move it (as today) |
| Right drag | pan | pan |
| Wheel / pinch | zoom | zoom |
| Right click | — | on a control point: re-centre; on an anchor: delete (as today) |
| Middle drag | orbit | orbit |
| One-finger drag (touch) | orbit | orbit; tap pins |
| Two-finger (touch) | zoom + pan | zoom + pan |
| Long-press (touch) | — | the right-click action |

Implementation: stop toggling `controls.enabled`; instead the pen claims the pointer only when
`pickAt()` hits something (it already does — `controls.enabled=false` for the duration of a drag),
and otherwise lets OrbitControls run. The dead 5-px / 300-ms click test in `onPointerUp` becomes
live. OrbitControls' damping must be checked on a stationary click: a zero-length drag with damping
produces no rotation, but confirm in the browser before relying on it.

### 5.2 Framing what is being placed

- **Face this point** (button and key `F`): move the camera so its view direction is the
  surface normal at the selected anchor, landmark or hovered point, keeping the current distance.
  The pose is pure geometry (`scripts/view_geometry.mjs`, §9) and animates through the existing
  `cameraGoal`.
- **Auto-frame on selection**: selecting a landmark row frames that landmark's *expected region*
  — for the eight manual-only points the registry gives a side (L/R) and a level (apex, fold),
  which is enough to choose the preset and a zoom. The person still places the point.
- **Turntable keys** while the pen or landmark tool is on: `←`/`→` orbit 15° about the body's
  vertical, `↑`/`↓` 15° in elevation, with Shift for 5°. The presets stay.

### 5.3 Grazing guard

Compute the incidence angle under the cursor from the raycast hit's face normal (already
available from `surfaceHit`) and show the footprint (`mm/px`, §4.1) in the tip line. Over 60° the
cursor turns amber and the tip says *"turn the body to place this precisely — press F"*; over 75°
the pen still pins (the person may know what they are doing) but the anchor is recorded with its
incidence and footprint (§9), so a coarse point is visible in evidence and the fitter can go back
to it. No threshold decides for the person; both numbers are in the evidence, and the 60°/75°
lines are display thresholds, not a rule that changes a value.

## 6. Smart pen

Snapping moves the anchor. It never changes the run between anchors. Every snap is a *candidate*
with a screen-space distance; the nearest within the pick radius wins, ties broken by a fixed
priority; the chosen snap is shown before the click (a ring around the target) and recorded on the
anchor.

### 6.1 Snap targets, in priority order

1. **First anchor of the active line** — closes the loop (exists today).
2. **An anchor of any finished line** — two lines that should meet, meet exactly. Shared anchors
   are what make two pen loops share a run bit for bit (`pointKey` in `flatten_patch.mjs`), so a
   seam drawn from one outline anchor to another is a seam the joint solve recognises without the
   15 mm end-snap.
3. **A point on a finished line's run** — for a seam end that must sit on the outline. The anchor
   is placed *on the polyline*, which is what `splitLoopBySeam` would have done at Flatten time,
   only now the person sees it. Snapped anchors carry `on_line: <name>`.
4. **A landmark** (prototype: detected or hand-placed; production: detected) — the pen host
   supplies these through a `getSnapTargets()` callback, so `pen_tool.mjs` stays lane-agnostic and
   never reads landmark state itself.
5. **Level** (hold `Shift`): the anchor's height is set to the previous anchor's height, then
   snapped to the skin along the section at that height; the segment is still the shortest path.
   Shown as a thin section ring while Shift is held.
6. **Mirror** (hold `Alt`): the anchor is the mirror image of the last anchor of the selected
   line, snapped to the surface. On this body exact (§4.2); on another, the residual is recorded.

The pick radius stays 15 px. `N` turns snapping off and on (a toggle, shown in the tip, rather than
a held `Ctrl`: on macOS `Ctrl`+click is a right-click).

### 6.2 Surface discipline

The pen's hit test and path grid are built from **all** meshes; the pattern draft flattens the
registry's measurement surface. Proposed: the pen host passes a `surfaces` list (meshes and their
roles from the registry's `expected_materials`), the pen keeps its grid per role, and an anchor
on a non-measurement surface (arm, cut face) is pinned but marked `surface: arms`. The pattern block
then refuses a loop *before* Flatten with the reason ("Line 3 has 2 anchors on the arm") instead
of the leak check's message after it. No behaviour of the measurement engines changes.

### 6.3 Precision editing

- **Nudge**: arrow keys move the selected anchor or control point by one pixel in screen space
  and re-raycast, so a nudge is a sub-footprint correction along the skin; Shift for 10 px.
- **Loupe**: while dragging, a 2× inset of the region under the cursor (a second small render
  target of the same scene). Cheap, and the single biggest help for placing a root end on a fold.
- **Undo / redo** as a command stack in `pen_tool.mjs` (`⌘/Ctrl+Z`, `⌘/Ctrl+Shift+Z`): pin, move, snap,
  delete, close, rename. The stack is shared logic; each lane keeps its buttons.

### 6.4 Mirror a whole line

"Mirror to the other side" on a finished line: every anchor and control point mirrored through
x → −x and snapped to the surface, the runs recomputed. The new line is named `<name> (mirror)`
and its record carries `mirrored_from` and the per-anchor snap residual. If the largest residual
exceeds the authority pass's asymmetry threshold (5 mm), the line is flagged in the list and in
the export: the body is not symmetric there, and someone should look.

## 7. Landmark placement

Prototype lane only. The pipeline after the click — override file, provenance, authority pass,
parity — is done and stays; this section is about the click.

### 7.1 Placing

- **Drag to place, release to commit.** While the pointer is down the marker follows the skin and
  the dependent POMs update live (recompute is already instant), so the fitter sees the tape move
  before letting go. A click without drag behaves as today.
- **Measurement surface only.** `surfaceHitForLandmark` raycasts the torso meshes; a hit on the
  arm is refused with a hint rather than accepted. (A landmark on the arm is never right.)
- **Level landmarks by ring, not click.** For `BUST_LEVEL`, `UNDERBUST_FOLD`, `WAIST_LEVEL` the
  drag moves a horizontal section ring up and down the body (the existing live-section drawing),
  and the height is what is stored — the point clicked was never used for anything else.
- **Symmetric pair helper.** After placing `ROOT_INNER_L`, the row for `ROOT_INNER_R` offers
  *"use mirror of L"*; accepting stores the mirrored point snapped to the surface with source
  `manual_mirrored` and the residual. It is an offer, never automatic, so a real asymmetry is still
  placed by hand — and `measure_avatar.py` treats `manual_mirrored` as `manual` for every purpose
  except the provenance string.
- **Guided sequence.** A *"Place next"* button walks the eight manual-only points in a fixed order
  (HPS L, HPS R, then the three roots L, then R), framing each (§5.2) and showing the registry's
  own `comment` for that landmark as the instruction. The person can skip; skipped points stay
  `needed`.
- **Nudge and loupe** as for the pen (§6.3).

### 7.2 Recording how well a point was placed

Each hand-placed landmark gains a `placed_with` record: incidence angle at the click, footprint
in mm/px, camera distance, method (`click` / `drag` / `nudge` / `mirror`), and the viewer build.
This costs nothing and is the honest version of "placed by hand": a root end placed at 80°
incidence from 1.6 m is a different kind of number from one placed facing at 0.35 m, and today
the file cannot tell them apart. `measure_avatar.py` copies `placed_with` through to the POM
provenance; the POM sheet gains a `placement_quality` note only when a contributing landmark's
footprint exceeded 3 mm/px, phrased as a fact, not a judgement.

### 7.3 What does not change

`landmarks.manual.json` is still the one input file, pinned to the asset SHA, written by the
browser as a download and by no other route. Reset still returns everything to automatic. Nothing
here places a point without a person.

## 8. Template drafts ("auto draft 2D pattern")

### 8.1 Position

`PATTERN_2D_DXF_PLAN.md` §2 says *no automatic seam placement*, and this plan keeps that meaning
while adding templates, because the two are different things. A template does not place the seam
where the geometry says it should go; it places the seam where **bra construction conventionally
puts it** — through the apex, vertically or horizontally — and reports what that costs on this
body. The choice among them, and every anchor's position afterwards, is the person's. The spike
(§4.3) shows why the report is worth having: on this body the horizontal cut halves the seam
error of the vertical one, which nobody would guess by eye.

### 8.2 Contract-declared templates

A new contract file, `contracts/pattern-templates.json`, declares each template as data — the
registry pattern, applied to drafts:

```json
{
  "id": "CUP_2PANEL_HORIZONTAL",
  "label_en": "Cup, two panels, horizontal seam through the apex",
  "side": "L",
  "requires": ["ROOT_TOP_L", "ROOT_OUTER_L", "ROOT_BOTTOM_L", "ROOT_INNER_L", "BUST_APEX_L"],
  "outline": { "closed": true,  "anchors": ["ROOT_TOP_L", "ROOT_OUTER_L", "ROOT_BOTTOM_L", "ROOT_INNER_L"] },
  "seam":    { "closed": false, "anchors": ["ROOT_INNER_L", "BUST_APEX_L", "ROOT_OUTER_L"] },
  "status": "proposal",
  "comment": "A conventional cut, not a recommendation. Seam error is reported per panel; the person chooses."
}
```

Initial set, one per side: `CUP_1PIECE`, `CUP_2PANEL_VERTICAL`, `CUP_2PANEL_HORIZONTAL`, and
`CRADLE_FRONT` (outline `CF_UNDERBUST → SIDE_UNDERBUST → ROOT_OUTER → ROOT_BOTTOM → ROOT_INNER`,
all but the roots automatic). A template whose `requires` includes an unplaced manual-only
landmark shows in the pattern block as **needs ROOT_INNER_L, ROOT_OUTER_L, ROOT_TOP_L** — the same
`blocked_until_manual` discipline the POM table uses — and yields no pieces. A cup template is
therefore unavailable until the roots are placed, which is correct: the roots *are* the cup outline.

### 8.3 What "auto" does in the viewer

*Draft from template* adds the template's lines to the pen as ordinary finished lines named
`<template id>` and pre-selects them as outline and seam in the pattern block; Flatten runs
immediately (~50 ms) and the pieces, seam errors and mismatch appear. With *Compare* on, all
available templates for that side are flattened and listed with their per-panel seam error, the
person picks one, and the others are discarded. Because a template's lines are pen lines, every
tool in §6 applies to them afterwards — drag an anchor, nudge, mirror to the other side.

When a landmark the template depends on moves (drag, §7.1), the template's lines are rebuilt and
the pieces re-flattened live. This is the place the spike's 50 ms matters.

### 8.4 Provenance

The DXF's layer-15 annotation and the JSON evidence gain `template: <id>` and the list of
landmarks used **with their provenance** (`auto` / `manual` / `manual_mirrored`), so a piece
drafted from a template on mirrored roots says exactly that. If the person edits a template line
afterwards, the record says `template: CUP_2PANEL_HORIZONTAL (edited)` and keeps the original
anchors beside the final ones. `DECLARED_LIMITS` gains one line: *"Template seams are conventional
cuts, not a fit recommendation."*

## 9. Architecture — where each piece lives

| Module | New / changed | Lane | Content |
|---|---|---|---|
| `scripts/view_geometry.mjs` | new, pure | shared | footprint (mm/px from distance, FOV, pixel height, incidence), incidence from normal and view direction, camera pose facing a normal at a distance, turntable step |
| `scripts/pen_snap.mjs` | new, pure | shared | snap candidates → best snap: screen-space distance, priority, radius; level and mirror candidate construction; residual |
| `scripts/pen_tool.mjs` | changed | shared | pointer grammar (§5.1), `getSnapTargets()` and `surfaces` options, per-anchor `snap` / `surface` / `placed_with`, nudge, command stack, mirror line, loupe hook (`onDragPreview`) |
| `scripts/pattern_templates.mjs` | new | **prototype only** | resolve a template against landmarks → anchor lists; `requires` check; naming; provenance record |
| `contracts/pattern-templates.json` | new | — | the templates (§8.2) |
| `scripts/landmark_placement.mjs` | new, pure | **prototype only** | guided order, per-landmark framing hint from the registry, `placed_with` construction, mirror offer with residual |
| `digital_bra_fit_model_360.html` | changed | prototype | drag-to-place, ring for level landmarks, Place-next, Face-point, loupe canvas, template controls in the pattern block |
| `viewer/src/main.js` | changed | production | pass `surfaces`; Face-point button; nothing else |
| `scripts/measure_avatar.py` | changed | — | accept `manual_mirrored` and `placed_with`, carry both to provenance |
| `scripts/pattern_draft.mjs` | changed | prototype | `template` in `draftExport`; pre-Flatten surface refusal (§6.2) |

Python ports: **none required.** Templates emit anchors; anchors are recorded; the runs and the
flattening those anchors produce are computed by engines that are already parity-gated. The
`view_geometry` and `pen_snap` modules are interaction logic, not measurement — they change where a
person's point goes, which is then measured by the gated engines.

## 10. Evidence

New or extended records, all pinned to the asset SHA and deterministic (no timestamps beyond
`generated_at`, so the PR evidence-drift check stays quiet):

- `draft-lines.json` (pen export, both lanes): per anchor `snap` (`{ to, kind, residual_mm }` or
  null), `surface` (role), `placed_with`; per line `mirrored_from`, `asymmetry_flag`.
- `landmarks.manual.json`: per landmark `placed_with`; source `manual_mirrored` where used.
- `pattern-draft.json` (viewer export) and `flatten-draft.dxf` layer 15: `template`, landmarks
  used with provenance.
- `qa/avatar_master/view-geometry-test.json`, `pen-snap-test.json`,
  `pattern-templates.json`: the gates' evidence (§11).

## 11. Validation plan

| Gate | What it proves | Tolerance / basis |
|---|---|---|
| `validate:view-geometry` (new, Node) | footprint against the analytic `2d·tan(fov/2)/H / cos θ` for a table of cases; incidence symmetric and in [0°, 90°]; the pose facing a normal has view direction = −normal to 1e-9 and keeps distance; turntable steps compose to the identity after 24 × 15° | exact maths, 1e-9 |
| `validate:pen-snap` (new, Node) | for a fixture of targets and cursor positions: the nearest-in-radius wins, priority breaks ties, nothing outside the radius snaps, `Ctrl` disables, level and mirror candidates land on the surface (closest-point residual 0 on the cylinder fixture; recorded on the avatar) | screen 15 px; residual recorded, not budgeted |
| `validate:pattern-templates` (new, Node) | every template in the contract, resolved against a **declared fixture** landmark set (the spike's synthesised roots, labelled as such), yields sound pieces (0 fold-overs, converged) with shared-seam mismatch ≤ 3.175 mm; the anchor lists are byte-identical run to run (SHA recorded); a template with a missing requirement reports `needs …`, never a number | seam tolerance as `validate:seam-closure` |
| `validate:lane-parity` (extended) | production lane imports neither `pattern_templates.mjs` nor `landmark_placement.mjs`; both lanes reach `pen_snap` and `view_geometry` only through the shared pen / their own import and reimplement neither (function-name scan as today) | static |
| `validate:measure-parity` (unchanged) | `manual_mirrored` landmarks produce the same POM values in both engines as `manual` ones with the same coordinates | 0.5 mm as today |
| Browser smoke (manual, recorded in the plan) | with the pen on: drag orbits, click pins, `F` faces the point, Shift-level and Alt-mirror snap and show their ring; a landmark drag updates POMs live; a template flattens live under a moving root | checklist, not a number |

What no gate can prove: that a fitter places a root more accurately with the loupe than without.
That is a usability claim and stays a claim until someone compares two sessions; the `placed_with`
record (§7.2) is what would make such a comparison possible later.

## 12. Open decisions

1. **Pick radius in pixels or millimetres?** 15 px is 13 mm facing at default framing and 3 mm
   zoomed in. A millimetre radius would be constant on the body but tiny at default zoom.
   Recommendation: pixels for hit-testing (it is a pointing problem), and record the footprint so
   the record says what the radius meant.
2. **Mirror on a scanned body.** Offer always, flag over 5 mm residual (recommended, consistent
   with the asymmetry report), or refuse over a threshold? Refusing would be a rule deciding for
   the person.
3. **Template set.** The four proposed are conventional; a TD should confirm the list and the
   naming before they are declared in the contract. Adding one later is a data edit.
4. **Grazing display thresholds** 60° / 75°: display only, but the numbers should be agreed so the
   tip line means the same thing to everyone.
5. **Loupe rendering cost** on low-end machines: a second render of the full scene per frame while
   dragging. Alternative: render only the torso at reduced quality into the inset.

## 13. Phases (proposed)

- **Phase A — orbit while drafting + grazing guard.** `view_geometry.mjs`, pointer grammar in
  `pen_tool.mjs`, Face-point in both lanes, footprint/incidence in the tip and on anchors,
  `validate:view-geometry`. Acceptance: draw a closed loop around the whole torso without leaving
  the pen; every anchor in the export carries incidence and footprint.
- **Phase B — smart pen.** `pen_snap.mjs`, snap targets 1–6, surface roles, nudge, undo/redo,
  mirror line, loupe, `validate:pen-snap`, lane-parity extension. Acceptance: a seam drawn from
  outline anchor to outline anchor flattens with the joint solve recognising the shared run
  without the end-snap; mirrored line residual 0.000 mm on this asset, recorded.
- **Phase C — landmark placement.** Drag-to-place, ring for levels, guided sequence, mirror offer,
  `placed_with`, `measure_avatar.py` provenance, measure-parity still 0 difference. Acceptance: the
  eight manual-only points placed in one guided pass with no manual camera work; the saved file
  says how each was placed.
- **Phase D — template drafts.** Contract, `pattern_templates.mjs`, Draft-from-template and
  Compare in the pattern block, live re-flatten on landmark drag, provenance in DXF and JSON,
  `validate:pattern-templates`. Acceptance: on the fixture roots, the three cup templates report
  the §4.3 numbers; on the real body, cup templates read `needs …` until the roots are placed.

A and B change the shared pen and so touch both lanes; C and D are prototype-only. Each phase ends
with `npm run validate:measurements` green and the evidence-drift check quiet. The key map every
phase binds into is §14; the file-by-file work plan with acceptance criteria is §15.

---

## 14. Keyboard and pointer map

One source: `scripts/keymap.mjs` exports the table below as data (`KEYMAP`), both lanes dispatch
through it, the `?` overlay is generated from it, and `validate:keymap` (§15, A2) checks that the
table here matches the code — the map is looked up, not remembered.

Rules the map follows:

- **Single keys for what is done most**; a held modifier only for snaps; `Shift`+letter only for
  actions that produce a file or run a solve; the platform modifier (`⌘` on macOS, `Ctrl`
  elsewhere) only for undo/redo. Nothing binds a browser-owned combination (`⌘/Ctrl` + S, P, W,
  N, T, L, D, F, R, H, J, K, O, U, Q, E).
- **Arrows act on the selection.** A selected anchor, control point or landmark is nudged;
  nothing selected, the camera turns. `Esc` clears the selection, so arrows fall back to the camera.
- **Contexts are exclusive tools** (`pen`, `landmarks`, `pattern`) over an `always` layer. A tool
  may reuse a key another tool uses (`M`, `[`, `]`) because only one tool holds the canvas at a
  time — landmark selection already suspends the pen. A tool may not shadow an `always` key.
- **No key fires in a text field** (`isTextEntry`, already in the pen, moves to the keymap).
- `?` shows the sheet for the contexts currently active; `Esc` closes it.

### Always

| Key | Action |
|---|---|
| `P` | Pen on / off |
| `L` | Landmarks panel on / off *(prototype)* |
| `T` | Tape lines on / off |
| `X` | Section tool on / off |
| `1` `2` `3` `4` | Front · three-quarter · side · back |
| `0` / `Home` | Reset view (frame the body) |
| `←` `→` | Turntable ±15° about the body's vertical (`Shift`: 5°) — nothing selected |
| `↑` `↓` | Elevation ±15° (`Shift`: 5°) — nothing selected |
| `F` | Face the selected point along its surface normal; nothing selected, the point under the cursor |
| `Z` | Loupe on / off |
| `N` | Snapping on / off |
| `?` | Shortcut sheet |
| `Esc` | Deselect; nothing selected → leave the current tool; sheet open → close it |

### Pen (pointer grammar in §5.1)

| Key | Action |
|---|---|
| `Enter` | Finish the line |
| `C` | Close the loop and finish (≥ 3 anchors) |
| `Backspace` / `Delete` | Delete the selected point; nothing selected → undo the last pinned point |
| `⌘/Ctrl+Z` · `⌘/Ctrl+Shift+Z` | Undo · redo (pin, move, snap, delete, close, rename, mirror) |
| `←` `→` `↑` `↓` with a point selected | Nudge 1 px along the skin (`Shift`: 10 px) |
| hold `Shift` while pinning | Level snap: same height as the previous anchor |
| hold `Alt` while pinning | Mirror snap: mirror of the selected line's last anchor |
| `R` | Re-centre the control points of the selected segment (whole line if none) |
| `M` | Mirror the selected line to the other side |
| `[` `]` | Select previous / next line |
| `I` | Show / hide the selected line's on-body label |
| `Shift+E` | Export `draft-lines.json` |

### Landmarks *(prototype)*

| Key | Action |
|---|---|
| `Space` | Place next: select the next `needed` landmark in the guided order and frame it |
| `[` `]` | Previous / next landmark row |
| click · drag | Place · place with live preview, release commits |
| `←` `→` `↑` `↓` | Nudge the selected landmark 1 px along the skin (`Shift`: 10 px) |
| `M` | Accept the mirror of the opposite side for the selected row (offer, recorded `manual_mirrored`) |
| `Backspace` | Return the selected landmark to automatic |
| `Shift+S` | Save `landmarks.manual.json` |
| `Esc` | Cancel placement (keeps the row selected); again → deselect |

### Pattern block *(prototype)*

| Key | Action |
|---|---|
| `Shift+F` | Flatten |
| `Shift+D` | Export DXF |
| `Shift+T` | Draft from template — opens the chooser; inside it `1`–`9` pick, `Esc` closes |
| `Shift+C` | Compare all available templates for the selected side |

Known platform caveats, to be checked in the browser and recorded in the phase's smoke list:
a bare `Alt` key-up opens the menu bar in Firefox on Windows (mitigation: `preventDefault` on the
`Alt` key-up while the pen is on); `Space` scrolls the page unless prevented while the canvas has
focus; `Ctrl`+click is a right-click on macOS, which is why no snap uses `Ctrl`.

## 15. Work plan

Four pull requests, one per phase, each merged through the Gates workflow. Every phase ends with
`npm run validate:measurements` green, the evidence-drift check quiet, both lanes smoke-tested in
the browser, and the docs (this plan's status line, `CLAUDE.md` commands, `README.md` gate list)
updated in the same PR. Function names below are the intended public surface; internals are the
implementer's.

### Phase A — orbit while drafting, grazing guard, shortcuts

**A1 `scripts/view_geometry.mjs` (new, pure, shared).**
`footprintMmPerPx({ distance_m, fov_deg, pixel_height, incidence_rad })`;
`incidence(normal, viewDir)` → radians in [0, π/2];
`poseFacing({ point, normal, distance_m, up })` → `{ position, target }` with view direction
= −normal (falls back to a tilted pose when the normal is within 5° of `up`, so the camera never
looks straight down the body axis);
`turntable(pose, { yaw_rad, pitch_rad, polar_limits })` → new pose about the target;
`framing(bounds, { fov_deg, aspect, margin })` → distance (what `setView` computes today, moved
here so both lanes share it).
Test `scripts/test_view_geometry.mjs` → `qa/avatar_master/view-geometry-test.json`: analytic
footprint table (§4.1 values reproduced), incidence symmetry and range, pose direction to 1e-9 and
distance preserved, 24 × 15° yaw composes to the identity, polar limits respected.

**A2 `scripts/keymap.mjs` (new, pure, shared).**
`KEYMAP`: `[{ id, keys, context, label, hold?, needsSelection?, producesFile? }]`;
`matchBinding(event, { contexts, hasSelection, platform })` → binding or null;
`cheatSheet(contexts)` → rows for the overlay; `isTextEntry(node)` (moved from the pen);
`PLATFORM_MOD` resolved once from `navigator.platform`.
Test `scripts/test_keymap.mjs` → `qa/avatar_master/keymap-test.json`: no two bindings share
`(key, modifiers)` within one exclusive context or between a tool and `always`; every binding has
a label; no browser-reserved combo; the §14 tables regenerate byte-for-byte from `KEYMAP`
(the doc is checked, not trusted).

**A3 `scripts/pen_tool.mjs` (changed, shared).**
Stop toggling `controls.enabled` in `setEnabled`; claim the pointer only when `pickAt()` hits
(as the drag path already does) and on a click that passes the 5 px / 300 ms test — the test in
`onPointerUp` becomes live. `setSuspended` unchanged in meaning. Each anchor gains
`placed_with: { incidence_deg, footprint_mm_px, distance_m, method }` computed from the hit normal
and the camera at pin time; `lineGeometry`, `toExport` and `summary` carry it. New options:
`onHover({ incidence_deg, footprint_mm_px })` for the host's tip line; new methods `face()` →
pose for the selected or hovered point (via `poseFacing`), `select(index)`, `selectedPoint()`.
Key handling moves out of the pen into the host dispatcher (A4); the pen exposes the actions
(`finishLine`, `closeLoop`, `deleteSelected`, `undoPoint`) and nothing else about keys.

**A4 Hosts.** `digital_bra_fit_model_360.html` and `viewer/src/main.js`: one `keydown` dispatcher
on `window` → `matchBinding` → action table; `?` overlay from `cheatSheet`; tip shows footprint
and turns amber past 60° and red past 75° (display only); *Face* button next to the presets;
arrows drive `cameraGoal` through `turntable`; `Esc` layering per §14. Touch: verify tap pins and
one-finger drag orbits with the pen on; two-finger zoom/pan is OrbitControls' own.

**A5 `scripts/test_lane_parity.mjs`.** Both lanes import `view_geometry.mjs` and `keymap.mjs`;
neither redefines their exported names; the pen still reimplements no path model.

**A6 Evidence.** `draft-lines.json` schema 2: `placed_with` per anchor. `validate:measurements`
gains `validate:view-geometry` and `validate:keymap`.

**Acceptance.** With the pen on: a closed loop around the entire torso is drawn without leaving
the pen; every anchor in the export carries incidence and footprint; `F` on the outer root region
brings the incidence there under 10°; `?` lists exactly the §14 rows for `always` + `pen`; the
production lane behaves identically for everything not marked *prototype*.

**Risks to test first.** OrbitControls damping on a zero-length click (expected: no rotation;
if it jitters, disable controls between `pointerdown` and the click decision, never for the whole
mode). `Alt` on Firefox/Windows. `Space` page scroll.

### Phase B — smart pen

**B1 `scripts/pen_snap.mjs` (new, pure, shared).**
`SNAP_PRIORITY` (first anchor › other line's anchor › point on a line › landmark › level › mirror);
`projectTargets(targets, camera, rect)` → screen-space list;
`resolveSnap({ cursor_px, candidates, radius_px, enabled })` → best or null, deterministic
tie-break by priority then insertion order;
`levelCandidate({ previous, hit, section })` → the point on the skin at the previous anchor's
height nearest the hit, via a `section(y)` function the host supplies;
`mirrorCandidate({ source, closest })` → mirrored point snapped to the surface with `residual_m`;
`nearestOnPolyline(points, q)`.
Test `scripts/test_pen_snap.mjs` → `qa/avatar_master/pen-snap-test.json`: radius, priority,
disabled snapping, level and mirror candidates on the cylinder fixture (residual 0) and on the
avatar (residual recorded, 0.000 mm expected on this asset).

**B2 `scripts/pen_tool.mjs`.** Options `getSnapTargets()` (host-supplied, may return landmarks)
and `surfaces: [{ root, role }]` (per-role triangle sets and grids; the hit reports its role).
Anchors gain `snap` and `surface`. A snap ring is drawn at the candidate before the click.
Nudge: `nudgeSelected(dx_px, dy_px)` re-raycasts one pixel over. Command stack: `history` with
`execute / undo / redo`; commands `pin`, `move`, `setHandle`, `resetHandles`, `delete`, `close`,
`rename`, `addLine`, `mirrorLine`, `deleteLine`; `undoPoint` becomes `undo` of the last `pin`.
`mirrorLine(index)` → new line `<name> (mirror)` with `mirrored_from`, per-anchor residual,
`asymmetry_flag` past 5 mm. `onDragPreview(rect_px)` fires while dragging so the host can draw
the loupe.

**B3 Hosts.** Loupe: a second render of the scene into a small inset with a narrow-FOV camera at
the same pose (`renderer.setScissor` on the same renderer; measure frame time, fall back to
torso-only rendering if over 8 ms). Prototype supplies landmarks as snap targets; production
supplies none. `surfaces` come from the registry's `expected_materials` in both lanes — the
production lane still hardcodes no material name. `pattern_draft.mjs`: `draftPieces` refuses an
outline with anchors whose `surface !== 'torso'` and names them.

**B4 `scripts/test_lane_parity.mjs`.** `pen_snap.mjs` reached only through the pen; no snap
function redefined in either lane; production's `surfaces` derived from the registry object,
not literals.

**Acceptance.** A seam pinned from one outline anchor to another flattens with the joint solve
recognising the shared run with `end_gaps_m` of exactly 0; a mirrored loop on this asset reports
0.000 mm residual and flattens to the same seam error as its source to 0.01 mm; nudging an anchor
ten times and back returns the line length to within the continuity budget of
`validate:surface-path` (0.2 mm); undo of every command restores `lineGeometry` byte for byte.

### Phase C — landmark placement *(prototype only)*

**C1 `scripts/landmark_placement.mjs` (new, pure).**
`GUIDED_ORDER` (HPS L, HPS R, ROOT_INNER/OUTER/TOP L, then R);
`nextNeeded(rows, overrides)`; `framingFor(id, { landmarks, registry })` → preset + zoom +
target region from side and level; `placedWith(hit, camera, method)`;
`mirrorOffer(id, overrides, closest, flag_mm = 5)` → `{ point, residual_mm, flagged }` or null;
`levelFromRing(y)`.
Test `scripts/test_landmark_placement.mjs` → `qa/avatar_master/landmark-placement-test.json`:
order, next-needed, framing for all 21 registry landmarks, mirror offer on the avatar.

**C2 `digital_bra_fit_model_360.html`.** Drag-to-place with live marker and live POMs
(`recomputeMeasurements` is already incremental); raycast against torso meshes only
(`roleMeshes.torso`); level landmarks by dragging the section ring; *Place next* (`Space`) with
framing through `cameraGoal`; mirror offer as a row button and `M`; `placed_with` and
`source: 'manual_mirrored'` written into `overrides`; an "unsaved changes" mark on the Save
button; `Shift+S` saves.

**C3 Both engines.** `applyLandmarkOverrides` (JS) and the override reader in
`scripts/measure_avatar.py` record `source` as `manual_mirrored` when the override says so
(otherwise `manual`, as now) and carry `placed_with` into the landmark provenance; POM provenance
strings unchanged (`manual` / `derived_from_manual`), so nothing downstream changes meaning.
`test_measurement_parity.mjs` asserts the provenance strings agree. `export_pom_sheet` adds a
`placement_quality` note listing landmarks placed at over 3 mm/px, as a fact.

**C4 `scripts/test_lane_parity.mjs`.** Production imports neither `landmark_placement.mjs` nor
anything from the landmark panel.

**Acceptance.** The eight manual-only points placed in one guided pass with no manual camera
work; each entry in the saved file carries `placed_with`; a mirrored root produces the identical
POM value in both engines (parity 0 difference on that row) with source `manual_mirrored`;
Reset returns everything to automatic as today.

### Phase D — template drafts *(prototype only)*

**D1 `contracts/pattern-templates.json`.** The four templates of §8.2 per side, `status:
"proposal"`, with `label_en` and `comment`; `schema_version`, and a pointer to the registry ids
it depends on.

**D2 `scripts/pattern_templates.mjs` (new).**
`loadTemplates(json)` with validation (every anchor id exists in the registry; a closed outline
has ≥ 3 anchors; a seam's ends are outline anchors);
`resolveTemplate(template, landmarks)` → `{ outline: [xyz…], seam: [xyz…] | null }` or
`{ needs: [ids] }`;
`templatesFor(side, landmarks, templates)` → available / blocked lists;
`templateRecord(template, landmarks, provenance, edited)` → what goes into evidence and layer 15.

**D3 Gate `scripts/test_pattern_templates.mjs`** with
`scripts/pattern_template_fixture_landmarks.json` (the spike's synthesised roots, declared
`fixture: true`, never read by the viewer) → `qa/avatar_master/pattern-templates-test.json`:
every template resolves, flattens sound, shared-seam mismatch ≤ 3.175 mm; anchor lists hash
identically run to run; a template missing a requirement returns `needs` and no geometry; the
§4.3 numbers are reproduced to 0.01 mm.

**D4 Viewer.** In the pattern block: *Draft from template* (`Shift+T`) adds the template's lines
through `pen.addLine` with `origin: { template, landmarks }` and pre-selects them; *Compare*
(`Shift+C`) flattens every available template and lists per-panel seam error and mismatch;
choosing one keeps its lines and discards the rest. On a landmark drag, template lines are
rebuilt and re-flattened on the next animation frame (budget 100 ms; if exceeded, defer to
release). `draftExport` gains `template`; `dxf_pieces` writes it to layer 15; `DECLARED_LIMITS`
gains the template line from §8.4.

**D5 `scripts/test_lane_parity.mjs`.** Production imports neither `pattern_templates.mjs` nor
the templates contract.

**Acceptance.** On the fixture roots, the three cup templates report §4.3; on the real body all
cup templates read `needs ROOT_INNER_L, …` until the roots are placed and become available the
moment they are; a template-drafted DXF's layer 15 names the template and every landmark's
provenance; editing a template anchor turns the record to `(edited)` and keeps the originals.

### Sequencing and size

| Phase | Depends on | New gates | Lanes touched | Rough size |
|---|---|---|---|---|
| A | — | view-geometry, keymap | both | 2 modules, 2 tests, pen + 2 hosts |
| B | A | pen-snap | both | 1 module, 1 test, pen + 2 hosts, pattern_draft |
| C | A (framing, keymap) | landmark-placement | prototype + both engines | 1 module, 1 test, HTML, py + mjs provenance |
| D | B (shared anchors), C (roots) | pattern-templates | prototype | contract, 1 module, 1 fixture, 1 test, HTML |

C and D are independent of B's loupe and undo stack but need A. B and C can run in parallel
after A. `validate:measurements` ends at twelve gates; the chain order stays sync → measure →
engine gates → interaction gates → lane parity last, since lane parity reads every other module.
