"""Build the refined size-L torso into this project's canonical avatar.

Writes assets/source/avatar_master.blend, assets/export/avatar_master.glb and
qa/avatar_master/prototype-export-report.json from the CLO3D-ready refined torso
(`Avatar_CLO3D_ready.blend`, object `Avatar_Torso_sim`, 50k triangles), which is
the CLO3D "AVT L" body re-meshed and smoothed outside this repository. The
source file is checked against SOURCE_SHA256 and never written to.

What the build does, in order, and why:

1. Moves the torso back into the AVT L frame the previous asset used (the
   refinement chain shifted it down by 1.043 m and recentred it), so every
   height the registry, the levels and the body grid declare keeps meaning the
   same place on the body. Before the shift it lies within 0.2 mm (median) of
   the previous torso surface.
2. Symmetrizes it about x = 0 (the -X half mirrored onto +X). The CLO3D source
   was a mirrored half; the refinement's voxel re-mesh left up to 11.6 mm of
   asymmetry in the underarm hollow, which moved the two armhole minima 61 mm
   apart front to back. Vertices already within 0.3 mm of the plane are put on it first so the
   cut makes no slivers.
3. Re-meshes it evenly (QuadriFlow, symmetric, ~6 mm quads, every vertex put
   back onto the refined surface and relaxed along it, flat caps rebuilt from
   the rims). The source is a collapse decimation: 22% of its torso triangles
   are narrower than the 2 mm the pen and the pattern flattening sample a loop
   at (src/core/flatten/flatten_patch.mjs DEFAULT_LOOP_SPACING), so a drawn loop can
   step over a face and its flood fill leaks out of the piece. After the
   re-mesh 1.1% are, fewer than on the previous CLO3D mesh (2.6%). QuadriFlow's
   short edges and the triangle it folds at each crease singularity are
   collapsed.
4. Splits the surface into the three materials the registry expects: the torso
   `Mara:body3` (the measurement surface), the arm stubs `Mara:arm2` and the
   flat neck and base caps `Skin_Cut`. The armhole is the previous asset's own
   CLO3D body3/arm2 seam (assets/source/clo3d-armhole-seam.json), which lies
   within 2.4 mm of the refined surface: the cut is the zero set of
   f(v) = n.(v - c) - r(theta), (c, n) the seam's best-fit plane and r(theta)
   the seam's own out-of-plane offset around the loop, so it passes through
   every seam point instead of flattening the seam onto its plane (the plane
   alone would put the armpit 19 mm lower).
   The arm stubs, which nothing measures, are then refined where the re-mesh
   cuts inside their convex shape (the rim at each stub's end).
5. Gives all three materials the same flat skin tone -- the median of the
   previous baked Mara_body3_BaseColor map, in linear -- and no textures. This
   body has no baked skin; nothing here claims one.

Usage (from the repo root):
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
    --python-exit-code 1 --python scripts/build_refined_l_avatar.py -- \
    "/path/to/clo3d_avatar/Avatar_CLO3D_ready.blend"
"""
from __future__ import annotations

import hashlib
import json
import struct
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import delaunay_2d_cdt

ROOT = Path(__file__).resolve().parents[1]
SEAM_PATH = ROOT / "assets" / "source" / "clo3d-armhole-seam.json"
BLEND_OUT = ROOT / "assets" / "source" / "avatar_master.blend"
GLB_OUT = ROOT / "assets" / "export" / "avatar_master.glb"
REPORT_OUT = ROOT / "qa" / "avatar_master" / "prototype-export-report.json"

SOURCE_SHA256 = "42f49f7610528763a34280a4bd6cdfe02ef3feae2589b9a54e30143db8345d27"
SOURCE_OBJECT = "Avatar_Torso_sim"
# Blender frame (Z up). The refinement shifted the torso down by 1.018 + 0.009
# + 0.016 m; the CLO3D-ready build then recentred it by this recorded offset.
OFFSET = Vector((1.704692840576172e-05, -0.001275770366191864, 1.043))
MIRROR_SNAP_M = 0.0003
QUADRIFLOW_FACES = 16000     # ~6 mm quads over the whole surface
RIM_MIN_EDGE_M = 0.0015      # shorter rim edges are collapsed before the caps are rebuilt
CAP_SPACING_M = 0.006        # interior points of a rebuilt cap
RELAX_ITERATIONS = 8         # tangential relaxation after the projection
MIN_EDGE_M = 0.0025          # QuadriFlow's singularities leave 0.9 mm edges; shorter than this are collapsed
RELAX_FACTOR = 0.5
CUT_SNAP_M = 0.0003          # a vertex this close to the armhole cut is taken as on it
ARM_DEVIATION_M = 0.0002     # a stub edge whose midpoint strays further from the refined surface is split
ARM_REFINE_PASSES = 4
OBJECT_NAME = "AVT_L_refined"
MATERIALS = ("Mara:body3", "Mara:arm2", "Skin_Cut")
# Median of Mara_body3_BaseColor.png (sRGB 0.8745, 0.7529, 0.6863) in linear,
# and the median of Mara_body3_Roughness.png: the skin the site showed until now.
SKIN_LINEAR = (0.7379, 0.5271, 0.4287)
ROUGHNESS = {"Mara:body3": 0.455, "Mara:arm2": 0.455, "Skin_Cut": 0.62}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def fail(message: str) -> None:
    print(f"BLOCKED: {message}", file=sys.stderr)
    sys.exit(1)


