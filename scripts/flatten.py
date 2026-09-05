#!/usr/bin/env python3
"""Flattening a patch of skin to 2D, ported for the Python side of the parity gate.

This is a deliberate re-implementation of scripts/flatten_core.mjs, kept
parallel for the same reason the rest of the measurement stack is: the parity
gate (scripts/test_flatten_parity.mjs) can only catch a mistake if the two sides
were written independently. The *algorithm* must match exactly — same weld
quantum, same hinge-unfolding start, same Jacobi relaxation with the same
weights and stopping rule — or the layouts diverge; the code does not.

Standard library only, like every other project-side validator (see
DEPENDENCY_INVENTORY.md). That constraint is why the solver is a distance
relaxation and not a sparse linear solve: it needs no matrix library and, from
a hinge unfolding, reaches the same minimum as an LSCM/ARAP pipeline to 0.01mm
on the patches in scripts/flatten_cases.json.

Run as a script it builds every case in scripts/flatten_cases.json and prints
the layouts as JSON for the parity gate to compare against the JavaScript engine.

Geometry is plain floats: positions [x, y, z, ...], faces [i, j, k, ...],
uv [u, v, ...], all in metres.
"""

from __future__ import annotations

import argparse
import hashlib
import heapq
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from measure_avatar import triangles_by_material  # noqa: E402
from surface_path import build_grid, closest_on_mesh  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

DEFAULT_SOLVER = {"interior_weight": 0.25, "max_iterations": 10000, "convergence_m": 5e-9}
DEFAULT_WELD_QUANTUM = 1e-6
DEFAULT_LOOP_SPACING = 0.002


# ------------------------------------------------------------------ mesh build


def weld(tri, quantum: float = DEFAULT_WELD_QUANTUM) -> dict:
    """Triangle soup (9 floats per face) -> indexed mesh; face order preserved."""
    index: dict[tuple[int, int, int], int] = {}
    positions: list[float] = []
    faces: list[int] = []
    inv = 1.0 / quantum
    for t in range(0, len(tri), 3):
        x, y, z = tri[t], tri[t + 1], tri[t + 2]
        key = (math.floor(x * inv + 0.5), math.floor(y * inv + 0.5), math.floor(z * inv + 0.5))
        vid = index.get(key)
        if vid is None:
            vid = len(positions) // 3
            index[key] = vid
            positions.extend((x, y, z))
        faces.append(vid)
    return {"positions": positions, "faces": faces}


def edge_list(faces) -> dict:
    """Unique edges in first-appearance order with their face count."""
    seen: dict[int, int] = {}
    a: list[int] = []
    b: list[int] = []
    count: list[int] = []
    for f in range(0, len(faces), 3):
        for k in range(3):
            i, j = faces[f + k], faces[f + (k + 1) % 3]
            if i == j:
                continue
            lo, hi = (i, j) if i < j else (j, i)
            key = lo * 16777216 + hi
            at = seen.get(key)
            if at is None:
                seen[key] = len(a)
                a.append(lo)
                b.append(hi)
                count.append(1)
            else:
                count[at] += 1
    return {"a": a, "b": b, "count": count}


def _edge_lengths(P, edges):
    out = []
    for i, j in zip(edges["a"], edges["b"]):
        i3, j3 = i * 3, j * 3
        dx, dy, dz = P[i3] - P[j3], P[i3 + 1] - P[j3 + 1], P[i3 + 2] - P[j3 + 2]
        out.append(math.sqrt(dx * dx + dy * dy + dz * dz))
    return out


# ------------------------------------------------------------- patch selection


def edge_geodesic(mesh, source: int) -> list[float]:
    n = len(mesh["positions"]) // 3
    edges = edge_list(mesh["faces"])
    lengths = _edge_lengths(mesh["positions"], edges)
    adj: list[list[tuple[int, float]]] = [[] for _ in range(n)]
    for i, j, ln in zip(edges["a"], edges["b"], lengths):
        adj[i].append((j, ln))
        adj[j].append((i, ln))
    dist = [math.inf] * n
    dist[source] = 0.0
    heap = [(0.0, source)]
    while heap:
        d, v = heapq.heappop(heap)
        if d > dist[v]:
            continue
        for w, ln in adj[v]:
            nd = d + ln
            if nd < dist[w]:
                dist[w] = nd
                heapq.heappush(heap, (nd, w))
    return dist


