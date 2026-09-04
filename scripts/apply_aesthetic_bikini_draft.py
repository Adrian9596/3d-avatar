"""Apply reversible visual improvements and a technical coverage bikini.

This script intentionally does not change body measurements or claim TD approval.
The bikini is fitted to the current evaluated draft body and must be refitted after
the TD-approved master body and semantic morphs are frozen.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "avatar_36C_master.blend"
REPORT = ROOT / "qa" / "avatar_36C" / "aesthetic-bikini-build-report.json"
TOP_NAME = "avatar_36C_bikini_top"
BRIEF_NAME = "avatar_36C_bikini_brief"
SKIN_MATERIAL = "avatar_36C_skin_DRAFT"
BIKINI_MATERIAL = "avatar_36C_bikini_matte"
CLEARANCE = 0.002
THICKNESS = 0.001


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def set_bsdf_input(bsdf, name, value):
    socket = bsdf.inputs.get(name)
    if socket is not None:
        socket.default_value = value


def make_material(name: str, base_color, roughness: float, skin: bool = False):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*base_color, 1.0)
    material.metallic = 0.0
    material.roughness = roughness
    material.surface_render_method = "DITHERED"
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        set_bsdf_input(bsdf, "Base Color", (*base_color, 1.0))
        set_bsdf_input(bsdf, "Metallic", 0.0)
        set_bsdf_input(bsdf, "Roughness", roughness)
        set_bsdf_input(bsdf, "IOR", 1.45 if skin else 1.47)
        set_bsdf_input(bsdf, "Alpha", 1.0)
        set_bsdf_input(bsdf, "Transmission Weight", 0.0)
        set_bsdf_input(bsdf, "Specular IOR Level", 0.28 if skin else 0.22)
        set_bsdf_input(bsdf, "Coat Weight", 0.025 if skin else 0.0)
        set_bsdf_input(bsdf, "Coat Roughness", 0.45)
        set_bsdf_input(bsdf, "Subsurface Weight", 0.025 if skin else 0.0)
    material["asset_status"] = "DRAFT_NOT_TD_VALIDATED"
    material["pbr_compatible"] = True
    material["alpha"] = 1.0
    material["transmission"] = 0.0
    material["roughness_target"] = roughness
    return material


def body_object():
    bodies = [obj for obj in bpy.data.objects if obj.type == "MESH" and obj.get("asset_id") == "avatar_36C"]
    if len(bodies) != 1:
        raise RuntimeError(f"Expected one avatar body, found {[obj.name for obj in bodies]}")
    return bodies[0]


def remove_existing(name: str):
    obj = bpy.data.objects.get(name)
    if obj:
        data = obj.data if obj.type == "MESH" else None
        bpy.data.objects.remove(obj, do_unlink=True)
        if data and data.users == 0:
            bpy.data.meshes.remove(data)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0 and mesh.name.startswith(name + "_mesh"):
            bpy.data.meshes.remove(mesh)


def body_vertex_indices(body):
    group = body.vertex_groups.get("body")
    if not group:
        return set(range(len(body.data.vertices)))
    indices = set()
    for vertex in body.data.vertices:
        if any(membership.group == group.index and membership.weight > 0.5 for membership in vertex.groups):
            indices.add(vertex.index)
    return indices


def vertex_group_center(body, name):
    group = body.vertex_groups.get(name)
    if not group:
        raise RuntimeError(f"Missing required MPFB reference group {name}")
    points = []
    for vertex in body.data.vertices:
        if any(entry.group == group.index and entry.weight > 0.0 for entry in vertex.groups):
            points.append(body.matrix_world @ vertex.co)
    if not points:
        raise RuntimeError(f"Reference group {name} has no vertices")
    return Vector(tuple(sum(point[i] for point in points) / len(points) for i in range(3)))


def bilateral_vertex_group_centers(body, name):
    group = body.vertex_groups.get(name)
    if not group:
        raise RuntimeError(f"Missing required MPFB reference group {name}")
    buckets = {-1: [], 1: []}
    for vertex in body.data.vertices:
        if any(entry.group == group.index and entry.weight > 0.0 for entry in vertex.groups):
            point = body.matrix_world @ vertex.co
            if abs(point.x) > 1e-6:
                buckets[-1 if point.x < 0 else 1].append(point)
    return {
        sign: Vector(tuple(sum(point[i] for point in points) / len(points) for i in range(3)))
        for sign, points in buckets.items()
        if points
    }


def flatten_sensitive_contours(top_shell, centers):
    radius = 0.042
    world = top_shell.matrix_world
    inverse = world.inverted()
    normal_matrix = world.to_3x3().inverted().transposed()
    changed = 0
    for vertex in top_shell.data.vertices:
        point = world @ vertex.co
        normal = (normal_matrix @ vertex.normal).normalized()
        for center in centers.values():
            radial = ((point.x - center.x) ** 2 + (point.z - center.z) ** 2) ** 0.5
            if radial >= radius or point.y >= -0.13:
                continue
            outer_target = center.y - 0.0125
            target_y = outer_target if normal.y < 0.0 else outer_target + THICKNESS
            weight = (1.0 - radial / radius) ** 2 * 0.95
            point.y = point.y * (1.0 - weight) + target_y * weight
            vertex.co = inverse @ point
            changed += 1
            break
    top_shell.data.update()
    top_shell["privacy_liner_radius_m"] = radius
    top_shell["privacy_liner_method"] = "DOUBLE_LAYER_CONTOUR_FLATTENING"
    return changed


def triangle_cup(center: Vector):
    x_abs = abs(center.x)
    if not (0.018 <= x_abs <= 0.245 and center.y <= -0.025 and 1.055 <= center.z <= 1.315):
        return False
    upper_limit = 1.315 - 1.50 * abs(x_abs - 0.145)
    return center.z <= upper_limit


def top_face(center: Vector):
    band = 1.045 <= center.z <= 1.105 and abs(center.x) <= 0.255
    cups = triangle_cup(center)
    return band or cups


def brief_face(center: Vector):
    waistband = 0.905 <= center.z <= 0.985 and abs(center.x) <= 0.41
    if 0.685 <= center.z <= 0.96:
        progress = max(0.0, min(1.0, (center.z - 0.685) / 0.275))
        front_width = 0.085 + 0.24 * progress
        back_width = 0.115 + 0.25 * progress
        front = center.y < -0.005 and abs(center.x) <= front_width
        back = center.y >= -0.005 and abs(center.x) <= back_width
    else:
        front = back = False
    gusset = 0.655 <= center.z <= 0.76 and abs(center.x) <= 0.13
    return waistband or front or back or gusset


def connected_component_near(polygons, eval_mesh, matrix, seed):
    vertex_to_polygons = {}
    for local_index, polygon in enumerate(polygons):
        for vertex_index in polygon.vertices:
            vertex_to_polygons.setdefault(vertex_index, []).append(local_index)
    unseen = set(range(len(polygons)))
    components = []
    while unseen:
        start = unseen.pop()
        stack = [start]
        component = {start}
        while stack:
            current = stack.pop()
            for vertex_index in polygons[current].vertices:
                for neighbor in vertex_to_polygons[vertex_index]:
                    if neighbor in unseen:
                        unseen.remove(neighbor)
                        component.add(neighbor)
                        stack.append(neighbor)
        components.append(component)

    seed_vector = Vector(seed)
    chosen = min(
        components,
        key=lambda component: min((matrix @ polygons[index].center - seed_vector).length for index in component),
    )
    return [polygons[index] for index in sorted(chosen)], len(components)


def smooth_and_refit_boundary(obj, body, surface_factor, surface_iterations):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    boundary = list({vertex for edge in bm.edges if edge.is_boundary for vertex in edge.verts})
    for _ in range(10):
        bmesh.ops.smooth_vert(
            bm,
            verts=boundary,
            factor=0.32,
            use_axis_x=True,
            use_axis_y=True,
            use_axis_z=True,
        )
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

    bpy.context.view_layer.objects.active = obj
    subdivision = obj.modifiers.new("PatternEdgeSubdivision", "SUBSURF")
    subdivision.subdivision_type = "CATMULL_CLARK"
    subdivision.levels = 1
    subdivision.render_levels = 1
    bpy.ops.object.modifier_apply(modifier=subdivision.name)

    shrinkwrap = obj.modifiers.new("RefitToFullBody", "SHRINKWRAP")
    shrinkwrap.target = body
    shrinkwrap.wrap_method = "NEAREST_SURFACEPOINT"
    shrinkwrap.wrap_mode = "ABOVE_SURFACE"
    shrinkwrap.offset = CLEARANCE
    bpy.ops.object.modifier_apply(modifier=shrinkwrap.name)

    smooth = obj.modifiers.new("FabricSurfaceSmoothing", "SMOOTH")
    smooth.factor = surface_factor
    smooth.iterations = surface_iterations
    bpy.ops.object.modifier_apply(modifier=smooth.name)


def extract_shell(body, eval_mesh, allowed_indices, predicate, seed, name, material, surface_factor, surface_iterations):
    matrix = body.matrix_world
    normal_matrix = matrix.to_3x3().inverted().transposed()
    selected = []
    for polygon in eval_mesh.polygons:
        if not all(index in allowed_indices for index in polygon.vertices):
            continue
        center = matrix @ polygon.center
        if predicate(center):
            selected.append(polygon)
    if not selected:
        raise RuntimeError(f"No polygons selected for {name}")
    selected, component_count = connected_component_near(selected, eval_mesh, matrix, seed)

    used = sorted({index for polygon in selected for index in polygon.vertices})
    remap = {old: new for new, old in enumerate(used)}
    vertices = []
    for index in used:
        source = eval_mesh.vertices[index]
        world = matrix @ source.co
        normal = (normal_matrix @ source.normal).normalized()
        vertices.append(tuple(world + normal * CLEARANCE))
    faces = [tuple(remap[index] for index in polygon.vertices) for polygon in selected]

    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    smooth_and_refit_boundary(obj, body, surface_factor, surface_iterations)
    solidify = obj.modifiers.new("TechnicalFabricThickness", "SOLIDIFY")
    solidify.thickness = THICKNESS
    solidify.offset = -1.0
    solidify.use_rim = True
    solidify.use_even_offset = True
    bpy.ops.object.modifier_apply(modifier=solidify.name)

    obj["asset_id"] = "avatar_36C"
    obj["asset_status"] = "DRAFT_NOT_TD_VALIDATED"
    obj["garment_clearance_m"] = CLEARANCE
    obj["garment_thickness_m"] = THICKNESS
    obj["coverage_scope"] = "BASE_POSE_DRAFT_REQUIRES_FINAL_MORPH_AND_RIG_QA"
    return obj, len(selected), component_count


def surface_point(eval_mesh, allowed_indices, x: float, z: float, front: bool):
    candidates = []
    for index in allowed_indices:
        point = eval_mesh.vertices[index].co
        score = abs(point.x - x) * 3.0 + abs(point.z - z) * 4.0
        candidates.append((score, point.copy()))
    if not candidates:
        raise RuntimeError(f"Could not find surface near x={x}, z={z}")
    # Prefer the outer surface after proximity has constrained the anatomical region.
    candidates.sort(key=lambda item: (item[0], item[1].y if front else -item[1].y))
    nearby = [item[1] for item in candidates[:64]]
    return min(nearby, key=lambda point: point.y) if front else max(nearby, key=lambda point: point.y)


def add_strap(name, points, material):
    curve = bpy.data.curves.new(name + "_curve", type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 10
    curve.bevel_depth = 0.0045
    curve.bevel_resolution = 3
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for control, coordinate in zip(spline.points, points):
        control.co = (*coordinate, 1.0)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    return obj


def cup_anchor(top_shell, sign):
    candidates = []
    for vertex in top_shell.data.vertices:
        point = top_shell.matrix_world @ vertex.co
        if sign * point.x > 0.035 and abs(point.x) < 0.24 and point.y < -0.015 and point.z > 1.14:
            candidates.append(point)
    if not candidates:
        raise RuntimeError(f"Could not resolve cup anchor for sign {sign}")
    return max(candidates, key=lambda point: point.z)


def join_objects(objects, final_name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.active_object
    joined.name = final_name
    joined.data.name = final_name + "_mesh"
    joined.location = (0.0, 0.0, 0.0)
    joined.rotation_euler = (0.0, 0.0, 0.0)
    joined.scale = (1.0, 1.0, 1.0)
    return joined


def main():
    if Path(bpy.data.filepath).resolve() != BLEND.resolve():
        raise RuntimeError(f"Expected {BLEND}, got {bpy.data.filepath}")
    remove_existing(TOP_NAME)
    remove_existing(BRIEF_NAME)

    body = body_object()
    skin = make_material(SKIN_MATERIAL, (0.50, 0.285, 0.215), 0.56, skin=True)
    bikini = make_material(BIKINI_MATERIAL, (0.018, 0.045, 0.105), 0.66, skin=False)
    body.data.materials.clear()
    body.data.materials.append(skin)
    for polygon in body.data.polygons:
        polygon.use_smooth = True
    body["visual_treatment"] = "PROFESSIONAL_APPAREL_FIT_MODEL_DRAFT"
    body["object_role"] = "BODY"

    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    eval_mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    allowed = body_vertex_indices(body)

    bpy.ops.object.select_all(action="DESELECT")
    top_shell, top_source_faces, top_components = extract_shell(
        body,
        eval_mesh,
        allowed,
        top_face,
        (0.0, -0.12, 1.08),
        TOP_NAME + "_shell",
        bikini,
        0.25,
        4,
    )
    privacy_vertices = flatten_sensitive_contours(top_shell, bilateral_vertex_group_centers(body, "nippleTip"))

    straps = []
    for side, x in (("L", -0.165), ("R", 0.165)):
        sign = -1 if x < 0 else 1
        front_cup = cup_anchor(top_shell, sign)
        shoulder_group = "joint-r-shoulder" if x < 0 else "joint-l-shoulder"
        shoulder = vertex_group_center(body, shoulder_group)
        shoulder_front = surface_point(eval_mesh, allowed, shoulder.x, shoulder.z, True)
        shoulder_back = surface_point(eval_mesh, allowed, shoulder.x, shoulder.z, False)
        back_band = surface_point(eval_mesh, allowed, sign * 0.15, 1.095, False)
        shoulder_top = Vector(
            (
                shoulder.x,
                (shoulder_front.y + shoulder_back.y) / 2.0,
                max(shoulder_front.z, shoulder_back.z) + 0.006,
            )
        )
        points = [
            Vector((front_cup.x, front_cup.y - 0.008, front_cup.z)),
            Vector(((front_cup.x + shoulder_front.x) / 2.0, (front_cup.y + shoulder_front.y) / 2.0 - 0.012, (front_cup.z + shoulder_front.z) / 2.0 + 0.010)),
            Vector((shoulder_front.x, shoulder_front.y - 0.012, shoulder_front.z + 0.008)),
            Vector((shoulder_top.x, shoulder_top.y, shoulder_top.z + 0.015)),
            Vector((shoulder_back.x, shoulder_back.y + 0.012, shoulder_back.z + 0.008)),
            Vector(((shoulder_back.x + back_band.x) / 2.0, (shoulder_back.y + back_band.y) / 2.0 + 0.012, (shoulder_back.z + back_band.z) / 2.0)),
            Vector((back_band.x, back_band.y + 0.012, back_band.z)),
        ]
        bpy.ops.object.select_all(action="DESELECT")
        straps.append(add_strap(f"{TOP_NAME}_strap_{side}", points, bikini))
    top = join_objects([top_shell, *straps], TOP_NAME)
    top["garment_role"] = "TECHNICAL_BIKINI_TOP"
    top["object_role"] = "BIKINI_TOP"

    bpy.ops.object.select_all(action="DESELECT")
    brief, brief_source_faces, brief_components = extract_shell(
        body,
        eval_mesh,
        allowed,
        brief_face,
        (0.0, -0.10, 0.84),
        BRIEF_NAME,
        bikini,
        0.08,
        2,
    )
    brief["garment_role"] = "TECHNICAL_BIKINI_BRIEF"
    brief["object_role"] = "BIKINI_BRIEF"
    evaluated.to_mesh_clear()

    for obj in (top, brief):
        obj.hide_render = False
        obj.hide_viewport = False
        obj["material_contract"] = "OPAQUE_ALPHA_1_TRANSMISSION_0"
        obj["source_author"] = "Project-authored procedural draft"
        obj["license_status"] = "PROJECT_OWNED_DRAFT"

    bpy.context.scene["aesthetic_bikini_requirements"] = "AVATAR_AESTHETIC_BIKINI_REQUIREMENTS.md"
    bpy.context.scene["bikini_status"] = "BASE_POSE_VISUAL_DRAFT"
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), check_existing=False)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "blend": str(BLEND.relative_to(ROOT)),
        "blend_sha256": sha256(BLEND),
        "body_geometry_changed": False,
        "body_material": SKIN_MATERIAL,
        "bikini_material": BIKINI_MATERIAL,
        "material_contract": {
            "alpha": 1.0,
            "transmission": 0.0,
            "roughness": 0.66,
            "metallic": 0.0,
            "thickness_m": THICKNESS,
            "nominal_clearance_m": CLEARANCE,
        },
        "objects": {
            TOP_NAME: {
                "vertices": len(top.data.vertices),
                "polygons": len(top.data.polygons),
                "source_body_faces": top_source_faces,
                "candidate_connected_components": top_components,
                "privacy_liner_vertices_adjusted": privacy_vertices,
            },
            BRIEF_NAME: {
                "vertices": len(brief.data.vertices),
                "polygons": len(brief.data.polygons),
                "source_body_faces": brief_source_faces,
                "candidate_connected_components": brief_components,
            },
        },
        "warning": "Base-pose visual draft only. Refit after TD master, required semantic morphs and rig are frozen.",
    }
    REPORT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print("AESTHETIC_BIKINI_REPORT=" + json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