# ------------------------------------------------------------------ source mesh
def load_source(path: Path) -> bmesh.types.BMesh:
    if not path.exists():
        fail(f"missing source {path}")
    actual = sha256(path)
    if actual != SOURCE_SHA256:
        fail(f"source is {actual[:12]}..., expected {SOURCE_SHA256[:12]}... -- not the refined torso this build was checked against")
    with bpy.data.libraries.load(str(path), link=False) as (src, dst):
        if SOURCE_OBJECT not in src.objects:
            fail(f"{SOURCE_OBJECT} is not in {path.name}")
        dst.objects = [SOURCE_OBJECT]
    ob = dst.objects[0]
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.transform(Matrix.Translation(OFFSET) @ ob.matrix_world)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    mesh = ob.data
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(mesh)
    return bm


def symmetrize(bm: bmesh.types.BMesh) -> dict:
    snapped = 0
    for v in bm.verts:
        if 0.0 < abs(v.co.x) < MIRROR_SNAP_M:
            v.co.x = 0.0
            snapped += 1
    bmesh.ops.symmetrize(bm, input=list(bm.verts) + list(bm.edges) + list(bm.faces), direction="-X", dist=1e-6)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    nonmanifold = sum(1 for e in bm.edges if not e.is_manifold)
    if boundary or nonmanifold:
        fail(f"symmetrize left {boundary} boundary and {nonmanifold} nonmanifold edges")
    return {"kept_half": "-X", "snapped_to_plane": snapped, "snap_m": MIRROR_SNAP_M}


def ordered_boundary_loops(bm: bmesh.types.BMesh) -> list[list[bmesh.types.BMVert]]:
    adjacency = defaultdict(list)
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts
            adjacency[a].append(b)
            adjacency[b].append(a)
    seen, loops = set(), []
    for start in adjacency:
        if start in seen:
            continue
        loop, previous, current = [start], None, start
        seen.add(start)
        while True:
            step = next(n for n in adjacency[current] if n is not previous)
            if step is start:
                break
            loop.append(step)
            seen.add(step)
            previous, current = current, step
        loops.append(loop)
    return loops


def collapse_short_rim_edges(bm: bmesh.types.BMesh) -> int:
    """QuadriFlow leaves a few rim vertices 0.2-0.6 mm apart; each makes a sliver
    on the body side of the rim and another in the cap. Merge them, keeping a
    vertex that sits on the mirror plane where it is."""
    merged = 0
    while True:
        short = [e for e in bm.edges if e.is_boundary and e.calc_length() < RIM_MIN_EDGE_M]
        if not short:
            return merged
        e = min(short, key=lambda edge: edge.calc_length())
        a, b = e.verts
        target = a.co.copy() if a.co.x == 0.0 else b.co.copy() if b.co.x == 0.0 else (a.co + b.co) / 2
        bmesh.ops.pointmerge(bm, verts=[a, b], merge_co=target)
        merged += 1


def fill_caps(bm: bmesh.types.BMesh) -> int:
    """Close each rim with a flat cap: a constrained Delaunay triangulation of the
    rim plus interior points on a grid symmetric about x = 0 (so the final
    symmetrize cuts through points rather than beside them), kept half a spacing
    clear of the rim."""
    made = 0
    for loop in ordered_boundary_loops(bm):
        z = loop[0].co.z
        if any(abs(v.co.z - z) > 1e-9 for v in loop):
            fail("a rim is not flat before capping")
        poly = np.array([[v.co.x, v.co.y] for v in loop])
        lo, hi = poly.min(0), poly.max(0)
        k = int(np.ceil(max(abs(lo[0]), abs(hi[0])) / CAP_SPACING_M))
        gx, gy = np.meshgrid(np.arange(-k, k + 1) * CAP_SPACING_M,
                             np.arange(lo[1], hi[1], CAP_SPACING_M) + CAP_SPACING_M / 2)
        pts = np.c_[gx.ravel(), gy.ravel()]
        inside = np.zeros(len(pts), dtype=bool)
        x0, y0 = poly[:, 0], poly[:, 1]
        x1, y1 = np.roll(x0, -1), np.roll(y0, -1)
        for i in range(len(poly)):                      # even-odd rule
            crosses = (y0[i] > pts[:, 1]) != (y1[i] > pts[:, 1])
            dy = y1[i] - y0[i]
            x_at = x0[i] + (pts[:, 1] - y0[i]) * (x1[i] - x0[i]) / (dy if dy else 1e-30)
            inside ^= crosses & (pts[:, 0] < x_at)
        pts = pts[inside]
        clear = np.full(len(pts), np.inf)
        for a, b in zip(poly, np.roll(poly, -1, 0)):
            ab = b - a
            t = np.clip(((pts - a) @ ab) / max(ab @ ab, 1e-30), 0.0, 1.0)
            clear = np.minimum(clear, np.linalg.norm(pts - (a + t[:, None] * ab), axis=1))
        pts = pts[clear > CAP_SPACING_M / 2]
        n = len(loop)
        coords = [Vector((p[0], p[1])) for p in poly] + [Vector((p[0], p[1])) for p in pts]
        out_co, _, out_faces, out_orig, _, _ = delaunay_2d_cdt(
            coords, [(i, (i + 1) % n) for i in range(n)], [list(range(n))], 1, 1e-9, True)
        if len(out_co) != len(coords):
            fail("the cap triangulation added or dropped points")
        verts = [loop[orig[0]] if orig and orig[0] < n else bm.verts.new((co.x, co.y, z))
                 for co, orig in zip(out_co, out_orig)]
        for face in out_faces:
            bm.faces.new([verts[i] for i in face])
            made += 1
    return made


