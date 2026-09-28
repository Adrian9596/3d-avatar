#!/usr/bin/env node
/* Chạy mọi *.test.js nằm cạnh code nó kiểm.
     node tests/run.js              — tất cả
     node tests/run.js 3380         — chỉ các bộ trên rập thật 3380
     node tests/run.js model.3380   — chỉ một bộ */
import {readdirSync, statSync, writeFileSync} from "node:fs";
import {join, relative} from "node:path";
import {pathToFileURL, fileURLToPath} from "node:url";
import {setFile, runAll} from "./harness.js";
import {rows} from "./engine.js";
import {hasData} from "./data.js";

const root = fileURLToPath(new URL("../src/", import.meta.url));   // paths, not percent-encoded URLs

function walk(dir){
  return readdirSync(dir).sort().flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : (name.endsWith(".test.js") ? [p] : []);
  });
}

const filter = process.argv[2] || "";
const files = walk(root).filter(f => f.includes(filter));
if(!files.length){ console.log(`không có test nào khớp "${filter}"`); process.exit(1); }
if(!hasData) console.log(`\n  PATTERN2D_DATA chưa đặt — test cần rập thật (3380, BLOCK_36C, thư viện DXF) sẽ bị bỏ qua`);
let loadFailed = 0;
for(const f of files){
  setFile("src/" + relative(root, f));
  try{ await import(pathToFileURL(f).href); }
  catch(err){
    /* data read while the file loads: its tests could not even be counted — a failure, not a skip */
    if(!(err && err.name === "NeedsData")) throw err;
    loadFailed++;
    console.log(`\n  ✗ src/${relative(root, f)}: đọc ${err.what} ngay lúc nạp file — đưa việc đọc vào trong test`);
  }
}
const failed = runAll() + loadFailed;
/* the Measure Engine rows (tests/engine.js), for scripts/check_engine.py to turn into the report */
if(process.env.ENGINE_ROWS) writeFileSync(process.env.ENGINE_ROWS, JSON.stringify(rows, null, 1));
process.exit(failed ? 1 : 0);
