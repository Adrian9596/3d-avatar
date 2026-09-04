"""Machine validation for current base-pose bikini draft."""

from __future__ import annotations

import json
import hashlib
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils.bvhtree import BVHTree


ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "qa" / "avatar_36C" / "bikini-machine-validation.json"
BLEND = ROOT / "avatar_36C_master.blend"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def role(name):
    obj = bpy.data.objects.get(name)
    if not obj or obj.type != "MESH":
        raise RuntimeError(f"Missing mesh object {name}")
    return obj


def material_values(material):
    bsdf = material.node_tree.nodes.get("Principled BSDF") if material.use_nodes else None
    def value(name, fallback=None):
        socket = bsdf.inputs.get(name) if bsdf else None
        return socket.default_value if socket else fallback
    return {
        "alpha": value("Alpha", material.diffuse_color[3]),
        "transmission": value("Transmission Weight", 0.0),
        "roughness": value("Roughness", material.roughness),
        "metallic": value("Metallic", material.metallic),
    }


def penetration_report(body, garment, depsgraph):
    # BVHTree.FromObject builds its tree in the body's LOCAL space, not world
    # space - garment query points must be converted into that same local
    # space before querying, or results are silently wrong by whatever
    # translation body.matrix_world currently has. This was invisible while
    # body.matrix_world was identity; it is not identity after the ground-
    # alignment fix (rigid object translation). See
    # Checklist - Fix Ground Alignment Evaluated-Mesh Bug.md.
    tree = BVHTree.FromObject(body, depsgraph)
    body_matrix_inverse = body.matrix_world.inverted()
    garment_matrix = garment.matrix_world
    signed_distances = []
    penetrating_indices = []
    for vertex in garment.data.vertices:
        point_world = garment_matrix @ vertex.co
        point = body_matrix_inverse @ point_world
        hit = tree.find_nearest(point)
        if not hit or hit[0] is None:
            continue
        location, normal, _, distance = hit
        sign = 1.0 if (point - location).dot(normal) >= 0.0 else -1.0
        signed_distances.append(sign * distance)
        if sign * distance < -0.00025:
            penetrating_indices.append(vertex.index)
    penetrating = [value for value in signed_distances if value < -0.00025]
    return {
        "vertices_checked": len(signed_distances),
        "penetrating_vertex_count_below_minus_0_25mm": len(penetrating),
        "penetrating_vertex_indices": penetrating_indices,
        "minimum_signed_distance_m": min(signed_distances) if signed_distances else None,
        "maximum_signed_distance_m": max(signed_distances) if signed_distances else None,
        "pass_base_pose": not penetrating,
    }


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def main():
    body = role("avatar_36C_body_DRAFT")
    top = role("avatar_36C_bikini_top")
    brief = role("avatar_36C_bikini_brief")
    material = bpy.data.materials.get("avatar_36C_bikini_matte")
    if not material:
        raise RuntimeError("Missing bikini material")
    values = material_values(material)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    penetrations = {
        "top": penetration_report(body, top, depsgraph),
        "brief": penetration_report(body, brief, depsgraph),
    }
    geometry = {
        "body_triangles": triangles(body),
        "top_triangles": triangles(top),
        "brief_triangles": triangles(brief),
    }
    geometry["total_triangles"] = sum(geometry.values())
    checks = {
        "separate_named_objects": len({body.name, top.name, brief.name}) == 3,
        "independently_hideable": all(not obj.hide_viewport for obj in (body, top, brief)),
        "opaque_alpha_1": abs(float(values["alpha"]) - 1.0) < 1e-6,
        "transmission_0": abs(float(values["transmission"])) < 1e-6,
        "roughness_in_range": 0.55 <= float(values["roughness"]) <= 0.75,
        "metallic_0": abs(float(values["metallic"])) < 1e-6,
        "thickness_0_8_to_1_2mm": all(0.0008 <= float(obj.get("garment_thickness_m", 0.0)) <= 0.0012 for obj in (top, brief)),
        "base_pose_no_penetration": all(item["pass_base_pose"] for item in penetrations.values()),
        "triangle_budget_under_160k": geometry["total_triangles"] <= 160000,
    }
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "blend_sha256": sha256(BLEND),
        "material": {"name": material.name, **values},
        "geometry": geometry,
        "penetration": penetrations,
        "checks": checks,
        "machine_result": "PASS_BASE_POSE" if all(checks.values()) else "FAIL",
        "blocked_checks": [
            "neutral/arms45/arms90 pose coverage — no rig",
            "six semantic morph extremes — morphs not created",
            "TD/3D/web reviewer approvals",
        ],
        "warning": "Machine PASS_BASE_POSE is not final bikini or Stage 1 approval.",
    }
    REPORT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print("BIKINI_VALIDATION=" + json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
