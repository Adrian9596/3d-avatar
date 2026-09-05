#!/usr/bin/env python3
"""Authority measurement pass for the avatar, writing SHA-pinned evidence.

Reads contracts/measurement-registry.json, measures the exported GLB, and writes
qa/avatar_master/measurements.json.

Two deliberate design choices:

* It measures the **GLB**, not the .blend, and needs no Blender. The GLB is what
  the viewer loads, so the authority pass and the live pass measure the same
  triangles, and this runs anywhere including CI.
* It is an **independent re-implementation** of the JavaScript engine in
  scripts/measure_core.mjs. That is the point: scripts/test_measurement_parity.mjs
  asserts the two agree inside the registry's tolerance, so a mistake in either
  one becomes a build failure instead of a plausible-looking number.

Girth is the perimeter of the convex hull of a horizontal section, because a
tape bridges concavities rather than sinking into them. Exit codes: 0 measured,
1 a gate failed, 2 the asset or registry is missing.
"""

from __future__ import annotations

import hashlib
import json
import math
import struct
import sys
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import surface_path as sp  # noqa: E402
import cup_volume as cvol  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "contracts" / "measurement-registry.json"
REPORT_PATH = ROOT / "qa" / "avatar_master" / "measurements.json"
OVERRIDE_PATH = ROOT / "qa" / "avatar_master" / "landmarks.manual.json"

COMPONENT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
COMPONENT_SIZE = {"b": 1, "B": 1, "h": 2, "H": 2, "I": 4, "f": 4}
TYPE_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --------------------------------------------------------------------------- GLB


def read_glb(path: Path) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    if raw[:4] != b"glTF":
        raise ValueError(f"{path} is not a GLB")
    gltf: dict | None = None
    binary = b""
    offset = 12
    while offset < len(raw):
        length, kind = struct.unpack_from("<II", raw, offset)
        chunk = raw[offset + 8 : offset + 8 + length]
        if kind == 0x4E4F534A:
            gltf = json.loads(chunk)
        elif kind == 0x004E4942:
            binary = chunk
        offset += 8 + length
    if gltf is None:
        raise ValueError(f"{path} has no JSON chunk")
    return gltf, binary


def read_accessor(gltf: dict, binary: bytes, index: int) -> list[tuple[float, ...]]:
    accessor = gltf["accessors"][index]
    fmt = COMPONENT[accessor["componentType"]]
    per_item = TYPE_COUNT[accessor["type"]]
    item_size = COMPONENT_SIZE[fmt] * per_item
    view = gltf["bufferViews"][accessor["bufferView"]]
    base = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride") or item_size
    out = []
    for i in range(accessor["count"]):
        start = base + i * stride
        out.append(struct.unpack_from("<" + fmt * per_item, binary, start))
    return out


def node_matrix(node: dict) -> list[float] | None:
    """Column-major 4x4 for a node, or None when it is the identity."""
    if "matrix" in node:
        return list(node["matrix"])
    if not any(k in node for k in ("translation", "rotation", "scale")):
        return None
    tx, ty, tz = node.get("translation", (0.0, 0.0, 0.0))
    qx, qy, qz, qw = node.get("rotation", (0.0, 0.0, 0.0, 1.0))
    sx, sy, sz = node.get("scale", (1.0, 1.0, 1.0))
    r = [
        1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw),
        2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw),
        2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy),
    ]
    return [
        r[0] * sx, r[1] * sx, r[2] * sx, 0.0,
        r[3] * sy, r[4] * sy, r[5] * sy, 0.0,
        r[6] * sz, r[7] * sz, r[8] * sz, 0.0,
        tx, ty, tz, 1.0,
    ]


def apply_matrix(m: list[float] | None, p: tuple[float, float, float]) -> tuple[float, float, float]:
    if m is None:
        return p
    x, y, z = p
    return (
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    )


def multiply(a: list[float] | None, b: list[float] | None) -> list[float] | None:
    if a is None:
        return b
    if b is None:
        return a
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
    return out


def triangles_by_material(path: Path) -> tuple[dict[str, list[float]], dict]:
    """World-space triangles keyed by material name, 9 floats per triangle."""
    gltf, binary = read_glb(path)
    materials = [m.get("name", f"material_{i}") for i, m in enumerate(gltf.get("materials", []))]
    out: dict[str, list[float]] = {}

    def walk(node_index: int, parent: list[float] | None) -> None:
        node = gltf["nodes"][node_index]
        world = multiply(parent, node_matrix(node))
        if "mesh" in node:
            for primitive in gltf["meshes"][node["mesh"]]["primitives"]:
                name = materials[primitive["material"]] if "material" in primitive else "default"
                positions = read_accessor(gltf, binary, primitive["attributes"]["POSITION"])
                if "indices" in primitive:
                    order = [i[0] for i in read_accessor(gltf, binary, primitive["indices"])]
                else:
                    order = range(len(positions))
                bucket = out.setdefault(name, [])
                for i in order:
                    x, y, z = apply_matrix(world, positions[i])
                    bucket.extend((x, y, z))
        for child in node.get("children", []):
            walk(child, world)

    scene = gltf.get("scene", 0)
    for node_index in gltf["scenes"][scene].get("nodes", []):
        walk(node_index, None)
    return out, gltf


# ------------------------------------------------------------------- measurement


