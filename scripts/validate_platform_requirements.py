#!/usr/bin/env python3
"""Validate traceability and measurability of the 36 platform requirements checks.

This validator assesses requirements quality only. It does not claim that the
platform, avatar asset, deployment, or human approval gates have passed.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHECKLIST = ROOT / "Checklist — 3D Avatar Platform Requirements.md"
REQUIREMENTS = ROOT / "PLATFORM_FOUNDATION_REQUIREMENTS.md"
CONTEXT = ROOT / "PROJECT_CONTEXT.md"
ASSET_CONTRACT = ROOT / "contracts" / "avatar-asset-contract.md"
MOTION_CONTRACT = ROOT / "MOTION_CONTRACT.md"
RUNBOOK = ROOT / "PLATFORM_RUNBOOK.md"
REPOSITORY_POLICY = ROOT / "REPOSITORY_POLICY.md"
DEPENDENCY_INVENTORY = ROOT / "DEPENDENCY_INVENTORY.md"
GIT_ATTRIBUTES = ROOT / ".gitattributes"
CI_WORKFLOW = ROOT.parent / ".github" / "workflows" / "3d-avatar-platform.yml"
REPORT = ROOT / "qa" / "avatar_36C" / "platform-requirements-validation.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def label(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(Path("..") / path.relative_to(ROOT.parent))


def has(text: str, *terms: str) -> bool:
    lowered = text.casefold()
    return all(term.casefold() in lowered for term in terms)


def check(check_id: str, passed: bool, evidence: list[str], detail: str) -> dict[str, object]:
    return {
        "id": check_id,
        "status": "PASS" if passed else "FAIL",
        "detail": detail,
        "evidence": evidence,
    }


def main() -> int:
    checklist = load(CHECKLIST)
    req = load(REQUIREMENTS)
    context = load(CONTEXT)
    asset = load(ASSET_CONTRACT)
    motion = load(MOTION_CONTRACT)
    runbook = load(RUNBOOK)
    repository_policy = load(REPOSITORY_POLICY)
    dependencies = load(DEPENDENCY_INVENTORY)
    git_attributes = load(GIT_ATTRIBUTES)
    ci_workflow = load(CI_WORKFLOW)

    checked_ids = sorted({int(value) for value in re.findall(r"^- \[[xX]\] \*\*PFQ(\d{3})\*\*", checklist, re.MULTILINE)})
    all_ids = sorted({int(value) for value in re.findall(r"PFQ(\d{3})", checklist)})
    sections = {int(value) for value in re.findall(r"^## (\d+)\.", req, re.MULTILINE)}
    six_morphs = ("Underbust", "Projection", "RootWidth", "Spacing", "UpperFullness", "Ptosis")

    definitions: list[tuple[int, bool, list[str], str]] = [
        (1, has(req, "Platform readiness does not establish", "outside the foundation scope"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §1"], "Outcome, asset approval and exclusions are separated."),
        (2, has(req, "DRAFT", "BLOCKED", "REVISE", "APPROVED FOR AUTHORING", "RELEASED", "transition authority", "SHA-256", "invalidates"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §2"], "Lifecycle, authority, identity and invalidation are explicit."),
        (3, has(req, "parent `Web Tools`", "Git LFS", "pinned", "clean-clone/bootstrap"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §3"], "Repository, binaries, dependencies and bootstrap are covered."),
        (4, has(req, "Blender is the canonical", "MPFB is a candidate generator", "Helper geometry"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §4"], "Authoring roles and authoring-only data boundaries are explicit."),
        (5, has(req, "minimum rig", "arms 90° lateral", "continuous down", "semantic morph combinations"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §5"], "Rig, pose, sweep and morph-combination scope is enumerated."),
        (6, has(req, "Khronos validation", "clean-scene round-trip", "independent web rendering"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §6"], "Export validation gates remain independent."),
        (7, sections.issuperset({7, 8, 9}) and has(req, "Web viewer platform", "QA and automation", "Deployment and operations", "privacy/security"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §7–9"], "Viewer, QA, deployment, operations and privacy are present."),
        (8, has(req, "does not establish anatomical, measurement, factory or simulation approval"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §1"], "Platform readiness is not asset approval."),
        (9, has(req, "project boundary", "parent `Web Tools`") and has(repository_policy, "Git root", "Project boundary", "No sibling project path"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §3", "REPOSITORY_POLICY.md"], "Parent repository relationship is explicit."),
        (10, has(req, "Source code, contracts, manifests and reports use Git", ".blend", ".glb", "Git LFS") and has(git_attributes, "*.blend filter=lfs", "*.glb filter=lfs"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §3", ".gitattributes"], "Git and LFS responsibilities are stated by artifact class."),
        (11, has(req, "Prototype, candidate, approved-master and production-release"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §2"], "Lifecycle artifacts require distinct identities."),
        (12, has(req, "pelvis", "spine", "chest", "clavicle/shoulder", "upper arm", "elbow", "wrist", "leg chain"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §5", "MOTION_CONTRACT.md"], "The minimum rig is a named inventory."),
        (13, has(req, "30–45°", "90° lateral", "120°", "150–160°", "forward 90°", "continuous down"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §5"], "Motion endpoints and sweep are measurable."),
        (14, has(req, "Migration to Vite", "multi-module production code", "single-file prototype"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §7"], "Vite is tied to the production modularization boundary."),
        (15, has(req, "TD-approved measurements", "asset/DoD contracts") and has(context, "Authority hierarchy", "TD-approved 36C measurement"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §2", "PROJECT_CONTEXT.md"], "Authority hierarchy is consistent across source documents."),
        (16, has(req, "DRAFT — NOT TD VALIDATED", "Production deployment remains blocked"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §1", "PLATFORM_FOUNDATION_REQUIREMENTS.md §9"], "Draft exercises cannot promote production status."),
        (17, has(req, "coordinate, naming and budget rules", "contracts/avatar-asset-contract.md") and has(asset, "Coordinates and scale", "Required named data", "Runtime budgets"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §6", "contracts/avatar-asset-contract.md"], "Runtime rules delegate to the asset contract."),
        (18, has(req, "canonical exporter", "prototype-sanitizing exporter", "remain separate"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §6"], "Prototype export does not replace the canonical export."),
        (19, all(name in asset for name in six_morphs) and has(req, "six required semantic morphs", "Shape controls remain unavailable"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §5–7", "contracts/avatar-asset-contract.md"], "The same six semantic morphs govern authoring, export and viewer behavior."),
        (20, has(req, "visual diff cannot substitute for TD/3D decisions") and has(context, "Do not tick a DoD item without evidence"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §8", "PROJECT_CONTEXT.md"], "Machine and visual results cannot replace human decisions."),
        (21, has(req, "ID, semantic version, status, source revision and SHA-256"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §2"], "Asset/evidence identity is objectively verifiable."),
        (22, has(req, "minimum rig must provide") and has(motion, "pelvis", "upper_arm_L/R", "lower_leg_L/R"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §5", "MOTION_CONTRACT.md"], "Rig completeness has a stable named inventory."),
        (23, has(req, "Required motion states", "continuous down → overhead → down sweep"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §5"], "Pose coverage has named states and a sweep."),
        (24, has(req, "helpers, morphs, skins and animations"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §6"], "Exporter policy is independently assessable by data class."),
        (25, has(req, "One aggregate local command", "CI must be scoped", "fail on errors, stale hashes, missing evidence"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §8"], "Local and CI failure conditions are objective."),
        (26, has(req, "Preview and production environments must be separate", "rollback") and has(runbook, "Build and preview", "Production approval", "Rollback"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §9", "PLATFORM_RUNBOOK.md"], "Preview, production and rollback evidence are distinct."),
        (27, has(req, "Missing required rig, animation, landmark or morph data", "BLOCKED", "never silently replaced"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §6–7"], "Missing required asset capabilities fail closed."),
        (28, has(req, "hash change invalidates", "until regeneration") and has(runbook, "Never reuse evidence whose input hash no longer matches"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §2", "PLATFORM_RUNBOOK.md"], "Hash drift invalidates dependent evidence."),
        (29, has(req, "Helper geometry", "must not silently enter production exports"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §4"], "Accidental helper/draft-data export is fail-closed."),
        (30, has(req, "loading, ready, blocked-feature", "recoverable error/static fallback", "Mobile/desktop"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §7–8"], "Viewer states and responsive scenarios are covered."),
        (31, has(req, "Preview and production", "rollback", "asset/evidence recovery"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §9", "PLATFORM_RUNBOOK.md"], "Deployment and recovery flows are present."),
        (32, has(req, "must not collect body measurements or personal scan data", "privacy/security design and authorization"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §9"], "Sensitive measurement/scan collection is blocked by default."),
        (33, has(req, "final rig weighting cannot be approved before", "TD measurement gate", "master-body freeze"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §4"], "Final weighting depends on TD authority and master freeze."),
        (34, has(req, "Node and Python dependencies", "Blender, MPFB", "clean-clone/bootstrap") and has(dependencies, "JavaScript dependencies", "standard library", "Blender", "5.2.0", "MPFB"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §3", "DEPENDENCY_INVENTORY.md"], "Dependency and bootstrap requirements cover the full toolchain."),
        (35, has(req, "accessibility", "responsive framing", "performance budgets", "pinned local dependencies", "must not depend on a CDN"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §7"], "Viewer non-functional requirements are present."),
        (36, has(req, "CI must be scoped to this project") and has(ci_workflow, "3D avatar/**", "working-directory", "npm run validate:platform"), ["PLATFORM_FOUNDATION_REQUIREMENTS.md §8", "../.github/workflows/3d-avatar-platform.yml"], "CI is explicitly project-scoped."),
    ]

    checks = [check(f"PFQ{number:03d}", passed, evidence, detail) for number, passed, evidence, detail in definitions]
    structure_checks = [
        check("STRUCTURE-ID-COVERAGE", all_ids == list(range(1, 37)), [CHECKLIST.name], f"found {len(all_ids)} unique PFQ IDs"),
        check("STRUCTURE-CHECKED-STATE", checked_ids == list(range(1, 37)), [CHECKLIST.name], f"found {len(checked_ids)} checked PFQ IDs"),
        check("STRUCTURE-REQUIREMENT-SECTIONS", sections == set(range(1, 11)), [REQUIREMENTS.name], f"found sections {sorted(sections)}"),
    ]
    failures = [item for item in checks + structure_checks if item["status"] == "FAIL"]
    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": "Requirements quality and traceability only; implementation and asset approval are separate gates.",
        "decision": "36/36 REQUIREMENTS DEFINED" if not failures else "REQUIREMENTS NEED REVISION",
        "counts": {
            "pfq_pass": sum(1 for item in checks if item["status"] == "PASS"),
            "pfq_fail": sum(1 for item in checks if item["status"] == "FAIL"),
            "structure_pass": sum(1 for item in structure_checks if item["status"] == "PASS"),
            "structure_fail": sum(1 for item in structure_checks if item["status"] == "FAIL"),
        },
        "input_sha256": {
            label(path): sha256(path)
            for path in (
                CHECKLIST,
                REQUIREMENTS,
                CONTEXT,
                ASSET_CONTRACT,
                MOTION_CONTRACT,
                RUNBOOK,
                REPOSITORY_POLICY,
                DEPENDENCY_INVENTORY,
                GIT_ATTRIBUTES,
                CI_WORKFLOW,
            )
        },
        "checks": checks,
        "structure_checks": structure_checks,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    for item in checks + structure_checks:
        print(f"{item['status']} {item['id']}: {item['detail']}")
    print(f"SUMMARY {payload['counts']['pfq_pass']}/36 PFQ PASS, {len(failures)} total FAIL")
    print(f"REPORT {REPORT.relative_to(ROOT)}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