def relax(bm: bmesh.types.BMesh, to_body: BVHTree, seam: list) -> None:
    """Tangential relaxation: every vertex off the rims moves part of the way to the
    centroid of its neighbours inside its own tangent plane, then back onto the
    refined body. Projection bunches QuadriFlow's vertices where the surface
    folds (the inframammary crease got 0.7 mm edges), and a piece flattened
    across such a cluster converges slowly enough that its mirror image stops at
    a different answer. This evens the sampling without moving the surface.
    Vertices on the mirror plane slide along it."""
    on_plane = set(seam)

    def keeps_orientation(v, target) -> bool:
        # every face round v must keep facing the way it faced (a crease can
        # otherwise pull a vertex across its neighbours and turn a face over)
        for f in v.link_faces:
            pts = [w.co for w in f.verts]
            before = (pts[1] - pts[0]).cross(pts[-1] - pts[0])
            pts = [target if w is v else w.co for w in f.verts]
            after = (pts[1] - pts[0]).cross(pts[-1] - pts[0])
            if after.length < 1e-14 or after.normalized().dot(before.normalized()) < 0.2:
                return False
        return True

    for _ in range(RELAX_ITERATIONS):
        bm.normal_update()
        moves = []
        for v in bm.verts:
            if v.is_boundary:
                continue
            neighbours = [e.other_vert(v) for e in v.link_edges]
            step = sum((n.co for n in neighbours), Vector()) / len(neighbours) - v.co
            step -= v.normal * step.dot(v.normal)
            if v in on_plane:
                step.x = 0.0
            moves.append((v, v.co + step * RELAX_FACTOR))
        for v, target in moves:
            target = to_body.find_nearest(target)[0]
            if v in on_plane:
                target.x = 0.0
            if keeps_orientation(v, target):
                v.co = target


def collapse_short_edges(bm: bmesh.types.BMesh, to_body: BVHTree) -> int:
    """Collapse interior edges shorter than MIN_EDGE_M. QuadriFlow put a
    singularity in each inframammary crease with 0.9 mm edges beside 12 mm ones,
    and a template flattened across it (the cradle front) settled on a different
    answer from its own mirror image. An edge is collapsed only if the result
    stays a manifold (the two ends share exactly the two opposite vertices) and
    no surrounding triangle turns over; the merged vertex goes back on the
    refined body, or stays on the mirror plane if an end was on it."""
    collapsed = 0
    while True:
        candidates = sorted((e for e in bm.edges if not e.is_boundary and e.calc_length() < MIN_EDGE_M
                             and not any(v.is_boundary for v in e.verts)), key=lambda e: e.calc_length())
        done = False
        for e in candidates:
            a, b = e.verts
            shared = {v for v in (x.other_vert(a) for x in a.link_edges)} & {v for v in (x.other_vert(b) for x in b.link_edges)}
            if len(shared) != 2:
                continue
            if a.co.x == 0.0 and b.co.x == 0.0:
                target = to_body.find_nearest((a.co + b.co) / 2)[0]
                target.x = 0.0
            elif a.co.x == 0.0 or b.co.x == 0.0:
                target = (a if a.co.x == 0.0 else b).co.copy()
            else:
                target = to_body.find_nearest((a.co + b.co) / 2)[0]
            ok = True
            for v in (a, b):
                for f in v.link_faces:
                    if a in f.verts and b in f.verts:
                        continue
                    before = f.normal.copy()
                    pts = [target if w in (a, b) else w.co for w in f.verts]
                    after = (pts[1] - pts[0]).cross(pts[2] - pts[0])
                    if after.length < 1e-12 or after.normalized().dot(before) < 0.5:
                        ok = False
                        break
                if not ok:
                    break
            if not ok:
                continue
            bmesh.ops.pointmerge(bm, verts=[a, b], merge_co=target)
            bm.normal_update()
            collapsed += 1
            done = True
            break
        if not done:
            return collapsed


