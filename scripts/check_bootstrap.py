#!/usr/bin/env python3
"""Check the reproducible local toolchain without mutating the environment."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def output(command: list[str]) -> tuple[int, str]:
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)
    text = (result.stdout or result.stderr).strip()
    return result.returncode, text


def check(name: str, passed: bool, detail: str) -> dict[str, object]:
    return {"name": name, "status": "PASS" if passed else "FAIL", "detail": detail}


def main() -> int:
    package_path = ROOT / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8")) if package_path.exists() else {}
    checks: list[dict[str, object]] = []

    for command in ("git", "git-lfs", "node", "npm", "python3"):
        path = shutil.which(command)
        checks.append(check(f"tool:{command}", bool(path), path or "not found on PATH"))

    blender = Path("/Applications/Blender.app/Contents/MacOS/Blender")
    if blender.exists():
        checks.append(check("tool:blender", True, str(blender)))
    elif os.environ.get("CI"):
        checks.append({"name": "tool:blender", "status": "SKIP", "detail": "non-GUI CI lane; Blender authoring is workstation-validated"})
    else:
        checks.append(check("tool:blender", False, str(blender)))

    rc, root_text = output(["git", "rev-parse", "--show-toplevel"])
    expected_root = str(ROOT.parent)
    checks.append(check("git:root", rc == 0 and root_text == expected_root, root_text or "not a Git worktree"))

    rc, lfs_env = output(["git", "lfs", "env"])
    checks.append(check("git:lfs-initialized", rc == 0 and "LocalWorkingDir=" in lfs_env, lfs_env.splitlines()[0] if lfs_env else "Git LFS unavailable"))

    for filename in ("package.json", "package-lock.json", ".gitignore", ".gitattributes", "DEPENDENCY_INVENTORY.md"):
        checks.append(check(f"file:{filename}", (ROOT / filename).exists(), filename))

    declared_dependencies = {**package.get("dependencies", {}), **package.get("devDependencies", {})}
    for name, version in declared_dependencies.items():
        exact = bool(re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", str(version)))
        checks.append(check(f"dependency:{name}:exact", exact, str(version)))

    node_modules = ROOT / "node_modules"
    checks.append(check("npm:installed", node_modules.is_dir(), "node_modules present" if node_modules.is_dir() else "run npm ci"))

    failures = [item for item in checks if item["status"] == "FAIL"]
    skipped = [item for item in checks if item["status"] == "SKIP"]
    for item in checks:
        print(f"{item['status']} {item['name']}: {item['detail']}")
    print(f"SUMMARY {len(checks) - len(failures) - len(skipped)} PASS, {len(skipped)} SKIP, {len(failures)} FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
