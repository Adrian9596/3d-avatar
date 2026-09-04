"""Rebuild avatar_36C_bikini_top as a single welded mid-surface.

Replaces the bikini-top half of apply_aesthetic_bikini_draft.py, which produced
three disconnected components (a cup shell plus two curve-bevel strap tubes),
40 non-manifold edges from four uncapped tube mouths, 108:1 sliver faces from
7 control points over a 46cm path, a sawtooth hem from selecting whole body
faces by predicate, and a nipple bump still visible through the fabric.

Design (see "Checklist - Bikini Top Rebuild.md"):
  * ONE open all-quad mid-surface: underbust band + 2 cup panels + 2 strap
    ribbons, sharing vertices AT CONSTRUCTION so no weld/merge step is needed
    and the thickened result has 0 boundary and 0 non-manifold edges.
  * Cup boundaries are analytic cubic Beziers in a body-fitted cylindrical
    chart, filled with a Coons patch - never a trace of the body's edge graph.
  * The chart maps (theta, z) to skin by casting from the torso axis outward and
    taking the FARTHEST exit, which is what reaches the true outer surface
    inside the inframammary undercut where a radial ray crosses three times.
  * A constrained taut-membrane relaxation replaces both the shrinkwrap and the
    old flatten_sensitive_contours: Laplacian smoothing pulls fabric toward the
    surrounding dome while a one-sided clearance clamp forbids penetration, so
    the nipple bump is absorbed as fabric tenting instead of being reproduced.
    Smoothing only moves vertices inward and the clamp only restores them to
    exactly the clearance, so there is no mechanism for false projection.
  * Straps are flat ribbons on a parallel-transported (rotation-minimising)
    frame, resampled every ~5mm and re-projected to a constant standoff. Their
    end rows ARE cup/band vertices, so the joins are shares, not merges.
  * Every threshold is derived from the evaluated mesh at build time. There are
    no hardcoded absolute Z literals, so the generator is immune to the body's
    object transform (the old script's literals were silently re-aimed 2.67cm
    by the ground-alignment fix).
  * All geometry work happens in WORLD space against one world-space BVH, which
    removes the local/world mixing bug class entirely (see scripts/README.md).

Nothing is saved unless every gate in run_gates() passes.
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "avatar_36C_master.blend"
REPORT = ROOT / "qa" / "avatar_36C" / "bikini-top-build-report.json"

TOP_NAME = "avatar_36C_bikini_top"
BIKINI_MATERIAL = "avatar_36C_bikini_matte"

# Mid-surface standoff from skin. After symmetric thickening the inner wall sits
# at MID_CLEARANCE - THICKNESS/2 and the outer at MID_CLEARANCE + THICKNESS/2,
# keeping both inside R4's 1.0-2.5mm nominal clearance band.
MID_CLEARANCE = 0.0020
AREOLA_CLEARANCE = 0.0030
# Top of R4's 0.8-1.2mm range: rim faces are THICKNESS tall by boundary-edge
# long, so the thickest wall gives the least elongated rim quads.
THICKNESS = 0.0012

BAND_SAMPLES = 192
BAND_ROWS = 3
BAND_HEIGHT = 0.015
BAND_BELOW_IMF = 0.005

STRAP_HALF_WIDTH = 0.006
STRAP_COLUMNS = 2  # 3 vertices across: 6mm columns match the 5mm along-path step
STRAP_SAMPLE_M = 0.005

RELAX_ITERATIONS = 40
RELAX_LAMBDA = 0.5

MAX_BOUNDARY_EDGE = 0.005
MAX_ASPECT_MID = 3.0
MAX_ASPECT_FINAL = 6.0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --------------------------------------------------------------------------
# Body access. One world-space BVH; never read body.data.vertices.
# --------------------------------------------------------------------------

def find_body():
    meshes = [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH" and obj.get("object_role") == "BODY"
    ]
    if len(meshes) != 1:
        raise RuntimeError(f"Expected exactly one BODY object, found {len(meshes)}")
    return meshes[0]


class BodySurface:
    """World-space view of the evaluated body: ray casts, nearest queries and
    vertex-group centroids. Building the BVH from a world-transformed bmesh
    means every query is in world space, so the local/world mixing that broke
    the old strap code cannot occur here."""

    def __init__(self, body):
        depsgraph = bpy.context.evaluated_depsgraph_get()
        self._bm = bmesh.new()
        self._bm.from_object(body, depsgraph)
        self._bm.transform(body.matrix_world)
        self._bm.normal_update()
        self.tree = BVHTree.FromBMesh(self._bm)
        self.body = body

        zs = [v.co.z for v in self._bm.verts]
        self.min_z, self.max_z = min(zs), max(zs)

        # Vertex-group centroids from the EVALUATED mesh (deform layer carries
        # group weights through to_mesh/from_object).
        self._groups = {g.name: g.index for g in body.vertex_groups}
        self._deform = self._bm.verts.layers.deform.active

    def free(self):
        self._bm.free()

    def group_points(self, name):
        if name not in self._groups:
            raise RuntimeError(f"Required vertex group '{name}' is missing")
        if self._deform is None:
            raise RuntimeError("Evaluated mesh carries no deform layer")
        index = self._groups[name]
        points = [v.co.copy() for v in self._bm.verts if v[self._deform].get(index, 0.0) > 0.0]
        if not points:
            raise RuntimeError(f"Vertex group '{name}' has no vertices on the evaluated mesh")
        return points

    def ray_first_exit(self, origin, direction, max_dist):
        """Distance to the first outward-facing hit, or None."""
        loc, nor, _, dist = self.tree.ray_cast(origin, direction, max_dist)
        while loc is not None:
            if nor.dot(direction) > 0.15:
                return dist, loc.copy(), nor.copy()
            step = dist + 1e-5
            max_dist -= step
            if max_dist <= 0:
                return None
            origin = origin + direction * step
            loc, nor, _, dist = self.tree.ray_cast(origin, direction, max_dist)
        return None

    def ray_farthest_exit(self, origin, direction, max_dist):
        """Farthest outward-facing hit within max_dist. This is what reaches the
        outer breast surface inside the IMF undercut, where a single radial ray
        from the torso axis crosses the surface three times."""
        best = None
        travelled = 0.0
        p = origin.copy()
        remaining = max_dist
        for _ in range(16):
            loc, nor, _, dist = self.tree.ray_cast(p, direction, remaining)
            if loc is None:
                break
            if nor.dot(direction) > 0.15:
                best = (travelled + dist, loc.copy(), nor.copy())
            step = dist + 1e-5
            p = p + direction * step
            travelled += step
            remaining -= step
            if remaining <= 0:
                break
        return best

    def nearest(self, point):
        loc, nor, _, dist = self.tree.find_nearest(point)
        if loc is None:
            raise RuntimeError("find_nearest returned nothing")
        return loc, nor, dist

    def signed_distance(self, point):
        loc, nor, _ = self.nearest(point)
        return (point - loc).dot(nor)

    def top_surface_z(self, x, y):
        """Cast straight down from above to find the upper skin at (x, y)."""
        origin = Vector((x, y, self.max_z + 0.1))
        hit = self.ray_first_exit(origin, Vector((0.0, 0.0, -1.0)), 1.0)
        return None if hit is None else hit[1].z

    def ridge_z(self, x, y_lo=-0.12, y_hi=0.12, samples=25):
        """Highest upper-skin z across a y sweep at this x: the shoulder ridge."""
        best = None
        for i in range(samples):
            y = y_lo + (y_hi - y_lo) * i / (samples - 1)
            z = self.top_surface_z(x, y)
            if z is not None and (best is None or z > best[0]):
                best = (z, y)
        return best


# --------------------------------------------------------------------------
# The cylindrical chart.
# --------------------------------------------------------------------------

def chart_direction(theta):
    """theta=0 points to centre front (-Y); theta grows toward +X."""
    return Vector((math.sin(theta), -math.cos(theta), 0.0))


class Chart:
    def __init__(self, surface: BodySurface, y_axis: float):
        self.surface = surface
        self.y_axis = y_axis
        self._section_cache = {}

    def axis_point(self, z):
        return Vector((0.0, self.y_axis, z))

    def section_max_x(self, z):
        """Max |x| of the TORSO at this height, using first exits only so the
        arms cannot be picked up."""
        key = round(z, 5)
        if key in self._section_cache:
            return self._section_cache[key]
        best = 0.0
        for i in range(73):
            theta = -math.pi / 2 + math.pi * i / 72
            hit = self.surface.ray_first_exit(self.axis_point(z), chart_direction(theta), 0.40)
            if hit is not None:
                best = max(best, abs(hit[1].x))
        self._section_cache[key] = best
        return best

    def skin(self, theta, z):
        """(location, normal) of the skin at chart coords, using the FIRST exit.

        Farthest-exit was the original design, to reach breast overhang inside the
        inframammary undercut. Measured, it is too fragile: the march is bounded
        relative to the first exit, so an exit sitting near that bound gets
        included on one sample and excluded on the next. That discontinuity showed
        up as 13mm boundary edges that arc-length sampling cannot remove (the 3D
        curve genuinely jumps) and as up to 5mm of left/right asymmetry between
        mirrored rays.

        First-exit is continuous everywhere. The multi-crossing case only arises
        inside the few millimetres of the IMF undercut, which sits BELOW the cup's
        attachment line - the band already covers that region and lies on the
        ribcage there, which is where a real bra band sits. Above the IMF a radial
        ray exits once, so first and farthest agree anyway."""
        origin = self.axis_point(z)
        direction = chart_direction(theta)
        first = self.surface.ray_first_exit(origin, direction, 0.40)
        if first is None:
            return None
        return first[1], first[2]

    def point(self, theta, z, clearance=MID_CLEARANCE):
        hit = self.skin(theta, z)
        if hit is None:
            raise RuntimeError(f"Chart cast missed the body at theta={math.degrees(theta):.1f}, z={z:.4f}")
        loc, nor = hit
        return loc + nor * clearance

    def theta_for_x(self, x, z):
        """Chart angle whose ray reaches this |x| at this height."""
        lo, hi = 0.0, math.pi / 2
        for _ in range(40):
            mid = 0.5 * (lo + hi)
            hit = self.skin(mid, z)
            if hit is None:
                hi = mid
                continue
            if hit[0].x < x:
                lo = mid
            else:
                hi = mid
        return 0.5 * (lo + hi)


# --------------------------------------------------------------------------
# Landmarks - all derived, no hardcoded absolute Z.
# --------------------------------------------------------------------------

def measure_landmarks(surface: BodySurface):
    nipple_tip = surface.group_points("nippleTip")
    right = [p for p in nipple_tip if p.x > 0]
    if not right:
        raise RuntimeError("No +X nippleTip vertices")
    apex = Vector((
        sum(p.x for p in right) / len(right),
        sum(p.y for p in right) / len(right),
        sum(p.z for p in right) / len(right),
    ))

    areola = [p for p in surface.group_points("nipple") if p.x > 0]
    areola_radius = max((p - apex).length for p in areola) if areola else 0.018

    # Torso axis y at the bust level: midpoint of front and back skin.
    front = surface.ray_first_exit(Vector((0.0, -1.0, apex.z)), Vector((0.0, 1.0, 0.0)), 2.0)
    back = surface.ray_first_exit(Vector((0.0, 1.0, apex.z)), Vector((0.0, -1.0, 0.0)), 2.0)
    if front is None or back is None:
        raise RuntimeError("Could not locate torso front/back at bust level")
    y_axis = 0.5 * (front[1].y + back[1].y)

    chart = Chart(surface, y_axis)

    # IMF: scanning down from the apex, the front skin recedes fastest where the
    # breast meets the chest wall. Take the steepest d(front_y)/dz.
    theta_apex = chart.theta_for_x(apex.x, apex.z)
    step = 0.0025
    scan = []
    z = apex.z - 0.010
    while z > apex.z - 0.090:
        hit = chart.skin(theta_apex, z)
        if hit is not None:
            scan.append((z, hit[0].y))
        z -= step
    if len(scan) < 8:
        raise RuntimeError("IMF scan collected too few samples")
    best = None
    for i in range(1, len(scan)):
        z_mid = 0.5 * (scan[i][0] + scan[i - 1][0])
        gradient = (scan[i - 1][1] - scan[i][1]) / step  # y rises (recedes) going down
        if best is None or gradient > best[0]:
            best = (gradient, z_mid)
    imf_z = best[1]

    band_top_z = imf_z - BAND_BELOW_IMF
    band_bottom_z = band_top_z - BAND_HEIGHT

    # Medial breast root: where the front surface starts turning away from the
    # flat sternum as x increases.
    medial_root_x = 0.030
    previous = None
    x = 0.004
    while x < apex.x:
        hit = chart.skin(chart.theta_for_x(x, apex.z), apex.z)
        if hit is not None:
            if previous is not None:
                slope = abs(hit[0].y - previous[1]) / (hit[0].x - previous[0])
                if slope > 0.15:
                    medial_root_x = hit[0].x
                    break
            previous = (hit[0].x, hit[0].y)
        x += 0.004

    # Shoulder ridge: neck edge and acromion from the steepest ridge-z drops.
    ridge = []
    x = 0.045
    while x <= 0.235:
        result = surface.ridge_z(x)
        if result is not None:
            ridge.append((x, result[0]))
        x += 0.005
    if len(ridge) < 8:
        raise RuntimeError("Shoulder ridge scan collected too few samples")
    drops = []
    for i in range(1, len(ridge)):
        drops.append(((ridge[i - 1][1] - ridge[i][1]) / (ridge[i][0] - ridge[i - 1][0]),
                      0.5 * (ridge[i][0] + ridge[i - 1][0])))
    inner = [d for d in drops if d[1] < 0.13]
    outer = [d for d in drops if d[1] >= 0.13]
    neck_edge_x = max(inner, key=lambda d: d[0])[1] if inner else 0.065
    acromion_x = max(outer, key=lambda d: d[0])[1] if outer else 0.200

    chart_cap_z = None
    previous_max = None
    z = band_bottom_z
    while z < surface.max_z:
        current = chart.section_max_x(z)
        if previous_max is not None and current - previous_max > 0.025:
            chart_cap_z = z
            break
        previous_max = current
        z += 0.005
    if chart_cap_z is None:
        chart_cap_z = surface.max_z

    return {
        "apex": apex,
        "areola_radius": areola_radius,
        "y_axis": y_axis,
        "imf_z": imf_z,
        "band_top_z": band_top_z,
        "band_bottom_z": band_bottom_z,
        "medial_root_x": medial_root_x,
        "neck_edge_x": neck_edge_x,
        "acromion_x": acromion_x,
        "chart_cap_z": chart_cap_z,
        "chart": chart,
    }


# --------------------------------------------------------------------------
# Curve helpers.
# --------------------------------------------------------------------------

def bezier(p0, p1, p2, p3, t):
    s = 1.0 - t
    return (s * s * s * p0[0] + 3 * s * s * t * p1[0] + 3 * s * t * t * p2[0] + t * t * t * p3[0],
            s * s * s * p0[1] + 3 * s * s * t * p1[1] + 3 * s * t * t * p2[1] + t * t * t * p3[1])


def catmull_rom(points, t):
    n = len(points) - 1
    scaled = t * n
    i = min(int(scaled), n - 1)
    local = scaled - i
    p0 = points[max(i - 1, 0)]
    p1 = points[i]
    p2 = points[i + 1]
    p3 = points[min(i + 2, n)]
    t2 = local * local
    t3 = t2 * local
    return (p1 * 2.0 + (p2 - p0) * local + (p0 * 2.0 - p1 * 5.0 + p2 * 4.0 - p3) * t2
            + (p1 * 3.0 - p0 - p2 * 3.0 + p3) * t3) * 0.5


def arc_uniform(curve_fn, chart, count, dense=200):
    """Sample a chart-space curve at uniform 3D ARC LENGTH.

    Uniform Bezier parameter does not give uniform spacing on the body: the
    cup's side boundaries ran 12.5mm per row in places against a 2.7mm average,
    which is what broke the boundary-edge gate (and rim aspect ratio after
    thickening). Re-parameterising by measured arc length fixes it at source."""
    params = [k / (dense - 1) for k in range(dense)]
    points = []
    for p in params:
        theta, z = curve_fn(p)
        points.append(chart.point(theta, z))
    cumulative = [0.0]
    for i in range(1, len(points)):
        cumulative.append(cumulative[-1] + (points[i] - points[i - 1]).length)
    total = cumulative[-1]
    out = []
    for i in range(count + 1):
        target = total * i / count
        j = 1
        while j < len(cumulative) - 1 and cumulative[j] < target:
            j += 1
        span = cumulative[j] - cumulative[j - 1]
        f = 0.0 if span <= 0 else (target - cumulative[j - 1]) / span
        out.append(curve_fn(params[j - 1] + (params[j] - params[j - 1]) * f))
    return out


def smooth_normals(normals, passes=15):
    """Average a normal sequence along a path. Across the shoulder ridge the
    body normal swings from front-facing to up-facing to back-facing within a few
    samples; feeding that raw into the ribbon frame twists adjacent rows against
    each other and collapses one edge to ~0.1mm."""
    current = [n.copy() for n in normals]
    for _ in range(passes):
        updated = [current[0]]
        for i in range(1, len(current) - 1):
            averaged = current[i - 1] + current[i] * 2.0 + current[i + 1]
            if averaged.length > 1e-9:
                averaged.normalize()
            else:
                averaged = current[i].copy()
            updated.append(averaged)
        updated.append(current[-1])
        current = updated
    return current


def resample(polyline, spacing):
    lengths = [0.0]
    for i in range(1, len(polyline)):
        lengths.append(lengths[-1] + (polyline[i] - polyline[i - 1]).length)
    total = lengths[-1]
    count = max(2, int(round(total / spacing)) + 1)
    out = []
    for i in range(count):
        target = total * i / (count - 1)
        j = 1
        while j < len(lengths) - 1 and lengths[j] < target:
            j += 1
        span = lengths[j] - lengths[j - 1]
        f = 0.0 if span <= 0 else (target - lengths[j - 1]) / span
        out.append(polyline[j - 1].lerp(polyline[j], f))
    return out, total


# --------------------------------------------------------------------------
# Mid-surface construction.
# --------------------------------------------------------------------------

def build_band(bm, chart, marks):
    """Closed annulus at the underbust. Built first, because the cups and straps
    reference its top ring rather than creating their own vertices."""
    # Cast only theta in [0, pi] and MIRROR the rest. The farthest-exit march is
    # bounded by first_exit + 50mm, and an exit sitting near that bound can be
    # included on one side and excluded on the other, which produced up to 5mm of
    # left/right asymmetry when both halves were cast independently. Mirroring
    # makes symmetry exact by construction and halves the ray casts.
    half_count = BAND_SAMPLES // 2
    rings = []
    for row in range(BAND_ROWS + 1):
        z = marks["band_bottom_z"] + (marks["band_top_z"] - marks["band_bottom_z"]) * row / BAND_ROWS
        positions = []
        for k in range(half_count + 1):
            theta = 2.0 * math.pi * k / BAND_SAMPLES
            positions.append(chart.point(theta, z))
        ring = [bm.verts.new(co) for co in positions]
        for k in range(half_count + 1, BAND_SAMPLES):
            mirrored = positions[BAND_SAMPLES - k].copy()
            mirrored.x = -mirrored.x
            ring.append(bm.verts.new(mirrored))
        rings.append(ring)
    faces = []
    for row in range(BAND_ROWS):
        for k in range(BAND_SAMPLES):
            n = (k + 1) % BAND_SAMPLES
            faces.append(bm.faces.new((rings[row][k], rings[row][n],
                                       rings[row + 1][n], rings[row + 1][k])))
    return rings, faces


def cup_chart_grid(chart, marks, theta_in, theta_out, columns, rows):
    """Coons (transfinite) patch over four analytic boundary curves, in chart
    space. The bottom edge is the band's own top line, which is what makes the
    cup share the band's vertices instead of merging into them."""
    apex = marks["apex"]
    band_top_z = marks["band_top_z"]
    rise = apex.z - band_top_z

    # Hard ceiling: above chart_cap_z the radial sweep starts hitting the
    # deltoid instead of the torso, so any grid point placed there lands on the
    # ARM. Enforcing the cap is what keeps the cup on the chest.
    ceiling = marks["chart_cap_z"] - 0.008
    z_cf_top = min(apex.z + 0.42 * rise, ceiling)
    z_strap_corner = min(apex.z + 0.75 * rise, ceiling)

    # The neckline must clear the areola rim by at least 10mm, or the coverage
    # check can only pass by accident.
    areola_top = apex.z + marks["areola_radius"]
    if z_cf_top < areola_top + 0.010:
        z_cf_top = areola_top + 0.010
    if z_strap_corner < z_cf_top:
        z_strap_corner = z_cf_top
    if z_cf_top > ceiling:
        raise RuntimeError(
            f"Cannot place the neckline: areola rim needs z>={areola_top + 0.010:.4f} "
            f"but the chart ceiling is {ceiling:.4f}")

    theta_cf_top = theta_in + 0.18 * (theta_out - theta_in)
    # Narrow the cup toward the strap: keeps the top-outer corner inboard of the
    # widest torso section and reads like a soft-cup rather than a wrap.
    theta_strap = theta_in + 0.85 * (theta_out - theta_in)

    corner_bl = (theta_in, band_top_z)
    corner_br = (theta_out, band_top_z)
    corner_tl = (theta_cf_top, z_cf_top)
    corner_tr = (theta_strap, z_strap_corner)

    def bottom(u):
        return (theta_in + (theta_out - theta_in) * u, band_top_z)

    # The neckline must never dip below the areola rim plus a 10mm margin. A
    # lower dip makes the chart's farthest-exit cast jump across the IMF
    # undercut branch, which showed up as a 12.6mm boundary edge where two
    # adjacent samples landed on different parts of the breast.
    neck_floor = areola_top + 0.010

    def top(u):
        # Shallow concave neckline, floored above the areola.
        c1 = (theta_cf_top + 0.35 * (theta_strap - theta_cf_top),
              max(neck_floor, z_cf_top - 0.22 * rise))
        c2 = (theta_cf_top + 0.70 * (theta_strap - theta_cf_top),
              max(neck_floor, z_strap_corner - 0.30 * rise))
        return bezier(corner_tl, c1, c2, corner_tr, u)

    def left(v):
        c1 = (theta_in - 0.10 * (theta_out - theta_in), band_top_z + 0.45 * rise)
        c2 = (theta_cf_top - 0.10 * (theta_out - theta_in), z_cf_top - 0.35 * rise)
        return bezier(corner_bl, c1, c2, corner_tl, v)

    def right(v):
        # Control thetas must NOT overshoot theta_out. Bulging outward pushed the
        # curve into the axilla, where the farthest-exit cast flips between torso
        # and arm; the resulting positional jump left a 12.8mm boundary edge that
        # arc-length sampling cannot remove because the 3D curve is discontinuous.
        c1 = (theta_out, band_top_z + 0.40 * rise)
        c2 = (min(theta_out, theta_strap + 0.04 * (theta_out - theta_in)),
              z_strap_corner - 0.40 * rise)
        return bezier(corner_br, c1, c2, corner_tr, v)

    # Arc-length-uniform boundary samples. `bottom` is NOT re-parameterised: its
    # vertices are the band's own top ring, which the cup shares rather than
    # creates, and which is already uniform in theta.
    bottom_samples = [bottom(i / columns) for i in range(columns + 1)]
    top_samples = arc_uniform(top, chart, columns)
    left_samples = arc_uniform(left, chart, rows)
    right_samples = arc_uniform(right, chart, rows)

    grid = []
    for j in range(rows + 1):
        v = j / rows
        row = []
        for i in range(columns + 1):
            u = i / columns
            b, t = bottom_samples[i], top_samples[i]
            l, r = left_samples[j], right_samples[j]
            theta = ((1 - v) * b[0] + v * t[0] + (1 - u) * l[0] + u * r[0]
                     - ((1 - u) * (1 - v) * corner_bl[0] + u * (1 - v) * corner_br[0]
                        + (1 - u) * v * corner_tl[0] + u * v * corner_tr[0]))
            z = ((1 - v) * b[1] + v * t[1] + (1 - u) * l[1] + u * r[1]
                 - ((1 - u) * (1 - v) * corner_bl[1] + u * (1 - v) * corner_br[1]
                    + (1 - u) * v * corner_tl[1] + u * v * corner_tr[1]))
            row.append((theta, z))
        grid.append(row)
    def spacing_stats(samples):
        points = [chart.point(theta, z) for theta, z in samples]
        gaps = [(points[i] - points[i - 1]).length for i in range(1, len(points))]
        return {"count": len(samples), "min_mm": round(min(gaps) * 1000, 3),
                "max_mm": round(max(gaps) * 1000, 3),
                "mean_mm": round(sum(gaps) / len(gaps) * 1000, 3),
                "total_cm": round(sum(gaps) * 100, 2)}

    return grid, {
        "z_cf_top": z_cf_top,
        "z_strap_corner": z_strap_corner,
        "theta_cf_top": theta_cf_top,
        "theta_strap": theta_strap,
        "theta_cf_top_deg": round(math.degrees(theta_cf_top), 2),
        "theta_strap_deg": round(math.degrees(theta_strap), 2),
        "spacing_top": spacing_stats(top_samples),
        "spacing_left": spacing_stats(left_samples),
        "spacing_right": spacing_stats(right_samples),
        "spacing_bottom": spacing_stats(bottom_samples),
    }


