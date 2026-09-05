#!/usr/bin/env python3
"""The flattening solver — port of scripts/flatten_solver.mjs.

Hinge-unfolding start, then the seam-exact Jacobi relaxation with fold-over
guard, rigid-drift removal and Chebyshev acceleration. Every arithmetic step is
mirrored from the JavaScript in the same order: the parity gate compares the two
layouts to a micrometre."""

from __future__ import annotations

import math

from flatten_mesh import edge_list, edge_lengths, edge_face_map



DEFAULT_SOLVER = {"interior_weight": 0.25, "seam_weight": 1.0, "couple_weight": 4.0, "max_iterations": 10000,
                  "convergence_m": 5e-9, "chebyshev_rho": 0.999, "chebyshev_gamma": 0.75, "chebyshev_delay": 10,
                  "rho_fallback": [0.99, 0.9, 0], "fold_min_area_fraction": 0.25}


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
    edge_faces = edge_face_map(F)
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
    relaxPieces in flatten_solver.mjs for the constraint set."""
    states = [_piece_state(piece, solver) for piece in pieces]
    shared = _shared_chord_groups(states)
    targets = [[c["rest"] for c in st["chords"]] for st in states]
    weights = [[solver["seam_weight"]] * len(st["chords"]) for st in states]
    for _, members in shared:
        for p, ci in members:
            weights[p][ci] = solver["seam_weight"] + solver["couple_weight"]

    rho = solver.get("chebyshev_rho", 0.0)
    gamma = solver.get("chebyshev_gamma", 1.0)
    delay = solver.get("chebyshev_delay", 0)
    ladder = [r for r in solver.get("rho_fallback", []) if r < rho]
    restarts, sweep_base = 0, 0
    max_iterations, tol = solver["max_iterations"], solver["convergence_m"]
    iterations, converged = 0, False
    while iterations < max_iterations:
        _couple_shared_chords(states, shared, targets, solver)
        max_move = 0.0
        for p, st in enumerate(states):
            acc, cw = _sweep_constraints(st, targets[p], weights[p], solver)
            move = _jacobi_move(st, acc, cw)
            _remove_rigid_drift(st, move)
            piece_move = _chebyshev_step(st, move, rho, gamma, delay, iterations - sweep_base)
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
                _restart_piece(st)
            continue
        if max_move < tol:
            converged = True
            break
    return {"diverged": any(st["diverged"] for st in states), "restarts": restarts, "rho_used": rho,
            "pieces": [{"uv": st["U"]} for st in states],
            "shared": [{"pair": pair, "members": members} for pair, members in shared],
            "iterations": iterations, "converged": converged}


def _piece_state(piece, solver):
    sub, uv = piece["sub"], piece["uv"]
    chords = piece.get("chords") or []
    edges = edge_list(sub["faces"])
    rest = edge_lengths(sub["positions"], edges)
    has_loop = len(chords) > 0
    ws, wi = solver["seam_weight"], solver["interior_weight"]
    w = [ws if (c == 1 and not has_loop) else wi for c in edges["count"]]
    P, F = sub["positions"], sub["faces"]
    area3 = []
    for f in range(0, len(F), 3):
        i, j, k = F[f] * 3, F[f + 1] * 3, F[f + 2] * 3
        ax, ay, az = P[j] - P[i], P[j + 1] - P[i + 1], P[j + 2] - P[i + 2]
        bx, by, bz = P[k] - P[i], P[k + 1] - P[i + 1], P[k + 2] - P[i + 2]
        cx, cy, cz = ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx
        area3.append(0.5 * math.sqrt(cx * cx + cy * cy + cz * cz))
    return {"sub": sub, "start": list(uv), "U": list(uv), "prev": list(uv), "edges": edges, "rest": rest,
            "w": w, "chords": chords, "n": len(uv) // 2, "omega": 1.0, "area3": area3, "diverged": False}


def _restart_piece(st):
    st["U"] = list(st["start"])
    st["prev"] = list(st["start"])
    st["omega"] = 1.0
    st["diverged"] = False


def _shared_chord_groups(states):
    groups: dict[str, list[tuple[int, int]]] = {}
    for p, st in enumerate(states):
        for ci, c in enumerate(st["chords"]):
            groups.setdefault(c["pair"], []).append((p, ci))
    return [(pair, members) for pair, members in groups.items() if len({m[0] for m in members}) > 1]


def _chord_point(st, f, b):
    F, U = st["sub"]["faces"], st["U"]
    i, j, k = F[f * 3], F[f * 3 + 1], F[f * 3 + 2]
    return (b[0] * U[i * 2] + b[1] * U[j * 2] + b[2] * U[k * 2],
            b[0] * U[i * 2 + 1] + b[1] * U[j * 2 + 1] + b[2] * U[k * 2 + 1])


def _couple_shared_chords(states, shared, targets, solver):
    if not shared:
        return
    ws, wcpl = solver["seam_weight"], solver["couple_weight"]
    lengths = []
    for st in states:
        row = []
        for c in st["chords"]:
            pa, pb = _chord_point(st, c["fa"], c["ba"]), _chord_point(st, c["fb"], c["bb"])
            dx, dy = pa[0] - pb[0], pa[1] - pb[1]
            row.append(math.sqrt(dx * dx + dy * dy))
        lengths.append(row)
    for _, members in shared:
        mean = 0.0
        for p, ci in members:
            mean += lengths[p][ci]
        mean /= len(members)
        for p, ci in members:
            targets[p][ci] = (ws * states[p]["chords"][ci]["rest"] + wcpl * mean) / (ws + wcpl)


def _sweep_constraints(st, targets, weights, solver):
    sqrt = math.sqrt
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
        pa, pb = _chord_point(st, c["fa"], c["ba"]), _chord_point(st, c["fb"], c["bb"])
        dx, dy = pa[0] - pb[0], pa[1] - pb[1]
        ln = sqrt(dx * dx + dy * dy)
        if ln < 1e-12:
            ln = 1e-12
        gap = ln - targets[ci]
        ba, bb = c["ba"], c["bb"]
        denom = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2] + bb[0] * bb[0] + bb[1] * bb[1] + bb[2] * bb[2]
        s = gap / denom / ln
        wc = weights[ci]
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
    fold_fraction = solver.get("fold_min_area_fraction", 0.0)
    ws = solver["seam_weight"]
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
    return acc, cw


def _jacobi_move(st, acc, cw):
    n = st["n"]
    move = [0.0] * (n * 2)
    for i in range(n):
        cwi = cw[i]
        if cwi <= 0:
            continue
        move[i * 2] = acc[i * 2] / cwi
        move[i * 2 + 1] = acc[i * 2 + 1] / cwi
    return move


def _remove_rigid_drift(st, move):
    U, n = st["U"], st["n"]
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


def _chebyshev_step(st, move, rho, gamma, delay, sweep):
    U, prev, n = st["U"], st["prev"], st["n"]
    if rho <= 0 or sweep < delay:
        omega = 1.0
    elif sweep == delay:
        omega = 2 / (2 - rho * rho)
    else:
        omega = 4 / (4 - rho * rho * st["omega"])
    for i in range(n * 2):
        xk = U[i]
        xnew = omega * (gamma * move[i] + xk - prev[i]) + prev[i]
        prev[i] = xk
        U[i] = xnew
    piece_move = 0.0
    sqrt = math.sqrt
    for i in range(n):
        dx, dy = U[i * 2] - prev[i * 2], U[i * 2 + 1] - prev[i * 2 + 1]
        mv = sqrt(dx * dx + dy * dy)
        if mv > piece_move:
            piece_move = mv
    st["omega"] = omega
    return piece_move


def flatten_patch(sub, solver: dict = DEFAULT_SOLVER, chords=None) -> dict:
    out = relax_pieces([{"sub": sub, "uv": hinge_unfold(sub), "chords": chords}], solver)
    return {"uv": out["pieces"][0]["uv"], "iterations": out["iterations"], "converged": out["converged"],
            "diverged": out["diverged"], "restarts": out["restarts"]}


def flatten_pieces(pieces, solver: dict = DEFAULT_SOLVER) -> dict:
    return relax_pieces([{"sub": p["sub"], "uv": hinge_unfold(p["sub"]), "chords": p.get("chords")} for p in pieces], solver)


# ----------------------------------------------------------------- reporting
