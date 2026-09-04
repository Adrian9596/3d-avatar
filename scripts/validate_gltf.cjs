#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const validator = require("gltf-validator");

const root = path.resolve(__dirname, "..");
const input = process.argv[2] ? path.resolve(root, process.argv[2]) : path.join(root, "assets", "export", "avatar_36C.glb");
const output = process.argv[3] ? path.resolve(root, process.argv[3]) : path.join(root, "qa", "avatar_36C", "gltf-validator-report.json");

if (!fs.existsSync(input)) {
  console.error(`BLOCKED: missing ${input}`);
  process.exit(2);
}

const bytes = new Uint8Array(fs.readFileSync(input));

validator
  .validateBytes(bytes, {
    uri: path.basename(input),
    format: "glb",
    maxIssues: 1000,
    writeTimestamp: false,
  })
  .then((report) => {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const counts = report.issues && report.issues.numErrors !== undefined
      ? {
          errors: report.issues.numErrors,
          warnings: report.issues.numWarnings,
          infos: report.issues.numInfos,
          hints: report.issues.numHints,
        }
      : {};
    console.log(JSON.stringify({ output: path.relative(root, output), counts }, null, 2));
    process.exit(counts.errors > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error(`Validator failed: ${error}`);
    process.exit(1);
  });
