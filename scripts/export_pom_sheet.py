#!/usr/bin/env python3
"""Build the factory-facing POM sheet from the recorded measurement evidence.

Reads qa/avatar_master/measurements.json and contracts/measurement-registry.json;
writes qa/avatar_master/pom-sheet.csv and pom-sheet.json.

Three rules shape this exporter:

* **It exports evidence, never live state.** The sheet is generated from the
  SHA-pinned authority pass, so a number on a sheet can always be traced back to
  the run that produced it. There is deliberately no second sheet generator in
  the viewer — one generator cannot disagree with itself.
* **A missing POM is stated, not omitted.** A sheet that quietly drops a
  measurement is worse than one that says why it is absent, so blocked, planned
  and awaiting-a-landmark POMs get their own section with reasons.
* **It refuses to invent a code.** Until the house POM code set is confirmed the
  registry's house_code is null, the sheet falls back to the internal id, and the
  header is stamped PROVISIONAL CODES.

Exit codes: 0 written, 1 a gate failed, 2 an input is missing.
"""

from __future__ import annotations

import csv
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "contracts" / "measurement-registry.json"
EVIDENCE_PATH = ROOT / "qa" / "avatar_master" / "measurements.json"
PLACEMENT_NOTE_MM_PX = 3   # AUTHORING_UX_PLAN.md §7.2; the same figure scripts/landmark_placement.mjs uses
CSV_PATH = ROOT / "qa" / "avatar_master" / "pom-sheet.csv"
JSON_PATH = ROOT / "qa" / "avatar_master" / "pom-sheet.json"

