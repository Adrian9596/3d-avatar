/* The private pattern data the public repo does not carry — the frozen factory 3380 fixture,
   BLOCK_36C and the DXF library — read from a local copy of the "2D Pattern" folder named by
   PATTERN2D_DATA. Without it, a test that touches them throws NeedsData, which the harness
   counts as SKIPPED (never as passed). With it set, a missing file is an ordinary ENOENT: a
   wrong folder fails loudly instead of quietly skipping. */
import {readFileSync} from "node:fs";
import {resolve, join} from "node:path";

export class NeedsData extends Error {
  constructor(what){
    super(`cần dữ liệu ngoài repo: ${what} — đặt PATTERN2D_DATA=<thư mục "2D Pattern">`);
    this.name = "NeedsData";
    this.what = what;
    /* the harness counts these: a test that catches one and then "passes" did not run (tests/harness.js) */
    const seen = globalThis[Symbol.for("pattern2d.needsData")] ||= {count: 0, last: null};
    seen.count++; seen.last = what;
  }
}

export const DATA_ROOT = process.env.PATTERN2D_DATA ? resolve(process.env.PATTERN2D_DATA) : null;
export const hasData = DATA_ROOT !== null;

/* a file of the data folder, by its path inside "2D Pattern" (e.g. "output/BLOCK_36C.dxf") */
export function dataPath(rel){
  if(!hasData) throw new NeedsData(rel);
  return join(DATA_ROOT, rel);
}

/* stands in for a data VALUE while there is no data: any use of it (a property, a loop, JSON) is NeedsData */
export function missing(rel, shape = {}){
  const no = () => { throw new NeedsData(rel); };
  return new Proxy(shape, {get: no, has: no, ownKeys: no, getOwnPropertyDescriptor: no, set: no});
}

export const BLOCK_36C = "output/BLOCK_36C.dxf";
export const block36Text = () => readFileSync(dataPath(BLOCK_36C), "utf8");
