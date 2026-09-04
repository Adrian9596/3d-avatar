"""Inspect the eye region of the current draft body before any eye edit.

Read-only: renders standardized eye close-ups and writes a geometry report.
Images and JSON are evidence for review only and grant no approval.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
EYES_DIR = ROOT / "qa" / "avatar_36C" / "eyes"
REPORT = EYES_DIR / "eye-inspection-report.json"

EYE_KEYWORDS = ("eye", "lid", "iris", "pupil", "cornea", "sclera", "lash", "orbicularis")


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


def evaluated_world_verts(obj: bpy.types.Object) -> list[Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    verts = [eval_obj.matrix_world @ v.co for v in mesh.vertices]
    eval_obj.to_mesh_clear()
    return verts


def mesh_inventory() -> list[dict]:
    inventory = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        depsgraph = bpy.context.evaluated_depsgraph_get()
        eval_obj = obj.evaluated_get(depsgraph)
        mesh = eval_obj.to_mesh()
        mesh.calc_loop_triangles()
        tris = len(mesh.loop_triangles)
        eval_obj.to_mesh_clear()
        inventory.append({
            "name": obj.name,
            "asset_id": obj.get("asset_id"),
            "object_role": obj.get("object_role"),
            "garment_role": obj.get("garment_role"),
            "triangles": tris,
            "materials": [slot.material.name for slot in obj.material_slots if slot.material],
            "vertex_groups": [vg.name for vg in obj.vertex_groups],
            "shape_keys": (
                [kb.name for kb in obj.data.shape_keys.key_blocks]
                if obj.data.shape_keys else []
            ),
            "modifiers": [f"{m.type}:{m.name}" for m in obj.modifiers],
            "hide_render": obj.hide_render,
        })
    return inventory


def eye_related(names: list[str]) -> list[str]:
    return [n for n in names if any(k in n.lower() for k in EYE_KEYWORDS)]


def estimate_eye_centers(verts: list[Vector]) -> dict:
    """Estimate left/right eye centers from face geometry.

    Front of the body faces -Y (QA front camera sits at -Y). Eyes sit in a
    z-band roughly 9-14 cm below the crown; within that band the front-most
    vertices on each side of the x=0 midline approximate the eye surfaces.
    """
    max_z = max(v.z for v in verts)
    min_z = min(v.z for v in verts)
    height = max_z - min_z
    band_top = max_z - 0.085
    band_bottom = max_z - 0.150
    band = [v for v in verts if band_bottom <= v.z <= band_top]
    left = [v for v in band if v.x > 0.008]   # character left = +X
    right = [v for v in band if v.x < -0.008]

    def front_cluster(side: list[Vector]) -> dict | None:
        if not side:
            return None
        min_y = min(v.y for v in side)
        cluster = [v for v in side if v.y <= min_y + 0.012]
        cx = sum(v.x for v in cluster) / len(cluster)
        cy = sum(v.y for v in cluster) / len(cluster)
        cz = sum(v.z for v in cluster) / len(cluster)
        return {
            "center": [round(cx, 5), round(cy, 5), round(cz, 5)],
            "front_most_y": round(min_y, 5),
            "cluster_size": len(cluster),
            "x_extent": [round(min(v.x for v in cluster), 5), round(max(v.x for v in cluster), 5)],
            "z_extent": [round(min(v.z for v in cluster), 5), round(max(v.z for v in cluster), 5)],
        }

    return {
        "body_height_m": round(height, 5),
        "crown_z": round(max_z, 5),
        "floor_z": round(min_z, 5),
        "band_z": [round(band_bottom, 5), round(band_top, 5)],
        "band_vertex_count": len(band),
        "left_eye_area": front_cluster(left),
        "right_eye_area": front_cluster(right),
    }


def symmetry_check(verts: list[Vector], band_bottom: float, band_top: float) -> dict:
    band = [v for v in verts if band_bottom <= v.z <= band_top]
    left = [v for v in band if v.x > 0.008]
    right = [v for v in band if v.x < -0.008]
    if not left or not right:
        return {"status": "INSUFFICIENT_DATA"}
    return {
        "left_count": len(left),
        "right_count": len(right),
        "left_front_y": round(min(v.y for v in left), 5),
        "right_front_y": round(min(v.y for v in right), 5),
        "front_y_delta_mm": round(abs(min(v.y for v in left) - min(v.y for v in right)) * 1000, 3),
        "left_x_max": round(max(v.x for v in left), 5),
        "right_x_min": round(min(v.x for v in right), 5),
        "x_extent_delta_mm": round(abs(max(v.x for v in left) + min(v.x for v in right)) * 1000, 3),
    }


def point_at(obj: bpy.types.Object, target: Vector) -> None:
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_area(name: str, location: tuple[float, float, float], energy: float, size: float, target: Vector) -> None:
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    point_at(obj, target)


def render_views(body: bpy.types.Object, eye_target: Vector) -> list[str]:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False

    if scene.world and scene.world.use_nodes:
        background = scene.world.node_tree.nodes.get("Background")
        if background:
            background.inputs["Color"].default_value = (0.055, 0.055, 0.055, 1.0)
            background.inputs["Strength"].default_value = 0.65

    for poly in body.data.polygons:
        poly.use_smooth = True

    add_area("EyeQA_Key", (0.5, eye_target.y - 0.9, eye_target.z + 0.4), 120.0, 0.8, eye_target)
    add_area("EyeQA_Fill", (-0.6, eye_target.y - 0.7, eye_target.z), 60.0, 1.0, eye_target)
    add_area("EyeQA_Rim", (0.0, eye_target.y + 0.8, eye_target.z + 0.5), 80.0, 0.8, eye_target)

    camera_data = bpy.data.cameras.new("EyeQA_Camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("EyeQA_Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera

    distance = 1.2
    views = {
        "face-front": (Vector((0.0, -distance, 0.0)), 0.30),
        "eyes-front": (Vector((0.0, -distance, 0.0)), 0.13),
        "eyes-45L": (Vector((distance * 0.707, -distance * 0.707, 0.0)), 0.13),
        "eyes-45R": (Vector((-distance * 0.707, -distance * 0.707, 0.0)), 0.13),
        "eyes-sideL": (Vector((distance, 0.0, 0.0)), 0.13),
        "eyes-sideR": (Vector((-distance, 0.0, 0.0)), 0.13),
    }
    outputs = []
    for name, (offset, ortho_scale) in views.items():
        camera.location = eye_target + offset
        camera.data.ortho_scale = ortho_scale
        point_at(camera, eye_target)
        output = EYES_DIR / f"inspect-{name}.png"
        scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        outputs.append(str(output.relative_to(ROOT)))
    return outputs


def main() -> None:
    EYES_DIR.mkdir(parents=True, exist_ok=True)
    body = body_object()
    verts = evaluated_world_verts(body)

    inventory = mesh_inventory()
    estimate = estimate_eye_centers(verts)
    band_bottom, band_top = estimate["band_z"]
    symmetry = symmetry_check(verts, band_bottom, band_top)

    eyeball_objects = [
        e["name"] for e in inventory
        if any(k in e["name"].lower() for k in ("eye", "iris", "cornea", "sclera"))
        and "lash" not in e["name"].lower()
    ]

    left = estimate["left_eye_area"]
    right = estimate["right_eye_area"]
    if left and right:
        eye_target = Vector((
            0.0,
            (left["center"][1] + right["center"][1]) / 2,
            (left["center"][2] + right["center"][2]) / 2,
        ))
    else:
        eye_target = Vector((0.0, -0.05, estimate["crown_z"] - 0.115))

    outputs = render_views(body, eye_target)

    materials = []
    for mat in bpy.data.materials:
        entry = {"name": mat.name, "users": mat.users, "uses_nodes": mat.use_nodes}
        if mat.use_nodes:
            entry["node_types"] = sorted({n.type for n in mat.node_tree.nodes})
            entry["image_textures"] = [
                n.image.name for n in mat.node_tree.nodes
                if n.type == "TEX_IMAGE" and n.image
            ]
        materials.append(entry)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "purpose": "Pre-edit eye-region baseline; read-only inspection",
        "blender_version": bpy.app.version_string,
        "body_object": body.name,
        "mesh_inventory": inventory,
        "eyeball_candidate_objects": eyeball_objects,
        "eye_related_vertex_groups": eye_related([vg.name for vg in body.vertex_groups]),
        "eye_related_shape_keys": eye_related(
            [kb.name for kb in body.data.shape_keys.key_blocks] if body.data.shape_keys else []
        ),
        "materials": materials,
        "eye_region_estimate": estimate,
        "eye_band_symmetry": symmetry,
        "render_target": [round(c, 5) for c in eye_target],
        "views": outputs,
        "warning": "Baseline evidence only; no approval implied.",
    }
    REPORT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print("EYE_INSPECTION_REPORT=" + json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
