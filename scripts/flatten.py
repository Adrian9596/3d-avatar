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

DEFAULT_SOLVER = {"interior_weight": 0.25, "seam_weight": 1.0, "couple_weight": 4.0, "max_iterations": 10000,
                  "convergence_m": 5e-9, "chebyshev_rho": 0.999, "chebyshev_gamma": 0.75, "chebyshev_delay": 10,
                  "rho_fallback": [0.99, 0.9, 0], "fold_min_area_fraction": 0.25}
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


def _edge_face_map(F):
    edge_faces: dict[int, list[int]] = {}
    for f in range(len(F) // 3):
        for k in range(3):
            i, j = F[f * 3 + k], F[f * 3 + (k + 1) % 3]
            key = (i if i < j else j) * 16777216 + (j if i < j else i)
            edge_faces.setdefault(key, []).append(f)
    return edge_faces


def point_key(p) -> str:
    """Identity of a sample for matching across pieces (same floats -> same key)."""
    return f"{math.floor(p[0] * 1e9 + 0.5)},{math.floor(p[1] * 1e9 + 0.5)},{math.floor(p[2] * 1e9 + 0.5)}"


def _lex_less(A, B) -> bool:
    if A[0] != B[0]:
        return A[0] < B[0]
    if A[1] != B[1]:
        return A[1] < B[1]
    return A[2] < B[2]


def extract_patch(mesh, closest, loop_points, seed, spacing: float = DEFAULT_LOOP_SPACING) -> dict:
    """Closed loop on the skin -> faces inside it (flood fill bounded by the faces
    the resampled loop lands on, plus those barrier faces themselves). Segments
    are resampled in a canonical direction so a run two loops share yields
    bit-identical samples in both."""
    P, F = mesh["positions"], mesh["faces"]
    nf = len(F) // 3
    samples = []
    barrier: set[int] = set()
    n = len(loop_points)
    for s in range(n):
        A, B = loop_points[s], loop_points[(s + 1) % n]
        forward = _lex_less(A, B) or (A[0] == B[0] and A[1] == B[1] and A[2] == B[2])
        S, E = (A, B) if forward else (B, A)
        dx, dy, dz = E[0] - S[0], E[1] - S[1], E[2] - S[2]
        chord = math.sqrt(dx * dx + dy * dy + dz * dz)
        steps = max(1, math.ceil(chord / spacing))
        raw = []
        for k in range(steps + 1):
            t = k / steps
            raw.append((E[0], E[1], E[2]) if k == steps else (S[0] + dx * t, S[1] + dy * t, S[2] + dz * t))
        ordered = raw[:steps] if forward else list(reversed(raw[1:]))
        for q in ordered:
            hit = closest(q)
            if hit is None:
                return {"error": "loop sample found no surface"}
            face = hit["triangle"] // 9
            barrier.add(face)
            pt = tuple(hit["point"])
            samples.append({"point": pt, "key": point_key(pt), "face": face, "bary": _barycentric(P, F, face, pt)})
    seed_hit = closest(seed)
    if seed_hit is None:
        return {"error": "seed found no surface"}
    seed_face = seed_hit["triangle"] // 9
    if seed_face in barrier:
        return {"error": "the loop passes through the seed face"}

    edge_faces = _edge_face_map(F)
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


def loop_chords(samples, sub) -> dict:
    """Consecutive loop samples as barycentric distance constraints on a piece."""
    local_face = {g: i for i, g in enumerate(sub["face_ids"])}
    chords = []
    n = len(samples)
    for s in range(n):
        a, b = samples[s], samples[(s + 1) % n]
        fa, fb = local_face.get(a["face"]), local_face.get(b["face"])
        if fa is None or fb is None:
            return {"error": f"loop sample {s if fa is None else (s + 1) % n} lies outside the patch"}
        dx = b["point"][0] - a["point"][0]
        dy = b["point"][1] - a["point"][1]
        dz = b["point"][2] - a["point"][2]
        chords.append({"fa": fa, "ba": a["bary"], "fb": fb, "bb": b["bary"],
                       "rest": math.sqrt(dx * dx + dy * dy + dz * dz),
                       "pair": f"{a['key']}|{b['key']}" if a["key"] < b["key"] else f"{b['key']}|{a['key']}"})
    return {"chords": chords}


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
    edge_faces = _edge_face_map(F)
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


def relax_pieces(pieces, solver: dict = DEFAULT_SOLVER) -> dict:
    """Jacobi seam-exact relaxation of one or more pieces at once — see
    relaxPieces in flatten_core.mjs for the constraint set, the fold-over push,
    the rigid-drift removal and the Chebyshev acceleration; this is its port."""
    sqrt = math.sqrt
    wi, ws, wcpl = solver["interior_weight"], solver["seam_weight"], solver["couple_weight"]
    rho = solver.get("chebyshev_rho", 0.0)
    gamma = solver.get("chebyshev_gamma", 1.0)
    delay = solver.get("chebyshev_delay", 0)
    ladder = [r for r in solver.get("rho_fallback", []) if r < rho]
    fold_fraction = solver.get("fold_min_area_fraction", 0.0)
    restarts, sweep_base = 0, 0
    states = []
    for piece in pieces:
        sub, uv = piece["sub"], piece["uv"]
        chords = piece.get("chords") or []
        edges = edge_list(sub["faces"])
        rest = _edge_lengths(sub["positions"], edges)
        has_loop = len(chords) > 0
        w = [ws if (c == 1 and not has_loop) else wi for c in edges["count"]]
        P, F = sub["positions"], sub["faces"]
        area3 = []
        for f in range(0, len(F), 3):
            i, j, k = F[f] * 3, F[f + 1] * 3, F[f + 2] * 3
            ax, ay, az = P[j] - P[i], P[j + 1] - P[i + 1], P[j + 2] - P[i + 2]
            bx, by, bz = P[k] - P[i], P[k + 1] - P[i + 1], P[k + 2] - P[i + 2]
            cx, cy, cz = ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx
            area3.append(0.5 * math.sqrt(cx * cx + cy * cy + cz * cz))
        states.append({"sub": sub, "start": list(uv), "U": list(uv), "prev": list(uv), "edges": edges, "rest": rest,
                       "w": w, "chords": chords, "n": len(uv) // 2, "omega": 1.0, "last_move": math.inf,
                       "area3": area3, "diverged": False})
    groups: dict[str, list[tuple[int, int]]] = {}
    for p, st in enumerate(states):
        for ci, c in enumerate(st["chords"]):
            groups.setdefault(c["pair"], []).append((p, ci))
    shared = [(pair, members) for pair, members in groups.items() if len({m[0] for m in members}) > 1]
    chord_len = [[0.0] * len(st["chords"]) for st in states]
    chord_target = [[c["rest"] for c in st["chords"]] for st in states]
    chord_weight = [[ws] * len(st["chords"]) for st in states]
    for _, members in shared:
        for p, ci in members:
            chord_weight[p][ci] = ws + wcpl

    def point(st, f, b):
        F, U = st["sub"]["faces"], st["U"]
        i, j, k = F[f * 3], F[f * 3 + 1], F[f * 3 + 2]
        return (b[0] * U[i * 2] + b[1] * U[j * 2] + b[2] * U[k * 2],
                b[0] * U[i * 2 + 1] + b[1] * U[j * 2 + 1] + b[2] * U[k * 2 + 1])

    max_iterations, tol = solver["max_iterations"], solver["convergence_m"]
    iterations, converged = 0, False
    while iterations < max_iterations:
        for p, st in enumerate(states):
            for ci, c in enumerate(st["chords"]):
                pa, pb = point(st, c["fa"], c["ba"]), point(st, c["fb"], c["bb"])
                dx, dy = pa[0] - pb[0], pa[1] - pb[1]
                chord_len[p][ci] = sqrt(dx * dx + dy * dy)
        for _, members in shared:
            mean = 0.0
            for p, ci in members:
                mean += chord_len[p][ci]
            mean /= len(members)
            for p, ci in members:
                chord_target[p][ci] = (ws * states[p]["chords"][ci]["rest"] + wcpl * mean) / (ws + wcpl)
        max_move = 0.0
        for p, st in enumerate(states):
            U, edges, rest, w, n = st["U"], st["edges"], st["rest"], st["w"], st["n"]
            F = st["sub"]["faces"]
            ea, eb = edges["a"], edges["b"]
            acc = [0.0] * (n * 2)
            cw = [0.0] * n
            for e in range(len(ea)):
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
            for ci, c in enumerate(st["chords"]):
                pa, pb = point(st, c["fa"], c["ba"]), point(st, c["fb"], c["bb"])
                dx, dy = pa[0] - pb[0], pa[1] - pb[1]
                ln = sqrt(dx * dx + dy * dy)
                if ln < 1e-12:
                    ln = 1e-12
                gap = ln - chord_target[p][ci]
                ba, bb = c["ba"], c["bb"]
                denom = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2] + bb[0] * bb[0] + bb[1] * bb[1] + bb[2] * bb[2]
                s = gap / denom / ln
                wc = chord_weight[p][ci]
                fa, fb = c["fa"], c["fb"]
                for k in range(3):
                    v, b = F[fa * 3 + k], ba[k]
                    acc[v * 2] -= wc * b * b * s * dx
                    acc[v * 2 + 1] -= wc * b * b * s * dy
                    cw[v] += wc * b
                for k in range(3):
                    v, b = F[fb * 3 + k], bb[k]
                    acc[v * 2] += wc * b * b * s * dx
                    acc[v * 2 + 1] += wc * b * b * s * dy
                    cw[v] += wc * b
            # orientation: a face whose flat signed area has fallen below a fraction
            # of its 3D area is folding; push it back along the (linear) area gradient
            area3 = st["area3"]
            for f in range(0, len(F), 3):
                a, b, c = F[f], F[f + 1], F[f + 2]
                ax, ay, bx, by, cx, cy = U[a * 2], U[a * 2 + 1], U[b * 2], U[b * 2 + 1], U[c * 2], U[c * 2 + 1]
                area2 = 0.5 * ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay))
                floor = fold_fraction * area3[f // 3]
                if area2 >= floor:
                    continue
                gap = area2 - floor
                gax, gay = 0.5 * (by - cy), 0.5 * (cx - bx)
                gbx, gby = 0.5 * (cy - ay), 0.5 * (ax - cx)
                gcx, gcy = 0.5 * (ay - by), 0.5 * (bx - ax)
                gg = gax * gax + gay * gay + gbx * gbx + gby * gby + gcx * gcx + gcy * gcy
                if gg < 1e-30:
                    continue
                lam = gap / gg
                acc[a * 2] -= ws * lam * gax
                acc[a * 2 + 1] -= ws * lam * gay
                cw[a] += ws
                acc[b * 2] -= ws * lam * gbx
                acc[b * 2 + 1] -= ws * lam * gby
                cw[b] += ws
                acc[c * 2] -= ws * lam * gcx
                acc[c * 2 + 1] -= ws * lam * gcy
                cw[c] += ws
            move = [0.0] * (n * 2)
            for i in range(n):
                cwi = cw[i]
                if cwi <= 0:
                    continue
                move[i * 2] = acc[i * 2] / cwi
                move[i * 2 + 1] = acc[i * 2 + 1] / cwi
            mx = my = gx = gy = 0.0
            for i in range(n):
                mx += move[i * 2]
                my += move[i * 2 + 1]
                gx += U[i * 2]
                gy += U[i * 2 + 1]
            mx, my, gx, gy = mx / n, my / n, gx / n, gy / n
            cross = rr = 0.0
            for i in range(n):
                rx, ry = U[i * 2] - gx, U[i * 2 + 1] - gy
                cross += rx * (move[i * 2 + 1] - my) - ry * (move[i * 2] - mx)
                rr += rx * rx + ry * ry
            omega_rot = cross / rr if rr > 0 else 0.0
            for i in range(n):
                rx, ry = U[i * 2] - gx, U[i * 2 + 1] - gy
                move[i * 2] -= mx - omega_rot * ry
                move[i * 2 + 1] -= my + omega_rot * rx
            if rho <= 0 or iterations - sweep_base < delay:
                omega = 1.0
            elif iterations - sweep_base == delay:
                omega = 2 / (2 - rho * rho)
            else:
                omega = 4 / (4 - rho * rho * st["omega"])
            prev = st["prev"]
            for i in range(n * 2):
                xk = U[i]
                xnew = omega * (gamma * move[i] + xk - prev[i]) + prev[i]
                prev[i] = xk
                U[i] = xnew
            piece_move = 0.0
            for i in range(n):
                dx, dy = U[i * 2] - prev[i * 2], U[i * 2 + 1] - prev[i * 2 + 1]
                mv = sqrt(dx * dx + dy * dy)
                if mv > piece_move:
                    piece_move = mv
            st["omega"] = omega
            st["last_move"] = piece_move
            if not math.isfinite(piece_move) or piece_move > 0.05:
                st["diverged"] = True
            if piece_move > max_move:
                max_move = piece_move
        iterations += 1
        if any(st["diverged"] for st in states):
            if not ladder:
                break
            rho = ladder.pop(0)
            restarts += 1
            sweep_base = iterations
            for st in states:
                st["U"] = list(st["start"])
                st["prev"] = list(st["start"])
                st["omega"] = 1.0
                st["last_move"] = math.inf
                st["diverged"] = False
            continue
        if max_move < tol:
            converged = True
            break
    return {"diverged": any(st["diverged"] for st in states), "restarts": restarts, "rho_used": rho,
            "pieces": [{"uv": st["U"]} for st in states],
            "shared": [{"pair": pair, "members": members} for pair, members in shared],
            "iterations": iterations, "converged": converged}


def flatten_patch(sub, solver: dict = DEFAULT_SOLVER, chords=None) -> dict:
    out = relax_pieces([{"sub": sub, "uv": hinge_unfold(sub), "chords": chords}], solver)
    return {"uv": out["pieces"][0]["uv"], "iterations": out["iterations"], "converged": out["converged"],
            "diverged": out["diverged"], "restarts": out["restarts"]}


def flatten_pieces(pieces, solver: dict = DEFAULT_SOLVER) -> dict:
    return relax_pieces([{"sub": p["sub"], "uv": hinge_unfold(p["sub"]), "chords": p.get("chords")} for p in pieces], solver)


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


def boundary_components(sub) -> int:
    """Connected components of the boundary edge graph (robust to pinches)."""
    edges = edge_list(sub["faces"])
    parent: dict[int, int] = {}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b, c in zip(edges["a"], edges["b"], edges["count"]):
        if c != 1:
            continue
        parent.setdefault(a, a)
        parent.setdefault(b, b)
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    return len({find(v) for v in parent})


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
    nv, ne, nfc = len(P) // 3, len(edges["a"]), len(F) // 3
    return {
        "vertex_count": nv, "face_count": nfc, "edge_count": ne,
        "euler_characteristic": nv - ne + nfc,
        "boundary_loop_count": boundary_components(sub),
        "boundary_length_3d_m": b3, "boundary_length_flat_m": b2, "boundary_error_m": b2 - b3,
        "worst_boundary_edge_error_m": worst_b,
        "interior_rms_error_m": math.sqrt(sum_sq_i / n_i) if n_i else 0.0,
        "interior_rms_pct": 100 * math.sqrt(sum_sq_pct_i / n_i) if n_i else 0.0,
        "interior_max_pct": 100 * max_pct_i,
        "area_3d_m2": area3, "area_flat_m2": area2,
        "area_error_pct": 100 * (area2 - area3) / area3 if area3 else 0.0,
        "triangle_flips": flips,
    }


def chord_report(chords, sub, uv, pairs=None) -> dict:
    F = sub["faces"]

    def flat_len(c):
        i, j, k = F[c["fa"] * 3], F[c["fa"] * 3 + 1], F[c["fa"] * 3 + 2]
        l, m, n = F[c["fb"] * 3], F[c["fb"] * 3 + 1], F[c["fb"] * 3 + 2]
        ba, bb = c["ba"], c["bb"]
        ax = ba[0] * uv[i * 2] + ba[1] * uv[j * 2] + ba[2] * uv[k * 2]
        ay = ba[0] * uv[i * 2 + 1] + ba[1] * uv[j * 2 + 1] + ba[2] * uv[k * 2 + 1]
        bx = bb[0] * uv[l * 2] + bb[1] * uv[m * 2] + bb[2] * uv[n * 2]
        by = bb[0] * uv[l * 2 + 1] + bb[1] * uv[m * 2 + 1] + bb[2] * uv[n * 2 + 1]
        dx, dy = ax - bx, ay - by
        return math.sqrt(dx * dx + dy * dy)

    l3 = l2 = worst = s3 = s2 = 0.0
    sn = 0
    for c in chords:
        f = flat_len(c)
        l3 += c["rest"]
        l2 += f
        if abs(f - c["rest"]) > worst:
            worst = abs(f - c["rest"])
        if pairs is not None and c["pair"] in pairs:
            s3 += c["rest"]
            s2 += f
            sn += 1
    out = {"chord_count": len(chords), "seam_length_3d_m": l3, "seam_length_flat_m": l2,
           "seam_error_m": l2 - l3, "worst_chord_error_m": worst}
    if pairs is not None:
        out.update({"shared_chord_count": sn, "shared_length_3d_m": s3, "shared_length_flat_m": s2})
    return out


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
    return {"asset_sha": asset_sha, "registry": registry, "mesh": mesh, "grid": grid,
            "closest": lambda p: closest_on_mesh(grid, p), "landmarks": landmarks}


def tangent_frame(normal):
    nx, ny, nz = normal
    ax, ay, az = (1.0, 0.0, 0.0) if abs(nx) < 0.9 else (0.0, 1.0, 0.0)
    ux, uy, uz = ny * az - nz * ay, nz * ax - nx * az, nx * ay - ny * ax
    ul = math.sqrt(ux * ux + uy * uy + uz * uz)
    ux, uy, uz = ux / ul, uy / ul, uz / ul
    return (ux, uy, uz), (ny * uz - nz * uy, nz * ux - nx * uz, nx * uy - ny * ux)


def loop_around(closest, seed, radius: float, count: int):
    u, v = tangent_frame(closest(seed)["normal"])
    points = []
    for k in range(count):
        th = 2 * math.pi * k / count
        c, s = math.cos(th) * radius, math.sin(th) * radius
        q = closest((seed[0] + c * u[0] + s * v[0], seed[1] + c * u[1] + s * v[1], seed[2] + c * u[2] + s * v[2]))
        points.append(tuple(q["point"]))
    return points


def seam_through(closest, A, via, B, spacing: float = 0.008):
    out = []
    for S, E in ((A, via), (via, B)):
        dx, dy, dz = E[0] - S[0], E[1] - S[1], E[2] - S[2]
        steps = max(1, math.ceil(math.sqrt(dx * dx + dy * dy + dz * dz) / spacing))
        for k in range(1, steps):
            t = k / steps
            out.append(tuple(closest((S[0] + dx * t, S[1] + dy * t, S[2] + dz * t))["point"]))
        if E is via:
            out.append(tuple(closest(via)["point"]))
    return out


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
        sub = submesh(ctx["mesh"], patch["faces"])
        chords = loop_chords(patch["samples"], sub)
        if "error" in chords:
            return {"error": chords["error"]}
        return {"sub": sub, "seed": seed, "patch": patch, "chords": chords["chords"]}
    if spec["type"] == "avatar_panels":
        n = spec["loop_points"]
        if n % 2:
            return {"error": "loop_points must be even"}
        outer = loop_around(ctx["closest"], seed, spec["radius_m"], n)
        seam = seam_through(ctx["closest"], outer[0], seed, outer[n // 2])
        loop_a = outer[:n // 2 + 1] + list(reversed(seam))
        loop_b = outer[n // 2:] + [outer[0]] + seam
        _, v = tangent_frame(ctx["closest"](seed)["normal"])
        off = 0.5 * spec["radius_m"]
        seed_a = tuple(ctx["closest"]((seed[0] + off * v[0], seed[1] + off * v[1], seed[2] + off * v[2]))["point"])
        seed_b = tuple(ctx["closest"]((seed[0] - off * v[0], seed[1] - off * v[1], seed[2] - off * v[2]))["point"])
        pieces = []
        for name, loop, piece_seed in (("panel_a", loop_a, seed_a), ("panel_b", loop_b, seed_b)):
            patch = extract_patch(ctx["mesh"], ctx["closest"], loop, piece_seed)
            if "error" in patch:
                return {"error": f"{name}: {patch['error']}"}
            sub = submesh(ctx["mesh"], patch["faces"])
            chords = loop_chords(patch["samples"], sub)
            if "error" in chords:
                return {"error": f"{name}: {chords['error']}"}
            pieces.append({"name": name, "sub": sub, "patch": patch, "chords": chords["chords"], "seed": piece_seed})
        return {"pieces": pieces, "seed": seed, "seam_points": len(seam)}
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
        if "pieces" in built:
            run = flatten_pieces(built["pieces"], solver)
            pairs = {g["pair"] for g in run["shared"]}
            row = {"id": spec["id"], "iterations": run["iterations"], "converged": run["converged"],
                   "diverged": run["diverged"], "restarts": run["restarts"],
                   "shared_chord_groups": len(run["shared"]), "pieces": []}
            for piece, flat in zip(built["pieces"], run["pieces"]):
                row["pieces"].append({"name": piece["name"], "stats": patch_stats(piece["sub"], flat["uv"]),
                                      "chords": chord_report(piece["chords"], piece["sub"], flat["uv"], pairs),
                                      "uv": flat["uv"]})
            results.append(row)
            continue
        sub = built["sub"]
        run = flatten_patch(sub, solver, built.get("chords"))
        row = {"id": spec["id"], "iterations": run["iterations"], "converged": run["converged"],
               "diverged": run["diverged"], "restarts": run["restarts"],
               "stats": patch_stats(sub, run["uv"]), "uv": run["uv"]}
        if "chords" in built:
            row["chords"] = chord_report(built["chords"], sub, run["uv"])
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
