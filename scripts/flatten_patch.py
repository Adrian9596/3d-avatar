#!/usr/bin/env python3
"""From a drawn loop to a patch — port of scripts/flatten_patch.mjs.

Sampling the loop onto the mesh, flood-filling its inside, chord constraints,
cutting an outline into two panels along a seam."""

from __future__ import annotations

import math

from flatten_mesh import edge_face_map



DEFAULT_LOOP_SPACING = 0.002


# ------------------------------------------------------------------ mesh build


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

    edge_faces = edge_face_map(F)
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


def loop_centroid_seed(closest, loop_points):
    x = y = z = 0.0
    for p in loop_points:
        x += p[0]
        y += p[1]
        z += p[2]
    n = len(loop_points)
    hit = closest((x / n, y / n, z / n))
    return tuple(hit["point"]) if hit else None


def split_loop_by_seam(loop_points, seam_points, snap_m: float = 0.015) -> dict:
    """Cut a closed outline into two panel loops along a seam whose ends lie on it.
    Port of splitLoopBySeam in flatten_core.mjs."""
    n = len(loop_points)
    if n < 3:
        return {"error": "outline needs at least 3 points"}
    if not seam_points or len(seam_points) < 2:
        return {"error": "seam needs at least 2 points"}

    def project(q):
        best = None
        for i in range(n):
            A, B = loop_points[i], loop_points[(i + 1) % n]
            dx, dy, dz = B[0] - A[0], B[1] - A[1], B[2] - A[2]
            ll = dx * dx + dy * dy + dz * dz
            t = ((q[0] - A[0]) * dx + (q[1] - A[1]) * dy + (q[2] - A[2]) * dz) / ll if ll > 0 else 0.0
            if t < 0:
                t = 0.0
            if t > 1:
                t = 1.0
            px = A[0] if t == 0 else B[0] if t == 1 else A[0] + dx * t
            py = A[1] if t == 0 else B[1] if t == 1 else A[1] + dy * t
            pz = A[2] if t == 0 else B[2] if t == 1 else A[2] + dz * t
            ex, ey, ez = q[0] - px, q[1] - py, q[2] - pz
            d = math.sqrt(ex * ex + ey * ey + ez * ez)
            if best is None or d < best["d"]:
                best = {"d": d, "i": i, "t": t, "point": (px, py, pz)}
        if best["t"] == 1:
            best["i"] = (best["i"] + 1) % n
            best["t"] = 0.0
        return best

    p1, p2 = project(seam_points[0]), project(seam_points[-1])
    if p1["d"] > snap_m or p2["d"] > snap_m:
        return {"error": f"seam end is {max(p1['d'], p2['d']) * 1000:.1f}mm from the outline (limit {snap_m * 1000}mm)"}

    def pos(p):
        return p["i"] + p["t"]

    if abs(pos(p1) - pos(p2)) < 1e-12:
        return {"error": "both seam ends land on the same outline point"}

    def forward(x, start):
        return ((x - start) % n + n) % n

    def between(a, b):
        out = []
        span = forward(pos(b), pos(a))
        for k in range(1, n):
            idx = (math.floor(pos(a)) + k) % n
            d = forward(idx, pos(a))
            if d >= span - 1e-12:
                break
            if d > 1e-12:
                out.append(loop_points[idx])
        return out

    interior = list(seam_points[1:-1])
    loop_a = [p1["point"]] + between(p1, p2) + [p2["point"]] + list(reversed(interior))
    loop_b = [p2["point"]] + between(p2, p1) + [p1["point"]] + interior
    return {"loops": [loop_a, loop_b], "split_points": [p1["point"], p2["point"]], "end_gaps_m": [p1["d"], p2["d"]]}


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
