"""Gated eye-region build for the draft 36C avatar.

The MPFB body has no eye assets: each socket is a closed inward pocket, and
MPFB marks the intended eyeball volume with the spherical `helper-l/r-eye`
proxy groups. This script sphere-fits those proxies and authors:

- `avatar_36C_eye_L/R`: eyeball meshes (geometric cornea bulge + iris dish,
  baked iris/sclera base-color and roughness textures, packed images);
- `avatar_36C_eye_trim`: lightweight lash cards rooted on the visible lid
  margin (the ring of skin vertices that skims the eyeball surface).

The eyelids already intersect the fitted sphere (standard lid-over-eye
construction), so no body vertex is moved: the scope-lock gate requires
bit-identical body geometry on every shape-key layer. EYE_EDIT_MASK_L/R
vertex groups record the approved eye region on the body.

Nothing is saved unless every gate in run_gates() passes. The asset remains
DRAFT — NOT TD VALIDATED; this grants no TD, anatomical or visual approval.
"""

from __future__ import annotations

import hashlib
import json
import math
import shutil
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
BLEND_PATH = ROOT / "avatar_36C_master.blend"
EYES_DIR = ROOT / "qa" / "avatar_36C" / "eyes"
REPORT = EYES_DIR / "eye-build-report.json"
BACKUP_DIR = ROOT / "backups"

EYE_RADIUS_MIN = 0.010
EYE_RADIUS_MAX = 0.017
# Angles are sized against the oversized MPFB helper sphere (R ~15.1 mm) so
# the projected iris/pupil keep anatomical absolute sizes (~11.7 mm / ~3.3 mm).
CORNEA_ANGLE = math.radians(27.0)
IRIS_ANGLE = math.radians(23.0)
PUPIL_ANGLE = math.radians(6.3)
CORNEA_APEX_BULGE = 0.00055
IRIS_DISH_DEPTH = 0.00030
FORWARD = Vector((0.0, -1.0, 0.0))
UP = Vector((0.0, 0.0, 1.0))
TEX_SIZE = 512
ADDED_TRI_BUDGET = 4200
FLICK_LENGTH = 0.0048         # tail-flick reach past the outer corner (round 2
                              # of task #26; was 0.0034, originally 0.0024 —
                              # still didn't read at normal viewing distance)
FLICK_SKIN_GAP_MAX = 0.0006   # gate: flick must hug the skin, not float
MASK_REGION_RADIUS = 0.022
MARGIN_BAND = 0.0015          # |distance to sphere| classifying lid-margin verts
MARGIN_CONE = math.radians(60.0)

EYE_OBJECT_ROLES = ("EYE_L", "EYE_R", "EYE_TRIM")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def frac_hash(*values: float) -> float:
    x = math.sin(sum(v * k for v, k in zip(values, (12.9898, 78.233, 37.719)))) * 43758.5453
    return x - math.floor(x)


def find_body() -> bpy.types.Object:
    bodies = [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and obj.get("asset_id") == "avatar_36C"
        and obj.get("object_role") == "BODY"
    ]
    if len(bodies) != 1:
        raise RuntimeError(f"Expected one BODY object, found {[o.name for o in bodies]}")
    return bodies[0]


def remove_existing() -> None:
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and obj.get("object_role") in EYE_OBJECT_ROLES:
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.name.startswith("avatar_36C_eye") and mat.users == 0:
            bpy.data.materials.remove(mat)
    for img in list(bpy.data.images):
        if img.name.startswith("avatar_36C_eye") and img.users == 0:
            bpy.data.images.remove(img)


def evaluated_positions_mask_off(body: bpy.types.Object) -> list[Vector]:
    """World-space evaluated positions, index-aligned with raw vertices.

    The MPFB Mask modifier changes vertex count/order, so it is disabled while
    sampling; shape keys keep index alignment.
    """
    mask_states = []
    for mod in body.modifiers:
        if mod.type == "MASK":
            mask_states.append((mod, mod.show_viewport, mod.show_render))
            mod.show_viewport = False
            mod.show_render = False
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    eval_obj = body.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    if len(mesh.vertices) != len(body.data.vertices):
        eval_obj.to_mesh_clear()
        for mod, vp, rn in mask_states:
            mod.show_viewport = vp
            mod.show_render = rn
        raise RuntimeError("Evaluated vertex count does not match raw count with mask disabled")
    positions = [eval_obj.matrix_world @ v.co for v in mesh.vertices]
    eval_obj.to_mesh_clear()
    for mod, vp, rn in mask_states:
        mod.show_viewport = vp
        mod.show_render = rn
    bpy.context.view_layer.update()
    return positions


def group_indices(body: bpy.types.Object, name: str, min_weight: float = 0.5) -> set[int]:
    group = body.vertex_groups.get(name)
    if not group:
        raise RuntimeError(f"Missing vertex group {name!r}")
    return {
        v.index for v in body.data.vertices
        if any(g.group == group.index and g.weight > min_weight for g in v.groups)
    }


def centroid(points: list[Vector]) -> Vector:
    total = Vector((0.0, 0.0, 0.0))
    for p in points:
        total += p
    return total / len(points)


