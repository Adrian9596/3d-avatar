#!/usr/bin/env node
/**
 * Asserts the evidence committed in qa/ is what a fresh run actually produces.
 *
 * Why this exists: the gates regenerate qa/*.json before they check anything,
 * so on their own they would happily overwrite a hand-edited or out-of-date
 * evidence file and then pass. The committed record would say one thing and
 * reality another, and nothing in CI would notice. This compares the evidence
 * as committed against the evidence as just regenerated, so a PR cannot carry
 * a number that its own run does not reproduce.
 *
 * Two narrow kinds of difference are allowed, and nothing else:
 *
 *   - `generated_at` / `measured_at`, which change on every run by design.
 *     Matched by EXACT key name, never by substring -- "poms" contains "ms",
 *     and a sloppy filter would quietly excuse every measurement in the file.
 *
 *   - `tool.python` and `tool.node`, the interpreter that happened to run.
 *     A developer on macOS and CI on Linux legitimately differ here. Matched by
 *     exact PATH, not key name, so `tool.script` and `tool.implementation` --
 *     which are real claims about how a number was produced -- keep being
 *     compared. Ignoring a version string cannot hide a changed result: every
 *     value the interpreter produced is still compared in full, so a version
 *     that actually altered a number fails on the number.
 *
 * Usage:  node scripts/check_evidence_drift.mjs <committed-dir> <fresh-dir>
 * Exit:   0 the record matches reality, 1 it drifted, 2 an input is missing.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const VOLATILE_KEYS = new Set(['generated_at', 'measured_at']);
const VOLATILE_PATHS = new Set(['tool.python', 'tool.node']);

const [committedDir, freshDir] = process.argv.slice(2);
if (!committedDir || !freshDir) {
  console.error('usage: check_evidence_drift.mjs <committed-dir> <fresh-dir>');
  process.exit(2);
}
for (const dir of [committedDir, freshDir]) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`BLOCKED: ${dir} is not a directory`);
    process.exit(2);
  }
}

/** Drop only the allowed-to-vary fields, leaving everything else intact. */
function strip(value, path = '') {
  if (Array.isArray(value)) return value.map((item, i) => strip(item, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const here = path ? `${path}.${key}` : key;
      if (VOLATILE_KEYS.has(key) || VOLATILE_PATHS.has(here)) continue;
      out[key] = strip(value[key], here);
    }
    return out;
  }
  return value;
}

/** First differing path, so the report points at the field instead of the file. */
function firstDifference(a, b, path = '') {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return { path: path || '(root)', a: `${a.length} items`, b: `${b.length} items` };
    for (let i = 0; i < a.length; i += 1) {
      const found = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = firstDifference(a[key], b[key], path ? `${path}.${key}` : key);
      if (found) return found;
    }
    return null;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    return { path: path || '(root)', a: JSON.stringify(a), b: JSON.stringify(b) };
  }
  return null;
}

const names = new Set([...readdirSync(committedDir), ...readdirSync(freshDir)]);
const problems = [];
let compared = 0;

for (const name of [...names].sort()) {
  const committedPath = join(committedDir, name);
  const freshPath = join(freshDir, name);

  if (!existsSync(committedPath)) {
    problems.push(`${name}: produced by the run but not committed — add it to qa/`);
    continue;
  }
  if (!existsSync(freshPath)) {
    problems.push(`${name}: committed but the run did not produce it — it may be stale evidence for a retired gate`);
    continue;
  }
  if (statSync(freshPath).isDirectory()) continue;
  compared += 1;

  if (name.endsWith('.json')) {
    let a;
    let b;
    try {
      a = strip(JSON.parse(readFileSync(committedPath, 'utf8')));
      b = strip(JSON.parse(readFileSync(freshPath, 'utf8')));
    } catch (error) {
      problems.push(`${name}: not valid JSON — ${error.message}`);
      continue;
    }
    const diff = firstDifference(a, b);
    if (diff) {
      problems.push(`${name}: ${diff.path}\n      committed: ${diff.a}\n      this run:  ${diff.b}`);
    }
  } else if (!readFileSync(committedPath).equals(readFileSync(freshPath))) {
    problems.push(`${name}: committed bytes differ from this run`);
  }
}

console.log(`compared ${compared} evidence file(s) in ${basename(freshDir)}`);
if (problems.length) {
  for (const problem of problems) console.error(`DRIFT  ${problem}`);
  console.error('');
  console.error(`FAIL   ${problems.length} evidence file(s) do not match a fresh run.`);
  console.error('       The committed record and reality disagree. Rerun the gates and');
  console.error('       commit the regenerated evidence — do not relax this check.');
  process.exit(1);
}
console.log('DECISION EVIDENCE_MATCHES_A_FRESH_RUN');
