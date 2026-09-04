import bpy
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "avatar_36C_master.blend"
REPORT = ROOT / "qa" / "avatar_36C" / "ground-alignment-report.json"
TOLERANCE_METERS = 0.001
RIGID_GROUP_NAMES = ("avatar_36C_bikini_top", "avatar_36C_bikini_brief")


def basis_min_z(body):
    """Basis shape-key layer only. NOT the rendered/exported shape when other
    shape keys have non-zero values - kept only for report visibility, never
    used to decide the shift or pass/fail (see Checklist - Fix Ground
    Alignment Evaluated-Mesh Bug.md)."""
    if body.data.shape_keys:
        points = body.data.shape_keys.key_blocks[0].data
    else:
        points = body.data.vertices
    return min((body.matrix_world @ point.co).z for point in points)


def evaluated_min_z(body):
    """The body has active MPFB macro shape keys blended on top of Basis at
    render/export time; Blender never applies that blend to
    body.data.vertices or key_blocks[0]. Only the depsgraph-evaluated mesh
    (what export_prototype_glb.py and the browser viewer already use)
    reflects the true rendered/exported shape."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated_obj = body.evaluated_get(depsgraph)
    evaluated_mesh = evaluated_obj.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    z = min((body.matrix_world @ v.co).z for v in evaluated_mesh.vertices)
    evaluated_obj.to_mesh_clear()
    return z


def main():
    meshes = [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and (obj.get("object_role") == "BODY" or ("body" in obj.name.lower() and not obj.get("garment_role")))
    ]
    if len(meshes) != 1:
        raise RuntimeError(f"Expected exactly one draft body mesh, found {len(meshes)}")

    body = meshes[0]
    rigid_group = [body] + [obj for obj in (bpy.data.objects.get(name) for name in RIGID_GROUP_NAMES) if obj]

    before_basis_min_z = basis_min_z(body)
    before_evaluated_min_z = evaluated_min_z(body)
    shift_z = -before_evaluated_min_z

    # Shift the whole body+garment ensemble via object transform, not by
    # editing the body's shape-key vertex data. apply_aesthetic_bikini_draft.py
    # selects bikini faces using hardcoded ABSOLUTE Z thresholds
    # (see top_face/brief_face) calibrated to the body's current position;
    # editing body-local shape-key coordinates would silently invalidate
    # those thresholds and the already-resolved penetration fit
    # (resolve_bikini_penetration.py). A rigid translation of every object in
    # the ensemble by the same amount preserves all existing relative
    # body-garment fit exactly, while still correctly grounding the whole
    # rendered/exported result.
    for obj in rigid_group:
        obj.location.z += shift_z

    bpy.context.view_layer.update()
    after_basis_min_z = basis_min_z(body)
    after_evaluated_min_z = evaluated_min_z(body)
    body["ground_alignment_meters"] = shift_z
    body["ground_alignment_tolerance_meters"] = TOLERANCE_METERS
    body["ground_alignment_method"] = "RIGID_OBJECT_TRANSLATION_BODY_AND_GARMENTS"
    body["ground_alignment_verified_against"] = "EVALUATED_DEPSGRAPH_MESH_NOT_BASIS"
    bpy.context.scene["draft_ground_alignment"] = "BASE_POSE_ONLY_REQUIRES_FINAL_MORPH_QA"
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "object": body.name,
        "rigid_group_shifted": [obj.name for obj in rigid_group],
        "measurement_method": "depsgraph-evaluated mesh (body.evaluated_get) - the Basis-only layer does not reflect this body's active macro shape keys, see Checklist - Fix Ground Alignment Evaluated-Mesh Bug.md",
        "shift_method": "rigid object.location.z translation of body + bikini top + bikini brief together, not shape-key vertex editing - preserves existing bikini fit/penetration resolution and apply_aesthetic_bikini_draft.py's hardcoded Z thresholds unchanged",
        "before_evaluated_min_z_meters": before_evaluated_min_z,
        "applied_shift_z_meters": shift_z,
        "after_evaluated_min_z_meters": after_evaluated_min_z,
        "base_pose_within_1mm": abs(after_evaluated_min_z) <= TOLERANCE_METERS,
        "before_basis_min_z_meters": before_basis_min_z,
        "after_basis_min_z_meters": after_basis_min_z,
        "basis_vs_evaluated_note": "basis_min_z is logged for visibility only and was NOT used to compute the shift or the pass/fail decision; it is not reproducible across sessions in this MPFB setup and must never be trusted alone.",
        "scope": "Body and both bikini garments translated by the identical shift_z; all shape-key deltas and garment-to-body fit are unchanged.",
        "warning": "Required six morph extremes do not exist yet and still require ground-contact QA.",
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("GROUND_ALIGNMENT_REPORT=" + json.dumps(report, separators=(",", ":")))


if __name__ == "__main__":
    main()
