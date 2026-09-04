#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_CLIPS,
  REQUIRED_MORPHS,
  validateAnimationContract,
  validateMorphContract,
} from "../viewer/src/contracts.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exportReportPath = path.join(root, "qa/avatar_master/prototype-export-report.json");
const outputPath = path.join(root, "qa/avatar_master/viewer-contract-test.json");
const exportReport = JSON.parse(fs.readFileSync(exportReportPath, "utf8"));

const assertions = [
  ["morph exact set passes", validateMorphContract(REQUIRED_MORPHS).status === "PASS"],
  ["morph missing blocks", validateMorphContract(REQUIRED_MORPHS.slice(0, -1)).status === "BLOCKED"],
  ["morph duplicate blocks", validateMorphContract([...REQUIRED_MORPHS, REQUIRED_MORPHS[0]]).duplicates.length === 1],
  ["animation exact set passes", validateAnimationContract(REQUIRED_CLIPS).status === "PASS"],
  ["animation missing blocks", validateAnimationContract([]).missing.length === REQUIRED_CLIPS.length],
];

const actualMorphNames = exportReport.morph_names || [];
const actualAnimationNames = exportReport.animation_names || [];
const actual = {
  morphs: validateMorphContract(actualMorphNames),
  animations: validateAnimationContract(actualAnimationNames),
  armature_exported: exportReport.armature_exported,
};
const failures = assertions.filter(([, passed]) => !passed).map(([name]) => name);
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  tool: { node: process.version },
  assertions: assertions.map(([name, passed]) => ({ name, status: passed ? "PASS" : "FAIL" })),
  actual_asset_status: actual.morphs.status === "PASS" && actual.animations.status === "PASS" && actual.armature_exported ? "PASS" : "BLOCKED",
  actual,
  decision: failures.length ? "FAIL" : "CONTRACT_HARNESS_PASS_ASSET_REMAINS_BLOCKED",
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
report.assertions.forEach((item) => console.log(`${item.status} ${item.name}`));
console.log(`ASSET ${report.actual_asset_status}: no final rig/morph claims are permitted`);
console.log(`REPORT ${path.relative(root, outputPath)}`);
process.exit(failures.length ? 1 : 0);