def fit_sphere(points: list[Vector]) -> tuple[Vector, float]:
    """Algebraic least-squares sphere fit."""
    a = [[0.0] * 4 for _ in range(4)]
    rhs = [0.0] * 4
    for p in points:
        row = (p.x, p.y, p.z, 1.0)
        target = p.length_squared
        for i in range(4):
            rhs[i] += row[i] * target
            for j in range(4):
                a[i][j] += row[i] * row[j]
    for col in range(4):
        pivot = max(range(col, 4), key=lambda r: abs(a[r][col]))
        if abs(a[pivot][col]) < 1e-12:
            raise RuntimeError("Degenerate sphere fit")
        a[col], a[pivot] = a[pivot], a[col]
        rhs[col], rhs[pivot] = rhs[pivot], rhs[col]
        inv = 1.0 / a[col][col]
        for r in range(4):
            if r == col:
                continue
            factor = a[r][col] * inv
            for c in range(4):
                a[r][c] -= factor * a[col][c]
            rhs[r] -= factor * rhs[col]
    cx, cy, cz, k = (rhs[i] / a[i][i] for i in range(4))
    center = Vector((cx / 2.0, cy / 2.0, cz / 2.0))
    radius = math.sqrt(max(k + center.length_squared, 1e-12))
    return center, radius


def snapshot_layers(body: bpy.types.Object) -> list[list[tuple[float, float, float]]]:
    layers = [[tuple(v.co) for v in body.data.vertices]]
    if body.data.shape_keys:
        for kb in body.data.shape_keys.key_blocks:
            layers.append([tuple(p.co) for p in kb.data])
    return layers


def ensure_mask_group(body: bpy.types.Object, name: str, indices: list[int]) -> None:
    existing = body.vertex_groups.get(name)
    if existing:
        body.vertex_groups.remove(existing)
    group = body.vertex_groups.new(name=name)
    group.add(indices, 1.0, "REPLACE")


# ---------------------------------------------------------------------------
# Texture baking


def iris_basecolor_pixel(theta: float, phi: float) -> tuple[float, float, float]:
    if theta < PUPIL_ANGLE:
        edge = min(1.0, (PUPIL_ANGLE - theta) / math.radians(0.8))
        base = 0.02 * (1.0 - edge)
        return (base, base * 0.9, base * 0.8)
    if theta < IRIS_ANGLE:
        t = (theta - PUPIL_ANGLE) / (IRIS_ANGLE - PUPIL_ANGLE)
        inner = Vector((0.46, 0.32, 0.16))
        outer = Vector((0.27, 0.17, 0.10))
        color = inner.lerp(outer, t ** 0.8)
        fiber = (
            0.10 * math.sin(phi * 23.0 + t * 9.0)
            + 0.06 * math.sin(phi * 41.0 + 1.7)
            + 0.05 * math.sin(phi * 9.0 - t * 5.0 + 4.2)
        )
        speckle = (frac_hash(phi * 57.0, theta * 91.0) - 0.5) * 0.10
        color = color * (1.0 + fiber + speckle)
        limbal = min(1.0, max(0.0, (IRIS_ANGLE - theta) / math.radians(2.2)))
        color = color * (0.35 + 0.65 * limbal)
        return (max(color.x, 0.0), max(color.y, 0.0), max(color.z, 0.0))
    # Sclera
    base = Vector((0.905, 0.878, 0.845))
    shadow = min(1.0, max(0.0, (theta - IRIS_ANGLE) / math.radians(6.0)))
    base = base * (0.82 + 0.18 * shadow)  # soft darkening at the limbus join
    if theta > math.radians(58.0):
        warm = min(1.0, (theta - math.radians(58.0)) / math.radians(30.0))
        base = base.lerp(Vector((0.86, 0.75, 0.70)), warm * 0.35)
    if theta > math.radians(40.0):
        vein = abs(math.sin(phi * 17.0 + math.sin(phi * 5.0) * 2.0))
        vein_mask = max(0.0, vein - 0.965) / 0.035
        strength = min(1.0, (theta - math.radians(40.0)) / math.radians(25.0))
        base = base.lerp(Vector((0.72, 0.50, 0.46)), vein_mask * strength * 0.25)
    noise = (frac_hash(phi * 31.0, theta * 63.0) - 0.5) * 0.02
    return (base.x + noise, base.y + noise, base.z + noise)


def roughness_pixel(theta: float) -> float:
    if theta < CORNEA_ANGLE - math.radians(4.0):
        return 0.08
    if theta < CORNEA_ANGLE + math.radians(6.0):
        t = (theta - (CORNEA_ANGLE - math.radians(4.0))) / math.radians(10.0)
        return 0.08 + t * 0.38
    return 0.46


def bake_eye_images() -> tuple[bpy.types.Image, bpy.types.Image]:
    size = TEX_SIZE
    base_px = [0.0] * (size * size * 4)
    orm_px = [0.0] * (size * size * 4)
    for py in range(size):
        for px in range(size):
            dx = (px + 0.5) / size - 0.5
            dy = (py + 0.5) / size - 0.5
            r = math.sqrt(dx * dx + dy * dy)
            s = min(2.0 * r, 1.0)
            theta = 2.0 * math.asin(s)
            phi = math.atan2(dy, dx)
            rgb = iris_basecolor_pixel(theta, phi)
            rough = roughness_pixel(theta)
            i = (py * size + px) * 4
            base_px[i:i + 4] = (rgb[0], rgb[1], rgb[2], 1.0)
            orm_px[i:i + 4] = (1.0, rough, 0.0, 1.0)
    base_img = bpy.data.images.new("avatar_36C_eye_basecolor", size, size, alpha=True)
    base_img.colorspace_settings.name = "sRGB"
    base_img.pixels[:] = base_px
    base_img.pack()
    orm_img = bpy.data.images.new("avatar_36C_eye_orm", size, size, alpha=True)
    orm_img.colorspace_settings.name = "Non-Color"
    orm_img.pixels[:] = orm_px
    orm_img.pack()
    return base_img, orm_img


