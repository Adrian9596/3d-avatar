#!/usr/bin/env python3
"""
Reads the house "how to measure" sheets and turns the marks drawn on them into
numbers, so the claim the levels contract makes about them is checkable instead
of remembered.

The three sheets (front, back, three-quarter) carry the same stack of horizontal
rings drawn on a reference figure. Thirteen of them have a red leader line ending
in a printed inch value; one is drawn in black and carries no label. The contract
says that black line is the 0 datum and that every printed value is a height
offset from it, in inches. That is an INTERPRETATION of an unlabelled line, and
this script is how the checkable half of it stays honest. Per sheet it measures

  * the y of every red leader (the author's own pointer at each labelled ring),
  * the least-squares fit of leader y against the printed inch values, and
  * where that fit puts v = 0, relative to the two leaders it falls between.

If the printed values really are inches from an unlabelled line, the fit's zero
crossing lands in the unlabelled gap — strictly between the +1/2in leader and the
-1in leader, which is the only place on the sheets where a ring is drawn without
a label. The residuals say how well the sheet itself holds a linear inch scale;
it is a draughted diagram, not a measuring instrument, and the gate budgets it
as such.

WHAT THIS SCRIPT DOES NOT DO: identify the black line from the pixels. Ink drawn
over skin anti-aliases to the same brown as the shadow under the breast, and
every rule that told the two apart on one sheet failed on another. That the
unlabelled ring at the fold is the underbust line is read off the drawing by a
person and declared in the contract's `datum` field; what is verified here is
that the printed scale puts its zero there and nowhere else.

Nothing here touches the avatar. The sheets are a different body; only the
protocol (which heights to look at, relative to which landmark) transfers, and
`contracts/measurement-levels.json` is where that transfer is declared.

Output: qa/avatar_master/measurement-levels-trace.json, pinned to each image's
sha256 so a swapped sheet fails the gate rather than quietly changing the answer.

Requires Pillow. Run it when a sheet changes; the gate reads its evidence.
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = ROOT / "contracts" / "measurement-levels.json"
REPORT = ROOT / "qa" / "avatar_master" / "measurement-levels-trace.json"

# A red leader must cross this much of the sheet to be a leader and not a glyph
# stroke; the shortest real one is ~150px, the longest digit stroke ~30px.
MIN_LEADER_RUN = 120


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def longest_run(flags, start=0, end=None):
    """(length, start) of the longest True run in flags[start:end]."""
    end = len(flags) if end is None else end
    best = cur = 0
    best_at = at = start
    for x in range(start, end):
        if flags[x]:
            if cur == 0:
                at = x
            cur += 1
            if cur > best:
                best, best_at = cur, at
        else:
            cur = 0
    return best, best_at


def group_rows(rows, gap=3):
    """Rows of the same drawn line, merged: [(centre_y, [rows])]."""
    groups = []
    for y in rows:
        if groups and y - groups[-1][-1] <= gap:
            groups[-1].append(y)
        else:
            groups.append([y])
    return [(sum(g) / len(g), g) for g in groups]


def trace_sheet(path: Path):
    from PIL import Image

    img = Image.open(path).convert("RGB")
    w, h = img.size
    px = img.load()

    # --- red leaders ---------------------------------------------------------
    leader_rows = []
    for y in range(h):
        red = [False] * w
        for x in range(w):
            r, g, b = px[x, y]
            red[x] = r > 140 and g < 90 and b < 90
        run, _ = longest_run(red)
        if run >= MIN_LEADER_RUN:
            leader_rows.append(y)
    leaders = [round(c, 2) for c, _ in group_rows(leader_rows)]

    return {"width": w, "height": h, "leaders_y_px": leaders}


def fit(values, ys):
    """Least squares y = intercept - slope * value. Returns px per inch, y at 0, residuals."""
    n = len(values)
    mv = sum(values) / n
    my = sum(ys) / n
    sxy = sum((v - mv) * (y - my) for v, y in zip(values, ys))
    sxx = sum((v - mv) ** 2 for v in values)
    m = sxy / sxx
    c = my - m * mv
    residuals = [y - (m * v + c) for v, y in zip(values, ys)]
    return {
        "px_per_inch": round(-m, 3),
        "y_px_at_zero": round(c, 2),
        "residual_px": [round(r, 2) for r in residuals],
        "worst_residual_in": round(max(abs(r) for r in residuals) / abs(m), 4),
    }


def main() -> int:
    contract = json.loads(CONTRACT.read_text())
    labelled = [lv for lv in contract["levels"] if lv["label_in"] is not None]
    values = [lv["offset_in"] for lv in labelled]
    if sorted(values, reverse=True) != values:
        print("BLOCKED: the contract's labelled levels are not ordered top to bottom", file=sys.stderr)
        return 2

    sheets = []
    for source in contract["source_sheets"]:
        path = ROOT / source["path"]
        if not path.exists():
            print(f"BLOCKED: missing {source['path']}", file=sys.stderr)
            return 2
        traced = trace_sheet(path)
        entry = {"path": source["path"], "view": source["view"], "sha256": sha256(path), **traced}
        if len(traced["leaders_y_px"]) != len(values):
            entry["fit"] = None
            entry["note"] = (
                f"{len(traced['leaders_y_px'])} leaders traced, the contract declares {len(values)} labelled levels"
            )
        else:
            f = fit(values, traced["leaders_y_px"])
            # Where the printed scale puts 0, named by the two labelled leaders
            # it falls between. The sheets leave exactly one ring unlabelled and
            # it is drawn in that gap; anywhere else and the reading is wrong.
            above_i = max(i for i, v in enumerate(values) if v > 0)
            below_i = min(i for i, v in enumerate(values) if v < 0)
            y_above = traced["leaders_y_px"][above_i]
            y_below = traced["leaders_y_px"][below_i]
            f["zero_falls_between"] = {
                "above": labelled[above_i]["label_in"],
                "below": labelled[below_i]["label_in"],
                "clear_of_above_in": round((f["y_px_at_zero"] - y_above) / f["px_per_inch"], 4),
                "clear_of_below_in": round((y_below - f["y_px_at_zero"]) / f["px_per_inch"], 4),
                "inside": y_above < f["y_px_at_zero"] < y_below,
            }
            entry["fit"] = f
        sheets.append(entry)

    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tool": "scripts/trace_measurement_levels.py",
        "purpose": (
            "What the how-to-measure sheets actually draw, measured from the pixels: one red leader per "
            "printed inch value, and the fit that says whether those values read as a linear inch scale "
            "with its zero in the sheets' one unlabelled gap."
        ),
        "contract": "contracts/measurement-levels.json",
        "contract_sha256": sha256(CONTRACT),
        "declared_values_in": values,
        "sheets": sheets,
        "reading": (
            "px_per_inch is the sheet's own scale; y_px_at_zero is where the fit puts the 0 line; "
            "zero_falls_between names the two labelled leaders it lands among and how far it clears each, "
            "in inches. Inside that gap is where the sheets draw their one unlabelled ring."
        ),
        "limits": [
            "The figure on these sheets is NOT this avatar. Only the protocol transfers.",
            "A leader's y is where the author pointed at a ring on a drawn sheet, not a measured height.",
            "The black 0 line is not detected here — ink over skin is the same brown as the shadow under "
            "the breast. Reading it as the underbust line is a person's, declared in the contract's datum field.",
        ],
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2) + "\n")

    for sheet in sheets:
        f = sheet["fit"]
        if not f:
            print(f"WARN  {sheet['view']}: {sheet['note']}")
            continue
        print(
            f"OK    {sheet['view']}: {len(sheet['leaders_y_px'])} leaders, {f['px_per_inch']} px/in, "
            f"worst residual {f['worst_residual_in']}in, 0 falls {f['zero_falls_between']['clear_of_above_in']}in "
            f"below {f['zero_falls_between']['above']} and {f['zero_falls_between']['clear_of_below_in']}in "
            f"above {f['zero_falls_between']['below']}"
        )
    print(f"REPORT {REPORT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
