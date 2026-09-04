"""Render standardized clothed and coverage-detail QA evidence."""

from __future__ import annotations

import json
import hashlib
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
QA_DIR = ROOT / "qa" / "avatar_36C" / "bikini"
REPORT = ROOT / "qa" / "avatar_36C" / "bikini-render-report.json"
BLEND = ROOT / "avatar_36C_master.blend"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def point_at(obj, target):
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_area(name, location, energy, size, target):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    point_at(obj, target)


def setup():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.045, 0.045, 0.045)
    if scene.world.use_nodes:
        background = scene.world.node_tree.nodes.get("Background")
        if background:
            background.inputs["Color"].default_value = (0.045, 0.045, 0.045, 1.0)
            background.inputs["Strength"].default_value = 0.60
    target = Vector((0.0, 0.0, 0.92))
    add_area("Bikini_Key", (3.0, -4.0, 4.0), 900.0, 3.0, target)
    add_area("Bikini_Fill", (-3.0, -2.0, 2.8), 500.0, 3.5, target)
    add_area("Bikini_Rim", (0.0, 3.0, 3.2), 750.0, 2.5, target)
    camera_data = bpy.data.cameras.new("Bikini_QA_Camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("Bikini_QA_Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    return camera


def render(camera, name, location, target, ortho_scale):
    camera.location = Vector(location)
    camera.data.ortho_scale = ortho_scale
    point_at(camera, Vector(target))
    output = QA_DIR / f"{name}.png"
    bpy.context.scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    return str(output.relative_to(ROOT))


def main():
    QA_DIR.mkdir(parents=True, exist_ok=True)
    top = bpy.data.objects.get("avatar_36C_bikini_top")
    brief = bpy.data.objects.get("avatar_36C_bikini_brief")
    if not top or not brief:
        raise RuntimeError("Technical bikini objects are missing")
    top.hide_render = False
    brief.hide_render = False
    camera = setup()

    outputs = []
    full_views = {
        "clothed-front": ((0.0, -4.0, 0.86), (0.0, 0.0, 0.86)),
        "clothed-45deg": ((2.828, -2.828, 0.86), (0.0, 0.0, 0.86)),
        "clothed-side": ((4.0, 0.0, 0.86), (0.0, 0.0, 0.86)),
        "clothed-back": ((0.0, 4.0, 0.86), (0.0, 0.0, 0.86)),
    }
    for name, (location, target) in full_views.items():
        outputs.append(render(camera, name, location, target, 1.90))

    details = {
        "coverage-top-front": ((0.0, -2.5, 1.17), (0.0, -0.06, 1.17), 0.66),
        "coverage-top-45deg": ((1.75, -1.75, 1.17), (0.0, -0.03, 1.17), 0.66),
        "coverage-brief-front": ((0.0, -2.5, 0.81), (0.0, -0.05, 0.81), 0.62),
        "coverage-brief-back": ((0.0, 2.5, 0.82), (0.0, 0.03, 0.82), 0.62),
    }
    for name, (location, target, scale) in details.items():
        outputs.append(render(camera, name, location, target, scale))

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "blend_sha256": sha256(BLEND),
        "resolution": [768, 1024],
        "camera": "orthographic",
        "outputs": outputs,
        "visual_review_scope": "BASE_A_POSE_ONLY",
        "warning": "Rig and six semantic morphs do not exist; pose/morph coverage remains blocked.",
    }
    REPORT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print("BIKINI_RENDER_REPORT=" + json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
