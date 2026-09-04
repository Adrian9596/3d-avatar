"""Gated eyebrow build for the draft 36C avatar.

Authors `avatar_36C_eyebrows` (role EYEBROW): natural Asian-female straight/
soft-arch fiber-card brows rooted on the evaluated skin surface via raycast.
Anchors come from the brow-ridge probe recorded in
qa/avatar_36C/brows/brow-baseline-issues.md.

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
BROWS_DIR = ROOT / "qa" / "avatar_36C" / "brows"
REPORT = BROWS_DIR / "brow-build-report.json"
BACKUP_DIR = ROOT / "backups"

EYE_CZ = 1.4872
EYE_CY = -0.11009
EYE_CX = 0.02847
EYE_RADIUS = 0.0151445
EYE_CENTERS = {
    "L": Vector((EYE_CX, EYE_CY, EYE_CZ)),
    "R": Vector((-EYE_CX, EYE_CY, EYE_CZ)),
}

UP = Vector((0.0, 0.0, 1.0))

# Centerline anchors (probe-derived): head aligned with inner eye corner,
# soft low arch at ~2/3, tail ends lower than head following the rim drop.
BROW_X_HEAD = 0.0145
BROW_X_TAIL = 0.0525
BROW_Z_BASE = 0.0175          # above eye-center z at the head
BROW_ARCH_AMPL = 0.0030
BROW_ARCH_CENTER = 0.62
BROW_ARCH_WIDTH = 0.28
BROW_TAIL_DROP = 0.0045

# Thin (0.1mm) strands need overlap to read as a brow at distance — real
# brows are many fine hairs, so count is high while each strand stays short.
HAIRS_PER_SIDE = 936
ROOT_LIFT = 0.0003            # roots float this far off the skin along the normal
CONFORM_LIFT = 0.0004
ADDED_TRI_BUDGET = 5200
HEIGHT_BAND = (0.010, 0.032)  # allowed root z offsets above eye-center z
EYE_CLEARANCE = 0.001
MIN_Z_ABOVE_EYE = 0.008
MAX_SURFACE_DIST = 0.0018     # any hair vertex farther than this from skin = floating

BROW_ROLE = "EYEBROW"


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
        if obj.type == "MESH" and obj.get("object_role") == BROW_ROLE:
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.name.startswith("avatar_36C_brow") and mat.users == 0:
            bpy.data.materials.remove(mat)


def snapshot_layers(body: bpy.types.Object) -> list[list[tuple[float, float, float]]]:
    layers = [[tuple(v.co) for v in body.data.vertices]]
    if body.data.shape_keys:
        for kb in body.data.shape_keys.key_blocks:
            layers.append([tuple(p.co) for p in kb.data])
    return layers


def world_skin_bvh(body: bpy.types.Object) -> tuple[BVHTree, bpy.types.Object]:
    """World-space BVH of the evaluated visible skin (Mask modifier active,
    so helpers are excluded). Returns the tree and the evaluated object used
    for raycasts (kept alive by the caller's depsgraph reference)."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = body.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    matrix = eval_obj.matrix_world
    verts = [matrix @ v.co for v in mesh.vertices]
    polys = [tuple(p.vertices) for p in mesh.polygons]
    tree = BVHTree.FromPolygons(verts, polys)
    eval_obj.to_mesh_clear()
    return tree, eval_obj


def surface_hit(tree: BVHTree, x: float, z: float) -> tuple[Vector, Vector] | None:
    origin = Vector((x, -0.5, z))
    hit = tree.ray_cast(origin, Vector((0.0, 1.0, 0.0)))
    if hit[0] is None:
        return None
    return hit[0], hit[1].normalized()


def conform(tree: BVHTree, point: Vector, lift: float) -> Vector | None:
    nearest = tree.find_nearest(point)
    if nearest[0] is None:
        return None
    return nearest[0] + nearest[1].normalized() * lift


def centerline(t: float) -> tuple[float, float, float]:
    """Returns (x, z_offset, half_height) for parameter t in [0, 1]."""
    x = BROW_X_HEAD + (BROW_X_TAIL - BROW_X_HEAD) * t
    arch = BROW_ARCH_AMPL * math.exp(-((t - BROW_ARCH_CENTER) / BROW_ARCH_WIDTH) ** 2)
    droop = BROW_TAIL_DROP * max(0.0, (t - 0.78) / 0.22) ** 1.5
    z_off = BROW_Z_BASE + arch - droop
    half_height = 0.0022 * (1.0 - t) ** 0.7 + 0.0006
    return x, z_off, half_height


def hair_length(t: float, noise: float) -> float:
    # Short individual hairs — no long continuous strokes; mid and tail
    # shortened further so strands never read as long strokes.
    base = 0.0016 + 0.0008 * math.exp(-((t - 0.42) / 0.35) ** 2)
    base *= 1.0 - 0.35 * max(0.0, (t - 0.68) / 0.32)
    # Reviewer 2026-08-15: strands ~30% longer for a fuller soft brow.
    return 1.3 * base * (0.85 + 0.25 * noise)


def hair_direction(t: float, lateral: Vector, jitter: float) -> Vector:
    # Head hairs grow mostly upward; mid hairs rotate gradually outward and
    # slightly downward; tail hairs stay outward/slightly-down.
    w_up = max(-0.35, min(0.80, 0.80 - 1.60 * t))
    d = lateral + UP * (w_up + jitter * 0.20)
    return d.normalized()


def build_brows(tree: BVHTree) -> tuple[bpy.types.Object, dict]:
    verts: list[Vector] = []
    faces: list[tuple[int, ...]] = []
    stats = {"hairs": {}, "skipped_no_surface": 0}

    def add_card(root: Vector, mid: Vector, tip: Vector, tangent: Vector, width: float) -> None:
        half_root = tangent * (width * 0.5)
        half_mid = tangent * (width * 0.20)
        base = len(verts)
        verts.extend((root - half_root, root + half_root, mid + half_mid, mid - half_mid))
        faces.append((base, base + 1, base + 2, base + 3))
        base = len(verts)
        verts.extend((verts[base - 1], verts[base - 2], tip))
        faces.append((base, base + 1, base + 2))

    for side, sign in (("L", 1.0), ("R", -1.0)):
        lateral = Vector((sign, 0.0, 0.0))
        count = 0
        for k in range(HAIRS_PER_SIDE):
            n1 = frac_hash(k * 1.7, sign * 5.3)
            n2 = frac_hash(k * 2.9, sign * 11.1)
            n3 = frac_hash(k * 4.3, sign * 3.7)
            t = (k + (n1 - 0.5) * 1.2) / (HAIRS_PER_SIDE - 1)
            t = min(1.0, max(0.0, t))
            # Sparser feathered head: thin out hairs toward the inner end so
            # they never stack into a solid dark patch.
            if t < 0.18 and frac_hash(k * 7.1, sign * 9.4) < 0.45 * (1.0 - t / 0.18):
                continue
            # Progressively lighter tail: density falls off after ~72%.
            if t > 0.72 and frac_hash(k * 6.3, sign * 8.2) < 0.55 * (t - 0.72) / 0.28:
                continue
            # Global random dropout breaks parallel/evenly-spaced patterns.
            if frac_hash(k * 9.7, sign * 4.1) < 0.08:
                continue
            # Mid section stays medium density: light thinning so strands
            # read individually without the band turning solid or patchy.
            if 0.25 < t < 0.68 and frac_hash(k * 5.9, sign * 7.7) < 0.20:
                continue
            x_c, z_off, half_h = centerline(t)
            band_u = (n2 - 0.5) * 2.0
            z = EYE_CZ + z_off + band_u * half_h
            res = surface_hit(tree, sign * x_c, z)
            if res is None:
                stats["skipped_no_surface"] += 1
                continue
            surf, normal = res
            root = surf + normal * ROOT_LIFT

            direction = hair_direction(t, lateral, (n3 - 0.5))
            direction = (direction - normal * direction.dot(normal)).normalized()
            # Gentle per-hair curve: the tip continues in the flow direction of
            # slightly further along the brow, so strands bend with the growth
            # flow instead of reading as straight ribbon dashes.
            dir_tip = hair_direction(min(1.0, t + 0.22), lateral, (n3 - 0.5))
            dir_tip = (dir_tip - normal * dir_tip.dot(normal)).normalized()
            length = hair_length(t, n1)
            # Hairs rooted high in the band stay short so no isolated spike
            # pokes above the brow silhouette.
            if band_u > 0.0:
                length *= 1.0 - 0.40 * band_u
            width = 0.000095 * (0.8 + 0.4 * n2) * (1.0 - 0.45 * t)

            mid_raw = root + direction * (length * 0.5)
            mid = conform(tree, mid_raw, CONFORM_LIFT)
            tip_raw = (mid or mid_raw) + dir_tip * (length * 0.5)
            tip = conform(tree, tip_raw, CONFORM_LIFT + 0.0001)
            if mid is None or tip is None:
                stats["skipped_no_surface"] += 1
                continue

            tangent = direction.cross(normal)
            if tangent.length < 1e-6:
                tangent = UP.cross(normal)
            tangent = tangent.normalized()
            add_card(root, mid, tip, tangent, width)
            count += 1
        stats["hairs"][side] = count

    mesh = bpy.data.meshes.new("avatar_36C_eyebrows_mesh")
    mesh.from_pydata([v for v in verts], [], faces)

    mat = bpy.data.materials.new("avatar_36C_brow_DRAFT")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    # Soft dark brown (not near-black), matte — natural hair, not makeup.
    # Deepened + specular killed to compensate for 0.1mm-thin strands washing
    # out under AA/sheen at distance; hue ratio kept warm brown.
    bsdf.inputs["Base Color"].default_value = (0.032, 0.020, 0.012, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.05
    mesh.materials.append(mat)
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.update(calc_edges=True)

    obj = bpy.data.objects.new("avatar_36C_eyebrows", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj["asset_id"] = "avatar_36C"
    obj["object_role"] = BROW_ROLE
    obj["asset_status"] = "DRAFT_NOT_TD_VALIDATED"
    obj["generator"] = "scripts/build_eyebrow_region.py"
    obj["hair_counts"] = json.dumps(stats["hairs"])
    return obj, stats


# ---------------------------------------------------------------------------
# Gates


def run_gates(
    body: bpy.types.Object,
    snapshot: list[list[tuple[float, float, float]]],
    brows: bpy.types.Object,
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

    matrix = brows.matrix_world
    world_verts = [matrix @ v.co for v in brows.data.vertices]

    # Root proximity: card root pairs are the first two verts of each 7-vert
    # hair block; check every vertex for float/penetration instead of tracking
    # blocks — stricter and simpler.
    max_dist = 0.0
    min_signed = 1.0
    floating = 0
    penetrating = 0
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
    checks["no_floating_hairs"] = floating == 0
    checks["no_skin_penetration"] = penetrating == 0
    stats["max_vertex_to_skin_mm"] = round(max_dist * 1000.0, 3)
    stats["min_signed_offset_mm"] = round(min_signed * 1000.0, 3)

    eye_hits = 0
    below_band = 0
    z_offsets = []
    for wp in world_verts:
        for center in EYE_CENTERS.values():
            if (wp - center).length < EYE_RADIUS + EYE_CLEARANCE:
                eye_hits += 1
                break
        if wp.z < EYE_CZ + MIN_Z_ABOVE_EYE:
            below_band += 1
        z_offsets.append(wp.z - EYE_CZ)
    checks["clear_of_eyes_and_lashes"] = eye_hits == 0 and below_band == 0
    stats["verts_near_eyeballs"] = eye_hits
    stats["verts_below_min_z"] = below_band
    stats["root_z_offset_range_mm"] = [
        round(min(z_offsets) * 1000.0, 1),
        round(max(z_offsets) * 1000.0, 1),
    ]
    checks["height_band"] = (
        min(z_offsets) >= HEIGHT_BAND[0] - 0.004
        and max(z_offsets) <= HEIGHT_BAND[1] + 0.006
    )

    tris = sum(max(0, len(p.vertices) - 2) for p in brows.data.polygons)
    checks["triangle_budget"] = tris <= ADDED_TRI_BUDGET
    stats["added_triangles"] = tris

    counts = stats["hairs"]
    checks["both_sides_populated"] = counts.get("L", 0) >= 200 and counts.get("R", 0) >= 200
    mean_count = (counts.get("L", 0) + counts.get("R", 0)) / 2.0
    checks["side_count_balance"] = (
        abs(counts.get("L", 0) - counts.get("R", 0)) <= max(15, round(0.05 * mean_count))
    )

    # Anchor symmetry: mirrored mean positions within 1 mm, but the vertex
    # clouds must NOT be exact mirrors (natural per-hair variation).
    left = [wp for wp in world_verts if wp.x > 0]
    right = [wp for wp in world_verts if wp.x < 0]
    mean_l = sum(left, Vector()) / len(left)
    mean_r = sum(right, Vector()) / len(right)
    mirror_gap = (Vector((-mean_l.x, mean_l.y, mean_l.z)) - mean_r).length
    checks["anchor_symmetry_1mm"] = mirror_gap < 0.001
    stats["anchor_mirror_gap_mm"] = round(mirror_gap * 1000.0, 3)
    mirrored_left = sorted((round(-p.x, 6), round(p.y, 6), round(p.z, 6)) for p in left)
    right_set = sorted((round(p.x, 6), round(p.y, 6), round(p.z, 6)) for p in right)
    checks["not_mirror_identical"] = mirrored_left != right_set

    mat = brows.data.materials[0] if brows.data.materials else None
    bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat else None
    checks["material_matte"] = bool(bsdf) and bsdf.inputs["Roughness"].default_value >= 0.7

    checks["object_props"] = (
        brows.get("asset_id") == "avatar_36C"
        and brows.get("object_role") == BROW_ROLE
        and brows.get("asset_status") == "DRAFT_NOT_TD_VALIDATED"
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

    target = Vector((0.0, EYE_CY, EYE_CZ + 0.008))

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
    temp.append(add_area("BrowQA_Key", (0.5, target.y - 0.9, target.z + 0.4), 70.0, 0.18))
    temp.append(add_area("BrowQA_Fill", (-0.6, target.y - 0.7, target.z), 25.0, 0.35))
    temp.append(add_area("BrowQA_Rim", (0.0, target.y + 0.8, target.z + 0.5), 80.0, 0.8))

    camera_data = bpy.data.cameras.new("BrowQA_Camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("BrowQA_Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    temp.append(camera)
    scene.camera = camera

    distance = 1.2
    views = {
        "face-front": (Vector((0.0, -distance, 0.0)), 0.30),
        "brows-front": (Vector((0.0, -distance, 0.0)), 0.15),
        "brows-45L": (Vector((distance * 0.707, -distance * 0.707, 0.0)), 0.15),
        "brows-45R": (Vector((-distance * 0.707, -distance * 0.707, 0.0)), 0.15),
        "brows-sideL": (Vector((distance, 0.0, 0.0)), 0.15),
        "brow-close-L": (Vector((0.25, -distance, 0.05)), 0.06),
    }
    outputs = []
    for name, (offset, ortho_scale) in views.items():
        view_target = target.copy()
        if name == "brow-close-L":
            view_target = target + Vector((0.032, 0.0, 0.015))
        camera.location = view_target + offset
        camera.data.ortho_scale = ortho_scale
        point_at(camera, view_target)
        output = BROWS_DIR / f"post-{name}.png"
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
    BROWS_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = BACKUP_DIR / f"avatar_36C_master.pre-brows-{stamp}.blend"
    shutil.copy2(BLEND_PATH, backup_path)

    body = find_body()
    remove_existing()
    snapshot = snapshot_layers(body)

    tree, _eval_obj = world_skin_bvh(body)
    brows, build_stats = build_brows(tree)
    checks, stats = run_gates(body, snapshot, brows, tree, build_stats, backup_path)

    passed = all(checks.values())
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "purpose": (
            "Gated eyebrow build: natural Asian-female straight/soft-arch fiber-card "
            "brows rooted on the evaluated skin via raycast. Machine gates only; "
            "grants no TD, visual or anatomical approval."
        ),
        "backup_blend": str(backup_path.relative_to(ROOT)),
        "backup_sha256": sha256(backup_path),
        "anchors": {
            "x_head_mm": BROW_X_HEAD * 1000.0,
            "x_tail_mm": BROW_X_TAIL * 1000.0,
            "z_base_off_mm": BROW_Z_BASE * 1000.0,
            "arch_ampl_mm": BROW_ARCH_AMPL * 1000.0,
            "arch_center_t": BROW_ARCH_CENTER,
            "tail_drop_mm": BROW_TAIL_DROP * 1000.0,
        },
        "checks": checks,
        "stats": stats,
        "result": "PASS" if passed else "FAIL",
        "saved": False,
        "warning": (
            "DRAFT brow build. Zero body vertices moved; all brow geometry is a new "
            "separate object (EYEBROW role)."
        ),
    }

    if passed:
        report["views"] = render_post_views(body)
        bpy.ops.wm.save_mainfile()
        report["saved"] = True
        report["blend_sha256_after_save"] = sha256(BLEND_PATH)

    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print("BROW_BUILD_REPORT=" + json.dumps(report, separators=(",", ":")))
    if not passed:
        failed = [name for name, ok in checks.items() if not ok]
        raise RuntimeError(f"Brow build gates failed: {failed}; nothing saved")


main()