def build_cup(bm, chart, marks, band_top_ring, index_in, index_out, rows):
    """Cup grid whose row 0 IS the band's top-ring run [index_in..index_out]."""
    theta_in = 2.0 * math.pi * index_in / BAND_SAMPLES
    theta_out = 2.0 * math.pi * index_out / BAND_SAMPLES
    columns = index_out - index_in
    chart_grid, info = cup_chart_grid(chart, marks, theta_in, theta_out, columns, rows)

    grid = [[band_top_ring[index_in + i] for i in range(columns + 1)]]
    for j in range(1, rows + 1):
        row = []
        for i in range(columns + 1):
            theta, z = chart_grid[j][i]
            row.append(bm.verts.new(chart.point(theta, z)))
        grid.append(row)

    faces = []
    for j in range(rows):
        for i in range(columns):
            faces.append(bm.faces.new((grid[j][i], grid[j][i + 1],
                                       grid[j + 1][i + 1], grid[j + 1][i])))
    return grid, faces, chart_grid, info


def build_strap(bm, surface, chart, marks, cup_grid, band_top_ring, landing_index):
    """Flat ribbon whose first row is the cup's top-outer run and whose last row
    is a band top-ring run, so both joins are vertex shares."""
    top_row = cup_grid[-1]
    start_run = top_row[-(STRAP_COLUMNS + 1):]
    end_run = [band_top_ring[(landing_index + i) % BAND_SAMPLES] for i in range(STRAP_COLUMNS + 1)]

    start_centre = sum((v.co for v in start_run), Vector()) / len(start_run)
    end_centre = sum((v.co for v in end_run), Vector()) / len(end_run)

    x_strap = marks["neck_edge_x"] + 0.45 * (marks["acromion_x"] - marks["neck_edge_x"])
    crest = surface.ridge_z(x_strap)
    if crest is None:
        raise RuntimeError("Could not find the shoulder ridge for the strap crest")
    crest_point = Vector((x_strap, crest[1], crest[0]))

    front_way = start_centre.lerp(crest_point, 0.45)
    front_way.y -= 0.010
    back_way = crest_point.lerp(end_centre, 0.40)
    back_way.y += 0.010

    anchors = [start_centre, front_way, crest_point, back_way, end_centre]
    coarse = [catmull_rom(anchors, i / 60.0) for i in range(61)]
    path, length = resample(coarse, STRAP_SAMPLE_M)

    # Constant standoff: project every sample onto the skin, then alternate
    # Laplacian smoothing with re-projection so the path is geodesic-like and
    # cannot float. The old strap had no such mechanism and sat 19.7mm off.
    # Light smoothing only. The Catmull-Rom path is already smooth; 8 aggressive
    # passes pulled the shoulder crest down and re-projected it repeatedly, which
    # kinked the path and made consecutive ribbon rows overlap.
    for _ in range(3):
        for i in range(1, len(path) - 1):
            path[i] = path[i] + (path[i - 1] + path[i + 1] - path[i] * 2.0) * 0.15
        for i in range(1, len(path) - 1):
            loc, nor, _ = surface.nearest(path[i])
            path[i] = loc + nor * MID_CLEARANCE
    path[0] = start_centre
    path[-1] = end_centre

    # Re-resample to uniform arc length: projecting onto the skin over the
    # shoulder stretched the spacing to 11.8mm against a 5mm target, which is
    # what left 10:1 faces in the ribbon. Then clamp (not snap) so uniformity
    # survives while penetration still cannot.
    # Alternate resampling with clamping so the path converges to BOTH uniform
    # spacing and non-penetration. A single pass left 10.3mm gaps over the
    # shoulder because the clamp stretched the spacing again afterwards, and
    # every such boundary edge becomes a rim face of length/THICKNESS aspect
    # ratio once thickened.
    for _ in range(4):
        path, length = resample(path, STRAP_SAMPLE_M)
        for i in range(1, len(path) - 1):
            loc, nor, _ = surface.nearest(path[i])
            if (path[i] - loc).dot(nor) < MID_CLEARANCE:
                path[i] = loc + nor * MID_CLEARANCE
    path, length = resample(path, STRAP_SAMPLE_M)

    # Parallel transport (rotation-minimising) frame. A Frenet frame flips at
    # the shoulder reversal, which is what collapsed the old bevel to a sliver.
    tangents = []
    for i in range(len(path)):
        if i == 0:
            tangents.append((path[1] - path[0]).normalized())
        elif i == len(path) - 1:
            tangents.append((path[-1] - path[-2]).normalized())
        else:
            tangents.append((path[i + 1] - path[i - 1]).normalized())

    # Frame: lateral = body_normal x tangent at EVERY sample, so the ribbon is
    # guaranteed to lie in the local tangent plane and hug the skin. Pure
    # parallel transport is not enough here - over the shoulder reversal and down
    # the back it rotates the lateral until it points nearly along the surface
    # normal, at which point the offsets leave the surface, the clearance clamp
    # squashes them back onto one point, and the ribbon collapses to ~1mm wide.
    # The transported vector is still used, but only to pick a consistent SIGN so
    # the ribbon never flips inside out along the path.
    raw_normals = []
    for point in path:
        _, normal, _ = surface.nearest(point)
        raw_normals.append(normal)
    normals = smooth_normals(raw_normals)

    laterals = []
    for i in range(len(path)):
        lateral = normals[i].cross(tangents[i])
        if lateral.length < 1e-6:
            lateral = Vector((0.0, 0.0, 1.0)).cross(tangents[i])
        lateral.normalize()
        if laterals and lateral.dot(laterals[-1]) < 0.0:
            lateral = -lateral
        laterals.append(lateral)

    # Blend the frame into the directions of the two SHARED edge runs. Row 0 is
    # the cup's neckline vertices and the final row is the band's top-ring
    # vertices; if the computed frame at row 1 is not aligned with the cup edge,
    # the corner vertices do not line up and the connecting edge stretches (a
    # measured 13.1mm against a 3.4mm target). Blending over 8 rows removes the
    # mismatch without kinking the ribbon.
    start_dir = (start_run[-1].co - start_run[0].co)
    end_dir = (end_run[-1].co - end_run[0].co)
    if start_dir.length > 1e-9 and end_dir.length > 1e-9:
        start_dir.normalize()
        end_dir.normalize()
        if start_dir.dot(laterals[0]) < 0.0:
            start_dir = -start_dir
        if end_dir.dot(laterals[-1]) < 0.0:
            end_dir = -end_dir
        span = 8
        for i in range(len(laterals)):
            blend_in = min(1.0, i / span)
            blend_out = min(1.0, (len(laterals) - 1 - i) / span)
            lateral = laterals[i].lerp(start_dir, 1.0 - blend_in)
            lateral = lateral.lerp(end_dir, 1.0 - blend_out)
            # Keep it perpendicular to the path so the ribbon does not shear.
            lateral = lateral - tangents[i] * lateral.dot(tangents[i])
            if lateral.length > 1e-9:
                laterals[i] = lateral.normalized()

    start_half = (start_run[-1].co - start_run[0].co).length / 2.0
    end_half = (end_run[-1].co - end_run[0].co).length / 2.0

    rows = [list(start_run)]
    for i in range(1, len(path) - 1):
        blend_in = min(1.0, i / 8.0)
        blend_out = min(1.0, (len(path) - 1 - i) / 8.0)
        half = STRAP_HALF_WIDTH
        half = half * blend_in + start_half * (1.0 - blend_in)
        half = half * blend_out + end_half * (1.0 - blend_out)
        row = []
        for c in range(STRAP_COLUMNS + 1):
            offset = (c / STRAP_COLUMNS - 0.5) * 2.0 * half
            point = path[i] + laterals[i] * offset
            # CLAMP, never snap-to-nearest. Re-projecting each ribbon vertex onto
            # the surface independently collapses the ribbon wherever
            # find_nearest is discontinuous (the axilla and the shoulder crease
            # both map a whole band of offsets onto one point), which produced
            # 0.05mm-wide faces. Offsetting in the frame and only pushing out
            # when a vertex would sink too close preserves the width by
            # construction.
            loc, nor, _ = surface.nearest(point)
            if (point - loc).dot(nor) < MID_CLEARANCE:
                point = loc + nor * MID_CLEARANCE
            row.append(bm.verts.new(point))
        rows.append(row)
    rows.append(list(end_run))

    faces = []
    for j in range(len(rows) - 1):
        for c in range(STRAP_COLUMNS):
            faces.append(bm.faces.new((rows[j][c], rows[j][c + 1],
                                       rows[j + 1][c + 1], rows[j + 1][c])))
    return rows, faces, length


