"""Gated hair build for the draft 36C avatar.

Authors `avatar_36C_hair` (role HAIR): shoulder-length lock-card hair with a
middle part, deep warm brown matte (matching the brow material). Per the
reviewer's 2026-08-15 style decisions, ALL locks flow behind the shoulders —
the front chest/neckline stays completely clear for bra-fit photography.

Locks are strip cards: the skull phase conforms to the evaluated skin via
BVH find_nearest + lift, then the hanging phase falls behind the back
(clamped off the back surface via raycast) down to shoulder height.
Landmarks come from the evaluated-body probe (2026-08-16): crown z=1.5912,
head widest x=0.0675 @ z=1.50, occiput y=0.045 @ z=1.52, nape z~1.38-1.42,
shoulder top z~1.30-1.33, upper-back y~0.03-0.06.

No body vertex is touched: the scope-lock gate requires bit-identical body
geometry on every shape-key layer. Nothing is saved unless every gate in
run_gates() passes. The asset remains DRAFT — NOT TD VALIDATED; this grants
no TD, anatomical or visual approval.
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
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
BLEND_PATH = ROOT / "avatar_36C_master.blend"
HAIR_DIR = ROOT / "qa" / "avatar_36C" / "hair"
REPORT = HAIR_DIR / "hair-build-report.json"
BACKUP_DIR = ROOT / "backups"

HAIR_ROLE = "HAIR"

EYE_CZ = 1.4872
EYE_CY = -0.11009
EYE_CX = 0.02847
EYE_CENTERS = (
    Vector((EYE_CX, EYE_CY, EYE_CZ)),
    Vector((-EYE_CX, EYE_CY, EYE_CZ)),
)

UP = Vector((0.0, 0.0, 1.0))
HEAD_CENTER = Vector((0.0, -0.046, 1.492))

# Part line (middle part): raw guide points dropped onto the scalp from above.
PART_X = 0.003
PART_Y_FRONT = -0.102
PART_Y_BACK = 0.038

# Lock counts per side.
PART_LOCKS_PER_SIDE = 24      # family A: rooted along the middle part
RING_LOCKS_PER_SIDE = 18      # family B: rooted along the side/back hairline

# Scalp cap: a conformed quad-grid shell covering hairline→crown→nape so no
# skin shows between lock cards (the first build rendered a bald crown).
CAP_THETA_STEPS = 25          # azimuth columns, -180..180 degrees
CAP_ROWS = 8
CAP_RADIUS = 0.12

ROOT_LIFT = 0.002             # scalp gap at the part reads as a natural part
VOL_LIFT_MIN = 0.006          # hair-volume lift at the end of the skull phase
VOL_LIFT_MAX = 0.010
HANG_CLEAR_TOP = 0.006        # clearance off the back surface at the nape
HANG_CLEAR_TIP = 0.013        # grows toward the tips (hair volume)

TIP_Z_MIN = 1.255             # shoulder-length band (shoulder top z~1.30-1.33)
TIP_Z_MAX = 1.298
SHOULDER_BAND = (1.245, 1.305)   # gate on the global lowest hair vertex
MAX_TOP_Z = 1.605                # crown 1.5912 + lift budget
ADDED_TRI_BUDGET = 9000
# Hanging locks span the open gap between skull, neck and shoulders, so this
# is a float-envelope sanity bound, not a skin-conforming bound like the brows.
MAX_SURFACE_DIST = 0.050
FACE_Y_LIMIT = -0.095         # verts in front of this must stay above the hairline
FACE_MIN_Z = 1.53
EYE_CLEARANCE = 0.035
FRONT_CLEAR_Z = 1.40          # below this, everything must sit behind the body
FRONT_CLEAR_Y = 0.003


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
        if obj.type == "MESH" and obj.get("object_role") == HAIR_ROLE:
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.name.startswith("avatar_36C_hair") and mat.users == 0:
            bpy.data.materials.remove(mat)


def snapshot_layers(body: bpy.types.Object) -> list[list[tuple[float, float, float]]]:
    layers = [[tuple(v.co) for v in body.data.vertices]]
    if body.data.shape_keys:
        for kb in body.data.shape_keys.key_blocks:
            layers.append([tuple(p.co) for p in kb.data])
    return layers


def world_skin_bvh(body: bpy.types.Object) -> tuple[BVHTree, bpy.types.Object]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = body.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    matrix = eval_obj.matrix_world
    verts = [matrix @ v.co for v in mesh.vertices]
    polys = [tuple(p.vertices) for p in mesh.polygons]
    tree = BVHTree.FromPolygons(verts, polys)
    eval_obj.to_mesh_clear()
    return tree, eval_obj


def conform(tree: BVHTree, point: Vector, lift: float) -> tuple[Vector, Vector] | None:
    nearest = tree.find_nearest(point)
    if nearest[0] is None:
        return None
    normal = nearest[1].normalized()
    return nearest[0] + normal * lift, normal


def back_hit(tree: BVHTree, x: float, z: float) -> Vector | None:
    hit = tree.ray_cast(Vector((x, 0.5, z)), Vector((0.0, -1.0, 0.0)))
    return hit[0]


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


class Lock:
    __slots__ = ("stations", "widths", "wdirs", "tip_z")

    def __init__(self):
        self.stations: list[Vector] = []
        self.widths: list[float] = []
        self.wdirs: list[Vector] = []
        self.tip_z = 0.0


def build_lock(
    tree: BVHTree,
    sign: float,
    skull_guides: list[Vector],
    n_skull: int,
    hang_x: float,
    tip_z: float,
    vol_lift: float,
    base_width: float,
    jitter: float,
) -> Lock | None:
    lock = Lock()
    lock.tip_z = tip_z
    n_hang = 9

    # Skull phase: piecewise-linear guide chain, conformed onto the evaluated
    # skin with a lift that grows from the root gap to the hair-volume lift.
    guide_pts: list[Vector] = []
    for i in range(n_skull):
        t = i / (n_skull - 1)
        seg = t * (len(skull_guides) - 1)
        k = min(len(skull_guides) - 2, int(seg))
        f = seg - k
        guide_pts.append(skull_guides[k].lerp(skull_guides[k + 1], f))

    prev_pt: Vector | None = None
    normals: list[Vector] = []
    for i, raw in enumerate(guide_pts):
        t = i / (n_skull - 1)
        lift = lerp(ROOT_LIFT, vol_lift, t)
        res = conform(tree, raw, lift)
        if res is None:
            return None
        pt, normal = res
        lock.stations.append(pt)
        normals.append(normal)
        prev_pt = pt

    # Hanging phase: fall behind the back, clamped off the back surface.
    start = lock.stations[-1]
    last_y = max(start.y, 0.02)
    for i in range(1, n_hang + 1):
        s = i / n_hang
        z = lerp(start.z, tip_z, s)
        x = lerp(start.x, hang_x, min(1.0, s * 1.4)) + sign * jitter * 0.002 * math.sin(s * math.pi)
        clear = lerp(HANG_CLEAR_TOP, HANG_CLEAR_TIP, s)
        hit = back_hit(tree, x, z)
        # A grazing ray near the neck-silhouette edge returns points on the
        # neck SIDE (y near or below zero), not its back — treat those as
        # misses so the lock stays behind the body.
        if hit is not None and hit.y >= 0.006:
            y = max(hit.y + clear, 0.012)
            last_y = y
        else:
            y = max(last_y, 0.02)
        lock.stations.append(Vector((x, y, z)))
        normals.append(Vector((0.0, 1.0, 0.0)))

    # Width direction and taper per station.
    n_total = len(lock.stations)
    for i in range(n_total):
        if i == 0:
            tangent = (lock.stations[1] - lock.stations[0]).normalized()
        elif i == n_total - 1:
            tangent = (lock.stations[-1] - lock.stations[-2]).normalized()
        else:
            tangent = (lock.stations[i + 1] - lock.stations[i - 1]).normalized()
        wdir = tangent.cross(normals[i])
        if wdir.length < 1e-6:
            wdir = Vector((1.0, 0.0, 0.0))
        lock.wdirs.append(wdir.normalized())
        s = i / (n_total - 1)
        taper = 1.0 if s < 0.68 else 1.0 - 0.45 * (s - 0.68) / 0.32
        root_taper = 0.55 + 0.45 * min(1.0, i / 2.0)
        lock.widths.append(base_width * taper * root_taper)
    return lock


def cap_psi_min_deg(theta_deg: float) -> float:
    """Hairline elevation: forehead hairline (~z1.56) at the front, above the
    ears at the sides, down the occiput to the nape (~z1.42) at the back."""
    a = abs(theta_deg)
    if a <= 90.0:
        return lerp(44.0, 2.0, a / 90.0)
    return lerp(2.0, -38.0, (a - 90.0) / 90.0)


def build_cap(tree: BVHTree, verts: list[Vector], faces: list[tuple[int, ...]]) -> int:
    grid: list[list[int]] = []
    for i in range(CAP_THETA_STEPS):
        theta_deg = lerp(-180.0, 180.0, i / (CAP_THETA_STEPS - 1))
        theta = math.radians(theta_deg)
        psi_min = cap_psi_min_deg(theta_deg)
        col: list[int] = []
        for j in range(CAP_ROWS):
            psi = math.radians(lerp(88.0, psi_min, j / (CAP_ROWS - 1)))
            raw = HEAD_CENTER + Vector((
                math.cos(psi) * math.sin(theta),
                -math.cos(psi) * math.cos(theta),
                math.sin(psi),
            )) * CAP_RADIUS
            lift = 0.0030 + 0.0022 * math.sin(math.pi * j / (CAP_ROWS - 1))
            # Shallow groove along x~0 on top suggests the middle part.
            if abs(raw.x) < 0.006 and raw.z > HEAD_CENTER.z:
                lift *= 0.5
            res = conform(tree, raw, lift)
            if res is None:
                col.append(-1)
                continue
            col.append(len(verts))
            verts.append(res[0])
        grid.append(col)
    added = 0
    for i in range(CAP_THETA_STEPS - 1):
        for j in range(CAP_ROWS - 1):
            a, b = grid[i][j], grid[i][j + 1]
            c, d = grid[i + 1][j + 1], grid[i + 1][j]
            if -1 in (a, b, c, d):
                continue
            faces.append((a, b, c, d))
            added += 1
    return added


def build_hair(tree: BVHTree) -> tuple[bpy.types.Object, dict]:
    verts: list[Vector] = []
    faces: list[tuple[int, ...]] = []
    stats = {"locks": {}, "skipped": 0}
    stats["cap_quads"] = build_cap(tree, verts, faces)

    def emit(lock: Lock) -> None:
        base = len(verts)
        for pt, wdir, w in zip(lock.stations, lock.wdirs, lock.widths):
            half = wdir * (w * 0.5)
            verts.append(pt - half)
            verts.append(pt + half)
        for i in range(len(lock.stations) - 1):
            a = base + i * 2
            faces.append((a, a + 1, a + 3, a + 2))

    for side, sign in (("L", 1.0), ("R", -1.0)):
        count = 0

        # Family A — rooted along the middle part, sweeping over the skull
        # side, behind the ear, then hanging down the back.
        for k in range(PART_LOCKS_PER_SIDE):
            u = (k + 0.5) / PART_LOCKS_PER_SIDE
            # Structural noise is side-symmetric (hash without sign) so the
            # anchor-symmetry gate holds; only small jitters differ per side.
            n_struct = frac_hash(k * 3.1, 17.3)
            n_side = frac_hash(k * 5.7, sign * 9.1)
            root_raw = Vector((sign * PART_X, lerp(PART_Y_FRONT, PART_Y_BACK, u), 1.62))
            g_side = Vector((
                sign * 0.078,
                lerp(-0.070, 0.030, u),
                lerp(1.505, 1.485, u),
            ))
            # z=1.445 keeps the sweep on the occiput, above the concave
            # under-ear/neck crease that caught the first build.
            g_nape = Vector((
                sign * lerp(0.062, 0.008, u),
                0.052,
                1.445,
            ))
            hang_x = sign * lerp(0.088, 0.0, u)
            tip_z = lerp(TIP_Z_MIN, TIP_Z_MAX, n_struct)
            vol_lift = lerp(VOL_LIFT_MIN, VOL_LIFT_MAX, frac_hash(k * 7.9, 4.2))
            width = 0.013 * (0.85 + 0.30 * n_struct)
            lock = build_lock(
                tree, sign, [root_raw, g_side, g_nape], 7,
                hang_x, tip_z, vol_lift, width, (n_side - 0.5),
            )
            if lock is None:
                stats["skipped"] += 1
                continue
            emit(lock)
            count += 1

        # Family B — under-layer rooted along the side/back hairline ring,
        # falling more directly down the back.
        for k in range(RING_LOCKS_PER_SIDE):
            q = (k + 0.5) / RING_LOCKS_PER_SIDE
            phi = math.radians(lerp(75.0, 178.0, q))
            n_struct = frac_hash(k * 2.3, 31.7)
            n_side = frac_hash(k * 6.1, sign * 13.9)
            root_raw = Vector((
                sign * 0.15 * math.sin(phi),
                HEAD_CENTER.y - 0.15 * math.cos(phi),
                lerp(1.545, 1.505, q),
            ))
            g_nape = Vector((
                sign * lerp(0.058, 0.006, q),
                0.050,
                1.448,
            ))
            hang_x = sign * lerp(0.095, 0.006, q)
            tip_z = lerp(TIP_Z_MIN, TIP_Z_MAX, n_struct)
            vol_lift = lerp(VOL_LIFT_MIN, VOL_LIFT_MAX, frac_hash(k * 8.3, 6.6))
            width = 0.012 * (0.85 + 0.30 * n_struct)
            lock = build_lock(
                tree, sign, [root_raw, g_nape], 5,
                hang_x, tip_z, vol_lift, width, (n_side - 0.5),
            )
            if lock is None:
                stats["skipped"] += 1
                continue
            emit(lock)
            count += 1

        stats["locks"][side] = count

    # Card EDGE vertices (station ± half-width in the tangent plane) can dip
    # into the skin in concave regions (under-ear/neck crease) even when the
    # station centers are conformed. Push every vertex out to >=1.2mm along
    # the local surface normal so the penetration gate holds by construction.
    pushed = 0
    for idx, v in enumerate(verts):
        nearest = tree.find_nearest(v)
        if nearest[0] is None:
            continue
        normal = nearest[1].normalized()
        signed = (v - nearest[0]).dot(normal)
        if signed < 0.0012:
            verts[idx] = nearest[0] + normal * 0.0012
            pushed += 1
    stats["verts_pushed_off_skin"] = pushed

    mesh = bpy.data.meshes.new("avatar_36C_hair_mesh")
    mesh.from_pydata([v for v in verts], [], faces)

    mat = bpy.data.materials.new("avatar_36C_hair_DRAFT")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    # Deep warm brown, matte — reviewer-selected, matching the brow material.
    bsdf.inputs["Base Color"].default_value = (0.032, 0.020, 0.012, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.05
    mesh.materials.append(mat)
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.update(calc_edges=True)

    obj = bpy.data.objects.new("avatar_36C_hair", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj["asset_id"] = "avatar_36C"
    obj["object_role"] = HAIR_ROLE
    obj["asset_status"] = "DRAFT_NOT_TD_VALIDATED"
    obj["generator"] = "scripts/build_hair.py"
    obj["lock_counts"] = json.dumps(stats["locks"])
    return obj, stats


# ---------------------------------------------------------------------------
# Gates


def run_gates(
    body: bpy.types.Object,
    snapshot: list[list[tuple[float, float, float]]],
    hair: bpy.types.Object,
    tree: BVHTree,
    build_stats: dict,
    backup_path: Path,
) -> tuple[dict, dict]:
    checks: dict[str, bool] = {}
    stats: dict = dict(build_stats)

    checks["backup_written"] = backup_path.exists() and backup_path.stat().st_size > 0

    after = snapshot_layers(body)
    checks["scope_lock_zero_body_vertex_movement"] = after == snapshot
    checks["body_topology_unchanged"] = (
        len(after[0]) == len(snapshot[0])
        and len(body.data.polygons) > 0
    )

    matrix = hair.matrix_world
    world_verts = [matrix @ v.co for v in hair.data.vertices]

    max_dist = 0.0
    min_signed = 1.0
    floating = 0
    penetrating = 0
    pen_samples: list[list[float]] = []
    for wp in world_verts:
        nearest = tree.find_nearest(wp)
        gap = (wp - nearest[0]).length
        signed = (wp - nearest[0]).dot(nearest[1].normalized())
        max_dist = max(max_dist, gap)
        min_signed = min(min_signed, signed)
        if gap > MAX_SURFACE_DIST:
            floating += 1
        if signed < -0.0001:
            penetrating += 1
            if len(pen_samples) < 12:
                pen_samples.append([round(c, 4) for c in wp] + [round(signed * 1000, 2)])
    stats["penetration_samples"] = pen_samples
    checks["bounded_float_envelope"] = floating == 0
    checks["no_skin_penetration"] = penetrating == 0
    stats["max_vertex_to_skin_mm"] = round(max_dist * 1000.0, 3)
    stats["min_signed_offset_mm"] = round(min_signed * 1000.0, 3)

    face_violations = 0
    eye_hits = 0
    front_violations = 0
    front_samples: list[list[float]] = []
    for wp in world_verts:
        if wp.y < FACE_Y_LIMIT and wp.z < FACE_MIN_Z:
            face_violations += 1
        for center in EYE_CENTERS:
            if (wp - center).length < EYE_CLEARANCE:
                eye_hits += 1
                break
        if wp.z < FRONT_CLEAR_Z and wp.y < FRONT_CLEAR_Y:
            front_violations += 1
            if len(front_samples) < 12:
                front_samples.append([round(c, 4) for c in wp])
    stats["front_samples"] = front_samples
    checks["face_and_eyes_clear"] = face_violations == 0 and eye_hits == 0
    checks["front_clearance_below_neck"] = front_violations == 0
    stats["face_violations"] = face_violations
    stats["eye_clearance_hits"] = eye_hits
    stats["front_violations"] = front_violations

    min_z = min(wp.z for wp in world_verts)
    max_z = max(wp.z for wp in world_verts)
    stats["min_z"] = round(min_z, 4)
    stats["max_z"] = round(max_z, 4)
    checks["shoulder_length_band"] = SHOULDER_BAND[0] <= min_z <= SHOULDER_BAND[1]
    checks["max_height"] = max_z <= MAX_TOP_Z

    tris = sum(max(0, len(p.vertices) - 2) for p in hair.data.polygons)
    checks["triangle_budget"] = tris <= ADDED_TRI_BUDGET
    stats["added_triangles"] = tris

    counts = stats["locks"]
    checks["both_sides_populated"] = counts.get("L", 0) >= 25 and counts.get("R", 0) >= 25
    mean_count = (counts.get("L", 0) + counts.get("R", 0)) / 2.0
    checks["side_count_balance"] = (
        abs(counts.get("L", 0) - counts.get("R", 0)) <= max(3, round(0.05 * mean_count))
    )

    # Anchor symmetry: hair locks are large structures with per-lock noise, so
    # the mirrored-mean tolerance is 2.5mm (brows used 1mm on tiny strands);
    # structural noise is side-symmetric so the means should stay well inside.
    # Dead zone: cap columns on the centerline meridians (x ~ 0) belong to
    # neither side; float-sign classification of those verts skews the means.
    left = [wp for wp in world_verts if wp.x > 0.002]
    right = [wp for wp in world_verts if wp.x < -0.002]
    checks["both_sides_have_geometry"] = bool(left) and bool(right)
    if left and right:
        mean_l = sum(left, Vector()) / len(left)
        mean_r = sum(right, Vector()) / len(right)
        mirror_gap = (Vector((-mean_l.x, mean_l.y, mean_l.z)) - mean_r).length
        checks["anchor_symmetry_2_5mm"] = mirror_gap < 0.0025
        stats["anchor_mirror_gap_mm"] = round(mirror_gap * 1000.0, 3)
        mirrored_left = sorted((round(-p.x, 6), round(p.y, 6), round(p.z, 6)) for p in left)
        right_set = sorted((round(p.x, 6), round(p.y, 6), round(p.z, 6)) for p in right)
        checks["not_mirror_identical"] = mirrored_left != right_set
    else:
        checks["anchor_symmetry_2_5mm"] = False
        checks["not_mirror_identical"] = False

    mat = hair.data.materials[0] if hair.data.materials else None
    bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat else None
    checks["material_matte"] = bool(bsdf) and bsdf.inputs["Roughness"].default_value >= 0.7

    checks["object_props"] = (
        hair.get("asset_id") == "avatar_36C"
        and hair.get("object_role") == HAIR_ROLE
        and hair.get("asset_status") == "DRAFT_NOT_TD_VALIDATED"
    )

    return checks, stats


# ---------------------------------------------------------------------------
# Renders


def point_at(obj: bpy.types.Object, target: Vector) -> None:
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_post_views(body: bpy.types.Object) -> list[str]:
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

    target = Vector((0.0, -0.03, 1.44))

    def add_area(name, location, energy, size):
        data = bpy.data.lights.new(name=name, type="AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        point_at(obj, target)
        return obj

    temp = []
    temp.append(add_area("HairQA_Key", (0.5, target.y - 0.9, target.z + 0.4), 70.0, 0.18))
    temp.append(add_area("HairQA_Fill", (-0.6, target.y - 0.7, target.z), 25.0, 0.35))
    temp.append(add_area("HairQA_Rim", (0.0, target.y + 0.8, target.z + 0.5), 80.0, 0.8))

    camera_data = bpy.data.cameras.new("HairQA_Camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("HairQA_Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    temp.append(camera)
    scene.camera = camera

    distance = 1.2
    views = {
        "face-front": (Vector((0.0, -distance, 0.05)), 0.30, Vector((0.0, -0.05, 1.49))),
        "hair-front": (Vector((0.0, -distance, 0.0)), 0.60, target),
        "hair-45L": (Vector((distance * 0.707, -distance * 0.707, 0.0)), 0.60, target),
        "hair-45R": (Vector((-distance * 0.707, -distance * 0.707, 0.0)), 0.60, target),
        "hair-sideL": (Vector((distance, 0.0, 0.0)), 0.60, target),
        "hair-back": (Vector((0.0, distance, 0.0)), 0.60, target),
        "hair-top": (Vector((0.0, 0.02, 1.0)), 0.40, Vector((0.0, -0.03, 1.55))),
    }
    outputs = []
    for name, (offset, ortho_scale, view_target) in views.items():
        camera.location = view_target + offset
        camera.data.ortho_scale = ortho_scale
        point_at(camera, view_target)
        output = HAIR_DIR / f"post-{name}.png"
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
    HAIR_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = BACKUP_DIR / f"avatar_36C_master.pre-hair-{stamp}.blend"
    shutil.copy2(BLEND_PATH, backup_path)

    body = find_body()
    remove_existing()
    snapshot = snapshot_layers(body)

    tree, _eval_obj = world_skin_bvh(body)
    hair, build_stats = build_hair(tree)
    checks, stats = run_gates(body, snapshot, hair, tree, build_stats, backup_path)

    passed = all(checks.values())
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "purpose": (
            "Gated hair build: shoulder-length lock-card hair, middle part, all "
            "locks behind the shoulders, deep warm brown matte. Machine gates "
            "only; grants no TD, visual or anatomical approval."
        ),
        "backup_blend": str(backup_path.relative_to(ROOT)),
        "backup_sha256": sha256(backup_path),
        "style": {
            "length": "shoulder (tip z band %.3f-%.3f)" % (TIP_Z_MIN, TIP_Z_MAX),
            "placement": "all locks behind the shoulders; chest/neckline clear",
            "part": "middle",
            "color": "deep warm brown matching brow material",
        },
        "checks": checks,
        "stats": stats,
        "result": "PASS" if passed else "FAIL",
        "saved": False,
        "warning": (
            "DRAFT hair build. Zero body vertices moved; all hair geometry is a "
            "new separate object (HAIR role)."
        ),
    }

    if passed:
        report["views"] = render_post_views(body)
        bpy.ops.wm.save_mainfile()
        report["saved"] = True
        report["blend_sha256_after_save"] = sha256(BLEND_PATH)

    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print("HAIR_BUILD_REPORT=" + json.dumps(report, separators=(",", ":")))
    if not passed:
        failed = [name for name, ok in checks.items() if not ok]
        raise RuntimeError(f"Hair build gates failed: {failed}; nothing saved")


main()
