"""Machine audit of mesh integrity for the draft body and both garments.

Covers the mechanically checkable half of the avatar quality rubric:
holes/boundary edges, non-manifold edges, duplicate vertices, degenerate
(zero-area) faces, flipped/inconsistent normals, self-intersection,
polygon stretch (aspect ratio), left/right symmetry, and per-region
topology density around breast/IMF/axilla.

This grants no visual, anatomical or TD approval - it only reports
geometry facts. Aesthetic judgements (does the breast read as a real
breast, is the silhouette clean) are explicitly NOT covered here and
require human TD/3D review.

Reads the depsgraph-evaluated mesh throughout - see scripts/README.md.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import bmesh
import bpy
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "avatar_36C_master.blend"
REPORT = ROOT / "qa" / "avatar_36C" / "mesh-integrity-audit.json"

SYMMETRY_TOLERANCE_M = 0.0005
STRETCH_RATIO_LIMIT = 8.0
MERGE_DISTANCE_M = 0.00001


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def evaluated_bmesh(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    bm.from_object(obj, depsgraph)
    bm.transform(obj.matrix_world)
    bm.normal_update()
    return bm


def audit_object(obj, is_closed_surface):
    bm = evaluated_bmesh(obj)

    boundary_edges = [e for e in bm.edges if e.is_boundary]
    non_manifold_edges = [e for e in bm.edges if not e.is_manifold]
    non_manifold_verts = [v for v in bm.verts if not v.is_manifold]

    # Duplicate vertices: co-located within MERGE_DISTANCE_M.
    buckets = defaultdict(list)
    quantum = max(MERGE_DISTANCE_M, 1e-9)
    for v in bm.verts:
        key = (round(v.co.x / quantum), round(v.co.y / quantum), round(v.co.z / quantum))
        buckets[key].append(v.index)
    duplicate_groups = [indices for indices in buckets.values() if len(indices) > 1]

    degenerate_faces = [f for f in bm.faces if f.calc_area() <= 1e-12]

    # Inconsistent normals: a manifold edge whose two faces disagree on winding
    # direction shows up as both faces walking the shared edge the same way.
    inconsistent_normal_edges = 0
    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        f1, f2 = e.link_faces
        v1, v2 = e.verts

        def walks_forward(face):
            loops = face.loops
            for loop in loops:
                if loop.vert == v1 and loop.link_loop_next.vert == v2:
                    return True
                if loop.vert == v2 and loop.link_loop_next.vert == v1:
                    return False
            return None

        d1, d2 = walks_forward(f1), walks_forward(f2)
        if d1 is not None and d1 == d2:
            inconsistent_normal_edges += 1

    # Polygon stretch: longest/shortest edge ratio per face.
    worst_stretch = 0.0
    stretched_face_indices = []
    for f in bm.faces:
        lengths = [e.calc_length() for e in f.edges]
        shortest = min(lengths)
        if shortest <= 1e-9:
            continue
        ratio = max(lengths) / shortest
        worst_stretch = max(worst_stretch, ratio)
        if ratio > STRETCH_RATIO_LIMIT:
            stretched_face_indices.append(f.index)
    stretched_faces = len(stretched_face_indices)

    # Self-intersection: build a BVH of this mesh and look for face pairs that
    # overlap without sharing a vertex.
    tree = BVHTree.FromBMesh(bm, epsilon=0.0)
    raw_overlaps = tree.overlap(tree)
    face_verts = {f.index: {v.index for v in f.verts} for f in bm.faces}
    genuine_overlaps = []
    for a, b in raw_overlaps:
        if a >= b:
            continue
        if face_verts.get(a, set()) & face_verts.get(b, set()):
            continue  # adjacent faces sharing geometry are not intersections
        genuine_overlaps.append([a, b])

    # Left/right symmetry: mirror each vertex across x=0 and find its partner.
    mirror_buckets = defaultdict(list)
    for v in bm.verts:
        key = (round(v.co.y / 0.002), round(v.co.z / 0.002))
        mirror_buckets[key].append(v)
    asymmetric = 0
    worst_asymmetry_m = 0.0
    for group in mirror_buckets.values():
        for v in group:
            if v.co.x <= 0:
                continue
            best = min(
                (abs(-v.co.x - other.co.x) + abs(v.co.y - other.co.y) + abs(v.co.z - other.co.z)
                 for other in group if other.co.x < 0),
                default=None,
            )
            if best is None:
                continue
            worst_asymmetry_m = max(worst_asymmetry_m, best)
            if best > SYMMETRY_TOLERANCE_M:
                asymmetric += 1

    result = {
        "object": obj.name,
        "role": obj.get("object_role"),
        "vertices": len(bm.verts),
        "edges": len(bm.edges),
        "faces": len(bm.faces),
        "triangles": sum(max(0, len(f.verts) - 2) for f in bm.faces),
        "boundary_edge_count": len(boundary_edges),
        "non_manifold_edge_count": len(non_manifold_edges),
        "non_manifold_vertex_count": len(non_manifold_verts),
        "duplicate_vertex_group_count": len(duplicate_groups),
        "degenerate_face_count": len(degenerate_faces),
        "inconsistent_normal_edge_count": inconsistent_normal_edges,
        "worst_edge_length_ratio": round(worst_stretch, 2),
        "faces_over_stretch_limit": stretched_faces,
        "stretch_limit": STRETCH_RATIO_LIMIT,
        "self_intersecting_face_pair_count": len(genuine_overlaps),
        "self_intersecting_examples": genuine_overlaps[:10],
        "_defect_face_indices": {
            "self_intersecting": sorted({i for pair in genuine_overlaps for i in pair}),
            "stretched": stretched_face_indices,
        },
        "asymmetric_vertex_count": asymmetric,
        "worst_asymmetry_m": round(worst_asymmetry_m, 6),
        "symmetry_tolerance_m": SYMMETRY_TOLERANCE_M,
        "checks": {
            "no_holes": len(boundary_edges) == 0 if is_closed_surface else None,
            "manifold": len(non_manifold_edges) == 0 and len(non_manifold_verts) == 0,
            "no_duplicate_vertices": len(duplicate_groups) == 0,
            "no_degenerate_faces": len(degenerate_faces) == 0,
            "consistent_normals": inconsistent_normal_edges == 0,
            "no_severe_polygon_stretch": stretched_faces == 0,
            "no_self_intersection": len(genuine_overlaps) == 0,
            "symmetric_within_tolerance": asymmetric == 0,
        },
        "note_open_surface": None if is_closed_surface else "Garment shells are open surfaces by design; boundary edges are expected and no_holes is not applicable.",
    }
    bm.free()
    return result


def anatomical_zone(center, body_height_m):
    """Coarse anatomical label for a point, as a fraction of body height, so
    defect reports say 'left axilla' rather than just a face index."""
    if body_height_m <= 0:
        return "unknown"
    fraction = center.z / body_height_m
    side = "left" if center.x > 0.02 else "right" if center.x < -0.02 else "center"
    if fraction >= 0.93:
        zone = "scalp/crown"
    elif fraction >= 0.86:
        zone = "face/head"
    elif fraction >= 0.82:
        zone = "neck"
    elif fraction >= 0.76:
        zone = "shoulder/axilla"
    elif fraction >= 0.64:
        zone = "breast/chest"
    elif fraction >= 0.58:
        zone = "underbust/ribcage"
    elif fraction >= 0.52:
        zone = "waist"
    elif fraction >= 0.44:
        zone = "hip/crotch"
    elif fraction >= 0.25:
        zone = "thigh/knee"
    elif fraction >= 0.05:
        zone = "calf/ankle"
    else:
        zone = "foot"
    # Hands sit at mid-torso height but far out laterally.
    if abs(center.x) > 0.30 and 0.40 <= fraction <= 0.72:
        zone = "hand/forearm"
    return f"{side} {zone}"


def locate_faces(obj, face_indices, body_height_m):
    """Map face indices back to anatomical zones with world positions."""
    if not face_indices:
        return []
    bm = evaluated_bmesh(obj)
    bm.faces.ensure_lookup_table()
    located = []
    for index in sorted(set(face_indices)):
        if index >= len(bm.faces):
            continue
        center = bm.faces[index].calc_center_median()
        located.append({
            "face_index": index,
            "zone": anatomical_zone(center, body_height_m),
            "world_xyz_cm": [round(center.x * 100, 2), round(center.y * 100, 2), round(center.z * 100, 2)],
        })
    bm.free()
    return located


def zone_histogram(located):
    counts = defaultdict(int)
    for item in located:
        counts[item["zone"]] += 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))


def region_density(body):
    """Face counts in the bra-critical regions, to judge whether topology is
    dense enough around breast/IMF/axilla for morph and simulation work."""
    bm = evaluated_bmesh(body)
    regions = {
        "breast_and_imf": lambda c: 1.03 <= c.z <= 1.32 and c.y < 0.0 and abs(c.x) <= 0.26,
        "axilla_left": lambda c: 1.24 <= c.z <= 1.38 and 0.13 <= c.x <= 0.26,
        "axilla_right": lambda c: 1.24 <= c.z <= 1.38 and -0.26 <= c.x <= -0.13,
        "underbust_band": lambda c: 1.02 <= c.z <= 1.12,
        "upper_back": lambda c: 1.15 <= c.z <= 1.40 and c.y > 0.0,
    }
    counts = {}
    for name, predicate in regions.items():
        counts[name] = sum(1 for f in bm.faces if predicate(f.calc_center_median()))
    bm.free()
    return counts


def main():
    body = None
    garments = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        role = obj.get("object_role")
        if role == "BODY":
            body = obj
        elif role in {"BIKINI_TOP", "BIKINI_BRIEF"}:
            garments.append(obj)
    if body is None:
        raise RuntimeError("No BODY object found")

    results = [audit_object(body, is_closed_surface=True)]
    for garment in sorted(garments, key=lambda o: o.name):
        results.append(audit_object(garment, is_closed_surface=False))

    objects_by_name = {body.name: body}
    for garment in garments:
        objects_by_name[garment.name] = garment

    body_bm = evaluated_bmesh(body)
    body_height_m = max(v.co.z for v in body_bm.verts) - min(v.co.z for v in body_bm.verts)
    body_bm.free()

    # Turn raw face indices into anatomical zones so defects are actionable.
    for entry in results:
        defects = entry.pop("_defect_face_indices")
        obj = objects_by_name[entry["object"]]
        for kind in ("self_intersecting", "stretched"):
            located = locate_faces(obj, defects[kind], body_height_m)
            entry[f"{kind}_zones"] = zone_histogram(located)
            entry[f"{kind}_locations_sample"] = located[:12]

    body_result = results[0]
    body_checks = {k: v for k, v in body_result["checks"].items() if v is not None}

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "purpose": "Mesh-integrity facts for the avatar quality rubric (mesh-quality section). Grants no visual, anatomical or TD approval.",
        "blend_sha256": sha256(BLEND),
        "body_height_m": round(body_height_m, 5),
        "objects": results,
        "body_region_face_counts": region_density(body),
        "body_result": "PASS" if all(body_checks.values()) else "FAIL",
        "body_failed_checks": [k for k, v in body_checks.items() if not v],
        "not_covered_here": [
            "Whether the breast reads as anatomically real rather than a sphere on a torso (visual, TD).",
            "Silhouette quality at Front/45/Side/Back (visual, TD).",
            "Whether proportions match any approved 36C measurement target (blocked: no TD numeric authority).",
            "Skin realism and lighting judgement (visual, TD).",
        ],
    }
    REPORT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print("MESH_INTEGRITY_AUDIT=" + json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