def unfold(bm: bmesh.types.BMesh, to_body: BVHTree) -> int:
    """Collapse away every triangle that faces against the refined surface (off the rims).

    QuadriFlow's singularity in each inframammary crease came out as a quad
    folded over on itself (174 degrees from the surface); nothing after it could
    turn it back, and it rendered as a bright speck under the breast. The
    shortest edge of such a triangle is collapsed, on the surface, while the ends
    share exactly the two opposite vertices; the rims are left alone."""
    removed = 0
    for _ in range(50):
        bm.normal_update()
        flipped = [f for f in bm.faces if not any(v.is_boundary for v in f.verts)
                   and f.normal.dot(to_body.find_nearest(f.calc_center_median())[1]) < -0.5]
        if not flipped:
            return removed
        progress = False
        for f in flipped:
            if not f.is_valid:
                continue
            for e in sorted(f.edges, key=lambda edge: edge.calc_length()):
                a, b = e.verts
                if e.is_boundary or a.is_boundary or b.is_boundary:
                    continue
                shared = {x.other_vert(a) for x in a.link_edges} & {x.other_vert(b) for x in b.link_edges}
                if len(shared) != 2:
                    continue
                if a.co.x == 0.0 or b.co.x == 0.0:
                    target = (a if a.co.x == 0.0 else b).co.copy()
                else:
                    target = to_body.find_nearest((a.co + b.co) / 2)[0]
                bmesh.ops.pointmerge(bm, verts=[a, b], merge_co=target)
                removed += 1
                progress = True
                break
        if not progress:
            break
    bm.normal_update()
    left = sum(1 for f in bm.faces if not any(v.is_boundary for v in f.verts)
               and f.normal.dot(to_body.find_nearest(f.calc_center_median())[1]) < -0.5)
    if left:
        fail(f"{left} triangles still face against the refined surface")
    return removed


def remesh(ref: bmesh.types.BMesh) -> tuple[bmesh.types.BMesh, dict]:
    """An even, symmetric re-mesh of the refined surface `ref`, every vertex on it."""
    lo = min(v.co.z for v in ref.verts)
    hi = max(v.co.z for v in ref.verts)

    def on_cap(face) -> bool:
        return all(abs(v.co.z - lo) < 1e-5 for v in face.verts) or all(abs(v.co.z - hi) < 1e-5 for v in face.verts)

    for e in ref.edges:                              # the two rims are the only creases
        e.smooth = len({on_cap(f) for f in e.link_faces}) < 2
    body = ref.copy()
    bmesh.ops.delete(body, geom=[f for f in body.faces if on_cap(f)], context="FACES")
    to_body = BVHTree.FromBMesh(body)
    body.free()
    to_ref = BVHTree.FromBMesh(ref)

    source_mesh = bpy.data.meshes.new("quadriflow_input")
    ref.to_mesh(source_mesh)
    source_mesh.use_mirror_x = True
    ob = bpy.data.objects.new("quadriflow_input", source_mesh)
    bpy.context.scene.collection.objects.link(ob)
    for other in bpy.context.view_layer.objects:
        other.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    result = bpy.ops.object.quadriflow_remesh(
        use_mesh_symmetry=True, use_preserve_sharp=True, use_preserve_boundary=False, preserve_attributes=False,
        smooth_normals=False, mode="FACES", target_faces=QUADRIFLOW_FACES, seed=0)
    if "FINISHED" not in result:
        fail(f"QuadriFlow did not finish: {result}")
    remeshed = ob.data
    bm = bmesh.new()
    bm.from_mesh(remeshed)
    quads = len(bm.faces)
    bpy.data.objects.remove(ob)
    for mesh in (remeshed, source_mesh):
        try:
            bpy.data.meshes.remove(mesh)
        except ReferenceError:
            pass

    # QuadriFlow returns the two mirrored halves unwelded along x = 0
    seam = [v for v in bm.verts if v.is_boundary]
    for v in seam:
        v.co.x = 0.0
    bmesh.ops.remove_doubles(bm, verts=seam, dist=1e-5)
    if any(e.is_boundary for e in bm.edges) or any(not e.is_manifold for e in bm.edges):
        fail("the two QuadriFlow halves did not weld into one closed surface")
    seam = [v for v in bm.verts if v.co.x == 0.0]

    # its own caps are replaced: faces within 3 mm of a cut plane, facing along it
    bm.normal_update()
    caps = [f for f in bm.faces
            if (abs(f.calc_center_median().z - lo) < 0.003 and f.normal.z < -0.9)
            or (abs(f.calc_center_median().z - hi) < 0.003 and f.normal.z > 0.9)]
    bmesh.ops.delete(bm, geom=caps, context="FACES")
    seam = [v for v in seam if v.is_valid]

    # every vertex back onto the refined body, the rims onto their cut planes
    for v in bm.verts:
        if v.is_boundary:
            z = lo if abs(v.co.z - lo) < abs(v.co.z - hi) else hi
            v.co = to_body.find_nearest(Vector((v.co.x, v.co.y, z)))[0]
            v.co.z = z
        else:
            v.co = to_body.find_nearest(v.co)[0]
    for v in seam:
        v.co.x = 0.0
    relax(bm, to_body, seam)
    bmesh.ops.triangulate(bm, faces=list(bm.faces), quad_method="SHORT_EDGE")
    bm.normal_update()
    short_collapsed = collapse_short_edges(bm, to_body)
    unfolded = unfold(bm, to_body)
    seam = [v for v in bm.verts if v.co.x == 0.0 and not v.is_boundary] + [v for v in bm.verts if v.is_boundary and v.co.x == 0.0]
    relax(bm, to_body, seam)
    unfolded += unfold(bm, to_body)
    merged = collapse_short_rim_edges(bm)
    cap_triangles = fill_caps(bm)
    bmesh.ops.symmetrize(bm, input=list(bm.verts) + list(bm.edges) + list(bm.faces), direction="-X", dist=1e-6)
    bmesh.ops.triangulate(bm, faces=list(bm.faces), quad_method="SHORT_EDGE", ngon_method="BEAUTY")
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    nonmanifold = sum(1 for e in bm.edges if not e.is_manifold)
    if boundary or nonmanifold:
        fail(f"the re-mesh is not closed: {boundary} boundary, {nonmanifold} nonmanifold edges")

    on_ref = np.array([to_ref.find_nearest(v.co)[3] for v in bm.verts]) * 1000
    to_new = BVHTree.FromBMesh(bm)
    from_ref = np.array([to_new.find_nearest(v.co)[3] for v in ref.verts]) * 1000
    worst = max(ref.verts, key=lambda v: to_new.find_nearest(v.co)[3]).co
    stats = {
        "method": "QuadriFlow (Blender), mesh symmetry X, sharp rims preserved, seed 0",
        "target_faces": QUADRIFLOW_FACES, "quads": quads,
        "tangential_relaxation": {"iterations": RELAX_ITERATIONS, "factor": RELAX_FACTOR},
        "short_edges_collapsed": short_collapsed, "min_edge_m": MIN_EDGE_M,
        "folded_triangles_collapsed": unfolded,
        "rim_edges_merged": merged, "cap_triangles": cap_triangles, "cap_spacing_m": CAP_SPACING_M,
        "vertex_to_refined_surface_mm": {"median": round(float(np.median(on_ref)), 4), "max": round(float(on_ref.max()), 4)},
        "refined_surface_to_remesh_mm": {"median": round(float(np.median(from_ref)), 4),
                                         "p95": round(float(np.percentile(from_ref, 95)), 4),
                                         "p99": round(float(np.percentile(from_ref, 99)), 4),
                                         "max": round(float(from_ref.max()), 4),
                                         "max_at_gltf_m": [round(worst.x, 4), round(worst.z, 4), round(-worst.y, 4)]},
        "volume_change_pct": round(100 * (bm.calc_volume(signed=True) / ref.calc_volume(signed=True) - 1), 4),
    }
    return bm, stats


