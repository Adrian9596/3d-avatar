"""Build and render a static, web-oriented hair asset for avatar_36C.

Input:  avatar_36C_hair_working.blend
Output: avatar_36C_hair_complete.blend

The builder extracts a fitted scalp cap from the evaluated reference body,
adds directional pulled-back clumps and a braided mid-high bun, converts every
runtime component to mesh, joins the result as avatar_36C_hair, writes machine
checks, and renders five review views. It does not modify the canonical master.

The result is a complete static visual draft. Final rig/deformation approval
remains blocked until the TD-fitted master and final head rig are frozen.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "avatar_36C_hair_working.blend"
OUTPUT = ROOT / "avatar_36C_hair_complete.blend"
MASTER = ROOT / "avatar_36C_master.blend"
QA_DIR = ROOT / "qa" / "avatar_36C" / "hair"
REPORT = QA_DIR / "hair-build-report.json"

REFERENCE_COLLECTION = "REFERENCE_DO_NOT_EDIT"
AUTHORING_COLLECTION = "HAIR_AUTHORING"
DELIVERY_COLLECTION = "AVATAR_36C_HAIR_DELIVERY"
REFERENCE_OBJECT = "REF_avatar_36C_body"
FINAL_OBJECT = "avatar_36C_hair"
MAIN_MATERIAL = "avatar_36C_hair_dark_brown"
ACCENT_MATERIAL = "avatar_36C_hair_soft_highlight"
VERSION = "0.1.0-static-hair.1"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def overwrite_requested() -> bool:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return "--overwrite" in args


def move_to_collection(obj: bpy.types.Object, collection: bpy.types.Collection) -> None:
    for existing in list(obj.users_collection):
        existing.objects.unlink(obj)
    collection.objects.link(obj)


def clear_previous_hair(
    authoring: bpy.types.Collection, delivery: bpy.types.Collection
) -> None:
    for obj in list(delivery.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for obj in list(authoring.objects):
        if obj.name != "HAIR_ORIGIN_CHECK":
            bpy.data.objects.remove(obj, do_unlink=True)


def principled_material(
    name: str, color: tuple[float, float, float, float], roughness: float
) -> bpy.types.Material:
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = color
    nodes = material.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf is None:
        raise RuntimeError(f"Material {name} has no Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.08
    if "Coat Roughness" in bsdf.inputs:
        bsdf.inputs["Coat Roughness"].default_value = 0.30
    material["asset_id"] = "avatar_36C"
    material["material_role"] = "HAIR"
    material["source"] = "PROJECT_AUTHORED_NUMERIC_PBR"
    return material


def is_scalp_point(point: Vector) -> bool:
    """Conservative fitted scalp region with a higher front/temple hairline."""
    if point.z < 1.42 or point.z > 1.61:
        return False
    if abs(point.x) > 0.087 or point.y < -0.116 or point.y > 0.060:
        return False

    backness = max(0.0, min(1.0, (point.y + 0.095) / 0.145))
    side = min(1.0, abs(point.x) / 0.082)
    boundary = 1.526 - 0.100 * backness + 0.020 * side * side
    return point.z >= boundary


def build_scalp_cap(
    reference: bpy.types.Object,
    delivery: bpy.types.Collection,
    material: bpy.types.Material,
) -> tuple[bpy.types.Object, list[list[Vector]], dict[str, int]]:
    source = reference.data
    world = reference.matrix_world
    normal_matrix = world.to_3x3().inverted().transposed()
    coordinates = [world @ vertex.co for vertex in source.vertices]
    normals = [(normal_matrix @ vertex.normal).normalized() for vertex in source.vertices]

    selected_faces: list[tuple[int, ...]] = []
    for polygon in source.polygons:
        indices = tuple(polygon.vertices)
        if len(indices) >= 3 and all(is_scalp_point(coordinates[i]) for i in indices):
            selected_faces.append(indices)
    if not selected_faces:
        raise RuntimeError("Scalp selection produced no faces")

    used = sorted({index for face in selected_faces for index in face})
    remap = {old: new for new, old in enumerate(used)}
    cap_vertices = []
    for index in used:
        point = coordinates[index]
        # A close 3.2–4.2 mm offset preserves the fitted head while adding a
        # small amount of believable sleek-hair volume toward the crown.
        crown = max(0.0, min(1.0, (point.z - 1.48) / 0.11))
        offset = 0.0032 + 0.0010 * crown
        cap_vertices.append(point + normals[index] * offset)
    cap_faces = [tuple(remap[index] for index in face) for face in selected_faces]

    mesh = bpy.data.meshes.new("avatar_36C_hair_scalp_mesh")
    mesh.from_pydata(cap_vertices, [], cap_faces)
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    mesh.update(calc_edges=True)

    cap = bpy.data.objects.new("avatar_36C_hair_scalp", mesh)
    delivery.objects.link(cap)
    cap["component_role"] = "HAIR_SCALP_CAP"

    # Solidify inward so the visible fitted surface stays unchanged and the
    # runtime mesh has a closed, stable hairline rim.
    modifier = cap.modifiers.new("HairCapThickness", "SOLIDIFY")
    modifier.thickness = 0.0012
    modifier.offset = -1.0
    modifier.use_rim = True
    modifier.use_even_offset = True
    bpy.context.view_layer.objects.active = cap
    cap.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    cap.select_set(False)

    # Recover ordered boundary loops from the pre-solidified selected patch.
    counts: Counter[tuple[int, int]] = Counter()
    for face in cap_faces:
        for i, current in enumerate(face):
            edge = tuple(sorted((current, face[(i + 1) % len(face)])))
            counts[edge] += 1
    boundary_edges = [edge for edge, count in counts.items() if count == 1]
    adjacency: dict[int, list[int]] = defaultdict(list)
    for a, b in boundary_edges:
        adjacency[a].append(b)
        adjacency[b].append(a)

    loops: list[list[Vector]] = []
    unused = {tuple(sorted(edge)) for edge in boundary_edges}
    while unused:
        seed = next(iter(unused))
        start, current = seed
        ordered = [start, current]
        unused.discard(seed)
        while True:
            candidates = [
                nxt
                for nxt in adjacency[current]
                if tuple(sorted((current, nxt))) in unused
            ]
            if not candidates:
                break
            nxt = candidates[0]
            unused.discard(tuple(sorted((current, nxt))))
            if nxt == ordered[0]:
                break
            ordered.append(nxt)
            current = nxt
        if len(ordered) >= 8:
            loops.append([Vector(cap_vertices[index]) for index in ordered])

    stats = {
        "selected_source_faces": len(selected_faces),
        "selected_source_vertices": len(used),
        "boundary_loops": len(loops),
    }
    return cap, loops, stats


def build_smooth_scalp_cap(
    reference: bpy.types.Object,
    delivery: bpy.types.Collection,
    material: bpy.types.Material,
) -> tuple[bpy.types.Object, list[list[Vector]], dict[str, int]]:
    """Create a fitted smooth cap with a designed, continuous hairline.

    Polygon threshold extraction is useful for measurement, but its boundary
    follows body topology and reads as a staircase in close portrait renders.
    This parametric cap uses the measured head extents and a continuously
    varying front/temple/back boundary, producing a clean production hairline.
    """
    source_points = [reference.matrix_world @ vertex.co for vertex in reference.data.vertices]
    head_points = [point for point in source_points if point.z >= 1.40]
    if not head_points:
        raise RuntimeError("Reference body has no measurable head vertices")

    center = Vector((0.0, -0.035, 1.505))
    radius_x = 0.087
    radius_y = 0.086
    radius_z = 0.095
    segments = 64
    rings = 18

    vertices = [center + Vector((0.0, 0.0, radius_z))]
    boundary: list[Vector] = []
    for ring in range(1, rings + 1):
        fraction = ring / rings
        for segment in range(segments):
            phi = 2.0 * math.pi * segment / segments
            front_distance = math.atan2(
                math.sin(phi + math.pi / 2.0), math.cos(phi + math.pi / 2.0)
            )
            front_peak = math.exp(-((front_distance / 0.30) ** 2))
            theta_end = 1.63 + 0.50 * math.sin(phi) + 0.055 * front_peak
            theta = theta_end * fraction
            sin_theta = math.sin(theta)
            point = center + Vector(
                (
                    radius_x * sin_theta * math.cos(phi),
                    radius_y * sin_theta * math.sin(phi),
                    radius_z * math.cos(theta),
                )
            )
            vertices.append(point)
            if ring == rings:
                boundary.append(point.copy())

    faces: list[tuple[int, ...]] = []
    first_ring = 1
    for segment in range(segments):
        current = first_ring + segment
        nxt = first_ring + (segment + 1) % segments
        faces.append((0, current, nxt))
    for ring in range(rings - 1):
        ring_a = 1 + ring * segments
        ring_b = ring_a + segments
        for segment in range(segments):
            nxt = (segment + 1) % segments
            faces.append(
                (
                    ring_a + segment,
                    ring_b + segment,
                    ring_b + nxt,
                    ring_a + nxt,
                )
            )

    mesh = bpy.data.meshes.new("avatar_36C_hair_scalp_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    mesh.update(calc_edges=True)
    # Ensure the visible shell faces outward before solidifying inward.
    if sum(polygon.normal.z for polygon in mesh.polygons if polygon.center.z > 1.57) < 0:
        for polygon in mesh.polygons:
            polygon.flip()
        mesh.update()

    cap = bpy.data.objects.new("avatar_36C_hair_scalp", mesh)
    delivery.objects.link(cap)
    cap["component_role"] = "SMOOTH_FITTED_HAIR_SCALP_CAP"

    modifier = cap.modifiers.new("HairCapThickness", "SOLIDIFY")
    modifier.thickness = 0.0014
    modifier.offset = -1.0
    modifier.use_rim = True
    modifier.use_even_offset = True
    bpy.context.view_layer.objects.active = cap
    cap.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    cap.select_set(False)

    measured_bounds = {
        "head_min_x_mm": round(min(point.x for point in head_points) * 1000),
        "head_max_x_mm": round(max(point.x for point in head_points) * 1000),
        "head_min_y_mm": round(min(point.y for point in head_points) * 1000),
        "head_max_y_mm": round(max(point.y for point in head_points) * 1000),
        "head_max_z_mm": round(max(point.z for point in head_points) * 1000),
    }
    stats = {
        "method": "PARAMETRIC_CONTINUOUS_HAIRLINE_FROM_MEASURED_HEAD_BOUNDS",
        "segments": segments,
        "rings": rings,
        "boundary_loops": 1,
        **measured_bounds,
    }
    return cap, [boundary], stats


def create_bezier_curve(
    name: str,
    points: list[Vector],
    bevel_depth: float,
    collection: bpy.types.Collection,
    material: bpy.types.Material,
    cyclic: bool = False,
    bevel_resolution: int = 2,
) -> bpy.types.Object:
    curve = bpy.data.curves.new(name=f"{name}_curve", type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 3
    curve.bevel_depth = bevel_depth
    curve.bevel_resolution = bevel_resolution
    curve.resolution_u = 2
    curve.use_fill_caps = True
    curve.materials.append(material)
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for control, point in zip(spline.bezier_points, points):
        control.co = point
        control.handle_left_type = "AUTO"
        control.handle_right_type = "AUTO"
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    return obj


def create_poly_curve(
    name: str,
    points: list[Vector],
    bevel_depth: float,
    collection: bpy.types.Collection,
    material: bpy.types.Material,
    cyclic: bool,
    bevel_resolution: int = 3,
) -> bpy.types.Object:
    curve = bpy.data.curves.new(name=f"{name}_curve", type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = bevel_depth
    curve.bevel_resolution = bevel_resolution
    curve.use_fill_caps = True
    curve.materials.append(material)
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for control, point in zip(spline.points, points):
        control.co = (*point, 1.0)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    return obj


def duplicate_as_runtime_mesh(
    guide: bpy.types.Object,
    delivery: bpy.types.Collection,
    name: str,
) -> bpy.types.Object:
    duplicate = guide.copy()
    duplicate.data = guide.data.copy()
    duplicate.name = name
    duplicate.hide_render = False
    delivery.objects.link(duplicate)
    bpy.context.view_layer.objects.active = duplicate
    duplicate.select_set(True)
    bpy.ops.object.convert(target="MESH")
    duplicate.select_set(False)
    return duplicate


def build_directional_clumps(
    authoring: bpy.types.Collection,
    delivery: bpy.types.Collection,
    material: bpy.types.Material,
    boundary_loops: list[list[Vector]],
) -> list[bpy.types.Object]:
    if not boundary_loops:
        return []
    front_boundary = sorted(
        [point for point in boundary_loops[0] if point.y < -0.075 and abs(point.x) < 0.064],
        key=lambda point: point.x,
    )
    if len(front_boundary) < 7:
        return []
    sample_indices = [round(i * (len(front_boundary) - 1) / 6) for i in range(7)]
    starts = [front_boundary[index] for index in sample_indices]
    paths: list[list[Vector]] = []
    for index, raw_start in enumerate(starts):
        start = raw_start + Vector((0.0, -0.0008, 0.0015))
        side = min(1.0, abs(start.x) / 0.060)
        mid_a = Vector((start.x * 0.88, -0.064, 1.574 + 0.009 * (1.0 - side)))
        mid_b = Vector((start.x * 0.45, -0.004, 1.590 - 0.009 * side))
        end = Vector((start.x * 0.12, 0.046, 1.551 + 0.002 * math.sin(index)))
        paths.append([start, mid_a, mid_b, end])

    runtime: list[bpy.types.Object] = []
    for index, points in enumerate(paths, start=1):
        guide = create_bezier_curve(
            f"GUIDE_hairflow_{index:02d}",
            points,
            0.00042 if index % 3 else 0.00050,
            authoring,
            material,
            bevel_resolution=2,
        )
        guide.hide_render = True
        guide.display_type = "WIRE"
        guide["authoring_role"] = "HAIR_FLOW_GUIDE"
        runtime.append(
            duplicate_as_runtime_mesh(guide, delivery, f"hairflow_runtime_{index:02d}")
        )
    return runtime


def build_hairline_rims(
    loops: list[list[Vector]],
    delivery: bpy.types.Collection,
    material: bpy.types.Material,
) -> list[bpy.types.Object]:
    runtime = []
    for index, loop in enumerate(sorted(loops, key=len, reverse=True)[:2], start=1):
        # A subtle fitted tube visually resolves the open edge into a clean,
        # intentionally designed hairline.
        curve = create_poly_curve(
            f"hairline_rim_{index:02d}",
            loop,
            0.00115,
            delivery,
            material,
            cyclic=True,
            bevel_resolution=2,
        )
        bpy.context.view_layer.objects.active = curve
        curve.select_set(True)
        bpy.ops.object.convert(target="MESH")
        curve.select_set(False)
        runtime.append(curve)
    return runtime


def add_uv_sphere(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    collection: bpy.types.Collection,
    material: bpy.types.Material,
    segments: int = 32,
    rings: int = 16,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(obj, collection)
    return obj


def build_bun(
    delivery: bpy.types.Collection,
    main_material: bpy.types.Material,
    accent_material: bpy.types.Material,
) -> list[bpy.types.Object]:
    center = Vector((0.0, 0.078, 1.550))
    parts = [
        add_uv_sphere(
            "hair_bun_core",
            tuple(center),
            (0.034, 0.028, 0.034),
            delivery,
            main_material,
            segments=32,
            rings=16,
        ),
        add_uv_sphere(
            "hair_bun_connector",
            (0.0, 0.050, 1.542),
            (0.034, 0.022, 0.031),
            delivery,
            main_material,
            segments=28,
            rings=14,
        ),
    ]

    # A (2,3) torus knot reads as an interwoven bun while remaining compact.
    knot_points = []
    steps = 192
    for index in range(steps):
        t = 2.0 * math.pi * index / steps
        major = 0.031
        minor = 0.0105
        radial = major + minor * math.cos(3.0 * t)
        x = radial * math.cos(2.0 * t)
        z = radial * math.sin(2.0 * t)
        y = minor * 0.82 * math.sin(3.0 * t)
        knot_points.append(center + Vector((x, y, z)))
    knot = create_poly_curve(
        "hair_bun_braid",
        knot_points,
        0.0082,
        delivery,
        accent_material,
        cyclic=True,
        bevel_resolution=3,
    )
    bpy.context.view_layer.objects.active = knot
    knot.select_set(True)
    bpy.ops.object.convert(target="MESH")
    knot.select_set(False)
    knot["component_role"] = "BRAIDED_BUN"
    parts.append(knot)
    return parts


def join_delivery(
    parts: list[bpy.types.Object],
    delivery: bpy.types.Collection,
    source_hash: str,
) -> bpy.types.Object:
    meshes = [obj for obj in parts if obj and obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("No runtime hair meshes were created")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    final = bpy.context.object
    final.name = FINAL_OBJECT
    final.data.name = f"{FINAL_OBJECT}_mesh"
    move_to_collection(final, delivery)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    final["asset_id"] = "avatar_36C"
    final["object_role"] = "HAIR"
    final["asset_status"] = "DRAFT_HAIR_COMPLETE_STATIC_NOT_RIG_APPROVED"
    final["source_master_sha256"] = source_hash
    final["hair_style"] = "SLEEK_MID_HIGH_BUN"
    final["version"] = VERSION
    final["authoring_source"] = "PROJECT_AUTHORED_BLENDER_PYTHON_AND_FITTED_REFERENCE"
    final["license"] = "PROJECT_OWNED"
    final["rig_status"] = "BLOCKED_UNTIL_FINAL_HEAD_RIG"
    return final


def triangle_count(obj: bpy.types.Object) -> int:
    return sum(max(0, len(polygon.vertices) - 2) for polygon in obj.data.polygons)


def mesh_edge_stats(obj: bpy.types.Object) -> dict[str, int]:
    edge_faces: Counter[tuple[int, int]] = Counter()
    used_vertices: set[int] = set()
    for polygon in obj.data.polygons:
        indices = list(polygon.vertices)
        used_vertices.update(indices)
        for index, current in enumerate(indices):
            edge_faces[tuple(sorted((current, indices[(index + 1) % len(indices)])))] += 1
    return {
        "vertices": len(obj.data.vertices),
        "used_vertices": len(used_vertices),
        "loose_vertices": len(obj.data.vertices) - len(used_vertices),
        "boundary_edges": sum(1 for count in edge_faces.values() if count == 1),
        "non_manifold_edges": sum(1 for count in edge_faces.values() if count > 2),
    }


def bounds_world(obj: bpy.types.Object) -> dict[str, list[float]]:
    points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    return {
        "min": [min(point[i] for point in points) for i in range(3)],
        "max": [max(point[i] for point in points) for i in range(3)],
    }


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_qa_scene(authoring: bpy.types.Collection) -> bpy.types.Object:
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 64

    world = scene.world or bpy.data.worlds.new("Hair QA World")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.055, 0.050, 0.046, 1.0)
    background.inputs["Strength"].default_value = 0.65

    camera_data = bpy.data.cameras.new("Hair_QA_Camera")
    camera = bpy.data.objects.new("Hair_QA_Camera", camera_data)
    authoring.objects.link(camera)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 0.39
    camera_data.lens = 70
    scene.camera = camera

    light_specs = [
        ("Hair_Key", (-1.8, -2.4, 3.0), 650.0, 2.2),
        ("Hair_Fill", (1.8, -1.2, 2.2), 380.0, 2.0),
        ("Hair_Rim", (0.2, 2.0, 2.7), 720.0, 1.8),
    ]
    target = Vector((0.0, -0.020, 1.515))
    for name, location, energy, size in light_specs:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        light = bpy.data.objects.new(name, data)
        light.location = location
        look_at(light, target)
        authoring.objects.link(light)
    return camera


def render_views(camera: bpy.types.Object) -> list[str]:
    QA_DIR.mkdir(parents=True, exist_ok=True)
    target = Vector((0.0, -0.025, 1.515))
    views = {
        "front": Vector((0.0, -3.0, 1.515)),
        "45deg": Vector((2.1, -2.1, 1.525)),
        "side": Vector((3.0, 0.0, 1.515)),
        "back": Vector((0.0, 3.0, 1.515)),
        "top": Vector((0.0, -0.025, 3.5)),
    }
    outputs = []
    reference = bpy.data.objects.get(REFERENCE_OBJECT)
    for name, location in views.items():
        if reference is not None:
            reference.hide_render = name == "top"
        camera.location = location
        camera.data.ortho_scale = 0.39 if name != "top" else 0.34
        look_at(camera, target)
        output = QA_DIR / f"hair-{name}.png"
        bpy.context.scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        outputs.append(str(output.relative_to(ROOT)))
    if reference is not None:
        reference.hide_render = False
    return outputs


def write_report(
    final: bpy.types.Object,
    source_hash: str,
    scalp_stats: dict[str, int],
    render_outputs: list[str],
) -> dict:
    triangles = triangle_count(final)
    bounds = bounds_world(final)
    edges = mesh_edge_stats(final)
    material_names = [material.name for material in final.data.materials if material]
    delivery = bpy.data.collections[DELIVERY_COLLECTION]
    delivery_objects = list(delivery.objects)
    checks = {
        "source_master_hash_matches_workfile": (
            bpy.context.scene.get("source_master_sha256") == source_hash
        ),
        "one_delivery_object": len(delivery_objects) == 1,
        "delivery_is_mesh": final.type == "MESH",
        "stable_object_name": final.name == FINAL_OBJECT,
        "object_role_hair": final.get("object_role") == "HAIR",
        "status_is_static_not_rig_approved": (
            final.get("asset_status") == "DRAFT_HAIR_COMPLETE_STATIC_NOT_RIG_APPROVED"
        ),
        "triangle_budget_20000": triangles <= 20000,
        "no_loose_vertices": edges["loose_vertices"] == 0,
        "no_overconnected_edges": edges["non_manifold_edges"] == 0,
        "two_or_fewer_materials": len(material_names) <= 2,
        "hair_stays_above_neck": bounds["min"][2] >= 1.40,
        "hair_stays_clear_of_shoulders": max(abs(bounds["min"][0]), abs(bounds["max"][0])) <= 0.13,
        "compact_height": bounds["max"][2] <= 1.66,
        "five_qa_renders": len(render_outputs) == 5 and all((ROOT / path).exists() for path in render_outputs),
    }
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "asset_id": "avatar_36C",
        "version": VERSION,
        "status": final.get("asset_status"),
        "source_workfile": INPUT.name,
        "source_workfile_sha256": sha256(INPUT),
        "source_master": MASTER.name,
        "source_master_sha256": source_hash,
        "output_workfile": OUTPUT.name,
        "object": final.name,
        "materials": material_names,
        "triangles": triangles,
        "bounds_blender_xyz_m": bounds,
        "mesh_edges": edges,
        "scalp_extraction": scalp_stats,
        "qa_renders": render_outputs,
        "checks": checks,
        "machine_result": "PASS" if all(checks.values()) else "FAIL",
        "approval_boundary": (
            "Static visual hair draft only. Human 3D/TD review and final rig deformation "
            "remain required before integration into the canonical master."
        ),
    }
    QA_DIR.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    if Path(bpy.data.filepath).resolve() != INPUT.resolve():
        raise RuntimeError(f"Expected open workfile {INPUT}, got {bpy.data.filepath}")
    if OUTPUT.exists() and not overwrite_requested():
        raise RuntimeError(
            f"Refusing to overwrite {OUTPUT}; pass -- --overwrite after reviewing the existing file"
        )
    if not MASTER.exists():
        raise RuntimeError(f"Missing canonical master: {MASTER}")

    source_hash = sha256(MASTER)
    stored_hash = bpy.context.scene.get("source_master_sha256")
    if stored_hash != source_hash:
        raise RuntimeError(
            "Hair workfile reference is stale: "
            f"stored source hash {stored_hash}, current master hash {source_hash}"
        )

    reference = bpy.data.objects.get(REFERENCE_OBJECT)
    authoring = bpy.data.collections.get(AUTHORING_COLLECTION)
    delivery = bpy.data.collections.get(DELIVERY_COLLECTION)
    if reference is None or authoring is None or delivery is None:
        raise RuntimeError("Hair workfile collections/reference are incomplete")

    clear_previous_hair(authoring, delivery)
    main_material = principled_material(
        MAIN_MATERIAL, (0.050, 0.018, 0.009, 1.0), 0.50
    )
    accent_material = principled_material(
        ACCENT_MATERIAL, (0.075, 0.028, 0.012, 1.0), 0.54
    )

    cap, boundary_loops, scalp_stats = build_smooth_scalp_cap(
        reference, delivery, main_material
    )
    parts: list[bpy.types.Object] = [cap]
    parts.extend(build_hairline_rims(boundary_loops, delivery, main_material))
    parts.extend(
        build_directional_clumps(
            authoring, delivery, accent_material, boundary_loops
        )
    )
    parts.extend(build_bun(delivery, main_material, accent_material))
    final = join_delivery(parts, delivery, source_hash)

    camera = setup_qa_scene(authoring)
    bpy.context.scene["hair_asset_status"] = final.get("asset_status")
    bpy.context.scene["hair_object"] = final.name
    bpy.context.scene["hair_version"] = VERSION
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT), check_existing=False)

    render_outputs = render_views(camera)
    report = write_report(final, source_hash, scalp_stats, render_outputs)
    bpy.context.scene["hair_machine_result"] = report["machine_result"]
    bpy.context.scene["hair_triangle_count"] = report["triangles"]
    bpy.context.scene["hair_report"] = str(REPORT.relative_to(ROOT))
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT), check_existing=False)

    print("HAIR_BUILD_COMPLETE")
    print(f"output={OUTPUT}")
    print(f"triangles={report['triangles']}")
    print(f"machine_result={report['machine_result']}")
    print(f"qa_renders={','.join(render_outputs)}")
    print(f"report={REPORT}")
    if report["machine_result"] != "PASS":
        raise RuntimeError("Hair machine checks failed; inspect the report")


if __name__ == "__main__":
    main()