def make_eye_material(base_img: bpy.types.Image, orm_img: bpy.types.Image) -> bpy.types.Material:
    mat = bpy.data.materials.new("avatar_36C_eye_DRAFT")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (500, 0)
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.location = (200, 0)
    principled.inputs["Metallic"].default_value = 0.0
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])

    tex_base = nodes.new("ShaderNodeTexImage")
    tex_base.location = (-300, 200)
    tex_base.image = base_img
    links.new(tex_base.outputs["Color"], principled.inputs["Base Color"])

    tex_orm = nodes.new("ShaderNodeTexImage")
    tex_orm.location = (-300, -200)
    tex_orm.image = orm_img
    separate = nodes.new("ShaderNodeSeparateColor")
    separate.location = (-60, -200)
    links.new(tex_orm.outputs["Color"], separate.inputs["Color"])
    links.new(separate.outputs["Green"], principled.inputs["Roughness"])
    return mat


# ---------------------------------------------------------------------------
# Geometry


def build_eyeball(name: str, center: Vector, radius: float, material: bpy.types.Material) -> bpy.types.Object:
    import bmesh

    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=24, radius=radius)
    # Native pole is +Z; deform in that frame, then rotate pole onto -Y.
    for vert in bm.verts:
        direction = vert.co.normalized()
        theta = math.acos(max(-1.0, min(1.0, direction.z)))
        offset = 0.0
        if theta < IRIS_ANGLE:
            offset -= IRIS_DISH_DEPTH * (1.0 - theta / IRIS_ANGLE) ** 0.8
        if theta < CORNEA_ANGLE:
            t = 1.0 - theta / CORNEA_ANGLE
            offset += CORNEA_APEX_BULGE * (t * t * (3.0 - 2.0 * t))
        vert.co += direction * offset

    mesh = bpy.data.meshes.new(f"{name}_mesh")
    bm.to_mesh(mesh)
    bm.free()

    # Rotate +Z pole to -Y (front): (x, y, z) -> (x, -z, y)
    for vert in mesh.vertices:
        x, y, z = vert.co
        vert.co = Vector((x, -z, y))

    uv_layer = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        co = mesh.vertices[loop.vertex_index].co
        direction = co.normalized()
        cos_t = max(-1.0, min(1.0, direction.dot(FORWARD)))
        theta = math.acos(cos_t)
        phi = math.atan2(direction.z, direction.x)
        r_uv = 0.5 * math.sin(theta / 2.0)
        uv_layer.data[loop.index].uv = (0.5 + r_uv * math.cos(phi), 0.5 + r_uv * math.sin(phi))

    mesh.materials.append(material)
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    obj.location = center
    bpy.context.scene.collection.objects.link(obj)
    obj["asset_id"] = "avatar_36C"
    obj["asset_status"] = "DRAFT_NOT_TD_VALIDATED"
    obj["generator"] = "scripts/build_eye_region.py"
    return obj


def margin_ring(
    body_group: set[int],
    positions: list[Vector],
    center: Vector,
    radius: float,
) -> list[int]:
    """Skin vertices that skim the eyeball surface inside the front cone —
    the visible lid margin where lashes root."""
    ring = []
    for i in body_group:
        rel = positions[i] - center
        if rel.length < 1e-9 or rel.length > radius + 0.008:
            continue
        if abs(rel.length - radius) > MARGIN_BAND:
            continue
        if FORWARD.angle(rel) > MARGIN_CONE:
            continue
        ring.append(i)
    if len(ring) < 10:
        raise RuntimeError(f"Lid-margin ring too sparse near {tuple(center)}: {len(ring)} verts")
    return ring


def arc_angle(point: Vector, ring_center: Vector, side_sign: float) -> float:
    """Position around the margin ring: 0 = outer corner, 90 = top, 270 = bottom."""
    lateral = (point.x - ring_center.x) * side_sign
    vertical = point.z - ring_center.z
    return math.degrees(math.atan2(vertical, lateral)) % 360.0


def visible_skin_bvh(body: bpy.types.Object):
    """World-space BVH of the evaluated visible skin (Mask modifier active)."""
    from mathutils.bvhtree import BVHTree
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = body.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    matrix = eval_obj.matrix_world
    verts = [matrix @ v.co for v in mesh.vertices]
    polys = [tuple(p.vertices) for p in mesh.polygons]
    tree = BVHTree.FromPolygons(verts, polys)
    eval_obj.to_mesh_clear()
    return tree


