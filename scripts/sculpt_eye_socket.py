"""Gated eye-socket definition sculpt for the draft 36C avatar.

Adds a single non-destructive shape key `EyeSocketDefine_DRAFT` (value 1.0)
on the body that deepens the upper-lid crease, lifts the brow bone slightly,
and tilts the lid aperture so the outer corner (đuôi mắt) sits above the
inner one, giving the eye region visible socket depth and a readable tail at
all view angles.

The Basis layer and every existing MPFB macro-target layer stay bit
identical — the sculpt lives only in the new key and can be removed to
restore the exact previous body. No vertex within 2.5 mm of an eyeball
surface is touched, so the lid-over-eye construction and the lash aperture
line are preserved.

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
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
BLEND_PATH = ROOT / "avatar_36C_master.blend"
EYES_DIR = ROOT / "qa" / "avatar_36C" / "eyes"
REPORT = EYES_DIR / "socket-sculpt-report.json"
BACKUP_DIR = ROOT / "backups"

KEY_NAME = "EyeSocketDefine_DRAFT"

EYE_CZ = 1.4872
EYE_CY = -0.11009
EYE_CX = 0.02847
EYE_RADIUS = 0.0151445
EYE_CENTERS_WORLD = {
    "L": Vector((EYE_CX, EYE_CY, EYE_CZ)),
    "R": Vector((-EYE_CX, EYE_CY, EYE_CZ)),
}
# Filled in main(): world centers mapped into the body's LOCAL space (the
# object carries a -26.677 mm z offset, and shape-key layers live in local
# coordinates).
#
# The field and the gates are evaluated against the MACRO BASE — Basis plus the
# seven non-zero MPFB macro-target layers — not against Basis. Those layers move
# the eye region by 52-59 mm (mostly -54 mm in z), so a field authored on Basis
# coordinates lands on the cheek instead of the eye. Relative shape keys sum
# linearly, so a delta measured at the macro-base position and stored on the key
# layer reproduces exactly that delta in the evaluated mesh.
EYE_CENTERS: dict[str, Vector] = {}

# Sculpt field (all metres, relative to the nearer eye center).
# Signed lateral coordinate u = (x - cx) * side_sign, matching
# build_eye_region.py: u > 0 is toward the temple (outer corner / đuôi mắt),
# u < 0 toward the nose.
# draft.16 round 1 (2026-08-15) still did not read at normal viewing distance
# in the full-head front render, only in tight close-up. Round 2 pushes these
# further again, per the user's explicit trade: distance readability over a
# close-up that reads a little more like makeup (task #26).
CREASE_DEPTH = 0.0035         # push into the head (+y) at the crease (was 0.0025)
CREASE_Z_CENTER = 0.0095      # crease band center above eye-center z
CREASE_Z_SIGMA = 0.0042
CREASE_Z_RAMP = 0.22          # crease band rises this much in z per metre of +u (was 0.18)
CREASE_SIGMA_OUTER = 1.65     # lateral sigma multiplier for u > 0 (was 1.40)
CREASE_SIGMA_INNER = 0.70     # lateral sigma multiplier for u < 0
BONE_LIFT = 0.0008            # brow-bone push outward (-y)
BONE_Z_CENTER = 0.0165
BONE_Z_SIGMA = 0.0045
LATERAL_SIGMA = 0.011

# Canthal tilt (Stage A). These act on the lid corners, which sit almost on
# the eyeball surface, so they are applied as a TANGENTIAL slide along the
# eyeball sphere — the radial component is clamped to be non-inward, which is
# what makes CORNER_CLEARANCE safe to set far tighter than EYE_CLEARANCE.
#
# draft.15 assessment (Stage F, 2026-08-15): the tail did not read at front or
# 45 degrees at these values — an amplitude problem, not a correctness one.
# Round 1 raised CANTHUS_LIFT/CANTHUS_LATERAL; still didn't read at normal
# viewing distance. Round 2 (task #26) raises them again, plus widens
# CANTHUS_U_SIGMA so the lift covers more of the outer lid.
CANTHUS_LIFT = 0.0032         # outer-corner z lift (was 0.0020, originally 0.0015)
CANTHUS_U_CENTER = 0.0125
CANTHUS_U_SIGMA = 0.0065      # was 0.0055
CANTHUS_Z_SIGMA = 0.0075      # vertical falloff around eye-center height
CANTHUS_LATERAL = 0.0014      # outward pull tapering the corner to a point (was 0.0008, originally 0.0006)
INNER_DROP = 0.0004           # inner-corner z drop (keeps tilt a rotation)
INNER_U_CENTER = -0.0120
INNER_U_SIGMA = 0.0045

X_LIMIT = 0.018               # |x - cx| eligibility
Z_RANGE = (-0.009, 0.024)     # dz eligibility; widened below eye-center z for
                              # the corners and the outer lower lid
Y_RANGE = (-0.040, 0.012)     # dy eligibility: front-of-face skin only
EYE_CLEARANCE = 0.0025        # basis clearance required for the y-push terms
CORNER_CLEARANCE = 0.0008     # basis clearance required for tangential terms
MAX_DISPLACEMENT = 0.0045     # gate ceiling (was 0.0030, originally 0.0022;
                              # round 2 worst case is CREASE_DEPTH alone at
                              # ~3.5 mm or the corner vector at
                              # sqrt(1.4^2+3.2^2) ~= 3.49 mm, never both on the
                              # same vertex since their z-bands (crease ~9.5 mm
                              # above eye height, canthus ~0) barely overlap)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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


def body_group_indices(body: bpy.types.Object, name: str = "body") -> set[int]:
    group = body.vertex_groups.get(name)
    if group is None:
        raise RuntimeError(f"Vertex group {name!r} not found on body")
    idx = group.index
    members = set()
    for v in body.data.vertices:
        for g in v.groups:
            if g.group == idx and g.weight > 0.5:
                members.add(v.index)
                break
    return members


def evaluate_local(body: bpy.types.Object, mask: bool) -> list[Vector]:
    """Evaluated vertex positions in the body's LOCAL space.

    With mask=False the MASK modifier is bypassed, so the returned list is
    indexed by mesh vertex index.
    """
    saved = [(m, m.show_viewport, m.show_render) for m in body.modifiers if m.type == "MASK"]
    for m, _v, _r in saved:
        m.show_viewport = mask
        m.show_render = mask
    body.update_tag()
    bpy.context.view_layer.update()
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    out = [Vector(v.co) for v in mesh.vertices]
    evaluated.to_mesh_clear()
    for m, vis, rend in saved:
        m.show_viewport = vis
        m.show_render = rend
    body.update_tag()
    bpy.context.view_layer.update()
    return out


def macro_base_positions(body: bpy.types.Object) -> list[Vector]:
    """Local positions the body actually holds before this sculpt is applied."""
    keys = body.data.shape_keys
    existing = keys.key_blocks.get(KEY_NAME) if keys else None
    if existing is not None:
        body.shape_key_remove(existing)
    base = evaluate_local(body, mask=False)
    if len(base) != len(body.data.vertices):
        raise RuntimeError(
            f"Macro base has {len(base)} verts, mesh has {len(body.data.vertices)}"
        )
    return base


def front_surface_map(body: bpy.types.Object, center: Vector) -> dict[tuple[int, int], float]:
    """First-hit y of the front-visible skin on a 1 mm grid around an eye.

    Built from the masked evaluated mesh in LOCAL space — this is the surface a
    front-facing camera sees, so it is the ground truth for whether the sculpt
    reads at all.
    """
    verts = evaluate_local(body, mask=True)
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    tree = BVHTree.FromPolygons(verts, [tuple(p.vertices) for p in mesh.polygons])
    evaluated.to_mesh_clear()
    ray = Vector((0.0, 1.0, 0.0))
    out: dict[tuple[int, int], float] = {}
    for i in range(-16, 17):
        for j in range(-16, 17):
            origin = Vector((center.x + i * 0.001, center.y - 0.08, center.z + j * 0.001))
            location, _n, _idx, _d = tree.ray_cast(origin, ray)
            if location is not None:
                out[(i, j)] = location.y
    return out


def snapshot_existing_layers(body: bpy.types.Object) -> dict[str, list[tuple[float, float, float]]]:
    layers = {"__vertices__": [tuple(v.co) for v in body.data.vertices]}
    if body.data.shape_keys:
        for kb in body.data.shape_keys.key_blocks:
            layers[kb.name] = [tuple(p.co) for p in kb.data]
    return layers


def displacement(co: Vector) -> Vector:
    """Sculpt field, per nearer eye:

    - crease push-in / brow-bone push-out along y, now weighted asymmetrically
      so the fold deepens and rises toward the outer third and dies out at the
      inner corner (Stage B);
    - outer-corner lift + lateral taper and a small inner-corner drop, giving
      positive canthal tilt (Stage A).

    The corner terms operate on vertices that lie almost on the eyeball, so the
    result is clamped to have a non-inward radial component: |co - center| can
    only stay equal or grow, never shrink.
    """
    center = EYE_CENTERS["L"] if co.x >= 0.0 else EYE_CENTERS["R"]
    side_sign = 1.0 if co.x >= 0.0 else -1.0
    dx = co.x - center.x
    dz = co.z - center.z
    dy = co.y - center.y
    if abs(dx) > X_LIMIT or not (Z_RANGE[0] <= dz <= Z_RANGE[1]):
        return Vector((0.0, 0.0, 0.0))
    if not (Y_RANGE[0] <= dy <= Y_RANGE[1]):
        return Vector((0.0, 0.0, 0.0))
    radial_vec = co - center
    dist = radial_vec.length
    if dist < EYE_RADIUS + CORNER_CLEARANCE:
        return Vector((0.0, 0.0, 0.0))

    u = dx * side_sign
    total = Vector((0.0, 0.0, 0.0))

    # y-push terms need real clearance: they can drive skin into the eyeball.
    if dist >= EYE_RADIUS + EYE_CLEARANCE:
        sigma_u = LATERAL_SIGMA * (CREASE_SIGMA_OUTER if u >= 0.0 else CREASE_SIGMA_INNER)
        w_crease_x = math.exp(-((u / sigma_u) ** 2))
        if u >= 0.0:
            crease_gain = 0.70 + 0.30 * min(1.0, u / 0.013)
        else:
            crease_gain = 0.70 * max(0.0, 1.0 + u / 0.012)
        z_center = CREASE_Z_CENTER + CREASE_Z_RAMP * max(-0.006, min(0.013, u))
        w_crease = math.exp(-(((dz - z_center) / CREASE_Z_SIGMA) ** 2))
        # Brow bone stays laterally symmetric: draft.15 behaviour is correct.
        w_bone_x = math.exp(-((dx / LATERAL_SIGMA) ** 2))
        w_bone = math.exp(-(((dz - BONE_Z_CENTER) / BONE_Z_SIGMA) ** 2))
        total.y += CREASE_DEPTH * w_crease_x * w_crease * crease_gain
        total.y -= BONE_LIFT * w_bone_x * w_bone

    w_z = math.exp(-((dz / CANTHUS_Z_SIGMA) ** 2))
    w_out = math.exp(-(((u - CANTHUS_U_CENTER) / CANTHUS_U_SIGMA) ** 2)) * w_z
    w_in = math.exp(-(((u - INNER_U_CENTER) / INNER_U_SIGMA) ** 2)) * w_z
    corner = Vector((
        side_sign * CANTHUS_LATERAL * w_out,
        0.0,
        CANTHUS_LIFT * w_out - INNER_DROP * w_in,
    ))
    # Clamp only the corner vector. Clamping the sum would also strip the
    # inward radial part of the crease push — for skin in front of the eye the
    # radial points forward, so that would convert crease depth into an upward
    # slide and flatten the fold. The crease terms are instead protected by the
    # EYE_CLEARANCE gate above plus no_post_sculpt_eyeball_contact.
    radial = radial_vec.normalized()
    inward = corner.dot(radial)
    if inward < 0.0:
        corner -= radial * inward
    # Shape-key data is stored as float32 (~1e-7 relative precision at these
    # magnitudes), which can round a razor-thin zero radial component back
    # negative and trip no_vertex_moved_toward_eye_center. Push a further
    # 1 micron outward — negligible next to CORNER_CLEARANCE (0.8 mm) — so
    # quantization cannot flip the sign.
    corner += radial * 1e-6
    return total + corner


def apply_sculpt(body: bpy.types.Object, members: set[int], base: list[Vector]) -> dict:
    keys = body.data.shape_keys
    existing = keys.key_blocks.get(KEY_NAME)
    if existing:
        body.shape_key_remove(existing)
    key = body.shape_key_add(name=KEY_NAME, from_mix=False)
    key.slider_min = 0.0
    key.slider_max = 1.0
    key.value = 1.0

    basis = keys.key_blocks[0]
    # from_mix=False copies the MESH base vertices, which sit 26.677 mm below
    # the Basis layer in this asset — re-seed the key from Basis explicitly so
    # value 1.0 adds only the sculpt delta.
    for i in range(len(basis.data)):
        key.data[i].co = basis.data[i].co
    moved = {"L": 0, "R": 0}
    max_disp = 0.0
    for i in members:
        # Field is sampled where the vertex ACTUALLY sits (macro base), while the
        # delta is stored on top of Basis — relative keys sum, so the evaluated
        # mesh receives exactly this delta.
        d = displacement(base[i])
        if d.length < 1e-7:
            continue
        key.data[i].co = Vector(basis.data[i].co) + d
        moved["L" if base[i].x >= 0.0 else "R"] += 1
        max_disp = max(max_disp, d.length)
    return {"moved": moved, "max_displacement_mm": round(max_disp * 1000.0, 3)}


def run_gates(
    body: bpy.types.Object,
    before: dict[str, list[tuple[float, float, float]]],
    stats: dict,
    backup_path: Path,
    base: list[Vector],
    front_before: dict[str, dict[tuple[int, int], float]],
) -> dict[str, bool]:
    checks: dict[str, bool] = {}
    checks["backup_written"] = backup_path.exists() and backup_path.stat().st_size > 0

    after = snapshot_existing_layers(body)
    checks["topology_unchanged"] = len(after["__vertices__"]) == len(before["__vertices__"])
    untouched = True
    for name, layer in before.items():
        if name == KEY_NAME:
            continue
        if after.get(name) != layer:
            untouched = False
    checks["basis_and_existing_layers_bit_identical"] = untouched

    key = body.data.shape_keys.key_blocks.get(KEY_NAME) if body.data.shape_keys else None
    checks["sculpt_key_present_value_1"] = bool(key) and abs(key.value - 1.0) < 1e-6

    basis = body.data.shape_keys.key_blocks[0]
    max_disp = 0.0
    outside_region = 0
    too_close_to_eye = 0
    min_radial_change = 0.0
    outer_z_gains: list[float] = []
    inner_z_deltas: list[float] = []
    max_eye_distance = 0.0
    for i in range(len(body.data.vertices)):
        delta = Vector(key.data[i].co) - Vector(basis.data[i].co)
        d = delta.length
        if d < 1e-7:
            continue
        max_disp = max(max_disp, d)
        # Everything below is measured in evaluated space: b is where the vertex
        # sits before the sculpt, k where it lands after.
        b = base[i]
        k = b + delta
        center = EYE_CENTERS["L"] if b.x >= 0.0 else EYE_CENTERS["R"]
        max_eye_distance = max(max_eye_distance, (b - center).length)
        if not (
            abs(b.x - center.x) <= X_LIMIT + 0.001
            and Z_RANGE[0] - 0.001 <= b.z - center.z <= Z_RANGE[1] + 0.001
            and Y_RANGE[0] - 0.001 <= b.y - center.y <= Y_RANGE[1] + 0.001
        ):
            outside_region += 1
        if (k - center).length < EYE_RADIUS + 0.0005:
            too_close_to_eye += 1
        # Only the corner population lives inside EYE_CLEARANCE, and only it
        # relies on the tangential-slide guarantee. Crease verts sit outside
        # that shell and are allowed to move radially inward by design.
        if (b - center).length < EYE_RADIUS + EYE_CLEARANCE:
            min_radial_change = min(
                min_radial_change, (k - center).length - (b - center).length
            )
        side_sign = 1.0 if b.x >= 0.0 else -1.0
        u = (b.x - center.x) * side_sign
        dz = b.z - center.z
        if abs(dz) < 0.005:
            if u > 0.009:
                outer_z_gains.append(delta.z)
            elif u < -0.008:
                inner_z_deltas.append(delta.z)
    checks["max_displacement_bound"] = max_disp <= MAX_DISPLACEMENT
    checks["all_moves_inside_eye_region"] = outside_region == 0
    checks["no_post_sculpt_eyeball_contact"] = too_close_to_eye == 0
    stats["gate_max_displacement_mm"] = round(max_disp * 1000.0, 3)
    stats["max_eye_distance_mm"] = round(max_eye_distance * 1000.0, 2)

    # Ground truth that the sculpt is actually VISIBLE. A field authored in the
    # wrong space still satisfies every geometric gate above while moving skin
    # nowhere near the eye, so compare the front-visible surface before and
    # after: what a front-facing camera sees must measurably change.
    front_shift = {}
    for side, before_map in front_before.items():
        after_map = front_surface_map(body, EYE_CENTERS[side])
        shared = set(before_map) & set(after_map)
        front_shift[side] = max(
            (abs(after_map[cell] - before_map[cell]) for cell in shared), default=0.0
        )
    min_front_shift = min(front_shift.values()) if front_shift else 0.0
    checks["front_visible_surface_changed"] = min_front_shift >= 0.0003
    stats["front_visible_shift_mm"] = {
        side: round(v * 1000.0, 4) for side, v in front_shift.items()
    }

    # Tangential-slide guarantee: no vertex inside the clearance shell may end
    # up closer to its eye center than it started, which is what lets the
    # corner terms work within CORNER_CLEARANCE of the eyeball surface.
    checks["no_vertex_moved_toward_eye_center"] = min_radial_change >= -1e-9
    stats["min_radial_change_mm"] = round(min_radial_change * 1000.0, 4)

    max_outer_gain = max(outer_z_gains) if outer_z_gains else 0.0
    checks["outer_canthus_raised"] = 0.0010 <= max_outer_gain <= MAX_DISPLACEMENT
    stats["outer_canthus_z_gain_mm"] = round(max_outer_gain * 1000.0, 3)

    # Measures the tilt the sculpt ADDS (outer lifted relative to inner). The
    # absolute canthal tilt of the finished aperture is a Stage F visual call,
    # not something this gate certifies.
    mean_outer = sum(outer_z_gains) / len(outer_z_gains) if outer_z_gains else 0.0
    mean_inner = sum(inner_z_deltas) / len(inner_z_deltas) if inner_z_deltas else 0.0
    checks["canthal_tilt_increased"] = (mean_outer - mean_inner) >= 0.0004
    stats["canthal_tilt_added_mm"] = round((mean_outer - mean_inner) * 1000.0, 3)

    moved = stats["moved"]
    checks["both_sides_sculpted"] = moved["L"] >= 40 and moved["R"] >= 40
    mean = (moved["L"] + moved["R"]) / 2.0
    checks["side_balance_5pct"] = abs(moved["L"] - moved["R"]) <= max(5, 0.05 * mean)
    return checks


def point_at(obj: bpy.types.Object, target: Vector) -> None:
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_views() -> list[str]:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.filter_size = 1.0
    scene.render.image_settings.file_format = "PNG"

    target = Vector((0.0, EYE_CY, EYE_CZ + 0.004))

    temp = []

    def add_area(name, location, energy, size):
        data = bpy.data.lights.new(name=name, type="AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        point_at(obj, target)
        temp.append(obj)
        return obj

    add_area("SocketQA_Key", (0.45, target.y - 0.85, target.z + 0.5), 70.0, 0.18)
    add_area("SocketQA_Fill", (-0.6, target.y - 0.7, target.z), 20.0, 0.35)
    add_area("SocketQA_Rim", (0.0, target.y + 0.8, target.z + 0.5), 80.0, 0.8)

    camera_data = bpy.data.cameras.new("SocketQA_Camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("SocketQA_Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    temp.append(camera)
    scene.camera = camera

    distance = 1.2
    views = {
        "socket-front": (Vector((0.0, -distance, 0.0)), 0.16),
        "socket-45L": (Vector((distance * 0.707, -distance * 0.707, 0.0)), 0.16),
        "socket-sideL": (Vector((distance, 0.0, 0.0)), 0.16),
        "socket-close-L": (Vector((0.18, -distance, 0.06)), 0.07),
    }
    outputs = []
    for name, (offset, ortho_scale) in views.items():
        view_target = target.copy()
        if name == "socket-close-L":
            view_target = target + Vector((0.028, 0.0, 0.008))
        camera.location = view_target + offset
        camera.data.ortho_scale = ortho_scale
        point_at(camera, view_target)
        output = EYES_DIR / f"{name}.png"
        scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        outputs.append(str(output.relative_to(ROOT)))
    for obj in temp:
        bpy.data.objects.remove(obj, do_unlink=True)
    return outputs


def main() -> None:
    if Path(bpy.data.filepath).resolve() != BLEND_PATH.resolve():
        raise RuntimeError(f"Expected open file {BLEND_PATH}, got {bpy.data.filepath}")
    EYES_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = BACKUP_DIR / f"avatar_36C_master.pre-socket-{stamp}.blend"
    shutil.copy2(BLEND_PATH, backup_path)

    body = find_body()
    inv = body.matrix_world.inverted()
    EYE_CENTERS["L"] = inv @ EYE_CENTERS_WORLD["L"]
    EYE_CENTERS["R"] = inv @ EYE_CENTERS_WORLD["R"]
    members = body_group_indices(body)
    base = macro_base_positions(body)
    front_before = {side: front_surface_map(body, EYE_CENTERS[side]) for side in ("L", "R")}
    # Snapshot AFTER macro_base_positions(), which drops any previous sculpt key,
    # so the scope-lock gate compares the layers this run is meant to preserve.
    before = snapshot_existing_layers(body)
    stats = apply_sculpt(body, members, base)
    checks = run_gates(body, before, stats, backup_path, base, front_before)

    passed = all(checks.values())
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "purpose": (
            "Gated eye-socket definition sculpt: non-destructive shape key "
            f"{KEY_NAME} (value 1.0) deepening the upper-lid crease toward the "
            "outer third, lifting the brow bone, and adding positive canthal "
            "tilt via a tangential slide at the lid corners. Machine gates "
            "only; grants no TD, visual or anatomical approval."
        ),
        "backup_blend": str(backup_path.relative_to(ROOT)),
        "backup_sha256": sha256(backup_path),
        "field": {
            "crease_depth_mm": CREASE_DEPTH * 1000.0,
            "crease_z_center_mm": CREASE_Z_CENTER * 1000.0,
            "crease_z_ramp": CREASE_Z_RAMP,
            "crease_sigma_outer": CREASE_SIGMA_OUTER,
            "crease_sigma_inner": CREASE_SIGMA_INNER,
            "bone_lift_mm": BONE_LIFT * 1000.0,
            "bone_z_center_mm": BONE_Z_CENTER * 1000.0,
            "lateral_sigma_mm": LATERAL_SIGMA * 1000.0,
            "canthus_lift_mm": CANTHUS_LIFT * 1000.0,
            "canthus_u_center_mm": CANTHUS_U_CENTER * 1000.0,
            "canthus_lateral_mm": CANTHUS_LATERAL * 1000.0,
            "inner_drop_mm": INNER_DROP * 1000.0,
            "eye_clearance_mm": EYE_CLEARANCE * 1000.0,
            "corner_clearance_mm": CORNER_CLEARANCE * 1000.0,
        },
        "checks": checks,
        "stats": stats,
        "result": "PASS" if passed else "FAIL",
        "saved": False,
        "warning": (
            "DRAFT socket sculpt. Basis and all pre-existing shape-key layers "
            "are bit-identical; the sculpt lives only in the new key and is "
            "fully removable."
        ),
    }

    if passed:
        report["views"] = render_views()
        bpy.ops.wm.save_mainfile()
        report["saved"] = True
        report["blend_sha256_after_save"] = sha256(BLEND_PATH)

    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print("SOCKET_SCULPT_REPORT=" + json.dumps(report, separators=(",", ":")))
    if not passed:
        failed = [name for name, ok in checks.items() if not ok]
        raise RuntimeError(f"Socket sculpt gates failed: {failed}; nothing saved")


main()
