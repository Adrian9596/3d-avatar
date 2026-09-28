/* Bug-finding cases for the Measure Engine (spec: src/features/measure/measure_engine.md).

   Every case is one row of TD's table — Expected → Actual → CAD Reference → Tolerance →
   PASS/FAIL — and one harness test, so `node tests/run.js` counts it like any other test.

   The expected value is written into the case declaration, BEFORE the engine runs: a case
   has no way to derive its expectation from the thing it checks. The CAD Reference column
   is not here on purpose — TD types it into the report, and scripts/check_engine.py keeps
   it across runs. */
import {test} from "./harness.js";

export const rows = [];

const isNum = v => typeof v === "number";
const fmtNum = v => Number.isInteger(v) ? String(v) : String(+v.toPrecision(12));

function show(v){
  if(v === undefined) return "undefined";
  if(isNum(v)) return Number.isNaN(v) ? "NaN" : fmtNum(v);
  if(Array.isArray(v)) return "[" + v.map(show).join(", ") + "]";
  if(v instanceof RegExp) return v.source;
  if(v && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/* Three kinds of expectation:
     a number (+ tol)          → the engine must return a finite number within tol
     an array of numbers       → element by element, same tol
     {throws: /re/}            → the engine must throw, with a message matching re
     anything else             → Object.is (booleans, strings, null) */
function judge(expect, tol, got, err){
  if(expect && typeof expect === "object" && "throws" in expect){
    if(!err) return {pass: false, actual: `trả về ${show(got)} (không ném lỗi)`};
    const okMsg = !expect.throws || expect.throws.test(err.message);
    return {pass: okMsg, actual: `ném lỗi: ${err.message}`};
  }
  if(err) return {pass: false, actual: `ném lỗi: ${err.message}`};
  if(isNum(expect)){
    const pass = isNum(got) && Number.isFinite(got) && Math.abs(got - expect) <= (tol ?? 0);
    return {pass, actual: show(got), delta: isNum(got) ? Math.abs(got - expect) : null};
  }
  if(Array.isArray(expect)){
    const pass = Array.isArray(got) && got.length === expect.length &&
      expect.every((e, i) => isNum(e) ? isNum(got[i]) && Math.abs(got[i] - e) <= (tol ?? 0)
                                      : Object.is(got[i], e));
    return {pass, actual: show(got)};
  }
  return {pass: Object.is(got, expect), actual: show(got)};
}

/* c: {id, group, kind: "N"|"B"|"I", what, expect, tol?, unit?, source?} — run() returns the actual */
export function mcase(c, run){
  test(`${c.id} ${c.what}`, () => {
    /* a case on the private library names its expectation as a function: read here, still before run() */
    const expect = typeof c.expect === "function" ? c.expect() : c.expect;
    let got, err = null;
    /* NeedsData is not the engine's answer: let the harness count the case as skipped */
    try{ got = run(); }catch(e){ if(e && e.name === "NeedsData") throw e; err = e; }
    const j = judge(expect, c.tol, got, err);
    const row = {id: c.id, group: c.group, kind: c.kind, what: c.what,
                 expected: expect && typeof expect === "object" && "throws" in expect
                   ? `ném lỗi${expect.throws ? ` /${expect.throws.source}/` : ""}` : show(expect),
                 actual: j.actual, delta: j.delta ?? null,
                 actualValue: isNum(got) && Number.isFinite(got) && !err ? got : null,
                 tol: c.tol ?? null, unit: c.unit ?? (isNum(expect) ? "mm" : ""),
                 source: c.source || "", pass: j.pass};
    rows.push(row);
    if(!row.pass) throw new Error(`expected ${row.expected}${row.tol !== null ? ` ±${row.tol}` : ""}, got ${row.actual}`);
  });
}
