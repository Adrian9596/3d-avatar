#!/usr/bin/env python3
"""Shortest-path-on-a-surface, ported for the Python authority pass.

This is a deliberate re-implementation of scripts/surface_path.mjs, kept
parallel for the same reason the rest of the measurement stack is: the parity
gate can only catch a mistake if the two sides were written independently. The
*algorithm* must match exactly — same seed, same resampling, same multigrid
schedule — or the readings diverge; the code does not.

Why the shortest surface path and nothing else: it is the only path definition
whose sub-paths are themselves shortest paths, which is what keeps a reading
from jumping when a run gains intermediate points. See the module docstring in
surface_path.mjs for the history that led here.

Geometry is plain (x, y, z) tuples and flat lists of floats.
"""

from __future__ import annotations

import math

GRID_CELL = 0.02
SPACING = 0.008
SCHEDULE = ((0.032, 40), (0.016, 40), (0.008, 40))


# --------------------------------------------------------------- spatial grid


def build_grid(tri: list[float], cell: float = GRID_CELL) -> dict:
    cells: dict[tuple[int, int, int], list[int]] = {}
    for t in range(0, len(tri), 9):
        xs = (tri[t], tri[t + 3], tri[t + 6])
        ys = (tri[t + 1], tri[t + 4], tri[t + 7])
        zs = (tri[t + 2], tri[t + 5], tri[t + 8])
        for i in range(math.floor(min(xs) / cell), math.floor(max(xs) / cell) + 1):
            for j in range(math.floor(min(ys) / cell), math.floor(max(ys) / cell) + 1):
                for k in range(math.floor(min(zs) / cell), math.floor(max(zs) / cell) + 1):
                    cells.setdefault((i, j, k), []).append(t)
    return {"cells": cells, "cell": cell, "tri": tri}


def _closest_on_triangle(p, tri, t):
    """Ericson, Real-Time Collision Detection."""
    ax, ay, az = tri[t], tri[t + 1], tri[t + 2]
    bx, by, bz = tri[t + 3], tri[t + 4], tri[t + 5]
    cx, cy, cz = tri[t + 6], tri[t + 7], tri[t + 8]
    abx, aby, abz = bx - ax, by - ay, bz - az
    acx, acy, acz = cx - ax, cy - ay, cz - az
    apx, apy, apz = p[0] - ax, p[1] - ay, p[2] - az
    d1 = abx * apx + aby * apy + abz * apz
    d2 = acx * apx + acy * apy + acz * apz
    if d1 <= 0 and d2 <= 0:
        return (ax, ay, az)
    bpx, bpy, bpz = p[0] - bx, p[1] - by, p[2] - bz
    d3 = abx * bpx + aby * bpy + abz * bpz
    d4 = acx * bpx + acy * bpy + acz * bpz
    if d3 >= 0 and d4 <= d3:
        return (bx, by, bz)
    vc = d1 * d4 - d3 * d2
    if vc <= 0 and d1 >= 0 and d3 <= 0:
        v = d1 / (d1 - d3)
        return (ax + abx * v, ay + aby * v, az + abz * v)
    cpx, cpy, cpz = p[0] - cx, p[1] - cy, p[2] - cz
    d5 = abx * cpx + aby * cpy + abz * cpz
    d6 = acx * cpx + acy * cpy + acz * cpz
    if d6 >= 0 and d5 <= d6:
        return (cx, cy, cz)
    vb = d5 * d2 - d1 * d6
    if vb <= 0 and d2 >= 0 and d6 <= 0:
        w = d2 / (d2 - d6)
        return (ax + acx * w, ay + acy * w, az + acz * w)
    va = d3 * d6 - d5 * d4
    if va <= 0 and (d4 - d3) >= 0 and (d5 - d6) >= 0:
        w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        return (bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w)
    denom = 1 / (va + vb + vc)
    v = vb * denom
    w = vc * denom
    return (ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w)


def _triangle_normal(tri, t):
    e1 = (tri[t + 3] - tri[t], tri[t + 4] - tri[t + 1], tri[t + 5] - tri[t + 2])
    e2 = (tri[t + 6] - tri[t], tri[t + 7] - tri[t + 1], tri[t + 8] - tri[t + 2])
    n = (e1[1] * e2[2] - e1[2] * e2[1],
         e1[2] * e2[0] - e1[0] * e2[2],
         e1[0] * e2[1] - e1[1] * e2[0])
    length = math.hypot(*n) or 1.0
    return (n[0] / length, n[1] / length, n[2] / length)


