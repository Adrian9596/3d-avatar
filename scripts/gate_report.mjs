/**
 * The shape every gate in this repo shares: named PASS/FAIL checks, a JSON
 * evidence file pinned to what it measured, the same console lines, the same
 * exit codes (0 pass, 1 a check failed, 2 an input is missing or stale).
 *
 * Kept deliberately small — a gate's checks are its own business; this only
 * stops six scripts from each carrying their own copy of the plumbing.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const sha256Bytes = (buf) => createHash('sha256').update(buf).digest('hex');
/** metres -> millimetres, rounded for the record. */
export const mm = (v, digits = 4) => Number((v * 1000).toFixed(digits));
export const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export function createGate() {
  const checks = [];
  const record = (name, ok, detail = '') => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); return ok; };
  const failures = () => checks.filter((c) => c.status === 'FAIL');
  /** Stop with exit code 2: the gate cannot run, which is not a failure of what it gates. */
  const blocked = (reason) => { console.error(`BLOCKED: ${reason}`); process.exit(2); };
  /**
   * Write the evidence file, print every check, and exit. `body` is the
   * gate-specific report; the common fields are added around it.
   */
  const finish = ({ reportPath, body, okDecision, lines = [], relativeTo = '' }) => {
    const failed = failures();
    const report = { schema_version: 1, generated_at: stamp(), ...body, checks, decision: failed.length ? 'FAIL' : okDecision };
    if (reportPath) {
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    for (const check of checks) console.log(`${check.status} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    for (const line of lines) console.log(line);
    if (reportPath) console.log(`REPORT ${relativeTo ? reportPath.slice(relativeTo.length + 1) : reportPath}`);
    if (failed.length) { console.error(`FAIL   ${failed.length} check(s) failed`); process.exit(1); }
    console.log(`DECISION ${okDecision}`);
  };
  return { checks, record, failures, blocked, finish };
}
