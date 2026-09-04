import bpy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GLB = ROOT / "assets" / "export" / "avatar_36C.glb"
REPORT = ROOT / "qa" / "avatar_36C" / "blender-roundtrip-report.json"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB))

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    materials = sorted({slot.material.name for obj in meshes for slot in obj.material_slots if slot.material})
    target_names = []
    for obj in meshes:
        if obj.data.shape_keys:
            target_names.extend(key.name for key in obj.data.shape_keys.key_blocks[1:])

    all_world_vertices = []
    for obj in meshes:
        all_world_vertices.extend(obj.matrix_world @ vertex.co for vertex in obj.data.vertices)

    bounds = {
        axis: {
            "min": min(vertex[index] for vertex in all_world_vertices),
            "max": max(vertex[index] for vertex in all_world_vertices),
        }
        for index, axis in enumerate(("x", "y", "z"))
    }

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "source": str(GLB.relative_to(ROOT)),
        "sha256": sha256(GLB),
        "blender_version": bpy.app.version_string,
        "mesh_count": len(meshes),
        "armature_count": len(armatures),
        "material_names": materials,
        "morph_target_names": target_names,
        "bounds_meters_after_import": bounds,
        "checks": {
            "mesh_present": bool(meshes),
            "material_present": bool(materials),
            "morph_targets_present": bool(target_names),
            "armature_present": bool(armatures),
            "required_six_morph_names_present": all(
                required in target_names
                for required in ("Underbust", "Projection", "RootWidth", "Spacing", "UpperFullness", "Ptosis")
            ),
            "floor_z_after_blender_reimport_within_1mm": abs(bounds["z"]["min"]) <= 0.001,
        },
        "warning": "Round-trip is technical evidence only; this draft has no TD measurement approval.",
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("ROUNDTRIP_REPORT=" + json.dumps(report, separators=(",", ":")))


if __name__ == "__main__":
    main()