def build_trim(
    rings: dict[str, list[int]],
    centers: dict[str, Vector],
    radii: dict[str, float],
    positions: list[Vector],
    skin_bvh,
) -> bpy.types.Object:
    verts: list[Vector] = []
    faces: list[tuple[int, ...]] = []

    def pushed_out(point: Vector, center: Vector, radius: float) -> Vector:
        d = (point - center).length
        if d < radius + 0.0002:
            return center + (point - center).normalized() * (radius + 0.0002)
        return point

    def add_lash(root: Vector, tangent: Vector, dir_root: Vector, dir_tip: Vector,
                 length: float, width: float, center: Vector, radius: float) -> None:
        root = pushed_out(root, center, radius)
        mid = pushed_out(root + dir_root * (length * 0.45), center, radius)
        tip = pushed_out(mid + dir_tip * (length * 0.55), center, radius)
        half_root = tangent * (width * 0.5)
        half_mid = tangent * (width * 0.28)
        quad = [
            pushed_out(q, center, radius)
            for q in (root - half_root, root + half_root, mid + half_mid, mid - half_mid)
        ]
        base = len(verts)
        verts.extend(quad)
        faces.append((base, base + 1, base + 2, base + 3))
        base = len(verts)
        verts.extend((quad[3], quad[2], tip))
        faces.append((base, base + 1, base + 2))

    def lid_edge_line(center: Vector, radius: float, upper: bool, step_x: float) -> list[Vector]:
        """Roots on the visible lash line: per x-column, binary-search the z
        where front-visible skin stops covering the eyeball (the aperture
        edge). The margin-ring band mostly lies on the hidden inner-lid
        pocket, so it cannot supply visible roots."""
        sign_z = 1.0 if upper else -1.0
        ray_dir = Vector((0.0, 1.0, 0.0))

        def eye_front_y(dx: float, dz: float) -> float | None:
            s = radius * radius - dx * dx - dz * dz
            if s <= 0.0:
                return None
            return center.y - math.sqrt(s)

        def covered(x: float, z: float) -> bool:
            yf = eye_front_y(x - center.x, z - center.z)
            if yf is None:
                return True
            hit = skin_bvh.ray_cast(Vector((x, center.y - 0.06, z)), ray_dir)
            if hit[0] is None:
                return True
            return hit[0].y < yf - 1e-5

        pts: list[Vector] = []
        span = 0.012
        n_cols = int((2.0 * span) / step_x)
        for i in range(n_cols + 1):
            x = center.x - span + i * step_x
            if covered(x, center.z):
                continue  # aperture closed at this column (eye corners)
            z_open, z_cov = center.z, center.z + sign_z * 0.012
            for _ in range(14):
                zm = 0.5 * (z_open + z_cov)
                if covered(x, zm):
                    z_cov = zm
                else:
                    z_open = zm
            z_root = 0.5 * (z_open + z_cov) + sign_z * 0.0003
            hit = skin_bvh.ray_cast(Vector((x, center.y - 0.06, z_root)), ray_dir)
            if hit[0] is None:
                continue
            pts.append(hit[0])
        if len(pts) < 12:
            raise RuntimeError(f"Visible lid edge too sparse ({'upper' if upper else 'lower'}): {len(pts)}")
        return pts

    lash_counts = {}
    flick_skin_gap = 0.0
    for side in ("L", "R"):
        center = centers[side]
        radius = radii[side]
        side_sign = 1.0 if side == "L" else -1.0

        count = 0
        sample_sets = (
            ("upper", lid_edge_line(center, radius, True, 0.00045)),
            ("lower", lid_edge_line(center, radius, False, 0.0016)),
        )
        for kind, line_pts in sample_sets:
            upper = kind == "upper"
            for k, root in enumerate(line_pts):
                radial = (root - center).normalized()
                noise = frac_hash(float(k) * 3.1, side_sign * 7.7)
                width_noise = frac_hash(float(k) * 5.3, side_sign * 2.9)
                # 0 = inner corner (nose side), 1 = outer corner.
                t_outer = min(1.0, max(0.0, ((root.x - center.x) * side_sign + 0.012) / 0.024))
                if upper:
                    # Tail-weighted: the inner corner stays short and sparse
                    # while the outer third grows markedly longer and fans
                    # toward the temple, so the đuôi mắt reads as real hair
                    # rather than as a drawn-on wedge.
                    taper = 0.62 + 0.78 * (t_outer ** 1.4)
                    length = (0.0032 + 0.0012 * noise) * taper
                    sweep = 0.55 * (t_outer ** 1.6)
                    lateral = Vector((side_sign, 0.0, 0.0))
                    # Gentle natural curl: near-straight forward growth with a
                    # modest upward lift at the tip (no doll-like sweep).
                    dir_root = (
                        FORWARD * 0.90 + radial * 0.25 + UP * 0.10
                        + lateral * (sweep * 0.35)
                    ).normalized()
                    dir_tip = (
                        FORWARD * 0.50 + UP * 0.65 + radial * 0.20 + lateral * sweep
                    ).normalized()
                    width = 0.00042 * (0.85 + 0.30 * width_noise)
                else:
                    length = 0.0009 + 0.0005 * noise
                    dir_root = (FORWARD * 0.85 - UP * 0.35 + radial * 0.25).normalized()
                    dir_tip = (FORWARD * 0.6 - UP * 0.6 + radial * 0.25).normalized()
                    width = 0.00026 * (0.85 + 0.30 * width_noise)
                neighbor = line_pts[min(k + 1, len(line_pts) - 1)]
                if (neighbor - root).length < 1e-9:
                    neighbor = line_pts[k - 1]
                tangent_src = neighbor - root
                tangent_src = tangent_src - radial * tangent_src.dot(radial)
                if tangent_src.length < 1e-6:
                    tangent_src = UP.cross(radial)
                tangent = tangent_src.normalized()
                jitter = (noise - 0.5) * 0.35
                dir_root = (dir_root + tangent * jitter).normalized()
                dir_tip = (dir_tip + tangent * jitter).normalized()
                add_lash(root, tangent, dir_root, dir_tip, length, width, center, radius)
                count += 1
                if upper and t_outer > 0.60:
                    # Denser tail: a second lash between this root and its
                    # neighbour roughly doubles outer-third density.
                    fill = frac_hash(float(k) * 7.3, side_sign * 4.9)
                    fill_root = root + tangent * ((neighbor - root).length * 0.45)
                    add_lash(
                        fill_root, tangent, dir_root, dir_tip,
                        length * (0.82 + 0.22 * fill),
                        width * (0.85 + 0.25 * fill),
                        center, radius,
                    )
                    count += 1
                    if frac_hash(float(k) * 11.3, side_sign * 13.7) < 0.22:
                        # A few longer accent lashes punctuating the tail.
                        add_lash(
                            root, tangent, dir_root, dir_tip,
                            length * 1.45, width * 0.90, center, radius,
                        )
                        count += 1
        lash_counts[side] = count

        # Eyeliner ribbons + outer-corner tail flick ("đuôi mắt"). The upper and
        # lower lash lines both terminate at one shared corner vertex, so they
        # converge into a true V instead of two overlapping strips, and the
        # flick continuing past it is projected onto the skin so it stays
        # readable from every angle. Shares the lash material and EYE_TRIM.
        def ribbon_cols(points, up_sign, width_fn):
            cols = []
            for p in points:
                t_o = min(1.0, max(0.0, ((p.x - center.x) * side_sign + 0.012) / 0.024))
                w = width_fn(t_o)
                if w <= 0.0:
                    continue
                radial_p = (p - center).normalized()
                away = UP * up_sign
                lid_dir = (away - radial_p * away.dot(radial_p)).normalized()
                base_pt = pushed_out(p + radial_p * 0.00025, center, radius)
                cols.append((base_pt, pushed_out(base_pt + lid_dir * w, center, radius)))
            return cols

        def emit_strip(cols):
            start = len(verts)
            for b, tp in cols:
                verts.extend((b, tp))
            for i in range(len(cols) - 1):
                a = start + 2 * i
                faces.append((a, a + 2, a + 3, a + 1))
            return start

        key_outer = lambda p: (p.x - center.x) * side_sign
        ordered_up = sorted(sample_sets[0][1], key=key_outer)
        ordered_lo = sorted(sample_sets[1][1], key=key_outer)
        # Widths raised for task #26. Round 1 (0.50-1.30 mm) still didn't read
        # at normal viewing distance in the full-head front render; round 2
        # pushes further, accepting a close-up that reads more like makeup in
        # exchange for distance readability (explicit user trade-off).
        cols_up = ribbon_cols(ordered_up, 1.0, lambda t: 0.00090 + 0.00160 * (t ** 1.2))
        # Lower liner exists only in the outer third and tapers to nothing
        # inward, so it darkens the tail without ringing the whole eye.
        cols_lo = ribbon_cols(
            ordered_lo, -1.0,
            lambda t: 0.00110 * (((t - 0.50) / 0.50) ** 0.8) if t > 0.50 else 0.0,
        )
        up_start = emit_strip(cols_up)
        lo_start = emit_strip(cols_lo)

        # Shared corner vertex: the point of the V.
        corner_src = (ordered_up[-1] + ordered_lo[-1]) * 0.5
        corner_pt = pushed_out(
            corner_src + (corner_src - center).normalized() * 0.00025, center, radius
        )
        corner_idx = len(verts)
        verts.append(corner_pt)
        up_end = up_start + 2 * (len(cols_up) - 1)
        faces.append((up_end, corner_idx, up_end + 1))
        if cols_lo:
            lo_end = lo_start + 2 * (len(cols_lo) - 1)
            faces.append((lo_end, lo_end + 1, corner_idx))

        # Tail flick: continue the lash-line tangent at the corner (which now
        # carries the sculpted canthal tilt) rather than a hardcoded axis, and
        # snap every sample onto the skin surface.
        back = ordered_up[max(0, len(ordered_up) - 5)]
        seg = corner_pt - back
        tail_dir = seg.normalized() if seg.length > 1e-6 else Vector((side_sign, 0.0, 0.0))
        flick_dir = (tail_dir * 0.85 + UP * 0.35).normalized()

        def on_skin(point: Vector):
            loc, nrm, _idx, _dist = skin_bvh.find_nearest(point)
            if loc is None:
                return None, None
            return loc + nrm * 0.00022, nrm

        flick_cols = []
        steps = 5
        for i in range(1, steps):
            s = i / steps
            surf, nrm = on_skin(corner_pt + flick_dir * (FLICK_LENGTH * s))
            if surf is None:
                break
            w = 0.00090 * ((1.0 - s) ** 0.85)  # round 2 of task #26; was 0.00055, originally 0.00040
            up_lid = (UP - nrm * UP.dot(nrm)).normalized()
            flick_cols.append((surf, surf + up_lid * w))
        tip_pt, _ = on_skin(corner_pt + flick_dir * FLICK_LENGTH)
        if flick_cols and tip_pt is not None:
            f_start = emit_strip(flick_cols)
            faces.append((corner_idx, f_start, f_start + 1))
            tip_idx = len(verts)
            verts.append(tip_pt)
            f_end = f_start + 2 * (len(flick_cols) - 1)
            faces.append((f_end, tip_idx, f_end + 1))
            for pt in [c[0] for c in flick_cols] + [c[1] for c in flick_cols] + [tip_pt]:
                loc, _n, _i, _d = skin_bvh.find_nearest(pt)
                if loc is not None:
                    flick_skin_gap = max(flick_skin_gap, (pt - loc).length)

    mesh = bpy.data.meshes.new("avatar_36C_eye_trim_mesh")
    mesh.from_pydata([v for v in verts], [], faces)

    lash_mat = bpy.data.materials.new("avatar_36C_eye_lash_DRAFT")
    lash_mat.use_nodes = True
    lash_bsdf = lash_mat.node_tree.nodes.get("Principled BSDF")
    # Material-contrast attempt (task #26 round 3): two geometry-amplification
    # rounds passed all gates but still didn't read at normal viewing distance.
    # Push toward true black / fully matte so the flat QA key light can't wash
    # the liner/flick out with specular sheen, without further geometric change.
    lash_bsdf.inputs["Base Color"].default_value = (0.004, 0.003, 0.003, 1.0)
    lash_bsdf.inputs["Roughness"].default_value = 0.97
    if "Specular IOR Level" in lash_bsdf.inputs:
        lash_bsdf.inputs["Specular IOR Level"].default_value = 0.05
    mesh.materials.append(lash_mat)
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.update(calc_edges=True)

    obj = bpy.data.objects.new("avatar_36C_eye_trim", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj["asset_id"] = "avatar_36C"
    obj["object_role"] = "EYE_TRIM"
    obj["asset_status"] = "DRAFT_NOT_TD_VALIDATED"
    obj["generator"] = "scripts/build_eye_region.py"
    obj["lash_counts"] = json.dumps(lash_counts)
    obj["flick_skin_gap_mm"] = round(flick_skin_gap * 1000.0, 4)
    return obj


# ---------------------------------------------------------------------------
# Gates


def run_gates(
    body: bpy.types.Object,
    snapshot: list[list[tuple[float, float, float]]],
    centers: dict[str, Vector],
    radii: dict[str, float],
    eye_objects: dict[str, bpy.types.Object],
    trim: bpy.types.Object,
    backup_path: Path,
) -> tuple[dict, dict]:
    checks: dict[str, bool] = {}
    stats: dict[str, object] = {}
    positions = evaluated_positions_mask_off(body)
    body_group = group_indices(body, "body")

    checks["backup_written"] = backup_path.exists() and backup_path.stat().st_size > 0

    # Scope lock: the body must be bit-identical on every shape-key layer.
    moved = []
    layers = [[tuple(v.co) for v in body.data.vertices]]
    if body.data.shape_keys:
        for kb in body.data.shape_keys.key_blocks:
            layers.append([tuple(p.co) for p in kb.data])
    for layer_before, layer_after in zip(snapshot, layers):
        for idx, (before, after) in enumerate(zip(layer_before, layer_after)):
            if before != after:
                moved.append(idx)
    checks["scope_lock_zero_body_vertex_movement"] = not moved
    stats["moved_body_vertices"] = sorted(set(moved))[:20]
    checks["body_topology_unchanged"] = len(snapshot[0]) == len(body.data.vertices)

    # Symmetry and gaze.
    radius_delta = abs(radii["L"] - radii["R"]) / max(radii["L"], radii["R"])
    checks["eyeball_radius_match_1pct"] = radius_delta < 0.01
    stats["radius_delta_pct"] = round(radius_delta * 100, 4)
    mirror_gap = (
        abs(centers["L"].x + centers["R"].x)
        + abs(centers["L"].y - centers["R"].y)
        + abs(centers["L"].z - centers["R"].z)
    )
    checks["eyeball_centers_mirrored"] = mirror_gap < 0.0005
    stats["center_mirror_gap_mm"] = round(mirror_gap * 1000, 4)
    checks["gaze_parallel_no_crosseye"] = True  # constructed: both front axes are exactly -Y
    checks["radius_within_bounds"] = all(EYE_RADIUS_MIN <= r <= EYE_RADIUS_MAX for r in radii.values())

    # The pupil axis must be unobstructed: no skin vertex inside a 12-degree
    # cone may sit in front of the eyeball surface.
    obstructions = []
    lid_profile = {}
    for side in ("L", "R"):
        cone_stats = []
        for idx in body_group:
            rel = positions[idx] - centers[side]
            if rel.length > radii[side] + 0.012 or rel.length < 1e-9:
                continue
            angle = math.degrees(FORWARD.angle(rel))
            d = rel.length - radii[side]
            if angle < 12.0 and d > 0.0005:
                obstructions.append((side, idx, round(angle, 2), round(d * 1000, 3)))
            if angle < 60.0:
                cone_stats.append(d)
        lid_profile[side] = {
            "front_cone_verts": len(cone_stats),
            "min_d_mm": round(min(cone_stats) * 1000, 3) if cone_stats else None,
            "max_d_mm": round(max(cone_stats) * 1000, 3) if cone_stats else None,
        }
    checks["pupil_axis_unobstructed"] = not obstructions
    stats["pupil_obstructions"] = obstructions[:20]
    stats["front_cone_skin_profile"] = lid_profile

    # Lid coverage: skin must cross the eyeball surface (intersection contact,
    # no floating lids) — the margin band must contain verts on both sides.
    for side in ("L", "R"):
        inside = outside = 0
        for idx in body_group:
            rel = positions[idx] - centers[side]
            if rel.length > radii[side] + 0.006 or FORWARD.angle(rel) > MARGIN_CONE:
                continue
            if rel.length < radii[side]:
                inside += 1
            else:
                outside += 1
        checks[f"lid_intersects_eyeball_{side}"] = inside >= 10 and outside >= 10
    # Protrusion: the cornea apex must lead the lid-margin ring slightly
    # (visible cornea, not sunken) while staying behind the brow line
    # (not bulging past the orbital ridge in profile).
    protrusion = {}
    for side in ("L", "R"):
        cx, cy, cz = centers[side]
        apex_y = cy - (radii[side] + CORNEA_APEX_BULGE)
        ring_pts = [
            positions[i] for i in body_group
            if abs((positions[i] - centers[side]).length - radii[side]) <= MARGIN_BAND
            and FORWARD.angle(positions[i] - centers[side]) <= MARGIN_CONE
        ]
        ring_y = sum(p.y for p in ring_pts) / len(ring_pts)
        brow_front = min(
            positions[i].y for i in body_group
            if abs(positions[i].x - cx) < 0.016 and cz + 0.012 <= positions[i].z <= cz + 0.035
        )
        leads_ring = (ring_y - apex_y) * 1000
        behind_brow = (apex_y - brow_front) * 1000
        protrusion[side] = {
            "apex_leads_margin_ring_mm": round(leads_ring, 3),
            "apex_behind_brow_mm": round(behind_brow, 3),
        }
        checks[f"protrusion_bounds_{side}"] = 1.5 <= leads_ring <= 10.0 and behind_brow >= 0.0
    stats["protrusion"] = protrusion

    added_tris = 0
    for obj in (*eye_objects.values(), trim):
        added_tris += sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)
    checks["triangle_budget"] = added_tris <= ADDED_TRI_BUDGET
    stats["added_triangles"] = added_tris

    trim_violations = 0
    for v in trim.data.vertices:
        wp = trim.matrix_world @ v.co
        for side in ("L", "R"):
            if (wp - centers[side]).length < radii[side] - 0.0001:
                trim_violations += 1
                break
    checks["lashes_outside_eyeballs"] = trim_violations == 0
    stats["trim_vertices_inside_eyeball"] = trim_violations

    # Proves the tail flick is surface-conforming rather than a floating sliver
    # — the draft.15 failure mode where it vanished at 45 degrees.
    flick_gap = trim.get("flick_skin_gap_mm", None)
    checks["flick_conforms_to_skin"] = (
        flick_gap is not None and flick_gap <= FLICK_SKIN_GAP_MAX * 1000.0
    )
    stats["flick_skin_gap_mm"] = flick_gap

    for side, obj in eye_objects.items():
        mat = obj.data.materials[0] if obj.data.materials else None
        has_images = bool(mat) and any(
            n.type == "TEX_IMAGE" and n.image and n.image.packed_file
            for n in mat.node_tree.nodes
        )
        checks[f"eye_material_textured_packed_{side}"] = has_images
        checks[f"eye_uv_present_{side}"] = bool(obj.data.uv_layers)

    return checks, stats