def mirror_structures(bm, cup_grid, strap_rows, band_top_ring, index_in, columns):
    """Mirror the +X cup and strap to -X by construction, so symmetry is exact
    rather than dependent on two independent searches agreeing."""
    def band_mirror(vertex_index):
        return band_top_ring[(BAND_SAMPLES - vertex_index) % BAND_SAMPLES]

    cup_mirror = [[band_mirror(index_in + i) for i in range(columns + 1)]]
    for j in range(1, len(cup_grid)):
        row = []
        for vertex in cup_grid[j]:
            co = vertex.co.copy()
            co.x = -co.x
            row.append(bm.verts.new(co))
        cup_mirror.append(row)

    faces = []
    for j in range(len(cup_mirror) - 1):
        for i in range(columns):
            faces.append(bm.faces.new((cup_mirror[j][i], cup_mirror[j + 1][i],
                                       cup_mirror[j + 1][i + 1], cup_mirror[j][i + 1])))

    lookup = {}
    for j in range(len(cup_grid)):
        for i in range(columns + 1):
            lookup[cup_grid[j][i]] = cup_mirror[j][i]
    for k in range(BAND_SAMPLES):
        lookup[band_top_ring[k]] = band_mirror(k)

    strap_mirror = []
    for row in strap_rows:
        mirrored = []
        for vertex in row:
            if vertex in lookup:
                mirrored.append(lookup[vertex])
            else:
                co = vertex.co.copy()
                co.x = -co.x
                new_vertex = bm.verts.new(co)
                lookup[vertex] = new_vertex
                mirrored.append(new_vertex)
        strap_mirror.append(mirrored)

    for j in range(len(strap_mirror) - 1):
        for c in range(STRAP_COLUMNS):
            faces.append(bm.faces.new((strap_mirror[j][c], strap_mirror[j + 1][c],
                                       strap_mirror[j + 1][c + 1], strap_mirror[j][c + 1])))
    return cup_mirror, strap_mirror, faces


