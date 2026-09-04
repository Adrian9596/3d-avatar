"""Observed-geometry measurement of the current draft master body.

This does NOT set or approve any target value. It only measures what the
CURRENT `avatar_36C_body_DRAFT` mesh actually is, for diagnostic use while
the TD-approved measurement authority (avatar_36C_measurements.md) is still
being populated. Per project rule, a target must never be copied from or
inferred from this output — this script writes an "observed" report only.

The base body has not yet had bra-fit anatomy refinement (T-032) or named
anthropometric landmarks (T-040). Rows that require an approved landmark
that does not exist yet are reported as NOT_MEASURABLE rather than guessed.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import bmesh
import bpy

ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "avatar_36C_master.blend"
REPORT = ROOT / "qa" / "avatar_36C" / "draft-body-measurement-report.json"

M_TO_CM = 100.0


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_body():
    meshes = [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and (obj.get("object_role") == "BODY" or ("body" in obj.name.lower() and not obj.get("garment_role")))
    ]
    if len(meshes) != 1:
        raise RuntimeError(f"Expected exactly one draft body mesh, found {len(meshes)}")
    return meshes[0]


def unmasked_evaluated_mesh(body):
    """The evaluated mesh from body.evaluated_get(depsgraph) has fewer
    vertices than body.data - MPFB's 'Hide helpers' MASK modifier drops
    rig/joint marker groups (e.g. joint-l-shoulder) that aren't part of the
    'body' surface group, which silently breaks any group lookup expecting
    those vertices to survive. Temporarily disabling that modifier gives a
    full, index-aligned, correctly shape-key-evaluated mesh instead (letting
    Blender's own shape-key evaluation - including any per-vertex-group
    modulation - do the work, rather than reimplementing it by hand).
    Caller must call restore() when done, and evaluated_obj.to_mesh_clear().
    See Checklist - Fix Ground Alignment Evaluated-Mesh Bug.md."""
    mask_modifiers = [m for m in body.modifiers if m.type == "MASK" and (m.show_viewport or m.show_render)]
    previous = [(m, m.show_viewport, m.show_render) for m in mask_modifiers]
    for m in mask_modifiers:
        m.show_viewport = False
        m.show_render = False
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated_obj = body.evaluated_get(depsgraph)
    mesh = evaluated_obj.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)

    def restore():
        evaluated_obj.to_mesh_clear()
        for m, viewport, render in previous:
            m.show_viewport = viewport
            m.show_render = render

    return mesh, restore


def group_world_points(body, mesh, group_name):
    """Pass the mesh from unmasked_evaluated_mesh() - vertex indices in that
    mesh align 1:1 with body.data.vertices, unlike body.evaluated_get()'s
    normal (Mask-modifier-filtered) output."""
    group = body.vertex_groups.get(group_name)
    if not group:
        return []
    points = []
    for vertex in mesh.vertices:
        if any(entry.group == group.index and entry.weight > 0.0 for entry in vertex.groups):
            points.append(body.matrix_world @ vertex.co)
    return points


def group_center(body, mesh, group_name):
    points = group_world_points(body, mesh, group_name)
    if not points:
        return None
    return [sum(p[i] for p in points) / len(points) for i in range(3)]


def bounds_z(body, mesh):
    zs = [(body.matrix_world @ v.co).z for v in mesh.vertices]
    return min(zs), max(zs)


def connected_components(edges):
    parent = {}

    def find(vert):
        root = vert
        while parent[root] is not root:
            root = parent[root]
        parent[vert] = root
        return root

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra is not rb:
            parent[ra] = rb

    for edge in edges:
        for vert in edge.verts:
            parent.setdefault(vert, vert)
    for edge in edges:
        v1, v2 = edge.verts
        union(v1, v2)

    groups = {}
    for edge in edges:
        root = find(edge.verts[0])
        groups.setdefault(root, []).append(edge)
    return list(groups.values())


def circumference_at_z(body, depsgraph, z):
    """Return (length, component_count, bbox) for the LARGEST connected
    cross-section loop at height z, regardless of how many separate loops
    (e.g. an arm crossing nearby) exist at that height. bbox is the x/y
    extent of that largest loop, used to sanity-check against contamination
    from a nearby limb (a torso-only slice should not be wider than the
    body's shoulder span)."""
    bm = bmesh.new()
    bm.from_object(body, depsgraph)
    bm.transform(body.matrix_world)
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    result = bmesh.ops.bisect_plane(
        bm, geom=geom, plane_co=(0.0, 0.0, z), plane_no=(0.0, 0.0, 1.0),
        clear_inner=False, clear_outer=False,
    )
    cut_edges = [g for g in result["geom_cut"] if isinstance(g, bmesh.types.BMEdge)]
    components = connected_components(cut_edges)
    ranked = sorted(components, key=lambda comp: sum(e.calc_length() for e in comp), reverse=True)
    bbox = None
    primary = 0.0
    if ranked:
        primary = sum(e.calc_length() for e in ranked[0])
        pts = {v for e in ranked[0] for v in e.verts}
        xs = [p.co.x for p in pts]
        ys = [p.co.y for p in pts]
        bbox = {
            "width_x_cm": round((max(xs) - min(xs)) * M_TO_CM, 2),
            "depth_y_cm": round((max(ys) - min(ys)) * M_TO_CM, 2),
            "point_count": len(pts),
        }
    bm.free()
    return primary, len(components), bbox


def scan(body, depsgraph, z_low, z_high, step, mode, max_width_m=None):
    """Find the z with max/min largest-loop circumference in [z_low, z_high].
    Samples whose largest loop is wider (x-extent) than max_width_m are
    rejected as likely torso/limb cross-section fusion (e.g. arm resting
    against the ribcage at that height), not a clean torso-only slice."""
    best_z, best_value, best_bbox = None, None, None
    samples = []
    rejected = 0
    z = z_low
    while z <= z_high:
        length, components, bbox = circumference_at_z(body, depsgraph, z)
        contaminated = bool(max_width_m and bbox and bbox["width_x_cm"] > max_width_m * M_TO_CM)
        samples.append({
            "z": round(z, 4), "circumference_m": round(length, 5),
            "components": components, "rejected_contaminated": contaminated,
        })
        if contaminated:
            rejected += 1
        else:
            if best_value is None or (mode == "max" and length > best_value) or (mode == "min" and length < best_value):
                best_value, best_z, best_bbox = length, z, bbox
        z += step
    return best_z, best_value, best_bbox, rejected, samples


def main():
    body = find_body()
    depsgraph = bpy.context.evaluated_depsgraph_get()

    # "scalp"/"nippleTip"/"nipple" are part of the visible 'body' surface -
    # measure them (and the body's floor/crown) on the NORMAL evaluated mesh,
    # the same one the Mask modifier produces for rendering/export. Using the
    # unmasked mesh here would pick up now-visible helper geometry (teeth,
    # eyes, tongue, etc.) that was never grounded and isn't part of the body
    # surface, corrupting floor_z. See
    # Checklist - Fix Ground Alignment Evaluated-Mesh Bug.md.
    evaluated_obj = body.evaluated_get(depsgraph)
    masked_mesh = evaluated_obj.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)

    floor_z, crown_z_fallback = bounds_z(body, masked_mesh)
    scalp_points = group_world_points(body, masked_mesh, "scalp")
    crown_z = max((p.z for p in scalp_points), default=crown_z_fallback)
    nipple_center = group_center(body, masked_mesh, "nippleTip") or group_center(body, masked_mesh, "nipple")
    nipple_points = group_world_points(body, masked_mesh, "nippleTip") or group_world_points(body, masked_mesh, "nipple")
    evaluated_obj.to_mesh_clear()

    # "joint-l-shoulder"/"joint-r-shoulder" are rig markers, not part of the
    # 'body' surface group, so the Mask modifier drops them from the mesh
    # above - only these two lookups need the unmasked mesh.
    unmasked_mesh, restore_masks = unmasked_evaluated_mesh(body)
    l_shoulder = group_center(body, unmasked_mesh, "joint-l-shoulder")
    r_shoulder = group_center(body, unmasked_mesh, "joint-r-shoulder")
    restore_masks()
    depsgraph = bpy.context.evaluated_depsgraph_get()  # fresh handle after the modifier-visibility round trip

    measured = {}
    notes = {}

    measured["M-001_height"] = round((crown_z - floor_z) * M_TO_CM, 2)
    notes["M-001_height"] = "floor z=0 to max z of 'scalp' vertex group (crown proxy)"

    shoulder_width_m = None
    if l_shoulder and r_shoulder:
        dx = l_shoulder[0] - r_shoulder[0]
        dy = l_shoulder[1] - r_shoulder[1]
        dz = l_shoulder[2] - r_shoulder[2]
        shoulder_width_m = (dx**2 + dy**2 + dz**2) ** 0.5
        measured["M-007_shoulder_width"] = round(shoulder_width_m * M_TO_CM, 2)
        notes["M-007_shoulder_width"] = "distance between joint-l-shoulder and joint-r-shoulder vertex-group centers"
        shoulder_z = (l_shoulder[2] + r_shoulder[2]) / 2.0
    else:
        shoulder_z = crown_z - 0.30
    max_torso_width_m = shoulder_width_m * 1.05 if shoulder_width_m else None

    if nipple_center:
        nipple_z = nipple_center[2]
        left_points = [p for p in nipple_points if p.x > 0]
        right_points = [p for p in nipple_points if p.x < 0]
        if left_points and right_points:
            lc = [sum(p[i] for p in left_points) / len(left_points) for i in range(3)]
            rc = [sum(p[i] for p in right_points) / len(right_points) for i in range(3)]
            spacing = ((lc[0] - rc[0]) ** 2 + (lc[1] - rc[1]) ** 2 + (lc[2] - rc[2]) ** 2) ** 0.5
            measured["M-012_bust_point_spacing"] = round(spacing * M_TO_CM, 2)
            notes["M-012_bust_point_spacing"] = "distance between left/right 'nippleTip' vertex-group centers (nipple used as bust-point proxy; not a TD-approved BustPoint landmark)"
        measured["M-013_bust_point_height"] = round((nipple_z - floor_z) * M_TO_CM, 2)
        notes["M-013_bust_point_height"] = "floor z=0 to 'nippleTip' vertex-group average z (nipple used as bust-point proxy)"
    else:
        nipple_z = shoulder_z - 0.20

    sanity = {}
    unreliable = {}

    bust_z, bust_len, bust_bbox, bust_rejected, bust_samples = scan(
        body, depsgraph, nipple_z - 0.08, shoulder_z - 0.02, 0.003, "max", max_width_m=max_torso_width_m,
    )
    if bust_z is not None:
        measured["M-002_full_bust"] = round(bust_len * M_TO_CM, 2)
        notes["M-002_full_bust"] = (
            f"max torso-only circumference scanned z in [nipple_z-8cm, shoulder_z-2cm], found at z={bust_z:.3f}m "
            f"({bust_rejected} of {len(bust_samples)} samples in range rejected as arm-contaminated, width > shoulder_width*1.05); "
            "generic MPFB body, NOT yet bra-fit-refined anatomy"
        )
        sanity["M-002_full_bust_bbox"] = bust_bbox
    else:
        unreliable["M-002_full_bust"] = (
            f"every sample in the scan window had a cross-section wider than the shoulder span "
            f"({bust_rejected} of {len(bust_samples)} rejected) — torso and arm appear fused at every height tried; "
            "no clean torso-only bust slice found in this rest pose"
        )

    waist_z, waist_len, waist_bbox, waist_rejected, waist_samples = scan(
        body, depsgraph, nipple_z - 0.35, nipple_z - 0.08, 0.005, "min", max_width_m=max_torso_width_m,
    )
    if waist_z is not None:
        measured["M-005_waist"] = round(waist_len * M_TO_CM, 2)
        notes["M-005_waist"] = f"min torso-only circumference scanned z in [nipple_z-35cm, nipple_z-8cm], found at z={waist_z:.3f}m; not a TD-approved waist level"
        sanity["M-005_waist_bbox"] = waist_bbox

    if waist_z is not None:
        hip_z, hip_len, hip_bbox, hip_rejected, hip_samples = scan(
            body, depsgraph, waist_z - 0.30, waist_z - 0.05, 0.005, "max", max_width_m=max_torso_width_m,
        )
        if hip_z is not None:
            measured["M-006_hip"] = round(hip_len * M_TO_CM, 2)
            notes["M-006_hip"] = f"max torso-only circumference scanned z in [waist_z-30cm, waist_z-5cm], found at z={hip_z:.3f}m; not a TD-approved hip level"
            sanity["M-006_hip_bbox"] = hip_bbox
    else:
        hip_z = hip_len = None

    # Diagnostic-only, provisional: no approved IMF/root landmark exists yet.
    provisional = {}
    if bust_z is not None:
        provisional_underbust_z = bust_z - 0.04
        underbust_len, underbust_components, underbust_bbox = circumference_at_z(body, depsgraph, provisional_underbust_z)
        if not (max_torso_width_m and underbust_bbox and underbust_bbox["width_x_cm"] > max_torso_width_m * M_TO_CM):
            provisional["M-003_underbust_candidate"] = round(underbust_len * M_TO_CM, 2)
            sanity["M-003_underbust_candidate_bbox"] = underbust_bbox
            if nipple_center:
                provisional["M-014_bp_to_underbust_candidate"] = round(abs(nipple_z - provisional_underbust_z) * M_TO_CM, 2)

    not_measurable = {
        "M-004_high_bust": "no approved landmark for upper-chest level above breast volume",
        "M-008_across_front": "no approved anterior armfold landmarks",
        "M-009_across_back": "no approved posterior armfold landmarks",
        "M-010_torso_length": "requires an approved surface-path definition, not a straight-line proxy",
        "M-011_underarm_depth": "no approved underarm-level landmark",
        "M-015_breast_root_width": "no approved root landmark (T-040 not started; body not yet bra-fit-refined, T-032)",
        "M-016_breast_root_height": "no approved root landmark",
        "M-017_breast_root_perimeter": "no approved root landmark",
        "M-018_breast_projection": "no approved torso reference plane",
        "M-019_breast_arc": "no approved root landmark",
        "M-020_inner_breast_spacing": "no approved root landmark",
    }

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "purpose": "Diagnostic observed-geometry check of the CURRENT draft body. Not a target value. Not TD-approved. Does not close T-020/T-021.",
        "blend_sha256": sha256(BLEND),
        "body": body.name,
        "unit": "cm (converted from Blender meters)",
        "measured": measured,
        "method_notes": notes,
        "cross_section_bbox_sanity_check": sanity,
        "unreliable_rejected": unreliable,
        "provisional_candidates_no_approved_landmark": provisional,
        "not_measurable_yet": not_measurable,
        "caveats": [
            "Body has not had bra-fit anatomy refinement (T-032) or anthropometric landmark authoring (T-040) yet.",
            "Bust/underbust/waist/hip planes above were located by scanning for geometric max/min circumference, not by TD-approved landmarks.",
            "Nipple vertex group used as a bust-point proxy; this is not the contract's named BustPoint landmark.",
            "These values must never be copied into the Target cm column of avatar_36C_measurements.md.",
            "2026-08-14: height/scalp/nipple reads now use the depsgraph-evaluated mesh, not raw body.data.vertices - see Checklist - Fix Ground Alignment Evaluated-Mesh Bug.md. Circumference scans (bust/waist/hip) already used the evaluated mesh via bmesh.from_object and were unaffected by that bug. Shoulder-width (joint-l/r-shoulder) needed a SEPARATE unmasked-mesh pass - those groups are rig markers outside the 'body' surface group, so MPFB's Mask modifier drops them from the normal evaluated mesh. Verified height=159.12cm now matches the browser/GLB-accessor cross-check exactly. Bust point spacing/height and hip changed from earlier runs because they derive from correctly-evaluated nipple/shoulder positions now, not because of a new bug - these remain heuristic candidates, not TD landmarks.",
        ],
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("DRAFT_BODY_MEASUREMENT=" + json.dumps(report, separators=(",", ":")))


if __name__ == "__main__":
    main()