def nearest_vertex(mesh, p) -> int:
    P = mesh["positions"]
    best, best_sq = -1, math.inf
    for i in range(0, len(P), 3):
        dx, dy, dz = P[i] - p[0], P[i + 1] - p[1], P[i + 2] - p[2]
        sq = dx * dx + dy * dy + dz * dz
        if sq < best_sq:
            best_sq, best = sq, i // 3
    return best


def geodesic_disc(mesh, seed, radius: float, half: str | None = None) -> list[int]:
    dist = edge_geodesic(mesh, nearest_vertex(mesh, seed))
    F, P = mesh["faces"], mesh["positions"]
    out = []
    for f in range(0, len(F), 3):
        if dist[F[f]] > radius or dist[F[f + 1]] > radius or dist[F[f + 2]] > radius:
            continue
        if half:
            cy = (P[F[f] * 3 + 1] + P[F[f + 1] * 3 + 1] + P[F[f + 2] * 3 + 1]) / 3
            if half == "above_seed" and cy < seed[1]:
                continue
            if half == "below_seed" and cy >= seed[1]:
                continue
        out.append(f // 3)
    return out


def _barycentric(P, F, face: int, q):
    i, j, k = F[face * 3] * 3, F[face * 3 + 1] * 3, F[face * 3 + 2] * 3
    v0 = (P[j] - P[i], P[j + 1] - P[i + 1], P[j + 2] - P[i + 2])
    v1 = (P[k] - P[i], P[k + 1] - P[i + 1], P[k + 2] - P[i + 2])
    v2 = (q[0] - P[i], q[1] - P[i + 1], q[2] - P[i + 2])
    d00 = v0[0] * v0[0] + v0[1] * v0[1] + v0[2] * v0[2]
    d01 = v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2]
    d11 = v1[0] * v1[0] + v1[1] * v1[1] + v1[2] * v1[2]
    d20 = v2[0] * v0[0] + v2[1] * v0[1] + v2[2] * v0[2]
    d21 = v2[0] * v1[0] + v2[1] * v1[1] + v2[2] * v1[2]
    den = d00 * d11 - d01 * d01
    b1 = (d11 * d20 - d01 * d21) / den
    b2 = (d00 * d21 - d01 * d20) / den
    return (1.0 - b1 - b2, b1, b2)


def extract_patch(mesh, closest, loop_points, seed, spacing: float = DEFAULT_LOOP_SPACING) -> dict:
    """Closed loop on the skin -> faces inside it (flood fill bounded by the faces
    the resampled loop lands on, plus those barrier faces themselves)."""
    P, F = mesh["positions"], mesh["faces"]
    nf = len(F) // 3
    samples = []
    barrier: set[int] = set()
    n = len(loop_points)
    for s in range(n):
        A, B = loop_points[s], loop_points[(s + 1) % n]
        dx, dy, dz = B[0] - A[0], B[1] - A[1], B[2] - A[2]
        chord = math.sqrt(dx * dx + dy * dy + dz * dz)
        steps = max(1, math.ceil(chord / spacing))
        for k in range(steps):
            t = k / steps
            hit = closest((A[0] + dx * t, A[1] + dy * t, A[2] + dz * t))
            if hit is None:
                return {"error": "loop sample found no surface"}
            face = hit["triangle"] // 9
            barrier.add(face)
            samples.append({"point": tuple(hit["point"]), "face": face, "bary": _barycentric(P, F, face, hit["point"])})
    seed_hit = closest(seed)
    if seed_hit is None:
        return {"error": "seed found no surface"}
    seed_face = seed_hit["triangle"] // 9
    if seed_face in barrier:
        return {"error": "the loop passes through the seed face"}

    edge_faces: dict[int, list[int]] = {}
    for f in range(nf):
        for k in range(3):
            i, j = F[f * 3 + k], F[f * 3 + (k + 1) % 3]
            key = (i if i < j else j) * 16777216 + (j if i < j else i)
            edge_faces.setdefault(key, []).append(f)
    flooded = {seed_face}
    queue = [seed_face]
    q = 0
    while q < len(queue):
        f = queue[q]
        q += 1
        for k in range(3):
            i, j = F[f * 3 + k], F[f * 3 + (k + 1) % 3]
            key = (i if i < j else j) * 16777216 + (j if i < j else i)
            for g in edge_faces[key]:
                if g == f or g in flooded or g in barrier:
                    continue
                flooded.add(g)
                queue.append(g)
    faces = [f for f in range(nf) if f in flooded or f in barrier]
    reach = 0.0
    for f in flooded:
        cx = (P[F[f * 3] * 3] + P[F[f * 3 + 1] * 3] + P[F[f * 3 + 2] * 3]) / 3 - seed[0]
        cy = (P[F[f * 3] * 3 + 1] + P[F[f * 3 + 1] * 3 + 1] + P[F[f * 3 + 2] * 3 + 1]) / 3 - seed[1]
        cz = (P[F[f * 3] * 3 + 2] + P[F[f * 3 + 1] * 3 + 2] + P[F[f * 3 + 2] * 3 + 2]) / 3 - seed[2]
        d = math.sqrt(cx * cx + cy * cy + cz * cz)
        if d > reach:
            reach = d
    return {"faces": faces, "samples": samples, "flooded": len(flooded), "barrier": len(barrier), "flood_reach_m": reach}


