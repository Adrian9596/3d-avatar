#!/usr/bin/env python3
import json
import struct
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GLB = ROOT / "assets" / "export" / "avatar_36C.glb"
REPORT = ROOT / "qa" / "avatar_36C" / "glb-structure-report.json"


def main():
    raw = GLB.read_bytes()
    magic, version, declared_length = struct.unpack_from("<4sII", raw, 0)
    json_length, json_type = struct.unpack_from("<II", raw, 12)
    if magic != b"glTF" or version != 2 or json_type != 0x4E4F534A:
        raise RuntimeError("Expected a GLB 2.0 JSON chunk")

    document = json.loads(raw[20 : 20 + json_length].decode("utf-8"))
    primitives = [primitive for mesh in document.get("meshes", []) for primitive in mesh.get("primitives", [])]
    position_accessors = [
        document["accessors"][primitive["attributes"]["POSITION"]]
        for primitive in primitives
        if "POSITION" in primitive.get("attributes", {})
    ]
    mins = [min(accessor["min"][axis] for accessor in position_accessors) for axis in range(3)]
    maxs = [max(accessor["max"][axis] for accessor in position_accessors) for axis in range(3)]

    # Accessor min/max are in LOCAL mesh space; a node's own translation is
    # applied separately in the glTF scene graph and is NOT baked into the
    # accessor data. Checking mins/maxs alone silently ignores any node
    # translation - the exact same "wrong layer" mistake this checklist
    # exists to fix. Map each mesh to the node(s) that reference it (by
    # index, not list position - nodes are not guaranteed to align
    # positionally with meshes) to compute the true world-space bound.
    # See Checklist - Fix Ground Alignment Evaluated-Mesh Bug.md.
    nodes = document.get("nodes", [])
    translation_by_mesh_index = {
        node["mesh"]: node.get("translation", [0.0, 0.0, 0.0])
        for node in nodes
        if "mesh" in node
    }
    world_min_y = min(
        (
            accessor["min"][1] + translation_by_mesh_index.get(mesh_index, [0.0, 0.0, 0.0])[1]
            for mesh_index, mesh in enumerate(document.get("meshes", []))
            for primitive in mesh.get("primitives", [])
            if "POSITION" in primitive.get("attributes", {})
            for accessor in [document["accessors"][primitive["attributes"]["POSITION"]]]
        ),
        default=None,
    )
    target_names = [name for mesh in document.get("meshes", []) for name in mesh.get("extras", {}).get("targetNames", [])]
    external_uris = [buffer["uri"] for buffer in document.get("buffers", []) if "uri" in buffer]
    external_uris += [image["uri"] for image in document.get("images", []) if "uri" in image]

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "glb_header": {
            "magic": magic.decode("ascii"),
            "version": version,
            "declared_length": declared_length,
            "actual_length": len(raw),
        },
        "asset_generator": document.get("asset", {}).get("generator"),
        "position_bounds_gltf_y_up_meters": {"min_xyz": mins, "max_xyz": maxs},
        "position_bounds_note": "min_xyz/max_xyz above are LOCAL accessor bounds only, before any node translation. world_min_y accounts for node translation and is what floor_y_within_1mm actually checks.",
        "world_min_y": world_min_y,
        "scene_extras": document.get("scenes", [{}])[0].get("extras", {}),
        "node_extras": [node.get("extras", {}) for node in document.get("nodes", []) if node.get("extras")],
        "target_names": target_names,
        "external_uris": external_uris,
        "checks": {
            "declared_length_matches": declared_length == len(raw),
            "floor_y_within_1mm": world_min_y is not None and abs(world_min_y) <= 0.001,
            "x_symmetric_within_1mm": abs(abs(mins[0]) - abs(maxs[0])) <= 0.001,
            "self_contained": not external_uris,
        },
        "warning": "Structure checks do not grant TD, anatomy, morph, rig, visual, or final approval.",
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
