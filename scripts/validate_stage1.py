#!/usr/bin/env python3
"""Machine-checkable Stage 1 baseline validation.

This script intentionally reports missing authority and assets as BLOCKED.
It does not grant anatomical, TD, visual, or final release approval.
"""

from __future__ import annotations

import hashlib
import json
import re
import struct
from datetime import datetime, timezone
from pathlib import Path

from audit_asset_identity import build_audit
from audit_measurement_authority import build_audit as build_measurement_audit


ROOT = Path(__file__).resolve().parents[1]
CHECKLIST = ROOT / "Definition of Done — Stage 1 Validated 36C Avatar GLB.md"
MEASUREMENTS = ROOT / "avatar_36C_measurements.md"
MANIFEST = ROOT / "avatar_36C_asset_manifest.md"
BLEND = ROOT / "avatar_36C_master.blend"
GLB = ROOT / "assets" / "export" / "avatar_36C.glb"
REPORT = ROOT / "qa" / "avatar_36C" / "automated-validation.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def result(check_id: str, status: str, detail: str, evidence: str | None = None) -> dict:
    payload = {"id": check_id, "status": status, "detail": detail}
    if evidence:
        payload["evidence"] = evidence
    return payload


def validate_glb(path: Path) -> list[dict]:
    checks: list[dict] = []
    if not path.exists():
        return [result("GLB-EXISTS", "BLOCKED", "assets/export/avatar_36C.glb is missing")]

    size = path.stat().st_size
    checks.append(result("GLB-SIZE", "PASS" if size <= 25 * 1024 * 1024 else "FAIL", f"{size} bytes", str(path.relative_to(ROOT))))

    with path.open("rb") as handle:
        header = handle.read(12)
    if len(header) != 12:
        checks.append(result("GLB-HEADER", "FAIL", "File is shorter than the 12-byte GLB header"))
        return checks

    magic, version, declared_length = struct.unpack("<4sII", header)
    actual_length = size
    valid = magic == b"glTF" and version == 2 and declared_length == actual_length
    checks.append(
        result(
            "GLB-HEADER",
            "PASS" if valid else "FAIL",
            f"magic={magic!r}, version={version}, declared={declared_length}, actual={actual_length}",
            str(path.relative_to(ROOT)),
        )
    )
    checks.append(result("GLB-SHA256", "PASS", sha256(path), str(path.relative_to(ROOT))))
    return checks


def main() -> int:
    checks: list[dict] = []

    required_docs = [
        ROOT / "PROJECT_CONTEXT.md",
        ROOT / "IMPLEMENTATION_PLAN.md",
        ROOT / "TASK_TRACKER.md",
        ROOT / "contracts" / "avatar-asset-contract.md",
        MEASUREMENTS,
        MANIFEST,
        ROOT / "qa" / "avatar_36C" / "validation.md",
    ]
    for path in required_docs:
        checks.append(
            result(
                f"DOC-{path.name}",
                "PASS" if path.exists() else "FAIL",
                "present" if path.exists() else "missing",
                str(path.relative_to(ROOT)),
            )
        )

    if CHECKLIST.exists():
        text = CHECKLIST.read_text(encoding="utf-8")
        ids = [int(value) for value in re.findall(r"DOD-(\d{3})", text)]
        unique_ids = sorted(set(ids))
        expected_ids = list(range(1, 103))
        checks.append(
            result(
                "CHECKLIST-ID-COVERAGE",
                "PASS" if unique_ids == expected_ids else "FAIL",
                f"found {len(unique_ids)} unique IDs; expected 102",
                CHECKLIST.name,
            )
        )
    else:
        checks.append(result("CHECKLIST-ID-COVERAGE", "FAIL", "Stage 1 checklist is missing"))

    measurement_audit = build_measurement_audit(write_report=True)
    authority_blocked = measurement_audit["decision"].startswith("BLOCKED")
    checks.append(
        result(
            "MEASUREMENT-AUTHORITY",
            "BLOCKED" if authority_blocked else "PASS",
            (
                f"{measurement_audit['counts']['numeric_targets']}/20 numeric targets; "
                f"missing {', '.join(measurement_audit['missing_target_ids'])}; tolerance approval incomplete"
                if authority_blocked
                else "20/20 targets, methods and tolerances approved"
            ),
            "qa/avatar_36C/measurement-authority-audit.json",
        )
    )

    checks.append(
        result(
            "BLEND-EXISTS",
            "PASS" if BLEND.exists() else "BLOCKED",
            f"sha256={sha256(BLEND)}" if BLEND.exists() else "avatar_36C_master.blend is missing",
            BLEND.name,
        )
    )
    checks.extend(validate_glb(GLB))

    identity_audit = build_audit(write_report=True)
    checks.append(
        result(
            "ASSET-IDENTITY",
            "PASS" if identity_audit["counts"]["fail"] == 0 else "FAIL",
            identity_audit["decision"],
            "qa/avatar_36C/asset-identity-audit.json",
        )
    )

    counts = {status: sum(1 for item in checks if item["status"] == status) for status in ("PASS", "FAIL", "BLOCKED")}
    overall = "FAIL" if counts["FAIL"] else "BLOCKED" if counts["BLOCKED"] else "MACHINE_CHECKS_PASS"
    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope_warning": "Machine checks do not grant TD, anatomy, visual, or final Stage 1 approval.",
        "overall": overall,
        "counts": counts,
        "checks": checks,
    }

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 1 if overall == "FAIL" else 2 if overall == "BLOCKED" else 0


if __name__ == "__main__":
    raise SystemExit(main())
