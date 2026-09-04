# Scripts — conventions

## Reading `avatar_36C_body_DRAFT`'s position

This body has active MPFB macro shape keys (age/weight/muscle/breast size, etc. — see `create_mpfb_draft.py`). Blender only applies their blend to the **depsgraph-evaluated** mesh; it never touches `body.data.vertices` or `shape_keys.key_blocks[0]` (Basis) directly. Reading either of those for a *position*-based measurement or verification will silently disagree with what is actually rendered and exported — this caused a real bug where `align_draft_ground.py` reported successful ground alignment while the true (evaluated/exported) floor sat 2.6677cm off the ground. Full writeup: `../Checklist — Fix Ground Alignment Evaluated-Mesh Bug.md`.

**Rule:** any script that reads a vertex *position* on this body (height, a landmark, a bounding box, a circumference — anything spatial, not a topology count like vertex/polygon totals) must use `body.evaluated_get(depsgraph)` → `to_mesh(...)`, never `body.data.vertices` or `body.data.shape_keys.key_blocks[...]` directly.

Two further gotchas discovered while fixing this, in case you hit them again:

- **Rig/joint marker groups (`joint-l-shoulder`, etc.) are missing from the normal evaluated mesh.** MPFB's "Hide helpers" MASK modifier drops everything not in the `body` surface vertex group — that includes joint markers, not just hair/teeth/eyes. If you need a joint-group position, temporarily disable that modifier (`show_viewport`/`show_render`), re-evaluate, then restore it — see `unmasked_evaluated_mesh()` in `measure_master_body.py`. Don't use the unmasked mesh for anything that IS part of the visible body surface (scalp, nipple, etc.) — it will pick up now-visible helper geometry that was never grounded and isn't part of the body.
- **`BVHTree.FromObject(body, depsgraph)` builds its tree in the body's LOCAL space, not world space.** Any query point must be transformed into that local space first (`body.matrix_world.inverted() @ point`) or results silently disagree by whatever translation `body.matrix_world` currently has. This was invisible while the body's transform was identity; it is not identity after the ground-alignment fix (a rigid `object.location` translation, chosen specifically to avoid invalidating `apply_aesthetic_bikini_draft.py`'s hardcoded absolute-Z bikini-shape thresholds). See the fix in `validate_bikini_draft.py`/`resolve_bikini_penetration.py`.

To re-check the current ground-alignment invariant at any time: `npm run validate:ground-alignment`.
