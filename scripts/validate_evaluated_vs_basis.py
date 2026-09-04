"""Permanent regression guard for the ground-alignment bug fixed 2026-08-14.

This body has active MPFB macro shape keys - Blender only applies their
blend to the depsgraph-EVALUATED mesh, never to body.data.vertices or
key_blocks[0] (Basis) directly. scripts/align_draft_ground.py used to
measure and verify ground alignment against Basis alone, so it could report
success while the actual rendered/exported floor sat 2.6677cm off the
ground. The PRIMARY check here is the real invariant that matters: is the
EVALUATED mesh's floor actually at Y=0 right now. Basis vs. evaluated will
ALWAYS diverge for as long as the macro shape keys have non-zero values -
that is expected and NOT itself a failure; it is reported only so nobody
mistakes a raw vertex.co read for ground truth again. See
Checklist - Fix Ground Alignment Evaluated-Mesh Bug.md.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "qa" / "avatar_36C" / "evaluated-vs-basis-report.json"
TOLERANCE_METERS = 0.001


def find_body():
    meshes = [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and (obj.get("object_role") == "BODY" or ("body" in obj.name.lower() and not obj.get("garment_role")))
    ]
    if len(meshes) != 1:
        raise RuntimeError(f"Expected exactly one draft body mesh, found {len(meshes)}")
    return meshes[0]


def basis_min_max_z(body):
    if body.data.shape_keys:
        points = body.data.shape_keys.key_blocks[0].data
    else:
        points = body.data.vertices
    zs = [(body.matrix_world @ p.co).z for p in points]
    return min(zs), max(zs)


def evaluated_min_max_z(body):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated_obj = body.evaluated_get(depsgraph)
    evaluated_mesh = evaluated_obj.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    zs = [(body.matrix_world @ v.co).z for v in evaluated_mesh.vertices]
    evaluated_obj.to_mesh_clear()
    return min(zs), max(zs)


def main():
    body = find_body()
    basis_min, basis_max = basis_min_max_z(body)
    eval_min, eval_max = evaluated_min_max_z(body)

    ground_alignment_ok = abs(eval_min) <= TOLERANCE_METERS
    basis_evaluated_gap_meters = max(abs(eval_min - basis_min), abs(eval_max - basis_max))

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "purpose": "Regression guard for the ground-alignment bug fixed 2026-08-14 - re-verifies the body's EVALUATED floor is actually at 0, independent of whatever any other script's own report claims.",
        "basis_min_max_z_meters": [basis_min, basis_max],
        "evaluated_min_max_z_meters": [eval_min, eval_max],
        "basis_evaluated_gap_meters": basis_evaluated_gap_meters,
        "tolerance_meters": TOLERANCE_METERS,
        "checks": {
            "ground_alignment_ok": ground_alignment_ok,
        },
        "result": "PASS" if ground_alignment_ok else "FAIL_NOT_GROUNDED",
        "note": (
            f"basis_evaluated_gap_meters={basis_evaluated_gap_meters:.5f} is EXPECTED to be non-zero "
            "as long as this body's macro shape keys have non-zero values - that alone is not a failure. "
            "Any script that reads body.data.vertices/key_blocks[0] for a POSITION-based measurement "
            "(not just topology counts) must use body.evaluated_get(depsgraph) instead, or it will "
            "silently disagree with what is actually rendered/exported."
        ),
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("EVALUATED_VS_BASIS_REPORT=" + json.dumps(report, separators=(",", ":")))
    if not ground_alignment_ok:
        raise SystemExit(f"FAIL: evaluated floor is at {eval_min:.5f}m, not within {TOLERANCE_METERS}m of 0.")


if __name__ == "__main__":
    main()
