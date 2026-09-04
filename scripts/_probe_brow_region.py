"""Read-only brow-region probe: raycast the evaluated skin surface above the
eyes to locate the brow ridge, and render baseline views. Saves nothing to
the .blend."""

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "qa" / "avatar_36C" / "brows"
OUT_DIR.mkdir(parents=True, exist_ok=True)

EYE_CZ = 1.4872
EYE_CX = 0.02847
EYE_CY = -0.11009

body = next(
    o for o in bpy.context.scene.objects
    if o.type == "MESH" and o.get("object_role") == "BODY"
)
depsgraph = bpy.context.evaluated_depsgraph_get()
eval_obj = body.evaluated_get(depsgraph)
inv = body.matrix_world.inverted()

def cast(x, z):
    origin_w = Vector((x, -0.5, z))
    direction_w = Vector((0.0, 1.0, 0.0))
    origin_l = inv @ origin_w
    direction_l = (inv.to_3x3() @ direction_w).normalized()
    hit, loc, normal, _ = eval_obj.ray_cast(origin_l, direction_l)
    if not hit:
        return None
    loc_w = body.matrix_world @ loc
    n_w = (body.matrix_world.to_3x3() @ normal).normalized()
    return loc_w, n_w

profile = {}
for x_mm in range(8, 62, 2):
    x = x_mm / 1000.0
    column = []
    for z_off_tenthmm in range(80, 420, 20):
        z = EYE_CZ + z_off_tenthmm / 10000.0
        res = cast(x, z)
        if res:
            loc, n = res
            column.append({
                "z_off_mm": round(z_off_tenthmm / 10.0, 1),
                "y": round(loc.y, 5),
                "nz": round(n.z, 3),
            })
    if column:
        ridge = min(column, key=lambda c: c["y"])
        profile[f"x={x_mm}mm"] = {
            "ridge_z_off_mm": ridge["z_off_mm"],
            "ridge_y": ridge["y"],
            "y_at_20mm": next((c["y"] for c in column if c["z_off_mm"] == 20.0), None),
            "y_at_30mm": next((c["y"] for c in column if c["z_off_mm"] == 30.0), None),
        }

print("BROW_PROFILE=" + json.dumps(profile))

# Baseline renders
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 640
scene.render.resolution_y = 640

for o in list(scene.objects):
    if o.type in ("CAMERA", "LIGHT"):
        bpy.data.objects.remove(o, do_unlink=True)

cam_data = bpy.data.cameras.new("qa_cam")
cam_data.lens = 85
cam = bpy.data.objects.new("qa_cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

key_data = bpy.data.lights.new("qa_key", "AREA")
key_data.size = 0.18
key_data.energy = 60
key = bpy.data.objects.new("qa_key", key_data)
scene.collection.objects.link(key)

fill_data = bpy.data.lights.new("qa_fill", "AREA")
fill_data.size = 0.35
fill_data.energy = 25
fill = bpy.data.objects.new("qa_fill", fill_data)
scene.collection.objects.link(fill)

target = Vector((0.0, EYE_CY, EYE_CZ + 0.012))
key.location = target + Vector((0.15, -0.35, 0.25))
key.rotation_euler = (math.radians(55), 0, math.radians(20))
fill.location = target + Vector((-0.25, -0.30, 0.05))
fill.rotation_euler = (math.radians(75), 0, math.radians(-40))

def look_at(obj, tgt):
    d = tgt - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

views = {
    "baseline-front": target + Vector((0.0, -0.30, 0.0)),
    "baseline-45L": target + Vector((0.21, -0.21, 0.02)),
    "baseline-45R": target + Vector((-0.21, -0.21, 0.02)),
    "baseline-sideL": target + Vector((0.30, 0.0, 0.02)),
}
for name, loc in views.items():
    cam.location = loc
    look_at(cam, target)
    scene.render.filepath = str(OUT_DIR / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print("SAVED", scene.render.filepath)