def closest_on_mesh(grid: dict, p):
    cells, cell, tri = grid["cells"], grid["cell"], grid["tri"]
    ci, cj, ck = math.floor(p[0] / cell), math.floor(p[1] / cell), math.floor(p[2] / cell)
    best_sq = math.inf
    best = None
    best_tri = -1
    for r in range(7):
        for i in range(ci - r, ci + r + 1):
            for j in range(cj - r, cj + r + 1):
                for k in range(ck - r, ck + r + 1):
                    if r > 0 and max(abs(i - ci), abs(j - cj), abs(k - ck)) != r:
                        continue
                    for t in cells.get((i, j, k), ()):
                        q = _closest_on_triangle(p, tri, t)
                        sq = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2
                        if sq < best_sq:
                            best_sq, best, best_tri = sq, q, t
        if best is not None and math.sqrt(best_sq) <= r * cell:
            break
    if best is None:
        return None
    normal = list(_triangle_normal(tri, best_tri))
    radial = (best[0], 0.0, best[2])
    if radial[0] ** 2 + radial[2] ** 2 > 1e-9:
        if normal[0] * radial[0] + normal[2] * radial[2] < 0:
            normal = [-normal[0], -normal[1], -normal[2]]
    # "triangle" is the offset into tri (9 floats per face): face index = t // 9
    return {"point": best, "normal": tuple(normal), "triangle": best_tri}


# ------------------------------------------------------------- plane sectioning


def plane_section(tri: list[float], origin, normal):
    segments = []

    def side(i):
        return ((tri[i] - origin[0]) * normal[0]
                + (tri[i + 1] - origin[1]) * normal[1]
                + (tri[i + 2] - origin[2]) * normal[2])

    for t in range(0, len(tri), 9):
        d0, d1, d2 = side(t), side(t + 3), side(t + 6)
        if (d0 > 0 and d1 > 0 and d2 > 0) or (d0 < 0 and d1 < 0 and d2 < 0):
            continue
        hits = []
        for i, j, di, dj in ((t, t + 3, d0, d1), (t + 3, t + 6, d1, d2), (t + 6, t, d2, d0)):
            if (di > 0) != (dj > 0):
                s = di / (di - dj)
                hits.append((tri[i] + (tri[j] - tri[i]) * s,
                             tri[i + 1] + (tri[j + 1] - tri[i + 1]) * s,
                             tri[i + 2] + (tri[j + 2] - tri[i + 2]) * s))
        if len(hits) == 2:
            segments.append(hits)
    return segments


def _node_key(p):
    return (round(p[0] * 1e5), round(p[1] * 1e5), round(p[2] * 1e5))


def walk_section(segments, a, b):
    """Shortest walk along the section curve, from the node nearest a to nearest b."""
    points: dict[tuple, tuple] = {}
    edges: dict[tuple, list[tuple[tuple, float]]] = {}
    for p, q in segments:
        kp, kq = _node_key(p), _node_key(q)
        points.setdefault(kp, p)
        points.setdefault(kq, q)
        w = math.dist(p, q)
        if w <= 0:
            continue
        edges.setdefault(kp, []).append((kq, w))
        edges.setdefault(kq, []).append((kp, w))
    if not points:
        return None
    start = min(points, key=lambda k: math.dist(points[k], a))
    goal = min(points, key=lambda k: math.dist(points[k], b))
    if start == goal:
        return None

    import heapq
    dist = {start: 0.0}
    prev: dict[tuple, tuple] = {}
    done: set[tuple] = set()
    queue = [(0.0, start)]
    while queue:
        d, current = heapq.heappop(queue)
        if current in done:
            continue
        done.add(current)
        if current == goal:
            break
        for to, w in edges.get(current, ()):
            if to in done:
                continue
            alt = d + w
            if alt < dist.get(to, math.inf):
                dist[to] = alt
                prev[to] = current
                heapq.heappush(queue, (alt, to))
    if goal not in dist:
        return None
    path = []
    node = goal
    while node is not None:
        path.append(points[node])
        node = prev.get(node)
    path.reverse()
    return path


# ------------------------------------------------------------------ the path


def path_length(points) -> float:
    return sum(math.dist(points[i], points[i - 1]) for i in range(1, len(points)))


