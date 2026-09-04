#!/usr/bin/env python3
"""Volume enclosed between a surface patch and the plane of its boundary loop.

For a bra this is the cup volume: the breast mound measured against the chest
wall that the root loop stands on. The chest wall is not in the mesh — it is
hidden under the breast — so it has to be reconstructed, and the honest
reconstruction is the plane the root loop itself defines.

Method:

1. Fit a plane to the loop points (PCA; the loop's own least-squares plane).
2. Project the loop into that plane's 2D basis to get a polygon.
3. Select mesh triangles whose centroid projects inside that polygon and which
   sit on the protruding side of the plane.
4. For each selected triangle, the prism between it and the plane has volume
   A_projected * (h1 + h2 + h3) / 3, where h is the signed distance of each
   vertex from the plane. Sum them.

VALIDITY: exact only while the patch is a height field over its boundary plane —
verified to within 0.06% against a hemisphere and a 60-degree cap. A mound that
bulges wider than its own boundary is under-reported (a 120-degree cap comes out
14.9% light) and the routine CANNOT detect that from the projection alone, because
on a real torso the body legitimately continues outside the root loop. That is why
no cup-volume POM is emitted yet. See scripts/test_cup_volume.py.
"""

from __future__ import annotations

import math


def _plane_from_loop(loop):
    """Centroid and orthonormal basis (u, v, normal) of the loop's best-fit plane."""
    n = len(loop)
    cx = sum(p[0] for p in loop) / n
    cy = sum(p[1] for p in loop) / n
    cz = sum(p[2] for p in loop) / n
    # covariance of the loop points
    xx = xy = xz = yy = yz = zz = 0.0
    for p in loop:
        dx, dy, dz = p[0] - cx, p[1] - cy, p[2] - cz
        xx += dx * dx; xy += dx * dy; xz += dx * dz
        yy += dy * dy; yz += dy * dz; zz += dz * dz
    # the plane normal is the eigenvector of the smallest eigenvalue; found here
    # by the standard "largest cofactor axis" construction, which avoids a full
    # eigensolver and is stable for a well-spread loop
    det_x = yy * zz - yz * yz
    det_y = xx * zz - xz * xz
    det_z = xx * yy - xy * xy
    best = max(det_x, det_y, det_z)
    if best <= 0:
        return None
    if best == det_x:
        normal = (det_x, xz * yz - xy * zz, xy * yz - xz * yy)
    elif best == det_y:
        normal = (xz * yz - xy * zz, det_y, xy * xz - yz * xx)
    else:
        normal = (xy * yz - xz * yy, xy * xz - yz * xx, det_z)
    length = math.hypot(*normal)
    if length < 1e-12:
        return None
    normal = (normal[0] / length, normal[1] / length, normal[2] / length)
    # any vector not parallel to the normal gives the in-plane basis
    seed = (1.0, 0.0, 0.0) if abs(normal[0]) < 0.9 else (0.0, 1.0, 0.0)
    u = (seed[1] * normal[2] - seed[2] * normal[1],
         seed[2] * normal[0] - seed[0] * normal[2],
         seed[0] * normal[1] - seed[1] * normal[0])
    ulen = math.hypot(*u)
    u = (u[0] / ulen, u[1] / ulen, u[2] / ulen)
    v = (normal[1] * u[2] - normal[2] * u[1],
         normal[2] * u[0] - normal[0] * u[2],
         normal[0] * u[1] - normal[1] * u[0])
    return {"centroid": (cx, cy, cz), "normal": normal, "u": u, "v": v}


def _to_plane(plane, p):
    dx = p[0] - plane["centroid"][0]
    dy = p[1] - plane["centroid"][1]
    dz = p[2] - plane["centroid"][2]
    u, v, n = plane["u"], plane["v"], plane["normal"]
    return (dx * u[0] + dy * u[1] + dz * u[2],
            dx * v[0] + dy * v[1] + dz * v[2],
            dx * n[0] + dy * n[1] + dz * n[2])


def _point_in_polygon(x, y, polygon):
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if (yi > y) != (yj > y):
            if x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
        j = i
    return inside


