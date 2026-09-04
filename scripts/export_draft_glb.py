"""Prepare and export the MPFB draft as a self-contained GLB.

The resulting file proves the tool/export pipeline only. It remains
DRAFT_NOT_TD_VALIDATED and is not the Stage 1 final asset.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
BLEND_PATH = ROOT / "avatar_36C_master.blend"
GLB_PATH = ROOT / "assets" / "export" / "avatar_36C.glb"
REPORT_PATH = ROOT / "qa" / "avatar_36C" / "glb-draft-export-report.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def body_object() -> bpy.types.Object:
    candidates = [
        obj for obj in bpy.data.objects
        if obj.type == "MESH"
        and obj.get("asset_id") == "avatar_36C"
        and (obj.get("object_role") == "BODY" or ("body" in obj.name.lower() and not obj.get("garment_role")))
    ]
    if len(candidates) != 1:
        raise RuntimeError(f"Expected one avatar_36C body, found {len(candidates)}")
    return candidates[0]


def create_draft_skin(body: bpy.types.Object) -> bpy.types.Material:
    material = bpy.data.materials.get("avatar_36C_skin_DRAFT") or bpy.data.materials.new("avatar_36C_skin_DRAFT")
    material.use_nodes = True
    material.diffuse_color = (0.50, 0.285, 0.215, 1.0)
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.50, 0.285, 0.215, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.56
        if "Subsurface Weight" in bsdf.inputs:
            bsdf.inputs["Subsurface Weight"].default_value = 0.025
    body.data.materials.clear()
    body.data.materials.append(material)
    return material


def main() -> None:
    if Path(bpy.data.filepath).resolve() != BLEND_PATH.resolve():
        raise RuntimeError(f"Expected open file {BLEND_PATH}, got {bpy.data.filepath}")

    body = body_object()
    material = create_draft_skin(body)
    body["asset_status"] = "DRAFT_NOT_TD_VALIDATED"
    body["export_contract"] = "contracts/avatar-asset-contract.md"

    asset_objects = [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH" and obj.get("asset_id") == "avatar_36C"
    ]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in asset_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    if body.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), check_existing=False)
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        check_existing=False,
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_yup=True,
        export_morph=True,
        export_morph_normal=True,
        export_skins=True,
        export_animations=False,
        export_materials="EXPORT",
    )

    shape_keys = []
    if body.data.shape_keys:
        shape_keys = [block.name for block in body.data.shape_keys.key_blocks]
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "blender_version": bpy.app.version_string,
        "source_blend": str(BLEND_PATH.relative_to(ROOT)),
        "source_blend_sha256": sha256(BLEND_PATH),
        "glb": str(GLB_PATH.relative_to(ROOT)),
        "glb_sha256": sha256(GLB_PATH),
        "glb_bytes": GLB_PATH.stat().st_size,
        "glb_under_25mb": GLB_PATH.stat().st_size <= 25 * 1024 * 1024,
        "material": material.name,
        "exported_objects": [obj.name for obj in asset_objects],
        "exported_materials": sorted({
            slot.material.name
            for obj in asset_objects
            for slot in obj.material_slots
            if slot.material
        }),
        "shape_key_count_in_source": len(shape_keys),
        "shape_key_names_in_source": shape_keys,
        "warning": "Export pipeline draft only; bikini is base-pose coverage draft. Required six named morphs, TD measurements, rig and final QA are not complete.",
    }
    REPORT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print("GLB_DRAFT_EXPORT_REPORT=" + json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