COLUMNS = [
    "POM code",
    "Internal id",
    "Point of measure",
    "Điểm đo",
    "cm",
    "inch",
    "ml",
    "Tol (mm)",
    "Method",
    "Tape",
    "Landmark source",
    "Status",
    "Notes",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    for required in (REGISTRY_PATH, EVIDENCE_PATH):
        if not required.exists():
            print(f"BLOCKED: missing {required.relative_to(ROOT)} — run `npm run measure:avatar` first",
                  file=sys.stderr)
            return 2

    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    evidence = json.loads(EVIDENCE_PATH.read_text(encoding="utf-8"))
    asset = ROOT / registry["asset"]

    failures: list[str] = []
    # A sheet built from evidence that no longer describes the asset on disk
    # would be a document that looks authoritative and is not.
    if asset.exists():
        actual = sha256(asset)
        if evidence.get("asset", {}).get("sha256") != actual:
            failures.append(
                f"evidence was written against asset {str(evidence.get('asset', {}).get('sha256'))[:12]}… "
                f"but the asset on disk is {actual[:12]}… — rerun `npm run measure:avatar`"
            )
    else:
        failures.append(f"missing {registry['asset']}")
    if evidence.get("registry", {}).get("sha256") != sha256(REGISTRY_PATH):
        failures.append("the registry changed after the evidence was written — rerun `npm run measure:avatar`")
    if evidence.get("failures"):
        failures.append("the authority pass reported failures: " + "; ".join(evidence["failures"]))

    specs = {spec["id"]: spec for spec in registry["poms"]}
    measured: list[dict] = []
    diagnostics: list[dict] = []
    absent: list[dict] = []
    provisional_codes = False

    for row in evidence["poms"]:
        spec = specs.get(row["id"], {})
        house = spec.get("house_code")
        if not house:
            provisional_codes = True
        status = row.get("effective_status") or row["status"]
        notes = " ".join(x for x in (row.get("review_reason"), row.get("blocked_reason"),
                                     spec.get("sensitivity"), spec.get("comment")) if x)
        record = {
            "POM code": house or row["id"],
            "Internal id": row["id"],
            "Point of measure": spec.get("label_en") or row.get("label_en") or "",
            "Điểm đo": spec.get("label_vi", ""),
            "cm": "" if row.get("value_cm") is None else f"{row['value_cm']:.1f}",
            "inch": row.get("value_in", ""),
            "ml": "" if row.get("value_ml") is None else f"{row['value_ml']:.1f}",
            "Tol (mm)": spec.get("tolerance_mm", ""),
            "Method": row.get("method", ""),
            "Tape": " / ".join(x for x in (spec.get("tape_model"), spec.get("tape_tension")) if x),
            "Landmark source": row.get("landmark_source", ""),
            "Status": status,
            "Notes": " ".join(str(notes).split()),
        }
        if row.get("value_mm") is None and row.get("value_ml") is None:
            record["Notes"] = record["Notes"] or "no value produced"
            absent.append(record)
        elif row["status"] == "diagnostic":
            diagnostics.append(record)
        else:
            measured.append(record)

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    header = [
        ("Sheet", "Avatar mesh measurements — NOT AN APPROVED MEASUREMENT RECORD"),
        ("Asset", evidence["asset"]["file"]),
        ("Asset SHA-256", evidence["asset"]["sha256"]),
        ("Registry SHA-256", evidence["registry"]["sha256"]),
        ("Measured at", evidence["generated_at"]),
        ("Sheet generated at", generated_at),
        ("Units", "cm to 0.1; inch as a reduced fraction to the nearest 1/"
                  f"{registry['reporting']['inch_denominator']}"),
        ("Codes", "PROVISIONAL — house POM codes not yet mapped; the internal id is shown"
                  if provisional_codes else "house POM codes"),
    ]
    if evidence.get("landmark_overrides", {}).get("applied"):
        header.append(("Hand-placed landmarks", str(evidence["landmark_overrides"].get("file"))))
        mirrored = sorted(k for k, v in (evidence.get("landmarks") or {}).items()
                          if isinstance(v, dict) and v.get("source") == "manual_mirrored")
        if mirrored:
            header.append(("Mirrored landmarks", ", ".join(mirrored) + " — accepted as the mirror of the other side"))
        # a point placed where a pixel was worth more than 3mm is a different kind of
        # number from one placed facing at close range; the sheet says which, as a fact
        coarse = sorted((k, v["placed_with"]) for k, v in (evidence.get("landmarks") or {}).items()
                        if isinstance(v, dict) and isinstance(v.get("placed_with"), dict)
                        and isinstance(v["placed_with"].get("footprint_mm_px"), (int, float))
                        and v["placed_with"]["footprint_mm_px"] > PLACEMENT_NOTE_MM_PX)
        if coarse:
            header.append(("Placement quality", "; ".join(
                f"{k} placed at {pw['footprint_mm_px']} mm/px"
                + (f", {pw['incidence_deg']}° incidence" if pw.get("incidence_deg") is not None else "")
                for k, pw in coarse)))
    for index, limit in enumerate(evidence.get("declared_limits", []), start=1):
        header.append((f"Limit {index}", limit))

    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        for key, value in header:
            writer.writerow([key, value])
        for title, rows in (("MEASURED", measured),
                            ("DIAGNOSTIC — not points of measure", diagnostics),
                            ("NOT MEASURED — stated, not omitted", absent)):
            writer.writerow([])
            writer.writerow([title])
            writer.writerow(COLUMNS)
            for record in rows:
                writer.writerow([record[column] for column in COLUMNS])

    JSON_PATH.write_text(json.dumps({
        "schema_version": 1,
        "generated_at": generated_at,
        "source": "scripts/export_pom_sheet.py from qa/avatar_master/measurements.json",
        "asset": evidence["asset"],
        "registry": evidence["registry"],
        "measured_at": evidence["generated_at"],
        "provisional_codes": provisional_codes,
        "landmark_overrides": evidence.get("landmark_overrides"),
        "declared_limits": evidence.get("declared_limits", []),
        "measured": measured,
        "diagnostic": diagnostics,
        "not_measured": absent,
        "decision": "FAIL" if failures else "SHEET_WRITTEN_NOT_APPROVED",
        "failures": failures,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    for record in measured:
        if record["ml"]:
            print(f"{record['Status'].upper():13} {record['POM code']:26} {record['ml']:>7} ml")
        else:
            print(f"{record['Status'].upper():13} {record['POM code']:26} "
                  f"{record['cm']:>7} cm  {record['inch']:>10}")
    for record in absent:
        print(f"{record['Status'].upper():13} {record['POM code']:26} "
              f"{'—':>7}      {record['Notes'][:44]}")
    print(f"SHEET         {CSV_PATH.relative_to(ROOT)}")
    print(f"SHEET         {JSON_PATH.relative_to(ROOT)}")
    if provisional_codes:
        print("CODES         PROVISIONAL — set house_code in the registry before factory release")
    if failures:
        for failure in failures:
            print(f"FAIL          {failure}", file=sys.stderr)
        return 1
    print("DECISION      SHEET_WRITTEN_NOT_APPROVED — mesh geometry only, no TD approval implied")
    return 0


if __name__ == "__main__":
    sys.exit(main())