def resample(points, spacing: float = SPACING):
    total = path_length(points)
    if total <= 0:
        return [tuple(points[0]), tuple(points[-1])]
    count = max(2, min(400, round(total / spacing)))
    out = [tuple(points[0])]
    index = 1
    walked = 0.0
    for s in range(1, count):
        target = total * s / count
        while index < len(points):
            step = math.dist(points[index], points[index - 1])
            if walked + step >= target or index == len(points) - 1:
                t = (target - walked) / step if step > 0 else 0.0
                a, b = points[index - 1], points[index]
                out.append((a[0] + (b[0] - a[0]) * t,
                            a[1] + (b[1] - a[1]) * t,
                            a[2] + (b[2] - a[2]) * t))
                break
            walked += step
            index += 1
    out.append(tuple(points[-1]))
    return out


def relax(grid, points, iterations: int):
    """Shorten toward the surface geodesic: each interior point moves to the
    midpoint of its neighbours and is snapped back onto the mesh."""
    if len(points) < 3:
        return points
    current = [tuple(p) for p in points]
    for _ in range(iterations):
        nxt = [current[0]]
        for i in range(1, len(current) - 1):
            mid = ((current[i - 1][0] + current[i + 1][0]) / 2,
                   (current[i - 1][1] + current[i + 1][1]) / 2,
                   (current[i - 1][2] + current[i + 1][2]) / 2)
            hit = closest_on_mesh(grid, mid)
            nxt.append(hit["point"] if hit else current[i])
        nxt.append(current[-1])
        current = nxt
    return current


def surface_run(grid, a, b, normal_a=None, normal_b=None, schedule=SCHEDULE, seed=None):
    """Shortest path along the surface from a to b.

    Returns {"points", "length", "on_surface"}. `on_surface` is False only when
    no surface route could be found at all, in which case the straight chord is
    returned and the caller must say so rather than passing it off as a run.
    """
    tri = grid["tri"]
    chord = math.dist(a, b)
    if chord < 1e-5:
        return {"points": [tuple(a), tuple(b)], "length": 0.0, "on_surface": True}

    if normal_a is None:
        hit = closest_on_mesh(grid, a)
        normal_a = hit["normal"] if hit else (0.0, 0.0, 1.0)
    if normal_b is None:
        hit = closest_on_mesh(grid, b)
        normal_b = hit["normal"] if hit else (0.0, 0.0, 1.0)

    if seed is not None and len(seed) > 1:
        relaxed = [tuple(p) for p in seed]
    else:
        ab = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        avg = [normal_a[0] + normal_b[0], normal_a[1] + normal_b[1], normal_a[2] + normal_b[2]]
        length = math.hypot(*avg)
        if length < 1e-9:
            avg = list(normal_a)
            length = math.hypot(*avg) or 1.0
        avg = [v / length for v in avg]
        normal = [ab[1] * avg[2] - ab[2] * avg[1],
                  ab[2] * avg[0] - ab[0] * avg[2],
                  ab[0] * avg[1] - ab[1] * avg[0]]
        nlen = math.hypot(*normal)
        if nlen < 1e-12:
            normal = [ab[1], -ab[0], 0.0]
            nlen = math.hypot(*normal)
            if nlen < 1e-12:
                normal = [0.0, ab[2], -ab[1]]
                nlen = math.hypot(*normal) or 1.0
        normal = [v / nlen for v in normal]
        segments = plane_section(tri, a, normal)
        walk = walk_section(segments, a, b) if segments else None
        if walk and len(walk) > 1 and path_length([tuple(a)] + walk + [tuple(b)]) < chord * 6:
            relaxed = [tuple(a)] + walk + [tuple(b)]
        else:
            relaxed = [tuple(a), tuple(b)]

    for level_spacing, level_iterations in schedule:
        relaxed = resample(relaxed, level_spacing)
        relaxed = relax(grid, relaxed, level_iterations)
        relaxed[0] = tuple(a)
        relaxed[-1] = tuple(b)

    length = path_length(relaxed)
    if not math.isfinite(length) or length > chord * 6:
        return {"points": [tuple(a), tuple(b)], "length": chord, "on_surface": False}
    return {"points": relaxed, "length": length, "on_surface": True}


def point_at_fraction(points, fraction: float):
    total = path_length(points)
    if total <= 0:
        return tuple(points[0])
    target = total * fraction
    walked = 0.0
    for i in range(1, len(points)):
        step = math.dist(points[i], points[i - 1])
        if walked + step >= target:
            t = (target - walked) / step if step > 0 else 0.0
            a, b = points[i - 1], points[i]
            return (a[0] + (b[0] - a[0]) * t,
                    a[1] + (b[1] - a[1]) * t,
                    a[2] + (b[2] - a[2]) * t)
        walked += step
    return tuple(points[-1])
