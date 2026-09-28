/* A test runner small enough to read in one sitting: no dependencies, no globals,
   no watch mode. A test is a name and a function that throws when it is wrong. */

const cases = [];
let file = "";

export const setFile = f => { file = f; };
export const test = (name, fn) => cases.push({file, name, fn});

const show = v => typeof v === "object" ? JSON.stringify(v) : String(v);

export function eq(actual, expected, msg){
  if(!Object.is(actual, expected))
    throw new Error(`${msg ? msg+": " : ""}expected ${show(expected)}, got ${show(actual)}`);
}
export function near(actual, expected, tol = 1e-6, msg){
  if(!(Math.abs(actual-expected) <= tol))
    throw new Error(`${msg ? msg+": " : ""}expected ${show(expected)} ±${tol}, got ${show(actual)}`);
}
export function deepEq(actual, expected, msg){
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if(a !== b) throw new Error(`${msg ? msg+": " : ""}expected ${b}, got ${a}`);
}
export function ok(cond, msg){ if(!cond) throw new Error(msg || "expected a truthy value"); }

/* tests/data.js: a test that needs the private pattern data, run without it, throws NeedsData.
   It is SKIPPED and counted — never passed, never failed. Matched by name, so this file keeps
   importing nothing. */
const needsData = err => !!err && err.name === "NeedsData";
const seen = () => globalThis[Symbol.for("pattern2d.needsData")] || {count: 0, last: null};

export function runAll(){
  let failed = 0, skipped = 0, group = null;
  const missing = new Map();
  for(const c of cases){
    if(c.file !== group){ group = c.file; console.log(`\n  ${group}`); }
    const before = seen().count;
    /* whether it threw, not what: a thrown 0, "" or false is a failure too */
    let threw = false, err;
    try{ c.fn(); }catch(e){ threw = true; err = e; }
    /* a NeedsData the test caught itself ("expect it to throw") still means it never ran on its data */
    const what = threw && needsData(err) ? err.what : seen().count > before ? seen().last : null;
    if(what !== null){ skipped++; missing.set(what, (missing.get(what) || 0) + 1);
                       console.log(`    ○ ${c.name}  (bỏ qua — cần ${what})`); }
    else if(threw){ failed++; console.log(`    ✗ ${c.name}\n        ${err?.message ?? String(err)}`); }
    else console.log(`    ✓ ${c.name}`);
  }
  const ran = cases.length - skipped;
  if(skipped){
    console.log(`\n  bỏ qua ${skipped} test cần dữ liệu ngoài repo — đặt PATTERN2D_DATA=<thư mục "2D Pattern">:`);
    for(const [what, n] of [...missing].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)} × ${what}`);
  }
  /* "N/N passed" stays the first thing on the line: scripts/status.py reads (\d+)/(\d+) passed */
  console.log(`\n  ${ran - failed}/${ran} passed${skipped ? `, ${skipped} skipped` : ""}\n`);
  return failed;
}