def submesh(mesh, face_ids) -> dict:
    vertex_map: dict[int, int] = {}
    positions: list[float] = []
    faces: list[int] = []
    kept: list[int] = []
    degenerate = 0
    MF, MP = mesh["faces"], mesh["positions"]
    for f in face_ids:
        ids = (MF[f * 3], MF[f * 3 + 1], MF[f * 3 + 2])
        if ids[0] == ids[1] or ids[1] == ids[2] or ids[0] == ids[2]:
            degenerate += 1
            continue
        for g in ids:
            local = vertex_map.get(g)
            if local is None:
                local = len(positions) // 3
                vertex_map[g] = local
                positions.extend((MP[g * 3], MP[g * 3 + 1], MP[g * 3 + 2]))
            faces.append(local)
        kept.append(f)
    return {"positions": positions, "faces": faces, "vertex_map": vertex_map, "face_ids": kept, "degenerate": degenerate}


# --------------------------------------------------------------------- flatten


def hinge_unfold(sub) -> list[float]:
    """Starting layout: the face nearest the patch centroid laid flat, every other
    face hinged out rigidly across a shared edge breadth-first, each vertex the mean
    of its copies. Exact on a developable surface; never places a face inverted."""
    P, F = sub["positions"], sub["faces"]
    nf, nv = len(F) // 3, len(P) // 3

    def d3(i, j):
        dx, dy, dz = P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]
        return math.sqrt(dx * dx + dy * dy + dz * dz)

    cx = cy = cz = 0.0
    for i in range(0, len(P), 3):
        cx += P[i]
        cy += P[i + 1]
        cz += P[i + 2]
    cx, cy, cz = cx / nv, cy / nv, cz / nv
    seed, seed_sq = 0, math.inf
    for f in range(nf):
        i, j, k = F[f * 3] * 3, F[f * 3 + 1] * 3, F[f * 3 + 2] * 3
        gx = (P[i] + P[j] + P[k]) / 3 - cx
        gy = (P[i + 1] + P[j + 1] + P[k + 1]) / 3 - cy
        gz = (P[i + 2] + P[j + 2] + P[k + 2]) / 3 - cz
        sq = gx * gx + gy * gy + gz * gz
        if sq < seed_sq:
            seed_sq, seed = sq, f
    edge_faces: dict[int, list[int]] = {}
    for f in range(nf):
        for k in range(3):
            i, j = F[f * 3 + k], F[f * 3 + (k + 1) % 3]
            key = (i if i < j else j) * 16777216 + (j if i < j else i)
            edge_faces.setdefault(key, []).append(f)
    corner = [math.nan] * (nf * 6)
    placed = [False] * nf

    def third(ax, ay, bx, by, a, b):
        ex, ey = bx - ax, by - ay
        c = math.sqrt(ex * ex + ey * ey)
        ux, uy = ex / c, ey / c
        x = (a * a - b * b + c * c) / (2 * c)
        y = math.sqrt(max(0.0, a * a - x * x))
        return (ax + x * ux - y * uy, ay + x * uy + y * ux)

    i, j, k = F[seed * 3], F[seed * 3 + 1], F[seed * 3 + 2]
    c = d3(i, j)
    tx, ty = third(0.0, 0.0, c, 0.0, d3(i, k), d3(j, k))
    corner[seed * 6:seed * 6 + 6] = [0.0, 0.0, c, 0.0, tx, ty]
    placed[seed] = True
    queue = [seed]
    q = 0
    while q < len(queue):
        f = queue[q]
        q += 1
        for k in range(3):
            i, j = F[f * 3 + k], F[f * 3 + (k + 1) % 3]
            key = (i if i < j else j) * 16777216 + (j if i < j else i)
            for g in edge_faces[key]:
                if g == f or placed[g]:
                    continue
                r = 0
                while r < 3 and not (F[g * 3 + r] == j and F[g * 3 + (r + 1) % 3] == i):
                    r += 1
                if r == 3:
                    r = 0
                    while r < 3 and not (F[g * 3 + r] == i and F[g * 3 + (r + 1) % 3] == j):
                        r += 1
                if r == 3:
                    continue
                A, B, C = F[g * 3 + r], F[g * 3 + (r + 1) % 3], F[g * 3 + (r + 2) % 3]
                slot_a = k if A == i else (k + 1) % 3
                slot_b = k if B == i else (k + 1) % 3
                ax, ay = corner[f * 6 + slot_a * 2], corner[f * 6 + slot_a * 2 + 1]
                bx, by = corner[f * 6 + slot_b * 2], corner[f * 6 + slot_b * 2 + 1]
                tx, ty = third(ax, ay, bx, by, d3(A, C), d3(B, C))
                corner[g * 6 + r * 2], corner[g * 6 + r * 2 + 1] = ax, ay
                corner[g * 6 + ((r + 1) % 3) * 2], corner[g * 6 + ((r + 1) % 3) * 2 + 1] = bx, by
                corner[g * 6 + ((r + 2) % 3) * 2], corner[g * 6 + ((r + 2) % 3) * 2 + 1] = tx, ty
                placed[g] = True
                queue.append(g)
    uv = [0.0] * (nv * 2)
    count = [0] * nv
    for f in range(nf):
        if not placed[f]:
            continue
        for k in range(3):
            v = F[f * 3 + k]
            uv[v * 2] += corner[f * 6 + k * 2]
            uv[v * 2 + 1] += corner[f * 6 + k * 2 + 1]
            count[v] += 1
    for v in range(nv):
        if count[v]:
            uv[v * 2] /= count[v]
            uv[v * 2 + 1] /= count[v]
    return uv