def enclosed_volume(tri: list[float], loop) -> dict:
    """Volume between the surface patch inside `loop` and the loop's own plane.

    Returns cubic metres plus the diagnostics a reviewer needs to judge it.
    """
    plane = _plane_from_loop(loop)
    if plane is None:
        return {"volume_m3": None, "reason": "the loop is degenerate; no plane could be fitted"}

    polygon = []
    for p in loop:
        pu, pv, _ = _to_plane(plane, p)
        polygon.append((pu, pv))

    # which side of the plane the body bulges toward
    side = 0.0
    for t in range(0, len(tri), 9):
        cu, cv, cn = _to_plane(plane, ((tri[t] + tri[t + 3] + tri[t + 6]) / 3,
                                       (tri[t + 1] + tri[t + 4] + tri[t + 7]) / 3,
                                       (tri[t + 2] + tri[t + 5] + tri[t + 8]) / 3))
        if _point_in_polygon(cu, cv, polygon):
            side += cn
    if side == 0.0:
        return {"volume_m3": None, "reason": "no mesh triangles project inside the loop"}
    sign = 1.0 if side > 0 else -1.0

    # A projected prism sum is only valid while the patch is a HEIGHT FIELD over
    # its boundary plane. A patch that curves back under the plane's normal — a
    # deep, overhanging mound — projects many surface points onto the same spot
    # and the sum silently under-reports: a 120-degree spherical cap comes out
    # 14.9% light. So overhang is measured, and a patch that overhangs is
    # refused rather than answered wrongly.
    # VALIDITY LIMIT — read this before trusting a number from here.
    #
    # The prism sum is exact only while the patch is a HEIGHT FIELD over its
    # boundary plane. Measured against analytic caps: a hemisphere and a
    # 60-degree cap come out within 0.06%, but a 120-degree cap — which bulges
    # wider than its own boundary — comes out 14.9% LIGHT, because the part of
    # the mound that projects outside the loop is never counted.
    #
    # That failure cannot be detected from the projection alone on a real body:
    # the torso legitimately continues outside the root loop and above its
    # plane, so "surface outside the loop" is normal here and diagnostic on a
    # sphere. The caller is therefore told the assumption rather than sold a
    # detector that does not work, and the POM stays unemitted.

    volume = 0.0
    used = 0
    max_height = 0.0
    projected_area = 0.0
    for t in range(0, len(tri), 9):
        a = _to_plane(plane, (tri[t], tri[t + 1], tri[t + 2]))
        b = _to_plane(plane, (tri[t + 3], tri[t + 4], tri[t + 5]))
        c = _to_plane(plane, (tri[t + 6], tri[t + 7], tri[t + 8]))
        cu = (a[0] + b[0] + c[0]) / 3
        cv = (a[1] + b[1] + c[1]) / 3
        cn = (a[2] + b[2] + c[2]) / 3
        if cn * sign <= 0:
            continue
        if not _point_in_polygon(cu, cv, polygon):
            continue
        # signed area of the triangle projected into the plane
        area = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2
        volume += abs(area) * (a[2] + b[2] + c[2]) / 3 * sign
        projected_area += abs(area)
        used += 1
        max_height = max(max_height, abs(cn))

    if used == 0:
        return {"volume_m3": None, "reason": "no mesh triangles project inside the loop"}
    return {
        "volume_m3": volume,
        "triangles_used": used,
        "projected_area_m2": round(projected_area, 8),
        "max_height_mm": round(max_height * 1000, 2),
        "plane_normal": [round(v, 5) for v in plane["normal"]],
        "validity": ("Exact only while the mound is a height field over its boundary plane. A mound that "
                     "bulges wider than its own root loop is under-reported and this routine cannot tell."),
    }


# ---------------------------------------------------------------------------
# Closed-surface volume: the method that replaces the projection above.
#
# The projection method is exact only while the mound is a height field over its
# root plane, and under-reports a mound wider than its own loop by ~15% without
# being able to tell. This one has no such limit: it builds an actual closed
# surface and integrates it, so overhang is handled exactly.
#
#   1. Weld vertices and build edge adjacency.
#   2. Mark the triangles the root loop passes through as a barrier.
#   3. Flood fill across adjacency from the apex, stopped by the barrier.
#   4. Take the boundary edges of that patch and fan them to their centroid,
#      which seals the patch into a closed surface.
#   5. V = (1/6) * sum over triangles of a . (b x c), the divergence theorem.
#
# Step 5 is exact for any closed triangulated surface, so the accuracy question
# is entirely about step 3 — and step 4 gives a check the projection method
# never had: if the fill leaked or the barrier had a hole, the patch does not
# seal into exactly one loop, and that is detectable rather than silent.
# ---------------------------------------------------------------------------

