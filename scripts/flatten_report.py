#!/usr/bin/env python3
"""Evidence about a flattened piece — port of scripts/flatten_report.mjs."""

from __future__ import annotations

import math

from flatten_mesh import edge_list, edge_lengths, boundary_components



def patch_stats(sub, uv) -> dict:
    P, F = sub["positions"], sub["faces"]
    edges = edge_list(F)
    rest = edge_lengths(P, edges)
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
