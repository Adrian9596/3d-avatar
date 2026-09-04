#!/usr/bin/env python3
"""Gate on the cup-volume routine, against answers that are known exactly.

A volume is the easiest number in this whole stack to get confidently wrong, and
the hardest for a reader to sanity-check by eye, so it is checked against shapes
whose volume is arithmetic rather than against another implementation:

* a spherical cap of height h on a sphere of radius r -> (pi*h^2/3)*(3r - h),
  including a 120-degree cap that OVERHANGS its own boundary loop — the case the
  earlier projection method got 7% wrong and could not detect
* a flat disc -> zero volume, which catches a routine that counts area as volume

Each case also records what the superseded projection method would have said, so
the reason it was replaced stays visible rather than becoming folklore.

Exit codes: 0 all gates pass, 1 a gate failed.
"""

from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cup_volume import enclosed_volume, enclosed_volume_closed  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
REPORT_PATH = ROOT / "qa" / "avatar_master" / "cup-volume-test.json"
BUDGET_PCT = 1.0


def sphere_patch(radius: float, cap_angle: float, rings: int = 64, segments: int = 128):
    """Triangles of a spherical cap from the pole down to `cap_angle`, and the
    boundary loop at that angle. The cap sits above the z = radius*cos(angle) plane."""
    tri: list[float] = []

    def point(theta, phi):
        return (radius * math.sin(theta) * math.cos(phi),
                radius * math.sin(theta) * math.sin(phi),
                radius * math.cos(theta))

    for i in range(rings):
        t0 = cap_angle * i / rings
        t1 = cap_angle * (i + 1) / rings
        for j in range(segments):
            p0 = 2 * math.pi * j / segments
            p1 = 2 * math.pi * (j + 1) / segments
            a, b = point(t0, p0), point(t0, p1)
            c, d = point(t1, p1), point(t1, p0)
            if i == 0:
                # the pole ring is a fan of single triangles; emitting a quad
                # there welds two corners together and the degenerate face
                # breaks the watertight check for the wrong reason
                tri.extend(a + c + d)
            else:
                tri.extend(a + b + c)
                tri.extend(a + c + d)
    # the loop sits inside the mesh rim so it is a real boundary on the surface
    loop = [point(cap_angle * 0.94, 2 * math.pi * j / segments) for j in range(segments)]
    return tri, loop, cap_angle * 0.94


def flat_disc(radius: float, segments: int = 128):
    tri: list[float] = []
    for j in range(segments):
        p0 = 2 * math.pi * j / segments
        p1 = 2 * math.pi * (j + 1) / segments
        tri.extend((0.0, 0.0, 0.0,
                    radius * math.cos(p0), radius * math.sin(p0), 0.0,
                    radius * math.cos(p1), radius * math.sin(p1), 0.0))
    loop = [(radius * math.cos(2 * math.pi * j / segments),
             radius * math.sin(2 * math.pi * j / segments), 0.0) for j in range(segments)]
    return tri, loop


def main() -> int:
    checks = []

    def record(name, ok, detail):
        checks.append({"name": name, "status": "PASS" if ok else "FAIL", "detail": detail})

    cases = []
    radius = 0.075                       # 75mm, a plausible breast radius
    for label, angle in (
        ("hemisphere", math.pi / 2),
        ("shallow cap (60°)", math.pi / 3),
        # the case the projection method could not do: this cap bulges wider
        # than its own boundary loop
        ("deep cap (120°), overhanging", 2 * math.pi / 3),
    ):
        tri, loop, effective = sphere_patch(radius, angle)
        height = radius * (1 - math.cos(effective))
        analytic = (math.pi * height ** 2 / 3) * (3 * radius - height)

        closed = enclosed_volume_closed(tri, loop, (0.0, 0.0, radius))
        measured = closed["volume_m3"]
        error_pct = (measured - analytic) / analytic * 100 if measured is not None else None
        projected = enclosed_volume(tri, loop)["volume_m3"]
        projection_error = ((projected - analytic) / analytic * 100) if projected is not None else None
        cases.append({
            "case": label,
            "analytic_ml": round(analytic * 1e6, 3),
            "closed_surface_ml": None if measured is None else round(measured * 1e6, 3),
            "closed_surface_error_pct": None if error_pct is None else round(error_pct, 4),
            "projection_ml": None if projected is None else round(projected * 1e6, 3),
            "projection_error_pct": None if projection_error is None else round(projection_error, 4),
            "watertight": closed.get("watertight"),
            "rim_gap_mean_mm": closed.get("rim_gap_mean_mm"),
        })
        record(f"{label} matches the analytic cap volume",
               measured is not None and abs(error_pct) <= BUDGET_PCT and closed.get("watertight"),
               f"analytic {analytic * 1e6:.3f}ml vs closed-surface "
               f"{'—' if measured is None else f'{measured * 1e6:.3f}ml'}"
               f" — {'n/a' if error_pct is None else f'{error_pct:+.4f}%'}"
               f" (projection {'n/a' if projection_error is None else f'{projection_error:+.2f}%'})")

    # a flat patch encloses nothing; this catches a routine that sums area
    tri, loop = flat_disc(0.075)
    flat = enclosed_volume(tri, loop)
    flat_ml = None if flat["volume_m3"] is None else abs(flat["volume_m3"]) * 1e6
    record("a flat disc encloses no volume",
           flat_ml is None or flat_ml < 0.001,
           "no volume" if flat_ml is None else f"{flat_ml:.6f}ml")

    failures = [c for c in checks if c["status"] == "FAIL"]
    worst = max((abs(c["closed_surface_error_pct"]) for c in cases
                 if c.get("closed_surface_error_pct") is not None), default=0.0)
    worst_projection = max((abs(c["projection_error_pct"]) for c in cases
                            if c.get("projection_error_pct") is not None), default=0.0)
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "purpose": "Cup volume checked against spherical caps, whose volume is arithmetic.",
        "budget_pct": BUDGET_PCT,
        "method": "closed_surface_divergence",
        "worst_error_pct": round(worst, 4),
        "worst_error_pct_of_superseded_projection_method": round(worst_projection, 4),
        "cases": cases,
        "checks": checks,
        "decision": "FAIL" if failures else "CUP_VOLUME_OK",
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    for check in checks:
        print(f"{check['status']} {check['name']} — {check['detail']}")
    print(f"WORST  {worst:.4f}% against a {BUDGET_PCT}% budget (closed-surface divergence)")
    print(f"NOTE   the superseded projection method reaches {worst_projection:.2f}% on the same cases")
    print(f"REPORT {REPORT_PATH.relative_to(ROOT)}")
    if failures:
        print(f"FAIL   {len(failures)} check(s) failed", file=sys.stderr)
        return 1
    print("DECISION CUP_VOLUME_OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
