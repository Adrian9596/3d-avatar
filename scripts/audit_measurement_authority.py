#!/usr/bin/env python3
"""Audit measurement-table completeness and provenance without inventing data."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MEASUREMENTS = ROOT / "avatar_36C_measurements.md"
REPORT = ROOT / "qa" / "avatar_36C" / "measurement-authority-audit.json"
EXPECTED_APPROVED = {"M-002", "M-003", "M-004", "M-005", "M-006", "M-007", "M-008", "M-012"}
EXPECTED_MISSING = {f"M-{index:03d}" for index in range(1, 21)} - EXPECTED_APPROVED


def build_audit(write_report: bool = True) -> dict:
    content = MEASUREMENTS.read_text(encoding="utf-8")
    rows = []
    for line in content.splitlines():
        match = re.match(r"\| (M-\d{3}) \|.*", line)
        if not match:
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) != 9:
            continue
        row_id = cells[0]
        target = cells[4]
        tolerance = cells[5]
        rows.append({
            "id": row_id,
            "target": target,
            "tolerance": tolerance,
            "result": cells[8],
            "target_numeric": bool(re.search(r"\d", target)) and "TBC" not in target,
            "td_source_marker": "[4]" in target,
        })

    ids = {row["id"] for row in rows}
    approved = {row["id"] for row in rows if row["target_numeric"]}
    missing = ids - approved
    source_marker_pass = all(row["td_source_marker"] for row in rows if row["target_numeric"])
    source_footnote_pass = "**[4]** TD-approved fit-model measurement record" in content
    no_draft_as_target_pass = "must never be copied into the Target cm column" in content
    tolerance_approval_blocked = "explicitly approving these" in (ROOT / "TASK_TRACKER.md").read_text(encoding="utf-8")
    term_mapping_blocked = "did not separately re-confirm these two term equivalences" in content

    checks = {
        "twenty_rows_present": ids == {f"M-{index:03d}" for index in range(1, 21)},
        "approved_target_set_preserved": approved == EXPECTED_APPROVED,
        "missing_target_set_explicit": missing == EXPECTED_MISSING,
        "approved_targets_have_td_source_marker": source_marker_pass,
        "td_source_marker_definition_present": source_footnote_pass,
        "draft_observations_prohibited_as_targets": no_draft_as_target_pass,
        "tolerance_approval_still_blocked": tolerance_approval_blocked,
        "term_mapping_confirmation_still_blocked": term_mapping_blocked,
    }
    implementation_failures = [name for name in (
        "twenty_rows_present",
        "approved_target_set_preserved",
        "missing_target_set_explicit",
        "approved_targets_have_td_source_marker",
        "td_source_marker_definition_present",
        "draft_observations_prohibited_as_targets",
    ) if not checks[name]]
    authority_complete = len(approved) == 20 and not tolerance_approval_blocked and not term_mapping_blocked
    decision = "MEASUREMENT_INPUT_APPROVED_FITTING_MAY_BEGIN" if authority_complete and not implementation_failures else "BLOCKED_MISSING_12_TARGETS_AND_TOLERANCE_APPROVAL"
    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": MEASUREMENTS.name,
        "scope_warning": "This audit checks completeness and provenance markers; it does not supply or approve missing TD values.",
        "counts": {"rows": len(rows), "numeric_targets": len(approved), "missing_targets": len(missing)},
        "approved_target_ids": sorted(approved),
        "missing_target_ids": sorted(missing),
        "checks": checks,
        "implementation_failures": implementation_failures,
        "decision": decision,
    }
    if write_report:
        REPORT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return payload


def main() -> int:
    payload = build_audit(write_report=True)
    for name, passed in payload["checks"].items():
        print(f"{'PASS' if passed else 'FAIL'} {name}")
    print(f"TARGETS {payload['counts']['numeric_targets']}/20 numeric; missing {', '.join(payload['missing_target_ids'])}")
    print(f"DECISION {payload['decision']}")
    print(f"REPORT {REPORT.relative_to(ROOT)}")
    return 1 if payload["implementation_failures"] else 2 if payload["decision"].startswith("BLOCKED") else 0


if __name__ == "__main__":
    raise SystemExit(main())