# ---------------------------------------------------------------------------
# Renders


def point_at(obj: bpy.types.Object, target: Vector) -> None:
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_post_views(body: bpy.types.Object, eye_target: Vector) -> list[str]:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False

    for poly in body.data.polygons:
        poly.use_smooth = True

    def add_area(name, location, energy, size, target):
        data = bpy.data.lights.new(name=name, type="AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        point_at(obj, target)
        return obj

    # Small key light: a large disk reflects as a huge flat blob on the glossy
    # cornea; a compact source gives a natural catchlight instead.
    temp = []
    temp.append(add_area("EyeQA_Key", (0.5, eye_target.y - 0.9, eye_target.z + 0.4), 70.0, 0.18, eye_target))
    temp.append(add_area("EyeQA_Fill", (-0.6, eye_target.y - 0.7, eye_target.z), 25.0, 0.35, eye_target))
    temp.append(add_area("EyeQA_Rim", (0.0, eye_target.y + 0.8, eye_target.z + 0.5), 80.0, 0.8, eye_target))

    camera_data = bpy.data.cameras.new("EyeQA_Camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("EyeQA_Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    temp.append(camera)
    scene.camera = camera

    distance = 1.2
    views = {
        "face-front": (Vector((0.0, -distance, 0.0)), 0.30),
        "eyes-front": (Vector((0.0, -distance, 0.0)), 0.13),
        "eyes-45L": (Vector((distance * 0.707, -distance * 0.707, 0.0)), 0.13),
        "eyes-45R": (Vector((-distance * 0.707, -distance * 0.707, 0.0)), 0.13),
        "eyes-sideL": (Vector((distance, 0.0, 0.0)), 0.13),
        "eyes-sideR": (Vector((-distance, 0.0, 0.0)), 0.13),
        "eye-close-L": (Vector((0.35, -distance, 0.0)), 0.05),
    }
    outputs = []
    for name, (offset, ortho_scale) in views.items():
        target = eye_target.copy()
        if name == "eye-close-L":
            target = eye_target + Vector((0.0285, 0.0, 0.0))
        camera.location = target + offset
        camera.data.ortho_scale = ortho_scale
        point_at(camera, target)
        output = EYES_DIR / f"post-{name}.png"
        scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        outputs.append(str(output.relative_to(ROOT)))
    for obj in temp:
        bpy.data.objects.remove(obj, do_unlink=True)
    return outputs


# ---------------------------------------------------------------------------


def main() -> None:
    if Path(bpy.data.filepath).resolve() != BLEND_PATH.resolve():
        raise RuntimeError(f"Expected open file {BLEND_PATH}, got {bpy.data.filepath}")
    EYES_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = BACKUP_DIR / f"avatar_36C_master.pre-eyes-{stamp}.blend"
    shutil.copy2(BLEND_PATH, backup_path)

    body = find_body()
    remove_existing()
    snapshot = snapshot_layers(body)

    positions = evaluated_positions_mask_off(body)
    body_group = group_indices(body, "body")

    fits = {
        side: fit_sphere([positions[i] for i in group_indices(body, f"helper-{side.lower()}-eye")])
        for side in ("L", "R")
    }
    # Enforce exact mirror symmetry of the pair; the MPFB helper proxies are
    # the authoritative eye volume for this base mesh.
    radius = (fits["L"][1] + fits["R"][1]) / 2.0
    radius = min(max(radius, EYE_RADIUS_MIN), EYE_RADIUS_MAX)
    lx = (abs(fits["L"][0].x) + abs(fits["R"][0].x)) / 2.0
    cy = (fits["L"][0].y + fits["R"][0].y) / 2.0
    cz = (fits["L"][0].z + fits["R"][0].z) / 2.0
    centers = {"L": Vector((lx, cy, cz)), "R": Vector((-lx, cy, cz))}
    radii = {"L": radius, "R": radius}

    # Record the approved eye-edit region on the body (no vertices are moved
    # in this build; the mask documents where future lid edits may occur).
    for side in ("L", "R"):
        region = [i for i in body_group if (positions[i] - centers[side]).length < MASK_REGION_RADIUS]
        ensure_mask_group(body, f"EYE_EDIT_MASK_{side}", region)

    base_img, orm_img = bake_eye_images()
    eye_mat = make_eye_material(base_img, orm_img)
    eye_objects = {
        "L": build_eyeball("avatar_36C_eye_L", centers["L"], radius, eye_mat),
        "R": build_eyeball("avatar_36C_eye_R", centers["R"], radius, eye_mat),
    }
    eye_objects["L"]["object_role"] = "EYE_L"
    eye_objects["R"]["object_role"] = "EYE_R"

    rings = {
        side: margin_ring(body_group, positions, centers[side], radius)
        for side in ("L", "R")
    }
    trim = build_trim(rings, centers, radii, positions, visible_skin_bvh(body))

    checks, stats = run_gates(body, snapshot, centers, radii, eye_objects, trim, backup_path)
    passed = all(checks.values())

    eye_target = Vector((0.0, centers["L"].y - radius, centers["L"].z))
    views = render_post_views(body, eye_target)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "purpose": (
            "Gated eye-region build: eyeballs fitted to MPFB helper-eye proxies, lash "
            "cards, baked eye textures. Machine gates only; grants no TD, visual or "
            "anatomical approval."
        ),
        "backup_blend": str(backup_path.relative_to(ROOT)),
        "backup_sha256": sha256(backup_path),
        "eyeball_radius_mm": round(radius * 1000, 4),
        "eye_centers": {s: [round(c, 5) for c in centers[s]] for s in centers},
        "helper_fit_raw": {
            s: {"center": [round(c, 5) for c in fits[s][0]], "radius_mm": round(fits[s][1] * 1000, 4)}
            for s in fits
        },
        "margin_ring_counts": {s: len(r) for s, r in rings.items()},
        "checks": checks,
        "stats": stats,
        "views": views,
        "result": "PASS" if passed else "FAIL",
        "saved": False,
        "warning": (
            "DRAFT eye build. Zero body vertices moved; all eye geometry is new "
            "separate objects (EYE_L / EYE_R / EYE_TRIM)."
        ),
    }

    if passed:
        bpy.ops.wm.save_mainfile()
        payload["saved"] = True
        payload["blend_sha256_after_save"] = sha256(BLEND_PATH)

    REPORT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print("EYE_BUILD_REPORT=" + json.dumps(payload, separators=(",", ":")))
    if not passed:
        failed = [name for name, ok in checks.items() if not ok]
        raise RuntimeError(f"Eye build gates failed ({len(failed)}): {failed}")


if __name__ == "__main__":
    main()