def relax_seam_exact(sub, uv, solver: dict = DEFAULT_SOLVER) -> dict:
    """Jacobi distance relaxation: boundary edges weigh 1.0, interior edges
    solver['interior_weight']; corrections applied together after each sweep."""
    edges = edge_list(sub["faces"])
    rest = _edge_lengths(sub["positions"], edges)
    ea, eb, ecount = edges["a"], edges["b"], edges["count"]
    m = len(ea)
    wi = solver["interior_weight"]
    w = [1.0 if ecount[e] == 1 else wi for e in range(m)]
    n = len(uv) // 2
    U = list(uv)
    max_iterations, tol = solver["max_iterations"], solver["convergence_m"]
    sqrt = math.sqrt
    iterations, converged = 0, False
    while iterations < max_iterations:
        acc = [0.0] * (n * 2)
        cw = [0.0] * n
        for e in range(m):
            i, j = ea[e], eb[e]
            i2, j2 = i * 2, j * 2
            dx, dy = U[i2] - U[j2], U[i2 + 1] - U[j2 + 1]
            ln = sqrt(dx * dx + dy * dy)
            if ln < 1e-12:
                ln = 1e-12
            we = w[e]
            s = we * (ln - rest[e]) / ln * 0.5
            cx, cy = s * dx, s * dy
            acc[i2] -= cx
            acc[i2 + 1] -= cy
            acc[j2] += cx
            acc[j2 + 1] += cy
            cw[i] += we
            cw[j] += we
        max_move = 0.0
        for i in range(n):
            c = cw[i]
            if c <= 0:
                continue
            mx, my = acc[i * 2] / c, acc[i * 2 + 1] / c
            U[i * 2] += mx
            U[i * 2 + 1] += my
            mv = sqrt(mx * mx + my * my)
            if mv > max_move:
                max_move = mv
        iterations += 1
        if max_move < tol:
            converged = True
            break
    return {"uv": U, "iterations": iterations, "converged": converged}


