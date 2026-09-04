#!/usr/bin/env python3
"""Run the complete non-GUI platform foundation validation suite.

Asset approval blockers are preserved as blockers, while platform/tool failures
return a failing exit code. This script never grants TD or release approval.
"""

from __future__ import annotations

import hashlib
import json
import platform
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "qa" / "avatar_36C" / "platform-foundation-validation.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(name: str, command: list[str], allowed_codes: set[int] | None = None) -> dict[str, object]:
    allowed = allowed_codes or {0}
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)
    return {
        "name": name,
        "status": "PASS" if result.returncode in allowed else "FAIL",
        "command": command,
        "exit_code": result.returncode,
        "stdout_tail": result.stdout[-4000:],
        "stderr_tail": result.stderr[-2000:],
    }


def static_check(name: str, passed: bool, detail: str) -> dict[str, object]:
    return {"name": name, "status": "PASS" if passed else "FAIL", "detail": detail}


def main() -> int:
    checks: list[dict[str, object]] = []
    checklist = ROOT / "Definition of Done — 3D Avatar Platform Foundation.md"
    checklist_text = checklist.read_text(encoding="utf-8") if checklist.exists() else ""
    ids = sorted({int(value) for value in re.findall(r"PFD-(\d{3})", checklist_text)})
    checks.append(static_check("platform-checklist-id-coverage", ids == list(range(1, 73)), f"{len(ids)} unique IDs"))

    required = [
        ".gitignore",
        ".gitattributes",
        "REPOSITORY_POLICY.md",
        "DEPENDENCY_INVENTORY.md",
        "PLATFORM_FOUNDATION_REQUIREMENTS.md",
        "TASK_TRACKER.md",
        "digital_bra_fit_model_360.html",
        "assets/export/avatar_36C.glb",
        "assets/export/avatar_36C_prototype.glb",
        "viewer/src/main.js",
        "viewer/src/contracts.js",
        "viewer/src/animation-controller.js",
        "qa/avatar_36C/viewer-contract-test.json",
        "qa/avatar_36C/platform-viewer-browser-validation.json",
        "qa/avatar_36C/platform-requirements-validation.json",
        "PLATFORM_RUNBOOK.md",
    ]
    for relative in required:
        checks.append(static_check(f"required:{relative}", (ROOT / relative).exists(), relative))

    ci_workflow = ROOT.parent / ".github" / "workflows" / "3d-avatar-platform.yml"
    checks.append(static_check("required:project-ci-workflow", ci_workflow.exists(), str(ci_workflow)))

    checks.extend(
        [
            run("bootstrap", [sys.executable, "scripts/check_bootstrap.py"]),
            run("platform-requirements", [sys.executable, "scripts/validate_platform_requirements.py"]),
            run("prototype-contract", [sys.executable, "scripts/validate_prototype.py"]),
            run("viewer-contracts", ["node", "scripts/test_viewer_contracts.mjs"]),
            run("viewer-production-build", ["npm", "run", "build:viewer"]),
            run("canonical-gltf", ["node", "scripts/validate_gltf.cjs"]),
            run(
                "prototype-gltf",
                [
                    "node",
                    "scripts/validate_gltf.cjs",
                    "assets/export/avatar_36C_prototype.glb",
                    "qa/avatar_36C/prototype-gltf-validator-report.json",
                ],
            ),
            run("stage1-machine-gate", [sys.executable, "scripts/validate_stage1.py"], {0, 2}),
        ]
    )

    stage_report_path = ROOT / "qa" / "avatar_36C" / "automated-validation.json"
    stage_report = json.loads(stage_report_path.read_text(encoding="utf-8")) if stage_report_path.exists() else {}
    asset_gate = stage_report.get("overall", "MISSING")
    asset_blockers = [item for item in stage_report.get("checks", []) if item.get("status") == "BLOCKED"]

    failures = [item for item in checks if item["status"] == "FAIL"]
    overall = "FAIL" if failures else "PASS_WITH_ASSET_BLOCKERS" if asset_blockers else "PASS"
    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "overall": overall,
        "scope_warning": "Platform checks do not grant TD, anatomical, simulation, factory or release approval.",
        "environment": {
            "platform": platform.platform(),
            "python": platform.python_version(),
        },
        "inputs": {
            "canonical_glb_sha256": sha256(ROOT / "assets/export/avatar_36C.glb"),
            "prototype_glb_sha256": sha256(ROOT / "assets/export/avatar_36C_prototype.glb"),
        },
        "counts": {
            "pass": sum(1 for item in checks if item["status"] == "PASS"),
            "fail": len(failures),
            "asset_blocked": len(asset_blockers),
        },
        "asset_gate": {
            "status": asset_gate,
            "blockers": asset_blockers,
        },
        "evidence": {
            "repository_policy": "REPOSITORY_POLICY.md",
            "dependency_inventory": "DEPENDENCY_INVENTORY.md",
            "motion_contract": "MOTION_CONTRACT.md",
            "requirements_quality": "qa/avatar_36C/platform-requirements-validation.json",
            "viewer_contract_test": "qa/avatar_36C/viewer-contract-test.json",
            "viewer_browser_validation": "qa/avatar_36C/platform-viewer-browser-validation.json",
            "prototype_browser_validation": "qa/avatar_36C/prototype-validation.md",
            "canonical_gltf_validation": "qa/avatar_36C/gltf-validator-report.json",
            "prototype_gltf_validation": "qa/avatar_36C/prototype-gltf-validator-report.json",
            "stage1_machine_gate": "qa/avatar_36C/automated-validation.json",
            "runbook": "PLATFORM_RUNBOOK.md",
            "ci_workflow": "../.github/workflows/3d-avatar-platform.yml",
        },
        "limitations": [
            "No TD-approved measurement authority or frozen fitted master body is available.",
            "The current GLBs contain no final armature, required animation clips, landmarks or six semantic morphs.",
            "The project-scoped CI workflow exists but has not yet produced a remote matrix run.",
            "No preview/production hosting provider, response-header audit or rollback rehearsal exists.",
            "No three-role foundation approval has been recorded.",
        ],
        "checks": checks,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    for item in checks:
        print(f"{item['status']} {item['name']}")
    print(f"ASSET_GATE {asset_gate}: {len(asset_blockers)} blocker(s)")
    print(f"SUMMARY {overall}: {payload['counts']['pass']} PASS, {len(failures)} FAIL")
    print(f"REPORT {REPORT.relative_to(ROOT)}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
