import bpy
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "qa" / "avatar_36C" / "body-region-inspection.json"


def bounds(points):
    return {
        "min_xyz": [min(point[i] for point in points) for i in range(3)],
        "max_xyz": [max(point[i] for point in points) for i in range(3)],
    }


def main():
    bodies = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and "body" in obj.name.lower()]
    if len(bodies) != 1:
        raise RuntimeError(f"Expected one body mesh, found {[obj.name for obj in bodies]}")
    body = bodies[0]
    # This body has active MPFB macro shape keys that Blender only applies at
    # evaluation time, never to body.data.vertices directly - read the
    # depsgraph-evaluated mesh instead. See
    # Checklist - Fix Ground Alignment Evaluated-Mesh Bug.md.
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated_obj = body.evaluated_get(depsgraph)
    mesh = evaluated_obj.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    points = [body.matrix_world @ vertex.co for vertex in mesh.vertices]

    regions = {}
    definitions = {
        "bikini_top_candidate": lambda p: 1.03 <= p.z <= 1.38 and p.y <= 0.035 and abs(p.x) <= 0.38,
        "underbust_band_candidate": lambda p: 1.03 <= p.z <= 1.13 and abs(p.x) <= 0.43,
        "brief_candidate": lambda p: 0.68 <= p.z <= 1.00 and abs(p.x) <= 0.43,
        "brief_gusset_candidate": lambda p: 0.66 <= p.z <= 0.83 and abs(p.x) <= 0.18,
    }
    for name, predicate in definitions.items():
        selected = [p for p in points if predicate(p)]
        regions[name] = {"vertex_count": len(selected), "bounds": bounds(selected) if selected else None}

    group_names = [group.name for group in body.vertex_groups]
    joint_centers = {}
    for group_name in ("joint-l-shoulder", "joint-r-shoulder", "joint-l-scapula", "joint-r-scapula", "joint-spine-3"):
        group = body.vertex_groups.get(group_name)
        if not group:
            continue
        members = []
        for vertex in body.data.vertices:
            if any(entry.group == group.index and entry.weight > 0.0 for entry in vertex.groups):
                members.append(body.matrix_world @ vertex.co)
        if members:
            joint_centers[group_name] = [sum(point[i] for point in members) / len(members) for i in range(3)]
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "body": body.name,
        "body_bounds": bounds(points),
        "vertex_count": len(points),
        "polygon_count": len(body.data.polygons),
        "material_names": [slot.material.name if slot.material else None for slot in body.material_slots],
        "vertex_group_count": len(group_names),
        "vertex_group_names": group_names,
        "joint_centers": joint_centers,
        "candidate_regions": regions,
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