def section_segments(tri: list[float], y: float) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Intersect triangles with the horizontal plane at y -> (x, z) segments."""
    segments = []
    for t in range(0, len(tri), 9):
        ay, by, cy = tri[t + 1], tri[t + 4], tri[t + 7]
        if (ay < y and by < y and cy < y) or (ay > y and by > y and cy > y):
            continue
        hits = []
        for e in range(3):
            i = t + e * 3
            j = t + ((e + 1) % 3) * 3
            d0 = tri[i + 1] - y
            d1 = tri[j + 1] - y
            if (d0 > 0) != (d1 > 0):
                s = d0 / (d0 - d1)
                hits.append((tri[i] + (tri[j] - tri[i]) * s, tri[i + 2] + (tri[j + 2] - tri[i + 2]) * s))
        if len(hits) == 2:
            segments.append((hits[0], hits[1]))
    return segments


def convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    unique = sorted({(round(p[0], 6), round(p[1], 6)): p for p in points}.values())
    if len(unique) < 3:
        return unique

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def build(sequence):
        stack: list[tuple[float, float]] = []
        for p in sequence:
            while len(stack) >= 2 and cross(stack[-2], stack[-1], p) <= 0:
                stack.pop()
            stack.append(p)
        stack.pop()
        return stack

    return build(unique) + build(list(reversed(unique)))


def ring_perimeter(ring: list[tuple[float, float]]) -> float:
    return sum(math.dist(ring[i], ring[(i + 1) % len(ring)]) for i in range(len(ring)))


def contour_length(segments) -> float:
    return sum(math.dist(a, b) for a, b in segments)


def measure_section(tri: list[float], y: float) -> dict | None:
    segments = section_segments(tri, y)
    if len(segments) < 4:
        return None
    points = [p for segment in segments for p in segment]
    ring = convex_hull(points)
    if len(ring) < 3:
        return None
    front = max(p[1] for p in points)
    left = [p for p in points if p[0] < 0]
    right = [p for p in points if p[0] >= 0]
    front_left = max(left, key=lambda p: p[1]) if left else None
    front_right = max(right, key=lambda p: p[1]) if right else None
    return {
        "y": y,
        "girth": ring_perimeter(ring),
        "contour": contour_length(segments),
        "front": front,
        "front_left": front_left,
        "front_right": front_right,
    }


def scan_surface(tri: list[float], scan: dict) -> list[dict]:
    out = []
    steps = int((scan["to_m"] - scan["from_m"]) / scan["step_m"] + 1e-9)
    for i in range(steps + 1):
        y = scan["from_m"] + i * scan["step_m"]
        section = measure_section(tri, y)
        if section:
            out.append(section)
    return out


def pick(sections, lo, hi, key, mode):
    best = None
    for section in sections:
        if section["y"] < lo - 1e-9 or section["y"] > hi + 1e-9:
            continue
        value = section[key]
        if value is None:
            continue
        if isinstance(value, tuple):
            value = value[1]
        current = best[key] if best else None
        if isinstance(current, tuple):
            current = current[1]
        if best is None or (value > current if mode == "max" else value < current):
            best = section
    return best


def find_landmarks(sections: list[dict], search_from: float) -> dict | None:
    if not sections:
        return None
    apex_l = pick(sections, -math.inf, math.inf, "front_left", "max")
    apex_r = pick(sections, -math.inf, math.inf, "front_right", "max")
    if not apex_l or not apex_r:
        return None
    bust_level = (apex_l["y"] + apex_r["y"]) / 2
    fold = pick(sections, search_from, min(apex_l["y"], apex_r["y"]) - 0.02, "front", "min")
    waist = pick(sections, search_from, fold["y"] - 0.02, "girth", "min") if fold else None
    max_girth = pick(sections, -math.inf, math.inf, "girth", "max")
    return {
        "apex_l": {"x": apex_l["front_left"][0], "y": apex_l["y"], "z": apex_l["front_left"][1]},
        "apex_r": {"x": apex_r["front_right"][0], "y": apex_r["y"], "z": apex_r["front_right"][1]},
        "bust_level": bust_level,
        "fold": {"y": fold["y"]} if fold else None,
        "waist": {"y": waist["y"]} if waist else None,
        "max_girth": {"y": max_girth["y"]} if max_girth else None,
    }


# Which POMs depend on which landmarks, so a hand-placed point can be traced to
# the numbers it changed. Mirrors POM_LANDMARKS in scripts/measure_core.mjs.
POM_LANDMARKS = {
    "BODY_WAIST_GIRTH": ["WAIST_LEVEL"],
    "BODY_UNDERBUST_GIRTH": ["UNDERBUST_FOLD"],
    "BODY_BUST_GIRTH": ["BUST_LEVEL"],
    "BODY_BUST_POINT_HEIGHT": ["BUST_LEVEL"],
    "BODY_APEX_TO_APEX": ["BUST_APEX_L", "BUST_APEX_R"],
    "DIAG_MAX_TORSO_GIRTH": [],
    "BODY_UNDERBUST_TO_APEX_L": ["UNDERBUST_FOLD", "BUST_APEX_L"],
    "BODY_UNDERBUST_TO_APEX_R": ["UNDERBUST_FOLD", "BUST_APEX_R"],
    "BODY_HPS_TO_APEX_L": ["HPS_L", "BUST_APEX_L"],
    "BODY_HPS_TO_APEX_R": ["HPS_R", "BUST_APEX_R"],
    "BREAST_ROOT_ARC_L": ["ROOT_INNER_L", "ROOT_OUTER_L", "UNDERBUST_FOLD"],
    "BREAST_ROOT_ARC_R": ["ROOT_INNER_R", "ROOT_OUTER_R", "UNDERBUST_FOLD"],
    "BODY_BAND_FRONT_L": ["UNDERBUST_FOLD", "CF_UNDERBUST", "SIDE_UNDERBUST_L"],
    "BODY_BAND_FRONT_R": ["UNDERBUST_FOLD", "CF_UNDERBUST", "SIDE_UNDERBUST_R"],
    "BODY_UNDERARM_TO_FOLD_L": ["UNDERARM_L", "SIDE_UNDERBUST_L"],
    "BODY_UNDERARM_TO_FOLD_R": ["UNDERARM_R", "SIDE_UNDERBUST_R"],
}


def manual_source(spec: dict | None) -> str:
    """`manual`, or `manual_mirrored` when the point was accepted as the mirror of the other
    side. Both count as manual for every purpose except the provenance string."""
    return "manual_mirrored" if isinstance(spec, dict) and spec.get("source") == "manual_mirrored" else "manual"


def is_manual(source: str | None) -> bool:
    return source in ("manual", "manual_mirrored")


def apply_overrides(marks: dict, overrides: dict | None) -> tuple[dict, dict]:
    """Hand-placed landmarks win over the automatic detection.

    The override file is an INPUT to this pass, not a viewer-only nicety: a
    landmark corrected in the viewer must produce corrected evidence here.
    Provenance is per landmark so the report can say exactly what a person moved.
    """
    source = {k: "auto" for k in
              ("BUST_APEX_L", "BUST_APEX_R", "BUST_LEVEL", "UNDERBUST_FOLD", "WAIST_LEVEL")}
    if not marks or not overrides:
        return marks, source
    given = overrides.get("landmarks") or {}

    for key, mark_key in (("BUST_APEX_L", "apex_l"), ("BUST_APEX_R", "apex_r")):
        spec = given.get(key)
        if spec and isinstance(spec.get("xyz_m"), list) and len(spec["xyz_m"]) == 3:
            x, y, z = spec["xyz_m"]
            marks[mark_key] = {"x": float(x), "y": float(y), "z": float(z)}
            source[key] = manual_source(spec)
    if is_manual(source["BUST_APEX_L"]) or is_manual(source["BUST_APEX_R"]):
        marks["bust_level"] = (marks["apex_l"]["y"] + marks["apex_r"]["y"]) / 2
        source["BUST_LEVEL"] = "derived_from_manual"

    level = given.get("BUST_LEVEL")
    if level and isinstance(level.get("y_m"), (int, float)):
        marks["bust_level"] = float(level["y_m"])
        source["BUST_LEVEL"] = manual_source(level)
    fold = given.get("UNDERBUST_FOLD")
    if fold and isinstance(fold.get("y_m"), (int, float)):
        marks["fold"] = {"y": float(fold["y_m"])}
        source["UNDERBUST_FOLD"] = manual_source(fold)
    waist = given.get("WAIST_LEVEL")
    if waist and isinstance(waist.get("y_m"), (int, float)):
        marks["waist"] = {"y": float(waist["y_m"])}
        source["WAIST_LEVEL"] = manual_source(waist)
    return marks, source


def apply_hps_overrides(hps: dict, overrides: dict | None, source: dict) -> dict:
    given = (overrides or {}).get("landmarks") or {}
    for key, mark_key in (("HPS_L", "hps_l"), ("HPS_R", "hps_r")):
        source.setdefault(key, "auto")
        spec = given.get(key)
        if spec and isinstance(spec.get("xyz_m"), list) and len(spec["xyz_m"]) == 3:
            x, y, z = spec["xyz_m"]
            hps[mark_key] = {"x": float(x), "y": float(y), "z": float(z)}
            source[key] = manual_source(spec)
    return hps


def placements(overrides: dict | None) -> dict:
    """How each hand-placed point was placed (camera distance, incidence, footprint), by id."""
    out = {}
    for key, spec in ((overrides or {}).get("landmarks") or {}).items():
        if isinstance(spec, dict) and isinstance(spec.get("placed_with"), dict):
            out[key] = spec["placed_with"]
    return out


def with_placement(block: dict, source: dict, placement: dict, manual_points: dict, rules: dict) -> dict:
    """Every landmark row says how it was placed when a person placed it, and every
    hand-placed point that has no row of its own (the roots) gets one."""
    for key, row in block.items():
        if key in placement:
            row["placed_with"] = placement[key]
    for key, point in manual_points.items():
        if key in block:
            continue
        block[key] = {"xyz_m": _xyz(point), "source": source.get(key, "manual"),
                      "rule": rules.get(key, {}).get("rule", "manual_only")}
        if key in placement:
            block[key]["placed_with"] = placement[key]
    return block


def _xyz(point):
    return None if not point else [round(point["x"], 4), round(point["y"], 4), round(point["z"], 4)]


def pom_provenance(pom_id: str, source: dict) -> str:
    inputs = POM_LANDMARKS.get(pom_id, [])
    if not inputs:
        return "auto"
    if any(is_manual(source.get(i)) for i in inputs):
        return "manual"
    if any(source.get(i) == "derived_from_manual" for i in inputs):
        return "derived_from_manual"
    return "auto"


def compute_poms(tri, sections, marks) -> dict[str, dict]:
    grid = {round(s["y"], 9): s for s in sections}

    def at(y):
        section = grid.get(round(y, 9)) or measure_section(tri, y)
        return section

    out: dict[str, dict] = {}
    if marks["waist"]:
        s = at(marks["waist"]["y"])
        if s:
            out["BODY_WAIST_GIRTH"] = {"value": s["girth"], "at_y": s["y"], "contour": s["contour"]}
    if marks["fold"]:
        s = at(marks["fold"]["y"])
        if s:
            out["BODY_UNDERBUST_GIRTH"] = {"value": s["girth"], "at_y": s["y"], "contour": s["contour"]}
    s = at(marks["bust_level"])
    if s:
        out["BODY_BUST_GIRTH"] = {"value": s["girth"], "at_y": s["y"], "contour": s["contour"]}
    out["BODY_BUST_POINT_HEIGHT"] = {"value": marks["bust_level"], "at_y": marks["bust_level"]}
    if marks["max_girth"]:
        s = at(marks["max_girth"]["y"])
        if s:
            out["DIAG_MAX_TORSO_GIRTH"] = {"value": s["girth"], "at_y": s["y"], "contour": s["contour"]}
    a, b = marks["apex_l"], marks["apex_r"]
    out["BODY_APEX_TO_APEX"] = {
        "value": math.dist((a["x"], a["y"], a["z"]), (b["x"], b["y"], b["z"])),
        "at_y": (a["y"] + b["y"]) / 2,
    }
    return out


# HPS is MANUAL ONLY on this asset; there is no find_hps here on purpose. An
# automatic "highest point outboard of the neck" rule returned whatever sat on
# its own inner cutoff (35mm -> y=1593.1mm, 45mm -> 1589.2mm, 90mm -> 1534.9mm),
# so the answer came from a parameter rather than from the body. See the registry
# entry for HPS_L.


def find_armholes(tri: list[float]) -> dict:
    """Underarm points, from the torso's open armhole boundaries.

    Of the four boundary loops the highest is the neck and the lowest is the
    waist; the two that remain are the armholes, and the lowest point of each is
    the underarm. Threshold-free by construction — the contrast with the HPS rule
    that was rejected for reading back its own cutoff.
    """
    index: dict[tuple, int] = {}
    points: list[tuple] = []
    faces: list[tuple] = []
    for t in range(0, len(tri), 9):
        face = []
        for v in range(3):
            p = (tri[t + v * 3], tri[t + v * 3 + 1], tri[t + v * 3 + 2])
            key = (round(p[0] * 1e5), round(p[1] * 1e5), round(p[2] * 1e5))
            if key not in index:
                index[key] = len(points)
                points.append(p)
            face.append(index[key])
        if len(set(face)) == 3:
            faces.append(tuple(face))
    counts: dict[tuple, int] = {}
    for a, b, c in faces:
        for u, v in ((a, b), (b, c), (c, a)):
            counts[(min(u, v), max(u, v))] = counts.get((min(u, v), max(u, v)), 0) + 1
    adjacency: dict[int, list[int]] = {}
    for (u, v), count in counts.items():
        if count != 1:
            continue
        adjacency.setdefault(u, []).append(v)
        adjacency.setdefault(v, []).append(u)
    seen: set[int] = set()
    loops: list[list[int]] = []
    for start in adjacency:
        if start in seen:
            continue
        component: list[int] = []
        stack = [start]
        while stack:
            node = stack.pop()
            if node in seen:
                continue
            seen.add(node)
            component.append(node)
            stack.extend(n for n in adjacency[node] if n not in seen)
        loops.append(component)
    if len(loops) != 4:
        return {"armhole_l": None, "armhole_r": None, "loops": len(loops)}
    described = [{
        "loop": loop,
        "y": sum(points[i][1] for i in loop) / len(loop),
        "x": sum(points[i][0] for i in loop) / len(loop),
    } for loop in loops]
    described.sort(key=lambda e: e["y"])
    middle = described[1:3]                    # neither the waist nor the neck

    def lowest(entry):
        best = min(entry["loop"], key=lambda i: points[i][1])
        return {"x": points[best][0], "y": points[best][1], "z": points[best][2]}

    left = next((e for e in middle if e["x"] < 0), None)
    right = next((e for e in middle if e["x"] >= 0), None)
    return {"armhole_l": lowest(left) if left else None,
            "armhole_r": lowest(right) if right else None,
            "loops": len(loops)}


def find_fold_landmarks(tri: list[float], fold_y: float) -> dict:
    """Gore point, band closure at centre back, and the side points where the
    wire ends — all read off the underbust fold section."""
    points = [p for seg in section_segments(tri, fold_y) for p in seg]
    if not points:
        return {}
    centre_x = min(abs(x) for x, _ in points)
    band = centre_x + 1e-4
    centre = [(x, z) for x, z in points if abs(x) <= band]
    cf = max(centre, key=lambda p: p[1]) if centre else None
    cb = min(centre, key=lambda p: p[1]) if centre else None
    left = [p for p in points if p[0] < 0]
    right = [p for p in points if p[0] >= 0]
    side_l = min(left, key=lambda p: p[0]) if left else None
    side_r = max(right, key=lambda p: p[0]) if right else None
    make = lambda p: ({"x": p[0], "y": fold_y, "z": p[1]} if p else None)  # noqa: E731
    return {"cf_underbust": make(cf), "cb_underbust": make(cb),
            "side_l": make(side_l), "side_r": make(side_r)}


def section_arc(tri, y, start, goal):
    """Arc length along a horizontal section between two points on it.

    A band follows the underbust line, so the section's own arc is the right
    model; a free shortest path would cut a chord across it.
    """
    segments = section_segments(tri, y)
    if not segments or not start or not goal:
        return None
    key = lambda p: (round(p[0] * 1e5), round(p[1] * 1e5))  # noqa: E731
    coords: dict[tuple, tuple] = {}
    edges: dict[tuple, list[tuple]] = {}
    for a, b in segments:
        ka, kb = key(a), key(b)
        coords.setdefault(ka, a)
        coords.setdefault(kb, b)
        w = math.dist(a, b)
        if w <= 0:
            continue
        edges.setdefault(ka, []).append((kb, w))
        edges.setdefault(kb, []).append((ka, w))
    if not coords:
        return None
    src = min(coords, key=lambda k: (coords[k][0] - start["x"]) ** 2 + (coords[k][1] - start["z"]) ** 2)
    dst = min(coords, key=lambda k: (coords[k][0] - goal["x"]) ** 2 + (coords[k][1] - goal["z"]) ** 2)
    if src == dst:
        return None
    import heapq
    dist = {src: 0.0}
    prev: dict[tuple, tuple] = {}
    done: set[tuple] = set()
    queue = [(0.0, src)]
    while queue:
        d, current = heapq.heappop(queue)
        if current in done:
            continue
        done.add(current)
        if current == dst:
            break
        for to, w in edges.get(current, ()):
            if to in done:
                continue
            if d + w < dist.get(to, math.inf):
                dist[to] = d + w
                prev[to] = current
                heapq.heappush(queue, (d + w, to))
    if dst not in dist:
        return None
    path = []
    node = dst
    while node is not None:
        path.append((coords[node][0], y, coords[node][1]))
        node = prev.get(node)
    path.reverse()
    return {"value": dist[dst], "points": path}


def section_point_near_x(tri, y, target_x, band=0.01):
    """The point on a section directly below an apex: same side, nearest in x,
    front-most among those, so a run starts where a tape would be laid."""
    points = [p for seg in section_segments(tri, y) for p in seg]
    if not points:
        return None
    best = None
    best_score = math.inf
    for x, z in points:
        if (x < 0) != (target_x < 0) and abs(x) > 1e-6:
            continue
        dx = abs(x - target_x)
        score = -z if dx < band else dx + 1000
        if score < best_score:
            best_score = score
            best = {"x": x, "y": y, "z": z}
    return best


def compute_surface_poms(grid, tri, marks, hps, manual=None, fold_marks=None, armholes=None) -> dict[str, dict]:
    """POMs measured along the surface rather than around a section, using the
    one path model so they stay comparable with a line drafted by the pen."""
    out: dict[str, dict] = {}
    manual = manual or {}
    fold_marks = fold_marks or {}
    armholes = armholes or {}
    if not marks:
        return out

    def run(a, b):
        if not a or not b:
            return None
        result = sp.surface_run(grid, (a["x"], a["y"], a["z"]), (b["x"], b["y"], b["z"]))
        return {"value": result["length"], "on_surface": result["on_surface"],
                "points": result["points"]}

    if marks.get("fold"):
        for pom_id, apex in (("BODY_UNDERBUST_TO_APEX_L", marks["apex_l"]),
                             ("BODY_UNDERBUST_TO_APEX_R", marks["apex_r"])):
            foot = section_point_near_x(tri, marks["fold"]["y"], apex["x"])
            result = run(foot, apex)
            if result:
                result["at_y"] = (marks["fold"]["y"] + apex["y"]) / 2
                out[pom_id] = result

    # band front along the underbust line, and wing height up to the armhole
    if marks.get("fold"):
        for side in ("L", "R"):
            side_point = fold_marks.get("side_l" if side == "L" else "side_r")
            cf = fold_marks.get("cf_underbust")
            if cf and side_point:
                arc = section_arc(tri, marks["fold"]["y"], cf, side_point)
                if arc:
                    out[f"BODY_BAND_FRONT_{side}"] = {"value": arc["value"], "on_surface": True,
                                                      "points": arc["points"], "at_y": marks["fold"]["y"]}
            armpit = armholes.get("armhole_l" if side == "L" else "armhole_r")
            if armpit and side_point:
                result = run(armpit, side_point)
                if result:
                    result["at_y"] = (armpit["y"] + side_point["y"]) / 2
                    out[f"BODY_UNDERARM_TO_FOLD_{side}"] = result

    # Breast root arc: inner end -> bottom -> outer end. Bottom is derived; the
    # two ends are hand-placed, because where a wire sits there is a TD decision.
    if marks.get("fold"):
        for side in ("L", "R"):
            apex = marks["apex_l"] if side == "L" else marks["apex_r"]
            inner = manual.get(f"ROOT_INNER_{side}")
            outer = manual.get(f"ROOT_OUTER_{side}")
            if not inner or not outer:
                continue
            bottom = manual.get(f"ROOT_BOTTOM_{side}") or section_point_near_x(
                tri, marks["fold"]["y"], apex["x"])
            if not bottom:
                continue
            first, second = run(inner, bottom), run(bottom, outer)
            if not first or not second:
                continue
            out[f"BREAST_ROOT_ARC_{side}"] = {
                "value": first["value"] + second["value"],
                "on_surface": first["on_surface"] and second["on_surface"],
                "points": first["points"] + second["points"][1:],
                "at_y": bottom["y"],
            }

    # Cup volume, inside the CLOSED root loop. The loop is four surface runs —
    # inner -> bottom -> outer -> top -> inner — and the volume comes from the
    # closed-surface divergence integral, which handles an overhanging mound
    # exactly where the earlier projection method was ~7% light on one.
    if marks.get("fold"):
        for side in ("L", "R"):
            apex = marks["apex_l"] if side == "L" else marks["apex_r"]
            inner = manual.get(f"ROOT_INNER_{side}")
            outer = manual.get(f"ROOT_OUTER_{side}")
            top = manual.get(f"ROOT_TOP_{side}")
            if not (inner and outer and top):
                continue
            bottom = manual.get(f"ROOT_BOTTOM_{side}") or section_point_near_x(
                tri, marks["fold"]["y"], apex["x"])
            if not bottom:
                continue
            legs = []
            ok = True
            for a, b in ((inner, bottom), (bottom, outer), (outer, top), (top, inner)):
                leg = run(a, b)
                if not leg:
                    ok = False
                    break
                legs.append(leg)
            if not ok:
                continue
            ring = []
            for leg in legs:
                ring.extend(leg["points"][:-1])
            result = cvol.enclosed_volume_closed(
                tri, ring, (apex["x"], apex["y"], apex["z"]))
            if result.get("volume_m3") is not None:
                out[f"CUP_VOLUME_{side}"] = {
                    "value": result["volume_m3"], "unit": "ml",
                    "on_surface": True, "at_y": apex["y"],
                    "diagnostics": {k: result[k] for k in
                                    ("patch_faces", "boundary_ring_vertices", "rim_gap_mean_mm",
                                     "rim_gap_max_mm", "watertight", "degenerate_faces_dropped")
                                    if k in result},
                }
            else:
                out[f"CUP_VOLUME_{side}"] = {"value": None, "unit": "ml",
                                             "refused": result.get("reason")}

    for pom_id, start, apex in (("BODY_HPS_TO_APEX_L", hps.get("hps_l"), marks["apex_l"]),
                                ("BODY_HPS_TO_APEX_R", hps.get("hps_r"), marks["apex_r"])):
        result = run(start, apex)
        if result:
            result["at_y"] = (start["y"] + apex["y"]) / 2
            out[pom_id] = result
    return out


# Pairs that should mirror each other on a symmetric body. A difference here is
# either a real asymmetry in the avatar or a landmark placed carelessly on one
# side; either way it is worth surfacing rather than averaging away.
ASYMMETRY_PAIRS = [
    ("BODY_UNDERBUST_TO_APEX_L", "BODY_UNDERBUST_TO_APEX_R", "cup depth"),
    ("BODY_HPS_TO_APEX_L", "BODY_HPS_TO_APEX_R", "HPS to apex"),
    ("BREAST_ROOT_ARC_L", "BREAST_ROOT_ARC_R", "breast root arc"),
]
ASYMMETRY_FLAG_MM = 5.0


def build_asymmetry(computed: dict, marks: dict | None, flag_mm: float = ASYMMETRY_FLAG_MM) -> dict:
    rows = []
    for left_id, right_id, label in ASYMMETRY_PAIRS:
        left, right = computed.get(left_id), computed.get(right_id)
        if not left or not right:
            continue
        delta = (left["value"] - right["value"]) * 1000
        rows.append({
            "pair": label,
            "left_id": left_id, "right_id": right_id,
            "left_mm": round(left["value"] * 1000, 1),
            "right_mm": round(right["value"] * 1000, 1),
            "delta_mm": round(delta, 1),
            "flagged": abs(delta) > flag_mm,
        })
    if marks:
        a, b = marks.get("apex_l"), marks.get("apex_r")
        if a and b:
            rows.append({
                "pair": "bust apex, mirrored",
                "left_id": "BUST_APEX_L", "right_id": "BUST_APEX_R",
                "span_delta_mm": round((abs(a["x"]) - abs(b["x"])) * 1000, 1),
                "height_delta_mm": round((a["y"] - b["y"]) * 1000, 1),
                "projection_delta_mm": round((a["z"] - b["z"]) * 1000, 1),
                "flagged": max(abs(abs(a["x"]) - abs(b["x"])),
                               abs(a["y"] - b["y"]),
                               abs(a["z"] - b["z"])) * 1000 > flag_mm,
            })
    return {
        "flag_threshold_mm": flag_mm,
        "any_flagged": any(r["flagged"] for r in rows),
        "pairs": rows,
        "note": ("A flagged pair is not automatically a defect: it can be a real asymmetry in the "
                 "body or a landmark placed carelessly on one side. It is reported so a person "
                 "decides, rather than being averaged away."),
    }


def inch_fraction(metres: float, denominator: int = 8) -> str:
    inches = metres * 100 / 2.54
    whole = math.floor(inches)
    numerator = round((inches - whole) * denominator)
    if numerator == 0:
        return f'{whole}"'
    if numerator == denominator:
        return f'{whole + 1}"'
    reduced = Fraction(numerator, denominator)
    return f'{whole} {reduced.numerator}/{reduced.denominator}"'


def calibrate(spec: dict) -> dict:
    """Slice a cylinder of exactly known girth to prove the sectioning maths."""
    radius = spec["cylinder_radius_m"]
    facets = spec["cylinder_facets"]
    ring = [
        (radius * math.cos(2 * math.pi * i / facets), radius * math.sin(2 * math.pi * i / facets))
        for i in range(facets)
    ]
    tri: list[float] = []
    for i in range(facets):
        x0, z0 = ring[i]
        x1, z1 = ring[(i + 1) % facets]
        # y is the cylinder axis so the horizontal sectioning code applies
        tri.extend((x0, 0.0, z0, x1, 0.0, z1, x1, 1.0, z1))
        tri.extend((x0, 0.0, z0, x1, 1.0, z1, x0, 1.0, z0))
    section = measure_section(tri, 0.5)
    truth = 2 * math.pi * radius
    measured = section["girth"] if section else 0.0
    return {
        "cylinder_true_mm": round(truth * 1000, 3),
        "cylinder_measured_mm": round(measured * 1000, 3),
        "error_mm": round((measured - truth) * 1000, 3),
        "facets": facets,
        "note": "Expected error is the inscribed-polygon error, not a defect.",
    }


# ---------------------------------------------------------------------- reporting


def main() -> int:
    if not REGISTRY_PATH.exists():
        print(f"BLOCKED: missing {REGISTRY_PATH.relative_to(ROOT)}", file=sys.stderr)
        return 2
    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    asset = ROOT / registry["asset"]
    if not asset.exists():
        print(f"BLOCKED: missing {registry['asset']}", file=sys.stderr)
        return 2

    buckets, gltf = triangles_by_material(asset)

    # The arm filter is only exact while the materials are still separate. If a
    # re-bake merges them this must fail loudly, not measure the wrong surface.
    failures: list[str] = []
    for role, name in registry["expected_materials"].items():
        if name not in buckets:
            failures.append(f"expected {role} material '{name}' is not in the asset")

    surface_names = registry["measurement_surface"]
    tri: list[float] = []
    for name in surface_names:
        tri.extend(buckets.get(name, []))
    if not tri:
        failures.append(f"measurement surface {surface_names} produced no geometry")

    calibration = calibrate(registry["calibration"])
    if abs(calibration["error_mm"]) > registry["calibration"]["max_error_mm"]:
        failures.append(
            f"calibration error {calibration['error_mm']}mm exceeds "
            f"{registry['calibration']['max_error_mm']}mm"
        )

    # Hand-placed landmarks, if any. A file recorded against a different asset is
    # a failure, not something to apply quietly to the wrong body.
    overrides = None
    override_meta: dict[str, object] = {"file": None, "applied": False}
    asset_sha = sha256(asset)
    if OVERRIDE_PATH.exists():
        overrides = json.loads(OVERRIDE_PATH.read_text(encoding="utf-8"))
        override_meta = {
            "file": str(OVERRIDE_PATH.relative_to(ROOT)),
            "sha256": sha256(OVERRIDE_PATH),
            "recorded_at": overrides.get("recorded_at"),
            "author": overrides.get("author"),
            "asset_sha256": overrides.get("asset_sha256"),
            "applied": True,
        }
        if overrides.get("asset_sha256") and overrides["asset_sha256"] != asset_sha:
            failures.append(
                "landmarks.manual.json was recorded against asset "
                f"{str(overrides['asset_sha256'])[:12]}… but the asset on disk is "
                f"{asset_sha[:12]}… — re-place the landmarks or delete the override file"
            )
            overrides = None
            override_meta["applied"] = False

    landmark_rules = {item["id"]: item for item in registry["landmarks"]}
    search_from = landmark_rules.get("UNDERBUST_FOLD", {}).get("search_from_m", 1.10)

    sections = scan_surface(tri, registry["scan"]) if tri else []
    marks = find_landmarks(sections, search_from) if sections else None
    if marks is None:
        failures.append("landmark detection found no bust apex; cannot measure")
    marks, landmark_source = apply_overrides(marks, overrides)

    precision = registry["reporting"]["precision_mm"]
    denominator = registry["reporting"]["inch_denominator"]
    computed = compute_poms(tri, sections, marks) if marks else {}

    # surface-path POMs need the nearest-surface grid; build it once
    hps = apply_hps_overrides({}, overrides, landmark_source)
    # every other hand-placed point, keyed by landmark id
    manual_points: dict[str, dict] = {}
    for key, spec in ((overrides or {}).get("landmarks") or {}).items():
        if isinstance(spec, dict) and isinstance(spec.get("xyz_m"), list) and len(spec["xyz_m"]) == 3:
            x, y, z = spec["xyz_m"]
            manual_points[key] = {"x": float(x), "y": float(y), "z": float(z)}
            landmark_source.setdefault(key, manual_source(spec))
    landmark_placement = placements(overrides)
    fold_marks = find_fold_landmarks(tri, marks["fold"]["y"]) if (marks and marks.get("fold")) else {}
    armholes = find_armholes(tri) if tri else {}
    if armholes.get("loops") not in (None, 4):
        failures.append(f"the torso surface has {armholes['loops']} boundary loops, not the 4 expected "
                        "(neck, waist, two armholes), so the underarm landmarks cannot be identified")
    if marks and tri:
        grid = sp.build_grid(tri)
        computed.update(compute_surface_poms(grid, tri, marks, hps, manual_points, fold_marks, armholes))

    poms = []
    for spec in registry["poms"]:
        pom_id = spec["id"]
        status = spec["status"]
        row: dict[str, object] = {
            "id": pom_id,
            "label_en": spec.get("label_en"),
            "status": status,
            "method": spec.get("method"),
        }
        if status == "blocked":
            row["value_mm"] = None
            row["blocked_reason"] = spec["blocked_reason"]
            poms.append(row)
            continue
        if status == "planned":
            row["value_mm"] = None
            row["planned_phase"] = spec.get("planned_phase")
            poms.append(row)
            continue
        if status == "blocked_until_manual":
            needed = spec.get("unblocked_by", [])
            placed = bool(needed) and all(is_manual(landmark_source.get(i)) for i in needed)
            row["unblocked_by"] = needed
            if not placed:
                row["value_mm"] = None
                row["blocked_reason"] = spec["blocked_reason"]
                poms.append(row)
                continue
            # a person placed the landmark, so the POM is measurable and says so
            row["effective_status"] = "manual"
        result = computed.get(pom_id)
        if result is None:
            row["value_mm"] = None
            row["error"] = "declared measurable but the engine produced no value"
            failures.append(f"{pom_id} produced no value")
            poms.append(row)
            continue
        value = result["value"]
        if value is None:
            row["value_mm"] = None
            row["refused"] = result.get("refused")
            row["landmark_source"] = pom_provenance(pom_id, landmark_source)
            poms.append(row)
            continue
        if spec.get("unit") == "ml":
            # a volume is not a length; reporting it in mm would be nonsense
            row["value_ml"] = round(value * 1e6, 1)
            row["value_mm"] = None
            row["unit"] = "ml"
            if result.get("diagnostics"):
                row["diagnostics"] = result["diagnostics"]
            row["landmark_source"] = pom_provenance(pom_id, landmark_source)
            if status == "blocked_until_manual":
                row["effective_status"] = "manual"
            poms.append(row)
            continue
        row["value_mm"] = round(value * 1000, 1)
        row["value_cm"] = round(value * 100, 1)
        row["value_in"] = inch_fraction(value, denominator)
        row["at_y_m"] = round(result["at_y"], 4)
        if spec.get("tape_model") == "convex_hull" and "contour" in result:
            row["hull_vs_contour_mm"] = round((result["contour"] - value) * 1000, 1)
        if spec.get("tape_tension"):
            row["tape_tension"] = spec["tape_tension"]
        row["landmark_source"] = pom_provenance(pom_id, landmark_source)
        if status == "needs_review":
            row["review_reason"] = spec["review_reason"]
        poms.append(row)

    apex_l = marks["apex_l"] if marks else None
    apex_r = marks["apex_r"] if marks else None
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "asset": {
            "file": registry["asset"],
            "sha256": asset_sha,
            "unit": registry["axes"]["unit"],
            "up_axis": registry["axes"]["up"],
            "front_axis": registry["axes"]["front"],
            "generator": gltf.get("asset", {}).get("generator"),
        },
        "registry": {
            "file": str(REGISTRY_PATH.relative_to(ROOT)),
            "sha256": sha256(REGISTRY_PATH),
            "schema_version": registry["schema_version"],
        },
        "tool": {
            "script": "scripts/measure_avatar.py",
            "python": sys.version.split()[0],
            "implementation": "independent of scripts/measure_core.mjs by design",
        },
        "scan": registry["scan"],
        "reporting": {"precision_mm": precision, "inch_denominator": denominator},
        "calibration": calibration,
        "landmark_overrides": override_meta,
        "landmarks": with_placement(
            {
                "BUST_APEX_L": {
                    "xyz_m": [round(apex_l["x"], 4), round(apex_l["y"], 4), round(apex_l["z"], 4)],
                    "source": landmark_source["BUST_APEX_L"],
                    "rule": "max_forward_reach_side",
                },
                "BUST_APEX_R": {
                    "xyz_m": [round(apex_r["x"], 4), round(apex_r["y"], 4), round(apex_r["z"], 4)],
                    "source": landmark_source["BUST_APEX_R"],
                    "rule": "max_forward_reach_side",
                },
                "BUST_LEVEL": {
                    "y_m": round(marks["bust_level"], 4),
                    "source": landmark_source["BUST_LEVEL"],
                    "rule": "mean_height_of_apex_pair",
                },
                "UNDERBUST_FOLD": {
                    "y_m": round(marks["fold"]["y"], 4) if marks["fold"] else None,
                    "source": landmark_source["UNDERBUST_FOLD"],
                    "rule": "min_forward_reach_below_apex",
                },
                "CF_UNDERBUST": {"xyz_m": _xyz(fold_marks.get("cf_underbust")), "source": "auto",
                                 "rule": "fold_section_centre_front"},
                "CB_UNDERBUST": {"xyz_m": _xyz(fold_marks.get("cb_underbust")), "source": "auto",
                                 "rule": "fold_section_centre_back"},
                "SIDE_UNDERBUST_L": {"xyz_m": _xyz(fold_marks.get("side_l")), "source": "auto",
                                     "rule": "fold_section_extreme_x"},
                "SIDE_UNDERBUST_R": {"xyz_m": _xyz(fold_marks.get("side_r")), "source": "auto",
                                     "rule": "fold_section_extreme_x"},
                "UNDERARM_L": {"xyz_m": _xyz(armholes.get("armhole_l")), "source": "auto",
                               "rule": "armhole_boundary_lowest_point"},
                "UNDERARM_R": {"xyz_m": _xyz(armholes.get("armhole_r")), "source": "auto",
                               "rule": "armhole_boundary_lowest_point"},
                "HPS_L": {
                    "xyz_m": ([round(hps["hps_l"]["x"], 4), round(hps["hps_l"]["y"], 4),
                               round(hps["hps_l"]["z"], 4)] if hps.get("hps_l") else None),
                    "source": landmark_source.get("HPS_L", "auto"),
                    "rule": landmark_rules.get("HPS_L", {}).get("rule", "manual_only"),
                },
                "HPS_R": {
                    "xyz_m": ([round(hps["hps_r"]["x"], 4), round(hps["hps_r"]["y"], 4),
                               round(hps["hps_r"]["z"], 4)] if hps.get("hps_r") else None),
                    "source": landmark_source.get("HPS_R", "auto"),
                    "rule": landmark_rules.get("HPS_R", {}).get("rule", "manual_only"),
                },
                "WAIST_LEVEL": {
                    "y_m": round(marks["waist"]["y"], 4) if marks["waist"] else None,
                    "source": landmark_source["WAIST_LEVEL"],
                    "rule": "min_girth_below_fold",
                },
            }
            if marks
            else {},
            landmark_source, landmark_placement, manual_points, landmark_rules,
        ),
        "poms": poms,
        "asymmetry": build_asymmetry(computed, marks),
        "qc": {
            "measurement_surface": surface_names,
            "materials_present": sorted(buckets.keys()),
            "triangles_measured": len(tri) // 9,
            "sections_scanned": len(sections),
            "scan_step_mm": round(registry["scan"]["step_m"] * 1000, 1),
            "apex_forward_reach_delta_mm": (
                round(abs(apex_l["z"] - apex_r["z"]) * 1000, 1) if marks else None
            ),
            "apex_height_delta_mm": (
                round(abs(apex_l["y"] - apex_r["y"]) * 1000, 1) if marks else None
            ),
            "apex_span_symmetry_mm": (
                round((abs(apex_l["x"]) - abs(apex_r["x"])) * 1000, 1) if marks else None
            ),
        },
        "declared_limits": registry["declared_limits"],
        "decision": "FAIL" if failures else "MEASURED_NOT_APPROVED",
        "failures": failures,
    }

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    for row in poms:
        status = str(row.get("effective_status") or row["status"]).upper()
        if row.get("value_ml") is not None:
            print(f"{status:13} {row['id']:26} {row['value_ml']:>7} ml")
        elif row["value_mm"] is None:
            reason = (row.get("refused") or row.get("blocked_reason")
                      or row.get("planned_phase") or row.get("error") or "")
            print(f"{row['status'].upper():13} {row['id']:26} —   {str(reason)[:60]}")
        else:
            print(f"{status:13} {row['id']:26} {row['value_cm']:>7} cm  {row['value_in']:>10}")
    print(f"CALIBRATION   error {calibration['error_mm']:+.3f} mm")
    print(f"REPORT        {REPORT_PATH.relative_to(ROOT)}")
    if failures:
        for failure in failures:
            print(f"FAIL          {failure}", file=sys.stderr)
        return 1
    print("DECISION      MEASURED_NOT_APPROVED — mesh geometry only, no TD approval implied")
    return 0


if __name__ == "__main__":
    sys.exit(main())
