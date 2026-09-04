#!/usr/bin/env python3
from hashlib import sha256
from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "digital_bra_fit_model_360.html"
GLB = ROOT / "assets/export/avatar_36C_prototype.glb"
PACKAGE = ROOT / "package.json"
FALLBACK = ROOT / "qa/avatar_36C/bikini/clothed-front.png"
EXPORT_REPORT = ROOT / "qa/avatar_36C/prototype-export-report.json"
CANONICAL_GLB = ROOT / "assets/export/avatar_36C.glb"
EXPECTED_SHA = "7f3c56b9e9c73416598df6030e876e9e59756420f1def503abb7fba6b66a88a5"
EXPECTED_CANONICAL_SHA = "66a5bc648976f468bfffb748f9d78cfe2f9a6db481464dedb9666169fbfe5c3b"

html = HTML.read_text(encoding="utf-8")
package = json.loads(PACKAGE.read_text(encoding="utf-8"))
actual_sha = sha256(GLB.read_bytes()).hexdigest() if GLB.exists() else None
canonical_sha = sha256(CANONICAL_GLB.read_bytes()).hexdigest() if CANONICAL_GLB.exists() else None
export_report = json.loads(EXPORT_REPORT.read_text(encoding="utf-8")) if EXPORT_REPORT.exists() else {}

checks = {
    "html_exists": HTML.exists(),
    "glb_exists": GLB.exists(),
    "glb_sha_matches": actual_sha == EXPECTED_SHA,
    "html_sha_matches": f"const ASSET_SHA='{EXPECTED_SHA}'" in html or f'const ASSET_SHA="{EXPECTED_SHA}"' in html,
    "canonical_glb_unchanged": canonical_sha == EXPECTED_CANONICAL_SHA,
    "prototype_has_no_generator_morphs": export_report.get("morph_targets_exported") == 0,
    "prototype_has_no_armature": export_report.get("armature_exported") is False,
    "prototype_has_expected_roles": {item.get("role") for item in export_report.get("objects", [])} == {"BODY", "BIKINI_TOP", "BIKINI_BRIEF", "EYE_L", "EYE_R", "EYE_TRIM", "EYEBROW", "HAIR"},
    "three_pinned": bool(re.fullmatch(r"\d+\.\d+\.\d+", package.get("dependencies", {}).get("three", ""))),
    "local_three_import": "./node_modules/three/build/three.module.js" in html,
    "no_runtime_cdn": not re.search(r"https?://[^\"']*(three|jsdelivr|unpkg)", html, re.I),
    "local_glb_path": "assets/export/avatar_36C_prototype.glb" in html,
    "draft_status_visible": "DRAFT · NOT TD VALIDATED" in html,
    "no_fake_measurements": all(value not in html for value in ('39.0\"', '36.0\"', '5.2\"', '3.5\"', '7.1\"')),
    "td_tbc_visible": "TBC · TD source" in html,
    "semantic_controls_unavailable": "Unavailable in this draft" in html,
    "camera_presets": all(f'data-view="{view}"' in html for view in ("front", "three-quarter", "side", "back", "reset")),
    "display_roles": all(f'data-role="{role}"' in html for role in ("BODY", "BIKINI_TOP", "BIKINI_BRIEF", "WIREFRAME")),
    "loading_state": 'id="loading"' in html and "prototypeState.status='READY'" in html,
    "fallback_implemented": FALLBACK.exists() and 'id="errorCard"' in html and "fallbackImage.hidden=false" in html,
    "diagnostic_state": "window.__avatarPrototype" in html,
    "dpr_capped": "Math.min(window.devicePixelRatio||1,2)" in html,
    "accessible_states": 'aria-pressed="true"' in html and 'aria-expanded="false"' in html,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'} {name}")
print(f"SUMMARY {len(checks) - len(failed)} PASS, {len(failed)} FAIL")
if failed:
    print("FAILED " + ", ".join(failed))
    sys.exit(1)