def flatten_patch(sub, solver: dict = DEFAULT_SOLVER) -> dict:
    return relax_seam_exact(sub, hinge_unfold(sub), solver)


# ----------------------------------------------------------------- reporting


def boundary_loops(sub) -> list[list[int]]:
    edges = edge_list(sub["faces"])
    nxt: dict[int, list[int]] = {}
    for a, b, c in zip(edges["a"], edges["b"], edges["count"]):
        if c != 1:
            continue
        nxt.setdefault(a, []).append(b)
        nxt.setdefault(b, []).append(a)
    used: set[int] = set()
    loops = []
    for start in sorted(nxt):
        if start in used:
            continue
        loop = [start]
        used.add(start)
        prev, cur = -1, start
        while True:
            options = [v for v in nxt[cur] if v != prev]
            if not options:
                break
            nx = options[0]
            if nx == start or nx in used:
                break
            loop.append(nx)
            used.add(nx)
            prev, cur = cur, nx
        loops.append(loop)
    return loops


def patch_stats(sub, uv) -> dict:
    P, F = sub["positions"], sub["faces"]
    edges = edge_list(F)
    rest = _edge_lengths(P, edges)
    b3 = b2 = worst_b = sum_sq_i = sum_sq_pct_i = max_pct_i = 0.0
    n_i = 0
    for e, (i, j, c) in enumerate(zip(edges["a"], edges["b"], edges["count"])):
        dx, dy = uv[i * 2] - uv[j * 2], uv[i * 2 + 1] - uv[j * 2 + 1]
        flat = math.sqrt(dx * dx + dy * dy)
        err = flat - rest[e]
        if c == 1:
            b3 += rest[e]
            b2 += flat
            if abs(err) > worst_b:
                worst_b = abs(err)
        else:
            n_i += 1
            sum_sq_i += err * err
            pct = err / rest[e]
            sum_sq_pct_i += pct * pct
            if abs(pct) > max_pct_i:
                max_pct_i = abs(pct)
    area3 = area2 = 0.0
    flips = 0
    for f in range(0, len(F), 3):
        i, j, k = F[f], F[f + 1], F[f + 2]
        ax, ay, az = P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]
        bx, by, bz = P[k * 3] - P[i * 3], P[k * 3 + 1] - P[i * 3 + 1], P[k * 3 + 2] - P[i * 3 + 2]
        cx, cy, cz = ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx
        area3 += 0.5 * math.sqrt(cx * cx + cy * cy + cz * cz)
        s = (uv[j * 2] - uv[i * 2]) * (uv[k * 2 + 1] - uv[i * 2 + 1]) - (uv[k * 2] - uv[i * 2]) * (uv[j * 2 + 1] - uv[i * 2 + 1])
        area2 += 0.5 * abs(s)
        if s < 0:
            flips += 1
    loops = boundary_loops(sub)
    nv, ne, nfc = len(P) // 3, len(edges["a"]), len(F) // 3
    return {
        "vertex_count": nv, "face_count": nfc, "edge_count": ne,
        "euler_characteristic": nv - ne + nfc,
        "boundary_loop_count": len(loops),
        "boundary_length_3d_m": b3, "boundary_length_flat_m": b2, "boundary_error_m": b2 - b3,
        "worst_boundary_edge_error_m": worst_b,
        "interior_rms_error_m": math.sqrt(sum_sq_i / n_i) if n_i else 0.0,
        "interior_rms_pct": 100 * math.sqrt(sum_sq_pct_i / n_i) if n_i else 0.0,
        "interior_max_pct": 100 * max_pct_i,
        "area_3d_m2": area3, "area_flat_m2": area2,
        "area_error_pct": 100 * (area2 - area3) / area3 if area3 else 0.0,
        "triangle_flips": flips,
    }


