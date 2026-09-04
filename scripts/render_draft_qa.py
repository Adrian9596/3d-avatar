"""Render standardized QA views of the current Blender draft.

Images are evidence for review only and do not grant visual or TD approval.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
QA_DIR = ROOT / "qa" / "avatar_36C"
REPORT = QA_DIR / "render-report.json"


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


def setup_scene(body: bpy.types.Object) -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"

    scene.world.color = (0.055, 0.055, 0.055)
    if scene.world.use_nodes:
        background = scene.world.node_tree.nodes.get("Background")
        if background:
            background.inputs["Color"].default_value = (0.055, 0.055, 0.055, 1.0)
            background.inputs["Strength"].default_value = 0.65

    for poly in body.data.polygons:
        poly.use_smooth = True

    target = Vector((0.0, 0.0, 0.82))
    add_area("QA_Key", (3.0, -4.0, 4.0), 900.0, 3.0, target)
    add_area("QA_Fill", (-3.0, -2.0, 2.7), 500.0, 3.5, target)
    add_area("QA_Rim", (0.0, 3.0, 3.2), 750.0, 2.5, target)

    camera_data = bpy.data.cameras.new("QA_Camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 1.9
    camera = bpy.data.objects.new("QA_Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera

    # Floor sits just under z=0 because the body is ground-aligned to exactly 0
    # (see Checklist - Fix Ground Alignment Evaluated-Mesh Bug.md). The old
    # -0.027 value was calibrated to the pre-fix, ungrounded body and would now
    # leave the feet visibly floating. The 0.5mm offset only avoids z-fighting
    # with the soles.
    bpy.ops.mesh.primitive_plane_add(size=8.0, location=(0.0, 0.0, -0.0005))
    floor = bpy.context.active_object
    floor.name = "QA_Floor"
    floor_material = bpy.data.materials.new("QA_Floor_Material")
    floor_material.diffuse_color = (0.16, 0.16, 0.16, 1.0)
    floor.data.materials.append(floor_material)
    return camera


def main() -> None:
    QA_DIR.mkdir(parents=True, exist_ok=True)
    body = body_object()
    camera = setup_scene(body)
    target = Vector((0.0, 0.0, 0.82))

    views = {
        "front": (0.0, -4.0, 0.82),
        "45deg": (2.828, -2.828, 0.82),
        "side": (4.0, 0.0, 0.82),
        "back": (0.0, 4.0, 0.82),
    }
    outputs = []
    for name, location in views.items():
        camera.location = location
        point_at(camera, target)
        output = QA_DIR / f"draft-{name}.png"
        bpy.context.scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        outputs.append(str(output.relative_to(ROOT)))

    # Top-down and bottom-up passes for the 360 sweep. These need a square
    # frame and a wider ortho scale (arm span is wider than the body is tall in
    # this projection), and the bottom pass needs the floor out of the way.
    scene = bpy.context.scene
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    camera.data.ortho_scale = 1.25
    floor = bpy.data.objects.get("QA_Floor")

    axis_views = {
        "top-down": ((0.0, 0.0, 3.2), False),
        "bottom-up": ((0.0, 0.0, -3.2), True),
    }
    for name, (location, hide_floor) in axis_views.items():
        if floor:
            floor.hide_render = hide_floor
        camera.location = location
        point_at(camera, target)
        output = QA_DIR / f"draft-{name}.png"
        scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        outputs.append(str(output.relative_to(ROOT)))
    if floor:
        floor.hide_render = False

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "blender_version": bpy.app.version_string,
        "engine": bpy.context.scene.render.engine,
        "resolution": [768, 1024],
        "axis_view_resolution": [1024, 1024],
        "camera": "orthographic",
        "ortho_scale": 1.9,
        "axis_view_ortho_scale": 1.25,
        "views": outputs,
        "floor_plane_z": -0.0005,
        "warning": "Images are review evidence only; visual score and TD approval are not complete.",
    }
    REPORT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print("QA_RENDER_REPORT=" + json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
