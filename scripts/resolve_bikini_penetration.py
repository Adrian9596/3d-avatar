"""Push only penetrating bikini vertices outside the current body surface."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils.bvhtree import BVHTree


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "avatar_36C_master.blend"
REPORT = ROOT / "qa" / "avatar_36C" / "bikini-penetration-resolution.json"
SAFETY = 0.00075


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve(body, garment, depsgraph):
    # BVHTree.FromObject builds its tree in the body's LOCAL space, not world
    # space. Query points, and the hit location/normal used to correct
    # vertices, must all be handled in that same local space, or corrections
    # are computed against the wrong reference point whenever body.matrix_world
    # is not identity. See Checklist - Fix Ground Alignment Evaluated-Mesh Bug.md.
    tree = BVHTree.FromObject(body, depsgraph)
    body_matrix = body.matrix_world
    body_matrix_inverse = body_matrix.inverted()
    world = garment.matrix_world
    inverse = world.inverted()
    neighbors = {vertex.index: set() for vertex in garment.data.vertices}
    for edge in garment.data.edges:
        a, b = edge.vertices
        neighbors[a].add(b)
        neighbors[b].add(a)
    corrected = 0
    worst_before = 0.0
    for vertex in garment.data.vertices:
        point_world = world @ vertex.co
        point = body_matrix_inverse @ point_world
        hit = tree.find_nearest(point)
        if not hit or hit[0] is None:
            continue
        location, normal, _, distance = hit
        signed = distance if (point - location).dot(normal) >= 0.0 else -distance
        worst_before = min(worst_before, signed)
        if signed < SAFETY:
            if garment.name == "avatar_36C_bikini_brief" and abs(point_world.x) < 0.01 and point_world.y > 0.0 and signed < 0.0:
                linked = [world @ garment.data.vertices[index].co for index in neighbors[vertex.index]]
                corrected_world = point_world.copy()
                if linked:
                    corrected_world.x = sum(item.x for item in linked) / len(linked)
                    corrected_world.y = sum(item.y for item in linked) / len(linked)
                    corrected_world.z = sum(item.z for item in linked) / len(linked)
                corrected_world.y += 0.003
                vertex.co = inverse @ corrected_world
            else:
                corrected_world = body_matrix @ (location + normal * SAFETY)
                vertex.co = inverse @ corrected_world
            corrected += 1
    garment.data.update()
    return {"corrected_vertices": corrected, "worst_signed_distance_before_m": worst_before}


def main():
    body = bpy.data.objects.get("avatar_36C_body_DRAFT")
    garments = [bpy.data.objects.get("avatar_36C_bikini_top"), bpy.data.objects.get("avatar_36C_bikini_brief")]
    if not body or any(obj is None for obj in garments):
        raise RuntimeError("Body or bikini object missing")
    depsgraph = bpy.context.evaluated_depsgraph_get()
    results = {obj.name: resolve(body, obj, depsgraph) for obj in garments}
    bpy.context.scene["bikini_penetration_resolution"] = "BASE_POSE_SAFETY_0.75MM"
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), check_existing=False)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "safety_clearance_m": SAFETY,
        "results": results,
        "blend_sha256": sha256(BLEND),
        "warning": "Base-pose correction only; pose and semantic morph QA remain blocked.",
    }
    REPORT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print("PENETRATION_RESOLUTION=" + json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
