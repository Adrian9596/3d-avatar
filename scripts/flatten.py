#!/usr/bin/env python3
"""Flatten every case in scripts/flatten_cases.json and print the layouts as JSON.

This is the Python side of validate:flatten-parity. The engine itself lives in
flatten_mesh.py, flatten_patch.py, flatten_solver.py and flatten_report.py —
deliberate re-implementations of the JavaScript modules of the same names, kept
in step by the parity gate rather than by sharing code. Standard library only."""

from __future__ import annotations

import math
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from flatten_solver import DEFAULT_SOLVER, flatten_patch, flatten_pieces  # noqa: E402
from flatten_report import patch_stats, chord_report, map_loop_to_flat  # noqa: E402
from flatten_fixtures import load_avatar_context, resolve_case  # noqa: E402


ROOT = Path(__file__).resolve().parent.parent


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


if __name__ == "__main__":
    sys.exit(main())
