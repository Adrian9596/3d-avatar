"""Create the first MPFB body candidate for Stage 1.

This creates a traceable DRAFT asset only. It does not claim 36C measurement
accuracy, TD approval, final morphs, garment fit, or production readiness.
Run with Blender, not the system Python interpreter.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
BLEND_PATH = ROOT / "avatar_36C_master.blend"
REPORT_PATH = ROOT / "qa" / "avatar_36C" / "mpfb-draft-report.json"


def clear_scene() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.materials):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def configure_scene() -> None:
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0

    # MPFB New Human properties. These values create a neutral female draft,
    # not a validated 36C body. The approved measurement fit happens later.
    scene.MPFB_NH_scale_factor = "METER"
    scene.MPFB_NH_add_phenotype = True
    scene.MPFB_NH_phenotype_gender = "female"
    scene.MPFB_NH_phenotype_age = "young"
    scene.MPFB_NH_phenotype_muscle = "averagemuscle"
    scene.MPFB_NH_phenotype_weight = "averageweight"
    scene.MPFB_NH_phenotype_height = "average"
    scene.MPFB_NH_phenotype_proportions = "average"
    scene.MPFB_NH_phenotype_race = "universal"
    scene.MPFB_NH_phenotype_influence = 1.0
    scene.MPFB_NH_add_breast = True
    scene.MPFB_NH_phenotype_breastsize = "maxcup"
    scene.MPFB_NH_phenotype_breastfirmness = "maxfirmness"
    scene.MPFB_NH_breast_influence = 0.25
    scene.MPFB_NH_detailed_helpers = True
    scene.MPFB_NH_extra_vertex_groups = True
    scene.MPFB_NH_mask_helpers = True
    scene.MPFB_NH_preselect_group = "body"


def create_human() -> bpy.types.Object:
    result = bpy.ops.mpfb.create_human()
    if "FINISHED" not in result:
        raise RuntimeError(f"MPFB create_human failed: {result}")

    obj = bpy.context.active_object
    if obj is None or obj.type != "MESH":
        raise RuntimeError("MPFB did not leave a mesh object active")
    if obj.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def mark_draft(obj: bpy.types.Object) -> None:
    obj.name = "avatar_36C_body_DRAFT"
    obj.data.name = "avatar_36C_body_mesh_DRAFT"
    obj["asset_id"] = "avatar_36C"
    obj["asset_status"] = "DRAFT_NOT_TD_VALIDATED"
    obj["source_generator"] = "MPFB"
    obj["source_generator_version"] = "2.0.17"
    obj["source_generator_build"] = "20260722"
    obj["measurement_authority"] = "BLOCKED_TD_SOURCE_REQUIRED"
    obj["canonical_unit"] = "meter"
    obj["source_front_axis"] = "-Y"
    obj["source_up_axis"] = "+Z"
    obj["export_front_axis"] = "+Z"
    obj["export_up_axis"] = "+Y"


def report(obj: bpy.types.Object) -> dict:
    mesh = obj.data
    shape_keys = []
    if mesh.shape_keys:
        shape_keys = [block.name for block in mesh.shape_keys.key_blocks]

    dimensions = [round(value, 6) for value in obj.dimensions]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "blender_version": bpy.app.version_string,
        "mpfb_version": "2.0.17",
        "mpfb_build": "20260722",
        "object": obj.name,
        "mesh": mesh.name,
        "vertices": len(mesh.vertices),
        "edges": len(mesh.edges),
        "polygons": len(mesh.polygons),
        "triangles_estimate": sum(max(1, len(poly.vertices) - 2) for poly in mesh.polygons),
        "dimensions_xyz_m": dimensions,
        "location_xyz": [round(value, 6) for value in obj.location],
        "rotation_xyz": [round(value, 6) for value in obj.rotation_euler],
        "scale_xyz": [round(value, 6) for value in obj.scale],
        "shape_key_count": len(shape_keys),
        "shape_key_names": shape_keys,
        "vertex_group_count": len(obj.vertex_groups),
        "material_count": len(mesh.materials),
        "warning": "Approximate MPFB candidate only; 36C measurement authority is unresolved.",
    }


def main() -> None:
    clear_scene()
    configure_scene()
    body = create_human()
    mark_draft(body)

    bpy.context.scene["project_asset_status"] = "DRAFT_NOT_TD_VALIDATED"
    bpy.context.scene["project_gate"] = "STAGE_1_BLOCKED_MEASUREMENT_AUTHORITY"

    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), check_existing=False)

    payload = report(body)
    REPORT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print("MPFB_DRAFT_REPORT=" + json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