def to_gltf_arrays(bm: bmesh.types.BMesh) -> tuple[np.ndarray, np.ndarray]:
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    co = np.array([v.co[:] for v in bm.verts], dtype=np.float64)
    points = np.c_[co[:, 0], co[:, 2], -co[:, 1]]          # glTF: x, y up, z front
    tris = np.array([[v.index for v in f.verts] for f in bm.faces], dtype=np.int64)
    return points, tris


# ------------------------------------------------------------------ region split
def cap_faces(P: np.ndarray, T: np.ndarray) -> set[int]:
    """The neck and base caps: the faces lying wholly in the top or bottom plane."""
    lo, hi = P[:, 1].min(), P[:, 1].max()
    ys = P[T][:, :, 1]
    flat = np.all(np.abs(ys - lo) < 1e-5, axis=1) | np.all(np.abs(ys - hi) < 1e-5, axis=1)
    return set(np.nonzero(flat)[0].tolist())


def seam_field(loop: np.ndarray):
    side = float(np.sign(loop[:, 0].mean()))
    c = loop.mean(0)
    _, _, vt = np.linalg.svd(loop - c)
    n = vt[2] * np.sign(vt[2][0] * side)                    # outward, toward the arm
    up = np.array([0.0, 1.0, 0.0])
    e1 = up - up.dot(n) * n
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(n, e1)
    rel = loop - c
    theta = np.arctan2(rel @ e2, rel @ e1)
    offset = rel @ n
    order = np.argsort(theta)
    theta, offset = theta[order], offset[order]
    theta_ext = np.concatenate([theta[-1:] - 2 * np.pi, theta, theta[:1] + 2 * np.pi])
    offset_ext = np.concatenate([offset[-1:], offset, offset[:1]])

    def f(V: np.ndarray) -> np.ndarray:
        out = np.full(len(V), -1.0)
        mine = (np.sign(V[:, 0]) == side) & (np.abs(V[:, 0]) > 0.05)
        rv = V[mine] - c
        out[mine] = rv @ n - np.interp(np.arctan2(rv @ e2, rv @ e1), theta_ext, offset_ext)
        return out

    info = {"side": "R" if side > 0 else "L", "seam_points": int(len(loop)),
            "plane_centroid_m": [round(float(x), 5) for x in c], "plane_normal": [round(float(x), 5) for x in n],
            "seam_out_of_plane_mm": [round(float(offset.min()) * 1000, 2), round(float(offset.max()) * 1000, 2)]}
    return side, f, info


