"""Export a browser-safe draft GLB without MPFB helper geometry or generator morphs.

This creates a separate prototype artifact. It never replaces the canonical
Stage 1 GLB and remains DRAFT_NOT_TD_VALIDATED.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
BLEND_PATH = ROOT / "avatar_36C_master.blend"
OUTPUT = ROOT / "assets" / "export" / "avatar_36C_prototype.glb"
REPORT = ROOT / "qa" / "avatar_36C" / "prototype-export-report.json"
VERSION = "0.1.0-prototype.1"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def body_object() -> bpy.types.Object:
    bodies = [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and obj.get("asset_id") == "avatar_36C"
        and obj.get("object_role") == "BODY"
    ]
    if len(bodies) != 1:
        raise RuntimeError(f"Expected one BODY object, found {[obj.name for obj in bodies]}")
    return bodies[0]


def garment_objects() -> list[bpy.types.Object]:
    expected = {"BIKINI_TOP", "BIKINI_BRIEF"}
    garments = [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and obj.get("asset_id") == "avatar_36C"
        and obj.get("object_role") in expected
    ]
    roles = {obj.get("object_role") for obj in garments}
    if roles != expected:
        raise RuntimeError(f"Expected garment roles {sorted(expected)}, found {sorted(roles)}")
    return garments


def eye_objects() -> list[bpy.types.Object]:
    expected = {"EYE_L", "EYE_R", "EYE_TRIM", "EYEBROW"}
    eyes = [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and obj.get("asset_id") == "avatar_36C"
        and obj.get("object_role") in expected
    ]
    roles = {obj.get("object_role") for obj in eyes}
    if roles != expected:
        raise RuntimeError(f"Expected eye roles {sorted(expected)}, found {sorted(roles)}")
    return eyes


def hair_objects() -> list[bpy.types.Object]:
    hair = [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and obj.get("asset_id") == "avatar_36C"
        and obj.get("object_role") == "HAIR"
    ]
    if len(hair) != 1:
        raise RuntimeError(f"Expected one HAIR object, found {[obj.name for obj in hair]}")
    return hair


def body_vertex_indices(body: bpy.types.Object) -> set[int]:
    group = body.vertex_groups.get("body")
    if not group:
        raise RuntimeError("MPFB body vertex group is required for prototype sanitization")
    return {
        vertex.index
        for vertex in body.data.vertices
        if any(member.group == group.index and member.weight > 0.5 for member in vertex.groups)
    }


def evaluated_body_only(body: bpy.types.Object) -> bpy.types.Object:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    evaluated_mesh = bpy.data.meshes.new_from_object(
        evaluated,
        preserve_all_data_layers=True,
        depsgraph=depsgraph,
    )

    keep = body_vertex_indices(body)
    kept_faces = [
        tuple(poly.vertices)
        for poly in evaluated_mesh.polygons
        if all(index in keep for index in poly.vertices)
    ]
    used = sorted({index for face in kept_faces for index in face})
    remap = {old: new for new, old in enumerate(used)}
    vertices = [evaluated_mesh.vertices[index].co.copy() for index in used]
    faces = [tuple(remap[index] for index in face) for face in kept_faces]

    clean_mesh = bpy.data.meshes.new("avatar_36C_prototype_body_mesh")
    clean_mesh.from_pydata(vertices, [], faces)
    clean_mesh.materials.clear()
    for material in body.data.materials:
        clean_mesh.materials.append(material)
    for polygon in clean_mesh.polygons:
        polygon.use_smooth = True
    clean_mesh.update(calc_edges=True)

    prototype = bpy.data.objects.new("avatar_36C_prototype_body", clean_mesh)
    bpy.context.scene.collection.objects.link(prototype)
    prototype.matrix_world = body.matrix_world.copy()
    for key in body.keys():
        prototype[key] = body[key]
    prototype["asset_status"] = "DRAFT_NOT_TD_VALIDATED"
    prototype["object_role"] = "BODY"
    prototype["prototype_source"] = "EVALUATED_BODY_GROUP_ONLY_NO_HELPERS"
    prototype["prototype_morph_policy"] = "MPFB_GENERATOR_TARGETS_NOT_EXPORTED"

    bpy.data.meshes.remove(evaluated_mesh)
    return prototype


def triangle_count(obj: bpy.types.Object) -> int:
    return sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)


def main() -> None:
    if Path(bpy.data.filepath).resolve() != BLEND_PATH.resolve():
        raise RuntimeError(f"Expected open file {BLEND_PATH}, got {bpy.data.filepath}")

    body = body_object()
    garments = garment_objects()
    eyes = eye_objects()
    hair = hair_objects()
    prototype_body = evaluated_body_only(body)
    export_objects = [prototype_body, *garments, *eyes, *hair]

    scene = bpy.context.scene
    scene["project_asset_status"] = "DRAFT_NOT_TD_VALIDATED"
    scene["project_gate"] = "PROTOTYPE_ONLY_STAGE_1_REMAINS_BLOCKED"
    scene["prototype_version"] = VERSION
    scene["prototype_body_policy"] = "BODY_GROUP_ONLY_NO_HELPERS_NO_GENERATOR_MORPHS"

    bpy.ops.object.select_all(action="DESELECT")
    for obj in export_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = prototype_body

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        check_existing=False,
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_yup=True,
        export_morph=False,
        export_skins=False,
        export_animations=False,
        export_materials="EXPORT",
    )

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "version": VERSION,
        "source_blend": str(BLEND_PATH.relative_to(ROOT)),
        "source_blend_sha256": sha256(BLEND_PATH),
        "prototype_glb": str(OUTPUT.relative_to(ROOT)),
        "prototype_glb_sha256": sha256(OUTPUT),
        "prototype_glb_bytes": OUTPUT.stat().st_size,
        "objects": [
            {
                "name": obj.name,
                "role": obj.get("object_role"),
                "vertices": len(obj.data.vertices),
                "triangles": triangle_count(obj),
            }
            for obj in export_objects
        ],
        "body_source_vertices_with_helpers": len(body.data.vertices),
        "body_prototype_vertices": len(prototype_body.data.vertices),
        "morph_targets_exported": 0,
        "armature_exported": False,
        "warning": "Prototype-only evaluated body. No TD measurement approval, semantic morphs, rig, pose coverage, or production authorization.",
    }
    REPORT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print("PROTOTYPE_EXPORT_REPORT=" + json.dumps(payload, separators=(",", ":")))

    bpy.data.objects.remove(prototype_body, do_unlink=True)


if __name__ == "__main__":
    main()