def map_loop_to_flat(samples, sub, uv) -> dict:
    local_face = {g: i for i, g in enumerate(sub["face_ids"])}
    F = sub["faces"]
    flat = []
    for s, smp in enumerate(samples):
        lf = local_face.get(smp["face"])
        if lf is None:
            return {"error": f"loop sample {s} lies outside the patch"}
        i, j, k = F[lf * 3], F[lf * 3 + 1], F[lf * 3 + 2]
        b0, b1, b2 = smp["bary"]
        flat.append((b0 * uv[i * 2] + b1 * uv[j * 2] + b2 * uv[k * 2],
                     b0 * uv[i * 2 + 1] + b1 * uv[j * 2 + 1] + b2 * uv[k * 2 + 1]))
    len3 = len2 = 0.0
    n = len(samples)
    for s in range(n):
        a, b = samples[s]["point"], samples[(s + 1) % n]["point"]
        dx, dy, dz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        len3 += math.sqrt(dx * dx + dy * dy + dz * dz)
        p, q = flat[s], flat[(s + 1) % n]
        ex, ey = q[0] - p[0], q[1] - p[1]
        len2 += math.sqrt(ex * ex + ey * ey)
    return {"points": flat, "loop_length_3d_m": len3, "loop_length_flat_m": len2}


# ------------------------------------------------------- fixtures for the gates
# Mirrors scripts/flatten_fixtures.mjs; both build the cases in flatten_cases.json.


def _grid_soup(ring, na: int, nv: int) -> list[float]:
    tri: list[float] = []
    for j in range(nv):
        for i in range(na):
            p00, p10, p11, p01 = ring(i, j), ring(i + 1, j), ring(i + 1, j + 1), ring(i, j + 1)
            tri.extend(p00); tri.extend(p10); tri.extend(p11)
            tri.extend(p00); tri.extend(p11); tri.extend(p01)
    return tri


def cylinder_soup(spec: dict) -> list[float]:
    R, H, na, nv = spec["radius_m"], spec["height_m"], spec["angular_segments"], spec["vertical_segments"]
    arc = spec["arc_deg"] * math.pi / 180

    def ring(i, j):
        th = arc * i / na
        return (R * math.cos(th), H * j / nv, R * math.sin(th))
    return _grid_soup(ring, na, nv)


def cone_soup(spec: dict) -> list[float]:
    rb, rt, H = spec["radius_bottom_m"], spec["radius_top_m"], spec["height_m"]
    na, nv = spec["angular_segments"], spec["vertical_segments"]
    arc = spec["arc_deg"] * math.pi / 180

    def ring(i, j):
        th = arc * i / na
        r = rb + (rt - rb) * j / nv
        return (r * math.cos(th), H * j / nv, r * math.sin(th))
    return _grid_soup(ring, na, nv)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_avatar_context(root: Path) -> dict:
    asset = root / "assets" / "export" / "avatar_master.glb"
    registry_path = root / "contracts" / "measurement-registry.json"
    evidence_path = root / "qa" / "avatar_master" / "measurements.json"
    for p in (asset, registry_path, evidence_path):
        if not p.exists():
            return {"error": f"missing {p}"}
    asset_sha = _sha256(asset)
    registry = json.loads(registry_path.read_text())
    evidence = json.loads(evidence_path.read_text())
    if evidence.get("asset", {}).get("sha256") != asset_sha:
        return {"error": "landmarks in qa/avatar_master/measurements.json were measured on a different asset — run npm run measure:avatar"}
    by_material, _ = triangles_by_material(asset)
    tri: list[float] = []
    for name in registry["measurement_surface"]:
        tri.extend(by_material.get(name, []))
    mesh = weld(tri)
    grid = build_grid(tri)
    landmarks = {k: v["xyz_m"] for k, v in (evidence.get("landmarks") or {}).items() if "xyz_m" in v}
    return {"asset_sha": asset_sha, "registry": registry, "mesh": mesh,
            "closest": lambda p: closest_on_mesh(grid, p), "landmarks": landmarks}


