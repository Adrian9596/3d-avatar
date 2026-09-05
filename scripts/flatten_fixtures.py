#!/usr/bin/env python3
"""Test fixtures for the flattening gates — port of scripts/flatten_fixtures.mjs.

Both engines build the very same patches from scripts/flatten_cases.json."""

from __future__ import annotations

import math
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from measure_avatar import triangles_by_material  # noqa: E402
from surface_path import build_grid, closest_on_mesh  # noqa: E402
from flatten_mesh import weld, geodesic_disc, submesh  # noqa: E402
from flatten_patch import extract_patch, loop_chords, split_loop_by_seam, loop_centroid_seed  # noqa: E402



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
        piece_seed = loop_centroid_seed(ctx["closest"], loop)
        patch = extract_patch(ctx["mesh"], ctx["closest"], loop, piece_seed)
        if "error" in patch:
            return {"error": patch["error"]}
        sub = submesh(ctx["mesh"], patch["faces"])
        chords = loop_chords(patch["samples"], sub)
        if "error" in chords:
            return {"error": chords["error"]}
        return {"sub": sub, "seed": piece_seed, "patch": patch, "chords": chords["chords"]}
    if spec["type"] == "avatar_panels":
        n = spec["loop_points"]
        if n % 2:
            return {"error": "loop_points must be even"}
        outer = loop_around(ctx["closest"], seed, spec["radius_m"], n)
        seam = [outer[0]] + seam_through(ctx["closest"], outer[0], seed, outer[n // 2]) + [outer[n // 2]]
        split = split_loop_by_seam(outer, seam)
        if "error" in split:
            return {"error": split["error"]}
        pieces = []
        for i, loop in enumerate(split["loops"]):
            name = "panel_a" if i == 0 else "panel_b"
            piece_seed = loop_centroid_seed(ctx["closest"], loop)
            patch = extract_patch(ctx["mesh"], ctx["closest"], loop, piece_seed)
            if "error" in patch:
                return {"error": f"{name}: {patch['error']}"}
            sub = submesh(ctx["mesh"], patch["faces"])
            chords = loop_chords(patch["samples"], sub)
            if "error" in chords:
                return {"error": f"{name}: {chords['error']}"}
            pieces.append({"name": name, "sub": sub, "patch": patch, "chords": chords["chords"], "seed": piece_seed})
        return {"pieces": pieces, "seed": seed, "seam_points": len(seam) - 2}
    return {"error": f"unknown case type {spec['type']}"}