def split_regions(P: np.ndarray, T: np.ndarray, loops: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
    caps = cap_faces(P, T)
    verts = [p for p in P]
    tris = [list(t) for t in T]
    is_cap = [i in caps for i in range(len(tris))]
    arm = [False] * len(tris)
    report = {"cap_faces": len(caps), "armholes": []}
    for key in ("L", "R"):
        side, f, info = seam_field(np.array(loops[key], dtype=np.float64))
        fv = f(np.array(verts))
        sign = np.where(np.abs(fv) < CUT_SNAP_M, 0, np.sign(fv)).astype(int)
        cut: dict[tuple[int, int], int] = {}

        def crossing(u: int, v: int) -> int:
            k = (min(u, v), max(u, v))
            if k not in cut:
                t = fv[u] / (fv[u] - fv[v])
                verts.append(verts[u] + (verts[v] - verts[u]) * t)
                cut[k] = len(verts) - 1
            return cut[k]

        new_tris, new_cap, new_arm = [], [], []

        def emit(tri, on_arm, capped):
            new_tris.append(tri)
            new_arm.append(on_arm)
            new_cap.append(capped)

        for i, tri in enumerate(tris):
            s = [int(sign[v]) for v in tri]
            if is_cap[i] or not (1 in s and -1 in s):
                emit(tri, arm[i] or (not is_cap[i] and 1 in s), is_cap[i])
                continue
            a, b, c = tri
            sa, sb, sc = s
            if 0 in s:                                   # one vertex on the cut
                while sa != 0:
                    a, b, c, sa, sb, sc = b, c, a, sb, sc, sa
                m = crossing(b, c)
                emit([a, b, m], sb > 0 or arm[i], False)
                emit([a, m, c], sc > 0 or arm[i], False)
            else:                                        # a lone vertex on one side
                while not (sb == sc and sa != sb):
                    a, b, c, sa, sb, sc = b, c, a, sb, sc, sa
                m1, m2 = crossing(a, b), crossing(a, c)
                emit([a, m1, m2], sa > 0 or arm[i], False)
                emit([m1, b, c], sb > 0 or arm[i], False)
                emit([m1, c, m2], sb > 0 or arm[i], False)
        tris, is_cap, arm = new_tris, new_cap, new_arm
        info["vertices_on_cut_snapped"] = int((np.abs(fv) < CUT_SNAP_M).sum())
        info["vertices_inserted"] = len(cut)
        report["armholes"].append(info)
    V = np.array(verts)
    F = np.array(tris, dtype=np.int64)
    M = np.where(np.array(is_cap), 2, np.where(np.array(arm), 1, 0)).astype(np.int64)
    return V, F, M, report


def refine_arms(V: np.ndarray, F: np.ndarray, M: np.ndarray, ref: bmesh.types.BMesh):
    """Give the arm stubs the triangles their convex shape needs.

    The stubs are not a measurement surface -- no pen anchor, landmark or
    flattened piece lands on them -- so the even sampling the torso needs is only
    a cost there: 6 mm quads flattened the rim at each stub's end into a
    stair-stepped shading line. Every stub edge whose midpoint strays more than
    ARM_DEVIATION_M from the refined surface, OUTWARD, is bisected and the new
    vertex put on the surface. Only outward: under each stub is a slot narrower
    than the mesh (what is left of the original arm cut and its hole fill, not
    anatomy), and pulling midpoints into it folded triangles over; the re-mesh
    bridges it smoothly instead.

    No edge of the armhole is split and no vertex on it moves, so the torso keeps
    every vertex and triangle it had. A last symmetrize keeps the mirror exact."""
    bvh = BVHTree.FromBMesh(ref)
    bm = bmesh.new()
    verts = [bm.verts.new((x, -z, y)) for x, y, z in V]          # glTF -> Blender
    for (a, b, c), m in zip(F.tolist(), M.tolist()):
        bm.faces.new((verts[a], verts[b], verts[c])).material_index = m
    bm.normal_update()
    before = int((M == 1).sum())
    split = refused = 0
    for _ in range(ARM_REFINE_PASSES):
        edges = []
        for e in bm.edges:
            if len(e.link_faces) != 2 or not all(f.material_index == 1 for f in e.link_faces):
                continue
            mid_point = (e.verts[0].co + e.verts[1].co) / 2
            target, _, _, distance = bvh.find_nearest(mid_point)
            if distance <= ARM_DEVIATION_M:
                continue
            if (target - mid_point).dot(e.link_faces[0].normal + e.link_faces[1].normal) <= 0:
                refused += 1                                     # inward: the slot under the stub
                continue
            edges.append((e, target))
        if not edges:
            break
        for e, target in sorted(edges, key=lambda item: -item[0].calc_length()):
            if not e.is_valid or len(e.link_faces) != 2:
                continue
            a, b = e.verts
            opposite = [next(v for v in f.verts if v is not a and v is not b) for f in e.link_faces]
            _, mid = bmesh.utils.edge_split(e, a, 0.5)            # bisect: the two triangles become quads...
            mid.co = target
            for o in opposite:                                   # ...each cut back in two through its far corner
                bmesh.utils.face_split(next(f for f in mid.link_faces if o in f.verts), mid, o)
            for f in mid.link_faces:
                f.normal_update()
            split += 1

    for v in bm.verts:
        if abs(v.co.x) < 1e-9:
            v.co.x = 0.0
    bmesh.ops.symmetrize(bm, input=list(bm.verts) + list(bm.edges) + list(bm.faces), direction="-X", dist=1e-6)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3], quad_method="SHORT_EDGE")
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.verts.index_update()
    co = np.array([v.co[:] for v in bm.verts])
    V2 = np.c_[co[:, 0], co[:, 2], -co[:, 1]]
    F2 = np.array([[v.index for v in f.verts] for f in bm.faces], dtype=np.int64)
    M2 = np.array([f.material_index for f in bm.faces], dtype=np.int64)
    probe = BVHTree.FromBMesh(bm)
    off = np.array([probe.find_nearest(v.co)[3] for v in ref.verts
                    if abs(v.co.x) > 0.19 and v.co.z > 1.41]) * 1000   # the stubs outboard of the slot
    bm.free()
    stats = {"edges_split": split, "inward_edges_left": refused, "arm_triangles": [before, int((M2 == 1).sum())],
             "deviation_threshold_m": ARM_DEVIATION_M,
             "stub_surface_to_mesh_mm_outboard": {"p95": round(float(np.percentile(off, 95)), 4), "max": round(float(off.max()), 4)}}
    return V2, F2, M2, stats