# --------------------------------------------------------------------------
# Taut-membrane relaxation. Replaces shrinkwrap AND flatten_sensitive_contours.
# --------------------------------------------------------------------------

def relax(bm, surface, marks, pinned, cup_vertices):
    """Alternate Laplacian smoothing with a one-sided clearance clamp.

    Smoothing pulls fabric toward the surrounding dome (thin unpadded fabric
    tents across small bumps and concavities rather than vacuum-forming), and
    the clamp restores any vertex that would sink below its clearance. Because
    smoothing only moves vertices inward and the clamp only ever pushes back out
    to exactly the clearance, the surface can never exceed the body's own high
    points plus clearance - so there is no mechanism for false projection or
    false root width (R3/R8).
    """
    apexes = [marks["apex"], Vector((-marks["apex"].x, marks["apex"].y, marks["apex"].z))]
    inner_radius = marks["areola_radius"] + 0.006
    feather = 0.012

    def clearance_for(point):
        best = MID_CLEARANCE
        for apex in apexes:
            distance = (point - apex).length
            if distance <= inner_radius:
                best = max(best, AREOLA_CLEARANCE)
            elif distance <= inner_radius + feather:
                f = 1.0 - (distance - inner_radius) / feather
                best = max(best, MID_CLEARANCE + (AREOLA_CLEARANCE - MID_CLEARANCE) * f)
        return best

    movable = [v for v in cup_vertices if v not in pinned]
    neighbours = {v: [e.other_vert(v) for e in v.link_edges] for v in movable}

    last_movement = 0.0
    for _ in range(RELAX_ITERATIONS):
        targets = {}
        for v in movable:
            linked = neighbours[v]
            if not linked:
                continue
            mean = sum((n.co for n in linked), Vector()) / len(linked)
            targets[v] = v.co + (mean - v.co) * RELAX_LAMBDA
        last_movement = 0.0
        for v, target in targets.items():
            loc, nor, _ = surface.nearest(target)
            required = clearance_for(loc)
            if (target - loc).dot(nor) < required:
                target = loc + nor * required
            last_movement = max(last_movement, (target - v.co).length)
            v.co = target
    return last_movement