def _weld(tri, precision=1e-6):
    """Weld coincident vertices and drop degenerate faces.

    Degenerate triangles — two corners welded to the same vertex, as a pole fan
    produces — create an edge from a vertex to itself and duplicate directed
    edges. They contribute nothing to a volume but they break the watertight
    check, so they are removed here rather than tolerated downstream.
    """
    index_of: dict[tuple, int] = {}
    points: list[tuple] = []
    faces: list[tuple[int, int, int]] = []
    degenerate = 0
    for t in range(0, len(tri), 9):
        face = []
        for v in range(3):
            p = (tri[t + v * 3], tri[t + v * 3 + 1], tri[t + v * 3 + 2])
            key = (round(p[0] / precision), round(p[1] / precision), round(p[2] / precision))
            idx = index_of.get(key)
            if idx is None:
                idx = len(points)
                index_of[key] = idx
                points.append(p)
            face.append(idx)
        if face[0] == face[1] or face[1] == face[2] or face[2] == face[0]:
            degenerate += 1
            continue
        faces.append(tuple(face))
    return points, faces, degenerate


def _nearest_face(points, faces, p):
    best = -1
    best_sq = math.inf
    for i, (a, b, c) in enumerate(faces):
        cx = (points[a][0] + points[b][0] + points[c][0]) / 3
        cy = (points[a][1] + points[b][1] + points[c][1]) / 3
        cz = (points[a][2] + points[b][2] + points[c][2]) / 3
        sq = (cx - p[0]) ** 2 + (cy - p[1]) ** 2 + (cz - p[2]) ** 2
        if sq < best_sq:
            best_sq, best = sq, i
    return best


def _densify(loop, spacing):
    out = []
    n = len(loop)
    for i in range(n):
        a, b = loop[i], loop[(i + 1) % n]
        d = math.dist(a, b)
        steps = max(1, int(d / spacing))
        for s in range(steps):
            t = s / steps
            out.append((a[0] + (b[0] - a[0]) * t,
                        a[1] + (b[1] - a[1]) * t,
                        a[2] + (b[2] - a[2]) * t))
    return out