def boundary_loops(faces: np.ndarray) -> tuple[list[list[int]], int, int]:
    count = Counter()
    for a, b, c in faces:
        for u, v in ((a, b), (b, c), (c, a)):
            count[(min(u, v), max(u, v))] += 1
    adjacency = defaultdict(list)
    for (u, v), k in count.items():
        if k == 1:
            adjacency[u].append(v)
            adjacency[v].append(u)
    nonmanifold = sum(1 for k in count.values() if k > 2)
    pinched = sum(1 for x in adjacency.values() if len(x) != 2)
    seen, loops = set(), []
    for start in adjacency:
        if start in seen:
            continue
        component, stack = [], [start]
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            component.append(x)
            stack.extend(adjacency[x])
        loops.append(component)
    return loops, nonmanifold, pinched


def check_regions(V: np.ndarray, F: np.ndarray, M: np.ndarray) -> dict:
    whole, nonmanifold, _ = boundary_loops(F)
    if whole or nonmanifold:
        fail(f"the combined surface must stay closed: {len(whole)} boundary loops, {nonmanifold} nonmanifold edges")
    A, B, C = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    area = np.linalg.norm(np.cross(B - A, C - A), axis=1) / 2
    longest = np.max(np.stack([np.linalg.norm(B - A, axis=1), np.linalg.norm(C - B, axis=1), np.linalg.norm(A - C, axis=1)]), axis=0)
    out = {"vertices": int(len(V)), "triangles": int(len(F)), "closed": True,
           "min_triangle_altitude_mm": round(float((2 * area / longest).min()) * 1000, 4), "surfaces": {}}
    expected = {"Mara:body3": 4, "Mara:arm2": 2, "Skin_Cut": 2}
    for k, name in enumerate(MATERIALS):
        loops, nm, pinched = boundary_loops(F[M == k])
        if len(loops) != expected[name] or nm or pinched:
            fail(f"{name}: {len(loops)} boundary loops (want {expected[name]}), {nm} nonmanifold, {pinched} pinched")
        rows = []
        for loop in loops:
            Q = V[loop]
            low = Q[Q[:, 1].argmin()]
            rows.append({"vertices": len(loop), "centroid_m": [round(float(x), 5) for x in Q.mean(0)],
                         "y_range_m": [round(float(Q[:, 1].min()), 5), round(float(Q[:, 1].max()), 5)],
                         "lowest_m": [round(float(x), 5) for x in low]})
        rows.sort(key=lambda r: r["centroid_m"][1])
        altitude = (2 * area / longest)[M == k] * 1000
        out["surfaces"][name] = {"triangles": int((M == k).sum()),
                                 "triangle_altitude_mm": {"min": round(float(altitude.min()), 4),
                                                          "median": round(float(np.median(altitude)), 4),
                                                          "narrower_than_2mm": int((altitude < 2.0).sum())},
                                 "boundary_loops": rows}
    return out