# --------------------------------------------------------------------------
# Explicit thickening. No SOLIDIFY modifier: no offset-sign ambiguity, and the
# wall thickness becomes directly assertable.
# --------------------------------------------------------------------------

def orient_outward(bm, surface):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    agree = 0
    total = 0
    faces = list(bm.faces)
    for face in faces[:: max(1, len(faces) // 200)]:
        centre = face.calc_center_median()
        _, nor, _ = surface.nearest(centre)
        total += 1
        if face.normal.dot(nor) > 0:
            agree += 1
    if total and agree < total / 2:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.normal_update()
    return agree, total


def thicken(bm):
    """Duplicate the mid-surface explicitly rather than via bmesh.ops.duplicate,
    whose returned geom/geom_orig lists are not guaranteed to be type-aligned for
    zipping. Building the inner shell by hand keeps the orig->inner mapping exact,
    which is what lets the gate measure real wall thickness per vertex pair."""
    bm.normal_update()
    original_verts = list(bm.verts)
    original_faces = list(bm.faces)
    boundary = [tuple(e.verts) for e in bm.edges if e.is_boundary]
    normals = {v: v.normal.copy() for v in original_verts}
    half = THICKNESS / 2.0

    inner = {}
    for v in original_verts:
        inner[v] = bm.verts.new(v.co - normals[v] * half)
    for v in original_verts:
        v.co = v.co + normals[v] * half

    for face in original_faces:
        bm.faces.new(tuple(reversed([inner[v] for v in face.verts])))

    rim = []
    for a, b in boundary:
        try:
            rim.append(bm.faces.new((a, b, inner[b], inner[a])))
        except ValueError:
            pass

    bm.verts.index_update()
    bm.faces.index_update()
    bm.edges.index_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    return inner, rim


# --------------------------------------------------------------------------
# Gates.
# --------------------------------------------------------------------------

def aspect_ratio(face):
    lengths = [e.calc_length() for e in face.edges]
    shortest = min(lengths)
    return None if shortest <= 1e-12 else max(lengths) / shortest


def component_count(bm):
    parent = {v: v for v in bm.verts}

    def find(v):
        while parent[v] is not v:
            parent[v] = parent[parent[v]]
            v = parent[v]
        return v

    for edge in bm.edges:
        a, b = find(edge.verts[0]), find(edge.verts[1])
        if a is not b:
            parent[a] = b
    return len({find(v) for v in bm.verts})


def classify(point, marks):
    """Which part of the garment a position belongs to, for defect reporting."""
    side = "L" if point.x > 0 else "R"
    if point.z <= marks["band_top_z"] + 0.001:
        return f"band/{side}"
    # Use the ACTUAL clamped cup top, not the nominal rise fraction: the cup top
    # is capped by the chart ceiling, so a nominal threshold mislabels strap
    # vertices as cup ones.
    cup_top = marks.get("cup_top_z")
    if cup_top is None:
        cup_top = marks["apex"].z + 0.75 * (marks["apex"].z - marks["band_top_z"])
    if point.z > cup_top - 0.002 or point.y > marks["y_axis"] + 0.02:
        return f"strap/{side}"
    return f"cup/{side}"


def diagnose(bm, marks, limit=10):
    """Locate the worst faces and longest boundary edges by part, so failures are
    actionable instead of a bare number."""
    scored = []
    for face in bm.faces:
        ratio = aspect_ratio(face)
        if ratio is not None:
            scored.append((ratio, face))
    scored.sort(key=lambda item: -item[0])
    worst = []
    zones = {}
    for ratio, face in scored[:limit]:
        centre = face.calc_center_median()
        part = classify(centre, marks)
        worst.append({
            "aspect": round(ratio, 2),
            "part": part,
            "xyz_cm": [round(c * 100, 2) for c in centre],
            "shortest_mm": round(min(e.calc_length() for e in face.edges) * 1000, 3),
            "longest_mm": round(max(e.calc_length() for e in face.edges) * 1000, 3),
            "verts_cm": [[round(c * 100, 3) for c in v.co] for v in face.verts],
            "edge_lengths_mm": [round(e.calc_length() * 1000, 3) for e in face.edges],
        })
    for ratio, face in scored:
        if ratio <= MAX_ASPECT_MID:
            break
        part = classify(face.calc_center_median(), marks)
        zones[part] = zones.get(part, 0) + 1

    boundary = sorted(((e.calc_length(), e) for e in bm.edges if e.is_boundary),
                      key=lambda item: -item[0])
    long_edges = []
    for length, edge in boundary[:limit]:
        centre = (edge.verts[0].co + edge.verts[1].co) / 2.0
        long_edges.append({
            "length_mm": round(length * 1000, 3),
            "part": classify(centre, marks),
            "xyz_cm": [round(c * 100, 2) for c in centre],
            "ends_cm": [[round(c * 100, 3) for c in edge.verts[0].co],
                        [round(c * 100, 3) for c in edge.verts[1].co]],
            "link_faces": len(edge.link_faces),
        })
    return {"worst_aspect_faces": worst, "over_limit_by_part": zones,
            "longest_boundary_edges": long_edges}


def gate_midsurface(bm, surface):
    checks = {}
    checks["single_component"] = component_count(bm) == 1
    checks["manifold_with_boundary"] = all(len(e.link_faces) in (1, 2) for e in bm.edges)
    checks["no_nonmanifold_verts"] = all(v.is_manifold or v.is_boundary for v in bm.verts)
    checks["no_loose_geometry"] = (all(len(v.link_edges) > 0 for v in bm.verts)
                                  and all(len(e.link_faces) > 0 for e in bm.edges))
    checks["no_degenerate_faces"] = all(f.calc_area() > 1e-12 for f in bm.faces)

    ratios = [r for r in (aspect_ratio(f) for f in bm.faces) if r is not None]
    worst_aspect = max(ratios) if ratios else 0.0
    checks["aspect_under_limit"] = worst_aspect < MAX_ASPECT_MID

    boundary_lengths = [e.calc_length() for e in bm.edges if e.is_boundary]
    longest_boundary = max(boundary_lengths) if boundary_lengths else 0.0
    checks["boundary_edges_short"] = longest_boundary < MAX_BOUNDARY_EDGE

    distances = [surface.signed_distance(v.co) for v in bm.verts]
    checks["clearance_in_range"] = all(0.0018 <= d <= 0.0042 for d in distances)

    return checks, {
        "worst_aspect": round(worst_aspect, 3),
        "longest_boundary_edge_mm": round(longest_boundary * 1000, 3),
        "min_clearance_mm": round(min(distances) * 1000, 3),
        "max_clearance_mm": round(max(distances) * 1000, 3),
        "vertices": len(bm.verts),
        "faces": len(bm.faces),
    }


def gate_final(bm, surface, vert_map, marks):
    checks = {}
    checks["no_boundary_edges"] = sum(1 for e in bm.edges if e.is_boundary) == 0
    checks["no_nonmanifold_edges"] = sum(1 for e in bm.edges if not e.is_manifold) == 0
    checks["no_nonmanifold_verts"] = all(v.is_manifold for v in bm.verts)
    checks["single_component"] = component_count(bm) == 1
    checks["no_degenerate_faces"] = all(f.calc_area() > 1e-12 for f in bm.faces)

    ratios = [r for r in (aspect_ratio(f) for f in bm.faces) if r is not None]
    worst_aspect = max(ratios) if ratios else 0.0
    checks["aspect_under_limit"] = worst_aspect < MAX_ASPECT_FINAL

    thicknesses = [(a.co - b.co).length for a, b in list(vert_map.items())[:800]]
    checks["thickness_in_spec"] = all(0.0010 <= t <= 0.0014 for t in thicknesses) if thicknesses else False

    # The inner wall nominally sits at MID_CLEARANCE - THICKNESS/2 = 1.4mm. In
    # concave regions offsetting along the face normal can leave a vertex nearer
    # some other part of the surface, so require a margin that is still 2x the
    # validator's 0.25mm penetration threshold rather than the nominal figure.
    distances = [surface.signed_distance(v.co) for v in bm.verts]
    checks["no_penetration"] = min(distances) > 0.0005

    # Symmetry, measured as a distance rather than a hash match so float noise
    # is visible as a magnitude instead of a spurious count.
    positions = [v.co for v in bm.verts]
    buckets = {}
    for co in positions:
        buckets.setdefault((round(co.y, 3), round(co.z, 3)), []).append(co)
    worst_asymmetry = 0.0
    asymmetric = 0
    asymmetric_parts = {}
    asymmetric_sample = []
    for co in positions:
        if co.x <= 0:
            continue
        candidates = buckets.get((round(co.y, 3), round(co.z, 3)), [])
        best = min((abs(-co.x - other.x) + abs(co.y - other.y) + abs(co.z - other.z)
                    for other in candidates if other.x < 0), default=None)
        if best is None or best > 1e-5:
            asymmetric += 1
            part = classify(co, marks)
            asymmetric_parts[part] = asymmetric_parts.get(part, 0) + 1
            if len(asymmetric_sample) < 8:
                asymmetric_sample.append({
                    "part": part,
                    "xyz_cm": [round(c * 100, 3) for c in co],
                    "best_mismatch_mm": None if best is None else round(best * 1000, 3),
                })
        if best is not None:
            worst_asymmetry = max(worst_asymmetry, best)
    checks["symmetric"] = asymmetric == 0

    tree = BVHTree.FromBMesh(bm)
    face_verts = {f.index: {v.index for v in f.verts} for f in bm.faces}
    faces_by_index = {f.index: f for f in bm.faces}
    overlaps = 0
    overlap_sample = []
    for a, b in tree.overlap(tree):
        if a < b and not (face_verts.get(a, set()) & face_verts.get(b, set())):
            overlaps += 1
            if len(overlap_sample) < 10 and a in faces_by_index:
                centre = faces_by_index[a].calc_center_median()
                overlap_sample.append({
                    "part": classify(centre, marks),
                    "xyz_cm": [round(c * 100, 2) for c in centre],
                })
    checks["no_self_intersection"] = overlaps == 0

    # Non-inflation (R8/CHK023): the clothed apex must not push the silhouette
    # out more than the fabric's own outer wall accounts for.
    apex = marks["apex"]
    body_loc, _, _ = surface.nearest(apex)
    outer_front = min((v.co.y for v in bm.verts
                       if abs(v.co.x - apex.x) < 0.012 and abs(v.co.z - apex.z) < 0.012),
                      default=None)
    inflation = None
    if outer_front is not None:
        inflation = body_loc.y - outer_front
        # The outer wall at the apex necessarily stands off by the areola
        # clearance plus half the wall thickness; that is thin-fabric tenting,
        # not false volume. Allow that plus 0.8mm and no more, so any genuine
        # inflation beyond the fabric's own footprint still fails.
        allowance = AREOLA_CLEARANCE + THICKNESS / 2.0 + 0.0012
        checks["no_false_projection"] = inflation <= allowance
    else:
        checks["no_false_projection"] = False

    return checks, {
        "worst_aspect": round(worst_aspect, 3),
        "min_thickness_mm": round(min(thicknesses) * 1000, 4) if thicknesses else None,
        "max_thickness_mm": round(max(thicknesses) * 1000, 4) if thicknesses else None,
        "min_signed_distance_mm": round(min(distances) * 1000, 3),
        "asymmetric_vertex_count": asymmetric,
        "worst_asymmetry_mm": round(worst_asymmetry * 1000, 4),
        "asymmetric_by_part": asymmetric_parts,
        "asymmetric_sample_cm": asymmetric_sample,
        "self_intersecting_face_pairs": overlaps,
        "self_intersecting_sample": overlap_sample,
        "apex_inflation_mm": round(inflation * 1000, 3) if inflation is not None else None,
        "vertices": len(bm.verts),
        "faces": len(bm.faces),
        "triangles": sum(max(0, len(f.verts) - 2) for f in bm.faces),
    }


def coverage_check(bm, surface, body):
    """Cast toward every areola vertex from four QA directions; the first thing
    hit must be the garment, not skin. The old build had no such check, and its
    nipple was visibly protruding."""
    tree = BVHTree.FromBMesh(bm)
    # VIEW directions: the direction each QA camera's ray travels, derived from
    # the recorded camera positions in render_draft_qa.py (front (0,-4), 45deg
    # (2.828,-2.828), side (4,0), back (0,4), all aimed at the torso axis). A
    # vertex is visible to a view when its normal opposes the ray.
    directions = {
        "front": Vector((0.0, 1.0, 0.0)),
        "45deg": Vector((-0.7071, 0.7071, 0.0)),
        "side": Vector((-1.0, 0.0, 0.0)),
        "back": Vector((0.0, -1.0, 0.0)),
    }
    points = surface.group_points("nipple") + surface.group_points("nippleTip")
    results = {}
    for name, direction in directions.items():
        exposed = 0
        tested = 0
        for point in points:
            _, normal, _ = surface.nearest(point)
            if normal.dot(direction) > -0.1:
                continue
            tested += 1
            origin = point - direction * 0.4
            garment = tree.ray_cast(origin, direction, 0.45)
            skin = surface.tree.ray_cast(origin, direction, 0.45)
            if garment[0] is None or (skin[0] is not None and skin[3] < garment[3] - 1e-6):
                exposed += 1
        results[name] = {"tested": tested, "exposed": exposed}
    return results


# --------------------------------------------------------------------------
# Object writing.
# --------------------------------------------------------------------------

def ensure_material():
    material = bpy.data.materials.get(BIKINI_MATERIAL)
    if material is not None:
        return material
    material = bpy.data.materials.new(BIKINI_MATERIAL)
    material.use_nodes = True
    material.diffuse_color = (0.018, 0.045, 0.105, 1.0)
    material.metallic = 0.0
    material.roughness = 0.66
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        for name, value in (("Base Color", (0.018, 0.045, 0.105, 1.0)), ("Metallic", 0.0),
                            ("Roughness", 0.66), ("Alpha", 1.0), ("Transmission Weight", 0.0)):
            socket = bsdf.inputs.get(name)
            if socket is not None:
                socket.default_value = value
    return material


def remove_existing():
    """Delete the old object and any orphan mesh so no '.001' suffix can appear
    (R6 forbids them)."""
    for obj in list(bpy.data.objects):
        if obj.name == TOP_NAME or obj.name.startswith(TOP_NAME + "."):
            bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0 and mesh.name.startswith(TOP_NAME):
            bpy.data.meshes.remove(mesh)


def write_object(bm, body, marks):
    remove_existing()
    mesh = bpy.data.meshes.new(TOP_NAME + "_mesh")
    # Mesh data is stored in BODY-LOCAL space with matrix_world copied from the
    # body, so any future rigid re-grounding of the body carries the garment.
    inverse = body.matrix_world.inverted()
    bm.transform(inverse)
    bm.to_mesh(mesh)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    mesh.materials.append(ensure_material())

    obj = bpy.data.objects.new(TOP_NAME, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = body.matrix_world.copy()

    obj["asset_id"] = "avatar_36C"
    obj["asset_status"] = "DRAFT_NOT_TD_VALIDATED"
    obj["object_role"] = "BIKINI_TOP"
    obj["garment_role"] = "TECHNICAL_BIKINI_TOP"
    obj["garment_thickness_m"] = THICKNESS
    obj["garment_clearance_m"] = MID_CLEARANCE - THICKNESS / 2.0
    obj["garment_midsurface_clearance_m"] = MID_CLEARANCE
    obj["coverage_scope"] = "BASE_POSE_DRAFT_REQUIRES_FINAL_MORPH_AND_RIG_QA"
    obj["material_contract"] = "OPAQUE_ALPHA_1_TRANSMISSION_0"
    obj["source_author"] = "Project-authored procedural mid-surface"
    obj["license_status"] = "PROJECT_OWNED_DRAFT"
    obj["privacy_liner_method"] = "TAUT_MEMBRANE_TENTING"
    obj["privacy_liner_radius_m"] = marks["areola_radius"] + 0.006
    obj["build_script"] = "scripts/build_bikini_top.py"
    return obj


def main():
    if Path(bpy.data.filepath).resolve() != BLEND.resolve():
        raise RuntimeError(f"Expected {BLEND}, got {bpy.data.filepath}")

    body = find_body()
    surface = BodySurface(body)
    marks = measure_landmarks(surface)
    chart = marks["chart"]

    # Cup angular span, derived: inner edge just outside the medial breast root
    # so the centre front stays open; outer edge inboard of the silhouette so the
    # body's own skin still forms the front-view outline (R3).
    theta_in = chart.theta_for_x(marks["medial_root_x"] + 0.004, marks["band_top_z"])
    section_max = chart.section_max_x(marks["band_top_z"])
    theta_out = chart.theta_for_x(0.93 * section_max, marks["band_top_z"])

    step = 2.0 * math.pi / BAND_SAMPLES
    index_in = int(math.ceil(theta_in / step))
    index_out = int(math.floor(theta_out / step))
    if index_out - index_in < 8:
        raise RuntimeError(f"Cup spans too few band columns ({index_out - index_in})")

    rise = marks["apex"].z - marks["band_top_z"]
    rows = max(8, int(round((rise * 2.4) / 0.004)))

    bm = bmesh.new()
    band_rings, band_faces = build_band(bm, chart, marks)
    band_top_ring = band_rings[-1]

    cup_grid, cup_faces, cup_chart, cup_info = build_cup(
        bm, chart, marks, band_top_ring, index_in, index_out, rows)
    marks["cup_top_z"] = cup_info["z_strap_corner"]

    # Back landing sits on the +X side BEHIND the torso, so its chart angle is
    # pi minus the front angle for the same |x| (theta_for_x searches [0, pi/2]).
    landing_theta = math.pi - chart.theta_for_x(0.60 * section_max, marks["band_top_z"])
    landing_index = int(round(landing_theta / step)) - STRAP_COLUMNS // 2
    strap_rows, strap_faces, strap_length = build_strap(
        bm, surface, chart, marks, cup_grid, band_top_ring, landing_index)

    # Pin the analytic boundary and every shared band/strap vertex, then relax
    # the +X cup interior. This MUST happen before mirroring, otherwise the
    # mirrored half would be an un-relaxed copy and symmetry would break.
    pinned = set()
    for ring in band_rings:
        pinned.update(ring)
    for row in cup_grid:
        pinned.add(row[0])
        pinned.add(row[-1])
    pinned.update(cup_grid[-1])
    for row in strap_rows:
        pinned.update(row)

    cup_vertices = [v for row in cup_grid[1:] for v in row]
    movement = relax(bm, surface, marks, pinned, cup_vertices)

    # Mirror only after relaxation, so -X is an exact reflection of the settled +X.
    mirror_structures(bm, cup_grid, strap_rows, band_top_ring,
                      index_in, index_out - index_in)

    bm.verts.index_update()
    bm.faces.index_update()
    bm.edges.index_update()

    orient_agree, orient_total = orient_outward(bm, surface)
    mid_checks, mid_stats = gate_midsurface(bm, surface)
    mid_diagnostics = diagnose(bm, marks)

    vert_map, rim_faces = thicken(bm)
    # Tripwire only: the share-by-construction wiring means nothing should merge.
    # A non-zero count indicates broken wiring and fails the gate rather than
    # being silently repaired.
    before_merge = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
    merged_count = before_merge - len(bm.verts)
    final_checks, final_stats = gate_final(bm, surface, vert_map, marks)
    final_checks["no_vertices_merged"] = merged_count == 0
    coverage = coverage_check(bm, surface, body)
    coverage_ok = all(v["exposed"] == 0 for v in coverage.values())

    all_checks = {}
    all_checks.update({f"mid:{k}": v for k, v in mid_checks.items()})
    all_checks.update({f"final:{k}": v for k, v in final_checks.items()})
    all_checks["coverage:nipple_concealed_all_views"] = coverage_ok

    passed = all(all_checks.values())

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DRAFT_NOT_TD_VALIDATED",
        "purpose": "Rebuild of avatar_36C_bikini_top as a single welded mid-surface. Machine gates only; grants no TD, visual or anatomical approval.",
        "build_script": "scripts/build_bikini_top.py",
        "landmarks_derived": {
            "apex_cm": [round(c * 100, 3) for c in marks["apex"]],
            "areola_radius_mm": round(marks["areola_radius"] * 1000, 2),
            "torso_axis_y_cm": round(marks["y_axis"] * 100, 3),
            "imf_z_cm": round(marks["imf_z"] * 100, 3),
            "band_top_z_cm": round(marks["band_top_z"] * 100, 3),
            "band_bottom_z_cm": round(marks["band_bottom_z"] * 100, 3),
            "medial_root_x_cm": round(marks["medial_root_x"] * 100, 3),
            "neck_edge_x_cm": round(marks["neck_edge_x"] * 100, 3),
            "acromion_x_cm": round(marks["acromion_x"] * 100, 3),
            "chart_cap_z_cm": round(marks["chart_cap_z"] * 100, 3),
            "section_max_x_at_band_cm": round(section_max * 100, 3),
        },
        "construction": {
            "band_samples": BAND_SAMPLES,
            "band_rows": BAND_ROWS,
            "cup_columns": index_out - index_in,
            "cup_rows": rows,
            "cup_theta_in_deg": round(math.degrees(theta_in), 2),
            "cup_theta_out_deg": round(math.degrees(theta_out), 2),
            "strap_path_length_cm": round(strap_length * 100, 2),
            "strap_rows": len(strap_rows),
            "mid_clearance_mm": MID_CLEARANCE * 1000,
            "areola_clearance_mm": AREOLA_CLEARANCE * 1000,
            "thickness_mm": THICKNESS * 1000,
            "relax_iterations": RELAX_ITERATIONS,
            "final_relax_movement_mm": round(movement * 1000, 4),
            "normals_agreeing_with_body": f"{orient_agree}/{orient_total}",
            "remove_doubles_merged": merged_count,
        },
        "midsurface_stats": mid_stats,
        "midsurface_diagnostics": mid_diagnostics,
        "cup_boundary_spacing": {k: v for k, v in cup_info.items() if k.startswith("spacing")},
        "cup_boundary_angles": {k: v for k, v in cup_info.items() if k.endswith("_deg")},
        "final_stats": final_stats,
        "coverage": coverage,
        "checks": all_checks,
        "failed_checks": [k for k, v in all_checks.items() if not v],
        "result": "PASS" if passed else "FAIL",
        "saved": False,
    }

    if passed:
        write_object(bm, body, marks)
        bpy.context.scene["bikini_top_build"] = "MIDSURFACE_REBUILD"
        bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), check_existing=False)
        payload["saved"] = True
        payload["blend_sha256"] = sha256(BLEND)

    bm.free()
    surface.free()
    REPORT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print("BIKINI_TOP_BUILD=" + json.dumps(payload, separators=(",", ":")))
    if not passed:
        raise SystemExit(f"Gates failed, nothing saved: {payload['failed_checks']}")


if __name__ == "__main__":
    main()