def enclosed_volume_closed(tri: list[float], loop, seed_point, barrier_spacing=0.002) -> dict:
    """Volume of the mound inside `loop`, by closing the patch and integrating it.

    `seed_point` says which side of the loop is the mound — normally the apex.
    Returns cubic metres plus the closure diagnostics a reviewer needs.
    """
    points, faces, degenerate = _weld(tri)
    if not faces:
        return {"volume_m3": None, "reason": "no triangles"}

    # 2. barrier: every face the loop passes through
    barrier: set[int] = set()
    for p in _densify(loop, barrier_spacing):
        face = _nearest_face(points, faces, p)
        if face >= 0:
            barrier.add(face)
    if not barrier:
        return {"volume_m3": None, "reason": "the loop does not touch the mesh"}

    # adjacency across shared edges
    edge_faces: dict[tuple[int, int], list[int]] = {}
    for i, (a, b, c) in enumerate(faces):
        for u, v in ((a, b), (b, c), (c, a)):
            edge_faces.setdefault((min(u, v), max(u, v)), []).append(i)

    # 3. flood fill from the seed, stopped by the barrier
    seed = _nearest_face(points, faces, seed_point)
    if seed in barrier:
        return {"volume_m3": None, "reason": "the seed point sits on the loop itself"}
    patch = {seed}
    queue = [seed]
    while queue:
        current = queue.pop()
        a, b, c = faces[current]
        for u, v in ((a, b), (b, c), (c, a)):
            for neighbour in edge_faces.get((min(u, v), max(u, v)), ()):
                if neighbour in patch or neighbour in barrier:
                    continue
                patch.add(neighbour)
                queue.append(neighbour)
    if len(patch) >= len(faces) - len(barrier):
        return {"volume_m3": None,
                "reason": "the fill escaped past the loop and covered the whole mesh; the loop is "
                          "not closed on the surface"}
    patch |= barrier

    # 4. boundary edges, walked into loops, then fanned to a centroid
    boundary: dict[tuple[int, int], int] = {}
    for i in patch:
        a, b, c = faces[i]
        for u, v in ((a, b), (b, c), (c, a)):
            key = (min(u, v), max(u, v))
            if len(edge_faces.get(key, ())) == 1 or sum(1 for f in edge_faces[key] if f in patch) == 1:
                boundary[(u, v)] = boundary.get((u, v), 0) + 1
    directed = [e for e, count in boundary.items() if count == 1]
    if not directed:
        return {"volume_m3": None, "reason": "the patch has no boundary; it is already closed"}

    successor = {}
    for u, v in directed:
        successor.setdefault(u, []).append(v)
    loops = []
    unused = set(directed)
    while unused:
        start_u, start_v = next(iter(unused))
        walk = [start_u, start_v]
        unused.discard((start_u, start_v))
        while walk[-1] != walk[0]:
            nxt = None
            for candidate in successor.get(walk[-1], ()):
                if (walk[-1], candidate) in unused:
                    nxt = candidate
                    break
            if nxt is None:
                break
            unused.discard((walk[-1], nxt))
            walk.append(nxt)
        loops.append(walk)

    closed_loops = [w for w in loops if len(w) > 3 and w[0] == w[-1]]
    if len(closed_loops) != 1:
        return {"volume_m3": None,
                "boundary_loops": len(loops),
                "reason": (f"the patch boundary formed {len(loops)} loop(s), not exactly one, so it "
                           "cannot be sealed unambiguously. The root loop probably does not close on "
                           "the surface, or it crosses itself.")}

    ring = closed_loops[0][:-1]

    # Seal to the DRAWN LOOP, not to the mesh edge the fill happened to stop on.
    # Capping at the boundary ring alone biased the volume +2% on analytic caps,
    # because including the barrier ring pushes the closure a triangle outward.
    # A collar from each boundary vertex to its nearest point on the loop puts
    # the closing surface exactly where the root was drawn.
    dense_loop = _densify(loop, barrier_spacing)

    def nearest_loop_point(p):
        best = dense_loop[0]
        best_sq = math.inf
        for q in dense_loop:
            sq = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2
            if sq < best_sq:
                best_sq, best = sq, q
        return best, math.sqrt(best_sq)

    rim = []
    rim_gaps = []
    for i in ring:
        q, gap = nearest_loop_point(points[i])
        rim.append(q)
        rim_gaps.append(gap)

    cx = sum(q[0] for q in rim) / len(rim)
    cy = sum(q[1] for q in rim) / len(rim)
    cz = sum(q[2] for q in rim) / len(rim)
    centroid = (cx, cy, cz)

    def signed_volume(a, b, c):
        return (a[0] * (b[1] * c[2] - b[2] * c[1])
                + a[1] * (b[2] * c[0] - b[0] * c[2])
                + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6

    # 5. divergence theorem over patch + collar + cap
    closure: dict[tuple, int] = {}

    def add(a_key, b_key, c_key, a, b, c):
        nonlocal volume
        volume += signed_volume(a, b, c)
        for u, v in ((a_key, b_key), (b_key, c_key), (c_key, a_key)):
            closure[(u, v)] = closure.get((u, v), 0) + 1

    volume = 0.0
    for i in patch:
        a, b, c = faces[i]
        add(("v", a), ("v", b), ("v", c), points[a], points[b], points[c])
    n = len(ring)
    for i in range(n):
        j = (i + 1) % n
        ri, rj = ("v", ring[i]), ("v", ring[j])
        qi, qj = ("q", i), ("q", j)
        add(rj, ri, qi, points[ring[j]], points[ring[i]], rim[i])
        add(rj, qi, qj, points[ring[j]], rim[i], rim[j])
        add(qj, qi, ("c",), rim[j], rim[i], centroid)

    # Every edge of a closed surface is used exactly twice, once in each
    # direction. This is a real check on the construction, not a comment.
    unmatched = [e for e, count in closure.items()
                 if count != 1 or closure.get((e[1], e[0]), 0) != 1]
    if unmatched:
        return {"volume_m3": None,
                "unmatched_edges": len(unmatched),
                "reason": (f"the sealed surface is not watertight: {len(unmatched)} edge(s) are not "
                           "used exactly once in each direction, so the divergence integral would "
                           "not be a volume.")}

    return {
        "volume_m3": abs(volume),
        "method": "closed_surface_divergence",
        "patch_faces": len(patch),
        "barrier_faces": len(barrier),
        "degenerate_faces_dropped": degenerate,
        "boundary_ring_vertices": len(ring),
        "rim_gap_mean_mm": round(sum(rim_gaps) / len(rim_gaps) * 1000, 3),
        "rim_gap_max_mm": round(max(rim_gaps) * 1000, 3),
        "watertight": True,
        "validity": ("Exact for the closed surface it builds, and the surface is verified watertight. "
                     "Overhang is handled. rim_gap_* reports how far the patch boundary sat from the "
                     "drawn loop before the collar closed that gap."),
    }