# ------------------------------------------------------------------ blender asset
def build_object(V: np.ndarray, F: np.ndarray, M: np.ndarray) -> bpy.types.Object:
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            datablocks.remove(block)

    blender_co = np.c_[V[:, 0], -V[:, 2], V[:, 1]]          # back to Blender Z up
    me = bpy.data.meshes.new(OBJECT_NAME)
    me.from_pydata(blender_co.tolist(), [], F.tolist())
    me.validate(clean_customdata=False)
    if len(me.polygons) != len(F):
        fail("mesh validation dropped faces")
    for name in MATERIALS:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        mat.use_backface_culling = False
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = (*SKIN_LINEAR, 1.0)
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = ROUGHNESS[name]
        bsdf.inputs["IOR"].default_value = 1.5
        mat.diffuse_color = (*SKIN_LINEAR, 1.0)
        me.materials.append(mat)
    me.polygons.foreach_set("material_index", M.tolist())
    me.polygons.foreach_set("use_smooth", (M != 2).tolist())  # caps stay flat
    # the rim where a flat cap meets the body is a crease; everywhere else is smooth
    cap_verts = set(F[M == 2].ravel().tolist())
    edge_faces = defaultdict(set)
    for poly in me.polygons:
        for key in poly.edge_keys:
            edge_faces[key].add(M[poly.index] == 2)
    sharp = [len(edge_faces[e.key]) == 2 and e.vertices[0] in cap_verts for e in me.edges]
    attr = me.attributes.get("sharp_edge") or me.attributes.new("sharp_edge", "BOOLEAN", "EDGE")
    attr.data.foreach_set("value", sharp)

    # No UV map: nothing is textured, and an unused TEXCOORD_0 is only noise in the GLB.
    ob = bpy.data.objects.new(OBJECT_NAME, me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    return ob


def export(ob: bpy.types.Object) -> None:
    for other in bpy.context.scene.objects:
        other.select_set(other is ob)
    GLB_OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_OUT), check_existing=False, export_format="GLB", use_selection=True,
        export_yup=True, export_apply=False, export_texcoords=False, export_normals=True,
        export_tangents=False, export_materials="EXPORT", export_vertex_color="NONE",
        export_attributes=False, export_extras=False, export_cameras=False, export_lights=False,
        export_animations=False, export_skins=False, export_morph=False,
    )


def glb_summary(path: Path) -> dict:
    data = path.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + length])
    mats = [m["name"] for m in gltf.get("materials", [])]
    prims = gltf["meshes"][0]["primitives"]
    return {
        "nodes": [n.get("name") for n in gltf["nodes"]],
        "materials": mats,
        "primitives": [{"material": mats[p["material"]], "attributes": sorted(p["attributes"]),
                        "vertices": gltf["accessors"][p["attributes"]["POSITION"]]["count"],
                        "triangles": gltf["accessors"][p["indices"]]["count"] // 3} for p in prims],
        "images": len(gltf.get("images", [])),
        "textures": len(gltf.get("textures", [])),
        "extensions_used": gltf.get("extensionsUsed", []),
    }


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 1:
        fail("usage: ... --python scripts/build_refined_l_avatar.py -- <Avatar_CLO3D_ready.blend>")
    source = Path(argv[0]).expanduser().resolve()
    seam = json.loads(SEAM_PATH.read_text(encoding="utf-8"))

    ref = load_source(source)
    mirror = symmetrize(ref)
    bm, remesh_stats = remesh(ref)
    P, T = to_gltf_arrays(bm)
    bm.free()
    V, F, M, split = split_regions(P, T, seam["loops"])
    V, F, M, arm_stats = refine_arms(V, F, M, ref)
    ref.free()
    checks = check_regions(V, F, M)

    ob = build_object(V, F, M)
    BLEND_OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT), compress=True, check_existing=False)
    export(ob)

    report = {
        "asset": GLB_OUT.name,
        "sha256": sha256(GLB_OUT),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": "Refined size-L torso (CLO3D AVT L, smoothed outside this repo, re-meshed evenly here), flat skin material, no textures. "
                "No shape keys or rig exist for it; the empty arrays reflect that, not an export failure.",
        "morph_names": [],
        "animation_names": [],
        "armature_exported": False,
        "source": {"file": source.name, "object": SOURCE_OBJECT, "sha256": SOURCE_SHA256,
                   "offset_to_avt_l_frame_m_blender_xyz": [OFFSET.x, OFFSET.y, OFFSET.z]},
        "armhole_seam": {"file": str(SEAM_PATH.relative_to(ROOT)), "sha256": sha256(SEAM_PATH),
                         "taken_from": seam["extracted_from"]},
        "editable_source": {"file": str(BLEND_OUT.relative_to(ROOT)), "sha256": sha256(BLEND_OUT)},
        "symmetry": mirror,
        "remesh": remesh_stats,
        "split": split,
        "arm_stubs": arm_stats,
        "mesh": checks,
        "material": {"base_color_linear": list(SKIN_LINEAR), "roughness": ROUGHNESS, "metallic": 0.0,
                     "textures": "none",
                     "from": "median of the previous baked Mara_body3_BaseColor / Roughness maps"},
        "glb": glb_summary(GLB_OUT),
        "blender": bpy.app.version_string,
    }
    REPORT_OUT.parent.mkdir(parents=True, exist_ok=True)
    REPORT_OUT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("sha256", "glb", "mesh")}, indent=1))


if __name__ == "__main__":
    main()
