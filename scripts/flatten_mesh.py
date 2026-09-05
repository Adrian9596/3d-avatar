#!/usr/bin/env python3
"""Mesh topology for the flattening engine — port of scripts/flatten_mesh.mjs.

Welding, edges, face adjacency, edge-graph geodesics, sub-meshes, boundary
structure. Standard library only, like every project-side validator."""

from __future__ import annotations

import math
import heapq



DEFAULT_WELD_QUANTUM = 1e-6


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


def edge_lengths(P, edges):
    out = []
    for i, j in zip(edges["a"], edges["b"]):
        i3, j3 = i * 3, j * 3
        dx, dy, dz = P[i3] - P[j3], P[i3 + 1] - P[j3 + 1], P[i3 + 2] - P[j3 + 2]
        out.append(math.sqrt(dx * dx + dy * dy + dz * dz))
    return out


# ------------------------------------------------------------- patch selection


def edge_face_map(F):
    edge_faces: dict[int, list[int]] = {}
    for f in range(len(F) // 3):
        for k in range(3):
            i, j = F[f * 3 + k], F[f * 3 + (k + 1) % 3]
            key = (i if i < j else j) * 16777216 + (j if i < j else i)
            edge_faces.setdefault(key, []).append(f)
    return edge_faces


def edge_geodesic(mesh, source: int) -> list[float]:
    n = len(mesh["positions"]) // 3
    edges = edge_list(mesh["faces"])
    lengths = edge_lengths(mesh["positions"], edges)
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
