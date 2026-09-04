#!/usr/bin/env python3
"""Audit current asset identity bindings and preserve stale evidence explicitly.

This audit proves that reports and runtime declarations refer to the current
binary inputs. It does not grant TD, anatomy, topology, or release approval.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "qa" / "avatar_36C" / "asset-identity-audit.json"
CURRENT_VERSION = "0.1.0-draft.17"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def json_file(path: str) -> dict:
    return json.loads(text(path))


def nested(payload: dict, *keys: str):
    value = payload
    for key in keys:
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value


def record(record_id: str, passed: bool, detail: str, evidence: str) -> dict:
    return {
        "id": record_id,
        "status": "PASS" if passed else "FAIL",
        "detail": detail,
        "evidence": evidence,
    }


def declared_sha_matches(content: str, expected: str) -> bool:
    """Pure helper used by the negative fixture test."""
    return expected in content


def negative_fixture_test(expected: str) -> dict:
    mismatched = "declared_sha=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    rejected = not declared_sha_matches(mismatched, expected)
    return {
        "fixture": "in-memory deliberately mismatched SHA declaration",
        "expected_sha256": expected,
        "mismatched_declaration_rejected": rejected,
        "status": "PASS" if rejected else "FAIL",
    }


def build_audit(write_report: bool = True) -> dict:
    blend = ROOT / "avatar_36C_master.blend"
    canonical = ROOT / "assets" / "export" / "avatar_36C.glb"
    prototype = ROOT / "assets" / "export" / "avatar_36C_prototype.glb"
    identities = {
        "blend": {"path": str(blend.relative_to(ROOT)), "sha256": sha256(blend), "bytes": blend.stat().st_size},
        "canonical_glb": {"path": str(canonical.relative_to(ROOT)), "sha256": sha256(canonical), "bytes": canonical.stat().st_size},
        "prototype_glb": {"path": str(prototype.relative_to(ROOT)), "sha256": sha256(prototype), "bytes": prototype.stat().st_size},
    }
    blend_sha = identities["blend"]["sha256"]
    canonical_sha = identities["canonical_glb"]["sha256"]
    prototype_sha = identities["prototype_glb"]["sha256"]

    manifest = text("avatar_36C_asset_manifest.md")
    validation = text("qa/avatar_36C/validation.md")
    prototype_html = text("digital_bra_fit_model_360.html")
    prototype_validation = text("qa/avatar_36C/prototype-validation.md")
    prototype_validator = text("scripts/validate_prototype.py")

    manifest_row = next((line for line in manifest.splitlines() if line.startswith(f"| {CURRENT_VERSION} |")), "")
    records = [
        record("manifest-version", f"**Manifest version:** {CURRENT_VERSION}" in manifest, CURRENT_VERSION, "avatar_36C_asset_manifest.md"),
        record("manifest-current-row", blend_sha in manifest_row and canonical_sha in manifest_row, manifest_row or "current row missing", "avatar_36C_asset_manifest.md"),
        record("validation-version", f"**Asset version:** {CURRENT_VERSION}" in validation, CURRENT_VERSION, "qa/avatar_36C/validation.md"),
        record("validation-blend-sha", blend_sha in validation, blend_sha, "qa/avatar_36C/validation.md"),
        record("validation-canonical-sha", canonical_sha in validation, canonical_sha, "qa/avatar_36C/validation.md"),
        record("prototype-html-sha", re.search(r"const ASSET_SHA=['\"]([0-9a-f]{64})['\"]", prototype_html).group(1) == prototype_sha if re.search(r"const ASSET_SHA=['\"]([0-9a-f]{64})['\"]", prototype_html) else False, prototype_sha, "digital_bra_fit_model_360.html"),
        record("prototype-validation-sha", prototype_sha in prototype_validation, prototype_sha, "qa/avatar_36C/prototype-validation.md"),
        record("prototype-validator-sha", prototype_sha in prototype_validator and canonical_sha in prototype_validator, f"prototype={prototype_sha}; canonical={canonical_sha}", "scripts/validate_prototype.py"),
    ]

    json_bindings = [
        ("canonical-export", "qa/avatar_36C/glb-draft-export-report.json", (("source_blend_sha256", blend_sha), ("glb_sha256", canonical_sha))),
        ("prototype-export", "qa/avatar_36C/prototype-export-report.json", (("source_blend_sha256", blend_sha), ("prototype_glb_sha256", prototype_sha))),
        ("draft-measurement", "qa/avatar_36C/draft-body-measurement-report.json", (("blend_sha256", blend_sha),)),
        ("bikini-machine", "qa/avatar_36C/bikini-machine-validation.json", (("blend_sha256", blend_sha),)),
        ("bikini-render", "qa/avatar_36C/bikini-render-report.json", (("blend_sha256", blend_sha),)),
        ("mesh-integrity", "qa/avatar_36C/mesh-integrity-audit.json", (("blend_sha256", blend_sha),)),
        ("roundtrip", "qa/avatar_36C/blender-roundtrip-report.json", (("sha256", canonical_sha),)),
        ("platform-browser", "qa/avatar_36C/platform-viewer-browser-validation.json", (("prototype_glb_sha256", prototype_sha),)),
    ]
    for record_id, path, bindings in json_bindings:
        payload = json_file(path)
        mismatches = [f"{key}={payload.get(key)!r}" for key, expected in bindings if payload.get(key) != expected]
        records.append(record(record_id, not mismatches, "; ".join(mismatches) if mismatches else "all required identities match", path))

    historical = [
        ("qa/avatar_36C/aesthetic-bikini-build-report.json", "HISTORICAL_SUPERSEDED"),
        ("qa/avatar_36C/bikini-penetration-resolution.json", "HISTORICAL_SUPERSEDED"),
    ]
    historical_records = []
    for path, expected_status in historical:
        payload = json_file(path)
        actual = payload.get("evidence_status")
        historical_records.append({
            "path": path,
            "status": "PASS" if actual == expected_status else "FAIL",
            "evidence_status": actual,
            "required_status": expected_status,
        })
    for path in ("qa/avatar_36C/bikini-implementation-validation.md",):
        content = text(path)
        actual = "HISTORICAL_SUPERSEDED" if "**Evidence status:** `HISTORICAL_SUPERSEDED`" in content else None
        historical_records.append({
            "path": path,
            "status": "PASS" if actual else "FAIL",
            "evidence_status": actual,
            "required_status": "HISTORICAL_SUPERSEDED",
        })

    negative_test = negative_fixture_test(canonical_sha)
    failures = [item for item in records if item["status"] == "FAIL"] + [item for item in historical_records if item["status"] == "FAIL"]
    if negative_test["status"] == "FAIL":
        failures.append(negative_test)
    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "asset_status": "DRAFT_NOT_TD_VALIDATED",
        "current_version": CURRENT_VERSION,
        "scope_warning": "Identity agreement does not grant TD, anatomy, topology, visual, or release approval.",
        "identities": identities,
        "records": records,
        "historical_superseded_records": historical_records,
        "negative_fixture_test": negative_test,
        "counts": {
            "pass": sum(item["status"] == "PASS" for item in records),
            "fail": len(failures),
            "historical_superseded": len(historical_records),
        },
        "decision": "IDENTITY_SYNCED_ASSET_REMAINS_DRAFT" if not failures else "FAIL_IDENTITY_DRIFT",
    }
    if write_report:
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        REPORT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return payload


def main() -> int:
    payload = build_audit(write_report=True)
    for item in payload["records"]:
        print(f"{item['status']} {item['id']}: {item['detail']}")
    for item in payload["historical_superseded_records"]:
        print(f"{item['status']} historical:{item['path']}: {item['evidence_status']}")
    negative = payload["negative_fixture_test"]
    print(f"{negative['status']} negative-fixture: mismatched declaration rejected={negative['mismatched_declaration_rejected']}")
    print(f"SUMMARY {payload['decision']}: {payload['counts']['pass']} PASS, {payload['counts']['fail']} FAIL")
    print(f"REPORT {REPORT.relative_to(ROOT)}")
    return 1 if payload["counts"]["fail"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