def loop_around(closest, seed, radius: float, count: int):
    hit = closest(seed)
    nx, ny, nz = hit["normal"]
    ax, ay, az = (1.0, 0.0, 0.0) if abs(nx) < 0.9 else (0.0, 1.0, 0.0)
    ux, uy, uz = ny * az - nz * ay, nz * ax - nx * az, nx * ay - ny * ax
    ul = math.sqrt(ux * ux + uy * uy + uz * uz)
    ux, uy, uz = ux / ul, uy / ul, uz / ul
    vx, vy, vz = ny * uz - nz * uy, nz * ux - nx * uz, nx * uy - ny * ux
    points = []
    for k in range(count):
        th = 2 * math.pi * k / count
        c, s = math.cos(th) * radius, math.sin(th) * radius
        q = closest((seed[0] + c * ux + s * vx, seed[1] + c * uy + s * vy, seed[2] + c * uz + s * vz))
        points.append(tuple(q["point"]))
    return points


def resolve_case(spec: dict, ctx: dict | None) -> dict:
    if spec["type"] in ("cylinder", "cone"):
        soup = cylinder_soup(spec) if spec["type"] == "cylinder" else cone_soup(spec)
        mesh = weld(soup)
        return {"sub": submesh(mesh, range(len(mesh["faces"]) // 3))}
    if not ctx or "error" in ctx:
        return {"error": (ctx or {}).get("error", "avatar context unavailable")}
    seed = ctx["landmarks"].get(spec["seed_landmark"])
    if seed is None:
        return {"error": f"landmark {spec['seed_landmark']} is not in the authority pass"}
    if spec["type"] == "avatar_disc":
        faces = geodesic_disc(ctx["mesh"], seed, spec["radius_m"], spec.get("half"))
        return {"sub": submesh(ctx["mesh"], faces), "seed": seed}
    if spec["type"] == "avatar_loop":
        loop = loop_around(ctx["closest"], seed, spec["radius_m"], spec["loop_points"])
        patch = extract_patch(ctx["mesh"], ctx["closest"], loop, seed)
        if "error" in patch:
            return {"error": patch["error"]}
        return {"sub": submesh(ctx["mesh"], patch["faces"]), "seed": seed, "patch": patch}
    return {"error": f"unknown case type {spec['type']}"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Flatten every case in flatten_cases.json; print JSON.")
    parser.add_argument("--cases", default=str(ROOT / "scripts" / "flatten_cases.json"))
    parser.add_argument("--only", help="comma-separated case ids")
    args = parser.parse_args()
    cases = json.loads(Path(args.cases).read_text())
    solver = {**DEFAULT_SOLVER, **cases.get("solver", {})}
    wanted = set(args.only.split(",")) if args.only else None
    ctx = None
    results = []
    for spec in cases["cases"]:
        if wanted and spec["id"] not in wanted:
            continue
        if spec["type"].startswith("avatar") and ctx is None:
            ctx = load_avatar_context(ROOT)
        built = resolve_case(spec, ctx)
        if "error" in built:
            results.append({"id": spec["id"], "error": built["error"]})
            continue
        sub = built["sub"]
        run = flatten_patch(sub, solver)
        row = {"id": spec["id"], "iterations": run["iterations"], "converged": run["converged"],
               "stats": patch_stats(sub, run["uv"]), "uv": run["uv"]}
        if "patch" in built:
            mapped = map_loop_to_flat(built["patch"]["samples"], sub, run["uv"])
            row["loop"] = {"flooded": built["patch"]["flooded"], "barrier": built["patch"]["barrier"],
                           "flood_reach_m": built["patch"]["flood_reach_m"],
                           **{k: v for k, v in mapped.items() if k != "points"}}
        results.append(row)
    out = {"schema_version": 1, "engine": "scripts/flatten.py", "solver": solver,
           "asset_sha256": ctx["asset_sha"] if ctx and "asset_sha" in ctx else None, "results": results}
    json.dump(out, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
